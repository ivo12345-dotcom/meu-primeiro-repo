'use strict'
// Auditoria M-53: o registo dos erros do Telegram com um só prefixo ("Telegram getUpdates: …", não
// "Telegram: Telegram getUpdates: …"); o token nunca aparece no registo.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { criarTelegram } = require('../lib/telegram')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

const H = 3600000
function appFalso () {
  const app = { arvore: {}, estado: '', erros: [], ticks: 0 }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-registo-'))
  app.getDataDirPath = () => app.dir
  const pôr = (p, value) => { const ks = p.split('.'); let n = app.arvore; for (const k of ks) n = (n[k] = n[k] || {}); n.value = value }
  app.pôr = pôr
  app.getSelfPath = (p) => p.split('.').reduce((n, k) => n?.[k], app.arvore)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) pôr(v.path, v.value) }
  // ticks: quantas vezes o ciclo do plugin correu (escreve o estado em cada uma)
  app.setPluginStatus = (s) => { app.estado = s; app.ticks++ }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ate (cond, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(20) } return false }
const SEGREDO = '123456:SEGREDO-DO-BOT'

test('auditoria M-53: sem rede, o erro do long polling regista-se com um só prefixo e sem o token', async () => {
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: SEGREDO, chatIds: ['111'], telegramBase: 'http://127.0.0.1:9', pollTimeout: 1 })
  try {
    assert.ok(await ate(() => app.erros.length >= 1))
    assert.match(app.erros[0], /^Telegram getUpdates: sem ligação \(/)
    assert.ok(app.erros.every(e => !/Telegram: Telegram/.test(e) && !e.includes(SEGREDO)), JSON.stringify(app.erros))
  } finally { p.stop() }
})

test('auditoria M-53: o lembrete de armar que não sai regista-se com um só prefixo', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, tickMs: 50, encaminharMs: 50 })
  p.start({ telegramToken: SEGREDO, chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    // o plugin vê o barco sem movimento, com a hora de antes do salto (se o ciclo ainda não tivesse corrido,
    // veria já a hora saltada e o lembrete só sairia 12 h depois: auditoria F4b, revisão da F4, Menor 13)
    assert.ok(await ate(() => app.ticks >= 2))
    tgf.cortar()
    agora += 12 * H + 60000
    assert.ok(await ate(() => tgf.cortados.length >= 1))
    assert.ok(await ate(() => app.erros.length >= 1))
    assert.deepEqual(app.erros.map(e => e.replace(/\(.*\)$/, '(…)')), ['Telegram sendMessage: sem ligação (…)'])
    assert.ok(app.erros.every(e => !e.includes(SEGREDO)))
  } finally { p.stop(); await tgf.fechar() }
})

test('o token nunca aparece nos erros do cliente do Telegram (servidor mal escrito, inexistente, recusado; uma mensagem de erro com o URL)', async () => {
  const erroDe = (p) => p.then(() => null, e => e)
  for (const base of ['htp//api.telegram.org', 'http://[::1', 'ftp://x', 'http://nao-existe.invalid', 'http://127.0.0.1:9']) {
    const e = await erroDe(criarTelegram({ token: SEGREDO, base, limiteMs: 3000 }).sendMessage('111', 'x'))
    assert.ok(e, base)
    assert.ok(!e.message.includes(SEGREDO) && !String(e.descricao ?? '').includes(SEGREDO), `${base}: ${e.message}`)
  }
  // um fetch que põe o URL inteiro na mensagem do erro
  const comUrl = criarTelegram({ token: SEGREDO, base: 'http://x', fetchFn: async (url) => { throw new TypeError(`falhou ${url}`) } })
  const e = await erroDe(comUrl.getUpdates(0, 1))
  assert.ok(!e.message.includes(SEGREDO), e.message)
  assert.match(e.message, /^Telegram getUpdates: sem ligação/)
})
