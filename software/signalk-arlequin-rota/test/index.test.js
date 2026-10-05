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
  const app = { self: {}, horas: {}, estado: '', erroPlugin: null, erros: [], recursos: new Map(), ativacoes: [], leiturasFalhadas: 2 }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-rota-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  // cada valor com a hora (como o SignalK): a de app.horas, ou a do relógio do plugin (um valor fresco)
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p], timestamp: app.horas[p] ?? new Date(app.relogio ? app.relogio() : AGORA).toISOString() } : undefined)
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (s) => { app.erroPlugin = s }
  app.error = (e) => { app.erros.push(e) }
  if (comApi) {
    app.resourcesApi = {
      setResource: async (tipo, id, dados) => { app.recursos.set(`${tipo}/${id}`, dados) },
      // como no servidor, a escrita do fornecedor não é imediata: as 2 primeiras leituras falham
      getResource: async (tipo, id) => { if (app.leiturasFalhadas-- > 0) throw new Error('ainda não'); const r = app.recursos.get(`${tipo}/${id}`); if (!r) throw new Error('não existe'); return r },
      deleteResource: async (tipo, id) => { app.recursos.delete(`${tipo}/${id}`) }
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

// fabrica: o index.js carregado de outra maneira (auditoria M-20: ajuda.comOutro); por omissão o verdadeiro
function plugin (app, extra = {}, fabrica = criar) {
  let agora = AGORA
  const registo = []
  app.relogio = () => agora
  const p = fabrica(app, { fetch: fetchFalso(registo), relogio: () => agora, esperar: async () => {}, costa, ...extra })
  return { p, r: rotas(p), registo, avancar: (ms) => { agora += ms } }
}

test('com a segurança do SignalK (2.33: router.access), os GET registam-se "readonly" e os POST "readwrite"; nada fica só para admin (revisão final, 4)', () => {
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
  assert.deepEqual(direto, [], 'nenhuma rota sem nível (ficava só para admin)')
  const nivel = Object.fromEntries(registos.map(x => [`${x.m} ${x.k}`, x.nivel]))
  assert.deepEqual(nivel, {
    'POST /calcular': 'readwrite',
    'GET /resultado/:id': 'readonly',
    'GET /destinos': 'readonly',
    'POST /destinos': 'readwrite',
    'POST /ativar': 'readwrite',
    'POST /plano-telegram': 'readwrite',
    'GET /plano-ativo': 'readonly',
    'POST /plano-ativo/terminar': 'readwrite',
    'POST /plano-ativo/continuar': 'readwrite',
    'POST /plano-ativo/estou-bem': 'readwrite',
    'POST /plano-ativo/chegada': 'readwrite',
    'GET /plano-telegram/:pedido': 'readonly'
  })
  assert.ok(registos.every(x => x.h === 'function'))
})

test('antes de arrancar tudo dá 503; com a polar em falta não arranca e diz porquê', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  assert.equal((await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).code, 503)
  assert.equal((await chamar(r.get['/resultado/:id'], { params: { id: 'x' } })).code, 503)
  assert.equal((await chamar(r.get['/destinos'])).code, 503)
  assert.equal((await chamar(r.post['/destinos'], { body: {} })).code, 503)
  assert.equal((await chamar(r.post['/ativar'], { body: {} })).code, 503)
  p.start({ pasta: path.join(app.dir, 'dados'), polar: path.join(app.dir, 'nao-existe.csv') })
  // (auditoria I-32: o que falta em pt-PT; o erro do Node no registo)
  assert.equal(app.erroPlugin, `não arrancou: falta o ficheiro ${path.join(app.dir, 'nao-existe.csv')}`)
  assert.ok(app.erros.some(m => /^arranque: ENOENT/.test(m)), JSON.stringify(app.erros))
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
  // (auditoria M-17: uma só resposta — a de 29/09 às 15:32, só eu, para Peniche)
  assert.deepEqual({ tipo: x.resultado.veredicto.tipo, texto: x.resultado.veredicto.texto }, { tipo: 'espera', texto: 'Espera até amanhã às 06:30' })
  assert.equal(x.resultado.alternativas.length, 3)
  assert.deepEqual(x.resultado.previsao.idadeH, 0)
  assert.equal(app.estado, 'Última rota: Espera até amanhã às 06:30')
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
  // (auditoria I-32: "sem rede", o erro do fetch fica no registo)
  assert.equal(w.erro, 'Sem previsão que cubra a rota: sem rede e não há previsão guardada que cubra a rota. Não calculo sem previsão.')
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
  // uma aproximação válida (2 pontos iguais, entrada 1: o costa.js exige entrada ≥ 1), como o destino avulso da rota ativa
  assert.deepEqual({ id: a.destino.id, largo: a.destino.largo, aproximacao: a.destino.aproximacao, entrada: a.destino.entrada, meu: a.destino.meu }, { id: 'meu-fundeadouro-da-arrabida', largo: [38.45123, -8.95], aproximacao: [[38.45123, -8.95], [38.45123, -8.95]], entrada: 1, meu: true })
  assert.deepEqual(costa.verificarAproximacao(a.destino), [])
  const b = await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro da Arrábida', posicaoAtual: true, conhecido: false, abrigo: false } })
  assert.equal(b.destino.id, 'meu-fundeadouro-da-arrabida-2')
  const l1 = await chamar(r.get['/destinos'])
  assert.equal(l1.destinos.length, 17)
  const gravado = JSON.parse(fs.readFileSync(path.join(app.dir, 'plugin', 'destinos.json'), 'utf8'))
  assert.equal(gravado.length, 2)
  // um destino do Ivo serve para calcular: há alternativas, nenhuma "entrada mal definida"
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'meu-fundeadouro-da-arrabida', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(x.estado, 'pronto', x.erro)
  assert.equal(x.resultado.destino.nome, 'Fundeadouro da Arrábida')
  assert.ok(x.resultado.alternativas.length > 0, JSON.stringify(x.resultado.veredicto))
  assert.ok(!JSON.stringify(x.resultado).includes('entrada mal definida'), JSON.stringify(x.resultado.veredicto))
  // e a partir dele (o barco fundeado lá): parte do destino do Ivo, com alternativas
  app.self['navigation.position'] = { latitude: 38.45123, longitude: -8.95 }
  const y = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'alges', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(y.estado, 'pronto', y.erro)
  assert.equal(y.resultado.partida.id, 'meu-fundeadouro-da-arrabida')
  assert.ok(y.resultado.alternativas.length > 0, JSON.stringify(y.resultado.veredicto))
  assert.ok(!JSON.stringify(y.resultado).includes('entrada mal definida'), JSON.stringify(y.resultado.veredicto))
  // a rota não repete o ponto de partida (os 2 pontos iguais da aproximação juntam-se)
  const rota = y.resultado.alternativas[0].rota
  for (let i = 1; i < rota.length; i++) assert.notDeepEqual(rota[i], rota[i - 1], `ponto ${i} repetido`)
})

test('I3: "abrigo" só se o Ivo o marcar (por omissão false); os destinos já gravados com a aproximação de 1 ponto corrigem-se ao ler', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const a = await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro', lat: 38.4512, lon: -8.95, conhecido: false } })
  assert.equal(a.code, 201, a.erro)
  assert.equal(a.destino.abrigo, false)
  assert.equal((await chamar(r.post['/destinos'], { body: { nome: 'X', lat: 38.4512, lon: -8.95, conhecido: false, abrigo: 'sim' } })).code, 400)
  // um ficheiro antigo (gravado antes da correção): aproximacao de 1 ponto e entrada 0
  const antigo = { id: 'meu-velho', nome: 'Velho', abrigo: true, conhecido: true, largo: [38.45, -8.96], aproximacao: [[38.45, -8.96]], entrada: 0, notas: 'acrescentado no ecrã', confirmado: false }
  fs.writeFileSync(path.join(app.dir, 'plugin', 'destinos.json'), JSON.stringify([antigo]))
  const l = await chamar(r.get['/destinos'])
  const v = l.destinos.find(d => d.id === 'meu-velho')
  assert.deepEqual({ aproximacao: v.aproximacao, entrada: v.entrada, abrigo: v.abrigo }, { aproximacao: [[38.45, -8.96], [38.45, -8.96]], entrada: 1, abrigo: true })
  assert.deepEqual(costa.verificarAproximacao(v), [])
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
  // (auditoria I-32: a frase do servidor em inglês fica no registo; ao Ivo, em pt-PT)
  assert.equal(e.erro, 'não ativei a rota: o SignalK ainda não tem a posição do barco (sem GPS?)')
  assert.ok(app.erros.some(m => m === 'ativar: Unable to retrieve vessel position'), JSON.stringify(app.erros))

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

test('o cálculo recebe o registo (app.error); /ativar de uma rota direta e de uma pelo Canal da Berlenga: nomes sem "null", a nota do canal', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  let depsVistas = null
  const pts = [{ lat: 39.35, lon: -9.38, nome: 'Peniche (partida)' }, { lat: 39.4, lon: -9.45, nome: 'Canal da Berlenga' }, { lat: 39.59, lon: -9.08, nome: 'Nazaré' }]
  const comum = { partida: '2026-09-29T14:32:00.000Z', chegada: { p10: '2026-09-29T20:00:00.000Z', p50: '2026-09-29T20:30:00.000Z', p90: '2026-09-29T21:00:00.000Z' }, propulsao: 'vela', pontosRota: pts, rota: pts.map(p => [p.lat, p.lon]) }
  const direta = { ...comum, id: 'direto-vela', nome: 'Agora, direta (salto curto), vela e motor', afastamento: null, direto: true, canal: null, nota: null, milhas: 7.2 }
  const nota = 'Canal da Berlenga: terra dos dois lados; só com ondas < 3 m — por confirmar na carta'
  const canal = { ...comum, id: '0-5mn-canal-da-berlenga-vela', nome: 'Agora, 5 MN pelo Canal da Berlenga, vela e motor', afastamento: 5, direto: false, canal: 'Canal da Berlenga', nota, milhas: 30.4 }
  calculo.calcular = async (entrada, deps) => {
    depsVistas = deps
    return { veredicto: { tipo: 'segue', texto: 'Segue agora', porque: [] }, destino: { id: 'nazare', nome: 'Nazaré' }, alternativas: [direta, canal] }
  }
  try {
    const app = appFalso()
    app.leiturasFalhadas = 0
    const { p, r } = plugin(app)
    p.start({ pasta: path.join(app.dir, 'dados') })
    const id = (await chamar(r.post['/calcular'], { body: { destino: 'nazare', tripulacao: 'so' } })).id
    assert.equal((await esperarResultado(r, id)).estado, 'pronto')
    // o registo dos erros da geometria vai para app.error, com a mensagem do erro
    assert.equal(typeof depsVistas.log, 'function')
    depsVistas.log('signalk-arlequin-rota: erro ao gerar uma rota', new Error('ponto inválido'))
    depsVistas.log('signalk-arlequin-rota: canal inválido')
    assert.deepEqual(app.erros, ['signalk-arlequin-rota: erro ao gerar uma rota: ponto inválido', 'signalk-arlequin-rota: canal inválido'])
    // a direta: sem "null MN" no nome nem na descrição
    const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
    assert.equal(a.code, 200, a.erro)
    const d0 = app.recursos.get(`routes/${a.rota}`)
    assert.equal(d0.name, 'Arlequin → Nazaré (Agora, direta (salto curto), vela e motor)')
    assert.match(d0.description, /^Melhor rota: direta \(salto curto\), vela e motor, /)
    assert.ok(!JSON.stringify(d0).match(/null|NaN|undefined/), JSON.stringify(d0))
    assert.equal(a.nota, null)
    // pelo canal: a nota vai na rota gravada e na resposta
    const b = await chamar(r.post['/ativar'], { body: { id, alternativa: canal.id } })
    assert.equal(b.code, 200, b.erro)
    const d1 = app.recursos.get(`routes/${b.rota}`)
    assert.match(d1.description, /^Melhor rota: 5 MN pelo Canal da Berlenga, vela e motor, /)
    assert.ok(d1.description.endsWith(`. ${nota}`), d1.description)
    assert.equal(b.nota, nota)
  } finally { calculo.calcular = original }
})

test('M2: a descrição da rota gravada tem as horas de Lisboa (HH:MM), não o UTC em bruto com milissegundos', async () => {
  const app = appFalso()
  app.leiturasFalhadas = 0
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  const x = await esperarResultado(r, id)
  assert.equal(x.estado, 'pronto', x.erro)
  const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const desc = app.recursos.get(`routes/${a.rota}`).description
  // (auditoria M-17: uma só resposta — a alternativa de 29/09 chega amanhã às 07:19)
  assert.ok(desc.includes(', partida às 15:32, chegada prevista amanhã às 07:19 (hora de Lisboa)'), desc)
  assert.ok(!/\d{4}-\d\d-\d\dT|\.\d{3}Z/.test(desc), desc)
})

test('M3: stop() com um cálculo a correr — o cálculo acaba bem (as opções ficam com ele), sem erro em inglês', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  p.stop()
  // parado, o REST dá 503; o trabalho continua e acaba
  assert.equal((await chamar(r.get['/resultado/:id'], { params: { id } })).code, 503)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const x = await esperarResultado(r, id)
  assert.equal(x.estado, 'pronto', x.erro)
  assert.ok(!/Cannot read|null/.test(JSON.stringify(x.erro ?? '')))
})

// ---------- plano pelo Telegram (3b-1) ----------
const { EventEmitter } = require('node:events')
const MOTIVO_PORTO = 'o plugin porto não respondeu (está ligado? tem o token?)'
const CASCAIS = c.P(costa.destinos.find(d => d.id === 'cascais').aproximacao.at(-1))

// o app falso com eventos (o servidor SignalK é um EventEmitter), parado em Cascais (o cálculo até Algés é curto)
function appComEventos () {
  const app = Object.assign(new EventEmitter(), appFalso())
  app.self['navigation.position'] = { latitude: CASCAIS.lat, longitude: CASCAIS.lon }
  return app
}
async function calculado (r) {
  const a = await chamar(r.post['/calcular'], { body: { destino: 'alges', tripulacao: 'so' } })
  const x = await esperarResultado(r, a.id)
  assert.equal(x.estado, 'pronto', x.erro)
  return a.id
}

test('POST /plano-telegram: 404 e 409; 202 { pedido } e o evento arlequin:plano com o texto (barco da configuração) e o GPX; "enviado" com a resposta do porto', async () => {
  const app = appComEventos()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados'), barco: { corCasco: 'branco' }, telefones: { ivo: '+351 912 345 678' } })
  const eventos = []
  app.on('arlequin:plano', (e) => eventos.push(e))
  const a = await chamar(r.post['/calcular'], { body: { destino: 'alges', tripulacao: 'so' } })
  assert.equal((await chamar(r.post['/plano-telegram'], { body: { id: a.id, alternativa: 0 } })).code, 409)
  await esperarResultado(r, a.id)
  assert.equal((await chamar(r.post['/plano-telegram'], { body: { id: 'nao-existe', alternativa: 0 } })).code, 404)
  const x404 = await chamar(r.post['/plano-telegram'], { body: { id: a.id, alternativa: 7 } })
  assert.equal(x404.code, 404)
  assert.equal(x404.erro, 'alternativa desconhecida')
  assert.equal(eventos.length, 0)

  const x = await chamar(r.post['/plano-telegram'], { body: { id: a.id, alternativa: 0 } })
  assert.equal(x.code, 202)
  assert.match(x.pedido, /^[0-9a-f-]{36}$/)
  assert.equal(eventos.length, 1)
  const e = eventos[0]
  assert.deepEqual(Object.keys(e), ['pedido', 'texto', 'gpx', 'nomeFicheiro'])
  assert.equal(e.pedido, x.pedido)
  assert.match(e.texto, /^Barco: ARLEQUIN, Jeanneau Melody 34, casco branco$/m)
  assert.match(e.texto, /liga ao Ivo \(\+351 912 345 678\)/)
  assert.match(e.texto, /^Destino: Algés \(CNA\)$/m)
  assert.match(e.texto, /^Rota: direta \(salto curto\), /m)
  assert.match(e.gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/)
  assert.match(e.nomeFicheiro, /^arlequin-cascais-alges-cna-\d{8}-\d{4}\.gpx$/)
  // pela alternativa também se aceita o id (como no /ativar)
  const alt1 = (await chamar(r.get['/resultado/:id'], { params: { id: a.id } })).resultado.alternativas[1]
  assert.equal((await chamar(r.post['/plano-telegram'], { body: { id: a.id, alternativa: alt1.id } })).code, 202)

  const antes = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: x.pedido } })
  assert.deepEqual({ estado: antes.estado, entregues: antes.entregues, contactos: antes.contactos, falhas: antes.falhas }, { estado: 'a enviar', entregues: [], contactos: [], falhas: [] })
  app.emit('arlequin:plano-enviado', { pedido: x.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], falhas: [{ nome: 'Tio', erro: 'Telegram sendMessage: Forbidden: bot was blocked by the user' }] })
  const depois = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: x.pedido } })
  assert.equal(depois.estado, 'enviado')
  assert.deepEqual(depois.entregues, ['chat 111', 'Mãe'])
  // os contactos em terra que o receberam (revisão final, 3): o ecrã só marca a precaução com eles
  assert.deepEqual(depois.contactos, ['Mãe'])
  // um porto antigo (sem contactos na resposta): nenhum em terra
  const y = await chamar(r.post['/plano-telegram'], { body: { id: a.id, alternativa: 0 } })
  app.emit('arlequin:plano-enviado', { pedido: y.pedido, entregues: ['chat 111'], falhas: [] })
  const gy = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: y.pedido } })
  assert.equal(gy.estado, 'enviado')
  assert.deepEqual(gy.contactos, [])
  assert.deepEqual(depois.falhas, [{ nome: 'Tio', erro: 'Telegram sendMessage: Forbidden: bot was blocked by the user' }])
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: 'nao-existe' } })).code, 404)
  p.stop()
  assert.equal(app.listenerCount('arlequin:plano-enviado'), 0, 'o stop() tira o ouvinte')
})

test('plano "falhou": o porto responde sem nenhuma entrega; e sem resposta em 30 s, com o motivo (uma resposta tardia já não muda nada)', async () => {
  const app = appComEventos()
  // o relógio dos 30 s injetado: o teste dispara-o à mão (sem depender de esperas reais)
  const agendados = []
  const { p, r } = plugin(app, { agendar: (fn, ms) => { agendados.push({ fn, ms, cancelado: false }); return agendados.at(-1) }, cancelar: (t) => { if (t) t.cancelado = true } })
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = await calculado(r)
  app.on('arlequin:plano', (e) => app.emit('arlequin:plano-enviado', { pedido: e.pedido, entregues: [], falhas: [{ nome: 'Telegram', erro: 'o plugin porto não tem o token do bot' }] }))
  const a = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  const ra = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: a.pedido } })
  assert.equal(ra.estado, 'falhou')
  assert.equal(ra.motivo, 'Telegram: o plugin porto não tem o token do bot')
  assert.equal(agendados.length, 1)
  assert.equal(agendados[0].ms, 30000)
  assert.ok(agendados[0].cancelado, 'a resposta cancela o limite')
  app.removeAllListeners('arlequin:plano')
  // sem resposta do porto (ligado, a ouvir, mas não responde)
  app.on('arlequin:plano', () => {})
  const b = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: b.pedido } })).estado, 'a enviar')
  assert.equal(agendados.length, 2)
  agendados[1].fn() // passaram 30 s
  const rb = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: b.pedido } })
  assert.equal(rb.estado, 'falhou')
  assert.equal(rb.motivo, MOTIVO_PORTO)
  app.emit('arlequin:plano-enviado', { pedido: b.pedido, entregues: ['chat 111'], falhas: [] })
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: b.pedido } })).estado, 'falhou')
  // o porto sem destinatários
  app.on('arlequin:plano', (e) => app.emit('arlequin:plano-enviado', { pedido: e.pedido, entregues: [], falhas: [] }))
  const c0 = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.match((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: c0.pedido } })).motivo, /não há destinatários/)
  p.stop()
  assert.deepEqual(app.erros, [])
})

test('POST /plano-telegram com o plugin parado: 503; sem eventos no servidor: 503 com a explicação', async () => {
  const app = appComEventos()
  const { p, r } = plugin(app)
  assert.equal((await chamar(r.post['/plano-telegram'], { body: { id: 'x', alternativa: 0 } })).code, 503)
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: 'x' } })).code, 503)
  const semEventos = appFalso()
  semEventos.self['navigation.position'] = { latitude: CASCAIS.lat, longitude: CASCAIS.lon }
  const q = plugin(semEventos)
  q.p.start({ pasta: path.join(semEventos.dir, 'dados') })
  const id = await calculado(q.r)
  const x = await chamar(q.r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(x.code, 503)
  assert.match(x.erro, /não dá para enviar o plano/)
  q.p.stop()
  p.stop()
})

const MOTIVO_REINICIO = 'o plugin da rota foi reiniciado durante o envio: confirma com os contactos se receberam'
const AVISO_SEM_TELEFONE = 'o teu telefone não está na configuração: o plano diz só "liga ao Ivo"'
const agendadorFalso = () => {
  const agendados = []
  return { agendados, agendar: (fn, ms) => { const t = { fn, ms, cancelado: false }; agendados.push(t); return t }, cancelar: (t) => { if (t) t.cancelado = true } }
}

test('POST /plano-telegram com o plugin porto desligado (ninguém a ouvir arlequin:plano): 503 logo, sem esperar os 30 s (revisão final, 10)', async () => {
  const app = appComEventos()
  const ag = agendadorFalso()
  const { p, r } = plugin(app, ag)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = await calculado(r)
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(x.code, 503)
  assert.equal(x.erro, 'o plugin porto está desligado: liga-o em Plugin Config')
  assert.equal(ag.agendados.length, 0, 'nada fica a enviar')
  p.stop()
})

test('stop() a meio de um envio: o plano "a enviar" fica "falhou" com o motivo (não fica a enviar para sempre); depois do start, uma resposta tardia não muda nada', async () => {
  const app = appComEventos()
  const ag = agendadorFalso()
  const { p, r } = plugin(app, ag)
  const pasta = path.join(app.dir, 'dados')
  p.start({ pasta })
  const id = await calculado(r)
  app.on('arlequin:plano', () => {}) // o porto ligado, ainda sem resposta
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  p.stop()
  assert.ok(ag.agendados[0].cancelado)
  p.start({ pasta })
  const g = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: x.pedido } })
  assert.equal(g.estado, 'falhou')
  assert.equal(g.motivo, MOTIVO_REINICIO)
  app.emit('arlequin:plano-enviado', { pedido: x.pedido, entregues: ['chat 111'], falhas: [] })
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: x.pedido } })).estado, 'falhou')
  p.stop()
})

test('a lista de planos (20) nunca tira um pedido ainda "a enviar"; tira primeiro os que já acabaram', async () => {
  const app = appComEventos()
  const { p, r } = plugin(app, agendadorFalso())
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = await calculado(r)
  app.on('arlequin:plano', () => {}) // o porto ligado, ainda sem resposta
  const pedidos = []
  for (let i = 0; i < 22; i++) pedidos.push((await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })).pedido)
  // 22 a enviar: nenhum sai
  for (const k of pedidos) assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: k } })).estado, 'a enviar')
  // o 5.º acaba: no próximo pedido é ele que sai (não o 1.º, que ainda está a enviar)
  app.emit('arlequin:plano-enviado', { pedido: pedidos[4], entregues: ['chat 111'], falhas: [] })
  const novo = (await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })).pedido
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: pedidos[4] } })).code, 404)
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: pedidos[0] } })).estado, 'a enviar')
  assert.equal((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: novo } })).estado, 'a enviar')
  p.stop()
})

test('POST /plano-telegram: sem chegada mais tarde → 422 com o motivo (nada se envia); o plano que não se monta → 500; um ouvinte que lança → "falhou" com o motivo', async () => {
  const app = appComEventos()
  const { p, r } = plugin(app, agendadorFalso())
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = await calculado(r)
  const eventos = []
  app.on('arlequin:plano', (e) => eventos.push(e))
  // o resultado guardado (o GET devolve o mesmo objeto): estraga-se para cada caso
  const res = (await chamar(r.get['/resultado/:id'], { params: { id } })).resultado
  const alt = res.alternativas[0]
  const p90 = alt.chegada.p90
  alt.chegada.p90 = null
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(x.code, 422)
  assert.equal(x.erro, 'sem hora de chegada mais tarde: não há hora de alarme, o plano não foi enviado')
  alt.chegada.p90 = p90
  alt.pontosRota.push(null)
  const y = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(y.code, 500)
  assert.match(y.erro, /^não montei o plano: /)
  alt.pontosRota.pop()
  assert.equal(eventos.length, 0)
  app.on('arlequin:plano', () => { throw new Error('o ouvinte rebentou') })
  const z = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(z.code, 202)
  const gz = await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: z.pedido } })
  assert.equal(gz.estado, 'falhou')
  // (auditoria I-32: o erro do ouvinte fica no registo)
  assert.equal(gz.motivo, 'não foi possível enviar: o plugin porto deu um erro (o pormenor ficou no registo)')
  assert.ok(app.erros.some(m => /o ouvinte rebentou/.test(m)), JSON.stringify(app.erros))
  p.stop()
})

test('POST /plano-telegram de um cálculo antigo (a hora de alarme já passou): 422 com o motivo e nada se envia (revisão final, 2)', async () => {
  const app = appComEventos()
  const { p, r, avancar } = plugin(app, agendadorFalso())
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = await calculado(r)
  const eventos = []
  app.on('arlequin:plano', (e) => eventos.push(e))
  // o resultado fica guardado no plugin (e no ecrã): no dia seguinte já não serve
  avancar(24 * 3600000)
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(x.code, 422)
  assert.match(x.erro, /^este cálculo é antigo: a hora de alarme já passou \(.+\) — calcula outra vez antes de enviar o plano$/)
  assert.equal(eventos.length, 0)
  p.stop()
})

test('sem o telefone do Ivo na configuração, o plano vai na mesma, mas o POST e o GET trazem o aviso; com o telefone, avisos vazio', async () => {
  const app = appComEventos()
  const { p, r } = plugin(app, agendadorFalso())
  const pasta = path.join(app.dir, 'dados')
  p.start({ pasta, telefones: { ivo: '  ' } })
  const id = await calculado(r)
  const eventos = []
  app.on('arlequin:plano', (e) => eventos.push(e))
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal(x.code, 202)
  assert.deepEqual(x.avisos, [AVISO_SEM_TELEFONE])
  assert.match(eventos[0].texto, /liga ao Ivo\. Se não atender/)
  assert.deepEqual((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: x.pedido } })).avisos, [AVISO_SEM_TELEFONE])
  p.stop()
  p.start({ pasta, telefones: { ivo: '+351 912 345 678' } })
  const y = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.deepEqual(y.avisos, [])
  assert.deepEqual((await chamar(r.get['/plano-telegram/:pedido'], { params: { pedido: y.pedido } })).avisos, [])
  p.stop()
})

test('o id dos destinos do Ivo usa o mesmo slug (30 letras)', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const x = await chamar(r.post['/destinos'], { body: { nome: 'Praia da Ursa — fundeadouro do norte', lat: 38.79, lon: -9.6, conhecido: true } })
  assert.equal(x.code, 201, x.erro)
  assert.equal(x.destino.id, `meu-${require('../lib/slug').slug('Praia da Ursa — fundeadouro do norte', 30)}`)
  p.stop()
})

test('auditoria I-12: o gasóleo e o SoC só contam com leitura fresca (≤ 2 min, como as outras) e sem o aviso de sonda perdida (gasóleo) ou de sensor perdido (SmartShunt); senão ficam desconhecidos — falha segura: o cálculo assume e avisa em vermelho', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const vistos = []
  calculo.calcular = async (entrada) => { vistos.push(entrada.instrumentos); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  try {
    const app = appFalso()
    const pl = plugin(app)
    pl.p.start({ pasta: path.join(app.dir, 'dados') })
    const instrumentos = async () => { await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id); return vistos.at(-1) }
    let i = await instrumentos()
    assert.equal(i.socPct, 90)
    assert.equal(i.gasoleoL, 124)
    // velhos (mais de 2 min): desconhecidos
    app.horas['tanks.fuel.0.currentVolume'] = new Date(AGORA - 3 * 60000).toISOString()
    app.horas['electrical.batteries.servico.capacity.stateOfCharge'] = new Date(AGORA - 3 * 60000).toISOString()
    i = await instrumentos()
    assert.equal(i.gasoleoL, null)
    assert.equal(i.socPct, null)
    // frescos, mas com a sonda do gasóleo e o SmartShunt perdidos (o plugin do gasóleo continua a publicar os
    // litros descontados pelo consumo; o do SoC pode ficar parado)
    app.horas = {}
    app.self['notifications.tanks.fuel.0.sondaPerdida'] = { state: 'warn', method: ['visual'], message: 'Sonda do gasóleo sem leitura há mais de 5 min' }
    app.self['notifications.arlequin.energia.sensorPerdido'] = { state: 'warn', method: ['visual'], message: 'Sem dados do SmartShunt há mais de 5 min' }
    i = await instrumentos()
    assert.equal(i.gasoleoL, null)
    assert.equal(i.socPct, null)
    // de volta a normal: contam outra vez
    app.self['notifications.tanks.fuel.0.sondaPerdida'] = { state: 'normal', method: [], message: 'Normal' }
    app.self['notifications.arlequin.energia.sensorPerdido'] = { state: 'normal', method: [], message: 'Normal' }
    i = await instrumentos()
    assert.equal(i.gasoleoL, 124)
    assert.equal(i.socPct, 90)
    // pelo nível e pela capacidade (sem o volume): também só fresco
    delete app.self['tanks.fuel.0.currentVolume']
    app.self['tanks.fuel.0.currentLevel'] = 0.5
    app.self['tanks.fuel.0.capacity'] = 0.2
    assert.equal((await instrumentos()).gasoleoL, 100)
    app.horas['tanks.fuel.0.currentLevel'] = new Date(AGORA - 3 * 60000).toISOString()
    assert.equal((await instrumentos()).gasoleoL, null)
    pl.p.stop()
  } finally { calculo.calcular = original }
})

test('auditoria I-13 (decisão n.º 4, contrato C5): o esquema dá o banco de serviço de 440 Ah e o fator solar 0,65; uma configuração gravada com o valor por omissão antigo (200 Ah) conta como não posta (fica 440) e o registo diz porquê; outro valor fica', async () => {
  const calculo = require('../lib/calculo')
  const energia = require('../lib/energia')
  const original = calculo.calcular
  const opcoes = []
  calculo.calcular = async (entrada, deps) => { opcoes.push(deps.opcoes); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  try {
    const app = appFalso()
    const pl = plugin(app)
    const e = pl.p.schema.properties.energia.properties
    assert.equal(e.capacidadeAh.default, 440)
    assert.equal(e.fatorSolar.default, 0.65)
    assert.equal(e.capacidadeAh.default, energia.PADRAO.capacidadeAh)
    assert.equal(e.fatorSolar.default, energia.PADRAO.fatorSolar)
    const calc = async () => { await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id); return opcoes.at(-1).energia }
    // a configuração antiga do Admin UI (todos os campos escritos, com os 200 Ah de antes)
    pl.p.start({ pasta: path.join(app.dir, 'dados'), energia: { capacidadeAh: 200, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 1.65, rendimento: 0.2, alternadorA: 45 } })
    const x = await calc()
    // (F2b Menor 5: os 200 Ah antigos passam a 440 explícitos — e gravados na configuração, ver o teste a seguir —
    // em vez de se apagarem da cópia em memória)
    assert.equal(x.capacidadeAh, 440, 'os 200 Ah antigos passam ao banco de serviço (o padrão do lib/energia.js)')
    assert.equal(energia.criarEnergia(x).config.capacidadeAh, 440)
    assert.equal(energia.criarEnergia(x).config.fatorSolar, 0.65)
    assert.equal(x.consumoNoiteA, 6)
    assert.ok(app.erros.some(m => /capacidadeAh.*200.*440 Ah/.test(m)), JSON.stringify(app.erros))
    pl.p.stop()
    // um banco posto à mão com outro valor fica
    pl.p.start({ pasta: path.join(app.dir, 'dados'), energia: { capacidadeAh: 300, fatorSolar: 0.5 } })
    const y = await calc()
    assert.equal(y.capacidadeAh, 300)
    assert.equal(y.fatorSolar, 0.5)
    pl.p.stop()
  } finally { calculo.calcular = original }
})

test('auditoria M-13 (parte index.js): os limites de segurança do desenho 3a ("configuráveis") estão no esquema, com os valores do lib/seguranca.js, e chegam ao cálculo (só os números)', async () => {
  const seguranca = require('../lib/seguranca')
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const opcoes = []
  calculo.calcular = async (entrada, deps) => { opcoes.push(deps.opcoes); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  try {
    const app = appFalso()
    const pl = plugin(app)
    const esquema = pl.p.schema.properties.seguranca.properties
    assert.deepEqual(Object.keys(esquema), [...seguranca.LIMITES])
    for (const k of seguranca.LIMITES) {
      assert.equal(esquema[k].type, 'number')
      assert.equal(esquema[k].default, seguranca.PADRAO[k], k)
      assert.ok(esquema[k].title.length > 5)
    }
    pl.p.start({ pasta: path.join(app.dir, 'dados'), seguranca: { ventoMaxAcompanhado: 25, ondasMax: 'muito' } })
    await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado' } })).id)
    assert.deepEqual(opcoes.at(-1).seguranca, { ventoMaxAcompanhado: 25 })
    pl.p.stop()
  } finally { calculo.calcular = original }
})

test('F9 (item 2): o título da opção lemeMaxH diz o que a regra mede — as horas EQUIVALENTES ao leme da passagem toda (o motor em calma conta metade; lib/seguranca.js horasLemeEquivalentes), não "horas seguidas"', () => {
  const titulo = plugin(appFalso()).p.schema.properties.seguranca.properties.lemeMaxH.title
  assert.match(titulo, /equivalentes/, titulo)
  assert.match(titulo, /passagem toda/, titulo)
  assert.match(titulo, /só eu/, titulo)
  assert.doesNotMatch(titulo, /seguidas/, titulo)
})

test('auditoria I-16 (parte index.js): a tendência do barómetro em 3 h (as amostras de minuto a minuto que o plugin guarda) chega ao cálculo; sem 3 h de amostras, null', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const vistos = []
  calculo.calcular = async (entrada) => { vistos.push(entrada.instrumentos); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  try {
    const app = appFalso()
    const pl = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {} })
    pl.p.start({ pasta: path.join(app.dir, 'dados') })
    const instrumentos = async () => { await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id); return vistos.at(-1) }
    // a pressão a cair 2 Pa por minuto (0,02 hPa), de minuto a minuto
    for (let m = 0; m <= 60; m++) { app.self['environment.outside.pressure'] = 101500 - 2 * m; pl.avancar(60000); await pl.p.cicloNavegar() }
    assert.equal((await instrumentos()).tendPressao3h, null, 'só 1 h de amostras')
    for (let m = 61; m <= 185; m++) { app.self['environment.outside.pressure'] = 101500 - 2 * m; pl.avancar(60000); await pl.p.cicloNavegar() }
    const t = (await instrumentos()).tendPressao3h
    assert.ok(Math.abs(t - (-3.6)) < 1e-6, `${t}`)
    pl.p.stop()
  } finally { calculo.calcular = original }
})

test('auditoria M-11 (parte index.js): com o vento descarregado e o pedido do mar falhado, as ondas vêm da previsão guardada mais recente que as tem (com o aviso); sem nenhuma guardada, "Sem previsão do mar"', async () => {
  const app = appFalso()
  const { p, r, avancar } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  // a 1.ª, com rede: arquiva o vento e o mar
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(x.estado, 'pronto', x.erro)
  p.stop()
  // 2 h depois, o Open-Meteo do mar não responde (só o do vento)
  avancar(2 * H)
  const f = fetchFalso()
  const semMar = plugin(app, { fetch: async (url, o) => { if (new URL(url).hostname.startsWith('marine')) throw new Error('fetch failed'); return f(url, o) } })
  semMar.avancar(2 * H)
  semMar.p.start({ pasta: path.join(app.dir, 'dados') })
  const y = await esperarResultado(semMar.r, (await chamar(semMar.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(y.estado, 'pronto', y.erro)
  assert.equal(y.resultado.previsao.idadeH, 0, 'o vento é o de agora')
  assert.ok(y.resultado.avisos.includes('Ondas da previsão guardada há 2 h (o pedido do mar falhou)'), JSON.stringify(y.resultado.avisos))
  assert.ok(!y.resultado.avisos.some(a => a.startsWith('Sem previsão do mar')), JSON.stringify(y.resultado.avisos))
  semMar.p.stop()
  // sem nenhuma previsão do mar guardada: fica desconhecido, com o aviso
  const vazio = appFalso()
  const nada = plugin(vazio, { fetch: async (url, o) => { if (new URL(url).hostname.startsWith('marine')) throw new Error('fetch failed'); return f(url, o) } })
  nada.p.start({ pasta: path.join(vazio.dir, 'dados') })
  const z = await esperarResultado(nada.r, (await chamar(nada.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id)
  assert.equal(z.estado, 'pronto', z.erro)
  assert.ok(z.resultado.avisos.some(a => a.startsWith('Sem previsão do mar')), JSON.stringify(z.resultado.avisos))
  nada.p.stop()
})

test('auditoria I-32 (parte index.js): ao Ivo só frases em pt-PT — "sem rede" (não "fetch failed"), a API de rumo e o servidor sem o texto em inglês, um erro interno sem o JavaScript; o erro verdadeiro fica no registo do SignalK', async () => {
  // a previsão sem rede (o Node diz "fetch failed") e sem nada guardado
  const vazio = appFalso()
  const nada = plugin(vazio, { fetch: async () => { throw new TypeError('fetch failed') } })
  nada.p.start({ pasta: path.join(vazio.dir, 'dados') })
  const w = await esperarResultado(nada.r, (await chamar(nada.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
  assert.equal(w.erro, 'Sem previsão que cubra a rota: sem rede e não há previsão guardada que cubra a rota. Não calculo sem previsão.')
  assert.ok(vazio.erros.some(m => /fetch failed/.test(m)), JSON.stringify(vazio.erros))
  // a previsão que demora: "não respondeu a tempo"
  const lento = appFalso()
  const l = plugin(lento, { fetch: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) } })
  l.p.start({ pasta: path.join(lento.dir, 'dados') })
  const z = await esperarResultado(l.r, (await chamar(l.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
  assert.equal(z.erro, 'Sem previsão que cubra a rota: a Open-Meteo não respondeu a tempo e não há previsão guardada que cubra a rota. Não calculo sem previsão.')
  // a API de rumo que rebenta com um erro de programação em inglês
  const app = appFalso()
  app.leiturasFalhadas = 0
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const id = (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  await esperarResultado(r, id)
  app.activateRoute = async () => { throw new TypeError("Cannot read properties of undefined (reading 'href')") }
  const e = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(e.code, 502)
  assert.equal(e.erro, 'não ativei a rota: o SignalK recusou a rota (o pormenor ficou no registo)')
  assert.ok(app.erros.some(m => /Cannot read properties/.test(m)), JSON.stringify(app.erros))
  // a rota ativa que o servidor não consegue ler (destino "rota-ativa")
  app.getCourse = async () => ({ activeRoute: { href: '/resources/routes/abc' } })
  app.resourcesApi.getResource = async () => { throw new Error('Resource not found: abc') }
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'rota-ativa', tripulacao: 'so' } })).id)
  assert.equal(x.erro, 'não consegui ler a rota ativa do SignalK (o pormenor ficou no registo)')
  assert.ok(app.erros.some(m => /Resource not found/.test(m)), JSON.stringify(app.erros))
  p.stop()
})

test('auditoria I-37 (o require): o index.js carrega os modelos da AI por um caminho relativo (../signalk-arlequin-ia), como o lib/base.js faz com a polar — instalado com "npm install <pasta>" (o npm 11 não instala as dependências da pasta ligada) não depende do node_modules da rota', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.doesNotMatch(fonte, /require\(['"]signalk-arlequin-ia/)
  const caminho = path.join(__dirname, '..', '..', 'signalk-arlequin-ia', 'lib', 'modelos.js')
  assert.ok(fs.existsSync(caminho), caminho)
  // o mesmo módulo que o lib/cenarios.js usa (o resolvido pelo node_modules aponta para a mesma pasta)
  assert.equal(require.resolve(caminho), fs.realpathSync(require.resolve('signalk-arlequin-ia/lib/modelos')))
  // o lib/cenarios.js também o carrega por um caminho relativo (o comentário do index.js di-lo; F9 item 2)
  const cenarios = fs.readFileSync(path.join(__dirname, '..', 'lib', 'cenarios.js'), 'utf8')
  assert.doesNotMatch(cenarios, /require\(['"]signalk-arlequin-ia/)
  assert.match(cenarios, /require\(path\.join\(__dirname, '\.\.', '\.\.', 'signalk-arlequin-ia', 'lib', 'modelos'\)\)/)
})

test('auditoria M-24: os pedidos à API do servidor têm o mesmo limite de tempo da API de rumo — um pendurado já não deixa o /calcular (409) nem o Ativar presos até reiniciar', async () => {
  const pendurado = () => new Promise(() => {})
  // a rota ativa (destino "rota-ativa"): o getResource que nunca responde
  const app = appFalso({ rotaAtiva: [[38.8, -9.6], [39.31, -9.42]] })
  app.leiturasFalhadas = 0
  const { p, r } = plugin(app, { esperaRumoMs: 20 })
  p.start({ pasta: path.join(app.dir, 'dados') })
  app.resourcesApi.getResource = pendurado
  const x = await esperarResultado(r, (await chamar(r.post['/calcular'], { body: { destino: 'rota-ativa', tripulacao: 'so' } })).id)
  assert.equal(x.estado, 'erro')
  assert.equal(x.erro, 'não consegui ler a rota ativa do SignalK (o pormenor ficou no registo)')
  // o seguinte já corre (antes: 409 "já há um cálculo a correr" até reiniciar o servidor)
  app.resourcesApi.getResource = async (tipo, id) => { const v = app.recursos.get(`${tipo}/${id}`); if (!v) throw new Error('não existe'); return v }
  const id = (await chamar(r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'acompanhado', sairAgora: true } })).id
  assert.equal((await esperarResultado(r, id)).estado, 'pronto')
  // o Ativar: o setResource e o activateRoute que nunca respondem
  app.resourcesApi.setResource = pendurado
  const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 502)
  assert.equal(a.erro, 'não ativei a rota: o SignalK não respondeu a tempo')
  app.resourcesApi.setResource = async (tipo, rid, dados) => { app.recursos.set(`${tipo}/${rid}`, dados) }
  app.activateRoute = pendurado
  const b = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(b.code, 502, 'e o seguinte não fica preso no 409')
  assert.equal(b.erro, 'não ativei a rota: o SignalK não respondeu a tempo')
  p.stop()
})

test('auditoria M-29: no OpenCPN, "direta (salto curto)" só numa alternativa direta (alt.direto, como o plano); uma que não é direta e não tem afastamento não leva "direta"', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const pts = [{ lat: 39.35, lon: -9.38, nome: 'Peniche (partida)' }, { lat: 39.59, lon: -9.08, nome: 'Nazaré' }]
  const comum = { partida: '2026-09-29T14:32:00.000Z', chegada: { p10: '2026-09-29T20:00:00.000Z', p50: '2026-09-29T20:30:00.000Z', p90: '2026-09-29T21:00:00.000Z' }, propulsao: 'vela', pontosRota: pts, rota: pts.map(p => [p.lat, p.lon]), canal: null, nota: null, milhas: 18 }
  const semAfastamento = { ...comum, id: 'x-vela', nome: 'Agora, vela e motor', afastamento: null, direto: false }
  calculo.calcular = async () => ({ veredicto: { tipo: 'segue', texto: 'Segue agora', porque: [] }, destino: { id: 'nazare', nome: 'Nazaré' }, alternativas: [semAfastamento] })
  try {
    const app = appFalso()
    app.leiturasFalhadas = 0
    const { p, r } = plugin(app)
    p.start({ pasta: path.join(app.dir, 'dados') })
    const id = (await chamar(r.post['/calcular'], { body: { destino: 'nazare', tripulacao: 'so' } })).id
    await esperarResultado(r, id)
    const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
    assert.equal(a.code, 200, a.erro)
    const d = app.recursos.get(`routes/${a.rota}`).description
    assert.match(d, /^Melhor rota: vela e motor, partida /)
    assert.doesNotMatch(d, /direta/)
    assert.equal(require('../lib/plano').rotaTexto(semAfastamento), 'vela e motor')
    p.stop()
  } finally { calculo.calcular = original }
})

test('auditoria M-20 (parte index.js): a rotação de cruzeiro e o afastamento mínimo do esquema e do start() sem configuração são os do lib/base.js e do lib/seguranca.js, não escritos à mão', async () => {
  const { comOutro } = require('./ajuda')
  const base = require('../lib/base')
  const seguranca = require('../lib/seguranca')
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const opcoes = []
  calculo.calcular = async (entrada, deps) => { opcoes.push(deps.opcoes); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  try {
    // com outros números lá, o plugin segue-os
    const outro = comOutro('index.js', {
      'lib/base.js': (b) => ({ ...b, RPM_CRUZEIRO: 1800 }),
      'lib/seguranca.js': (s) => ({ ...s, PADRAO: Object.freeze({ ...s.PADRAO, afastamentoMinimo: 6 }) })
    })
    for (const [fabrica, rpm, mn] of [[outro, 1800, 6], [criar, base.RPM_CRUZEIRO, seguranca.PADRAO.afastamentoMinimo]]) {
      const app = appFalso()
      const pl = plugin(app, {}, fabrica)
      assert.equal(pl.p.schema.properties.rpmCruzeiro.default, rpm)
      assert.equal(pl.p.schema.properties.afastamentoMinimo.default, mn)
      pl.p.start({ pasta: path.join(app.dir, 'dados') })
      await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
      assert.deepEqual([opcoes.at(-1).rpmCruzeiro, opcoes.at(-1).afastamentoMinimo], [rpm, mn])
      pl.p.stop()
    }
  } finally { calculo.calcular = original }
})

test('F2b Menor 5 (auditoria I-13, decisão n.º 4): os 200 Ah do valor por omissão antigo passam a 440 UMA vez — em memória, com o registo a dizê-lo, e a configuração é gravada com o valor novo (app.savePluginOptions, o resto igual) para um valor posto depois à mão se manter, até outros 200 Ah; se a gravação falha, ou o servidor não tem a API, repete-se no arranque seguinte (nada de marca)', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const opcoes = []
  calculo.calcular = async (entrada, deps) => { opcoes.push(deps.opcoes); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  const calc = async (pl) => { await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id); return opcoes.at(-1).energia }
  const marca = (app) => path.join(app.getDataDirPath(), 'migracoes.json')
  const antigaDe = (app) => ({ pasta: path.join(app.dir, 'dados'), afastamentoMinimo: 6, energia: { capacidadeAh: 200, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 1.65, rendimento: 0.2, alternadorA: 45 } })
  try {
    // a) com a API de opções do servidor
    const app = appFalso()
    const gravadas = []
    app.savePluginOptions = (cfg, cb) => { gravadas.push(cfg); cb(null) }
    const pl = plugin(app)
    const antiga = antigaDe(app)
    pl.p.start(antiga)
    assert.equal((await calc(pl)).capacidadeAh, 440)
    assert.deepEqual(gravadas, [{ ...antiga, energia: { ...antiga.energia, capacidadeAh: 440 } }], 'gravada com o valor novo e o resto como estava')
    assert.equal(antiga.energia.capacidadeAh, 200, 'a configuração recebida não se mexe')
    assert.ok(app.erros.some(m => /capacidadeAh.*200.*440 Ah.*gravada/.test(m)), JSON.stringify(app.erros))
    assert.ok(fs.existsSync(marca(app)), 'a marca de que já se fez')
    pl.p.stop()
    // o arranque seguinte, com a configuração gravada: nada a fazer
    pl.p.start(gravadas[0])
    assert.equal((await calc(pl)).capacidadeAh, 440)
    assert.equal(gravadas.length, 1)
    pl.p.stop()
    // o Ivo põe 200 Ah de propósito (outro banco): fica, e não se grava nada
    const erros = app.erros.length
    pl.p.start({ ...gravadas[0], energia: { ...gravadas[0].energia, capacidadeAh: 200 } })
    assert.equal((await calc(pl)).capacidadeAh, 200, 'um valor posto depois à mão fica')
    assert.equal(gravadas.length, 1)
    assert.equal(app.erros.length, erros, 'sem registo nem gravação')
    pl.p.stop()

    // b) a gravação falha: fica a 440 em memória, o registo diz porquê e repete-se no arranque seguinte (sem a marca)
    const app2 = appFalso()
    const tentativas = []
    let falha = true
    app2.savePluginOptions = (cfg, cb) => { tentativas.push(cfg); cb(falha ? new Error('disco cheio') : null) }
    const pl2 = plugin(app2)
    pl2.p.start(antigaDe(app2))
    assert.equal((await calc(pl2)).capacidadeAh, 440)
    assert.equal(tentativas.length, 1)
    assert.ok(app2.erros.some(m => /capacidadeAh.*200.*440 Ah.*disco cheio/.test(m)), JSON.stringify(app2.erros))
    assert.equal(fs.existsSync(marca(app2)), false)
    pl2.p.stop()
    falha = false
    pl2.p.start(antigaDe(app2))
    assert.equal((await calc(pl2)).capacidadeAh, 440)
    assert.equal(tentativas.length, 2, 'tenta outra vez')
    assert.ok(fs.existsSync(marca(app2)))
    pl2.p.stop()

    // c) um servidor sem a API: 440 em memória, o registo di-lo, nada fica gravado e repete-se em cada arranque
    const app3 = appFalso()
    const pl3 = plugin(app3)
    pl3.p.start(antigaDe(app3))
    assert.equal((await calc(pl3)).capacidadeAh, 440)
    assert.ok(app3.erros.some(m => /capacidadeAh.*200.*440 Ah/.test(m) && /não deixa gravar/.test(m)), JSON.stringify(app3.erros))
    assert.equal(fs.existsSync(marca(app3)), false)
    pl3.p.stop()
    pl3.p.start(antigaDe(app3))
    assert.equal((await calc(pl3)).capacidadeAh, 440)
    pl3.p.stop()
  } finally { calculo.calcular = original }
})

test('F2b Menor 3 (auditoria I-12), F9: com a sonda do gasóleo perdida o nível é DESCONHECIDO e nunca decide nada — nem os litros assumidos: o mínimo à chegada não corre com um número inventado (desconhecido nunca exclui, só avisa: desenho 3a) e cada alternativa leva o aviso vermelho "gasóleo inicial desconhecido: confirma o depósito"; com o nível conhecido o mínimo corre (o da configuração)', async () => {
  const SONDA = 'notifications.tanks.fuel.0.sondaPerdida'
  const calcular = async (app, props) => {
    const pl = plugin(app)
    pl.p.start({ pasta: path.join(app.dir, 'dados'), ...props })
    const r = (await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'cascais', tripulacao: 'so' } })).id)).resultado
    pl.p.stop()
    return r
  }
  const gasoleoDeMenos = (a) => JSON.stringify(a).includes('de gasóleo no pior caso')
  // a sonda perdida (o plugin do gasóleo continua a publicar litros pelo consumo, frescos) e um mínimo de 1000 L
  // (nenhum depósito chega): um número assumido (os 100 L de trabalho) excluía todas as alternativas
  const app = appFalso()
  app.self[SONDA] = { state: 'warn', method: ['visual'], message: 'Sonda do gasóleo sem leitura há mais de 5 min' }
  const r = await calcular(app, { seguranca: { gasoleoMinL: 1000 } })
  assert.ok(r.alternativas.length >= 1, `sem alternativas: ${JSON.stringify(r.veredicto)}`)
  for (const a of r.alternativas) {
    assert.ok(a.avisosVermelhos.some(x => /^gasóleo inicial desconhecido: confirma o depósito$/.test(x)), JSON.stringify(a.avisosVermelhos))
    assert.equal(gasoleoDeMenos(a), false, 'nenhuma regra do gasóleo com um número inventado')
  }
  assert.doesNotMatch(JSON.stringify(r), /assumi \d+ L/, 'nenhum litro assumido em parte nenhuma')
  // a sonda de volta e o nível conhecido (45 L) com um mínimo de 60 L: a regra corre e exclui
  const conhecido = appFalso()
  conhecido.self['tanks.fuel.0.currentVolume'] = 0.045
  const k = await calcular(conhecido, { seguranca: { gasoleoMinL: 60 } })
  assert.equal(k.alternativas.length, 0, 'com o nível conhecido o mínimo da configuração corre')
  // e o nível conhecido e suficiente: sem aviso nenhum de gasóleo
  const certo = await calcular(appFalso(), {})
  assert.ok(certo.alternativas.length >= 1)
  for (const a of certo.alternativas) assert.equal(a.avisosVermelhos.some(x => /gasóleo/.test(x)), false)
})

test('F9 (item 1): o plugin passa ao cálculo o nível do gasóleo desconhecido (null) e os limites da configuração tal e qual — sem o remendo do mínimo de −1e9 (com a sonda perdida ou sem leitura) nem a opção "gasóleo a assumir": o cálculo trata do desconhecido', async () => {
  const calculo = require('../lib/calculo')
  const original = calculo.calcular
  const vistos = []
  calculo.calcular = async (entrada, deps) => { vistos.push({ instrumentos: entrada.instrumentos, opcoes: deps.opcoes }); return { veredicto: { tipo: 'segue', texto: 'Segue', porque: [] }, destino: { id: 'peniche', nome: 'Peniche' }, alternativas: [] } }
  const calc = async (app, props) => {
    const pl = plugin(app)
    pl.p.start({ pasta: path.join(app.dir, 'dados'), ...props })
    await esperarResultado(pl.r, (await chamar(pl.r.post['/calcular'], { body: { destino: 'peniche', tripulacao: 'so' } })).id)
    pl.p.stop()
    return vistos.at(-1)
  }
  try {
    // a sonda perdida (os litros pelo consumo continuam na árvore, frescos): o nível é desconhecido
    const perdida = appFalso()
    perdida.self['notifications.tanks.fuel.0.sondaPerdida'] = { state: 'warn', method: ['visual'], message: 'Sonda do gasóleo sem leitura há mais de 5 min' }
    const a = await calc(perdida, { seguranca: { gasoleoMinL: 55 } })
    assert.equal(a.instrumentos.gasoleoL, null)
    assert.deepEqual(a.opcoes.seguranca, { gasoleoMinL: 55 }, 'o mínimo da configuração, tal e qual (nunca −1e9)')
    assert.equal('gasoleoDesconhecidoL' in a.opcoes, false, 'já não há um gasóleo a assumir')
    assert.equal('socDesconhecido' in a.opcoes, false, '05/10: nem um SoC a assumir')
    // sem nenhuma leitura do gasóleo: o mesmo
    const sem = appFalso()
    delete sem.self['tanks.fuel.0.currentVolume']
    const b = await calc(sem, { seguranca: { gasoleoMinL: 55 } })
    assert.equal(b.instrumentos.gasoleoL, null)
    assert.deepEqual(b.opcoes.seguranca, { gasoleoMinL: 55 })
    // com a leitura: o nível e o mesmo mínimo
    const c = await calc(appFalso(), { seguranca: { gasoleoMinL: 55 } })
    assert.equal(c.instrumentos.gasoleoL, 124)
    assert.deepEqual(c.opcoes.seguranca, { gasoleoMinL: 55 })
    // e o esquema da configuração já não oferece o gasóleo a assumir (o do SoC fica)
    assert.equal('gasoleoDesconhecidoL' in plugin(appFalso()).p.schema.properties, false)
    assert.equal('socDesconhecido' in plugin(appFalso()).p.schema.properties, false, '05/10: nem o SoC a assumir')
  } finally { calculo.calcular = original }
})
