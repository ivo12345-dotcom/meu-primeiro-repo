'use strict'
// Nota do SignalK 2.33 (adenda 2 da auditoria): ao parar um plugin o servidor apaga da árvore os valores
// dele (removeSource); cada reinício parecia um alarme resolvido. A energia volta a publicar no arranque os
// alarmes que estavam ativos (o mesmo caminho e o mesmo valor) e as regras continuam a partir deles.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')

const T0 = Date.parse('2026-10-02T10:00:00Z')

function appFalso () {
  const app = {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-energia-reinicio-')),
    notificacoes: [],
    receber: null,
    estado: ''
  }
  app.getDataDirPath = () => app.dir
  app.handleMessage = (id, d) => {
    for (const u of d.updates) for (const v of u.values) if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
  }
  app.subscriptionmanager = { subscribe: (sub, unsubs, erro, cb) => { app.receber = cb; unsubs.push(() => {}) } }
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (e) => { throw new Error(e) }
  app.error = (e) => { throw new Error(e) }
  app.debug = () => {}
  return app
}
// uma leitura do SmartShunt e do motor, com a hora de agora (como o SignalK)
const ler = (app, valores) => app.receber({ updates: [{ timestamp: new Date().toISOString(), values: Object.entries(valores).map(([p, value]) => ({ path: p, value })) }] })
const SOC = 'electrical.batteries.servico.capacity.stateOfCharge'
const RPM = 'propulsion.main.revolutions'
const minutos = (t, app, n, valores) => { for (let i = 0; i < n; i++) { t.mock.timers.tick(60 * 1000); if (valores) ler(app, valores) } }
const curto = (ns) => ns.map(n => `${n.path.split('.').pop()}:${n.state}`)
const reiniciar = (t, app, p) => {
  p.stop()
  t.mock.timers.tick(3000)
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({})
  return { p2, antes }
}

test('Adenda 2 (SignalK 2.33): o serviço crítico ativo (apito curto) volta a publicar-se ao arrancar e a histerese continua (51 % não o limpa; 53 % sim)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  ler(app, { [SOC]: 0.49, 'electrical.batteries.servico.current': -5 })
  minutos(t, app, 1, { [SOC]: 0.51 })
  const critico = app.notificacoes.find(n => n.path.endsWith('.servicoCritico') && n.state === 'alarm')
  assert.equal(critico?.apito, 'curto')
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes).filter(n => n.path.endsWith('.servicoCritico')), [critico])
  minutos(t, app, 5, { [SOC]: 0.51 })
  assert.deepEqual(curto(app.notificacoes.slice(antes)).filter(x => x.startsWith('servicoCritico')), ['servicoCritico:alarm'], 'a 51 % não limpa nem se repete')
  minutos(t, app, 1, { [SOC]: 0.53 })
  assert.deepEqual(curto(app.notificacoes.slice(antes)).filter(x => x.startsWith('servicoCritico')), ['servicoCritico:alarm', 'servicoCritico:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): o "sem dados do SmartShunt" ativo volta logo ao arrancar (não 5 min depois) e limpa com o 1.º SoC', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  minutos(t, app, 6) // o SmartShunt calado desde o arranque
  const aviso = app.notificacoes.find(n => n.path.endsWith('.sensorPerdido') && n.state === 'warn')
  assert.ok(aviso)
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes), [aviso])
  minutos(t, app, 2)
  assert.equal(app.notificacoes.length, antes + 1, 'continua calado: nem limpa nem se repete')
  ler(app, { [SOC]: 0.8 })
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['sensorPerdido:warn', 'sensorPerdido:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): o "já podes desligar o motor" ativo volta a publicar-se e fica enquanto o motor trabalha; limpa quando para', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  ler(app, { [SOC]: 0.54, [RPM]: 0 }) // pede para ligar
  minutos(t, app, 1, { [SOC]: 0.54, [RPM]: 35 }) // ligou
  minutos(t, app, 1, { [SOC]: 0.86, [RPM]: 35 }) // carregou: já pode desligar
  const aviso = app.notificacoes.find(n => n.path.endsWith('.desligarMotor') && n.state === 'warn')
  assert.ok(aviso, JSON.stringify(curto(app.notificacoes)))
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes), [aviso])
  ler(app, { [SOC]: 0.86 }) // uma leitura antes das rotações: o motor ainda conta como a trabalhar
  minutos(t, app, 3, { [SOC]: 0.87, [RPM]: 35 })
  assert.equal(app.notificacoes.length, antes + 1, 'o motor continua a trabalhar: nem limpa nem se repete')
  minutos(t, app, 1, { [SOC]: 0.87, [RPM]: 0 }) // parou
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['desligarMotor:warn', 'desligarMotor:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): um ficheiro de há mais de 10 min (o Pi esteve desligado) não repõe nada', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  ler(app, { [SOC]: 0.49 })
  p.stop()
  t.mock.timers.tick(11 * 60 * 1000)
  const antes = app.notificacoes.length
  const p2 = criar(app)
  p2.start({})
  p2.stop()
  assert.deepEqual(app.notificacoes.slice(antes), [])
})
