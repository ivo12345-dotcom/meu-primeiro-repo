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
  const app = { arvore: {}, estado: '', erros: [], ticks: 0 }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-reinicio-'))
  app.getDataDirPath = () => app.dir
  const pôr = (p, value) => { const ks = p.split('.'); let n = app.arvore; for (const k of ks) n = (n[k] = n[k] || {}); n.value = value }
  app.pôr = pôr
  // como o removeSource do SignalK 2.33 (pruneSourceFromFullSignalK): o nó fica, sem o valor
  app.apagar = (p) => { const n = p.split('.').reduce((x, k) => x?.[k], app.arvore); if (n) delete n.value }
  // ciclos: quantas vezes o encaminhador leu as notificações
  app.ciclos = 0
  app.getSelfPath = (p) => { if (p === 'notifications') app.ciclos++; return p.split('.').reduce((n, k) => n?.[k], app.arvore) }
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) pôr(v.path, v.value) }
  // ticks: quantas vezes o ciclo de 1 s do plugin correu (escreve o estado em cada uma)
  app.setPluginStatus = (s) => { app.estado = s; app.ticks++ }
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

test('auditoria F4b (revisão, Menor 3): a pausa depois de um erro do long polling não deixa um "abort" pendurado no sinal do ciclo por cada erro', async () => {
  // conta as escutas "abort" de cada AbortSignal
  const escutas = new Map()
  const { addEventListener: pôr, removeEventListener: tirar } = EventTarget.prototype
  EventTarget.prototype.addEventListener = function (tipo, f, o) { if (tipo === 'abort' && this instanceof AbortSignal) escutas.set(this, (escutas.get(this) || 0) + 1); return pôr.call(this, tipo, f, o) }
  EventTarget.prototype.removeEventListener = function (tipo, f, o) { if (tipo === 'abort' && this instanceof AbortSignal) escutas.set(this, (escutas.get(this) || 0) - 1); return tirar.call(this, tipo, f, o) }
  // o Telegram responde sempre 502 ao getUpdates (sem rede nenhuma: é imediato)
  const original = globalThis.fetch
  globalThis.fetch = async (url, o) => (String(url).endsWith('/getUpdates') ? new Response(JSON.stringify({ ok: false, error_code: 502, description: 'Bad Gateway' }), { status: 502 }) : original(url, o))
  const app = appFalso()
  const p = criar(app, { pausaErroMs: 2 })
  try {
    p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: 'http://x', pollTimeout: 1 })
    assert.ok(await ate(() => app.erros.length >= 30), String(app.erros.length))
    const max = Math.max(0, ...escutas.values())
    assert.ok(max <= 2, `${max} escutas "abort" no mesmo sinal ao fim de ${app.erros.length} erros`)
    assert.match(app.erros[0], /^Telegram getUpdates: Bad Gateway$/)
  } finally {
    p.stop()
    globalThis.fetch = original
    Object.assign(EventTarget.prototype, { addEventListener: pôr, removeEventListener: tirar })
  }
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

test('auditoria I-07 (contrato C1): o valor publicado leva o apito, também no alarme reposto depois de um reinício', async () => {
  const { tgf, app, p, config } = await arrancar()
  p.start(config)
  try {
    app.pôr('sensors.porao.agua', 1)
    assert.ok(await ate(() => estadoDe(app, AGUA) === 'alarm'))
    assert.deepEqual(app.getSelfPath(AGUA).value, { state: 'alarm', method: ['visual', 'sound'], message: 'Água no porão!', apito: 'continuo' })
    p.stop()
    assert.deepEqual(app.getSelfPath(AGUA).value, { state: 'normal', method: [], message: 'Normal' })
    p.start(config)
    assert.deepEqual(app.getSelfPath(AGUA).value, { state: 'alarm', method: ['visual', 'sound'], message: 'Água no porão!', apito: 'continuo' })
  } finally { p.stop(); await tgf.fechar() }
})

test('decisão do dono (Adenda 2, apito): a bomba de porão (a trabalhar há mais de 3 min) e o líquido debaixo do depósito publicam apito "continuo" (contam como água no porão e fuga de gasóleo), também depois de um reinício', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  const config = { telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 }
  const BOMBA = 'notifications.arlequin.porto.bombaPorao'
  const FUGA = 'notifications.arlequin.porto.fugaGasoleo'
  const esperados = {
    [BOMBA]: { state: 'alarm', method: ['visual', 'sound'], message: 'Bomba de porão a trabalhar há mais de 3 min seguidos', apito: 'continuo' },
    [FUGA]: { state: 'alarm', method: ['visual', 'sound'], message: 'Líquido debaixo do depósito de gasóleo: possível fuga', apito: 'continuo' }
  }
  p.start(config)
  try {
    app.pôr('sensors.porao.bomba', 1)
    app.pôr('sensors.gasoleo.liquido', 1)
    // o plugin viu a bomba arrancar (com o relógio de agora) antes de o relógio andar 3 min
    const ciclo = app.ticks
    assert.ok(await ate(() => app.ticks >= ciclo + 2))
    agora += 3 * 60000 + 1000
    assert.ok(await ate(() => estadoDe(app, BOMBA) === 'alarm' && estadoDe(app, FUGA) === 'alarm'))
    for (const [c, v] of Object.entries(esperados)) assert.deepEqual(app.getSelfPath(c).value, v, c)
    p.stop()
    p.start(config)
    for (const [c, v] of Object.entries(esperados)) assert.deepEqual(app.getSelfPath(c).value, v, `${c} reposto`)
  } finally { p.stop(); await tgf.fechar() }
})

// ---------- nota do SignalK 2.33: o reinício de OUTRO plugin (sonda 4 da revisão da F4) ----------
// stopPlugin() → plugin.stop() (publica "normal") → deltaCache.removeSource(): os valores desse plugin
// saem da árvore; o plugin volta a publicar os seus alarmes ativos quando arranca (ou não, se limparam).

const mais = async (app, n = 3) => { const alvo = app.ciclos + n; return ate(() => app.ciclos >= alvo) }

test('nota do SignalK 2.33 (revisão, Menor 9): o reinício de outro plugin (o caminho sai da árvore e volta ainda ativo) não repete o alarme no Telegram, nem 20 min depois', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  const C = 'notifications.arlequin.energia.servicoCritico'
  const ALARME = { state: 'alarm', method: ['visual', 'sound'], message: 'Serviço a 49%', apito: 'curto' }
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr(C, ALARME)
    assert.ok(await ate(() => textos(tgf).length === 1))
    agora += 2 * 60000
    // o Ivo grava a configuração do plugin da energia: "normal", apagado, e só depois o arranque
    app.pôr(C, { state: 'normal', method: [], message: 'Normal' })
    app.apagar(C)
    assert.ok(await mais(app))
    app.pôr(C, ALARME)
    assert.ok(await mais(app))
    agora += 20 * 60000
    assert.ok(await mais(app))
    assert.deepEqual(textos(tgf), ['🚨 Serviço a 49%'])
    // e quando limpa de verdade, um só "Resolvido"
    app.pôr(C, { state: 'normal', method: [], message: 'Normal' })
    assert.ok(await ate(() => textos(tgf).length === 2))
    assert.deepEqual(textos(tgf), ['🚨 Serviço a 49%', '✓ Resolvido: Serviço a 49%'])
  } finally { p.stop(); await tgf.fechar() }
})

test('nota do SignalK 2.33 (revisão, Menor 9): um alarme que limpou durante o reinício do outro plugin (o caminho não volta) recebe o "✓ Resolvido" ao fim de 2 min', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  let agora = Date.parse('2026-10-02T10:00:00Z')
  const p = criar(app, { agora: () => agora, ...RAPIDO })
  const C = 'notifications.arlequin.energia.servicoCritico'
  p.start({ telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1 })
  try {
    app.pôr(C, { state: 'alarm', method: ['visual', 'sound'], message: 'Serviço a 49%', apito: 'curto' })
    assert.ok(await ate(() => textos(tgf).length === 1))
    agora += 2 * 60000
    app.apagar(C)
    assert.ok(await mais(app))
    agora += 60000
    assert.ok(await mais(app))
    assert.deepEqual(textos(tgf), ['🚨 Serviço a 49%'], 'ainda dentro dos 2 min')
    agora += 60000
    assert.ok(await ate(() => textos(tgf).length === 2), JSON.stringify(textos(tgf)))
    assert.deepEqual(textos(tgf), ['🚨 Serviço a 49%', '✓ Resolvido: Serviço a 49%'])
  } finally { p.stop(); await tgf.fechar() }
})

// ---------- auditoria M-52: o porto.json (armado, ponto, alarmes ativos) ----------

// Um corte de energia a meio de uma escrita: o que se escreve em `alvo` (ou num .tmp ao lado) fica a
// meio e a escrita rebenta. Devolve a função que desfaz o corte.
function simularCorte (alvo) {
  const original = { openSync: fs.openSync, writeSync: fs.writeSync, writeFileSync: fs.writeFileSync }
  const caminhoDe = new Map()
  const doAlvo = (f) => typeof f === 'string' && (f === alvo || (f.startsWith(`${alvo}.`) && f.endsWith('.tmp')))
  const metade = (dados) => { const b = Buffer.from(String(dados)); return b.subarray(0, Math.floor(b.length / 2)) }
  fs.openSync = function (f, ...resto) { const fd = original.openSync.call(fs, f, ...resto); caminhoDe.set(fd, f); return fd }
  fs.writeSync = function (fd, dados, ...resto) {
    if (doAlvo(caminhoDe.get(fd))) { original.writeSync.call(fs, fd, metade(dados)); throw new Error('corte de energia') }
    return original.writeSync.call(fs, fd, dados, ...resto)
  }
  fs.writeFileSync = function (f, dados, ...resto) {
    if (doAlvo(f)) { original.writeFileSync.call(fs, f, metade(dados)); throw new Error('corte de energia') }
    return original.writeFileSync.call(fs, f, dados, ...resto)
  }
  return () => Object.assign(fs, original)
}

test('auditoria M-52: um corte a meio da escrita do porto.json não o estraga (escrita atómica): depois do reinício continua armado', async () => {
  const { tgf, app, p, config } = await arrancar()
  const ficheiro = path.join(app.dir, 'porto.json')
  p.start(config)
  let desfazer = null
  try {
    tgf.escrever(111, '/armar')
    assert.ok(await ate(() => textos(tgf).some(t => /ARMADO/.test(t))))
    assert.equal(JSON.parse(fs.readFileSync(ficheiro, 'utf8')).armado, true)
    app.pôr('navigation.position', { latitude: 39.3522, longitude: -9.3760 })
    desfazer = simularCorte(ficheiro)
    tgf.escrever(111, '/amarrar') // grava o ponto: a escrita é cortada a meio
    assert.ok(await ate(() => textos(tgf).some(t => /Ponto de amarração gravado/.test(t))))
    desfazer(); desfazer = null
    assert.equal(JSON.parse(fs.readFileSync(ficheiro, 'utf8')).armado, true, 'o porto.json ficou estragado')
    assert.deepEqual(fs.readdirSync(app.dir).filter(f => f.endsWith('.tmp')), [], 'sem .tmp a sobrar')
    assert.ok(app.erros.some(e => /porto\.json.*corte de energia/.test(e)), JSON.stringify(app.erros))
    p.stop()
    p.start(config)
    await esperar(200)
    assert.match(app.estado, /^🔒 armado/)
  } finally { if (desfazer) desfazer(); p.stop(); await tgf.fechar() }
})

test('auditoria M-52: um porto.json ilegível não desarma em silêncio: o registo e o Telegram do Ivo dizem que ficou desarmado e sem ponto', async () => {
  const { tgf, app, p, config } = await arrancar()
  fs.writeFileSync(path.join(app.dir, 'porto.json'), '{"armado": tr')
  p.start(config)
  try {
    assert.ok(app.erros.some(e => /porto\.json ilegível/.test(e)), JSON.stringify(app.erros))
    assert.ok(await ate(() => textos(tgf).length === 1))
    assert.deepEqual(textos(tgf), ['⚠️ Perdi o estado do porto (porto.json ilegível): o alarme de intrusão ficou desarmado e sem ponto de amarração. Arma outra vez com /armar.'])
    assert.match(app.estado, /^desarmado · sem ponto/)
  } finally { p.stop(); await tgf.fechar() }
})
