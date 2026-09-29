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
})

test('sem EEC1 há 5 s: motor parado (ignição desligada)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  t.mock.timers.tick(1000)
  assert.equal(app.valores['propulsion.main.state'], 'started')
  t.mock.timers.tick(6000)
  p.stop()
  assert.equal(app.valores['propulsion.main.revolutions'], 0)
  assert.equal(app.valores['propulsion.main.state'], 'stopped')
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
  await new Promise(r => setTimeout(r, 50))
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
