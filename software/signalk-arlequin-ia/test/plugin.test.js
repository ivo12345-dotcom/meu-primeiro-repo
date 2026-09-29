'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const criar = require('..')

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'velocidade.json.gz'))))
const VENTO = { hourly: { time: ['2026-09-29T14:00'], wind_speed_10m: [12], wind_gusts_10m: [16], wind_direction_10m: [350] } }
const js = (codigo) => [process.execPath, '-e', codigo]
const UMA_LINHA = js('console.log(JSON.stringify({modelo:"velocidade",aceite:true,versao:"v0001"}))')

function appFalso () {
  const app = { self: {}, estado: '', erros: [] }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ia-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p] } : undefined)
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => { app.erros.push(e) }
  return app
}
const rotas = (p) => { const r = { get: {}, post: {} }; p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } }); return r }
const chamar = (h, body) => new Promise((resolve) => { const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }; h({ body }, res) })
const minutos = (t, n) => { for (let i = 0; i < n * 60; i++) t.mock.timers.tick(1000) }
// Espera (em tempo real: o relógio falso só mexe no setInterval e no Date) até a condição se cumprir.
async function esperar (cond) {
  for (let i = 0; i < 500; i++) {
    if (await cond()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('esperei demasiado')
}

test('arquiva a previsão para a posição do barco e só volta a pedir 3 h depois (parado)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() })
  const app = appFalso()
  let pedidos = 0
  const p = criar(app, { fetch: async (u) => { pedidos++; return { ok: true, json: async () => (u.includes('marine') ? { hourly: { time: [] } } : VENTO) } }, comando: UMA_LINHA, nice: false })
  p.start({ pasta: path.join(app.dir, 'dados'), treinoAutomatico: false })
  app.self['navigation.position'] = { latitude: 39.1, longitude: -9.6 }
  minutos(t, 1)
  await esperar(() => fs.existsSync(path.join(app.dir, 'dados', 'previsoes')) && fs.readdirSync(path.join(app.dir, 'dados', 'previsoes')).length === 1)
  assert.equal(pedidos, 2) // vento + mar
  minutos(t, 30)
  assert.equal(pedidos, 2)
  const ia = await chamar(rotas(p).get['/ia'])
  assert.ok(ia.previsao.okEm)
  assert.equal(ia.previsao.erro, null)
  p.stop()
})

test('sem rede: guarda o erro e tenta 10 min depois', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() })
  const app = appFalso()
  let pedidos = 0
  const p = criar(app, { fetch: async () => { pedidos++; throw new Error('sem rede') }, comando: UMA_LINHA, nice: false })
  p.start({ pasta: path.join(app.dir, 'dados'), treinoAutomatico: false })
  app.self['navigation.position'] = { latitude: 39.1, longitude: -9.6 }
  minutos(t, 1)
  await esperar(async () => (await chamar(rotas(p).get['/ia'])).previsao.erro === 'sem rede')
  assert.equal(pedidos, 1)
  minutos(t, 9)
  assert.equal(pedidos, 1)
  minutos(t, 1)
  await esperar(() => pedidos === 2)
  p.stop()
})

test('treina sozinho parado há 1 h depois de uma saída, e não repete sem saída nova', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() })
  const app = appFalso()
  const p = criar(app, { fetch: async () => { throw new Error('offline') }, comando: UMA_LINHA, nice: false })
  fs.mkdirSync(path.join(app.dir, 'dados', 'saidas'), { recursive: true })
  fs.writeFileSync(path.join(app.dir, 'dados', 'saidas', '2026-09-29T10-00.json'), '{}')
  p.start({ pasta: path.join(app.dir, 'dados') })
  app.self['navigation.speedOverGround'] = 0.1
  minutos(t, 59)
  assert.equal((await chamar(rotas(p).get['/ia'])).ultimoTreino, null)
  minutos(t, 2)
  await esperar(async () => (await chamar(rotas(p).get['/ia'])).ultimoTreino)
  const ia = await chamar(rotas(p).get['/ia'])
  assert.equal(ia.ultimoTreino.resultados[0].modelo, 'velocidade')
  assert.match(ia.ultimoTreino.motivo, /automático/)
  const antes = ia.ultimoTreino.em
  minutos(t, 120)
  await new Promise(r => setTimeout(r, 50))
  assert.equal((await chamar(rotas(p).get['/ia'])).ultimoTreino.em, antes, 'sem saída nova não volta a treinar')
  p.stop()
})

test('"Treinar agora": 202, e 409 enquanto está a treinar; o erro do Python fica visível', async () => {
  const app = appFalso()
  const lento = js('setTimeout(()=>{console.log(JSON.stringify({modelo:"consumo",aceite:false}))},300)')
  const p = criar(app, { fetch: async () => { throw new Error('x') }, comando: lento, nice: false })
  p.start({ pasta: path.join(app.dir, 'dados'), treinoAutomatico: false })
  const r = rotas(p)
  assert.equal((await chamar(r.post['/treinar'], {})).code, 202)
  assert.equal((await chamar(r.post['/treinar'], {})).code, 409)
  assert.equal((await chamar(r.get['/ia'])).emTreino, true)
  await esperar(async () => (await chamar(r.get['/ia'])).ultimoTreino)
  assert.equal((await chamar(r.get['/ia'])).ultimoTreino.resultados[0].modelo, 'consumo')
  p.stop()
  const app2 = appFalso()
  const p2 = criar(app2, { comando: js('console.error("sem lightgbm");process.exit(1)'), nice: false })
  p2.start({ pasta: path.join(app2.dir, 'dados'), treinoAutomatico: false })
  await chamar(rotas(p2).post['/treinar'], {})
  await esperar(async () => (await chamar(rotas(p2).get['/ia'])).ultimoTreino)
  assert.match((await chamar(rotas(p2).get['/ia'])).ultimoTreino.erro, /sem lightgbm/)
  p2.stop()
})

test('/ia mostra o modelo em uso; "voltar atrás" repõe a versão anterior que esteve em uso', async () => {
  const app = appFalso()
  const pv = path.join(app.dir, 'dados', 'modelos', 'velocidade')
  fs.mkdirSync(pv, { recursive: true })
  fs.writeFileSync(path.join(pv, 'v0001.json.gz'), zlib.gzipSync(JSON.stringify({ ...fixture.modelo, versao: 'v0001', aceite: true })))
  fs.writeFileSync(path.join(pv, 'v0002.json.gz'), zlib.gzipSync(JSON.stringify({ ...fixture.modelo, versao: 'v0002', aceite: false })))
  fs.writeFileSync(path.join(pv, 'v0003.json.gz'), zlib.gzipSync(JSON.stringify({ ...fixture.modelo, versao: 'v0003', aceite: true, frases: ['a 60° com 12 nós andas 5,6 nós (a polar dizia 6,2)'] })))
  fs.writeFileSync(path.join(pv, 'atual'), 'v0003')
  const p = criar(app, { comando: UMA_LINHA, nice: false })
  p.start({ pasta: path.join(app.dir, 'dados'), treinoAutomatico: false })
  const r = rotas(p)
  const ia = await chamar(r.get['/ia'])
  assert.equal(ia.modelos.velocidade.versao, 'v0003')
  assert.deepEqual(ia.modelos.velocidade.versoes, ['v0001', 'v0002', 'v0003'])
  assert.deepEqual(ia.modelos.velocidade.frases, ['a 60° com 12 nós andas 5,6 nós (a polar dizia 6,2)'])
  assert.equal(ia.modelos.consumo.versao, null)
  assert.equal((await chamar(r.post['/voltar'], { modelo: 'nada' })).code, 400)
  const v = await chamar(r.post['/voltar'], { modelo: 'velocidade' })
  assert.equal(v.versao, 'v0001') // a v0002 nunca esteve em uso
  assert.equal(fs.readFileSync(path.join(pv, 'atual'), 'utf8'), 'v0001')
  const registo = JSON.parse(fs.readFileSync(path.join(app.dir, 'dados', 'modelos', 'registo.json'), 'utf8'))
  assert.match(registo.at(-1).motivo, /voltou atrás à mão \(estava v0003\)/)
  assert.equal((await chamar(r.post['/voltar'], { modelo: 'velocidade' })).code, 409)
  p.stop()
})
