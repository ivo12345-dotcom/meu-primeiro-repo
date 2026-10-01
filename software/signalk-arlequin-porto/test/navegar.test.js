'use strict'
// A navegar (desenho 3b-2): os avisos notifications.rota.* no Telegram (os lembretes e o "come e bebe"
// nunca; a previsão só em alarme; os importantes só ao chat do Ivo) e as mensagens do plugin da rota
// com tipo (chegada, atraso, terminado: só aos contactos indicados, pelo chatId, e ao chat do Ivo, sem
// GPX; o plano novo com o GPX; os pedidos que já não estão na configuração vão para as falhas).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const criar = require('..')
const { novoEncaminhador, encaminhar, alarmesAtivos, NUNCA, SO_ALARME } = require('../lib/mensagens')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

const MIN = 60000
const n = (caminho, state, message = caminho) => ({ caminho, state, message })

test('mensagens: notifications.rota.lembrete.* e notifications.rota.comer estão no NUNCA; notifications.rota.previsao no SO_ALARME', () => {
  assert.ok(NUNCA.includes('notifications.rota.lembrete.'))
  assert.ok(NUNCA.includes('notifications.rota.comer'))
  assert.ok(SO_ALARME.includes('notifications.rota.previsao'))
})

test('os lembretes e o "come e bebe" nunca vão para o Telegram; recalcula, recursos e barómetro vão (e o resolvido); a previsão só em alarme', () => {
  let e = novoEncaminhador()
  let r = encaminhar(e, [
    n('notifications.rota.lembrete.e3', 'alert', 'Às 22:50: Rizar: 1 rizo'),
    n('notifications.rota.comer', 'alert', 'Come e bebe: 3 h ao leme'),
    n('notifications.rota.recalcula', 'warn', 'Recalcula a rota: atraso de 31 min sobre o plano'),
    n('notifications.rota.recursos', 'warn', 'Recursos: gasóleo à chegada ~34 L'),
    n('notifications.rota.barometro', 'warn', 'Barómetro: caiu 3,1 hPa em 3 h — o tempo pode piorar antes do previsto'),
    n('notifications.rota.previsao', 'warn', 'Previsão com 7 h')
  ], 0)
  e = r.enc
  assert.deepEqual(r.mensagens, [
    '⚠️ Recalcula a rota: atraso de 31 min sobre o plano',
    '⚠️ Recursos: gasóleo à chegada ~34 L',
    '⚠️ Barómetro: caiu 3,1 hPa em 3 h — o tempo pode piorar antes do previsto'
  ])
  r = encaminhar(e, [n('notifications.rota.previsao', 'alarm', 'Previsão com 13 h: confia nos instrumentos e no barómetro'), n('notifications.rota.recalcula', 'normal', '')], MIN)
  e = r.enc
  assert.deepEqual(r.mensagens, ['🚨 Previsão com 13 h: confia nos instrumentos e no barómetro', '✓ Resolvido: Recalcula a rota: atraso de 31 min sobre o plano'])
  r = encaminhar(e, [n('notifications.rota.lembrete.e3', 'normal', ''), n('notifications.rota.previsao', 'normal', '')], 2 * MIN)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Previsão com 13 h: confia nos instrumentos e no barómetro'])
  // o /estado não mostra os lembretes só do ecrã
  assert.deepEqual(alarmesAtivos([n('notifications.rota.lembrete.e3', 'alert', 'x'), n('notifications.rota.comer', 'alert', 'y'), n('notifications.rota.recalcula', 'warn', 'z')]), ['z'])
})

function appFalso () {
  const app = new EventEmitter()
  Object.assign(app, { arvore: {}, estado: '', erros: [] })
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-navegar-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => p.split('.').reduce((x, k) => x?.[k], app.arvore)
  app.handleMessage = () => {}
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ate (cond, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(50) } return false }
const respostaDe = (app, pedido) => new Promise(resolve => app.on('arlequin:plano-enviado', (m) => { if (m.pedido === pedido) resolve(m) }))
const CONTACTOS = [{ nome: 'Mãe', chatId: '222' }, { nome: 'Tio', chatId: '333' }, { nome: 'Amigo', chatId: '444' }]

async function porto () {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: CONTACTOS, telegramBase: tgf.url, pollTimeout: 1 })
  return { tgf, app, p, fechar: async () => { p.stop(); await tgf.fechar() } }
}

test('chegada, atraso e terminado: só aos contactos indicados (os que receberam o plano) e ao chat do Ivo, sem GPX, mesmo que o evento traga um', async () => {
  const x = await porto()
  try {
    for (const [i, tipo] of ['chegada', 'atraso', 'terminado'].entries()) {
      const pedido = `t${i}`
      const r = respostaDe(x.app, pedido)
      x.app.emit('arlequin:plano', { pedido, tipo, texto: `texto ${tipo}`, gpx: '<gpx/>', nomeFicheiro: 'n.gpx', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Tio'], chats: ['222', '333'] })
      assert.deepEqual(await r, { pedido, entregues: ['chat 111', 'Mãe', 'Tio'], contactos: ['Mãe', 'Tio'], chats: ['222', '333'], falhas: [] })
    }
    const por = (chat) => x.tgf.enviados.filter(m => m.chatId === chat).map(m => `${m.metodo}:${m.text ?? m.nomeFicheiro}`)
    for (const chat of ['111', '222', '333']) assert.deepEqual(por(chat), ['sendMessage:texto chegada', 'sendMessage:texto atraso', 'sendMessage:texto terminado'], chat)
    assert.deepEqual(por('444'), [], 'o Amigo não recebeu o plano')
    assert.deepEqual(x.app.erros, [])
  } finally { await x.fechar() }
})

test('o plano novo (tipo plano, "Este plano substitui o anterior") vai com o GPX aos mesmos contactos e ao Ivo; um contacto que já não está na configuração fica de fora e vai para as falhas', async () => {
  const x = await porto()
  try {
    const r = respostaDe(x.app, 'p1')
    x.app.emit('arlequin:plano', { pedido: 'p1', tipo: 'plano', texto: 'PLANO\nEste plano substitui o anterior.', gpx: '<gpx/>', nomeFicheiro: 'novo.gpx', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Quem saiu'], chats: ['222', '999'] })
    assert.deepEqual(await r, { pedido: 'p1', entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [{ nome: 'Quem saiu', erro: 'já não está nos "Contactos do plano" do plugin porto' }] })
    for (const chat of ['111', '222']) assert.deepEqual(x.tgf.enviados.filter(m => m.chatId === chat).map(m => m.metodo), ['sendMessage', 'sendDocument'])
    assert.equal(x.tgf.enviados.filter(m => m.chatId === '333').length, 0)
  } finally { await x.fechar() }
})

test('sem tipo (o envio da 3b-1, "Enviar plano"): como antes, a todos os contactos do plano com o GPX', async () => {
  const x = await porto()
  try {
    const r = respostaDe(x.app, 'v1')
    x.app.emit('arlequin:plano', { pedido: 'v1', texto: 'PLANO', gpx: '<gpx/>', nomeFicheiro: 'p.gpx' })
    assert.deepEqual((await r).contactos, ['Mãe', 'Tio', 'Amigo'])
    assert.equal(x.tgf.enviados.filter(m => m.metodo === 'sendDocument').length, 4)
  } finally { await x.fechar() }
})

test('os avisos importantes da rota vão só ao chat do Ivo (nunca aos contactos em terra); o lembrete nunca', async () => {
  const x = await porto()
  try {
    x.app.arvore.notifications = {
      rota: {
        recalcula: { value: { state: 'warn', message: 'Recalcula a rota: atraso de 31 min sobre o plano' } },
        lembrete: { e3: { value: { state: 'alert', message: 'Às 22:50: Rizar' } } },
        comer: { value: { state: 'alert', message: 'Come e bebe: 3 h ao leme' } }
      }
    }
    assert.ok(await ate(() => x.tgf.enviados.some(m => m.chatId === '111')))
    await esperar(300)
    assert.deepEqual(x.tgf.enviados.map(m => [m.chatId, m.text]), [['111', '⚠️ Recalcula a rota: atraso de 31 min sobre o plano']])
  } finally { await x.fechar() }
})

test('8: os pedidos escolhem pelo chatId, não pelo nome: dois contactos com o mesmo nome (só um recebeu o plano) → só esse; um renomeado continua a receber', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Mãe', chatId: '555' }, { nome: 'Tio (novo nome)', chatId: '333' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    const r = respostaDe(app, 'n1')
    app.emit('arlequin:plano', { pedido: 'n1', tipo: 'chegada', texto: 'cheguei', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Tio'], chats: ['222', '333'] })
    assert.deepEqual(await r, { pedido: 'n1', entregues: ['chat 111', 'Mãe', 'Tio (novo nome)'], contactos: ['Mãe', 'Tio (novo nome)'], chats: ['222', '333'], falhas: [] })
    assert.equal(tgf.enviados.filter(m => m.chatId === '555').length, 0, 'a outra Mãe nunca recebeu o plano')
  } finally { p.stop(); await tgf.fechar() }
})

test('8: as mensagens com tipo (chegada, atraso, terminado, ou um tipo desconhecido) vão sempre só aos indicados, mesmo sem destinatarios; sem chats, só ao Ivo', async () => {
  const x = await porto()
  try {
    for (const [i, ev] of [
      { tipo: 'atraso', contactos: ['Mãe'], chats: ['222'] }, // sem destinatarios
      { tipo: 'outro-tipo', contactos: ['Mãe'], chats: ['222'] },
      { tipo: 'chegada', destinatarios: 'contactos-do-plano' }, // sem contactos nem chats
      { tipo: 'terminado' }
    ].entries()) {
      const pedido = `k${i}`
      const r = respostaDe(x.app, pedido)
      x.app.emit('arlequin:plano', { pedido, texto: `texto ${i}`, ...ev })
      const res = await r
      assert.deepEqual(res.contactos, ev.chats ? ['Mãe'] : [], pedido)
    }
    assert.deepEqual(x.tgf.enviados.filter(m => m.chatId === '333' || m.chatId === '444'), [], 'o Tio e o Amigo não receberam o plano')
    assert.deepEqual(x.tgf.enviados.filter(m => m.chatId === '222').map(m => m.text), ['texto 0', 'texto 1'])
    assert.equal(x.tgf.enviados.filter(m => m.chatId === '111').length, 4, 'o Ivo recebe todas')
    assert.equal(x.tgf.enviados.filter(m => m.metodo === 'sendDocument').length, 0)
  } finally { await x.fechar() }
})

test('8: num tipo, um contacto que falha vai para as falhas e fica fora dos contactos; um contacto que também está nos chats do Ivo recebe uma vez, como Ivo', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Tio', chatId: '333' }, { nome: 'Ivo', chatId: '111' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    tgf.bloquear('333')
    const r = respostaDe(app, 'f1')
    app.emit('arlequin:plano', { pedido: 'f1', tipo: 'atraso', texto: 'atraso', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Tio', 'Ivo'], chats: ['222', '333', '111'] })
    assert.deepEqual(await r, { pedido: 'f1', entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [{ nome: 'Tio', erro: 'bloqueou o bot' }] })
    assert.equal(tgf.enviados.filter(m => m.chatId === '111').length, 1, 'sem duplicar')
  } finally { p.stop(); await tgf.fechar() }
})

test('8: a previsão em alarm → warn → alarm: o warn conta como normal ("Resolvido") e o 2.º alarme segue (passados os 10 min)', () => {
  let e = novoEncaminhador()
  let r = encaminhar(e, [n('notifications.rota.previsao', 'alarm', 'Previsão com 13 h: confia nos instrumentos e no barómetro')], 0)
  assert.deepEqual(r.mensagens, ['🚨 Previsão com 13 h: confia nos instrumentos e no barómetro'])
  e = r.enc
  r = encaminhar(e, [n('notifications.rota.previsao', 'warn', 'Previsão com 7 h')], MIN)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Previsão com 13 h: confia nos instrumentos e no barómetro'])
  e = r.enc
  r = encaminhar(e, [n('notifications.rota.previsao', 'alarm', 'Previsão com 13 h: confia nos instrumentos e no barómetro')], 11 * MIN)
  assert.deepEqual(r.mensagens, ['🚨 Previsão com 13 h: confia nos instrumentos e no barómetro'])
})

test('8: os caminhos do NUNCA e do SO_ALARME são exatos (um ponto final no fim é um prefixo): notifications.rota.comerX não fica de fora', () => {
  const r = encaminhar(novoEncaminhador(), [
    n('notifications.rota.comerX', 'warn', 'outro aviso'),
    n('notifications.rota.comer', 'alert', 'Come e bebe'),
    n('notifications.rota.lembrete.e3', 'alert', 'lembrete'),
    n('notifications.rota.previsaoX', 'warn', 'outro da previsão')
  ], 0)
  assert.deepEqual(r.mensagens, ['⚠️ outro aviso', '⚠️ outro da previsão'])
  assert.deepEqual(alarmesAtivos([n('notifications.rota.comerX', 'warn', 'x'), n('notifications.rota.comer', 'alert', 'y')]), ['x'])
})
