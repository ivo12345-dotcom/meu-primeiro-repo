// O plugin inteiro (index.js) com um "app" SignalK falso: alvos lidos da árvore, a memória de ciclo
// em ciclo, as notificações publicadas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const criar = require('../index.js')

const NO = 1852 / 3600
const T0 = Date.parse('2026-10-02T10:00:00Z')
const EU = { latitude: 39.36, longitude: -9.40 }
const norte = (mn) => ({ latitude: EU.latitude + mn * 1852 / 111320, longitude: EU.longitude })

function appFalso () {
  const app = {
    selfId: 'urn:mrn:signalk:uuid:arlequin',
    self: { 'navigation.position': EU, 'navigation.courseOverGroundTrue': 0, 'navigation.speedOverGround': 0 },
    vessels: {},
    publicado: [],
    estado: '',
    erro: null
  }
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p] } : undefined)
  app.getPath = (p) => (p === 'vessels' ? app.vessels : undefined)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) app.publicado.push({ path: v.path, ...v.value }) }
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (e) => { app.erro = e }
  app.debug = () => {}
  // um alvo AIS na árvore, como o SignalK o guarda (cog/sog em falta = o AIS mandou "não disponível")
  app.alvo = (mmsi, nome, pos, { cog, sog } = {}) => {
    const ts = new Date().toISOString()
    app.vessels[`urn:mrn:imo:mmsi:${mmsi}`] = {
      mmsi, name: nome,
      navigation: {
        position: { value: pos, timestamp: ts },
        ...(cog !== undefined ? { courseOverGroundTrue: { value: cog, timestamp: ts } } : {}),
        ...(sog !== undefined ? { speedOverGround: { value: sog, timestamp: ts } } : {})
      }
    }
  }
  return app
}

test('K-01 pelo plugin: um alvo sem SOG nem COG a aproximar-se dá alarme (a memória passa de ciclo em ciclo), com apito contínuo', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  await p.pronto
  for (let i = 0; i < 4; i++) {
    app.alvo('263000009', 'SEM RUMO', norte(0.45 - i * 40 / 1852))
    t.mock.timers.tick(2000)
  }
  p.stop()
  const ns = app.publicado.filter(x => x.path === 'notifications.arlequin.ais.263000009' && x.state === 'alarm')
  assert.equal(ns.length, 1, JSON.stringify(app.publicado))
  assert.equal(ns[0].apito, 'continuo')
  assert.match(ns[0].message, /^SEM RUMO a 0,4 MN e a aproximar-se · alvo sem rumo$/)
})

test('o próprio barco (selfId) nunca é alvo; lê o COG e o SOG dos alvos da árvore', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.speedOverGround'] = 5 * NO
  const p = criar(app)
  p.start({})
  await p.pronto
  const ts = new Date().toISOString()
  // o nosso barco também vem em vessels, na mesma posição
  app.vessels[app.selfId] = { mmsi: '263999999', navigation: { position: { value: EU, timestamp: ts } } }
  app.alvo('263000001', 'NORDIC STAR', norte(2), { cog: Math.PI, sog: 7 * NO })
  t.mock.timers.tick(2000)
  assert.match(app.estado, /^1 alvos AIS · 1 em perigo/)
  assert.deepEqual(app.publicado.map(x => `${x.path}:${x.state}`), ['notifications.arlequin.ais.263000001:alarm'])
  p.stop()
})

// Auditoria I-21: um alarme ativo quando o plugin para (reinício pelo Admin UI) ficava na árvore para
// sempre, com o apito contínuo; um que ficou preso de antes nunca saía; e um stop() antes de o cálculo
// carregar deixava um temporizador órfão.
test('I-21: ao parar, os alarmes ativos passam a normal', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.speedOverGround'] = 5 * NO
  const p = criar(app)
  p.start({})
  await p.pronto
  app.alvo('263000001', 'NORDIC STAR', norte(2), { cog: Math.PI, sog: 7 * NO })
  t.mock.timers.tick(2000)
  p.stop()
  assert.deepEqual(app.publicado.map(x => `${x.path}:${x.state}`), ['notifications.arlequin.ais.263000001:alarm', 'notifications.arlequin.ais.263000001:normal'])
})

test('I-21: ao arrancar, os alarmes AIS presos na árvore passam a normal', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const arvore = { 263000007: { value: { state: 'alarm', method: ['visual', 'sound'], message: 'X em rota de colisão' } }, 263000008: { value: { state: 'normal', method: [], message: 'Normal' } } }
  app.getSelfPath = (p) => (p === 'notifications.arlequin.ais' ? arvore : p in app.self ? { value: app.self[p] } : undefined)
  const p = criar(app)
  p.start({})
  await p.pronto
  p.stop()
  assert.deepEqual(app.publicado.map(x => `${x.path}:${x.state}`), ['notifications.arlequin.ais.263000007:normal'])
})

test('I-21: um stop() antes de o cálculo carregar não deixa o vigia a correr', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  p.stop()
  await p.pronto
  t.mock.timers.tick(10000)
  assert.equal(app.estado, '')
})
