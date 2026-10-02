'use strict'
// Nota do SignalK 2.33 (adenda 2 da auditoria): ao parar um plugin o servidor apaga da árvore os valores
// dele (removeSource); cada reinício parecia um alarme resolvido. O J1939 volta a publicar no arranque os
// alarmes que estavam ativos (o mesmo caminho e o mesmo valor) e as regras continuam a partir deles.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { linhaCandump } = require('../lib/j1939')

const T0 = 1_727_600_000_000
const hex = (s) => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)))

function appFalso () {
  const app = new EventEmitter()
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-j1939-reinicio-'))
  app.valores = {}
  app.notificacoes = []
  app.erros = []
  app.getDataDirPath = () => app.dir
  app.handleMessage = (id, d) => {
    for (const u of d.updates) for (const v of u.values) {
      if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
      else app.valores[v.path] = v.value
    }
  }
  app.setPluginStatus = () => {}
  app.setPluginError = (e) => { app.erros.push(e) }
  app.error = (e) => { app.erros.push(e) }
  app.debug = () => {}
  return app
}
const enviar = (app, pgn, dados) => app.emit('arlequin-j1939', linhaCandump({ t: Date.now(), pgn, dados: hex(dados) }))
const segundos = (t, n) => { for (let s = 0; s < n; s++) t.mock.timers.tick(1000) }
const curto = (ns) => ns.map(n => `${n.path.split('.').pop()}:${n.state}`)
const MAPA = [{ byte: 0, bit: 0, id: 'lowOilPressure', mensagem: 'Pressão de óleo baixa' }]

test('Adenda 2 (SignalK 2.33): o sobreaquecimento e o alarme do mapa do MDI ativos voltam a publicar-se ao arrancar, e a regra continua (93 °C não o limpa; 91 °C sim)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador', mapaAlarmes: MAPA })
  enviar(app, 61444, 'FFFFFF004BFFFFFF') // 2400 rpm
  enviar(app, 65262, '87FFFFFFFFFFFFFF') // 95 °C
  enviar(app, 65417, '0100000000000000') // o MDI diz a pressão do óleo
  segundos(t, 1)
  p.stop() // o reinício pelo Admin UI: o stop() põe a árvore a normal (I-21) e o servidor apaga os valores
  segundos(t, 3)
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({ fonte: 'simulador', mapaAlarmes: MAPA })
  const repostos = app.notificacoes.slice(antes)
  assert.deepEqual(repostos.map(n => `${n.path.split('.').pop()}:${n.state}:${n.apito}`).sort(), ['lowOilPressure:alarm:curto', 'overTemperature:alarm:continuo'])
  assert.equal(repostos.find(n => n.path.endsWith('.overTemperature')).message, 'Motor a 95 °C — sobreaquecimento')
  assert.deepEqual(repostos.find(n => n.path.endsWith('.overTemperature')).method, ['visual', 'sound'])
  // o motor ainda quente (93 °C, entre os 92 e os 95) e o MDI a dizer o óleo: nada muda (nem se repete)
  for (let s = 0; s < 10; s++) {
    enviar(app, 61444, 'FFFFFF004BFFFFFF')
    enviar(app, 65262, '85FFFFFFFFFFFFFF')
    enviar(app, 65417, '0100000000000000')
    segundos(t, 1)
  }
  assert.deepEqual(curto(app.notificacoes.slice(antes + 2)), [])
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  enviar(app, 65262, '83FFFFFFFFFFFFFF') // 91 °C
  enviar(app, 65417, '0000000000000000')
  segundos(t, 1)
  assert.deepEqual(curto(app.notificacoes.slice(antes + 2)).sort(), ['lowOilPressure:normal', 'overTemperature:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): um alarme reposto cujo motivo passou durante o reinício limpa logo (ignição desligada: o MDI calado)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  enviar(app, 65262, '87FFFFFFFFFFFFFF')
  segundos(t, 1)
  p.stop()
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({ fonte: 'simulador' })
  segundos(t, 7) // nenhuma trama: calado
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['overTemperature:alarm', 'overTemperature:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): um ficheiro de há mais de 10 min (o Pi esteve desligado) não repõe nada', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  enviar(app, 65262, '87FFFFFFFFFFFFFF')
  segundos(t, 1)
  p.stop()
  t.mock.timers.tick(11 * 60 * 1000)
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({ fonte: 'simulador' })
  p2.stop()
  assert.deepEqual(app.notificacoes.slice(antes), [])
})

// o aviso de ligação perdida (contrato C11) também volta, com a mesma mensagem, e limpa com uma trama
function candumpFalso () {
  const procs = []
  const lancar = () => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = () => { proc.morto = true }
    procs.push(proc)
    return proc
  }
  const trama = (pgn, dados) => procs.at(-1).stdout.emit('data', Buffer.from(linhaCandump({ t: Date.now(), pgn, dados: hex(dados) }) + '\n'))
  return { lancar, trama }
}

test('Adenda 2 (SignalK 2.33): o aviso semLigacao ativo volta a publicar-se ao arrancar e limpa com uma trama', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: T0 })
  const app = appFalso()
  const iface = { estado: { existe: false, ativa: false } }
  const c1 = candumpFalso()
  const p = criar(app, { spawn: c1.lancar, lerInterface: () => iface.estado })
  p.start({ fonte: 'candump', interface: 'can1' })
  segundos(t, 2)
  const aviso = app.notificacoes.find(n => n.path.endsWith('.semLigacao') && n.state === 'warn')
  assert.ok(aviso)
  p.stop()
  const antes = app.notificacoes.length
  const c2 = candumpFalso()
  const p2 = criar(app, { spawn: c2.lancar, lerInterface: () => iface.estado })
  p2.start({ fonte: 'candump', interface: 'can1' })
  assert.deepEqual(app.notificacoes.slice(antes), [{ path: 'notifications.propulsion.main.semLigacao', ...aviso }])
  segundos(t, 5)
  assert.equal(app.notificacoes.length, antes + 1, 'continua sem ligação: não se repete')
  iface.estado = { existe: true, ativa: true }
  c2.trama(61444, 'FFFFFF004BFFFFFF')
  segundos(t, 1)
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['semLigacao:warn', 'semLigacao:normal'])
  p2.stop()
})
