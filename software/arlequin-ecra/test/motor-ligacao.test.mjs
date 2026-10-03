// O estado da ligação ao motor (contrato C11, F6b): o plugin J1939 publica propulsion.main.ligacao —
//   'a-receber' (tramas a chegar), 'calado' (a interface CAN de pé e sem tramas há mais de 5 s: a ignição
//   desligada) ou 'sem-ligacao' (a interface em baixo ou o leitor a falhar) —, ausente nos primeiros 5 s e num
//   plugin antigo. O ecrã (auditoria I-23/C-I11: nunca "desligado" a verde quando é desconhecido):
//   'calado' → "motor desligado" e conta como vela; 'sem-ligacao' → "sem leitura do motor" (e o aviso
//   notifications.propulsion.main.semLigacao, apito curto, só no ecrã); 'a-receber' com as rotações a null →
//   "sem leitura do motor"; sem o estado (plugin antigo), pelas rotações como até aqui.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lerFonte, funcao } from './ajuda-fonte.mjs'
import { motorLigado, motorEstado, motorResumo, LIGACAO_MOTOR_VELHA_MS } from '../public/paginas/comum.js'
import { novaViagem, acumular } from '../public/lib/viagem.js'
import { deveTocar, paginaDoAlarme, chipAlarme, alarmeDaBarra } from '../public/lib/alarmes.js'
import motor from '../public/paginas/motor.js'
import velas from '../public/paginas/velas.js'
import carta from '../public/paginas/carta.js'

const NO = 1852 / 3600
const REV = 'propulsion.main.revolutions'
const LIG = 'propulsion.main.ligacao'

// um contexto só com o que se pede: valores por caminho e a idade de cada um (0 por omissão; Infinity sem valor)
function ctx (valores = {}, { idades = {}, notificacoes = [], estado = {} } = {}) {
  return {
    v: (p) => valores[p],
    idade: (p) => (p in idades ? idades[p] : p in valores ? 0 : Infinity),
    notificacoes,
    alvos: [],
    estado,
    polar: null,
    baro: null,
    viagem: novaViagem(0),
    demo: false,
    pedir: () => new Promise(() => {}),
    logbook: async () => {},
    refrescar: () => {}
  }
}

test('C11: motorLigado(rotações, ligação) — calado é desligado; sem-ligacao é desconhecido; a-receber e o plugin antigo, pelas rotações', () => {
  // calado: a ignição desligada, sabe-se (os valores vêm a null)
  assert.equal(motorLigado(null, 'calado'), false)
  assert.equal(motorLigado(undefined, 'calado'), false)
  // sem ligação: não se sabe, tenha o que tiver nas rotações
  assert.equal(motorLigado(null, 'sem-ligacao'), null)
  assert.equal(motorLigado(30, 'sem-ligacao'), null)
  assert.equal(motorLigado(0, 'sem-ligacao'), null)
  // a receber: as rotações; rotações a null com a ligação a receber (o MDI fala mas sem a EEC1): sem leitura
  assert.equal(motorLigado(30, 'a-receber'), true)
  assert.equal(motorLigado(0, 'a-receber'), false)
  assert.equal(motorLigado(null, 'a-receber'), null)
  // sem o estado (plugin antigo, 1.ºs 5 s) ou um valor que não se conhece: como antes
  assert.equal(motorLigado(30), true)
  assert.equal(motorLigado(0, undefined), false)
  assert.equal(motorLigado(null, null), null)
  assert.equal(motorLigado(30, 'outra-coisa'), true)
  assert.equal(motorLigado(null, 'outra-coisa'), null)
})

test('C11: motorEstado(ctx) lê a ligação e as rotações; uma ligação velha (o plugin parou) já não vale: sem leitura, nunca "desligado"', () => {
  assert.equal(LIGACAO_MOTOR_VELHA_MS, 20000)
  assert.equal(motorEstado(ctx({ [LIG]: 'calado', [REV]: null })), false)
  assert.equal(motorEstado(ctx({ [LIG]: 'sem-ligacao', [REV]: null })), null)
  assert.equal(motorEstado(ctx({ [LIG]: 'a-receber', [REV]: 30 })), true)
  assert.equal(motorEstado(ctx({ [REV]: 30 })), true, 'plugin antigo')
  assert.equal(motorEstado(ctx({})), null, 'nada publicado')
  // o plugin publica a ligação de segundo a segundo: com mais de 20 s está parado (e as rotações com ela)
  assert.equal(motorEstado(ctx({ [LIG]: 'calado', [REV]: null }, { idades: { [LIG]: 19000 } })), false)
  assert.equal(motorEstado(ctx({ [LIG]: 'calado', [REV]: null }, { idades: { [LIG]: 21000 } })), null, 'calado velho: não se sabe')
  assert.equal(motorEstado(ctx({ [LIG]: 'a-receber', [REV]: 30 }, { idades: { [LIG]: 60000 } })), null, 'a receber velho: as rotações também são velhas')
  // um contexto sem idade (os testes de outras páginas) conta como fresco
  const semIdade = { v: (p) => ({ [LIG]: 'calado' })[p] }
  assert.equal(motorEstado(semIdade), false)
})

test('C11: o resumo do motor (Carta) — calado "motor desligado" a verde; sem ligação ou sem rotações "sem leitura do motor" (cinzento); nunca "desligado" a verde quando é desconhecido', () => {
  const calado = motorResumo(ctx({ [LIG]: 'calado', [REV]: null }))
  assert.match(calado.estado, /<span class="ok">motor desligado<\/span>/)
  assert.equal(calado.ligado, false)
  assert.equal(calado.semLeitura, false)
  for (const valores of [{ [LIG]: 'sem-ligacao', [REV]: null }, { [LIG]: 'a-receber', [REV]: null }, { [LIG]: 'sem-ligacao', [REV]: 30 }, {}]) {
    const r = motorResumo(ctx(valores))
    assert.match(r.estado, /<span class="lab">sem leitura do motor<\/span>/, JSON.stringify(valores))
    assert.doesNotMatch(r.estado, /class="ok"|desligado/, JSON.stringify(valores))
    assert.equal(r.semLeitura, true)
    assert.equal(r.ligado, false)
  }
  // a trabalhar e o motor parado com a ignição ligada, como antes
  assert.match(motorResumo(ctx({ [LIG]: 'a-receber', [REV]: 30 })).estado, /a trabalhar · 1800 rpm/)
  assert.match(motorResumo(ctx({ [LIG]: 'a-receber', [REV]: 0 })).estado, /<span class="ok">motor desligado<\/span>/)
})

test('C11: a página Motor e a Carta dizem o mesmo; sem ligação o aviso do J1939 (warn, apito curto) aparece na lista de alarmes e a barra mostra-o', () => {
  const calado = ctx({ [LIG]: 'calado', [REV]: null })
  assert.match(motor.render(calado), /Volvo Penta D1-20B<\/span><span class="ok">motor desligado<\/span>/)
  assert.match(carta.render(calado), /<span class="lab">Motor<\/span><span class="ok">motor desligado<\/span>/)
  // o aviso como o plugin o publica (index.js do J1939: warn, visual e som, apito curto) com o id e o status do servidor
  const aviso = { caminho: 'notifications.propulsion.main.semLigacao', id: '4f9b7062-5b6e-4a99-9b52-ae5d6f708b92', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: 'Sem leitura do motor (J1939): a interface can1 não existe (adaptador USB-CAN solto?)', status: { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true }, timestamp: '2026-10-03T10:00:00.000Z' }
  const sem = ctx({ [LIG]: 'sem-ligacao', [REV]: null }, { notificacoes: [aviso] })
  const m = motor.render(sem)
  assert.match(m, /Volvo Penta D1-20B<\/span><span class="lab">sem leitura do motor<\/span>/)
  assert.doesNotMatch(m, /class="ok">motor desligado/)
  assert.match(m, /Alarmes do motor, da energia e dos depósitos \(1\)/)
  assert.match(m, /Sem leitura do motor \(J1939\): a interface can1 não existe \(adaptador USB-CAN solto\?\)/)
  assert.match(carta.render(sem), /<span class="lab">Motor<\/span><span class="lab">sem leitura do motor<\/span>/)
  // só no ecrã, apito curto (contrato C1/C11); leva à página do Motor; na barra é um aviso (âmbar), com o botão de calar
  assert.equal(deveTocar(aviso), 'curto')
  assert.equal(paginaDoAlarme(aviso.caminho), 'motor')
  const chip = chipAlarme(alarmeDaBarra([aviso]))
  assert.match(chip, /^<span class="chip aviso" data-acao="ir-alarme"[^>]*>⚠ Sem leitura do motor \(J1939\)/)
  assert.match(chip, /data-acao="silenciar"/)
})

test('C11: Recolher velas — "à espera das rotações" só com o motor sabido desligado; sem leitura, "confirma-o no painel do motor"', () => {
  const ligar = (valores) => velas.render(ctx(valores, { estado: { passo: 0 } }))
  assert.match(ligar({ [LIG]: 'calado', [REV]: null }), /à espera das rotações do motor…/)
  assert.doesNotMatch(ligar({ [LIG]: 'calado', [REV]: null }), /sem leitura do motor/)
  for (const valores of [{ [LIG]: 'sem-ligacao', [REV]: null }, { [LIG]: 'a-receber', [REV]: null }]) {
    const h = ligar(valores)
    assert.match(h, /sem leitura do motor: confirma-o no painel do motor/, JSON.stringify(valores))
    assert.doesNotMatch(h, /à espera das rotações/, JSON.stringify(valores))
  }
  // o motor ligou: avança sozinho
  const e = { passo: 0 }
  velas.render(ctx({ [LIG]: 'a-receber', [REV]: 30 }, { estado: e }))
  assert.equal(e.passo, 1)
})

test('C11: a viagem — com a ignição desligada (calado) o barco a andar conta como vela; sem ligação fica à parte, sem leitura', () => {
  const dia = (valores) => {
    let v = novaViagem(0)
    for (let s = 1; s <= 3600; s++) v = acumular(v, { t: s * 1000, sog: 5 * NO, motor: motorEstado(ctx(valores)), fuelRate: 0 })
    return v
  }
  const calado = dia({ [LIG]: 'calado', [REV]: null })
  assert.ok(Math.abs(calado.tempoVela - 3599) < 2, `vela ${calado.tempoVela}`)
  assert.equal(calado.tempoMotor, 0)
  assert.equal(calado.tempoSemLeitura, 0)
  const sem = dia({ [LIG]: 'sem-ligacao', [REV]: null })
  assert.equal(sem.tempoVela, 0)
  assert.ok(Math.abs(sem.tempoSemLeitura - 3599) < 2)
  const motorLig = dia({ [LIG]: 'a-receber', [REV]: 30 })
  assert.equal(motorLig.tempoVela, 0)
  assert.ok(Math.abs(motorLig.tempoMotor - 3599) < 2)
})

test('C11: o app.js manda ao resumo da viagem o estado do motor com a ligação (e a idade dela), não só as rotações', () => {
  const app = lerFonte('app.js')
  const dados = funcao(app, 'function registarDados')
  assert.match(dados, /motor:\s*motorEstado\(/)
  assert.match(dados, /idade\(store/, 'com a idade da ligação')
  assert.doesNotMatch(dados, /motorLigado\(v\('propulsion\.main\.revolutions'\)\)/)
})
