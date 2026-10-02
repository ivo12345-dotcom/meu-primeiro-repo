'use strict'
// O plugin inteiro com um "app" falso: tramas → SignalK, alarmes, diagnóstico.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { linhaCandump } = require('../lib/j1939')

const hex = (s) => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)))

function appFalso () {
  const app = new EventEmitter()
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-j1939-'))
  app.valores = {}
  app.notificacoes = []
  app.getDataDirPath = () => app.dir
  app.handleMessage = (id, d) => {
    for (const u of d.updates) {
      for (const v of u.values) {
        if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
        else app.valores[v.path] = v.value
      }
    }
  }
  app.setPluginStatus = () => {}
  app.setPluginError = (e) => { throw new Error(e) }
  app.debug = () => {}
  return app
}

const enviar = (app, pgn, dados) => app.emit('arlequin-j1939', linhaCandump({ t: Date.now(), pgn, dados: hex(dados) }))

test('tramas do simulador → valores SignalK a 1 Hz, estado e consumo estimado', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF') // 0x4B00 × 0,125 = 2400 rpm
  enviar(app, 65262, '7AFFFFFFFFFFFFFF') // 82 °C
  enviar(app, 65271, 'FFFFFFFFFFFF1C01') // 14,2 V
  enviar(app, 65253, '26610000FFFFFFFF') // 1243,5 h
  t.mock.timers.tick(1000)
  p.stop()
  assert.equal(app.valores['propulsion.main.revolutions'], 40)
  assert.equal(app.valores['propulsion.main.temperature'], 82 + 273.15)
  assert.ok(Math.abs(app.valores['propulsion.main.alternatorVoltage'] - 14.2) < 1e-9)
  assert.equal(app.valores['propulsion.main.runTime'], 1243.5 * 3600)
  assert.equal(app.valores['propulsion.main.state'], 'started')
  assert.ok(Math.abs(app.valores['propulsion.main.fuel.rate'] * 3600 * 1000 - 2.0) < 1e-9) // 2400 rpm → 2,0 L/h
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'estimado')
})

test('origem do consumo: "medido" com a PGN 65266 do MDI, "estimado" pela curva; sem nenhum dos dois não se publica', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF0040FFFFFF') // 2048 rpm
  t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'estimado')
  enviar(app, 65266, '2800FFFFFFFFFFFF') // 2,0 L/h medidos
  t.mock.timers.tick(1000)
  p.stop()
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'medido')
  assert.ok(Math.abs(app.valores['propulsion.main.fuel.rate'] * 3600 * 1000 - 2.0) < 1e-9)
  const app2 = appFalso()
  const p2 = criar(app2)
  p2.start({ fonte: 'simulador', estimarConsumo: false })
  enviar(app2, 61444, 'FFFFFF0040FFFFFF')
  t.mock.timers.tick(1000)
  p2.stop()
  assert.equal('propulsion.main.fuel.rate' in app2.valores, false)
  assert.equal('propulsion.main.fuel.rateOrigem' in app2.valores, false)
})

test('consumo "medido" só dura enquanto a PGN 65266 for recente; sem ela há 5 s, volta a "estimado"', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF0040FFFFFF') // 2048 rpm
  enviar(app, 65266, '2800FFFFFFFFFFFF') // 2,0 L/h medidos
  t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'medido')
  for (let s = 0; s < 6; s++) t.mock.timers.tick(1000) // 6 s sem nova 65266
  p.stop()
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'estimado')
})

test('sem EEC1 há 5 s: rotações desconhecidas (null) e motor parado (ignição desligada ou CAN em baixo)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.state'], 'started')
  for (let s = 0; s < 6; s++) t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.revolutions'], null)
  assert.equal(app.valores['propulsion.main.state'], 'stopped')
  enviar(app, 61444, 'FFFFFF004BFFFFFF') // as tramas voltam: rotações reais outra vez
  t.mock.timers.tick(1000)
  p.stop()
  assert.equal(app.valores['propulsion.main.revolutions'], 40)
})

test('sem nenhuma EEC1 desde o arranque as rotações publicam-se como null, nunca 0', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  const vistos = []
  const handle = app.handleMessage
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) if (v.path === 'propulsion.main.revolutions') vistos.push(v.value); handle(id, d) }
  for (let s = 0; s < 3; s++) t.mock.timers.tick(1000)
  p.stop()
  assert.deepEqual(vistos, [null, null, null])
  assert.equal(app.valores['propulsion.main.state'], 'stopped')
})

// Auditoria K-07: com o CAN em baixo (adaptador USB-CAN solto, candump parado, ignição desligada) nenhum
// valor velho pode continuar a sair como se fosse atual.
test('K-07: sem as PGN há 5 s, a temperatura, o óleo, a pressão e a tensão passam a null (nunca o valor velho)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF') // 2400 rpm
  enviar(app, 65262, '7AFF2029FFFFFFFF') // água 82 °C, óleo 56 °C
  enviar(app, 65263, 'FFFFFF57FFFFFFFF') // 348 kPa
  enviar(app, 65271, 'FFFFFFFFFFFF1C01') // 14,2 V
  t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.temperature'], 82 + 273.15)
  assert.equal(app.valores['propulsion.main.oilPressure'], 0x57 * 4000)
  for (let s = 0; s < 6; s++) t.mock.timers.tick(1000) // o adaptador soltou-se: nenhuma trama
  p.stop()
  for (const c of ['revolutions', 'temperature', 'oilTemperature', 'oilPressure', 'alternatorVoltage']) {
    assert.equal(app.valores[`propulsion.main.${c}`], null, c)
  }
  assert.equal(app.valores['propulsion.main.state'], 'stopped')
})

test('K-07: um campo "sem dado" numa PGN que continua a chegar também passa a null; os outros campos ficam', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 65262, '7AFF2029FFFFFFFF') // água 82 °C, óleo 56 °C
  t.mock.timers.tick(1000)
  for (let s = 0; s < 6; s++) {
    enviar(app, 65262, 'FFFF2029FFFFFFFF') // a água deixa de vir ("sem dado"); o óleo continua
    t.mock.timers.tick(1000)
  }
  p.stop()
  assert.equal(app.valores['propulsion.main.temperature'], null)
  assert.ok(Math.abs(app.valores['propulsion.main.oilTemperature'] - (56 + 273.15)) < 1e-9)
})

test('K-07: as horas do motor não se republicam velhas (a hora delas na árvore envelhece) e não passam a null', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  const horas = []
  const handle = app.handleMessage
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) if (v.path === 'propulsion.main.runTime') horas.push(v.value); handle(id, d) }
  p.start({ fonte: 'simulador' })
  enviar(app, 65253, '26610000FFFFFFFF') // 1243,5 h
  t.mock.timers.tick(1000)
  for (let s = 0; s < 10; s++) t.mock.timers.tick(1000) // ignição desligada
  p.stop()
  assert.ok(horas.length >= 1 && horas.length <= 6, `publicadas ${horas.length} vezes`)
  assert.ok(horas.every(h => h === 1243.5 * 3600), JSON.stringify(horas))
})

test('K-07: os alarmes do mapa do MDI (65417) limpam quando a PGN deixa de chegar; o sobreaquecimento ativo não limpa por faltarem dados', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador', mapaAlarmes: [{ byte: 0, bit: 0, id: 'lowOilPressure', mensagem: 'Pressão de óleo baixa' }] })
  enviar(app, 65262, '87FFFFFFFFFFFFFF') // 95 °C
  enviar(app, 65417, '0100000000000000')
  t.mock.timers.tick(1000)
  for (let s = 0; s < 7; s++) t.mock.timers.tick(1000) // ignição desligada: o MDI cala-se
  p.stop()
  const seq = (id) => app.notificacoes.filter(n => n.path === `notifications.propulsion.main.${id}`).map(n => n.state)
  assert.deepEqual(seq('lowOilPressure'), ['alarm', 'normal'])
  assert.deepEqual(seq('overTemperature'), ['alarm'])
})

test('sobreaquecimento vira notificação; o mapa do MDI também', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador', mapaAlarmes: [{ byte: 0, bit: 0, id: 'lowOilPressure', mensagem: 'Pressão de óleo baixa' }] })
  enviar(app, 65262, '87FFFFFFFFFFFFFF') // 95 °C
  enviar(app, 65417, '0100000000000000')
  t.mock.timers.tick(1000)
  p.stop()
  const caminhos = app.notificacoes.map(n => `${n.path}:${n.state}`)
  assert.ok(caminhos.includes('notifications.propulsion.main.overTemperature:alarm'), caminhos.join(' '))
  assert.ok(caminhos.includes('notifications.propulsion.main.lowOilPressure:alarm'), caminhos.join(' '))
})

test('diagnóstico: PGN vistas e mudanças da 65417 gravadas', async (t) => {
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 65417, '0300000000000000')
  enviar(app, 65417, '0300000000000000')
  enviar(app, 65417, '0000000000000000')
  const rotas = {}
  p.registerWithRouter({ get: (r, h) => { rotas[r] = h } })
  let d
  rotas['/diagnostico']({}, { json: (j) => { d = j } })
  let html
  rotas['/pagina']({}, { type: () => ({ send: (h) => { html = h } }) })
  p.stop()
  assert.equal(d.vistas.find(v => v.pgn === 65417).n, 3)
  assert.equal(d.mudancas.length, 2)
  assert.deepEqual(d.mudancas[0].bitsMudados, ['byte0.bit0 1→0', 'byte0.bit1 1→0'])
  assert.match(html, /byte0\.bit0 1→0/)
})

test('curva aprendida: regime estável a andar entra na faixa certa e aparece em /consumo', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  app.getSelfPath = (p) => p === 'navigation.speedThroughWater' ? { value: 5.2 * 1852 / 3600, timestamp: new Date(Date.now()).toISOString() } : undefined
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  for (let s = 0; s < 120; s++) {
    enviar(app, 61444, 'FFFFFF004BFFFFFF') // 2400 rpm
    t.mock.timers.tick(1000)
  }
  const rotas = {}
  p.registerWithRouter({ get: (r, h) => { rotas[r] = h } })
  let c
  rotas['/consumo']({}, { json: (j) => { c = j } })
  p.stop()
  assert.equal(c.faixas.length, 1)
  assert.equal(c.faixas[0].de, 2400)
  assert.ok(Math.abs(c.faixas[0].nos - 5.2) < 1e-6)
  assert.ok(Math.abs(c.faixas[0].lmn - 2.0 / 5.2) < 1e-6)
  assert.equal(c.melhor.de, 2400)
  assert.match(c.consumo, /estimado/)
})
