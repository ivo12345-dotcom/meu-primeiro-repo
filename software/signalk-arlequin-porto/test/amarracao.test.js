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
  const app = { arvore: {}, estado: '', erros: [], ticks: 0 }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-amarracao-'))
  app.getDataDirPath = () => app.dir
  const pôr = (p, value) => { const ks = p.split('.'); let n = app.arvore; for (const k of ks) n = (n[k] = n[k] || {}); n.value = value }
  app.pôr = pôr
  app.getSelfPath = (p) => p.split('.').reduce((n, k) => n?.[k], app.arvore)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) pôr(v.path, v.value) }
  // ticks: quantas vezes o ciclo de 1 s do plugin correu (escreve o estado em cada uma)
  app.setPluginStatus = (s) => { app.estado = s; app.ticks++ }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ate (cond, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(20) } return false }
// Espera que o ciclo do plugin corra mais n vezes (escreve o estado em cada uma): o que se vê, não o tempo
// (auditoria F4b, revisão da F4, Menor 13: um `esperar(200)` antes de o relógio injetado saltar falhava
// com a máquina carregada, quando o ciclo ainda não tinha visto o barco com a hora de antes do salto).
async function ciclos (app, n = 2) {
  const alvo = app.ticks + n
  assert.ok(await ate(() => app.ticks >= alvo), `o ciclo do plugin não correu ${n} vezes`)
}

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
    await ciclos(app) // o plugin vê-o parado, com a hora de antes do salto
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    // o /largar com o barco ainda parado na marina: o ponto não volta logo (só com mais 30 min parado)
    tgf.escrever(111, '/largar')
    assert.ok(await ate(() => textos().includes('⚓ Ponto de amarração apagado')))
    await ciclos(app, 3)
    assert.match(app.estado, / · sem ponto · /)
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    tgf.escrever(111, '/largar')
    assert.ok(await ate(() => textos().filter(t => t === '⚓ Ponto de amarração apagado').length === 2))
    // no mar, 1 h parado: nunca grava sozinho
    app.pôr('navigation.position', MAR)
    await ciclos(app)
    agora += 60 * MIN
    await ciclos(app, 3) // o plugin viu a hora depois do salto
    assert.match(app.estado, / · sem ponto · /)
    // à mão grava em qualquer sítio
    tgf.escrever(111, '/amarrar')
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.dir, 'porto.json'), 'utf8')).ponto, MAR)
    assert.deepEqual(app.erros, [])
  } finally { p.stop(); await tgf.fechar() }
})

// ---------- Adenda 2 do dono ("Largar") e contrato C10 ("Larguei": POST /plugins/signalk-arlequin-porto/largar) ----------

const NO = 1852 / 3600
const DERIVA = 'notifications.arlequin.porto.deriva'
const aNorteDe = (p, m) => ({ latitude: p.latitude + m / 111320, longitude: p.longitude })
// as rotas que o plugin regista (com o router.access do SignalK 2.33: cada uma com o seu nível)
function rotas (p) {
  const r = {}
  const direto = (m) => (k) => { r[`${m} ${k}`] = { nivel: null } }
  p.registerWithRouter({
    get: direto('GET'),
    post: direto('POST'),
    access: (nivel) => ({ get: (k, h) => { r[`GET ${k}`] = { nivel, h } }, post: (k, h) => { r[`POST ${k}`] = { nivel, h } } })
  })
  return r
}
const chamar = (h, body = {}) => new Promise((resolve) => {
  const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }
  h({ body, params: {} }, res)
})
// o plugin já amarrado na marina de Peniche (o porto.json de um arranque anterior)
function amarradoEmPeniche (app) {
  fs.writeFileSync(path.join(app.dir, 'porto.json'), JSON.stringify({ armado: false, ponto: MARINA_PENICHE, ativos: {} }))
}

test('contrato C2/C10: o POST /largar regista-se "readwrite" (a conta do ecrã chega, nada fica só para admin); sem o router.access (versões antigas) fica a rota simples; antes do start(), 503', async () => {
  const p = criar(appFalso())
  const r = rotas(p)
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.nivel])), { 'POST /largar': 'readwrite' })
  assert.equal(typeof r['POST /largar'].h, 'function')
  assert.deepEqual(await chamar(r['POST /largar'].h), { code: 503, ok: false, erro: 'o plugin porto não está ligado' })
  // um SignalK sem router.access
  const simples = []
  criar(appFalso()).registerWithRouter({ get: (k) => simples.push(`GET ${k}`), post: (k) => simples.push(`POST ${k}`) })
  assert.deepEqual(simples, ['POST /largar'])
})

test('Adenda 2 / C10: sair sem leitura das rotações: o "saiu do lugar" (com acao "largar") fica até ao "Larguei" do ecrã (POST /largar), mesmo a 4 nós durante 10 min; a meio, os alarmes AIS seguem (o barco saiu do lugar: já não está amarrado); com o "Larguei", o "✓ Resolvido"', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  amarradoEmPeniche(app)
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 })
  const textos = () => tgf.enviados.filter(m => m.chatId === '111').map(m => m.text)
  try {
    const r = rotas(p)
    p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
    // à vela (sem rotações), a 3 nós e a 40 m do ponto
    app.pôr('navigation.position', aNorteDe(MARINA_PENICHE, 40))
    app.pôr('navigation.speedOverGround', 3 * NO)
    assert.ok(await ate(() => app.getSelfPath(DERIVA)?.value?.state === 'alarm'))
    assert.deepEqual(app.getSelfPath(DERIVA).value, { state: 'alarm', method: ['visual', 'sound'], message: 'O barco saiu do lugar: está a 40 m do ponto de amarração', apito: 'curto', acao: 'largar' })
    assert.ok(await ate(() => textos().includes('🚨 O barco saiu do lugar: está a 40 m do ponto de amarração')), JSON.stringify(textos()))
    // o barco já saiu do lugar (o ponto fica até ao "Larguei"): um alarme AIS segue para o Telegram
    app.pôr('notifications.arlequin.ais.263000001', { state: 'alarm', method: ['visual', 'sound'], message: 'AIS: perigo de colisão' })
    assert.ok(await ate(() => textos().includes('🚨 AIS: perigo de colisão')), JSON.stringify(textos()))
    // 10 min a 4 nós, a 1,2 km: o alarme fica, sem "Resolvido" (o plugin vê-o antes e depois dos 10 min)
    app.pôr('navigation.position', aNorteDe(MARINA_PENICHE, 1200))
    app.pôr('navigation.speedOverGround', 4 * NO)
    let ciclo = app.ticks
    assert.ok(await ate(() => app.ticks >= ciclo + 2))
    agora += 10 * MIN
    ciclo = app.ticks
    assert.ok(await ate(() => app.ticks >= ciclo + 3))
    assert.equal(app.getSelfPath(DERIVA).value.state, 'alarm')
    assert.ok(!textos().some(t => /Resolvido: O barco saiu/.test(t)), JSON.stringify(textos()))
    assert.match(app.estado, / · amarrado · /)
    // "Larguei" no ecrã
    assert.deepEqual(await chamar(r['POST /largar'].h), { code: 200, ok: true })
    assert.ok(await ate(() => app.getSelfPath(DERIVA)?.value?.state === 'normal'))
    assert.deepEqual(app.getSelfPath(DERIVA).value, { state: 'normal', method: [], message: 'Normal' })
    assert.ok(await ate(() => textos().includes('✓ Resolvido: O barco saiu do lugar: está a 40 m do ponto de amarração')), JSON.stringify(textos()))
    assert.ok(await ate(() => / · sem ponto · /.test(app.estado)), app.estado)
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.dir, 'porto.json'), 'utf8')).ponto, null)
  } finally { p.stop(); await tgf.fechar() }
})

test('contrato C11: com a ligação ao motor "sem-ligacao" ou "calado", as rotações que ficaram na árvore não contam (a sair, o "saiu do lugar" fica); com "a-receber" (ou sem o campo, um J1939 antigo), a motor, o ponto apaga-se sem alarme', async () => {
  for (const [ligacao, alarme] of [['sem-ligacao', true], ['calado', true], ['a-receber', false], [undefined, false]]) {
    const app = appFalso()
    amarradoEmPeniche(app)
    const p = criar(app, { tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 })
    p.start({})
    try {
      assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
      app.pôr('propulsion.main.revolutions', 13) // 780 rpm que ficaram na árvore
      if (ligacao) app.pôr('propulsion.main.ligacao', ligacao)
      app.pôr('navigation.position', aNorteDe(MARINA_PENICHE, 40))
      app.pôr('navigation.speedOverGround', 3 * NO)
      if (alarme) {
        assert.ok(await ate(() => app.getSelfPath(DERIVA)?.value?.state === 'alarm'), String(ligacao))
        assert.match(app.estado, / · amarrado · /)
      } else {
        assert.ok(await ate(() => / · sem ponto · /.test(app.estado)), `${ligacao}: ${app.estado}`)
        assert.equal(app.getSelfPath(DERIVA), undefined, String(ligacao))
      }
    } finally { p.stop() }
  }
})

test('Adenda 2 (Largar): a motor com o alarme de intrusão armado (roubo): o ponto fica e o "saiu do lugar" sai aos 30 m', async () => {
  const app = appFalso()
  fs.writeFileSync(path.join(app.dir, 'porto.json'), JSON.stringify({ armado: true, ponto: MARINA_PENICHE, ativos: {} }))
  const p = criar(app, { tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 })
  p.start({})
  try {
    assert.ok(await ate(() => /^🔒 armado · amarrado · /.test(app.estado)), app.estado)
    app.pôr('propulsion.main.revolutions', 13)
    app.pôr('propulsion.main.ligacao', 'a-receber')
    app.pôr('navigation.position', aNorteDe(MARINA_PENICHE, 35))
    app.pôr('navigation.speedOverGround', 4 * NO)
    assert.ok(await ate(() => app.getSelfPath(DERIVA)?.value?.state === 'alarm'))
    assert.match(app.getSelfPath(DERIVA).value.message, /está a 35 m/)
    assert.match(app.estado, / · amarrado · /)
  } finally { p.stop() }
})

test('auditoria I-20: um fundeadouro posto na configuração (lugares) conta como conhecido', async () => {
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, tickMs: 50, encaminharMs: 50 })
  p.start({ lugares: [{ nome: 'Bóia da Arrábida', latitude: BOIA.latitude, longitude: BOIA.longitude }] })
  try {
    app.pôr('navigation.position', { latitude: BOIA.latitude + 300 / 111320, longitude: BOIA.longitude })
    app.pôr('navigation.speedOverGround', 0)
    await ciclos(app)
    agora += 31 * MIN
    assert.ok(await ate(() => / · amarrado · /.test(app.estado)), app.estado)
  } finally { p.stop() }
})
