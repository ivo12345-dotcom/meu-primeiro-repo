'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { EventEmitter } = require('node:events')
const disco = require('../lib/disco')
const criar = require('..')

const NO = 1852 / 3600
const EU = 'vessels.urn:mrn:signalk:uuid:arlequin'
const INICIO = Date.UTC(2026, 8, 29, 14, 0, 0)
let usoFalso = 50
disco.usoDisco = () => ({ total: 256e9, livre: 256e9 * (1 - usoFalso / 100), usadoPct: usoFalso })

function appFalso (dir) {
  const app = { valores: {}, notificacoes: [], estado: '', signalk: new EventEmitter(), selfContext: EU }
  app.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-cn-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) { if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value }); else app.valores[v.path] = v.value } }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = () => {}
  return app
}
const rotas = (p) => { const r = { get: {}, post: {} }; p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } }); return r }
const chamar = (h, body, query = {}) => new Promise((resolve) => { const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }; h({ body, query }, res) })
function enviar (app, fonte, { tws = 6, proa = 0.5, stw = 2.5 } = {}) {
  app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: fonte, timestamp: new Date().toISOString(), values: [
    { path: 'navigation.position', value: { latitude: 39.0, longitude: -9.6 } },
    { path: 'navigation.headingTrue', value: proa },
    { path: 'navigation.speedThroughWater', value: stw },
    { path: 'navigation.speedOverGround', value: stw },
    { path: 'environment.wind.speedTrue', value: tws }
  ] }] })
}
function correr (t, app, n, fonte, opc) { for (let i = 0; i < n; i++) { enviar(app, fonte, opc); t.mock.timers.tick(1000) } }
const csv = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => l.split(','))
const ndjson = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean)

test('grava o bruto e a tabela; dados do simulador ficam marcados e nunca estáveis', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'arlequin-simulador')
  p.stop()
  const base = path.join(app.dir, 'dados')
  for (const d of ['bruto', 'tabela', 'saidas', 'previsoes', 'entrada']) assert.ok(fs.existsSync(path.join(base, d)), `falta ${d}/`)
  assert.ok(ndjson(path.join(base, 'bruto', '2026-09-29T14.ndjson.gz')).length >= 130)
  const linhas = csv(path.join(base, 'tabela', '2026-09-29.csv.gz'))
  const cab = linhas[0]
  assert.equal(linhas.length, 1 + 13)
  for (const l of linhas.slice(1)) {
    assert.equal(l[cab.indexOf('simulado')], '1')
    assert.equal(l[cab.indexOf('estavel')], '0')
  }
})

test('dados reais firmes ao largo: a linha fica estável depois de 2 min', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP')
  p.stop()
  const linhas = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz'))
  const i = linhas[0].indexOf('estavel')
  assert.equal(linhas[1][i], '0', 'aos 10 s ainda não')
  assert.equal(linhas[linhas.length - 1][i], '1', 'aos 130 s sim')
  assert.equal(linhas[linhas.length - 1][linhas[0].indexOf('tws')], (6 / NO).toFixed(2))
})

test('velas: POST muda, publica e sobrevive a um reinício; inválido dá 400', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(app.valores['sails.grande.rizos'], 0)
  const r = rotas(p)
  const ok = await chamar(r.post['/velas'], { grandeRizos: 1, genoaPct: '70' })
  assert.equal(ok.ok, true)
  assert.equal(app.valores['sails.grande.rizos'], 1)
  assert.equal(app.valores['sails.genoa.percentagem'], 70)
  const mau = await chamar(r.post['/velas'], { grandeRizos: 3 })
  assert.equal(mau.code, 400)
  assert.match(mau.erro, /rizos/)
  p.stop()
  const app2 = appFalso(app.dir)
  const p2 = criar(app2)
  p2.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(app2.valores['sails.grande.rizos'], 1)
  assert.equal(app2.valores['sails.genoa.percentagem'], 70)
  const est = await chamar(rotas(p2).get['/estado'], {})
  assert.deepEqual(est.velas, { grandeRizos: 1, genoaPct: 70 })
  assert.ok(path.isAbsolute(est.pasta), 'pasta deve ser absoluta')
  p2.stop()
})

test('a tabela mostra as velas guardadas no plugin, que não caducam aos 15 s como um sensor', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  await chamar(rotas(p).post['/velas'], { grandeRizos: 1, genoaPct: 70 })
  correr(t, app, 60, 'nmea0183.GP')
  p.stop()
  const linhas = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz'))
  const cab = linhas[0]
  const ultima = linhas[linhas.length - 1]
  assert.equal(ultima[cab.indexOf('grandeRizos')], '1')
  assert.equal(ultima[cab.indexOf('genoaPct')], '70')
})

test('lembrete das velas quando o vento sobe 60% durante mais de 1 h', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP', { tws: 5 })
  await chamar(rotas(p).post['/velas'], { grandeRizos: 0 })
  correr(t, app, 3700, 'nmea0183.GP', { tws: 8 })
  p.stop()
  const lembrete = app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.velas' && n.state === 'warn')
  assert.equal(lembrete.length, 1)
  assert.match(lembrete[0].message, /As velas continuam assim\? Grande inteira, genoa 100%/)
  assert.deepEqual(lembrete[0].method, ['visual'])
})

test('depois da troca do simulador para dados reais, a estabilidade não volta logo (janela de 2 min + 15 s)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'arlequin-simulador')
  correr(t, app, 20, 'nmea0183.GP')
  const f = path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz')
  let linhas = csv(f)
  const cab = linhas[0]
  for (const l of linhas.slice(1)) assert.equal(l[cab.indexOf('estavel')], '0', 'ainda dentro da janela alargada de simulado')
  correr(t, app, 130, 'nmea0183.GP')
  p.stop()
  linhas = csv(f)
  assert.equal(linhas[linhas.length - 1][cab.indexOf('estavel')], '1', 'depois de sobra, já estável')
})

test('erros no ciclo de 1 s (ex.: pasta bruto apagada) não derrubam o servidor; a tabela continua a ser escrita', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 20, 'nmea0183.GP')
  const base = path.join(app.dir, 'dados')
  const linhasAntes = csv(path.join(base, 'tabela', '2026-09-29.csv.gz')).length
  fs.rmSync(path.join(base, 'bruto'), { recursive: true, force: true })
  assert.doesNotThrow(() => correr(t, app, 70, 'nmea0183.GP'))
  const linhasDepois = csv(path.join(base, 'tabela', '2026-09-29.csv.gz')).length
  assert.ok(linhasDepois > linhasAntes, 'a tabela continuou a crescer apesar dos erros do bruto')
  const est = await chamar(rotas(p).get['/estado'], {})
  assert.ok(est.erros > 0, 'os erros do ciclo ficaram contados')
  p.stop()
})

test('lembrete das velas: genoa enrolada aparece como "enrolada", não "0%"', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP', { tws: 5 })
  await chamar(rotas(p).post['/velas'], { genoaPct: 0 })
  correr(t, app, 3700, 'nmea0183.GP', { tws: 8 })
  p.stop()
  const lembrete = app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.velas' && n.state === 'warn')
  assert.equal(lembrete.length, 1)
  assert.match(lembrete[0].message, /genoa enrolada/)
  assert.doesNotMatch(lembrete[0].message, /genoa 0%/)
})

test('disco: entre 90% e 95% o bruto continua parado; só resume abaixo de 90%', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 60, 'nmea0183.GP')
  assert.match(app.estado, /BRUTO PARADO/, '96% parou')
  const f = path.join(app.dir, 'dados', 'bruto', '2026-09-29T14.ndjson.gz')
  const antes = fs.statSync(f).size
  usoFalso = 92
  correr(t, app, 60, 'nmea0183.GP')
  assert.equal(fs.statSync(f).size, antes, 'a 92% continua parado, tamanho não muda')
  assert.match(app.estado, /BRUTO PARADO/, 'a 92% continua parado no estado')
  usoFalso = 89
  correr(t, app, 70, 'nmea0183.GP')
  assert.ok(fs.statSync(f).size > antes, 'a 89% retomou e o ficheiro cresceu')
  assert.doesNotMatch(app.estado, /BRUTO PARADO/, 'a 89% já não está parado')
  p.stop()
})

test('disco a 96% sem nada confirmado: pára o bruto e dá alarme; a 50% retoma', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 60, 'nmea0183.GP')
  const alarme = app.notificacoes.find(n => n.path === 'notifications.arlequin.caixanegra.disco' && n.state === 'alarm')
  assert.ok(alarme, 'alarme do disco')
  assert.deepEqual(alarme.method, ['visual', 'sound'])
  assert.match(app.estado, /BRUTO PARADO/)
  const f = path.join(app.dir, 'dados', 'bruto', '2026-09-29T14.ndjson.gz')
  const antes = fs.statSync(f).size
  correr(t, app, 30, 'nmea0183.GP')
  assert.equal(fs.statSync(f).size, antes, 'parado não grava')
  const linhasTabela = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz')).length
  assert.equal(linhasTabela, 1 + 9, 'a tabela continua')
  usoFalso = 50
  correr(t, app, 60, 'nmea0183.GP')
  assert.ok(fs.statSync(f).size > antes, 'retomou')
  assert.equal(app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco').pop().state, 'normal')
  p.stop()
})
