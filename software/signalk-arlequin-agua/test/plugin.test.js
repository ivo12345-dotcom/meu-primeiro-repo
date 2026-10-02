'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')

// Como o SignalK, cada valor vem com a hora (timestamp): a de agora, ou a posta em app.ts (um sensor calado).
function appFalso (dir) {
  const app = { self: {}, ts: {}, valores: {}, notificacoes: [], estado: '', opcoes: null }
  app.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-agua-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p], timestamp: app.ts[p] ?? new Date().toISOString() } : undefined)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) { if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value }); else app.valores[v.path] = v.value } }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = () => {}
  app.savePluginOptions = (o, cb) => { app.opcoes = o; cb() }
  return app
}
const rotas = (p) => { const r = { get: {}, post: {} }; p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } }); return r }
const chamar = (h, body) => new Promise((resolve) => { const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }; h({ body }, res) })
const segundos = (t, n) => { for (let i = 0; i < n; i++) t.mock.timers.tick(1000) }

// Auditoria K-11 (contrato C2): com a segurança do SignalK ligada (2.33), uma rota sem router.access só
// aceita admin; o ecrã entra com uma conta "read/write". Os GET pedem "readonly" e os POST "readwrite".
function niveis (p) {
  const direto = []
  const registos = []
  const router = {
    get: (k) => direto.push(`GET ${k}`),
    post: (k) => direto.push(`POST ${k}`),
    access: (nivel) => ({
      get: (k, h) => registos.push({ m: 'GET', k, nivel, h: typeof h }),
      post: (k, h) => registos.push({ m: 'POST', k, nivel, h: typeof h })
    })
  }
  p.registerWithRouter(router)
  return { direto, nivel: Object.fromEntries(registos.map(x => [`${x.m} ${x.k}`, x.nivel])), funcoes: registos.every(x => x.h === 'function') }
}

test('K-11: com a segurança do SignalK (router.access) os GET registam-se "readonly" e os POST "readwrite"; nada fica só para admin', () => {
  const r = niveis(criar(appFalso()))
  assert.deepEqual(r.direto, [], 'nenhuma rota sem nível (ficava só para admin)')
  assert.deepEqual(r.nivel, {
    'GET /estado': 'readonly',
    'POST /encher': 'readwrite',
    'POST /nivel': 'readwrite',
    'POST /calibrar-bomba/iniciar': 'readwrite',
    'POST /calibrar-bomba/cancelar': 'readwrite',
    'POST /calibrar-bomba/terminar': 'readwrite'
  })
  assert.ok(r.funcoes)
})

test('encher, pedalar, aviso a 20%, e o nível sobrevive a um reinício', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  await chamar(r.post['/encher'], { id: 0 })
  app.self['tanks.freshWater.0.pedaladas'] = 0
  segundos(t, 2)
  app.self['tanks.freshWater.0.pedaladas'] = 190 // 66,5 L de 80 → 13,5 L (17%)
  segundos(t, 2)
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.freshWater.0.currentVolume'] * 1000 - 13.5) < 1e-9)
  assert.equal(app.valores['tanks.freshWater.0.name'], 'Cozinha (BB)')
  const aviso = app.notificacoes.find(n => n.path === 'notifications.tanks.freshWater.0.baixo')
  assert.equal(aviso.state, 'warn')
  assert.match(aviso.message, /Cozinha \(BB\) com 14 L/)
  // Reinício do Pi: o nível volta do disco
  const app2 = appFalso(app.dir)
  const p2 = criar(app2)
  p2.start({})
  app2.self['tanks.freshWater.0.pedaladas'] = 190
  segundos(t, 2)
  p2.stop()
  assert.ok(Math.abs(app2.valores['tanks.freshWater.0.currentVolume'] * 1000 - 13.5) < 1e-9)
})

// Auditoria I-21: um aviso ativo quando o plugin para (reinício pelo Admin UI) ficava na árvore para
// sempre; e um que ficou preso de antes nunca saía.
test('I-21: ao parar, os avisos ativos passam a normal; ao arrancar, os presos na árvore também', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  await chamar(r.post['/encher'], { id: 0 })
  app.self['tanks.freshWater.0.pedaladas'] = 0
  segundos(t, 2)
  app.self['tanks.freshWater.0.pedaladas'] = 200 // 70 L de 80: 10 L
  segundos(t, 2)
  p.stop()
  assert.deepEqual(app.notificacoes.filter(n => n.path === 'notifications.tanks.freshWater.0.baixo').map(n => n.state), ['warn', 'normal'])
  const app2 = appFalso()
  app2.self['notifications.tanks.freshWater.1.baixo'] = { state: 'warn', method: ['visual', 'sound'], message: 'Água a acabar' }
  const p2 = criar(app2)
  p2.start({})
  p2.stop()
  assert.deepEqual(app2.notificacoes.map(n => `${n.path}:${n.state}`), ['notifications.tanks.freshWater.1.baixo:normal'])
})

// Auditoria I-29 (decisão n.º 23): sem sensor (ou sem nunca carregar em "Enchi") os depósitos apareciam
// cheios (80 L / 100 %) no ecrã, no /estado do Telegram e no diário.
test('I-29: sem sensor (nunca houve contador) nenhum depósito aparece cheio: o nível vai sem valor (null)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  segundos(t, 2)
  p.stop()
  for (const id of [0, 1]) {
    assert.equal(app.valores[`tanks.freshWater.${id}.currentLevel`], null)
    assert.equal(app.valores[`tanks.freshWater.${id}.currentVolume`], null)
    assert.equal(app.valores[`tanks.freshWater.${id}.capacity`], 0.08)
  }
  assert.match(app.estado, /Cozinha \(BB\) sem sensor/)
})

test('I-29: com o contador mas sem nunca "Enchi" nem nível à mão: sem nível; depois do "Enchi", cheio', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  app.self['tanks.freshWater.0.pedaladas'] = 12
  segundos(t, 2)
  assert.equal(app.valores['tanks.freshWater.0.currentVolume'], null)
  const e = await new Promise(res => r.get['/estado']({}, { json: res }))
  assert.deepEqual([e.tanques[0].litros, e.tanques[0].semSensor, e.tanques[0].nivelConhecido], [null, false, false])
  await chamar(r.post['/encher'], { id: 0 })
  segundos(t, 2)
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.freshWater.0.currentVolume'] * 1000 - 80) < 1e-9)
})

test('I-29: o contador calado há mais de 10 min: "sem sensor" (sem valor), mesmo depois de "Enchi"; volta quando o contador volta', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  await chamar(r.post['/encher'], { id: 0 })
  app.self['tanks.freshWater.0.pedaladas'] = 0
  segundos(t, 2)
  app.self['tanks.freshWater.0.pedaladas'] = 20 // 7 L
  segundos(t, 2)
  assert.ok(Math.abs(app.valores['tanks.freshWater.0.currentVolume'] * 1000 - 73) < 1e-9)
  app.ts['tanks.freshWater.0.pedaladas'] = new Date().toISOString() // o ESP32 cala-se
  segundos(t, 9 * 60)
  assert.ok(Math.abs(app.valores['tanks.freshWater.0.currentVolume'] * 1000 - 73) < 1e-9)
  segundos(t, 2 * 60)
  assert.equal(app.valores['tanks.freshWater.0.currentVolume'], null)
  const e = await new Promise(res => r.get['/estado']({}, { json: res }))
  assert.equal(e.tanques[0].semSensor, true)
  delete app.ts['tanks.freshWater.0.pedaladas'] // volta, com as pedaladas que contou entretanto
  app.self['tanks.freshWater.0.pedaladas'] = 40
  segundos(t, 2)
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.freshWater.0.currentVolume'] * 1000 - 66) < 1e-9)
})

// Auditoria M-62 (E-M4): litros ilegíveis gravavam NaN nas opções (e daí em diante o nível ficava NaN);
// 0 gravava 0 L por pedalada.
test('M-62: calibrar a bomba só aceita 0 < litros ≤ 20; o resto dá 400 e nada se grava', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  app.self['tanks.freshWater.1.pedaladas'] = 10
  segundos(t, 2)
  await chamar(r.post['/calibrar-bomba/iniciar'], { id: 1 })
  app.self['tanks.freshWater.1.pedaladas'] = 13
  segundos(t, 1)
  for (const litros of ['abc', '0', '-1', '25']) {
    assert.equal((await chamar(r.post['/calibrar-bomba/terminar'], { id: 1, litros })).code, 400, litros)
  }
  assert.equal(app.opcoes, null)
  const fim = await chamar(r.post['/calibrar-bomba/terminar'], { id: 1, litros: '1,5' })
  p.stop()
  assert.equal(fim.code, 200)
  assert.equal(app.opcoes.tanques[1].litrosPorPedalada, 0.5)
})

// Auditoria M-63 (E-M5): com a segurança ligada o POST ao logbook dá 401/403 e perdia-se em silêncio.
test('M-63: uma resposta de erro do logbook fica no registo do servidor', async (t) => {
  const app = appFalso()
  app.erros = []
  app.error = (e) => app.erros.push(e)
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401 }))
  const p = criar(app)
  p.start({ logbook: true })
  const r = rotas(p)
  await chamar(r.post['/encher'], { id: 0 })
  await new Promise(res => setImmediate(res))
  p.stop()
  assert.deepEqual(app.erros, ['logbook respondeu 401'])
})

test('calibrar a bomba com uma jarra de 1 L grava os litros por pedalada', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotas(p)
  app.self['tanks.freshWater.1.pedaladas'] = 10
  segundos(t, 2)
  await chamar(r.post['/calibrar-bomba/iniciar'], { id: 1 })
  app.self['tanks.freshWater.1.pedaladas'] = 13
  segundos(t, 1)
  const e = await new Promise(res => r.get['/estado']({}, { json: res }))
  assert.equal(e.tanques[1].pedaladasCalibracao, 3)
  const fim = await chamar(r.post['/calibrar-bomba/terminar'], { id: 1, litros: '1' })
  p.stop()
  assert.equal(fim.pedaladas, 3)
  assert.equal(app.opcoes.tanques[1].litrosPorPedalada, 0.333)
  assert.equal((await chamar(r.post['/encher'], { id: 7 })).code, 404)
})
