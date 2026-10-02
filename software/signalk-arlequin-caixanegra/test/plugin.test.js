'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { EventEmitter } = require('node:events')
const disco = require('../lib/disco')
const confirmados = require('../lib/confirmados')
const criar = require('..')

const NO = 1852 / 3600
const EU = 'vessels.urn:mrn:signalk:uuid:arlequin'
const INICIO = Date.UTC(2026, 8, 29, 14, 0, 0)
let usoFalso = 50
let totalFalso = 256e9
disco.usoDisco = () => ({ total: totalFalso, livre: totalFalso * (1 - usoFalso / 100), usadoPct: usoFalso })

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

// As bússolas do barco (ST4000+, ST50) dão a proa magnética: sem headingTrue no SignalK.
function enviarMagnetica (app, { proaMag = 0.5, declinacao = -2 * Math.PI / 180 } = {}) {
  const values = [
    { path: 'navigation.position', value: { latitude: 39.0, longitude: -9.6 } },
    { path: 'navigation.headingMagnetic', value: proaMag },
    { path: 'navigation.speedThroughWater', value: 2.5 },
    { path: 'navigation.speedOverGround', value: 2.5 },
    { path: 'environment.wind.speedTrue', value: 6 }
  ]
  if (declinacao !== null) values.push({ path: 'navigation.magneticVariation', value: declinacao }) // null: o barco não a publica
  app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: 'nmea0183.II', timestamp: new Date().toISOString(), values }] })
}

test('só com a proa magnética: a proa verdadeira é a magnética + a declinação; a linha fica estável e a coluna proa preenchida (auditoria I-11)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  for (let i = 0; i < 130; i++) { enviarMagnetica(app); t.mock.timers.tick(1000) }
  p.stop()
  const linhas = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz'))
  const cab = linhas[0]
  const ultima = linhas[linhas.length - 1]
  assert.equal(ultima[cab.indexOf('estavel')], '1', 'aos 130 s, com a proa firme, a linha é estável (a AI pode aprender)')
  assert.equal(ultima[cab.indexOf('proa')], ((0.5 * 180 / Math.PI) - 2).toFixed(1), 'proa verdadeira = magnética + declinação (−2°)')
})

test('só com a proa magnética e sem declinação: não se inventa a verdadeira (coluna vazia, nunca estável)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  for (let i = 0; i < 130; i++) { enviarMagnetica(app, { declinacao: null }); t.mock.timers.tick(1000) }
  p.stop()
  const linhas = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz'))
  const cab = linhas[0]
  for (const l of linhas.slice(1)) {
    assert.equal(l[cab.indexOf('proa')], '')
    assert.equal(l[cab.indexOf('estavel')], '0')
  }
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

test('disco a 95%: o alarme pede o apito curto (o contínuo fica para o perigo imediato: decisão n.º 2, contrato C1; auditoria I-07)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 60, 'nmea0183.GP')
  usoFalso = 85 // a 85% (sem nada confirmado para apagar) passa a aviso, só visual
  correr(t, app, 60, 'nmea0183.GP')
  const disco = app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco')
  assert.deepEqual(disco.map(n => [n.state, n.apito]), [['alarm', 'curto'], ['warn', undefined]])
  assert.deepEqual(disco[0].method, ['visual', 'sound'])
  assert.deepEqual(disco[1].method, ['visual'])
  p.stop()
})

test('disco a 81% com bruto confirmado: apaga e não avisa (o aviso aos 80% não pode ir e vir)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 81
  totalFalso = 1000 // cada ficheiro de 100 bytes vale 10%
  t.after(() => { totalFalso = 256e9 })
  const app = appFalso()
  const base = path.join(app.dir, 'dados')
  fs.mkdirSync(path.join(base, 'bruto'), { recursive: true })
  const antigo = path.join(base, 'bruto', '2026-09-28T10.ndjson.gz')
  fs.writeFileSync(antigo, 'x'.repeat(100))
  fs.writeFileSync(path.join(base, 'confirmados.json'), JSON.stringify({ 'bruto/2026-09-28T10.ndjson.gz': confirmados.sha256Ficheiro(antigo) }))
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 60, 'nmea0183.GP')
  p.stop()
  assert.equal(fs.existsSync(antigo), false, 'o confirmado foi apagado')
  assert.deepEqual(app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco'), [], 'sem aviso: depois de apagar fica abaixo dos 80%')
})

test('disco a 96% com um confirmado que mudou depois de confirmado: não conta como espaço a libertar → pára o bruto e dá alarme', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  totalFalso = 1000 // o ficheiro de 100 bytes vale 10%: se contasse, 96 → 86 e o alarme ficava escondido
  t.after(() => { totalFalso = 256e9 })
  const app = appFalso()
  const base = path.join(app.dir, 'dados')
  fs.mkdirSync(path.join(base, 'bruto'), { recursive: true })
  const antigo = path.join(base, 'bruto', '2026-09-28T10.ndjson.gz')
  fs.writeFileSync(antigo, 'x'.repeat(100))
  fs.writeFileSync(path.join(base, 'confirmados.json'), JSON.stringify({ 'bruto/2026-09-28T10.ndjson.gz': confirmados.sha256Ficheiro(antigo) }))
  fs.appendFileSync(antigo, 'mudou') // depois de confirmado: já não bate certo, nunca se apaga
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 60, 'nmea0183.GP')
  assert.match(app.estado, /BRUTO PARADO/, 'logo no primeiro minuto')
  const alarme = app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco')
  assert.deepEqual(alarme.map(n => n.state), ['alarm'])
  correr(t, app, 120, 'nmea0183.GP')
  assert.match(app.estado, /BRUTO PARADO/, 'e continua nos minutos seguintes (não volta a contar como libertado)')
  assert.equal(app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco').length, 1)
  p.stop() // (o stop limpa o alarme: auditoria I-21)
  assert.equal(fs.existsSync(antigo), true, 'não se apaga')
  assert.deepEqual(Object.keys(confirmados.lerConfirmados(base)), ['bruto/2026-09-28T10.ndjson.gz'], 'nem sai do confirmados.json')
})

test('disco a 81% com um confirmado que mudou: o aviso dos 80% não fica escondido', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 81
  totalFalso = 1000
  t.after(() => { totalFalso = 256e9 })
  const app = appFalso()
  const base = path.join(app.dir, 'dados')
  fs.mkdirSync(path.join(base, 'bruto'), { recursive: true })
  const antigo = path.join(base, 'bruto', '2026-09-28T10.ndjson.gz')
  fs.writeFileSync(antigo, 'x'.repeat(100))
  fs.writeFileSync(path.join(base, 'confirmados.json'), JSON.stringify({ 'bruto/2026-09-28T10.ndjson.gz': confirmados.sha256Ficheiro(antigo) }))
  fs.appendFileSync(antigo, 'mudou')
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 180, 'nmea0183.GP')
  assert.deepEqual(app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco').map(n => n.state), ['warn'])
  p.stop() // (o stop limpa o aviso: auditoria I-21)
})

test('um só orçamento de sha256 por minuto: o apagar recebe o que a entrada já gastou', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 81
  totalFalso = 1000
  const chamadas = []
  const { processarEntrada, apagarConfirmados } = confirmados
  confirmados.processarEntrada = (b, op) => { const r = processarEntrada(b, op); chamadas.push(['entrada', op.orcamentoBytes, op.gastos, r.bytes]); return r }
  confirmados.apagarConfirmados = (b, f, op) => { chamadas.push(['apagar', op.orcamentoBytes, op.gastos]); return apagarConfirmados(b, f, op) }
  t.after(() => { totalFalso = 256e9; Object.assign(confirmados, { processarEntrada, apagarConfirmados }) })
  const app = appFalso()
  const base = path.join(app.dir, 'dados')
  fs.mkdirSync(path.join(base, 'bruto'), { recursive: true })
  fs.mkdirSync(path.join(base, 'entrada'), { recursive: true })
  const antigo = path.join(base, 'bruto', '2026-09-28T10.ndjson.gz')
  fs.writeFileSync(antigo, 'x'.repeat(100))
  fs.writeFileSync(path.join(base, 'entrada', 'confirmados-1.json'), JSON.stringify([{ ficheiro: 'bruto/2026-09-28T10.ndjson.gz', sha256: confirmados.sha256Ficheiro(antigo) }]))
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 60, 'nmea0183.GP')
  p.stop()
  assert.deepEqual(chamadas, [['entrada', 150e6, undefined, 100], ['apagar', 150e6, 100]])
  assert.equal(fs.existsSync(antigo), false)
})

test('confirmados.json estragado no Pi: conta como erro (vê-se no /estado) e o resto continua', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const mensagens = []
  app.error = (m) => mensagens.push(m)
  const base = path.join(app.dir, 'dados')
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(base, 'confirmados.json'), '{isto não é json')
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 60, 'nmea0183.GP')
  const est = await chamar(rotas(p).get['/estado'], {})
  p.stop()
  assert.ok(est.erros > 0, 'erro contado')
  assert.ok(mensagens.some(m => /confirmados\.json/.test(m)), mensagens.join(' | '))
  assert.ok(csv(path.join(base, 'tabela', '2026-09-29.csv.gz')).length > 1, 'a tabela continua')
})

test('uma mensagem que não se consegue gravar (BigInt) não rebenta o SignalK; conta o erro e só avisa 1 vez por minuto', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const mensagens = []
  app.error = (m) => mensagens.push(m)
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const mau = { context: EU, updates: [{ $source: 'x', values: [{ path: 'propulsion.main.contador', value: 10n }] }] }
  assert.doesNotThrow(() => app.signalk.emit('unfilteredDelta', mau))
  assert.doesNotThrow(() => app.signalk.emit('unfilteredDelta', mau))
  const est = await chamar(rotas(p).get['/estado'], {})
  assert.equal(est.erros, 2)
  assert.equal(mensagens.filter(m => /mensagem/.test(m)).length, 1, 'no mesmo minuto só se regista uma vez')
  correr(t, app, 61, 'nmea0183.GP')
  app.signalk.emit('unfilteredDelta', mau)
  assert.equal(mensagens.filter(m => /mensagem/.test(m)).length, 2, 'passado 1 min volta a registar')
  p.stop()
})

test('depois de um corte de energia: um .gz com o último bloco cortado fica de lado e o novo começa limpo', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const base = path.join(app.dir, 'dados')
  for (const d of ['bruto', 'tabela']) fs.mkdirSync(path.join(base, d), { recursive: true })
  const cortado = (texto) => { const g = zlib.gzipSync(texto); return g.subarray(0, g.length - 7) }
  const fBruto = path.join(base, 'bruto', '2026-09-29T14.ndjson.gz')
  const fTabela = path.join(base, 'tabela', '2026-09-29.csv.gz')
  fs.writeFileSync(fBruto, Buffer.concat([zlib.gzipSync('{"antes":1}\n'), cortado('{"antes":2}\n'.repeat(50))]))
  fs.writeFileSync(fTabela, Buffer.concat([zlib.gzipSync('t,lat\n'), cortado('x,y\n'.repeat(50))]))
  const bom = path.join(base, 'bruto', '2026-09-29T13.ndjson.gz') // hora anterior, inteira: não se mexe
  fs.writeFileSync(bom, zlib.gzipSync('{"ok":1}\n'))
  const p = criar(app)
  p.start({ pasta: base })
  correr(t, app, 20, 'nmea0183.GP')
  p.stop()
  assert.ok(fs.existsSync(path.join(base, 'bruto', '2026-09-29T14.ndjson.gz.danificado-2026-09-29T14-00-00Z')), fs.readdirSync(path.join(base, 'bruto')).join(', '))
  assert.ok(fs.existsSync(path.join(base, 'tabela', '2026-09-29.csv.gz.danificado-2026-09-29T14-00-00Z')), fs.readdirSync(path.join(base, 'tabela')).join(', '))
  assert.ok(ndjson(fBruto).length >= 20, 'o bruto novo lê-se inteiro')
  const linhas = csv(fTabela)
  assert.equal(linhas[0][0], 't', 'a tabela nova começa com o cabeçalho')
  assert.equal(linhas.length, 1 + 2)
  assert.ok(fs.existsSync(bom))
})

test('com a segurança do SignalK (2.33: router.access), os GET registam-se "readonly" e o POST "readwrite"; nada fica só para admin (auditoria K-11)', () => {
  const registos = []
  const direto = []
  const router = {
    get: (k) => direto.push(`GET ${k}`),
    post: (k) => direto.push(`POST ${k}`),
    access: (nivel) => ({
      get: (k, h) => { registos.push({ m: 'GET', k, nivel, h: typeof h }) },
      post: (k, h) => { registos.push({ m: 'POST', k, nivel, h: typeof h }) }
    })
  }
  criar(appFalso()).registerWithRouter(router)
  assert.deepEqual(direto, [], 'nenhuma rota sem nível (ficava só para admin: o ecrã entra com "read/write")')
  const nivel = Object.fromEntries(registos.map(x => [`${x.m} ${x.k}`, x.nivel]))
  assert.deepEqual(nivel, {
    'GET /estado': 'readonly',
    'GET /ficheiros': 'readonly',
    'GET /velas': 'readonly',
    'POST /velas': 'readwrite'
  })
  assert.ok(registos.every(x => x.h === 'function'))
})

test('relógio do Pi: com a hora do GPS a mais de 60 s avisa uma vez (só no ecrã); abaixo dos 30 s limpa', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const comGps = (n, desvioMs) => {
    for (let i = 0; i < n; i++) {
      app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: 'nmea0183.GP', values: [{ path: 'navigation.datetime', value: new Date(Date.now() + desvioMs).toISOString() }] }] })
      t.mock.timers.tick(1000)
    }
  }
  const relogio = () => app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.relogio')
  comGps(30, 45000) // 45 s: ainda tolerável
  assert.deepEqual(relogio(), [])
  comGps(30, -5 * 60000) // o GPS diz 5 min antes: o Pi está adiantado
  assert.equal(relogio().length, 1)
  assert.equal(relogio()[0].state, 'warn')
  assert.deepEqual(relogio()[0].method, ['visual'])
  assert.equal(relogio()[0].message, 'Relógio do Pi desacertado 5 min — os dados ficam com a hora errada')
  comGps(30, 40000) // 40 s: melhor, mas ainda não dentro dos 30 s
  assert.equal(relogio().length, 1)
  comGps(30, 2000)
  assert.equal(relogio().length, 2)
  assert.equal(relogio()[1].state, 'normal')
  comGps(30, 2000)
  assert.equal(relogio().length, 2, 'não repete')
  p.stop()
})

// Uma mensagem com a hora do GPS (navigation.datetime) desviada de `desvioMs` da hora do Pi, a cada segundo.
function comGps (t, app, n, desvioMs) {
  for (let i = 0; i < n; i++) {
    app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: 'nmea0183.GP', values: [{ path: 'navigation.datetime', value: new Date(Date.now() + desvioMs).toISOString() }] }] })
    t.mock.timers.tick(1000)
  }
}
const daCaixa = (app, id) => app.notificacoes.filter(n => n.path === `notifications.arlequin.caixanegra.${id}`)

test('parar o plugin com avisos ativos publica "normal" para cada um: parado já não vigia e ficavam presos no ecrã (auditoria I-21)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  comGps(t, app, 60, -5 * 60000) // disco a 96% (alarme) e o relógio do Pi 5 min adiantado (aviso)
  assert.deepEqual(daCaixa(app, 'disco').map(n => n.state), ['alarm'])
  assert.deepEqual(daCaixa(app, 'relogio').map(n => n.state), ['warn'])
  p.stop()
  assert.deepEqual(daCaixa(app, 'disco').map(n => n.state), ['alarm', 'normal'])
  assert.deepEqual(daCaixa(app, 'relogio').map(n => n.state), ['warn', 'normal'])
  assert.deepEqual(daCaixa(app, 'velas'), [], 'o que não estava ativo não se publica')
  p.stop()
  assert.equal(app.notificacoes.length, 4, 'um segundo stop não repete nada')
})

test('parar o plugin com o lembrete das velas ativo também o limpa (auditoria I-21)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP', { tws: 5 })
  await chamar(rotas(p).post['/velas'], { grandeRizos: 0 })
  correr(t, app, 3700, 'nmea0183.GP', { tws: 8 })
  assert.equal(daCaixa(app, 'velas').at(-1).state, 'warn')
  p.stop()
  assert.equal(daCaixa(app, 'velas').at(-1).state, 'normal')
})

// A árvore do SignalK como o servidor a guarda: { value: { state, method, message }, $source, timestamp }.
function arvoreCom (app, avisos) {
  const arvore = {}
  for (const [id, state] of Object.entries(avisos)) {
    arvore[`notifications.arlequin.caixanegra.${id}`] = { value: { state, method: ['visual'], message: `aviso antigo (${id})` }, $source: 'signalk-arlequin-caixanegra' }
  }
  app.getSelfPath = (p) => arvore[p]
}

test('ao arrancar, os avisos que um arranque anterior deixou na árvore retomam-se: limpam-se quando a condição já passou (auditoria I-21)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  arvoreCom(app, { disco: 'alarm', relogio: 'warn' })
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  comGps(t, app, 60, 2000) // disco a 50% e o relógio certo
  p.stop()
  assert.deepEqual(daCaixa(app, 'disco').map(n => n.state), ['normal'], 'o "Resolvido" do disco sai')
  assert.deepEqual(daCaixa(app, 'relogio').map(n => n.state), ['normal'], 'e o do relógio')
})

test('ao arrancar com o alarme do disco na árvore e o disco ainda cheio: não se repete o alarme e o bruto continua parado (auditoria I-21)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  arvoreCom(app, { disco: 'alarm' })
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 120, 'nmea0183.GP')
  assert.deepEqual(daCaixa(app, 'disco'), [], 'o alarme que já estava na árvore não sai outra vez')
  assert.match(app.estado, /BRUTO PARADO/)
  usoFalso = 50
  correr(t, app, 60, 'nmea0183.GP')
  assert.deepEqual(daCaixa(app, 'disco').map(n => n.state), ['normal'], 'quando o disco esvazia, limpa-se')
  p.stop()
})

test('o estado do plugin dá a hora de Lisboa, seja qual for o fuso do Pi (decisão n.º 22; auditoria I-31)', (t) => {
  const tz = process.env.TZ
  process.env.TZ = 'Asia/Tokyo' // um Pi com outro fuso (em UTC seria igual de errado no verão)
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 60, 'nmea0183.GP') // a última linha é às 14:01:00 UTC = 15:01:00 em Lisboa (verão)
  p.stop()
  assert.match(app.estado, /última linha 15:01:00/, app.estado)
})

// Uma mensagem do GPS numa posição, com a velocidade em nós.
function enviarEm (app, lat, lon, nos) {
  app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: 'nmea0183.GP', timestamp: new Date().toISOString(), values: [
    { path: 'navigation.position', value: { latitude: lat, longitude: lon } },
    { path: 'navigation.speedOverGround', value: nos * NO }
  ] }] })
}
const ficarEm = (t, app, segundos, lat, lon, nos) => { for (let i = 0; i < segundos; i++) { enviarEm(app, lat, lon, nos); t.mock.timers.tick(1000) } }
const PENICHE = [39.3522, -9.376]
const FIGUEIRA = [40.1468, -8.8625] // o cais da Figueira da Foz em rota/dados/destinos.json

test('uma viagem Peniche → Figueira da Foz fecha a saída ao chegar (a Figueira é destino da rota; a caixa negra só conhecia 7 portos: auditoria I-33)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  const base = path.join(app.dir, 'dados')
  p.start({ pasta: base })
  ficarEm(t, app, 30, ...PENICHE, 0) // no porto
  ficarEm(t, app, 60, PENICHE[0] - 0.05, PENICHE[1] - 0.05, 5) // saiu: a 3 MN de Peniche
  ficarEm(t, app, 700, ...FIGUEIRA, 0) // chegou e ficou parado mais de 10 min
  p.stop()
  const saidas = fs.readdirSync(path.join(base, 'saidas'))
  assert.equal(saidas.length, 1, 'a saída fechou e ficou gravada (é o que dispara o treino da AI)')
  const s = JSON.parse(fs.readFileSync(path.join(base, 'saidas', saidas[0]), 'utf8'))
  assert.equal(s.de, 'Peniche')
  assert.equal(s.para, 'Figueira da Foz')
})

test('o /estado diz os portos que a caixa negra conhece; uma configuração antiga com a lista dos 7 portos junta-se aos da rota sem repetidos (auditoria I-33)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  const ANTIGOS = [
    { nome: 'Peniche', lat: 39.3530, lon: -9.3770 }, { nome: 'Algés (CNA)', lat: 38.6955, lon: -9.2330 },
    { nome: 'Oeiras', lat: 38.6780, lon: -9.3160 }, { nome: 'Cascais', lat: 38.6925, lon: -9.4175 },
    { nome: 'Ericeira', lat: 38.9630, lon: -9.4180 }, { nome: 'Nazaré', lat: 39.5845, lon: -9.0735 },
    { nome: 'Sesimbra', lat: 38.4410, lon: -9.1060 }
  ]
  for (const portos of [undefined, ANTIGOS]) {
    const app = appFalso()
    const p = criar(app)
    p.start({ pasta: path.join(app.dir, 'dados'), ...(portos ? { portos } : {}) })
    const est = await chamar(rotas(p).get['/estado'], {})
    p.stop()
    assert.equal(est.portos.length, 16, JSON.stringify(est.portos))
    assert.ok(est.portos.includes('Figueira da Foz') && est.portos.includes('Ericeira'))
    assert.equal(new Set(est.portos).size, 16)
  }
})

test('sem o ficheiro dos destinos da rota: diz porquê (erro e estado do plugin) e continua com os portos extra (auditoria I-33)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const mensagens = []
  app.error = (m) => mensagens.push(m)
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados'), destinos: path.join(app.dir, 'nao-existe.json') })
  correr(t, app, 60, 'nmea0183.GP')
  const est = await chamar(rotas(p).get['/estado'], {})
  p.stop()
  assert.deepEqual(est.portos, ['Ericeira'])
  assert.ok(est.erros > 0)
  assert.ok(mensagens.some(m => /destinos da rota/.test(m) && /nao-existe\.json/.test(m)), mensagens.join(' | '))
  assert.match(app.estado, /^SEM OS PORTOS DA ROTA · /)
})

test('velas.json, saida-em-curso.json e saidas/: escritos com fsync antes de mudar o nome (um corte de energia não os deixa vazios; auditoria M-55)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const original = fs.fsyncSync
  let chamadas = 0
  fs.fsyncSync = (fd) => { chamadas++; return original(fd) }
  t.after(() => { fs.fsyncSync = original })
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  await chamar(rotas(p).post['/velas'], { grandeRizos: 1 })
  assert.equal(chamadas, 1, 'o velas.json')
  correr(t, app, 60, 'nmea0183.GP')
  assert.equal(chamadas, 2, 'o saida-em-curso.json de minuto a minuto')
  p.stop()
  const dir = app.getDataDirPath()
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'sem .tmp esquecidos')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'velas.json'), 'utf8')).grandeRizos, 1)
})

test('um saida-em-curso.json ou velas.json ilegível ao arrancar: avisa, conta o erro e guarda-o à parte em vez de o perder calado (auditoria M-55)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const mensagens = []
  app.error = (m) => mensagens.push(m)
  const dir = app.getDataDirPath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'saida-em-curso.json'), '{"emCurso": {"inicio": 17')
  fs.writeFileSync(path.join(dir, 'velas.json'), '"inteira"') // JSON, mas não é o estado das velas
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const est = await chamar(rotas(p).get['/estado'], {})
  p.stop()
  assert.ok(est.erros >= 2, `erros: ${est.erros}`)
  assert.ok(mensagens.some(m => /saida-em-curso\.json/.test(m) && /ilegível/.test(m)), mensagens.join(' | '))
  assert.ok(mensagens.some(m => /velas\.json/.test(m) && /ilegível/.test(m)), mensagens.join(' | '))
  assert.deepEqual(est.velas, { grandeRizos: 0, genoaPct: 100 }, 'recomeça com as velas por omissão')
  const guardados = fs.readdirSync(dir).filter(n => /\.ilegivel-/.test(n)).sort()
  assert.equal(guardados.length, 2, fs.readdirSync(dir).join(', '))
  assert.equal(fs.readFileSync(path.join(dir, guardados.find(n => n.startsWith('saida-em-curso'))), 'utf8'), '{"emCurso": {"inicio": 17')
})
