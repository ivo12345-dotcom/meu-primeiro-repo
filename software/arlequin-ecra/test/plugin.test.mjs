// O plugin do ecrã (index.js): os níveis das rotas REST com a segurança do SignalK (auditoria K-11, decisão do
// Ivo n.º 20: o ecrã entra com uma conta "read/write", nunca admin), as janelas e o diário pelo plugin
// (contrato C3: o signalk-logbook só aceita admin; o token fica só na configuração deste plugin).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const criar = require('../index.js')

function appFalso () {
  return { estado: '', erro: null, erros: [], setPluginStatus (s) { this.estado = s }, setPluginError (s) { this.erro = s }, error (e) { this.erros.push(String(e)) } }
}
const rotas = (p) => {
  const r = { get: {}, post: {} }
  p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } })
  return r
}
const chamar = (h, { body, params, principal } = {}) => new Promise((resolve) => {
  const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }
  h({ body, params: params || {}, skPrincipal: principal }, res)
})
// o logbook falso: respostas por "MÉTODO caminho"; regista os pedidos
function logbookFalso (respostas = {}) {
  const pedidos = []
  const fetch = async (url, o = {}) => {
    pedidos.push({ url, method: o.method || 'GET', headers: o.headers || {}, body: o.body ? JSON.parse(o.body) : undefined })
    const chave = `${o.method || 'GET'} ${url.replace('http://localhost:3000/plugins/signalk-logbook/logs', '')}`
    const r = respostas[chave]
    if (r instanceof Error) throw r
    if (typeof r === 'number') return { ok: r < 400, status: r, json: async () => ({}), text: async () => '' }
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' }
    return { ok: true, status: 200, json: async () => structuredClone(r), text: async () => JSON.stringify(r) }
  }
  return { fetch, pedidos }
}

test('auditoria K-11: com a segurança do SignalK (router.access) os GET registam-se "readonly" e os POST "readwrite"; nada fica só para admin', () => {
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
  assert.deepEqual(Object.fromEntries(registos.map(x => [`${x.m} ${x.k}`, x.nivel])), {
    'POST /janela': 'readwrite',
    'GET /janela': 'readonly',
    'GET /diario/:dia': 'readonly',
    'POST /diario': 'readwrite'
  })
  assert.ok(registos.every(x => x.h === 'function'))
})

test('auditoria K-11: num SignalK antigo (sem router.access) as rotas registam-se no router simples', () => {
  const r = rotas(criar(appFalso()))
  assert.deepEqual(Object.keys(r.get).sort(), ['/diario/:dia', '/janela'])
  assert.deepEqual(Object.keys(r.post).sort(), ['/diario', '/janela'])
})

test('janelas: sem comando só regista; o comando que falha dá 500 com uma frase em pt-PT (o erro do shell fica no estado do plugin)', async () => {
  const app = appFalso()
  const execs = []
  const exec = (cmd, o, cb) => { execs.push(cmd); cb(cmd === 'falha' ? Object.assign(new Error('Command failed: falha'), { code: 1 }) : null, '', cmd === 'falha' ? 'wmctrl: cannot open display' : '') }
  const p = criar(app, { exec })
  p.start({ layoutCarta: '', noiteOn: 'falha', noiteOff: 'ok' })
  const r = rotas(p)
  assert.deepEqual(await chamar(r.post['/janela'], { body: { layout: 'carta' } }), { code: 200, ok: true, corrido: false })
  assert.deepEqual(await chamar(r.post['/janela'], { body: { noite: false } }), { code: 200, ok: true, corrido: true })
  const f = await chamar(r.post['/janela'], { body: { noite: true } })
  assert.equal(f.code, 500)
  assert.equal(f.erro, 'o comando do modo noite do OpenCPN falhou (o motivo está no estado do plugin do ecrã)')
  assert.match(app.erro, /wmctrl: cannot open display/)
  assert.equal((await chamar(r.post['/janela'], { body: { x: 1 } })).code, 400)
  assert.deepEqual(execs, ['ok', 'falha'])
})

const CONFIG = { logbookUrl: 'http://localhost:3000/plugins/signalk-logbook/logs', token: 'tok-admin' }

test('contrato C3: POST /diario escreve no signalk-logbook com o token de admin da configuração (nunca o do browser), como entrada manual de quem está no ecrã', async () => {
  const lb = logbookFalso({ 'POST ': 201 })
  const p = criar(appFalso(), { fetch: lb.fetch })
  p.start(CONFIG)
  const r = await chamar(rotas(p).post['/diario'], { body: { text: '  Rizei  ', category: 'navigation' }, principal: { identifier: 'ecra' } })
  assert.deepEqual(r, { code: 201, ok: true })
  assert.equal(lb.pedidos.length, 1)
  const q = lb.pedidos[0]
  assert.equal(q.url, CONFIG.logbookUrl)
  assert.equal(q.method, 'POST')
  assert.equal(q.headers.Authorization, 'Bearer tok-admin')
  assert.deepEqual(q.body, { text: 'Rizei', category: 'navigation', origin: 'manual', author: 'ecra' })
  // sem categoria: navegação; sem sessão (segurança desligada): sem autor
  await chamar(rotas(p).post['/diario'], { body: { text: 'Avaria' } })
  assert.deepEqual(lb.pedidos[1].body, { text: 'Avaria', category: 'navigation', origin: 'manual' })
})

test('contrato C3: POST /diario recusa o que o logbook não aceita (400) e explica em pt-PT quando o logbook falha (502)', async () => {
  const p = criar(appFalso(), { fetch: logbookFalso({ 'POST ': 201 }).fetch })
  p.start(CONFIG)
  const r = rotas(p)
  for (const body of [{}, { text: '   ' }, { text: 7 }, { text: 'x'.repeat(1001) }, { text: 'ok', category: 'outra' }]) assert.equal((await chamar(r.post['/diario'], { body })).code, 400, JSON.stringify(body))
  // o logbook só aceita admin e o token falta (ou não serve)
  for (const [token, espera] of [['', /põe um token de admin na configuração do plugin do ecrã/], ['tok-velho', /recusou o token de admin da configuração do plugin do ecrã/]]) {
    const app = appFalso()
    const s = criar(app, { fetch: logbookFalso({ 'POST ': 401 }).fetch })
    s.start({ ...CONFIG, token })
    const x = await chamar(rotas(s).post['/diario'], { body: { text: 'Rizei' } })
    assert.equal(x.code, 502)
    assert.match(x.erro, espera)
  }
  // o logbook desligado: a rota não existe (404) ou não responde
  const sem = criar(appFalso(), { fetch: logbookFalso({}).fetch })
  sem.start(CONFIG)
  const y = await chamar(rotas(sem).post['/diario'], { body: { text: 'Rizei' } })
  // (revisão F3, Minor 10: "o plugin do diário…", a mesma frase do GET quando o logbook não está lá)
  assert.deepEqual([y.code, y.erro], [502, 'o plugin do diário (signalk-logbook) não está instalado ou ligado'])
  const app = appFalso()
  const morto = criar(app, { fetch: logbookFalso({ 'POST ': new TypeError('fetch failed') }).fetch })
  morto.start(CONFIG)
  const z = await chamar(rotas(morto).post['/diario'], { body: { text: 'Rizei' } })
  assert.deepEqual([z.code, z.erro], [502, 'o diário (signalk-logbook) não responde'])
  assert.ok(app.erros.some(e => /fetch failed/.test(e)), 'o erro verdadeiro fica no registo do servidor')
})

test('contrato C3 e auditoria I-31: GET /diario/:dia dá o dia de Lisboa — junta os dois dias UTC que lhe tocam (o logbook guarda por dia UTC)', async () => {
  const e = (datetime, text, extra = {}) => ({ datetime, text, author: '', category: 'navigation', origin: 'manual', position: { latitude: 39, longitude: -9 }, ...extra })
  const lb = logbookFalso({
    // a lista dos dias do logbook (GET /logs): o logbook está lá (revisão F3, Minor 10: é o que distingue um dia vazio de um logbook em falta)
    'GET ': ['2026-07-14', '2026-07-15'],
    // verão (UTC+1): o dia 15/07 de Lisboa vai de 14/07 23:00Z a 15/07 23:00Z
    'GET /2026-07-14': [e('2026-07-14T22:30:00.000Z', 'ainda dia 14 em Lisboa'), e('2026-07-14T23:30:00.000Z', 'já dia 15 em Lisboa')],
    'GET /2026-07-15': [e('2026-07-15T22:59:00.000Z', 'última do dia 15', { category: 'engine', origin: 'auto' }), e('2026-07-15T08:00:00.000Z', 'manhã'), e('2026-07-15T23:10:00.000Z', 'já dia 16 em Lisboa')]
  })
  const p = criar(appFalso(), { fetch: lb.fetch })
  p.start(CONFIG)
  const r = await chamar(rotas(p).get['/diario/:dia'], { params: { dia: '2026-07-15' } })
  assert.equal(r.code, 200)
  assert.equal(r.dia, '2026-07-15')
  assert.deepEqual(r.entradas.map(x => x.text), ['já dia 15 em Lisboa', 'manhã', 'última do dia 15'])
  assert.deepEqual(r.entradas[2], { datetime: '2026-07-15T22:59:00.000Z', text: 'última do dia 15', category: 'engine', origin: 'auto', author: '' })
  assert.deepEqual(lb.pedidos.map(q => [q.url.slice(-10), q.headers.Authorization]), [['2026-07-14', 'Bearer tok-admin'], ['2026-07-15', 'Bearer tok-admin']])
  // inverno (UTC+0): dia sem ficheiro (404) = sem entradas
  const vazio = await chamar(rotas(p).get['/diario/:dia'], { params: { dia: '2026-12-01' } })
  assert.deepEqual([vazio.code, vazio.entradas], [200, []])
  assert.equal((await chamar(rotas(p).get['/diario/:dia'], { params: { dia: '15/07/2026' } })).code, 400)
  // sem o token (o logbook só aceita admin): 502 com o motivo
  const s = criar(appFalso(), { fetch: logbookFalso({ 'GET /2026-07-14': 401, 'GET /2026-07-15': 401 }).fetch })
  s.start({ ...CONFIG, token: '' })
  const x = await chamar(rotas(s).get['/diario/:dia'], { params: { dia: '2026-07-15' } })
  assert.equal(x.code, 502)
  assert.match(x.erro, /põe um token de admin na configuração do plugin do ecrã/)
})

// ---------- revisão F3, Minor 10: um dia sem entradas não é um logbook em falta ----------
const NAO_ESTA = 'o plugin do diário (signalk-logbook) não está instalado ou ligado'
const aLista = (q) => q.url === CONFIG.logbookUrl // o GET /logs (a lista dos dias)

test('revisão F3 (Minor 10): o logbook dá 404 a um dia sem ficheiro e o servidor dá 404 a um plugin que não está lá — com os dois dias a 404 pergunta a lista dos dias: sem ela, "o plugin do diário (signalk-logbook) não está instalado ou ligado" (502); com ela, um dia sem entradas (200)', async () => {
  const dia = (p) => chamar(rotas(p).get['/diario/:dia'], { params: { dia: '2026-12-01' } })
  // o logbook lá (a lista responde, mesmo vazia), sem ficheiro nesses dois dias: "ainda não há entradas"
  for (const lista of [['2026-07-01'], []]) {
    const lb = logbookFalso({ 'GET ': lista })
    const p = criar(appFalso(), { fetch: lb.fetch })
    p.start(CONFIG)
    const r = await dia(p)
    assert.deepEqual([r.code, r.dia, r.entradas], [200, '2026-12-01', []], JSON.stringify(lista))
    assert.deepEqual(lb.pedidos.map(q => (aLista(q) ? '(lista)' : q.url.slice(-10))), ['2026-11-30', '2026-12-01', '(lista)'])
    assert.equal(lb.pedidos[2].headers.Authorization, 'Bearer tok-admin', 'a lista também com o token')
  }
  // o logbook em falta: nem os dias nem a lista (o 404 do servidor a um plugin que não está instalado ou ligado)
  const app = appFalso()
  const sem = logbookFalso({})
  const p = criar(app, { fetch: sem.fetch })
  p.start(CONFIG)
  const r = await dia(p)
  assert.deepEqual([r.code, r.ok, r.erro], [502, false, NAO_ESTA])
  assert.equal(sem.pedidos.length, 3)
  assert.ok(app.erros.some(e => /GET \/logs respondeu 404/.test(e)), 'o motivo fica no registo do servidor')
  // um dia com entradas, ou só o da véspera: o logbook está lá, não se pergunta a lista
  const e = (datetime, text) => ({ datetime, text, author: '', category: 'navigation', origin: 'manual' })
  const com = logbookFalso({ 'GET /2026-12-01': [e('2026-12-01T09:00:00.000Z', 'manhã')] })
  const pc = criar(appFalso(), { fetch: com.fetch })
  pc.start(CONFIG)
  const rc = await dia(pc)
  assert.deepEqual([rc.code, rc.entradas.map(x => x.text)], [200, ['manhã']])
  assert.equal(com.pedidos.length, 2)
  assert.ok(!com.pedidos.some(aLista))
  const vespera = logbookFalso({ 'GET /2026-11-30': [e('2026-11-30T22:00:00.000Z', 'ontem à noite')] })
  const pv = criar(appFalso(), { fetch: vespera.fetch })
  pv.start(CONFIG)
  const rv = await chamar(rotas(pv).get['/diario/:dia'], { params: { dia: '2026-11-30' } })
  assert.equal(rv.code, 200)
  assert.deepEqual(rv.entradas.map(x => x.text), ['ontem à noite'])
  assert.ok(!vespera.pedidos.some(aLista), 'um dia com entradas: sem a lista')
})

test('revisão F3 (Minor 10): com os dois dias a 404, a lista dos dias que falha por outro motivo dá o motivo dela (token, sem resposta, erro) — nunca "ainda não há entradas"', async () => {
  const dia = (p) => chamar(rotas(p).get['/diario/:dia'], { params: { dia: '2026-12-01' } })
  for (const [lista, espera] of [[401, /só aceita admin|recusou o token/], [403, /só aceita admin|recusou o token/], [500, /deu um erro \(HTTP 500\)/]]) {
    const p = criar(appFalso(), { fetch: logbookFalso({ 'GET ': lista }).fetch })
    p.start(CONFIG)
    const r = await dia(p)
    assert.equal(r.code, 502, String(lista))
    assert.match(r.erro, espera, String(lista))
  }
  const app = appFalso()
  const morto = criar(app, { fetch: logbookFalso({ 'GET ': new TypeError('fetch failed') }).fetch })
  morto.start(CONFIG)
  const z = await dia(morto)
  assert.deepEqual([z.code, z.erro], [502, 'o diário (signalk-logbook) não responde'])
  assert.ok(app.erros.some(x => /fetch failed/.test(x)))
})
