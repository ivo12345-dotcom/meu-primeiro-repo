'use strict'
// Ajudas dos testes do plugin "a navegar" (desenho 3b-2): o SignalK falso (com eventos, a API de
// recursos e a de rumo, e os deltas publicados), a Open-Meteo falsa e o router falso. As mesmas
// ideias do test/index.test.js (que fica como está).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { EventEmitter } = require('node:events')
const c = require('../lib/costa')
const criar = require('..')

const H = 3600000
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const FIX_PONTOS = FIX.pontos.map(c.P)
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const costa = c.carregarCosta()
const caisDe = (id) => c.P(costa.destinos.find(d => d.id === id).aproximacao.at(-1))

// Open-Meteo falsa: para cada ponto pedido, a resposta do ponto da fixture mais perto.
function fetchFalso () {
  return async (url) => {
    const u = new URL(url)
    const lats = u.searchParams.get('latitude').split(',').map(Number)
    const lons = u.searchParams.get('longitude').split(',').map(Number)
    const fonte = u.hostname.startsWith('marine') ? FIX.marine : FIX.forecast
    const resp = lats.map((lat, i) => {
      let k = 0; let d = Infinity
      FIX_PONTOS.forEach((p, j) => { const dj = c.distanciaMn(p, { lat, lon: lons[i] }); if (dj < d) { d = dj; k = j } })
      return fonte[k]
    })
    return { ok: true, status: 200, json: async () => (resp.length === 1 ? resp[0] : resp) }
  }
}

// O SignalK falso: valores do barco (app.self, com a hora de cada um em app.horas; sem ela, a hora do
// relógio do plugin, app.relogio: um valor fresco), a API de recursos e a de rumo (activateRoute muda a
// rota ativa), eventos, e os deltas publicados (app.deltas).
function appFalso ({ em = 'cascais' } = {}) {
  const app = new EventEmitter()
  Object.assign(app, { self: {}, horas: {}, estado: '', erroPlugin: null, erros: [], recursos: new Map(), ativacoes: [], deltas: [], rotaAtiva: null })
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-navegar-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  app.getSelfPath = (p) => {
    if (p in app.self) {
      const hora = app.horas[p] ?? (app.relogio ? new Date(app.relogio()).toISOString() : null)
      return { value: app.self[p], ...(hora ? { timestamp: hora } : {}) }
    }
    // os ramos (notifications.rota): a árvore como o SignalK a dá
    const filhos = Object.keys(app.self).filter(k => k.startsWith(`${p}.`))
    if (!filhos.length) return undefined
    const arvore = {}
    for (const k of filhos) {
      const partes = k.slice(p.length + 1).split('.')
      let n = arvore
      for (const x of partes) n = n[x] = n[x] || {}
      n.value = app.self[k]
    }
    return arvore
  }
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (s) => { app.erroPlugin = s }
  app.error = (e) => { app.erros.push(e) }
  app.debug = () => {}
  // os deltas publicados: guardados e aplicados aos valores (como o servidor)
  app.handleMessage = (id, delta) => {
    app.deltas.push(delta)
    for (const u of delta.updates || []) for (const v of u.values || []) app.self[v.path] = v.value
  }
  app.resourcesApi = {
    setResource: async (tipo, id, dados) => { app.recursos.set(`${tipo}/${id}`, dados) },
    getResource: async (tipo, id) => { const r = app.recursos.get(`${tipo}/${id}`); if (!r) throw new Error('não existe'); return r },
    deleteResource: async (tipo, id) => { app.recursos.delete(`${tipo}/${id}`) }
  }
  app.activateRoute = async (dest) => { app.ativacoes.push(dest); app.rotaAtiva = dest.href }
  app.getCourse = async () => ({ activeRoute: app.rotaAtiva ? { href: app.rotaAtiva } : null })
  const p = caisDe(em)
  app.self['navigation.position'] = { latitude: p.lat, longitude: p.lon }
  app.self['electrical.batteries.servico.capacity.stateOfCharge'] = 0.9
  app.self['tanks.fuel.0.currentVolume'] = 0.124
  return app
}

const rotas = (p) => {
  const r = { get: {}, post: {} }
  p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } })
  return r
}
const chamar = (h, { body, params } = {}) => new Promise((resolve) => {
  const res = { code: 200, status (x) { this.code = x; return this }, json (j) { resolve({ code: this.code, ...j }) } }
  h({ body, params: params || {} }, res)
})
async function esperarResultado (r, id) {
  for (let i = 0; i < 2000; i++) {
    const x = await chamar(r.get['/resultado/:id'], { params: { id } })
    if (x.estado !== 'a calcular') return x
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('esperei demasiado')
}

// O plugin com o relógio na mão: { p, r, avancar(ms), agora() }. extra: outros deps.
function plugin (app, extra = {}) {
  let agora = AGORA
  app.relogio = () => agora
  const p = criar(app, { fetch: fetchFalso(), relogio: () => agora, esperar: async () => {}, costa, ...extra })
  return { p, r: rotas(p), avancar: (ms) => { agora += ms }, agora: () => agora, acertar: (t) => { agora = t } }
}

// Calcula e espera o resultado: { id, resultado }.
async function calcular (r, corpo) {
  const a = await chamar(r.post['/calcular'], { body: corpo })
  const x = await esperarResultado(r, a.id)
  if (x.estado !== 'pronto') throw new Error(`o cálculo não ficou pronto: ${x.erro}`)
  return { id: a.id, resultado: x.resultado }
}

// A posição no rasto do plano [{ lat, lon, t }] à hora do plano t (entre dois pontos, na reta).
function posNoRasto (rasto, t) {
  const ts = rasto.map(p => Date.parse(p.t))
  if (t <= ts[0]) return { lat: rasto[0].lat, lon: rasto[0].lon }
  let i = 0
  while (i + 1 < rasto.length && ts[i + 1] <= t) i++
  if (i + 1 >= rasto.length) return { lat: rasto.at(-1).lat, lon: rasto.at(-1).lon }
  const f = (t - ts[i]) / (ts[i + 1] - ts[i])
  return { lat: rasto[i].lat + f * (rasto[i + 1].lat - rasto[i].lat), lon: rasto[i].lon + f * (rasto[i + 1].lon - rasto[i].lon) }
}

// Auditoria M-20 (uma constante por número): carrega outra vez um ficheiro do plugin com os exports de
// outros trocados, para provar que um número vem de lá e não está escrito à mão (com os valores iguais,
// comparar não o mostra). alvo e as chaves de trocas: caminhos a partir da pasta do plugin ('index.js',
// 'lib/plano.js'); trocas: { 'lib/x.js': (exports) => os exports trocados }. Devolve os exports do alvo
// carregado assim; no fim a cache dos módulos fica como estava (o resto do ficheiro de testes não vê nada).
function comOutro (alvo, trocas) {
  const raiz = path.join(__dirname, '..')
  const pAlvo = require.resolve(path.join(raiz, alvo))
  require(pAlvo) // o alvo e tudo o que ele carrega, já na cache com os valores verdadeiros
  const antes = require.cache[pAlvo]
  const repor = []
  try {
    for (const [dep, trocar] of Object.entries(trocas)) {
      const pDep = require.resolve(path.join(raiz, dep))
      require(pDep)
      const m = require.cache[pDep]
      const verdadeiros = m.exports
      m.exports = trocar(verdadeiros)
      repor.push(() => { m.exports = verdadeiros })
    }
    delete require.cache[pAlvo]
    return require(pAlvo)
  } finally {
    for (const f of repor) f()
    require.cache[pAlvo] = antes
  }
}

module.exports = { H, AGORA, posNoRasto, costa, caisDe, fetchFalso, appFalso, rotas, chamar, esperarResultado, plugin, calcular, comOutro }
