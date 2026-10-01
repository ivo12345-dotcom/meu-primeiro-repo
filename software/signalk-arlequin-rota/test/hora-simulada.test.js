'use strict'
// Só testes (a viagem acelerada do dev, software/dev/viagem-acelerada.js): com horaSimulada, o relógio
// do plugin é o navigation.datetime do SignalK e o ciclo a navegar corre de cicloSegundos em
// cicloSegundos; sem navigation.datetime o ciclo não corre (nada de saltos para a hora real a meio).
// O GET /plano-ativo diz a hora do plugin (agora), para o ecrã contar "daqui a X min" com ela.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { appFalso, plugin, chamar, calcular, AGORA, H } = require('./ajuda')

test('horaSimulada: o relógio vem do navigation.datetime; o ciclo de cicloSegundos; sem datetime o ciclo não corre', async () => {
  const app = appFalso()
  const agendados = []
  const { p, r } = plugin(app, { agendarCiclo: (fn, ms) => { agendados.push(ms); return 1 }, pararCiclo: () => {} })
  p.start({ pasta: path.join(app.dir, 'dados'), horaSimulada: true, cicloSegundos: 1 })
  assert.deepEqual(agendados, [1000])
  const { id } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  const simulada = AGORA + 5 * H
  app.self['navigation.datetime'] = new Date(simulada).toISOString()
  await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(p.planoAtivo().ativadoEm, new Date(simulada).toISOString())
  await p.cicloNavegar()
  const g = await chamar(r.get['/plano-ativo'])
  assert.equal(g.agora, new Date(simulada).toISOString())
  // sem datetime: o ciclo não corre
  delete app.self['navigation.datetime']
  const n = app.deltas.length
  app.self['environment.outside.pressure'] = 101000
  await p.cicloNavegar()
  assert.equal(app.deltas.length, n)
  p.stop()
  // sem horaSimulada: o relógio do plugin (e o ciclo de 60 s)
  const q = plugin(appFalso(), { agendarCiclo: (fn, ms) => { agendados.push(ms); return 1 }, pararCiclo: () => {} })
  q.p.start({ pasta: path.join(app.dir, 'dados2') })
  assert.equal(agendados.at(-1), 60000)
  q.p.stop()
})
