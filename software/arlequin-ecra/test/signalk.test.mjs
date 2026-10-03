import test from 'node:test'
import assert from 'node:assert/strict'
import { criarStore, aplicarDelta, perderLigacao, pedir } from '../public/signalk.js'
import { SEM_AUTORIZACAO, motivo } from '../public/lib/erros.js'

test('sem ligação o ecrã esquece os alarmes (não fica a apitar)', () => {
  const store = criarStore()
  aplicarDelta(store, { updates: [{ timestamp: '2026-09-29T09:00:00Z', values: [
    { path: 'notifications.arlequin.ais.1', value: { state: 'alarm', method: ['visual', 'sound'], message: 'x' } },
    { path: 'navigation.speedOverGround', value: 2.5 }
  ] }] })
  assert.equal(store.notificacoes.size, 1)
  perderLigacao(store)
  assert.equal(store.ligado, false)
  assert.equal(store.notificacoes.size, 0)
  assert.equal(store.self.get('navigation.speedOverGround').value, 2.5)
})

test('alvos AIS: nome pelo caminho vazio e posição com hora', () => {
  const store = criarStore()
  store.selfContext = 'vessels.urn:mrn:signalk:uuid:eu'
  aplicarDelta(store, { context: 'vessels.urn:mrn:imo:mmsi:263000001', updates: [{ timestamp: '2026-09-29T09:00:00Z', values: [
    { path: '', value: { name: 'NORDIC STAR' } },
    { path: 'navigation.position', value: { latitude: 39.4, longitude: -9.4 } }
  ] }] })
  const a = store.vessels.get('vessels.urn:mrn:imo:mmsi:263000001')
  assert.equal(a.name, 'NORDIC STAR')
  assert.equal(a.mmsi, '263000001')
  assert.equal(a.em, Date.parse('2026-09-29T09:00:00Z'))
})

test('pedir: o erro leva o código e o corpo do plugin (num 409, o id do cálculo que já corre)', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, erro: 'já há um cálculo a correr', id: 'calc-0' }), { status: 409, headers: { 'content-type': 'application/json' } })
  try {
    await assert.rejects(pedir('/plugins/signalk-arlequin-rota/calcular', { method: 'POST', body: {} }), (e) => e.status === 409 && e.message === 'já há um cálculo a correr' && e.corpo?.id === 'calc-0')
  } finally { globalThis.fetch = orig }
})

// ---------- auditoria K-11 e I-32: um pedir comum que fala pt-PT em todas as páginas ----------
async function comFetch (fetch, f) {
  const orig = globalThis.fetch
  globalThis.fetch = fetch
  try { return await f() } finally { globalThis.fetch = orig }
}
const resposta = (status, corpo) => async () => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: corpo === undefined ? {} : { 'content-type': 'application/json' } })

test('auditoria K-11: um 401/403 do SignalK (a conta do ecrã sem sessão ou sem permissão) chega em pt-PT, nunca "401"', async () => {
  for (const status of [401, 403]) {
    await comFetch(resposta(status, { error: 'Permission Denied' }), () => assert.rejects(pedir('/plugins/signalk-arlequin-gasoleo/estado'), (e) => e.status === status && e.message === SEM_AUTORIZACAO))
  }
  assert.equal(SEM_AUTORIZACAO, 'o SignalK recusou o pedido (sem sessão iniciada neste ecrã?): entra no SignalK e tenta outra vez')
})

test('auditoria I-32: sem resposta ("Failed to fetch") e os erros do SignalK em inglês chegam em pt-PT; o erro verdadeiro fica no detalhe', async () => {
  await comFetch(async () => { throw new TypeError('Failed to fetch') }, () => assert.rejects(pedir('/x'), (e) => e.status === undefined && e.message === 'sem ligação ao SignalK' && e.detalhe === 'Failed to fetch'))
  await comFetch(resposta(400, { state: 'FAILED', statusCode: 400, message: 'Cannot silence Emergency Alarm!' }), () => assert.rejects(pedir('/signalk/v2/api/notifications/x/silence', { method: 'POST' }), (e) => e.status === 400 && e.message === 'um alarme de emergência não se silencia: só se reconhece' && /Cannot silence/.test(e.detalhe)))
  await comFetch(resposta(400, { state: 'FAILED', statusCode: 400, message: 'Something odd happened' }), () => assert.rejects(pedir('/y'), (e) => e.message === '400' && /Something odd/.test(e.detalhe)))
  // o 500 sem corpo continua "500" (o motivo() de cada página diz o que é)
  await comFetch(resposta(500), () => assert.rejects(pedir('/z'), (e) => e.status === 500 && e.message === '500'))
})

test('auditoria K-11 e I-32: motivo(erro, quem) — a frase em pt-PT de cada falha, nunca o código cru', () => {
  const erro = (status, message) => Object.assign(new Error(message), status ? { status } : {})
  assert.equal(motivo(erro(undefined, 'sem ligação ao SignalK'), 'o plugin do gasóleo'), 'o plugin do gasóleo não responde')
  assert.equal(motivo(erro(401, SEM_AUTORIZACAO), 'o plugin do gasóleo'), SEM_AUTORIZACAO)
  assert.equal(motivo(erro(403, '403'), 'a caixa negra'), SEM_AUTORIZACAO)
  assert.equal(motivo(erro(409, 'ainda a medir'), 'o plugin do gasóleo'), 'ainda a medir')
  assert.equal(motivo(erro(404, '404'), 'a AI'), 'a AI não está instalada ou ligada')
  assert.equal(motivo(erro(404, '404'), 'o plugin da água'), 'o plugin da água não está instalado ou ligado')
  assert.equal(motivo(erro(503, '503'), 'o diário'), 'o diário não está ligado')
  assert.equal(motivo(erro(500, '500'), 'o plugin da energia'), 'o plugin da energia deu um erro (HTTP 500)')
  assert.equal(motivo(null, 'o plugin'), 'o plugin não responde')
})

// ---------- revisão F3, Minor 15: uma só definição de cada utilitário ----------
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { SEM_LIGACAO } from '../public/lib/erros.js'

// todos os .js do ecrã (public/), para contar as definições de um nome
function fontesDoEcra (pasta = new URL('../public/', import.meta.url)) {
  const out = []
  for (const nome of readdirSync(pasta)) {
    const f = new URL(nome, pasta)
    if (statSync(f).isDirectory()) out.push(...fontesDoEcra(new URL(`${nome}/`, pasta)))
    else if (nome.endsWith('.js')) out.push({ nome: f.pathname.split('/public/')[1], texto: readFileSync(f, 'utf8') })
  }
  return out
}
const definicoes = (nome) => fontesDoEcra().flatMap(({ nome: ficheiro, texto }) => [...texto.matchAll(new RegExp(String.raw`\b(?:const|let|var|function)\s+${nome}\b`, 'g'))].map(() => ficheiro))

test('revisão F3 (Minor 15): o "explicado" (a mensagem do plugin que explica, não só o código) tem uma só definição, em lib/erros.js, e o motivoPlugin da Melhor rota usa-a', async () => {
  assert.deepEqual(definicoes('explicado'), ['lib/erros.js'])
  const { explicado } = await import('../public/lib/erros.js')
  for (const m of ['o plugin recusou: cálculo antigo', ' x ', 'ainda a medir']) assert.equal(explicado(m), true, m)
  for (const m of ['', '   ', '404', ' 503 ', SEM_LIGACAO, null, undefined, 7, {}]) assert.equal(explicado(m), false, String(m))
  // o que o motivoPlugin diz não mudou
  const { motivoPlugin, motivoAcao, PLUGIN_DESLIGADO, CALCULO_PERDIDO } = await import('../public/paginas/melhor/pedir.js')
  const erro = (status, message) => Object.assign(new Error(message), status ? { status } : {})
  assert.equal(motivoPlugin(erro(undefined, 'sem ligação ao SignalK')), PLUGIN_DESLIGADO)
  assert.equal(motivoPlugin(erro(404, '404'), { se404: 'já não existe' }), 'já não existe')
  assert.equal(motivoPlugin(erro(404, 'cálculo desconhecido')), CALCULO_PERDIDO)
  assert.equal(motivoPlugin(erro(404, 'destino desconhecido')), 'destino desconhecido')
  assert.equal(motivoPlugin(erro(404, '404')), PLUGIN_DESLIGADO)
  assert.equal(motivoPlugin(erro(503, 'sem previsão')), `${PLUGIN_DESLIGADO} (sem previsão)`)
  assert.equal(motivoPlugin(erro(503, '503')), PLUGIN_DESLIGADO)
  assert.equal(motivoAcao(erro(503, 'sem previsão')), 'sem previsão')
  assert.equal(motivoPlugin(erro(401, SEM_AUTORIZACAO)), SEM_AUTORIZACAO)
  assert.equal(motivoPlugin(erro(401, '401')), SEM_AUTORIZACAO)
  assert.equal(motivoPlugin(erro(400, 'litros entre 0 e 80')), 'litros entre 0 e 80')
  assert.equal(motivoPlugin(erro(500, '500')), 'o plugin da rota deu um erro (HTTP 500)')
})

test('revisão F3 (Minor 15): a gravidade dos estados do SignalK (GRAVIDADE) tem uma só definição, em lib/alarmes.js', () => {
  assert.deepEqual(definicoes('GRAVIDADE'), ['lib/alarmes.js'])
})
