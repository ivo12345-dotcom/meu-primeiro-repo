'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const criar = require('..')

const H = 3600000
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const FIX_PONTOS = FIX.pontos.map(c.P)
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const costa = c.carregarCosta()
const ALGES = c.P(costa.destinos.find(d => d.id === 'alges').aproximacao.at(-1))

// Open-Meteo falsa: para cada ponto pedido, a resposta do ponto da fixture mais perto.
function fetchFalso (registo = []) {
  return async (url, opcoes = {}) => {
    registo.push({ url, opcoes })
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

function appFalso ({ comApi = true, rotaAtiva = null } = {}) {
  const app = { self: {}, estado: '', erroPlugin: null, erros: [], recursos: new Map(), ativacoes: [], leiturasFalhadas: 2 }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-rota-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p] } : undefined)
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (s) => { app.erroPlugin = s }
  app.error = (e) => { app.erros.push(e) }
  if (comApi) {
    app.resourcesApi = {
      setResource: async (tipo, id, dados) => { app.recursos.set(`${tipo}/${id}`, dados) },
      // como no servidor, a escrita do fornecedor não é imediata: as 2 primeiras leituras falham
      getResource: async (tipo, id) => { if (app.leiturasFalhadas-- > 0) throw new Error('ainda não'); const r = app.recursos.get(`${tipo}/${id}`); if (!r) throw new Error('não existe'); return r }
    }
    app.activateRoute = async (dest) => { app.ativacoes.push(dest) }
    app.getCourse = async () => ({ activeRoute: rotaAtiva ? { href: '/resources/routes/abc' } : null })
    if (rotaAtiva) app.recursos.set('routes/abc', { feature: { geometry: { type: 'LineString', coordinates: rotaAtiva.map(([lat, lon]) => [lon, lat]) } } })
  }
  app.self['navigation.position'] = { latitude: ALGES.lat, longitude: ALGES.lon }
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
  const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }
  h({ body, params: params || {} }, res)
})
async function esperarResultado (r, id) {
  for (let i = 0; i < 1000; i++) {
    const x = await chamar(r.get['/resultado/:id'], { params: { id } })
    if (x.estado !== 'a calcular') return x
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('esperei demasiado')
}

function plugin (app, extra = {}) {
  let agora = AGORA
  const registo = []
  const p = criar(app, { fetch: fetchFalso(registo), relogio: () => agora, esperar: async () => {}, costa, ...extra })
  return { p, r: rotas(p), registo, avancar: (ms) => { agora += ms } }
}

test('antes de arrancar tudo dá 503; com a polar em falta não arranca e diz porquê', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  assert.equal((await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).code, 503)
  assert.equal((await chamar(r.get['/resultado/:id'], { params: { id: 'x' } })).code, 503)
  assert.equal((await chamar(r.get['/destinos'])).code, 503)
  assert.equal((await chamar(r.post['/destinos'], { body: {} })).code, 503)
  assert.equal((await chamar(r.post['/ativar'], { body: {} })).code, 503)
  p.start({ pasta: path.join(app.dir, 'dados'), polar: path.join(app.dir, 'nao-existe.csv') })
  assert.match(app.erroPlugin, /^não arrancou: ENOENT/)
  const x = await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })
  assert.equal(x.code, 503)
  assert.match(x.erro, /não arrancou/)
})

test('POST /calcular: valida, 202 com o id, 409 enquanto calcula, o resultado com o veredicto; arquiva a previsão; depois sem rede usa o arquivo', async () => {
  const app = appFalso()
  const { p, r, registo, avancar } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(app.estado, 'Pronto · 15 destinos')
  assert.equal((await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'eu' } })).code, 400)
  assert.equal((await chamar(r.post['/calcular'], { body: { tripulacao: 'so' } })).code, 400)
  assert.equal((await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so', sairAgora: 'sim' } })).code, 400)
  const a = await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })
  assert.equal(a.code, 202)
  assert.match(a.id, /^[0-9a-f-]{36}$/)
  const b = await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })
  assert.equal(b.code, 409)
  assert.equal(b.id, a.id)
  const x = await esperarResultado(r, a.id)
  assert.equal(x.estado, 'pronto', x.erro)
  assert.equal(x.progresso, 1)
  assert.ok(['nao-recomendado', 'espera'].includes(x.resultado.veredicto.tipo))
  assert.equal(x.resultado.alternativas.length, 3)
  assert.deepEqual(x.resultado.previsao.idadeH, 0)
  assert.match(app.estado, /^Última rota: /)
  // pediu forecast e marine com os pontos da rota, e arquivou um ficheiro por ponto
  assert.equal(registo.length, 2)
  assert.ok(registo[0].opcoes.signal) // com tempo limite
  const arquivo = fs.readdirSync(path.join(app.dir, 'dados', 'previsoes'))
  assert.ok(arquivo.length >= 8 && arquivo.every(n => n.startsWith('2026-09-29T14-32-')), arquivo.join(','))
  assert.equal((await chamar(r.get['/resultado/:id'], { params: { id: 'nada' } })).code, 404)

  // uma hora depois, sem rede: o arquivo (sem nível do mar: a maré do Tejo fica a 0, com aviso)
  avancar(H)
  const semRede = plugin(app, { fetch: async () => { throw new Error('sem rede') } })
  semRede.avancar(H)
  semRede.p.start({ pasta: path.join(app.dir, 'dados') })
  const y = await chamar(semRede.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })
  const z = await esperarResultado(semRede.r, y.id)
  assert.equal(z.estado, 'pronto', z.erro)
  assert.equal(z.resultado.previsao.obtida, '2026-09-29T14:32:00.000Z')
  assert.equal(z.resultado.previsao.idadeH, 1)
  assert.ok(z.resultado.avisos.includes('Sem dados do mar: a corrente de maré na barra do Tejo fica a 0'))
  // sem rede e sem arquivo: erro que explica
  const vazio = appFalso()
  const nada = plugin(vazio, { fetch: async () => { throw new Error('sem rede') } })
  nada.p.start({ pasta: path.join(vazio.dir, 'dados') })
  const w = await esperarResultado(nada.r, (await chamar(nada.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
  assert.equal(w.estado, 'erro')
  assert.equal(w.erro, 'Sem previsão que cubra a rota: sem rede (sem rede) e não há previsão guardada que cubra a rota. Não calculo sem previsão.')
  assert.match(vazio.estado, /^Último cálculo: Sem previsão/)
})

test('erros no cálculo ficam no estado "erro" (sem GPS, destino desconhecido) e o plugin continua', async () => {
  const app = appFalso()
  delete app.self['navigation.position']
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
  assert.equal(x.estado, 'erro')
  assert.match(x.erro, /^Sem GPS/)
  app.self['navigation.position'] = { latitude: ALGES.lat, longitude: ALGES.lon }
  const y = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'atlantida', tripulacao: 'so' } })).id)
  assert.equal(y.erro, 'destino desconhecido: atlantida')
  // 'rota-ativa' sem rota ativa: erro que explica (a promessa rejeitada acaba no .catch)
  const z = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'rota-ativa', tripulacao: 'so' } })).id)
  assert.equal(z.estado, 'erro')
  assert.equal(z.erro, 'não há rota ativa no SignalK')
})

test('GET/POST /destinos: os da lista e os do Ivo (gravados na pasta do plugin), validados', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const l0 = await chamar(r.get['/destinos'])
  assert.equal(l0.destinos.length, 15)
  assert.equal((await chamar(r.post['/destinos'], { body: { nome: '', lat: 38.5, lon: -9.3, conhecido: true, abrigo: false } })).code, 400)
  assert.equal((await chamar(r.post['/destinos'], { body: { nome: 'Lisboa', lat: 38.72, lon: -9.14, conhecido: true, abrigo: true } })).erro, 'essa posição fica em terra')
  assert.equal((await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro', lat: 38.43, lon: -9.1 } })).code, 400)
  const a = await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro da Arrábida', lat: 38.4512345, lon: -8.95, conhecido: true, abrigo: true } })
  assert.equal(a.code, 201)
  assert.deepEqual({ id: a.destino.id, largo: a.destino.largo, aproximacao: a.destino.aproximacao, meu: a.destino.meu }, { id: 'meu-fundeadouro-da-arrabida', largo: [38.45123, -8.95], aproximacao: [[38.45123, -8.95]], meu: true })
  const b = await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro da Arrábida', posicaoAtual: true, conhecido: false, abrigo: false } })
  assert.equal(b.destino.id, 'meu-fundeadouro-da-arrabida-2')
  const l1 = await chamar(r.get['/destinos'])
  assert.equal(l1.destinos.length, 17)
  const gravado = JSON.parse(fs.readFileSync(path.join(app.dir, 'plugin', 'destinos.json'), 'utf8'))
  assert.equal(gravado.length, 2)
  // um destino do Ivo serve para calcular
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'meu-fundeadouro-da-arrabida', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(x.estado, 'pronto', x.erro)
  assert.equal(x.resultado.destino.nome, 'Fundeadouro da Arrábida')
})

test('POST /ativar: grava a rota (API de recursos v2) e ativa-a (API de rumo v2); sem a API interna, por HTTP', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  const x = await esperarResultado(r, id)
  assert.equal((await chamar(r.post['/ativar'], { body: { id: 'nada', alternativa: 0 } })).code, 404)
  assert.equal((await chamar(r.post['/ativar'], { body: { id, alternativa: 7 } })).code, 404)
  const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  assert.equal(a.via, 'api interna')
  const alt = x.resultado.alternativas[0]
  const dados = app.recursos.get(`routes/${a.rota}`)
  assert.equal(dados.feature.geometry.type, 'LineString')
  assert.deepEqual(dados.feature.geometry.coordinates[0], [alt.rota[0][1], alt.rota[0][0]])
  assert.equal(dados.feature.geometry.coordinates.length, alt.rota.length)
  assert.equal(dados.feature.properties.coordinatesMeta[0].name, 'Algés (CNA) (partida)')
  assert.equal(dados.feature.properties.coordinatesMeta.at(-1).name, 'Peniche')
  assert.match(dados.name, /^Arlequin → Peniche \(Agora, /)
  assert.deepEqual(app.ativacoes, [{ href: `/resources/routes/${a.rota}`, pointIndex: 1 }])
  // pelo id da alternativa também
  assert.equal((await chamar(r.post['/ativar'], { body: { id, alternativa: alt.id } })).code, 200)
  // um erro da API de rumo dá 502 com a mensagem
  app.activateRoute = async () => { throw new Error('Unable to retrieve vessel position') }
  const e = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(e.code, 502)
  assert.equal(e.erro, 'não ativei a rota: Unable to retrieve vessel position')

  // sem a API interna: PUT para o próprio servidor
  const semApi = appFalso({ comApi: false })
  const pedidos = []
  const f = fetchFalso()
  const q = plugin(semApi, { fetch: async (url, o) => { if (url.startsWith('http://localhost')) { pedidos.push({ url, o }); return { ok: true, status: 200, json: async () => ({}) } } return f(url, o) } })
  q.p.start({ pasta: path.join(semApi.dir, 'dados'), porta: 3100 })
  const id2 = (await chamar(q.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  await esperarResultado(q.r, id2)
  const h = await chamar(q.r.post['/ativar'], { body: { id: id2, alternativa: 0 } })
  assert.equal(h.via, 'http')
  assert.equal(pedidos[0].url, `http://localhost:3100/signalk/v2/api/resources/routes/${h.rota}`)
  assert.equal(pedidos[0].o.method, 'PUT')
  assert.equal(pedidos[1].url, 'http://localhost:3100/signalk/v2/api/vessels/self/navigation/course/activeRoute')
  assert.deepEqual(JSON.parse(pedidos[1].o.body), { href: `/resources/routes/${h.rota}`, pointIndex: 1 })
})

test('destino "rota-ativa": o fim da rota ativa no SignalK', async () => {
  const app = appFalso({ rotaAtiva: [[38.8, -9.6], [39.2, -9.5], [39.31, -9.42]] })
  app.leiturasFalhadas = 0
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'rota-ativa', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(x.estado, 'pronto', x.erro)
  assert.equal(x.resultado.destino.id, 'peniche') // o fim é o largo de Peniche
})
