'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEncaminhador, encaminhar, listarNotificacoes } = require('../lib/mensagens')
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
