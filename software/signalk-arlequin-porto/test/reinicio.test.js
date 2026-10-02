'use strict'
// Reinícios do plugin porto (o SignalK faz stop() e start() seguidos ao gravar a configuração):
// auditoria I-22 (um só ciclo a falar com o Telegram) e I-21 (um alarme que limpou não fica preso).
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

// ---------- auditoria I-21: os alarmes do porto atravessam os reinícios ----------

const RAPIDO = { tickMs: 50, encaminharMs: 50, pausaFilaMs: 0 }
const AGUA = 'notifications.arlequin.porto.aguaPorao'
const estadoDe = (app, caminho) => app.getSelfPath(caminho)?.value?.state
const textos = (tgf) => tgf.enviados.filter(m => m.chatId === '111').map(m => m.text)

async function arrancar (props = {}) {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app, RAPIDO)
  const config = { telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1, ...props }
  return { tgf, app, p, config }
}

test('auditoria I-21: reinício com um alarme ativo e o sensor já normal: o "normal" e o "✓ Resolvido" saem (sonda p4)', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).includes('🚨 Água no porão!')))
    p.stop()
    app.pôr('sensors.porao.agua', 0)
    p.start(config)
    assert.ok(await ate(() => textos(tgf).includes('✓ Resolvido: Água no porão!')), JSON.stringify(textos(tgf)))
    assert.equal(estadoDe(app, AGUA), 'normal')
    await esperar(300)
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!', '✓ Resolvido: Água no porão!'])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-21: reinício com o alarme ainda verdadeiro: continua ativo na árvore, sem "Resolvido" falso nem repetição', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).includes('🚨 Água no porão!')))
    p.stop()
    p.start(config)
    await esperar(600)
    assert.equal(estadoDe(app, AGUA), 'alarm')
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!'])
    // e quando a água acaba, um só "Resolvido"
    app.pôr('sensors.porao.agua', 0)
    assert.ok(await ate(() => textos(tgf).length === 2))
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!', '✓ Resolvido: Água no porão!'])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-21: a intrusão (que fica até desarmar) atravessa o reinício; desarmar depois limpa-a', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    tgf.escrever(111, '/armar')
    assert.ok(await ate(() => textos(tgf).some(t => /ARMADO/.test(t))))
    app.pôr('sensors.gaiuta.aberta', 1)
    assert.ok(await ate(() => textos(tgf).includes('🚨 Intrusão: a gaiuta abriu com o alarme armado')))
    app.pôr('sensors.gaiuta.aberta', 0)
    await esperar(200)
    p.stop()
    p.start(config)
    await esperar(600)
    assert.equal(estadoDe(app, 'notifications.arlequin.porto.intrusao'), 'alarm')
    assert.ok(!textos(tgf).some(t => /Resolvido/.test(t)), JSON.stringify(textos(tgf)))
    tgf.escrever(111, '/desarmar')
    assert.ok(await ate(() => textos(tgf).includes('✓ Resolvido: Intrusão: a gaiuta abriu com o alarme armado')), JSON.stringify(textos(tgf)))
    assert.equal(estadoDe(app, 'notifications.arlequin.porto.intrusao'), 'normal')
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-21: o stop() põe a normal os alarmes do porto (o plugin desligado não deixa um alarme preso no ecrã)', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    app.pôr('sensors.porao.agua', 1)
    app.pôr('sensors.fumo', 1)
    assert.ok(await ate(() => estadoDe(app, AGUA) === 'alarm' && estadoDe(app, 'notifications.arlequin.porto.fumo') === 'emergency'))
    p.stop()
    assert.equal(estadoDe(app, AGUA), 'normal')
    assert.equal(estadoDe(app, 'notifications.arlequin.porto.fumo'), 'normal')
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-21: depois de um reinício do servidor (a árvore vazia) o alarme que estava ativo volta à árvore; o "Resolvido" sai quando o sensor o diz', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => textos(tgf).includes('🚨 Água no porão!')))
    p.stop()
    app.arvore = {} // o servidor arrancou de novo: nada na árvore, nem o sensor
    p.start(config)
    assert.ok(await ate(() => estadoDe(app, AGUA) === 'alarm'))
    await esperar(300)
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!'], 'sem repetir nem "Resolvido" falso')
    app.pôr('sensors.porao.agua', 0)
    assert.ok(await ate(() => textos(tgf).length === 2))
    assert.deepEqual(textos(tgf), ['🚨 Água no porão!', '✓ Resolvido: Água no porão!'])
  } finally { p.stop(); await tgf.fechar() }
})

test('auditoria I-21: um alarme do porto preso na árvore por uma versão antiga (sem os ativos no porto.json) limpa-se quando o sensor está normal', async () => {
  const { tgf, app, p, config } = await arrancar()
  // o que a versão antiga deixava: a árvore em alarm, o encaminhador com ele pendente, o porto.json sem ativos
  app.pôr(AGUA, { state: 'alarm', method: ['visual', 'sound'], message: 'Água no porão!' })
  app.pôr('sensors.porao.agua', 0)
  fs.writeFileSync(path.join(app.dir, 'porto.json'), JSON.stringify({ armado: false, ponto: null }))
  fs.writeFileSync(path.join(app.dir, 'encaminhador.json'), JSON.stringify({ estados: { [AGUA]: 'alarm' }, mensagem: { [AGUA]: 'Água no porão!' }, ultimoAlarme: { [AGUA]: Date.now() - 60000 }, pendente: { [AGUA]: true } }))
  p.start(config)
  try {
    assert.ok(await ate(() => estadoDe(app, AGUA) === 'normal'))
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.deepEqual(textos(tgf), ['✓ Resolvido: Água no porão!'])
  } finally { p.stop(); await tgf.fechar() }
})
