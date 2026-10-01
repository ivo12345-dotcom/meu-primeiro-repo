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
    assert.deepEqual(r, { pedido: 'p1', entregues: ['chat 111', 'Mãe'], falhas: [{ nome: 'Tio', erro: 'Telegram sendMessage: Forbidden: bot was blocked by the user' }] })
    for (const chat of ['111', '222']) {
      const m = tgf.enviados.filter(x => x.chatId === chat)
      assert.deepEqual(m.map(x => x.metodo), ['sendMessage', 'sendDocument'], chat)
      assert.equal(m[0].text, PLANO.texto)
      assert.equal(m[1].nomeFicheiro, PLANO.nomeFicheiro)
      assert.equal(m[1].conteudo, GPX)
    }
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
  assert.equal(app.listenerCount('arlequin:plano'), 0, 'o stop() tira o ouvinte')
})

test('sem token: responde logo que não há bot (em vez de deixar o plugin da rota à espera)', async () => {
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: '', chatIds: ['111'] })
  try {
    const resposta = respostaDe(app, 'p2')
    app.emit('arlequin:plano', { ...PLANO, pedido: 'p2' })
    assert.deepEqual(await resposta, { pedido: 'p2', entregues: [], falhas: [{ nome: 'Telegram', erro: 'o plugin porto não tem o token do bot' }] })
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
