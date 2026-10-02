'use strict'
// Auditoria I-20 (decisão n.º 24 do dono), no plugin: o ponto de amarração só se grava sozinho junto a
// um porto ou fundeadouro conhecido (os destinos da rota e os lugares da configuração); no mar nunca.
// O /amarrar grava em qualquer sítio.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

const MIN = 60000
function appFalso () {
  const app = { arvore: {}, estado: '', erros: [] }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-amarracao-'))
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

const MARINA_PENICHE = { latitude: 39.3522, longitude: -9.3760 }
const MAR = { latitude: 39.20, longitude: -9.60 } // ao largo, entre Peniche e a Ericeira
const BOIA = { latitude: 38.4600, longitude: -8.9800 }

test('auditoria I-20: o plugin grava o ponto sozinho na marina de Peniche, nunca no mar; o /amarrar grava em qualquer sítio', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  const textos = () => tgf.enviados.filter(m => m.chatId === '111').map(m => m.text)
  try {
    app.pôr('navigation.position', MARINA_PENICHE)
    app.pôr('navigation.speedOverGround', 0)
    await esperar(200) // o plugin vê-o parado
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    // o /largar com o barco ainda parado na marina: o ponto não volta logo (só com mais 30 min parado)
    tgf.escrever(111, '/largar')
    assert.ok(await ate(() => textos().includes('⚓ Ponto de amarração apagado')))
    await esperar(300)
    assert.match(app.estado, / · sem ponto · /)
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    tgf.escrever(111, '/largar')
    assert.ok(await ate(() => textos().filter(t => t === '⚓ Ponto de amarração apagado').length === 2))
    // no mar, 1 h parado: nunca grava sozinho
    app.pôr('navigation.position', MAR)
    await esperar(200)
    agora += 60 * MIN
    await esperar(400)
    assert.match(app.estado, / · sem ponto · /)
    // à mão grava em qualquer sítio
    tgf.escrever(111, '/amarrar')
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.dir, 'porto.json'), 'utf8')).ponto, MAR)
    assert.deepEqual(app.erros, [])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-20: um fundeadouro posto na configuração (lugares) conta como conhecido', async () => {
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, tickMs: 50, encaminharMs: 50 })
  p.start({ lugares: [{ nome: 'Bóia da Arrábida', latitude: BOIA.latitude, longitude: BOIA.longitude }] })
  try {
    app.pôr('navigation.position', { latitude: BOIA.latitude + 300 / 111320, longitude: BOIA.longitude })
    app.pôr('navigation.speedOverGround', 0)
    await esperar(200)
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
  } finally { p.stop() }
})
