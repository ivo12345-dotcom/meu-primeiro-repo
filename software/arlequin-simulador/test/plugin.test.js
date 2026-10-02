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

// ---- F6b ----
const fs = require('node:fs')
const { lerLinha, descodificar } = require('../../signalk-arlequin-j1939/lib/j1939')
// as rotações (rpm) de cada EEC1 que o simulador manda ao plugin do J1939, com o segundo em que saiu
function ouvirJ1939 (app, relogio) {
  const eec1 = []
  app.on('arlequin-j1939', (linha) => {
    const t = lerLinha(linha)
    if (t.pgn === 61444) eec1.push({ s: relogio.s, rpm: descodificar(t.pgn, t.dados)[0].value * 60 })
  })
  return eec1
}

// Revisão F6, Importante 3 (contrato C11): o MDI verdadeiro cala-se com a ignição desligada; o simulador
// mandava tramas a 0 rpm o tempo todo à vela e o dev nunca mostrava o "calado".
test('revisão F6 n.º 3: à vela (a ignição desligada) o simulador não manda tramas J1939; manda-as a motor e com a ignição ligada 10 s antes de arrancar e depois de parar', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-02T10:00:00Z') })
  const app = appFalso()
  app.getCourse = async () => ({ activeRoute: null, nextPoint: null })
  const relogio = { s: 0 }
  const eec1 = ouvirJ1939(app, relogio)
  const p = criar(app)
  p.start({ cenario: 'navegar-demo', cicloVelaMin: 1, cicloMotorMin: 1 }) // 60 s à vela, 60 s a motor
  await esperar()
  for (relogio.s = 1; relogio.s <= 175; relogio.s++) t.mock.timers.tick(1000)
  p.stop()
  const em = (de, ate) => eec1.filter(x => x.s >= de && x.s <= ate)
  assert.deepEqual(em(1, 49), [], 'à vela: nenhuma trama')
  assert.deepEqual(em(130, 169), [], 'à vela depois de parar: nenhuma trama')
  assert.ok(em(50, 59).length >= 9 && em(50, 59).every(x => x.rpm === 0), 'a ignição ligada antes de arrancar (pré-aquecimento): 0 rpm')
  assert.ok(em(61, 118).length >= 50 && em(61, 118).every(x => x.rpm === 2100), 'a motor: 2100 rpm')
  assert.ok(em(121, 129).length >= 8 && em(121, 129).every(x => x.rpm === 0), 'a ignição ainda ligada depois de parar: 0 rpm')
})

// A passagem simulada: um ponto, numa pasta temporária (os ficheiros verdadeiros não estão no git).
function pastaPassagem (ponto) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-passagem-'))
  const ROTA = [{ nome: 'Algés (partida)', lat: 38.6955, lon: -9.233 }, { nome: 'Barra Norte', lat: 38.668, lon: -9.315 }]
  fs.writeFileSync(path.join(dir, 'passagem.json'), JSON.stringify([{ t: Date.parse('2026-07-01T20:00:00Z'), lat: 38.68, lon: -9.28, proa: 250, cog: 252, sog: 5, stw: 5.2, tws: 12, twd: 330, motor: true, soc: 0.9, gasoleo: 120, noite: false, wp: 'Barra Norte', ...ponto }]))
  fs.writeFileSync(path.join(dir, 'rota.json'), JSON.stringify({ ROTA }))
  return dir
}

// Revisão F6, Menor 11: o M-49 só ficou no demo — a passagem continuava a publicar navigation.course.* por
// cima do course-provider, e mandava o motor a 2000 rpm (o resto do simulador e a rota cruzam a 2100).
test('revisão F6 n.º 11: na passagem, com um destino na API de rumo não publica navigation.course.*; sem destino publica o WP; o motor a 2100 rpm', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-02T10:00:00Z') })
  const dir = pastaPassagem({})
  const comRota = appFalso()
  comRota.getCourse = async () => ({ activeRoute: { href: '/resources/routes/abc', pointIndex: 1 }, nextPoint: { type: 'RoutePoint', position: { latitude: 38.668, longitude: -9.315 } } })
  const relogio = { s: 0 }
  const eec1 = ouvirJ1939(comRota, relogio)
  const p = criar(comRota)
  p.start({ instantePassagem: '2026-07-01T21:00', pastaPassagem: dir })
  await esperar()
  for (relogio.s = 1; relogio.s <= 3; relogio.s++) t.mock.timers.tick(1000)
  p.stop()
  assert.ok(caminhosProprios(comRota).includes('navigation.position'))
  assert.deepEqual(caminhosProprios(comRota).filter(c => c.startsWith('navigation.course.')), [])
  assert.ok(eec1.length >= 3 && eec1.every(x => x.rpm === 2100), JSON.stringify(eec1))

  const semRota = appFalso()
  semRota.getCourse = async () => ({ activeRoute: null, nextPoint: null })
  const p2 = criar(semRota)
  p2.start({ instantePassagem: '2026-07-01T21:00', pastaPassagem: dir })
  await esperar()
  for (let s = 0; s < 3; s++) t.mock.timers.tick(1000)
  p2.stop()
  assert.ok(caminhosProprios(semRota).includes('navigation.course.nextPoint'))
})

test('revisão F6 n.º 3 e 11: na passagem à vela (a ignição desligada) não há tramas J1939', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-02T10:00:00Z') })
  const app = appFalso()
  app.getCourse = async () => ({ activeRoute: null, nextPoint: null })
  const relogio = { s: 0 }
  const eec1 = ouvirJ1939(app, relogio)
  const p = criar(app)
  p.start({ instantePassagem: '2026-07-01T21:00', pastaPassagem: pastaPassagem({ motor: false }) })
  await esperar()
  for (relogio.s = 1; relogio.s <= 5; relogio.s++) t.mock.timers.tick(1000)
  p.stop()
  assert.deepEqual(eec1, [])
})

// Revisão F6, Menor 12 (decisão n.º 22): os textos dos plugins na hora de Lisboa, seja qual for o fuso do
// sistema (o Pi pode estar em UTC).
test('revisão F6 n.º 12: as horas do estado do simulador são as de Lisboa, mesmo com o sistema em UTC', async (t) => {
  const tz = process.env.TZ
  process.env.TZ = 'UTC'
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-02T10:00:00Z') })
  const app = appFalso()
  const p = criar(app)
  p.start({ cenario: 'motor-fraca', msPorHora: 60, inicio: '2026-07-01T08:00:00Z' }) // 1 ms por minuto simulado
  for (let i = 0; i < 60; i++) t.mock.timers.tick(1)
  p.stop()
  assert.match(app.estado, /^motor-fraca · 01\/07\/2026, 10:00:00 · serviço/) // 09:00 UTC = 10:00 em Lisboa (verão)
  const app2 = appFalso()
  app2.getCourse = async () => ({ activeRoute: null, nextPoint: null })
  const p2 = criar(app2)
  p2.start({ instantePassagem: '2026-07-01T21:00', pastaPassagem: pastaPassagem({}) })
  p2.stop()
  assert.match(app2.estado, /^Passagem: 01\/07\/2026, 21:00:00 · Barra Norte/) // 20:00 UTC
})
