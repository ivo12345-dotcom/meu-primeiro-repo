'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEncaminhador, encaminhar, listarNotificacoes, alarmesAtivos } = require('../lib/mensagens')
const { resumo } = require('../lib/resumo')

const MIN = 60 * 1000
const n = (caminho, state, message = caminho) => ({ caminho, state, message })

test('só as mudanças seguem; "resolvido" ao voltar ao normal', () => {
  let e = novoEncaminhador()
  let r = encaminhar(e, [n('notifications.arlequin.porto.aguaPorao', 'alarm', 'Água no porão!')], 0); e = r.enc
  assert.deepEqual(r.mensagens, ['🚨 Água no porão!'])
  r = encaminhar(e, [n('notifications.arlequin.porto.aguaPorao', 'alarm', 'Água no porão!')], MIN); e = r.enc
  assert.deepEqual(r.mensagens, [])
  r = encaminhar(e, [n('notifications.arlequin.porto.aguaPorao', 'normal', 'Normal')], 15 * MIN)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Água no porão!'])
})

test('a oscilar: alarmes do mesmo caminho no máximo de 10 em 10 min; cada um tem o seu "resolvido"', () => {
  let e = novoEncaminhador()
  const envios = []
  for (let m = 0; m < 20; m++) {
    const r = encaminhar(e, [n('notifications.x', m % 2 ? 'normal' : 'warn', 'x')], m * MIN)
    e = r.enc
    envios.push(...r.mensagens.map(t => [m, t]))
  }
  const alarmes = envios.filter(([, t]) => t.startsWith('⚠️')).map(([m]) => m)
  assert.deepEqual(alarmes, [0, 10])
  assert.deepEqual(envios.filter(([, t]) => t.startsWith('✓')).map(([m]) => m), [1, 11])
})

test('auditoria K-08: o alarme que volta dentro dos 10 min não se perde: segue aos 10 min se ainda estiver ativo (sonda p5)', () => {
  const C = 'notifications.arlequin.porto.aguaPorao'
  let e = novoEncaminhador()
  const envios = []
  // água aos 0 min, a bomba esvazia ao 1 min, a água volta aos 2 min e fica 2 h
  for (let m = 0; m <= 120; m++) {
    const r = encaminhar(e, [m === 1 ? n(C, 'normal', 'Normal') : n(C, 'alarm', 'Água no porão!')], m * MIN)
    e = r.enc
    envios.push(...r.mensagens.map(t => `${m} min: ${t}`))
  }
  assert.deepEqual(envios, ['0 min: 🚨 Água no porão!', '1 min: ✓ Resolvido: Água no porão!', '10 min: 🚨 Água no porão!'])
  // e o "Resolvido" desse 2.º alarme sai quando a água acaba
  assert.deepEqual(encaminhar(e, [n(C, 'normal', 'Normal')], 121 * MIN).mensagens, ['✓ Resolvido: Água no porão!'])
})

test('auditoria K-08: um alarme travado pelos 10 min que limpa antes de seguir não dá "Resolvido" (nunca foi enviado)', () => {
  const C = 'notifications.arlequin.porto.aguaPorao'
  let e = novoEncaminhador()
  const envios = []
  for (const [m, state] of [[0, 'alarm'], [1, 'normal'], [3, 'alarm'], [5, 'normal'], [30, 'normal']]) {
    const r = encaminhar(e, [n(C, state, state === 'alarm' ? 'Água no porão!' : 'Normal')], m * MIN)
    e = r.enc
    envios.push(...r.mensagens.map(t => `${m} min: ${t}`))
  }
  assert.deepEqual(envios, ['0 min: 🚨 Água no porão!', '1 min: ✓ Resolvido: Água no porão!'])
})

test('auditoria K-08: uma escalada warn → alarm dentro dos 10 min não se perde: segue aos 10 min', () => {
  const C = 'notifications.arlequin.energia.servico'
  let e = novoEncaminhador()
  const envios = []
  for (let m = 0; m <= 30; m++) {
    const r = encaminhar(e, [m < 3 ? n(C, 'warn', 'Serviço a 52%') : n(C, 'alarm', 'Serviço a 49%')], m * MIN)
    e = r.enc
    envios.push(...r.mensagens.map(t => `${m} min: ${t}`))
  }
  assert.deepEqual(envios, ['0 min: ⚠️ Serviço a 52%', '10 min: 🚨 Serviço a 49%'])
  assert.deepEqual(encaminhar(e, [n(C, 'normal', 'Normal')], 31 * MIN).mensagens, ['✓ Resolvido: Serviço a 49%'])
})

test('alarme resolvido logo a seguir: o "resolvido" segue mesmo dentro dos 10 min', () => {
  let e = novoEncaminhador()
  e = encaminhar(e, [n('notifications.arlequin.porto.intrusao', 'alarm', 'Intrusão')], 0).enc
  const r = encaminhar(e, [n('notifications.arlequin.porto.intrusao', 'normal')], 30 * 1000)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Intrusão'])
})

test('amarrado: alarmes AIS não seguem; o resto segue', () => {
  const r = encaminhar(novoEncaminhador(), [n('notifications.arlequin.ais.263000001', 'alarm'), n('notifications.arlequin.energia.servicoCritico', 'alarm', 'Serviço a 49%')], 0, { amarrado: true })
  assert.deepEqual(r.mensagens, ['🚨 Serviço a 49%'])
})

test('emergência tem ícone próprio', () => {
  const r = encaminhar(novoEncaminhador(), [n('notifications.arlequin.porto.fumo', 'emergency', 'FUMO a bordo!')], 0)
  assert.deepEqual(r.mensagens, ['🔥 FUMO a bordo!'])
})

test('lista as notificações da árvore do SignalK', () => {
  const arvore = { arlequin: { porto: { fumo: { value: { state: 'emergency', message: 'FUMO' }, timestamp: 'x' } }, energia: { ligarMotor: { value: { state: 'normal', message: 'Normal' } } } } }
  assert.deepEqual(listarNotificacoes(arvore), [
    { caminho: 'notifications.arlequin.porto.fumo', state: 'emergency', message: 'FUMO' },
    { caminho: 'notifications.arlequin.energia.ligarMotor', state: 'normal', message: 'Normal' }
  ])
})

test('/estado: resumo legível com o que houver', () => {
  const vals = {
    'electrical.batteries.servico.capacity.stateOfCharge': 0.83, 'electrical.batteries.servico.current': 4.2,
    'electrical.solar.mppt1.panelPower': 120, 'electrical.solar.mppt2.panelPower': 110, 'electrical.batteries.motor.voltage': 12.7,
    'tanks.fuel.0.currentVolume': 0.124, 'tanks.freshWater.0.currentVolume': 0.045, 'tanks.freshWater.0.name': 'Cozinha (BB)'
  }
  const t = resumo((p) => vals[p], { armado: true, amarracao: { ponto: {}, distancia: 4 }, alarmes: [] })
  assert.match(t, /Serviço 83% \(\+4,2 A\) · ☀️ 230 W · motor 12,7 V/)
  assert.match(t, /Gasóleo 124 L · 💧 Cozinha \(BB\) 45 L, EB —/)
  assert.match(t, /Alarme ARMADO · ⚓ amarrado, a 4 m do ponto/)
  assert.match(t, /Sem alarmes/)
})

test('o lembrete das velas nunca vai para o Telegram; o alarme do disco vai', () => {
  const e = novoEncaminhador()
  const r = encaminhar(e, [
    n('notifications.arlequin.caixanegra.velas', 'warn', 'As velas continuam assim?'),
    n('notifications.arlequin.caixanegra.disco', 'alarm', 'Disco a 96%')
  ], 0)
  assert.deepEqual(r.mensagens, ['🚨 Disco a 96%'])
})

test('disco da caixa negra: o aviso (warn) nunca vai para o Telegram; só o alarme e o seu "resolvido"', () => {
  const D = 'notifications.arlequin.caixanegra.disco'
  let e = novoEncaminhador()
  const envios = []
  const passo = (state, message, m) => { const r = encaminhar(e, [n(D, state, message)], m * MIN); e = r.enc; envios.push(...r.mensagens) }
  passo('warn', 'Disco a 81%: copia os dados para o portátil', 0)
  passo('normal', 'Normal', 60)
  passo('warn', 'Disco a 81%: copia os dados para o portátil', 120)
  assert.deepEqual(envios, [], 'aviso e o seu fim ficam só no ecrã')
  passo('alarm', 'Disco a 96%: parei de gravar o bruto', 180)
  passo('warn', 'Disco a 90%: copia os dados para o portátil', 240)
  passo('normal', 'Normal', 300)
  assert.deepEqual(envios, ['🚨 Disco a 96%: parei de gravar o bruto', '✓ Resolvido: Disco a 96%: parei de gravar o bruto'])
})

test('o aviso do relógio do Pi desacertado nunca vai para o Telegram', () => {
  const r = encaminhar(novoEncaminhador(), [n('notifications.arlequin.caixanegra.relogio', 'warn', 'Relógio do Pi desacertado 5 min')], 0)
  assert.deepEqual(r.mensagens, [])
})

test('/estado: os lembretes só do ecrã (velas, relógio) não aparecem nos alarmes ativos', () => {
  assert.deepEqual(alarmesAtivos([
    n('notifications.arlequin.caixanegra.velas', 'warn', 'As velas continuam assim?'),
    n('notifications.arlequin.caixanegra.relogio', 'warn', 'Relógio do Pi desacertado 5 min'),
    n('notifications.arlequin.caixanegra.disco', 'warn', 'Disco a 81%'),
    n('notifications.arlequin.porto.fumo', 'emergency', 'FUMO a bordo!'),
    n('notifications.arlequin.energia.ligarMotor', 'normal', 'Normal'),
    { caminho: 'notifications.arlequin.porto.intrusao', state: 'alarm' }
  ]), ['Disco a 81%', 'FUMO a bordo!', 'Alarme sem descrição (arlequin.porto.intrusao)'])
})

test('auditoria M-54: o /estado conta também o estado alert (como o encaminhador), menos os lembretes só do ecrã', () => {
  assert.deepEqual(alarmesAtivos([
    n('notifications.arlequin.x.aviso', 'alert', 'Um aviso em alert'),
    n('notifications.rota.lembrete.e3', 'alert', 'Às 22:50: Rizar'),
    n('notifications.rota.alarmeTerra', 'alert', 'Os contactos em terra ligam ao MRCC às 19:41'),
    n('notifications.arlequin.porto.fumo', 'emergency', 'FUMO a bordo!')
  ]), ['Um aviso em alert', 'FUMO a bordo!'])
})

test('contrato C11: os avisos só do ecrã (os caminhos que acabam em .sondaPerdida, .sensorPerdido ou .semLigacao) nunca vão para o Telegram nem aparecem no /estado; um gravado ativo por uma versão antiga sai sem "Resolvido"', () => {
  const lista = [
    n('notifications.tanks.fuel.0.sondaPerdida', 'warn', 'Sem a sonda do gasóleo há mais de 5 min'),
    n('notifications.arlequin.energia.sensorPerdido', 'warn', 'Sem dados do SmartShunt há mais de 5 min'),
    n('notifications.propulsion.main.semLigacao', 'warn', 'Sem ligação ao motor (J1939)'),
    n('notifications.x.semLigacaoAoCais', 'warn', 'outro aviso'), // só o fim do caminho conta
    n('notifications.arlequin.porto.fumo', 'emergency', 'FUMO a bordo!')
  ]
  const r = encaminhar(novoEncaminhador(), lista, 0)
  assert.deepEqual(r.mensagens, ['⚠️ outro aviso', '🔥 FUMO a bordo!'])
  assert.deepEqual(alarmesAtivos(lista), ['outro aviso', 'FUMO a bordo!'])
  // nem em alarme
  assert.deepEqual(encaminhar(novoEncaminhador(), [n('notifications.propulsion.main.semLigacao', 'alarm', 'x')], 0).mensagens, [])
  // um que a versão anterior já tinha enviado (gravado ativo no encaminhador.json): sai em silêncio
  const C = 'notifications.tanks.fuel.0.sondaPerdida'
  let e = { ...novoEncaminhador(), estados: { [C]: 'warn' }, mensagem: { [C]: 'Sem a sonda' }, ultimoAlarme: { [C]: 0 }, pendente: { [C]: true } }
  for (const m of [1, 2, 5, 30]) {
    const x = encaminhar(e, [n(C, m < 5 ? 'warn' : 'normal', 'Sem a sonda')], m * MIN)
    assert.deepEqual(x.mensagens, [], `${m} min`)
    e = x.enc
  }
  assert.deepEqual(encaminhar(e, [], 60 * MIN).mensagens, [])
})

test('auditoria I-32: uma notificação sem texto chega ao Telegram com uma frase em pt-PT (e o caminho entre parênteses), também no "Resolvido"', () => {
  const C = 'notifications.propulsion.main.overTemperature'
  let r = encaminhar(novoEncaminhador(), [{ caminho: C, state: 'alarm' }, { caminho: 'notifications.x.aviso', state: 'warn', message: '' }], 0)
  assert.deepEqual(r.mensagens, ['🚨 Alarme sem descrição (propulsion.main.overTemperature)', '⚠️ Aviso sem descrição (x.aviso)'])
  r = encaminhar(r.enc, [{ caminho: C, state: 'normal' }], MIN)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Alarme sem descrição (propulsion.main.overTemperature)'])
})
