'use strict'
// Auditoria K-09 (decisão n.º 17 do dono): um alarme que o Telegram não aceitou fica numa fila gravada
// no encaminhador.json e tenta-se outra vez, com recuo até 1 min, até ser entregue a pelo menos um chat
// autorizado; chega com "(atrasado N min)".
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { porNaFila, textoAEnviar, recuoMs, filaValida, MAX_FILA } = require('../lib/fila')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

const S = 1000
const MIN = 60 * S

test('fila: entra pela ordem, com a hora a que devia sair; acima do máximo sai a mais antiga', () => {
  let r = porNaFila([], ['🚨 Água no porão!', '🔥 FUMO a bordo!'], 1000)
  assert.deepEqual(r, { fila: [{ texto: '🚨 Água no porão!', desde: 1000 }, { texto: '🔥 FUMO a bordo!', desde: 1000 }], perdidas: [] })
  r = porNaFila(r.fila, ['✓ Resolvido: Água no porão!'], 5000, 2)
  assert.deepEqual(r.fila.map(i => i.texto), ['🔥 FUMO a bordo!', '✓ Resolvido: Água no porão!'])
  assert.deepEqual(r.perdidas, [{ texto: '🚨 Água no porão!', desde: 1000 }])
  assert.equal(MAX_FILA, 100)
})

test('fila: "(atrasado N min)" só a partir de 1 min de atraso, em minutos inteiros', () => {
  const item = { texto: '🚨 Água no porão!', desde: 0 }
  assert.equal(textoAEnviar(item, 59 * S), '🚨 Água no porão!')
  assert.equal(textoAEnviar(item, MIN), '🚨 Água no porão! (atrasado 1 min)')
  assert.equal(textoAEnviar(item, 5 * MIN + 59 * S), '🚨 Água no porão! (atrasado 5 min)')
  assert.equal(textoAEnviar(item, 125 * MIN), '🚨 Água no porão! (atrasado 125 min)')
})

test('fila: recuo de 2 s, 4 s, 8 s, 16 s, 32 s e depois 1 min; nunca menos do que o retry_after do Telegram', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map(n => recuoMs(n)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  assert.equal(recuoMs(1, 35), 35000)
  assert.equal(recuoMs(6, 35), 60000)
  assert.equal(recuoMs(1, null), 2000)
})

test('fila: do encaminhador.json só se aproveitam os itens com texto e hora', () => {
  assert.deepEqual(filaValida([{ texto: 'a', desde: 1 }, { texto: '', desde: 2 }, { texto: 'b' }, null, 'x', { texto: 'c', desde: 3, outro: 1 }]), [{ texto: 'a', desde: 1 }, { texto: 'c', desde: 3 }])
  assert.deepEqual(filaValida(undefined), [])
  assert.deepEqual(filaValida({}), [])
})

// ---------- ponta a ponta: o plugin, o Telegram falso e um relógio injetado ----------

function appFalso (dir) {
  const app = { arvore: {}, estado: '', erros: [] }
  app.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-fila-'))
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
const naFila = (app) => { try { return JSON.parse(fs.readFileSync(path.join(app.dir, 'encaminhador.json'), 'utf8')).porEnviar || [] } catch { return [] } }
const textos = (tgf, chat = '111') => tgf.enviados.filter(m => m.chatId === chat).map(m => m.text)
const RAPIDO = { tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 }
// o estado do plugin diz quantas tentativas falharam: só se mexe no relógio depois de o plugin ter
// tratado a falha (senão o recuo conta a partir do relógio já mexido)
const falhadas = (app, n) => ate(() => app.estado.includes(`(${n} ${n === 1 ? 'tentativa falhada' : 'tentativas falhadas'})`))

test('auditoria K-09: o alarme que o Telegram não aceitou fica na fila (encaminhador.json) e sai quando a rede volta, com "(atrasado N min)" (sonda p2-B)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.cortar()
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => tgf.cortados.length >= 1), 'tentou enviar')
    assert.ok(await ate(() => naFila(app).length === 1), JSON.stringify(naFila(app)))
    assert.deepEqual(naFila(app), [{ texto: '🚨 Água no porão!', desde: agora }])
    assert.deepEqual(tgf.enviados, [])
    assert.ok(await falhadas(app, 1), app.estado)
    assert.match(app.estado, / · 1 por entregar \(1 tentativa falhada\)$/)
    // a rede volta 5 min depois
    agora += 5 * MIN
    tgf.religar()
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.deepEqual(textos(tgf), ['🚨 Água no porão! (atrasado 5 min)'])
    assert.ok(await ate(() => naFila(app).length === 0))
    await esperar(300)
    assert.deepEqual(textos(tgf), ['🚨 Água no porão! (atrasado 5 min)'], 'só uma vez')
    assert.doesNotMatch(app.estado, /por entregar/)
    // o registo diz uma vez porquê (sem o prefixo repetido)
    assert.equal(app.erros.length, 1, JSON.stringify(app.erros))
    assert.match(app.erros[0], /^Telegram sendMessage: sem ligação/)
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria K-09: sem rede, tenta outra vez com recuo (pelo relógio), não de 2 em 2 s', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  const tentativas = () => tgf.cortados.filter(c => c.metodo === 'sendMessage').length
  try {
    tgf.cortar()
    app.pôr('sensors.fumo', 1)
    assert.ok(await falhadas(app, 1))
    await esperar(400) // muitos ciclos de 50 ms com o relógio parado: não tenta outra vez
    assert.equal(tentativas(), 1)
    agora += 2 * S
    assert.ok(await falhadas(app, 2))
    assert.equal(tentativas(), 2)
    agora += 3 * S // o 2.º recuo é de 4 s
    await esperar(400)
    assert.equal(tentativas(), 2)
    agora += 1 * S
    assert.ok(await falhadas(app, 3))
    assert.equal(tentativas(), 3)
    // muito tempo sem rede: nunca mais de 1 min entre tentativas
    for (let i = 0; i < 6; i++) {
      agora += MIN
      assert.ok(await falhadas(app, 4 + i), `tentativa ${4 + i}: ${app.estado}`)
      assert.equal(tentativas(), 4 + i)
    }
    tgf.religar()
    agora += MIN
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.deepEqual(textos(tgf), ['🔥 FUMO a bordo! (atrasado 7 min)'])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria K-09: pela ordem — o "Resolvido" de um alarme por entregar nunca chega antes dele', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.cortar()
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => naFila(app).length === 1))
    assert.ok(await falhadas(app, 1))
    agora += 3 * MIN
    app.pôr('sensors.porao.agua', 0)
    assert.ok(await ate(() => naFila(app).length === 2))
    assert.ok(await falhadas(app, 2), app.estado) // a nova tentativa da cabeça, já com o relógio dos 3 min
    agora += 2 * MIN
    tgf.religar()
    assert.ok(await ate(() => textos(tgf).length === 2))
    assert.deepEqual(textos(tgf), ['🚨 Água no porão! (atrasado 5 min)', '✓ Resolvido: Água no porão! (atrasado 2 min)'])
    assert.ok(await ate(() => naFila(app).length === 0))
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria K-09: a fila sobrevive a um reinício do plugin (está no encaminhador.json) e sai depois dele', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const props = { telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 }
  let p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start(props)
  try {
    tgf.cortar()
    app.pôr('sensors.gasoleo.liquido', 1)
    assert.ok(await ate(() => naFila(app).length === 1))
    assert.ok(await falhadas(app, 1)) // (um envio ainda a caminho podia chegar depois do religar)
    p.stop()
    assert.deepEqual(naFila(app).map(i => i.texto), ['🚨 Líquido debaixo do depósito de gasóleo: possível fuga'])
    agora += 12 * MIN
    tgf.religar()
    p = criar(app, { agora: () => agora, ...RAPIDO })
    p.start(props)
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.deepEqual(textos(tgf), ['🚨 Líquido debaixo do depósito de gasóleo: possível fuga (atrasado 12 min)'])
    assert.ok(await ate(() => naFila(app).length === 0))
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria K-09: entregue a pelo menos um chat autorizado sai da fila (um chat que bloqueou o bot não a prende); nunca vai aos contactos do plano', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111', '333'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('333')
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.ok(await ate(() => naFila(app).length === 0))
    agora += 5 * MIN
    await esperar(300)
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!'], 'não se repete')
    assert.deepEqual(textos(tgf, '222'), [], 'os contactos do plano nunca recebem os alarmes')
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria K-09: sem chats autorizados (ou sem token) não se guarda nada na fila', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app, RAPIDO)
  p.start({ telegramToken: 'TESTE', chatIds: [], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => app.getSelfPath('notifications.arlequin.porto.aguaPorao')?.value?.state === 'alarm'))
    await esperar(300)
    assert.deepEqual(naFila(app), [])
    assert.deepEqual(tgf.enviados, [])
  } finally { p.stop(); await tgf.fechar() }
})
