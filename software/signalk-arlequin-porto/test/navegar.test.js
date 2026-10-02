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

test('re-revisão M-5: as novas tentativas de uma mensagem para terra (tentativa > 1) já não vão ao chat do Ivo, só aos contactos indicados; a 1.ª vai', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: [{ nome: 'Mãe', chatId: '222' }, { nome: 'Ivo', chatId: '111' }], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    let r = respostaDe(app, 'r1')
    app.emit('arlequin:plano', { pedido: 'r1', tipo: 'atraso', texto: 'atraso', destinatarios: 'contactos-do-plano', contactos: ['Mãe'], chats: ['222'] })
    assert.deepEqual((await r).entregues, ['chat 111', 'Mãe'])
    for (const [i, tentativa] of [2, 3].entries()) {
      r = respostaDe(app, `r${i + 2}`)
      app.emit('arlequin:plano', { pedido: `r${i + 2}`, tipo: 'atraso', texto: 'atraso', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Ivo'], chats: ['222', '111'], tentativa })
      assert.deepEqual(await r, { pedido: `r${i + 2}`, entregues: ['Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] })
    }
    assert.equal(tgf.enviados.filter(m => m.chatId === '111').length, 1, 'o Ivo só na 1.ª')
    assert.equal(tgf.enviados.filter(m => m.chatId === '222').length, 3)
  } finally { p.stop(); await tgf.fechar() }
})

test('Tarefa 8.3: o estado do encaminhador sobrevive a um reinício (encaminhador.json, escrita atómica): um aviso ativo não se repete e, quando se apaga, sai um só "✓ Resolvido"', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const props = { telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: CONTACTOS, telegramBase: tgf.url, pollTimeout: 1 }
  app.arvore.notifications = { rota: { recursos: { value: { state: 'warn', message: 'Recursos: gasóleo à chegada ~34 L' } } } }
  let p = criar(app)
  p.start(props)
  // entregue: o Telegram aceitou e a fila do encaminhador.json já não a tem (auditoria K-09; um
  // reinício com o envio ainda a meio pode repeti-la — mais vale repetido do que perdido)
  const naFila = () => { try { return JSON.parse(fs.readFileSync(path.join(app.dir, 'encaminhador.json'), 'utf8')).porEnviar.length } catch { return -1 } }
  try {
    assert.ok(await ate(() => tgf.enviados.some(m => m.chatId === '111') && naFila() === 0))
    p.stop()
    assert.ok(fs.existsSync(path.join(app.dir, 'encaminhador.json')))
    assert.deepEqual(fs.readdirSync(app.dir).filter(f => f.endsWith('.tmp')), [], 'sem .tmp a sobrar')
    // o reinício: o aviso continua ativo
    p = criar(app)
    p.start(props)
    await esperar(2600)
    assert.equal(tgf.enviados.filter(m => m.chatId === '111').length, 1, 'o aviso não se repete')
    // o aviso apaga-se: um só "Resolvido"
    app.arvore.notifications.rota.recursos.value = { state: 'normal', message: '' }
    assert.ok(await ate(() => tgf.enviados.some(m => /Resolvido/.test(m.text || ''))))
    await esperar(2600)
    assert.deepEqual(tgf.enviados.filter(m => m.chatId === '111').map(m => m.text), ['⚠️ Recursos: gasóleo à chegada ~34 L', '✓ Resolvido: Recursos: gasóleo à chegada ~34 L'])
    // um ficheiro estragado não derruba o arranque: começa vazio
    p.stop()
    fs.writeFileSync(path.join(app.dir, 'encaminhador.json'), '{estragado')
    p = criar(app)
    p.start(props)
    assert.deepEqual(app.erros.filter(e => !/encaminhador/.test(e)), [])
  } finally { p.stop(); await tgf.fechar() }
})

test('revisão final C2: o alarme gravado no encaminhador.json que não está na árvore (o servidor reiniciou: a árvore vem vazia) passa a normal sem mensagem; quando volta, segue outra vez (mesmo dentro dos 10 min)', () => {
  const agua = 'notifications.arlequin.porto.aguaPorao'
  let r = encaminhar(novoEncaminhador(), [n(agua, 'alarm', 'Água no porão!'), n('notifications.rota.recursos', 'warn', 'Recursos: gasóleo à chegada ~34 L')], 0)
  assert.deepEqual(r.mensagens, ['🚨 Água no porão!', '⚠️ Recursos: gasóleo à chegada ~34 L'])
  // o que fica no encaminhador.json (ida e volta pelo JSON) e o servidor arranca com a árvore vazia
  let e = JSON.parse(JSON.stringify(r.enc))
  r = encaminhar(e, [], 2 * MIN)
  assert.deepEqual(r.mensagens, [], 'desapareceu, não se resolveu: sem "✓ Resolvido"')
  assert.equal(r.enc.estados[agua], 'normal')
  assert.equal(r.enc.pendente[agua], undefined)
  e = r.enc
  // o alarme volta a ser publicado (ainda há água): segue outra vez, mesmo a 3 min do 1.º
  r = encaminhar(e, [n(agua, 'alarm', 'Água no porão!')], 3 * MIN)
  assert.deepEqual(r.mensagens, ['🚨 Água no porão!'])
  e = r.enc
  // e o "Resolvido" sai uma vez quando a água acaba
  r = encaminhar(e, [n(agua, 'normal', '')], 4 * MIN)
  assert.deepEqual(r.mensagens, ['✓ Resolvido: Água no porão!'])
})

test('revisão final I2: o lembrete da hora de alarme em terra (notifications.rota.alarmeTerra) fica só no ecrã', () => {
  assert.ok(NUNCA.includes('notifications.rota.alarmeTerra'))
  const r = encaminhar(novoEncaminhador(), [n('notifications.rota.alarmeTerra', 'alert', 'Os contactos em terra ligam ao MRCC às 19:41: avisa-os ou Terminar')], 0)
  assert.deepEqual(r.mensagens, [])
})

test('revisão final M4: o plano com o texto entregue e o GPX recusado conta como entregue (o GPX vai para as falhas)', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const original = globalThis.fetch
  // o Telegram recusa os documentos (o GPX) do chat 222
  globalThis.fetch = async (url, o) => {
    if (String(url).endsWith('/sendDocument') && o?.body instanceof FormData && o.body.get('chat_id') === '222') return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: file is too big' }), { status: 400 })
    return original(url, o)
  }
  const p = criar(app)
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], contactosPlano: CONTACTOS, telegramBase: tgf.url, pollTimeout: 1 })
  try {
    const r = respostaDe(app, 'g1')
    app.emit('arlequin:plano', { pedido: 'g1', tipo: 'plano', texto: 'PLANO\nEste plano substitui o anterior.', gpx: '<gpx/>', nomeFicheiro: 'novo.gpx', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Tio'], chats: ['222', '333'] })
    const x = await r
    assert.deepEqual(x.entregues, ['chat 111', 'Mãe', 'Tio'])
    assert.deepEqual(x.contactos, ['Mãe', 'Tio'])
    assert.deepEqual(x.chats, ['222', '333'])
    assert.equal(x.falhas.length, 1)
    assert.equal(x.falhas[0].nome, 'Mãe')
    assert.match(x.falhas[0].erro, /^GPX: /)
  } finally { globalThis.fetch = original; p.stop(); await tgf.fechar() }
})
