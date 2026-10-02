'use strict'
// O plugin do simulador (index.js) com um "app" SignalK falso.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const os = require('node:os')
const criar = require('..')

function appFalso () {
  const app = new EventEmitter()
  app.deltas = []
  app.erro = null
  app.estado = ''
  app.handleMessage = (id, d) => app.deltas.push(d)
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (e) => { app.erro = e }
  return app
}
const caminhosProprios = (app) => app.deltas.filter(d => !d.context).flatMap(d => d.updates.flatMap(u => u.values.map(v => v.path)))
const esperar = () => new Promise(resolve => setImmediate(resolve))

// Auditoria M-69 (E-M14): sem os ficheiros da passagem (gitignored) o start() rebentava.
test('M-69: a passagem simulada sem os ficheiros dá um erro do plugin que explica o que falta (não rebenta)', () => {
  const app = appFalso()
  const p = criar(app)
  assert.doesNotThrow(() => p.start({ instantePassagem: '2026-09-29T21:00', pastaPassagem: path.join(os.tmpdir(), 'nao-existe-passagem') }))
  p.stop()
  assert.match(app.erro, /passagem\.json/)
  assert.match(app.erro, /simular\.mjs/)
})

// Auditoria M-49 (G-M13): no dev o course-provider calcula navigation.course.* para o destino posto na API
// de rumo (a rota ativada pelo plugin da rota) e o simulador publicava os do seu WP por cima: duas fontes.
test('M-49: com um destino na API de rumo o simulador não publica navigation.course.*; sem destino publica o WP do demo', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-02T10:00:00Z') })
  const comRota = appFalso()
  comRota.getCourse = async () => ({ activeRoute: { href: '/resources/routes/abc', pointIndex: 1 }, nextPoint: { type: 'RoutePoint', position: { latitude: 39.3, longitude: -9.4 } } })
  const p = criar(comRota)
  p.start({ cenario: 'navegar-demo' })
  await esperar()
  for (let s = 0; s < 3; s++) t.mock.timers.tick(1000)
  p.stop()
  assert.ok(caminhosProprios(comRota).includes('navigation.position'))
  assert.deepEqual(caminhosProprios(comRota).filter(c => c.startsWith('navigation.course.')), [])

  const semRota = appFalso()
  semRota.getCourse = async () => ({ activeRoute: null, nextPoint: null })
  const p2 = criar(semRota)
  p2.start({ cenario: 'navegar-demo' })
  await esperar()
  for (let s = 0; s < 3; s++) t.mock.timers.tick(1000)
  p2.stop()
  assert.ok(caminhosProprios(semRota).includes('navigation.course.nextPoint'))
})
