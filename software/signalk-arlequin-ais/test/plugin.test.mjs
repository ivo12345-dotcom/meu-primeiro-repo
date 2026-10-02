// O plugin inteiro (index.js) com um "app" SignalK falso: alvos lidos da árvore, a memória de ciclo
// em ciclo, as notificações publicadas.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const criar = require('../index.js')

const NO = 1852 / 3600
const T0 = Date.parse('2026-10-02T10:00:00Z')
const EU = { latitude: 39.36, longitude: -9.40 }
const norte = (mn, de = EU) => ({ latitude: de.latitude + mn * 1852 / 111320, longitude: de.longitude })
const CAIS_PENICHE = { latitude: 39.3522, longitude: -9.376 } // o último ponto da aproximação de Peniche (destinos.json da rota)

// Como o SignalK, cada valor nosso vem com a hora (timestamp): a de agora (um valor novo a cada leitura), ou
// a posta em app.ts (um sensor que deixou de mandar).
function appFalso () {
  const app = {
    selfId: 'urn:mrn:signalk:uuid:arlequin',
    self: { 'navigation.position': EU, 'navigation.courseOverGroundTrue': 0, 'navigation.speedOverGround': 0 },
    ts: {},
    vessels: {},
    publicado: [],
    valores: {},
    estado: '',
    erro: null,
    erros: []
  }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ais-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p], timestamp: app.ts[p] ?? new Date().toISOString() } : undefined)
  app.getPath = (p) => (p === 'vessels' ? app.vessels : undefined)
  app.handleMessage = (id, d) => {
    for (const u of d.updates) {
      for (const v of u.values) {
        if (v.path.startsWith('notifications.')) app.publicado.push({ path: v.path, ...v.value })
        else app.valores[v.path] = v.value
      }
    }
  }
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (e) => { app.erro = e }
  app.error = (e) => { app.erros.push(e) }
  app.debug = () => {}
  // um alvo AIS na árvore, como o SignalK o guarda (cog/sog em falta = o AIS mandou "não disponível")
  app.alvo = (mmsi, nome, pos, { cog, sog, tsVel } = {}) => {
    const ts = new Date().toISOString()
    const tv = tsVel ?? ts
    app.vessels[`urn:mrn:imo:mmsi:${mmsi}`] = {
      mmsi, name: nome,
      navigation: {
        position: { value: pos, timestamp: ts },
        ...(cog !== undefined ? { courseOverGroundTrue: { value: cog, timestamp: tv } } : {}),
        ...(sog !== undefined ? { speedOverGround: { value: sog, timestamp: tv } } : {})
      }
    }
  }
  return app
}
const alarmes = (app, mmsi) => app.publicado.filter(x => x.path === `notifications.arlequin.ais.${mmsi}`)

// F6b: o alvo sem SOG nem COG tem velocidade pelo rasto dele (antes: a regra da distância, ~2 min antes do embate)
test('K-01 pelo plugin: um alvo sem SOG nem COG a aproximar-se dá alarme pela velocidade do rasto (a memória passa de ciclo em ciclo), com apito contínuo', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  await p.pronto
  for (let s = 2; s <= 40; s += 2) {
    app.alvo('263000009', 'SEM RUMO', norte(1 - 12 * NO * s / 1852)) // a 12 nós para sul, sem SOG nem COG
    t.mock.timers.tick(2000)
  }
  p.stop()
  const ns = alarmes(app, '263000009').filter(x => x.state === 'alarm')
  assert.equal(ns.length, 1, JSON.stringify(app.publicado))
  assert.equal(ns[0].apito, 'continuo')
  assert.match(ns[0].message, /^SEM RUMO em rota de colisão · CPA \d+ m · rumo do alvo pelo rasto$/)
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

// F6b (revisão F6, Importante 1): com o GPS a calar o COG numa leitura sim e noutra não (o SignalK põe
// null na árvore) o alarme saía e voltava de 2 em 2 s, cada vez com som: desfazia o "silenciar".
test('revisão F6 (Importante 1) pelo plugin: o nosso COG a null numa leitura sim e noutra não: o alarme publica-se uma só vez', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.speedOverGround'] = 0.8 * NO
  const p = criar(app)
  p.start({})
  await p.pronto
  for (let s = 2; s <= 120; s += 2) {
    app.self['navigation.courseOverGroundTrue'] = s % 4 === 0 ? 0 : null
    app.alvo('263000001', 'NORDIC STAR', norte(3 - 12 * NO * s / 1852), { cog: Math.PI, sog: 12 * NO })
    t.mock.timers.tick(2000)
  }
  p.stop()
  assert.deepEqual(app.publicado.map(x => x.state), ['alarm', 'normal'], 'o alarme e o "normal" do stop(); nada pelo meio')
})

// F6b (revisão F6, Menor 8): a posição nossa ou o SOG/COG do alvo que deixaram de mudar não contam.
test('revisão F6 (Menor 8) pelo plugin: a nossa posição sem mudar há mais de 10 s (o GPS calou-se): o vigia não julga com ela e diz porquê', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.speedOverGround'] = 5 * NO
  const p = criar(app)
  p.start({})
  await p.pronto
  app.ts['navigation.position'] = new Date().toISOString() // a posição fica com esta hora daqui para a frente
  for (let s = 0; s < 6; s++) t.mock.timers.tick(2000) // 12 s
  app.alvo('263000001', 'NORDIC STAR', norte(2), { cog: Math.PI, sog: 7 * NO })
  t.mock.timers.tick(2000)
  assert.deepEqual(app.publicado, [], 'com a posição congelada não se julga nada')
  assert.match(app.estado, /^Sem a nossa posição \(GPS\) há mais de 10 s/)
  assert.equal(app.valores['navigation.arlequin.emPorto'], null)
  delete app.ts['navigation.position'] // o GPS volta
  t.mock.timers.tick(2000)
  p.stop()
  assert.deepEqual(app.publicado.map(x => x.state), ['alarm', 'normal'])
})

test('revisão F6 (Menor 8) pelo plugin: o COG/SOG do alvo que ficou na árvore 40 s mais velho do que a posição dele não conta', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  await p.pronto
  const velho = new Date(Date.now() - 40000).toISOString()
  // parado a 0,3 MN à proa, a mandar posições; o SOG/COG de 7 nós para nós são de há 40 s (o AIS passou a "não disponível")
  app.alvo('263000002', 'VELHO', norte(0.3), { cog: Math.PI, sog: 7 * NO, tsVel: velho })
  t.mock.timers.tick(2000)
  assert.deepEqual(app.publicado, [])
  app.alvo('263000002', 'VELHO', norte(0.3), { cog: Math.PI, sog: 7 * NO }) // com o SOG/COG de agora: rota de colisão
  t.mock.timers.tick(2000)
  p.stop()
  assert.deepEqual(app.publicado.map(x => x.state), ['alarm', 'normal'])
})

// F6b: decisão do Ivo "AIS dentro de um porto" (contrato C12).
test('C12 pelo plugin: publica navigation.arlequin.emPorto — verdadeiro no cais de Peniche (destinos da rota) abaixo de 4 nós, falso a 5 nós e no mar', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.position'] = CAIS_PENICHE
  const p = criar(app)
  p.start({})
  await p.pronto
  t.mock.timers.tick(2000)
  assert.equal(app.valores['navigation.arlequin.emPorto'], true)
  assert.match(app.estado, /em porto \(Peniche\)/)
  app.self['navigation.speedOverGround'] = 5 * NO
  for (let s = 0; s < 16; s += 1) t.mock.timers.tick(2000) // 32 s seguidos a 5 nós
  assert.equal(app.valores['navigation.arlequin.emPorto'], false)
  p.stop()
  const mar = appFalso()
  mar.self['navigation.position'] = { latitude: 39.2, longitude: -9.7 }
  const q = criar(mar)
  q.start({})
  await q.pronto
  t.mock.timers.tick(2000)
  q.stop()
  assert.equal(mar.valores['navigation.arlequin.emPorto'], false)
})

test('C12 pelo plugin: os portos extra da configuração também contam (ex.: um fundeadouro); sem o ficheiro dos destinos ficam só os extras, e diz-se', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.position'] = { latitude: 38.70, longitude: -9.10 }
  const p = criar(app)
  p.start({ portos: [{ nome: 'Fundeadouro de teste', lat: 38.702, lon: -9.10 }], destinos: path.join(os.tmpdir(), 'nao-existe-destinos.json') })
  await p.pronto
  t.mock.timers.tick(2000)
  p.stop()
  assert.equal(app.valores['navigation.arlequin.emPorto'], true)
  assert.match(app.estado, /em porto \(Fundeadouro de teste\)/)
  assert.match(app.estado, /SEM OS PORTOS DA ROTA/)
  assert.equal(app.erros.length, 1)
})

test('C12 pelo plugin: a sair do cais de Peniche a 3 nós, um amarrado no caminho não apita (no mar, à mesma distância, apita)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  for (const [onde, esperado] of [[CAIS_PENICHE, []], [{ latitude: 39.2, longitude: -9.7 }, ['alarm', 'normal']]]) {
    const app = appFalso()
    app.self['navigation.position'] = onde
    app.self['navigation.speedOverGround'] = 3 * NO
    const p = criar(app)
    p.start({})
    await p.pronto
    app.alvo('263000010', 'AMARRADO', norte(0.1, onde), { cog: 0, sog: 0 })
    t.mock.timers.tick(2000)
    p.stop()
    assert.deepEqual(app.publicado.map(x => x.state), esperado, JSON.stringify(onde))
  }
})

// F6b: nota do SignalK 2.33 (adenda 2): ao parar um plugin o servidor apaga da árvore os valores dele; o
// plugin repõe os seus alarmes ativos ao arrancar (o ficheiro alarmes-ativos.json na pasta de dados).
test('Adenda 2 (SignalK 2.33): os alarmes ativos voltam a publicar-se ao arrancar, com o mesmo caminho e a mesma mensagem; os velhos não', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  app.self['navigation.speedOverGround'] = 5 * NO
  const p = criar(app)
  p.start({})
  await p.pronto
  app.alvo('263000001', 'NORDIC STAR', norte(2), { cog: Math.PI, sog: 7 * NO })
  t.mock.timers.tick(2000)
  p.stop()
  // o servidor apaga a árvore do plugin; o plugin volta a arrancar (Admin UI ou reinício do Pi)
  app.publicado = []
  const p2 = criar(app)
  p2.start({})
  assert.deepEqual(app.publicado, [{ path: 'notifications.arlequin.ais.263000001', state: 'alarm', method: ['visual', 'sound'], message: 'NORDIC STAR em rota de colisão · CPA 0 m', apito: 'continuo' }])
  await p2.pronto
  app.alvo('263000001', 'NORDIC STAR', norte(1.9), { cog: Math.PI, sog: 7 * NO })
  t.mock.timers.tick(2000)
  assert.equal(app.publicado.length, 1, 'o perigo continua: não se publica outra vez')
  p2.stop()
  // 11 min depois (o alvo já nem está): um alarme tão velho não se repõe
  t.mock.timers.tick(11 * 60 * 1000)
  app.publicado = []
  app.vessels = {}
  const p3 = criar(app)
  p3.start({})
  await p3.pronto
  p3.stop()
  assert.deepEqual(app.publicado, [])
})

test('Adenda 2 (SignalK 2.33): um alarme reposto cujo perigo passou durante o reinício limpa (o "✓ Resolvido" não se perde)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  fs.writeFileSync(path.join(app.dir, 'alarmes-ativos.json'), JSON.stringify({ 263000001: { message: 'NORDIC STAR em rota de colisão · CPA 0 m', desde: T0 - 60000, vistoEm: T0 - 4000 } }))
  const p = criar(app)
  p.start({})
  await p.pronto
  app.alvo('263000001', 'NORDIC STAR', norte(-1), { cog: Math.PI, sog: 7 * NO }) // já passou: a sul, a afastar-se
  for (let s = 0; s < 17; s++) t.mock.timers.tick(2000)
  p.stop()
  assert.deepEqual(alarmes(app, '263000001').map(x => x.state), ['alarm', 'normal'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.dir, 'alarmes-ativos.json'), 'utf8')), {})
})
