'use strict'
// Nota do SignalK 2.33 (adenda 2 da auditoria): ao parar um plugin o servidor apaga da árvore os valores
// dele (removeSource); cada reinício parecia um alarme resolvido. O gasóleo volta a publicar no arranque os
// alarmes que estavam ativos (o mesmo caminho e o mesmo valor) e as regras continuam a partir deles.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')

const T0 = 1_727_600_000_000
const TABELA = [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }]
const razaoDe = (litros) => 0.1 + 0.6 * litros / 200

function appFalso () {
  const app = { self: {}, ts: {}, valores: {}, notificacoes: [], estado: '' }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-gasoleo-reinicio-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p], timestamp: app.ts[p] ?? new Date().toISOString() } : undefined)
  app.handleMessage = (id, d) => {
    for (const u of d.updates) for (const v of u.values) {
      if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
      else app.valores[v.path] = v.value
    }
  }
  app.setPluginStatus = (s) => { app.estado = s }
  app.setPluginError = (e) => { throw new Error(e) }
  app.error = (e) => { throw new Error(e) }
  app.savePluginOptions = (o, cb) => cb()
  return app
}
const avancar = (t, s) => { for (let i = 0; i < s; i++) t.mock.timers.tick(1000) }
const sonda = (app, litros) => {
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = razaoDe(litros) * 12.6
}
const curto = (ns) => ns.map(n => `${n.path.split('.').pop()}:${n.state}`)
const reiniciar = (t, app, p) => {
  p.stop()
  avancar(t, 3)
  const p2 = criar(app)
  const antes = app.notificacoes.length
  p2.start({ tabela: TABELA })
  return { p2, antes }
}

test('Adenda 2 (SignalK 2.33): a reserva ativa volta a publicar-se ao arrancar e a histerese continua (42 L não a limpa; 46 L sim)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: TABELA })
  sonda(app, 38)
  avancar(t, 200)
  sonda(app, 42) // entre os 40 e os 45: fica
  avancar(t, 400)
  const aviso = app.notificacoes.find(n => n.path.endsWith('.reserva') && n.state === 'warn')
  assert.ok(aviso)
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes), [aviso])
  avancar(t, 400)
  assert.deepEqual(curto(app.notificacoes.slice(antes + 1)), [], 'a 42 L não limpa nem se repete')
  sonda(app, 46)
  avancar(t, 400)
  assert.deepEqual(curto(app.notificacoes.slice(antes + 1)), ['reserva:normal'])
  p2.stop()
})

test('Adenda 2 (SignalK 2.33): a fuga ativa (apito contínuo) volta a publicar-se e não se dá por resolvida (a janela de 12 h com o motor parado volta)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: TABELA })
  sonda(app, 150)
  avancar(t, 240)
  sonda(app, 140) // −10 L com o motor parado
  avancar(t, 240)
  const fuga = app.notificacoes.find(n => n.path.endsWith('.fuga') && n.state === 'alarm')
  assert.equal(fuga?.apito, 'continuo')
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes), [fuga])
  avancar(t, 20 * 60)
  const antesDoStop = curto(app.notificacoes.slice(antes))
  p2.stop()
  assert.deepEqual(antesDoStop, ['fuga:alarm'], 'a fuga continuava: sem a janela de antes dava-se por resolvida ao fim de ~2 min')
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['fuga:alarm', 'fuga:normal']) // o normal do stop() (I-21)
})

test('Adenda 2 (SignalK 2.33): o aviso sondaPerdida ativo volta logo (não 5 min depois) e limpa quando a sonda volta', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: TABELA })
  sonda(app, 120)
  avancar(t, 200)
  const morreu = new Date().toISOString()
  app.ts['tanks.fuel.0.supplyVoltage'] = morreu
  app.ts['tanks.fuel.0.senderVoltage'] = morreu
  avancar(t, 7 * 60)
  const aviso = app.notificacoes.find(n => n.path.endsWith('.sondaPerdida') && n.state === 'warn')
  assert.ok(aviso)
  const { p2, antes } = reiniciar(t, app, p)
  assert.deepEqual(app.notificacoes.slice(antes), [aviso])
  avancar(t, 60)
  assert.equal(app.notificacoes.length, antes + 1, 'a sonda continua perdida: não se repete')
  delete app.ts['tanks.fuel.0.supplyVoltage']
  delete app.ts['tanks.fuel.0.senderVoltage']
  avancar(t, 2)
  assert.deepEqual(curto(app.notificacoes.slice(antes)), ['sondaPerdida:warn', 'sondaPerdida:normal'])
  p2.stop()
})
