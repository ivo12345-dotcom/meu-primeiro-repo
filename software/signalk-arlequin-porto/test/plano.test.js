'use strict'
// O plano de navegação (desenho 3b-1): o evento do plugin da rota → mensagem + GPX pelo Telegram aos
// chatIds e aos contactosPlano; os contactos do plano só recebem; quem não é conhecido recebe o código.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const criar = require('..')
const { criarTelegram } = require('../lib/telegram')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

function appFalso () {
  const app = new EventEmitter()
  Object.assign(app, { arvore: {}, estado: '', erros: [] })
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-plano-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => p.split('.').reduce((n, k) => n?.[k], app.arvore)
  app.handleMessage = () => {}
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ate (cond, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(50) } return false }
const respostaDe = (app, pedido) => new Promise(resolve => app.on('arlequin:plano-enviado', (m) => { if (m.pedido === pedido) resolve(m) }))

const GPX = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1"><rte><name>Peniche → Nazaré</name></rte></gpx>\n'
const PLANO = { pedido: 'p1', texto: 'PLANO DE NAVEGAÇÃO · ARLEQUIN\nHora de alarme: 20:21', gpx: GPX, nomeFicheiro: 'arlequin-peniche-nazare-20260930-0930.gpx' }

test('sendDocument: multipart com o ficheiro, o nome e a legenda; o Telegram falso guarda o que recebe', async () => {
  const tgf = await criarTelegramFalso()
  try {
    const tg = criarTelegram({ token: 'T', base: tgf.url })
    await tg.sendDocument('111', Buffer.from(GPX), 'rota.gpx', 'A rota (GPX)')
    await tg.sendDocument(222, Buffer.from('x'), 'b.gpx')
    assert.deepEqual(tgf.enviados.map(({ metodo, chatId, caption, nomeFicheiro, conteudo }) => ({ metodo, chatId, caption, nomeFicheiro, conteudo })), [
      { metodo: 'sendDocument', chatId: '111', caption: 'A rota (GPX)', nomeFicheiro: 'rota.gpx', conteudo: GPX },
      { metodo: 'sendDocument', chatId: '222', caption: '', nomeFicheiro: 'b.gpx', conteudo: 'x' }
    ])
    tgf.bloquear('333')
    await assert.rejects(tg.sendDocument('333', Buffer.from('x'), 'c.gpx'), /Telegram sendDocument: Forbidden: bot was blocked by the user/)
  } finally { await tgf.fechar() }
})

test('o evento arlequin:plano envia a mensagem e o GPX aos chatIds e aos contactosPlano (sem repetir) e responde com arlequin:plano-enviado', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Ivo outra vez', chatId: '111' }, { nome: 'Tio', chatId: '333' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('333')
    const resposta = respostaDe(app, 'p1')
    app.emit('arlequin:plano', PLANO)
    const r = await resposta
    assert.deepEqual(r, { pedido: 'p1', entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], falhas: [{ nome: 'Tio', erro: 'bloqueou o bot' }] })
    for (const chat of ['111', '222']) {
      const m = tgf.enviados.filter(x => x.chatId === chat)
      assert.deepEqual(m.map(x => x.metodo), ['sendMessage', 'sendDocument'], chat)
      assert.equal(m[0].text, PLANO.texto)
      assert.equal(m[1].nomeFicheiro, PLANO.nomeFicheiro)
      assert.equal(m[1].conteudo, GPX)
      assert.equal(m[1].tipo, 'application/gpx+xml')
    }
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
  assert.equal(app.listenerCount('arlequin:plano'), 0, 'o stop() tira o ouvinte')
})

test('a resposta separa os contactos em terra (contactos do plano entregues) dos chats autorizados (o do Ivo): só com o chat do Ivo, contactos vazio (revisão final, 3)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  // um chat nas duas listas é do Ivo (comanda): não conta como contacto em terra
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Ivo', chatId: '111' }, { nome: 'Tio', chatId: '333' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    const r1 = respostaDe(app, 'c1')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'c1' })
    const a = await r1
    assert.deepEqual(a.entregues, ['chat 111', 'Mãe', 'Tio'])
    assert.deepEqual(a.contactos, ['Mãe', 'Tio'])
    // os contactos em terra falham todos: entregue só ao Ivo, contactos vazio
    tgf.bloquear('222'); tgf.bloquear('333')
    const r2 = respostaDe(app, 'c2')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'c2' })
    const b = await r2
    assert.deepEqual(b.entregues, ['chat 111'])
    assert.deepEqual(b.contactos, [])
    assert.deepEqual(b.falhas.map(f => f.nome), ['Mãe', 'Tio'])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

test('sem token: responde logo que não há bot (em vez de deixar o plugin da rota à espera)', async () => {
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: '', chatIds: ['111'] })
  try {
    const resposta = respostaDe(app, 'p2')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'p2' })
    assert.deepEqual(await resposta, { pedido: 'p2', entregues: [], contactos: [], falhas: [{ nome: 'Telegram', erro: 'o plugin porto não tem o token do bot' }] })
  } finally { p.stop() }
})

test('um contacto do plano não comanda; um desconhecido recebe o código (uma vez por hora) e não fica autorizado', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.escrever(222, '/armar')
    tgf.escrever(222, '/posicao')
    tgf.escrever(999, '/start')
    const CODIGO = 'Para receberes os planos do ARLEQUIN, dá este código ao Ivo: 999'
    assert.ok(await ate(() => tgf.enviados.some(m => m.chatId === '999')), JSON.stringify(tgf.enviados))
    assert.deepEqual(tgf.enviados.filter(m => m.chatId === '999').map(m => m.text), [CODIGO])
    assert.match(app.estado + JSON.stringify(tgf.enviados), /999/)
    // o desconhecido volta a escrever: não comanda e não recebe outra vez o código (anti-spam)
    tgf.escrever(999, '/armar')
    tgf.escrever(111, '/estado') // o Ivo sim
    assert.ok(await ate(() => tgf.enviados.some(m => m.chatId === '111')))
    await esperar(300)
    assert.equal(tgf.enviados.filter(m => m.chatId === '999').length, 1)
    assert.equal(tgf.enviados.filter(m => m.chatId === '222').length, 0, 'o contacto do plano não recebe respostas a comandos')
    assert.doesNotMatch(tgf.enviados.find(m => m.chatId === '111').text, /ARMADO/, 'ninguém armou o alarme')
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

// ---------- revisão: erros em pt-PT, limites de tempo, envio em paralelo, chats normalizados ----------

test('erros do Telegram em pt-PT: bloqueado → "bloqueou o bot"; sem resposta → "sem ligação ao Telegram"; outro → "erro do Telegram: <descrição>"', async () => {
  const { erroEmPortugues } = require('../lib/telegram')
  const tgf = await criarTelegramFalso()
  try {
    const tg = criarTelegram({ token: 'T', base: tgf.url, limiteMs: 300 })
    tgf.bloquear('333')
    tgf.pendurar('444')
    const erroDe = (p) => p.then(() => null, e => e)
    assert.equal(erroEmPortugues(await erroDe(tg.sendMessage('333', 'x'))), 'bloqueou o bot')
    const t0 = Date.now()
    assert.equal(erroEmPortugues(await erroDe(tg.sendMessage('444', 'x'))), 'sem ligação ao Telegram')
    assert.ok(Date.now() - t0 < 2000, 'o limite de tempo corta a chamada pendurada')
    assert.equal(erroEmPortugues(await erroDe(tg.sendDocument('444', Buffer.from('x'), 'a.gpx'))), 'sem ligação ao Telegram')
    // outro erro descrito pelo Telegram (o cliente guarda o código e a descrição)
    assert.equal(erroEmPortugues(Object.assign(new Error('Telegram sendMessage: Bad Request: message is too long'), { codigo: 400, descricao: 'Bad Request: message is too long' })), 'erro do Telegram: Bad Request: message is too long')
    // sem servidor nenhum (ligação recusada)
    const morto = criarTelegram({ token: 'T', base: 'http://127.0.0.1:9', limiteMs: 2000 })
    assert.equal(erroEmPortugues(await erroDe(morto.sendMessage('111', 'x'))), 'sem ligação ao Telegram')
  } finally { await tgf.fechar() }
})

test('erros do Telegram em pt-PT: 400 "chat not found" → confirmar o código; 401 → token inválido; 429 → esperar N s (do retry_after)', async () => {
  const { erroEmPortugues } = require('../lib/telegram')
  // o Telegram a responder com o erro dado (o corpo real da API de bots)
  const responde = (status, corpo) => criarTelegram({ token: 'T', base: 'http://x', fetchFn: async () => new Response(JSON.stringify(corpo), { status }) })
  const erroDe = (p) => p.then(() => null, e => e)
  assert.equal(erroEmPortugues(await erroDe(responde(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }).sendMessage('999', 'x'))),
    'o chat não existe ou nunca falou com o bot: confirma o código')
  assert.equal(erroEmPortugues(await erroDe(responde(401, { ok: false, error_code: 401, description: 'Unauthorized' }).sendMessage('111', 'x'))), 'token do bot inválido')
  const e429 = await erroDe(responde(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 35', parameters: { retry_after: 35 } }).sendDocument('111', Buffer.from('x'), 'a.gpx'))
  assert.equal(e429.esperarS, 35)
  assert.equal(erroEmPortugues(e429), 'o Telegram pediu para esperar: tenta daqui a 35 s')
  // 429 sem retry_after: sem número
  assert.equal(erroEmPortugues(await erroDe(responde(429, { ok: false, error_code: 429, description: 'Too Many Requests' }).sendMessage('111', 'x'))), 'o Telegram pediu para esperar: tenta daqui a pouco')
  // os outros 400 continuam com a descrição
  assert.equal(erroEmPortugues(await erroDe(responde(400, { ok: false, error_code: 400, description: 'Bad Request: message text is empty' }).sendMessage('111', ''))), 'erro do Telegram: Bad Request: message text is empty')
})

test('o .gpx reconhece-se sem olhar a maiúsculas (ROTA.GPX → application/gpx+xml)', async () => {
  const tgf = await criarTelegramFalso()
  try {
    const tg = criarTelegram({ token: 'T', base: tgf.url })
    await tg.sendDocument('111', Buffer.from(GPX), 'ROTA.GPX')
    await tg.sendDocument('111', Buffer.from('x'), 'notas.txt')
    assert.deepEqual(tgf.enviados.map(m => m.tipo), ['application/gpx+xml', 'application/octet-stream'])
  } finally { await tgf.fechar() }
})

test('plano: falhas com o motivo em pt-PT; o GPX vai como application/gpx+xml; os destinatários em paralelo, cada chamada com limite (o envio todo fica muito abaixo dos 30 s da rota)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app, { limiteTelegramMs: 400 })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Tio', chatId: '333' }, { nome: 'A', chatId: '501' }, { nome: 'B', chatId: '502' }, { nome: 'C', chatId: '503' }, { nome: 'D', chatId: '504' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('333')
    for (const c of ['501', '502', '503', '504']) tgf.pendurar(c)
    const resposta = respostaDe(app, 'p3')
    const t0 = Date.now()
    app.emit('arlequin:plano', { ...PLANO, pedido: 'p3' })
    const r = await resposta
    const dt = Date.now() - t0
    // 4 pendurados × 400 ms em série seriam ≥ 1,6 s; em paralelo, ~0,4 s
    assert.ok(dt < 1300, `${dt} ms`)
    assert.deepEqual(r, {
      pedido: 'p3',
      entregues: ['chat 111'],
      contactos: [],
      falhas: [{ nome: 'Tio', erro: 'bloqueou o bot' }, ...['A', 'B', 'C', 'D'].map(nome => ({ nome, erro: 'sem ligação ao Telegram' }))]
    })
    const doc = tgf.enviados.find(m => m.chatId === '111' && m.metodo === 'sendDocument')
    assert.equal(doc.tipo, 'application/gpx+xml')
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

test('stop() a meio do envio do plano: o envio acaba com o cliente do início (sem "Cannot read properties of null")', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    const resposta = respostaDe(app, 'p4')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'p4' })
    p.stop()
    assert.deepEqual(await resposta, { pedido: 'p4', entregues: ['chat 111'], contactos: [], falhas: [] })
    assert.deepEqual(tgf.enviados.filter(m => m.chatId === '111').map(m => m.metodo), ['sendMessage', 'sendDocument'])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

test('chatIds normalizados (sem espaços, sem vazios, sem repetir) no plano e na autorização; um chat nas duas listas comanda', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111', '111', ' 222', '', '  '], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Ivo', chatId: '111' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    const resposta = respostaDe(app, 'p5')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'p5' })
    assert.deepEqual(await resposta, { pedido: 'p5', entregues: ['chat 111', 'chat 222'], contactos: [], falhas: [] })
    assert.equal(tgf.enviados.length, 4, JSON.stringify(tgf.enviados))
    assert.deepEqual(tgf.enviados.map(m => m.chatId).sort(), ['111', '111', '222', '222'])
    // o 222 (" 222" nos autorizados e também contacto do plano) comanda
    tgf.escrever(222, '/armar')
    assert.ok(await ate(() => tgf.enviados.some(m => m.chatId === '222' && /ARMADO/.test(m.text || ''))), JSON.stringify(tgf.enviados))
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

test('um desconhecido que bloqueia o bot não atrasa os comandos do Ivo: a falha do código regista-se e o ciclo segue', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('999')
    tgf.escrever(999, '/start')
    tgf.escrever(111, '/estado')
    const t0 = Date.now()
    assert.ok(await ate(() => tgf.enviados.some(m => m.chatId === '111'), 4000), 'o /estado do Ivo não teve resposta a tempo')
    assert.ok(Date.now() - t0 < 4000)
    assert.deepEqual(app.erros, ['Telegram (código para 999): bloqueou o bot'])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})

test('o código ao desconhecido: uma vez por hora (relógio injetado); a lista dos que o receberam é limitada (os mais antigos saem)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-01T10:00:00Z')
  const p = criar(app, { agora: () => agora, maxCodigos: 2 })
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  const codigos = (chat) => tgf.enviados.filter(m => m.chatId === chat).length
  // cada passo: o desconhecido escreve e o Ivo também (a resposta ao Ivo marca que o ciclo passou)
  let marca = 0
  const passo = async (chat) => {
    tgf.escrever(chat, '/start')
    tgf.escrever(111, '/estado')
    marca++
    assert.ok(await ate(() => codigos('111') >= marca))
  }
  try {
    await passo(901)
    assert.equal(codigos('901'), 1)
    agora += 59 * 60000
    await passo(901)
    assert.equal(codigos('901'), 1, 'menos de 1 h: não repete')
    agora += 2 * 60000
    await passo(901)
    assert.equal(codigos('901'), 2, 'passou 1 h: volta a receber')
    // com o máximo de 2: o 902 e o 903 empurram o 901 para fora, que volta a receber logo
    await passo(902)
    await passo(903)
    await passo(901)
    assert.equal(codigos('901'), 3)
    assert.equal(codigos('902'), 1)
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})
