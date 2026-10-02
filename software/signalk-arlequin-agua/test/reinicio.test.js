'use strict'
// Nota do SignalK 2.33 (adenda 2 da auditoria): ao parar um plugin o servidor apaga da árvore os valores
// dele (removeSource); cada reinício parecia um aviso resolvido. A água volta a publicar no arranque os
// avisos que estavam ativos (o mesmo caminho e o mesmo valor) e a regra continua a partir deles.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')

const T0 = 1_727_600_000_000

function appFalso () {
  const app = { self: {}, ts: {}, valores: {}, notificacoes: [], estado: '' }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-agua-reinicio-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p], timestamp: app.ts[p] ?? new Date().toISOString() } : undefined)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) { if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value }); else app.valores[v.path] = v.value } }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => { throw new Error(e) }
  app.savePluginOptions = (o, cb) => cb()
  return app
}
const rotas = (p) => { const r = { get: {}, post: {} }; p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } }); return r }
const chamar = (h, body) => new Promise((resolve) => { const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }; h({ body }, res) })
const segundos = (t, n) => { for (let i = 0; i < n; i++) t.mock.timers.tick(1000) }
const curto = (ns) => ns.map(n => `${n.path.split('.').pop()}:${n.state}`)

test('Adenda 2 (SignalK 2.33): o aviso de água a acabar volta a publicar-se ao arrancar e a histerese continua (22 % não o limpa; 26 % sim)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['tanks.freshWater.0.pedaladas'] = 0
  app.self['tanks.freshWater.1.pedaladas'] = 0
  const p = criar(app)
  p.start({})
  await chamar(rotas(p).post['/encher'], { id: 1 })
  await chamar(rotas(p).post['/nivel'], { id: 0, litros: 15 }) // 19 % de 80 L: aviso
  segundos(t, 2)
  await chamar(rotas(p).post['/nivel'], { id: 0, litros: 18 }) // 22 %: entre os 20 e os 25, fica
  segundos(t, 2)
  const aviso = app.notificacoes.find(n => n.path === 'notifications.tanks.freshWater.0.baixo' && n.state === 'warn')
  assert.ok(aviso)
  p.stop()
  segundos(t, 3)
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({})
  assert.deepEqual(app.notificacoes.slice(antes), [aviso])
  segundos(t, 10)
  assert.equal(app.notificacoes.length, antes + 1, 'a 22 % não limpa nem se repete')
  await chamar(rotas(p2).post['/nivel'], { id: 0, litros: 21 }) // 26 %
  segundos(t, 2)
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['baixo:warn', 'baixo:normal'])
  p2.stop()
})
