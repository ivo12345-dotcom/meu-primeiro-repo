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
  assert.deepEqual([y.code, y.erro], [502, 'o diário (signalk-logbook) não está instalado ou ligado'])
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
