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
const { porNaFila, proximo, textoAEnviar, recuoMs, filaValida, MAX_FILA, MAX_TEXTO, MAX_RECUSAS } = require('../lib/fila')
const { recusaDoTelegram } = require('../lib/telegram')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

const S = 1000
const MIN = 60 * S

const AGUA = 'notifications.arlequin.porto.aguaPorao'
const FUMO = 'notifications.arlequin.porto.fumo'
const ativo = (caminho, texto, estado = 'alarm') => ({ texto: `${{ emergency: '🔥', alarm: '🚨' }[estado] || '⚠️'} ${texto}`, caminho, estado })
const resolvido = (caminho, texto) => ({ texto: `✓ Resolvido: ${texto}`, caminho, estado: 'normal' })
// a ordem pela qual a fila sai (sempre o `proximo`)
function ordemDeSaida (fila) {
  const out = []
  let f = fila
  while (f.length) { const i = proximo(f); out.push(f[i].texto); f = f.filter((_, k) => k !== i) }
  return out
}

test('fila: entra pela ordem, com a hora a que devia sair, o caminho e o estado (auditoria F4b: para a prioridade)', () => {
  const r = porNaFila([], [ativo(AGUA, 'Água no porão!'), ativo(FUMO, 'FUMO a bordo!', 'emergency')], 1000)
  assert.deepEqual(r, {
    fila: [{ texto: '🚨 Água no porão!', desde: 1000, caminho: AGUA, estado: 'alarm' }, { texto: '🔥 FUMO a bordo!', desde: 1000, caminho: FUMO, estado: 'emergency' }],
    perdidas: []
  })
  // os avisos do próprio plugin (texto solto): sem caminho
  assert.deepEqual(porNaFila([], ['⚠️ Perdi o estado do porto'], 5).fila, [{ texto: '⚠️ Perdi o estado do porto', desde: 5, caminho: null, sistema: true }])
  assert.equal(MAX_FILA, 100)
})

test('auditoria F4b (Importante 1): um texto acima do limite do Telegram entra na fila cortado, com "…" e espaço para o "(atrasado N min)"; nunca se parte um emoji; um texto mal codificado fica bem formado', () => {
  const [longo] = porNaFila([], ['⚠️ ' + 'x'.repeat(5000)], 0).fila
  assert.equal(longo.texto.length, MAX_TEXTO)
  assert.ok(longo.texto.endsWith('x…'))
  assert.ok(MAX_TEXTO + ' (atrasado 1440 min)'.length <= 4096)
  // um emoji (dois caracteres UTF-16) no sítio do corte fica inteiro ou sai todo
  const [emojis] = porNaFila([], ['🚨'.repeat(2100)], 0).fila
  assert.equal(emojis.texto, '🚨'.repeat(1999) + '…')
  // meio emoji perdido (o Telegram recusa o que não é UTF-8): passa a "�"
  assert.equal(porNaFila([], ['🚨 a\ud800b'], 0).fila[0].texto, '🚨 a�b')
  // um texto curto fica igual
  assert.equal(porNaFila([], ['🚨 Água no porão!'], 0).fila[0].texto, '🚨 Água no porão!')
})

test('auditoria F4b (Importante 1): as recusas do Telegram que não passam com outra tentativa ("mensagem" ou "chat") e as que passam (null: rede, 5xx, 429, o token)', () => {
  const e = (codigo, descricao) => Object.assign(new Error(`Telegram sendMessage: ${descricao}`), { codigo, descricao })
  assert.equal(recusaDoTelegram(e(400, 'Bad Request: message is too long')), 'mensagem')
  assert.equal(recusaDoTelegram(e(400, 'Bad Request: message text is empty')), 'mensagem')
  assert.equal(recusaDoTelegram(e(400, "Bad Request: can't parse entities: Unsupported start tag")), 'mensagem')
  assert.equal(recusaDoTelegram(e(400, 'Bad Request: strings must be encoded in UTF-8')), 'mensagem')
  assert.equal(recusaDoTelegram(e(400, 'Bad Request: chat not found')), 'chat')
  assert.equal(recusaDoTelegram(e(400, 'Bad Request: PEER_ID_INVALID')), 'chat')
  assert.equal(recusaDoTelegram(e(403, 'Forbidden: bot was blocked by the user')), 'chat')
  assert.equal(recusaDoTelegram(e(403, 'Forbidden: user is deactivated')), 'chat')
  for (const x of [
    Object.assign(new Error('Telegram sendMessage: sem ligação (fetch failed)'), { semLigacao: true }),
    e(429, 'Too Many Requests: retry after 5'), e(500, 'Internal Server Error'), e(502, 'Bad Gateway'),
    e(401, 'Unauthorized'), e(404, 'Not Found'), e(409, 'Conflict'), new TypeError('x is not a function')
  ]) assert.equal(recusaDoTelegram(x), null, x.message)
  assert.equal(MAX_RECUSAS, 3)
})

test('auditoria F4b (Importante 1): os alarmes passam à frente dos avisos e dos "Resolvido" mais antigos (o FUMO primeiro); cada caminho sai pela sua ordem e a sua cabeça vai com a pressa do mais grave que tem na fila', () => {
  const R = 'notifications.rota.recursos'
  const fila = porNaFila([], [
    ativo(R, 'Recursos: gasóleo à chegada ~34 L', 'warn'), resolvido(R, 'Recursos: gasóleo à chegada ~34 L'),
    ativo(AGUA, 'Água no porão!'), resolvido(AGUA, 'Água no porão!'), ativo(AGUA, 'Água no porão!'),
    '⚠️ Perdi o estado do porto',
    ativo(FUMO, 'FUMO a bordo!', 'emergency')
  ], 0).fila
  assert.deepEqual(ordemDeSaida(fila), [
    '🔥 FUMO a bordo!',
    '🚨 Água no porão!', '✓ Resolvido: Água no porão!', '🚨 Água no porão!',
    '⚠️ Recursos: gasóleo à chegada ~34 L',
    '✓ Resolvido: Recursos: gasóleo à chegada ~34 L', '⚠️ Perdi o estado do porto'
  ])
  // um aviso que escalou para alarme no mesmo caminho não fica atrás dos alarmes (leva a pressa do seu
  // alarme e é mais antigo); entre alarmes, pela ordem de entrada
  const S2 = 'notifications.arlequin.energia.servico'
  assert.deepEqual(ordemDeSaida(porNaFila([], [ativo(S2, 'Serviço a 52%', 'warn'), ativo(AGUA, 'Água no porão!'), ativo(S2, 'Serviço a 49%'), ativo(FUMO, 'FUMO a bordo!', 'warn')], 0).fila),
    ['⚠️ Serviço a 52%', '🚨 Água no porão!', '🚨 Serviço a 49%', '⚠️ FUMO a bordo!'])
})

test('auditoria F4b (Importante 1): o limite dos 100 nunca tira um alarme deixando o seu "Resolvido" órfão (sonda da revisão); saem primeiro as oscilações, depois os casos já acabados, os avisos do plugin, os "Resolvido" soltos e só no fim um alarme', () => {
  let fila = porNaFila([], [ativo(AGUA, 'Água no porão!'), resolvido(AGUA, 'Água no porão!')], 0).fila
  for (let i = 0; i < 49; i++) fila = porNaFila(fila, [ativo(`notifications.arlequin.ais.${i}`, `AIS ${i}`), resolvido(`notifications.arlequin.ais.${i}`, `AIS ${i}`)], i + 1).fila
  assert.equal(fila.length, 100)
  const r = porNaFila(fila, [ativo(FUMO, 'FUMO a bordo!', 'emergency')], 99)
  assert.ok(r.fila.length <= MAX_FILA)
  assert.ok(r.fila.some(x => x.texto === '🔥 FUMO a bordo!'), 'o FUMO fica')
  // o caso mais antigo já acabado sai inteiro (o alarme e o seu "Resolvido")
  assert.deepEqual(r.perdidas.map(x => x.texto), ['🚨 Água no porão!', '✓ Resolvido: Água no porão!'])
  for (const [i, x] of r.fila.entries()) {
    if (x.estado === 'normal') assert.ok(r.fila.slice(0, i).some(y => y.caminho === x.caminho && y.estado !== 'normal'), `"Resolvido" órfão: ${x.texto}`)
  }
  // 1.º as oscilações: o "Resolvido" e o alarme que voltou (fica o 1.º alarme e o fim)
  const P = 'notifications.x.p'
  const Q = 'notifications.x.q'
  let g = porNaFila([], [ativo(P, 'P'), resolvido(P, 'P'), ativo(P, 'P'), resolvido(P, 'P'), ativo(Q, 'Q')], 0, { max: 4 })
  assert.deepEqual(g.fila.map(x => x.texto), ['🚨 P', '✓ Resolvido: P', '🚨 Q'])
  assert.deepEqual(g.perdidas.map(x => x.texto), ['✓ Resolvido: P', '🚨 P'])
  // 2.º os casos acabados: os avisos antes dos alarmes
  g = porNaFila([], [ativo(P, 'P'), resolvido(P, 'P'), ativo(Q, 'Q', 'warn'), resolvido(Q, 'Q'), ativo(AGUA, 'Água')], 0, { max: 3 })
  assert.deepEqual(g.fila.map(x => x.texto), ['🚨 P', '✓ Resolvido: P', '🚨 Água'])
  // 3.º os avisos do plugin; 4.º os "Resolvido" soltos (o alarme já foi entregue); 5.º o alarme menos grave, o mais antigo
  g = porNaFila([], [resolvido(P, 'P'), '⚠️ aviso do plugin', ativo(Q, 'Q', 'warn'), ativo(AGUA, 'Água'), ativo(FUMO, 'FUMO', 'emergency')], 0, { max: 4 })
  assert.deepEqual(g.perdidas.map(x => x.texto), ['⚠️ aviso do plugin'])
  g = porNaFila(g.fila, [], 0, { max: 3 })
  assert.deepEqual(g.perdidas.map(x => x.texto), ['✓ Resolvido: P'])
  g = porNaFila(g.fila, [], 0, { max: 1 })
  assert.deepEqual(g.perdidas.map(x => x.texto), ['⚠️ Q', '🚨 Água'])
  assert.deepEqual(g.fila.map(x => x.texto), ['🔥 FUMO'])
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

test('fila: do encaminhador.json só se aproveitam os itens com texto e hora (com o caminho, o estado e as recusas); os de uma versão antiga ganham o estado pelo ícone e um caminho pelo texto', () => {
  assert.deepEqual(filaValida([
    { texto: '🚨 a', desde: 1, caminho: AGUA, estado: 'alarm', recusas: 2 }, { texto: '', desde: 2 }, { texto: 'b' }, null, 'x',
    { texto: '⚠️ aviso', desde: 3, caminho: null, sistema: true, outro: 1 }, { texto: '🚨 c', desde: 4, caminho: AGUA, estado: 'alarm', recusas: -1 }
  ]), [
    { texto: '🚨 a', desde: 1, caminho: AGUA, estado: 'alarm', recusas: 2 },
    { texto: '⚠️ aviso', desde: 3, caminho: null, sistema: true },
    { texto: '🚨 c', desde: 4, caminho: AGUA, estado: 'alarm' }
  ])
  // a fila gravada pela versão anterior ({ texto, desde }): o alarme e o seu "Resolvido" ficam no mesmo caminho
  assert.deepEqual(filaValida([{ texto: '🚨 Água no porão!', desde: 1 }, { texto: '✓ Resolvido: Água no porão!', desde: 2 }, { texto: '🔥 FUMO a bordo!', desde: 3 }, { texto: '⚠️ Serviço a 52%', desde: 4 }]), [
    { texto: '🚨 Água no porão!', desde: 1, caminho: 'texto:Água no porão!', estado: 'alarm' },
    { texto: '✓ Resolvido: Água no porão!', desde: 2, caminho: 'texto:Água no porão!', estado: 'normal' },
    { texto: '🔥 FUMO a bordo!', desde: 3, caminho: 'texto:FUMO a bordo!', estado: 'emergency' },
    { texto: '⚠️ Serviço a 52%', desde: 4, caminho: 'texto:Serviço a 52%', estado: 'warn' }
  ])
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
    assert.deepEqual(naFila(app), [{ texto: '🚨 Água no porão!', desde: agora, caminho: AGUA, estado: 'alarm' }])
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

test('auditoria K-09: um stop() e start() (gravar a configuração) com um envio a meio que chega: não se repete', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const original = globalThis.fetch
  // o Telegram aceita o envio, mas a resposta só chega ao barco quando o teste a soltar
  let soltar
  const preso = new Promise(resolve => { soltar = resolve })
  globalThis.fetch = async (url, o) => {
    const r = await original(url, o)
    if (String(url).endsWith('/sendMessage')) await preso
    return r
  }
  const p = criar(app)
  const props = { telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 }
  p.start(props)
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).length === 1))
    // o SignalK para e arranca o mesmo plugin; o arranque lê a fila do disco (ainda com a mensagem)
    p.stop()
    p.start(props)
    soltar()
    assert.ok(await ate(() => naFila(app).length === 0))
    await esperar(2600) // mais do que um ciclo do encaminhador (2 s)
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!'])
  } finally { globalThis.fetch = original; p.stop(); await tgf.fechar() }
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

// ---------- auditoria F4b (revisão da F4, Importante 1): uma mensagem recusada nunca prende a fila ----------

// o fetch do Telegram falso, com as recusas do Telegram verdadeiro: `recusa(chatId, texto)` → a descrição de
// um 400 (ou null: passa); conta os envios de cada texto
function comRecusas (recusa) {
  const original = globalThis.fetch
  const envios = []
  globalThis.fetch = async (url, o) => {
    if (String(url).endsWith('/sendMessage')) {
      const j = JSON.parse(o.body)
      envios.push({ chatId: String(j.chat_id), text: String(j.text) })
      const d = recusa(String(j.chat_id), String(j.text))
      if (d) return new Response(JSON.stringify({ ok: false, error_code: 400, description: d }), { status: 400 })
    }
    return original(url, o)
  }
  return { envios, repor: () => { globalThis.fetch = original } }
}

test('auditoria F4b (Importante 1, sonda da revisão): uma notificação com 5000 caracteres (o Telegram recusa acima de 4096) já não prende o "Água no porão!" que vem a seguir', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  // como o Telegram verdadeiro: 400 "message is too long" acima de 4096 caracteres
  const f = comRecusas((chat, texto) => (texto.length > 4096 ? 'Bad Request: message is too long' : null))
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr('notifications.outroPlugin.relatorio', { state: 'warn', message: 'x'.repeat(5000) })
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).includes('🚨 Água no porão!')), `${app.estado} ${JSON.stringify(textos(tgf).map(t => t.slice(0, 40)))}`)
    const longo = textos(tgf).find(t => t.startsWith('⚠️ xxx'))
    assert.ok(longo, 'o aviso longo também chegou (cortado)')
    assert.ok(longo.length <= 4096 && longo.endsWith('…'), String(longo.length))
    assert.ok(await ate(() => naFila(app).length === 0))
    assert.ok(f.envios.every(m => m.text.length <= 4096), 'nunca se envia um texto que o Telegram recusa pelo tamanho')
  } finally { f.repor(); p.stop(); await tgf.fechar() }
})

test('auditoria F4b (Importante 1): uma mensagem que o Telegram recusa sempre sai da fila ao fim de 3 tentativas, com uma linha no registo e um aviso curto ao Ivo; o alarme que vinha atrás chega (e passa-lhe à frente)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  // uma recusa que o plugin não consegue evitar (o Telegram conta os caracteres de outra maneira, por exemplo)
  const f = comRecusas((chat, texto) => (texto.startsWith('⚠️ mensagem RECUSADA') ? 'Bad Request: message is too long' : null))
  const tentativas = () => f.envios.filter(m => m.text.startsWith('⚠️ mensagem RECUSADA')).length
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr('notifications.outroPlugin.relatorio', { state: 'warn', message: 'mensagem RECUSADA pelo Telegram' })
    assert.ok(await falhadas(app, 1), app.estado)
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => / · 2 por entregar \(1 tentativa falhada\)$/.test(app.estado)), app.estado)
    agora += 2 * S // o recuo de 2 s: o alarme passa à frente da recusada, que volta a ser tentada a seguir
    assert.ok(await ate(() => textos(tgf).includes('🚨 Água no porão!')), `${app.estado} ${JSON.stringify(textos(tgf))}`)
    assert.ok(await ate(() => tentativas() === 2 && / · 1 por entregar \(1 tentativa falhada\)$/.test(app.estado)), app.estado)
    agora += 2 * S // a 3.ª recusa tira-a da fila e a fila segue (o aviso ao Ivo)
    assert.ok(await ate(() => textos(tgf).length === 2), JSON.stringify(textos(tgf)))
    assert.deepEqual(textos(tgf), [
      '🚨 Água no porão!',
      '⚠️ O Telegram recusou 3 vezes uma mensagem e desisti dela (a mensagem é demasiado longa para o Telegram): «⚠️ mensagem RECUSADA pelo Telegram»'
    ])
    assert.equal(tentativas(), 3, 'tentou 3 vezes')
    assert.ok(await ate(() => naFila(app).length === 0))
    assert.deepEqual(app.erros.filter(e => /desisti/.test(e)), ['fila do Telegram: desisti de "⚠️ mensagem RECUSADA pelo Telegram" ao fim de 3 recusas (Telegram sendMessage: Bad Request: message is too long)'])
    // e o estado do plugin marca-o (o ciclo de 1 s escreve-o)
    assert.ok(await ate(() => / · Telegram ligado · 1 recusada pelo Telegram$/.test(app.estado)), app.estado)
  } finally { f.repor(); p.stop(); await tgf.fechar() }
})

test('auditoria F4b (Importante 1): com todos os chats recusados (o "chat not found" de um código mal escrito) a mensagem também sai ao fim de 3 tentativas, sem aviso (não há a quem o dar) e sem ciclo sem fim', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const f = comRecusas(() => 'Bad Request: chat not found')
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await falhadas(app, 1), app.estado)
    agora += 2 * S
    assert.ok(await falhadas(app, 2), app.estado)
    agora += 4 * S
    assert.ok(await ate(() => naFila(app).length === 0), JSON.stringify(naFila(app)))
    agora += 10 * MIN
    await esperar(200)
    assert.equal(f.envios.length, 3, JSON.stringify(f.envios))
    assert.deepEqual(app.erros.filter(e => /desisti/.test(e)), ['fila do Telegram: desisti de "🚨 Água no porão!" ao fim de 3 recusas (Telegram sendMessage: Bad Request: chat not found)'])
  } finally { f.repor(); p.stop(); await tgf.fechar() }
})

test('auditoria F4b (Importante 1): um chat que recusa (bloqueou o bot) e outro sem rede não tiram a mensagem da fila (a rede pode voltar)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let semRede = true
  const original = globalThis.fetch
  globalThis.fetch = async (url, o) => {
    if (String(url).endsWith('/sendMessage') && semRede && JSON.parse(o.body).chat_id === '333') throw new TypeError('fetch failed')
    return original(url, o)
  }
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111', '333'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('111')
    app.pôr('sensors.porao.agua', 1)
    for (const [n, recuo] of [[1, 2], [2, 4], [3, 8], [4, 16]]) {
      assert.ok(await falhadas(app, n), app.estado)
      agora += recuo * S
    }
    assert.ok(await falhadas(app, 5), app.estado)
    assert.equal(naFila(app).length, 1, 'continua na fila')
    semRede = false
    agora += MIN
    assert.ok(await ate(() => textos(tgf, '333').length === 1))
    assert.deepEqual(textos(tgf, '333'), ['🚨 Água no porão! (atrasado 1 min)'])
  } finally { globalThis.fetch = original; p.stop(); await tgf.fechar() }
})

test('auditoria F4b (Importante 1): um FUMO novo não espera atrás das mensagens antigas da fila (avisos e "Resolvido"): é o primeiro a sair quando a rede volta', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.cortar()
    app.pôr('notifications.rota.recursos', { state: 'warn', message: 'Recursos: gasóleo à chegada ~34 L' })
    app.pôr('notifications.arlequin.energia.servico', { state: 'warn', message: 'Serviço a 52%' })
    assert.ok(await ate(() => naFila(app).length === 2))
    app.pôr('notifications.rota.recursos', { state: 'normal', message: '' })
    assert.ok(await ate(() => naFila(app).length === 3))
    agora += 3 * MIN
    app.pôr('sensors.fumo', 1)
    // a 2.ª tentativa (ainda sem rede) já foi tratada: só depois se mexe no relógio e na rede (senão um
    // envio a caminho chegava com o relógio antigo)
    assert.ok(await ate(() => / · 4 por entregar \(2 tentativas falhadas\)$/.test(app.estado)), app.estado)
    agora += 2 * MIN
    tgf.religar()
    assert.ok(await ate(() => textos(tgf).length === 4), JSON.stringify(textos(tgf)))
    // o FUMO primeiro; depois os avisos pela ordem de entrada e só no fim o "Resolvido"
    assert.deepEqual(textos(tgf), [
      '🔥 FUMO a bordo! (atrasado 2 min)',
      '⚠️ Recursos: gasóleo à chegada ~34 L (atrasado 5 min)',
      '⚠️ Serviço a 52% (atrasado 5 min)',
      '✓ Resolvido: Recursos: gasóleo à chegada ~34 L (atrasado 5 min)'
    ])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria F4b (revisão, Menor 13): o limite da fila tem registo (sem rede, a fila cheia deixa sair primeiro os casos já acabados)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO, maxFila: 3 })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.cortar()
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => naFila(app).length === 1))
    app.pôr('sensors.porao.agua', 0)
    assert.ok(await ate(() => naFila(app).length === 2))
    app.pôr('notifications.arlequin.energia.servico', { state: 'warn', message: 'Serviço a 52%' })
    assert.ok(await ate(() => naFila(app).length === 3))
    app.pôr('sensors.fumo', 1)
    assert.ok(await ate(() => app.erros.some(e => /fila do Telegram cheia/.test(e))), JSON.stringify(app.erros))
    assert.deepEqual(app.erros.filter(e => /fila do Telegram cheia/.test(e)), [
      'fila do Telegram cheia: já não vou entregar "🚨 Água no porão!"',
      'fila do Telegram cheia: já não vou entregar "✓ Resolvido: Água no porão!"'
    ])
    assert.deepEqual(naFila(app).map(i => i.texto), ['⚠️ Serviço a 52%', '🔥 FUMO a bordo!'])
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
