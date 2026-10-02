import test from 'node:test'
import assert from 'node:assert/strict'
import { criarBarometro, registarPressao, tendencia } from '../public/lib/barometro.js'
import { novaViagem, acumular } from '../public/lib/viagem.js'
import { maisGrave, deveTocar, paginaDoAlarme, bipDeLigacao, chipAlarme, acaoCalar } from '../public/lib/alarmes.js'

const H = 3600 * 1000
const NO = 1852 / 3600

test('barómetro: a descer 2,4 hPa em 3 h', () => {
  let b = criarBarometro()
  for (let m = 0; m <= 180; m += 10) b = registarPressao(b, 101600 - m * (240 / 180), m * 60000)
  const t = tendencia(b, 180 * 60000)
  assert.equal(t.sentido, 'desce')
  assert.ok(Math.abs(t.hpa3h + 2.4) < 0.01)
})

test('barómetro: menos de 1 h de histórico → sem tendência; ±0,5 hPa = estável', () => {
  let b = registarPressao(criarBarometro(), 101600, 0)
  b = registarPressao(b, 101600, 30 * 60000)
  assert.equal(tendencia(b, 30 * 60000), null)
  let c = criarBarometro()
  for (let m = 0; m <= 180; m += 10) c = registarPressao(c, 101600 + m * 0.1, m * 60000)
  assert.equal(tendencia(c, 180 * 60000).sentido, 'estavel')
})

test('barómetro guarda só 6 h', () => {
  let b = criarBarometro()
  for (let m = 0; m <= 600; m += 10) b = registarPressao(b, 101600, m * 60000)
  assert.ok(b.amostras[0].t >= (600 - 360) * 60000)
})

test('viagem: distância, tempos à vela e a motor, gasóleo, vento máximo', () => {
  let v = novaViagem(0)
  // 1 h à vela a 5 nós, depois 1 h a motor a 6 nós a gastar 1 L/h
  for (let s = 1; s <= 3600; s++) v = acumular(v, { t: s * 1000, sog: 5 * NO, motor: false, fuelRate: 0, ventoReal: 14 * NO, pressao: 101600 })
  for (let s = 3601; s <= 7200; s++) v = acumular(v, { t: s * 1000, sog: 6 * NO, motor: true, fuelRate: 1 / 3600 / 1000, ventoReal: 9 * NO, pressao: 101400 })
  assert.ok(Math.abs(v.distancia / 1852 - 11) < 0.01)
  assert.ok(Math.abs(v.tempoVela - 3600) < 2)
  assert.ok(Math.abs(v.tempoMotor - 3600) < 2)
  assert.ok(Math.abs(v.gasoleoL - 1) < 0.01)
  assert.ok(Math.abs(v.ventoMax - 14 * NO) < 1e-9)
  assert.equal(v.pressaoInicial, 101600)
  assert.equal(v.pressaoFinal, 101400)
})

test('viagem: buraco de dados > 60 s não conta', () => {
  let v = novaViagem(0)
  v = acumular(v, { t: 1000, sog: 5 * NO, motor: false })
  v = acumular(v, { t: 1000 + H, sog: 5 * NO, motor: false })
  assert.equal(v.distancia, 0)
})

const n = (id, state, extra = {}) => ({ caminho: `notifications.${id}`, id: id + '-uuid', state, method: ['visual', 'sound'], message: id, status: { silenced: false, acknowledged: false }, ...extra })

test('o alarme mais grave vai para a barra', () => {
  const lista = [n('arlequin.energia.ligarMotor', 'warn'), n('arlequin.ais.263000001', 'alarm'), n('x', 'normal')]
  assert.equal(maisGrave(lista).caminho, 'notifications.arlequin.ais.263000001')
  assert.equal(maisGrave([n('x', 'normal')]), null)
  assert.equal(maisGrave([n('a', 'warn'), n('b', 'emergency')]).caminho, 'notifications.b')
})

test('toca só com sound e sem silenciar/reconhecer', () => {
  // contrato C1: sem o campo apito, só a emergência dá o contínuo (o alarm passou de contínuo a curto)
  assert.equal(deveTocar(n('a', 'alarm')), 'curto')
  assert.equal(deveTocar(n('a', 'emergency')), 'continuo')
  assert.equal(deveTocar(n('a', 'warn')), 'curto')
  assert.equal(deveTocar(n('a', 'warn', { method: ['visual'] })), null)
  assert.equal(deveTocar(n('a', 'alarm', { status: { silenced: true } })), null)
  assert.equal(deveTocar(n('a', 'alarm', { status: { acknowledged: true } })), null)
  assert.equal(deveTocar(n('a', 'normal')), null)
})

// Como as notificações chegam ao ecrã: o valor do plugin mais o id e o status que o servidor junta
// (signalk-server api/notifications/alarm.js), e a hora da delta.
const doServidor = (caminho, valor) => ({ caminho, id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', status: { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true, canClear: false }, timestamp: '2026-10-02T13:00:00.000Z', ...valor })
const SOM = ['visual', 'sound']

test('contrato C1 (decisão do Ivo n.º 2): o apito contínuo só para o perigo imediato — colisão AIS, fumo, água no porão, fuga de gasóleo e motor a sobreaquecer; o resto com som é curto', () => {
  for (const [caminho, state, message] of [
    ['notifications.arlequin.ais.263000001', 'alarm', 'NORDIC STAR em rota de colisão · CPA 0,1 MN'],
    ['notifications.arlequin.porto.fumo', 'emergency', 'FUMO a bordo!'],
    ['notifications.arlequin.porto.aguaPorao', 'alarm', 'Água no porão!'],
    ['notifications.tanks.fuel.0.fuga', 'alarm', 'Possível fuga de gasóleo: −6,0 L com o motor parado'],
    ['notifications.propulsion.main.overTemperature', 'alarm', 'Motor a 97 °C — sobreaquecimento']
  ]) assert.equal(deveTocar(doServidor(caminho, { state, method: SOM, message, apito: 'continuo' })), 'continuo', caminho)
  for (const [caminho, state, message] of [
    ['notifications.arlequin.caixanegra.disco', 'alarm', 'Disco a 95 %: o bruto parou'],
    ['notifications.arlequin.energia.motorFraca', 'alarm', 'Bateria do motor fraca: 11,9 V'],
    ['notifications.arlequin.energia.servicoCritico', 'alarm', 'Bateria de serviço a 39 %'],
    ['notifications.rota.previsao', 'alarm', 'Previsão com 14 h: confia nos instrumentos e no barómetro'],
    ['notifications.rota.alarmeTerra', 'alert', 'Os contactos em terra ligam ao MRCC às 14:59: avisa-os ou Terminar']
  ]) assert.equal(deveTocar(doServidor(caminho, { state, method: SOM, message, apito: 'curto' })), 'curto', caminho)
  // sem o campo apito (um plugin de antes do contrato, ou de terceiros): contínuo só a emergência
  assert.equal(deveTocar(doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: SOM, message: 'FUMO a bordo!' })), 'continuo')
  assert.equal(deveTocar(doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: SOM, message: 'FUMO a bordo!', apito: null })), 'continuo')
  assert.equal(deveTocar(doServidor('notifications.arlequin.ais.263000001', { state: 'alarm', method: SOM, message: 'x' })), 'curto')
  assert.equal(deveTocar(doServidor('notifications.rota.lembrete.e3', { state: 'alert', method: SOM, message: 'Às 22:50: rizar' })), 'curto')
  assert.equal(deveTocar(doServidor('notifications.arlequin.energia.ligarMotor', { state: 'warn', method: SOM, message: 'x' })), 'curto')
  // só o 'continuo' dá o contínuo: outro valor qualquer, com som, é curto (mesmo numa emergência)
  assert.equal(deveTocar(doServidor('x', { state: 'emergency', method: SOM, apito: 'outro' })), 'curto')
  // silenciado, reconhecido, sem som ou normal: nada, também com o contínuo
  const ativo = { state: 'alarm', method: SOM, message: 'x', apito: 'continuo' }
  assert.equal(deveTocar(doServidor('a', { ...ativo, method: ['visual'], status: { silenced: true, acknowledged: false } })), null)
  assert.equal(deveTocar(doServidor('a', { ...ativo, state: 'emergency', method: ['visual'], status: { silenced: false, acknowledged: true } })), null)
  assert.equal(deveTocar(doServidor('a', { ...ativo, status: { silenced: true, acknowledged: false } })), null)
  assert.equal(deveTocar(doServidor('a', { ...ativo, method: ['visual'] })), null)
  assert.equal(deveTocar(doServidor('a', { ...ativo, state: 'normal' })), null)
})

test('auditoria I-08: entre alarmes da mesma gravidade, a barra mostra primeiro o que ainda apita (um 2.º alarme AIS silencia-se pela barra)', () => {
  const ais = (mmsi, extra = {}) => doServidor(`notifications.arlequin.ais.${mmsi}`, { state: 'alarm', method: SOM, message: mmsi, apito: 'continuo', ...extra })
  const silenciado = ais('A', { method: ['visual'], status: { silenced: true, acknowledged: false, canSilence: true, canAcknowledge: true } })
  assert.equal(maisGrave([silenciado, ais('B')]).message, 'B')
  assert.equal(maisGrave([ais('A'), ais('B')]).message, 'A', 'com os dois a apitar, o primeiro')
  // uma gravidade maior continua à frente, mesmo calada
  const fumo = doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: ['visual'], message: 'FUMO a bordo!', apito: 'continuo', status: { silenced: false, acknowledged: true } })
  assert.equal(maisGrave([ais('B'), fumo]).message, 'FUMO a bordo!')
})

test('auditoria I-08: "silenciar" só onde o servidor deixa; a emergência (que o SignalK não deixa silenciar) tem "reconhecer"; o botão fica fora do chip, para o dedo', () => {
  assert.equal(acaoCalar(doServidor('a', { state: 'alarm', method: SOM, apito: 'continuo' })), 'silenciar')
  assert.equal(acaoCalar(doServidor('a', { state: 'warn', method: SOM })), 'silenciar')
  assert.equal(acaoCalar(doServidor('a', { state: 'emergency', method: SOM, apito: 'continuo' })), 'reconhecer')
  assert.equal(acaoCalar(doServidor('a', { state: 'alarm', method: SOM, status: { silenced: false, acknowledged: false, canSilence: false, canAcknowledge: true } })), 'reconhecer')
  assert.equal(acaoCalar(doServidor('a', { state: 'alarm', method: SOM, status: { silenced: false, acknowledged: false, canSilence: false, canAcknowledge: false } })), null)
  assert.equal(acaoCalar(doServidor('a', { state: 'alarm', method: ['visual'], status: { silenced: true, acknowledged: false } })), null, 'já calado')
  assert.equal(acaoCalar({ caminho: 'x', state: 'alarm', method: SOM }), null, 'sem id (o servidor não o conhece): nada')
  const html = chipAlarme(doServidor('notifications.arlequin.ais.1', { state: 'alarm', method: SOM, message: 'NORDIC STAR', apito: 'continuo' }))
  assert.match(html, /^<span class="chip alarme" data-acao="ir-alarme"[^>]*>⚠ NORDIC STAR<\/span><button class="silenciar" data-acao="silenciar" data-id="0b6f3c2e-[^"]+">silenciar<\/button>$/)
  const fumo = chipAlarme(doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: SOM, message: 'FUMO a bordo!', apito: 'continuo' }))
  assert.doesNotMatch(fumo, /data-acao="silenciar"/)
  assert.match(fumo, /<button class="silenciar" data-acao="reconhecer" data-id="[^"]+">reconhecer<\/button>/)
})

test('auditoria I-08: a falha do silenciar/reconhecer fica à vista na barra, curta e em pt-PT (antes engolida)', async () => {
  const { falhaCalar } = await import('../public/lib/erros.js')
  const erro = (status, message = String(status)) => Object.assign(new Error(message), status ? { status } : {})
  assert.equal(falhaCalar(erro(400, 'um alarme de emergência não se silencia: só se reconhece'), 'silenciar'), 'não silenciou: um alarme de emergência não se silencia: só se reconhece')
  assert.equal(falhaCalar(erro(401), 'silenciar'), 'não silenciou: sem permissão (entra no SignalK)')
  assert.equal(falhaCalar(erro(undefined, 'sem ligação ao SignalK'), 'reconhecer'), 'não reconheceu: sem ligação ao SignalK')
  assert.equal(falhaCalar(erro(400), 'reconhecer'), 'não reconheceu (HTTP 400)')
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const calar = app.slice(app.indexOf("if (acao === 'silenciar' || acao === 'reconhecer')"), app.indexOf("if (acao === 'ir-alarme')"))
  assert.match(calar, /\/acknowledge/)
  assert.match(calar, /\/silence/)
  assert.doesNotMatch(calar, /\.catch\(\(\) => \{\}\)/)
  assert.match(calar, /falhaCalar\(/)
})

test('cada alarme leva à sua página', () => {
  assert.equal(paginaDoAlarme('notifications.arlequin.ais.263000001'), 'ais')
  assert.equal(paginaDoAlarme('notifications.arlequin.energia.ligarMotor'), 'motor')
  assert.equal(paginaDoAlarme('notifications.propulsion.main.overTemperature'), 'motor')
  assert.equal(paginaDoAlarme('notifications.navigation.anchor'), 'carta')
})

test('bip curto só quando a ligação cai', () => {
  assert.equal(bipDeLigacao(true, false), true)
  assert.equal(bipDeLigacao(false, false), false) // tentativas falhadas de religar
  assert.equal(bipDeLigacao(null, false), false) // arranque sem servidor
  assert.equal(bipDeLigacao(false, true), false) // religou
})

test('o lembrete das velas abre a página Velas', () => {
  assert.equal(paginaDoAlarme('notifications.arlequin.caixanegra.velas'), 'velas')
  assert.equal(paginaDoAlarme('notifications.arlequin.caixanegra.disco'), 'diario')
})
