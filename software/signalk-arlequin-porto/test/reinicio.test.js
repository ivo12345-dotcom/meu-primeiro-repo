'use strict'
// Reinícios do plugin porto (o SignalK faz stop() e start() seguidos ao gravar a configuração):
// auditoria I-22 (um só ciclo a falar com o Telegram).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

function appFalso () {
  const app = { arvore: {}, estado: '', erros: [] }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-reinicio-'))
  app.getDataDirPath = () => app.dir
  const pôr = (p, value) => { const ks = p.split('.'); let n = app.arvore; for (const k of ks) n = (n[k] = n[k] || {}); n.value = value }
  app.pôr = pôr
  app.getSelfPath = (p) => p.split('.').reduce((n, k) => n?.[k], app.arvore)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) pôr(v.path, v.value) }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ate (cond, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(20) } return false }

test('auditoria I-22: um reinício com o long polling pendente deixa um só ciclo (sonda p2-A): nunca dois getUpdates ao mesmo tempo e um /armar responde uma vez', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  const props = { telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 }
  p.start(props)
  try {
    assert.ok(await ate(() => tgf.esperasAbertas() === 1))
    p.stop()
    p.start(props)
    // o pedido do ciclo antigo acaba; daí em diante, vários ciclos do long polling com um só à espera
    assert.ok(await ate(() => tgf.esperasAbertas() === 1))
    tgf.reporMaxEsperas()
    await esperar(2500)
    assert.equal(tgf.maxEsperas(), 1, 'dois ciclos a ler o Telegram (o verdadeiro dá 409 Conflict)')
    tgf.escrever(111, '/armar')
    const armados = () => tgf.enviados.filter(m => /ARMADO/.test(m.text || '')).length
    assert.ok(await ate(() => armados() >= 1))
    await esperar(1500)
    assert.equal(armados(), 1, '/armar respondido mais de uma vez')
    assert.deepEqual(app.erros, [])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-22: o stop() corta o long polling pendente, sem erro no registo', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 20 })
  try {
    assert.ok(await ate(() => tgf.esperasAbertas() === 1))
    p.stop()
    assert.ok(await ate(() => tgf.esperasAbertas() === 0, 3000), 'o pedido de 20 s ficou pendurado depois do stop()')
    await esperar(200)
    assert.deepEqual(app.erros, [])
  } finally { p.stop(); await tgf.fechar() }
})
