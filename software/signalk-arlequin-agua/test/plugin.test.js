'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')

function appFalso (dir) {
  const app = { self: {}, valores: {}, notificacoes: [], estado: '', opcoes: null }
  app.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-agua-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p] } : undefined)
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
