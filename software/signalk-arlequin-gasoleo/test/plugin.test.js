'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { acrescentarPonto } = require('../lib/tabela')

// Como o SignalK, cada valor vem com a hora (timestamp): a de agora, ou a posta em app.ts (um sensor calado).
function appFalso () {
  const app = { self: {}, ts: {}, valores: {}, notificacoes: [], estado: '', opcoesGuardadas: null }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-gasoleo-'))
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
  app.error = () => {}
  app.savePluginOptions = (o, cb) => { app.opcoesGuardadas = o; cb() }
  return app
}

// O relógio simulado do node salta logo para o fim num tick grande: avança-se de 1 em 1 s.
const avancar = (t, segundos) => { for (let i = 0; i < segundos; i++) t.mock.timers.tick(1000) }

const rotasDe = (p) => {
  const r = { get: {}, post: {} }
  p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } })
  return r
}
const chamar = (h, body) => new Promise((resolve) => {
  const res = { statusCode: 200, status (c) { this.statusCode = c; return this }, json (j) { resolve({ status: this.statusCode, ...j }) } }
  h({ body }, res)
})

// Auditoria K-11 (contrato C2): com a segurança do SignalK ligada (2.33), uma rota sem router.access só
// aceita admin; o ecrã entra com uma conta "read/write". Os GET pedem "readonly" e os POST "readwrite".
function niveis (p) {
  const direto = []
  const registos = []
  const router = {
    get: (k) => direto.push(`GET ${k}`),
    post: (k) => direto.push(`POST ${k}`),
    access: (nivel) => ({
      get: (k, h) => registos.push({ m: 'GET', k, nivel, h: typeof h }),
      post: (k, h) => registos.push({ m: 'POST', k, nivel, h: typeof h })
    })
  }
  p.registerWithRouter(router)
  return { direto, nivel: Object.fromEntries(registos.map(x => [`${x.m} ${x.k}`, x.nivel])), funcoes: registos.every(x => x.h === 'function') }
}

test('K-11: com a segurança do SignalK (router.access) os GET registam-se "readonly" e os POST "readwrite"; nada fica só para admin', () => {
  const r = niveis(criar(appFalso()))
  assert.deepEqual(r.direto, [], 'nenhuma rota sem nível (ficava só para admin)')
  assert.deepEqual(r.nivel, {
    'GET /calibracao': 'readonly',
    'POST /calibracao/iniciar': 'readwrite',
    'POST /calibracao/adicionar': 'readwrite',
    'POST /calibracao/desfazer': 'readwrite',
    'POST /calibracao/cancelar': 'readwrite',
    'POST /calibracao/terminar': 'readwrite',
    'POST /calibracao/importar': 'readwrite',
    'GET /estado': 'readonly',
    'POST /calibrar': 'readwrite',
    'POST /abastecimento': 'readwrite'
  })
  assert.ok(r.funcoes)
})

test('pontos de calibração: ordena e substitui o que está perto', () => {
  let t = acrescentarPonto([], { razao: 0.5, litros: 100 }).tabela
  t = acrescentarPonto(t, { razao: 0.2, litros: 20 }).tabela
  t = acrescentarPonto(t, { razao: 0.502, litros: 105 }).tabela
  assert.deepEqual(t, [{ razao: 0.2, litros: 20 }, { razao: 0.502, litros: 105 }])
})

test('ponto incoerente (abastecimento antes de a sonda mudar) é recusado', () => {
  const t = [{ razao: 0.4, litros: 60 }, { razao: 0.56, litros: 120 }, { razao: 0.64, litros: 160 }]
  const r = acrescentarPonto(t, { razao: 0.57, litros: 173 }) // o caso visto no teste ao vivo
  assert.match(r.erro, /não bate certo/)
  assert.equal(r.tabela, undefined)
  assert.ok(acrescentarPonto(t, { razao: 0.60, litros: 140 }).tabela)
})

test('sem tabela: pede calibração; calibrar em dois níveis passa a dar litros', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6

  // Depósito cheio: razão 0,70
  app.self['tanks.fuel.0.senderVoltage'] = 0.70 * 12.6
  avancar(t, 200)
  assert.match(app.estado, /Falta calibrar/)
  assert.equal(app.valores['tanks.fuel.0.currentLevel'], undefined)
  const c1 = await chamar(r.post['/calibrar'], { litros: '200' })
  assert.equal(c1.ok, true)

  // Mais tarde, 60 L no depósito: razão 0,25
  app.self['tanks.fuel.0.senderVoltage'] = 0.25 * 12.6
  avancar(t, 200)
  const c2 = await chamar(r.post['/calibrar'], { litros: '60' })
  assert.deepEqual(c2.tabela, [{ razao: 0.25, litros: 60 }, { razao: 0.7, litros: 200 }])
  assert.deepEqual(app.opcoesGuardadas.tabela, c2.tabela)

  avancar(t, 200)
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentVolume'] * 1000 - 60) < 0.5)
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentLevel'] - 0.3) < 0.01)
  assert.equal(app.valores['tanks.fuel.0.capacity'], 0.2)
})

test('abastecimento pelo ecrã: o ponto fica com os litros antes + metidos', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = 0.22 * 12.6 // 40 L pela tabela
  avancar(t, 200)
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentVolume'] * 1000 - 40) < 0.5)
  // Metem-se 100 L; a sonda real mostra uma razão diferente da tabela (0,50)
  app.self['tanks.fuel.0.senderVoltage'] = 0.50 * 12.6
  avancar(t, 200)
  const a = await chamar(r.post['/abastecimento'], { litros: '100' })
  p.stop()
  assert.equal(a.ok, true)
  assert.ok(Math.abs(a.antes - 40) < 0.5, `antes ${a.antes}`)
  assert.ok(Math.abs(a.depois - 140) < 0.5)
  assert.ok(a.tabela.some(x => Math.abs(x.razao - 0.5) < 1e-9 && Math.abs(x.litros - 140) < 0.5))
  assert.ok(app.notificacoes.some(n => n.path === 'notifications.tanks.fuel.0.reserva' && n.state === 'warn'))
})

test('calibrar com dados inválidos ou ainda a medir: recusa', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotasDe(p)
  assert.equal((await chamar(r.post['/calibrar'], { litros: '300' })).status, 400)
  assert.equal((await chamar(r.post['/calibrar'], { litros: '100' })).status, 409)
  p.stop()
})

test('arranque com o barco adornado: parte do último nível guardado e desconta o consumo', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  fs.writeFileSync(path.join(app.dir, 'nivel.json'), JSON.stringify({ litros: 118, t: '2026-09-29T08:00:00Z' }))
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  Object.assign(app.self, {
    'tanks.fuel.0.supplyVoltage': 14.2,
    'tanks.fuel.0.senderVoltage': 0.3 * 14.2, // a boia adornada diz outra coisa
    'navigation.attitude': { roll: 0.3 },
    'propulsion.main.revolutions': 30,
    'propulsion.main.fuel.rate': 2 / 3600 / 1000 // 2 L/h
  })
  avancar(t, 1800) // meia hora
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentVolume'] * 1000 - 117) < 0.1, `${app.valores['tanks.fuel.0.currentVolume'] * 1000}`)
  assert.match(app.estado, /adornado 17°: a sonda não conta/)
})

test('abastecimento sem a sonda mudar: 422 e a tabela fica igual', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  const tabela = [{ razao: 0.1, litros: 0 }, { razao: 0.4, litros: 60 }, { razao: 0.56, litros: 120 }, { razao: 0.64, litros: 160 }, { razao: 0.7, litros: 200 }]
  p.start({ tabela })
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = 0.5698 * 12.6 // ~122 L
  avancar(t, 200)
  const a = await chamar(r.post['/abastecimento'], { litros: '50' })
  p.stop()
  assert.equal(a.status, 422)
  assert.equal(app.opcoesGuardadas, null)
})

test('calibração completa pelo ecrã: vazio, +5 L até cheio, tabela e capacidade guardadas', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.5
  const razaoDe = (L) => 0.12 + 0.55 * Math.sqrt(L / 210) // depósito real de 210 L
  app.self['tanks.fuel.0.senderVoltage'] = razaoDe(0) * 12.5
  await chamar(r.post['/calibracao/iniciar'], {})
  avancar(t, 40)
  for (let L = 5; L <= 210; L += 5) {
    const a = await chamar(r.post['/calibracao/adicionar'], { litros: '5' })
    assert.equal(a.ok, true, a.erro)
    app.self['tanks.fuel.0.senderVoltage'] = razaoDe(L) * 12.5
    avancar(t, 45)
  }
  const fim = await chamar(r.post['/calibracao/terminar'], { cheio: true })
  p.stop()
  assert.equal(fim.ok, true, fim.erro)
  assert.equal(fim.tabela.length, 43)
  assert.equal(fim.capacidadeL, 210)
  assert.equal(app.opcoesGuardadas.capacidadeL, 210)
  assert.equal(app.opcoesGuardadas.tabela.length, 43)
})

// Auditoria I-12: com a sonda perdida o plugin calava-se e o último nível ficava na árvore (a rota usava-o
// e o "gasóleo desconhecido" nunca disparava).
test('I-12: sonda perdida (as tensões deixam de atualizar): os litros continuam pelo consumo do J1939; aos 5 min, aviso sondaPerdida só no ecrã; limpa quando a sonda volta', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = (0.1 + 0.6 * 120 / 200) * 12.6 // 120 L
  avancar(t, 200)
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentVolume'] * 1000 - 120) < 0.5)
  // a app I2C morre: as tensões ficam na árvore, com a hora velha; o motor a trabalhar a 2 L/h
  const morreu = new Date().toISOString()
  app.ts['tanks.fuel.0.supplyVoltage'] = morreu
  app.ts['tanks.fuel.0.senderVoltage'] = morreu
  app.self['propulsion.main.revolutions'] = 30
  app.self['propulsion.main.fuel.rate'] = 2 / 3600 / 1000
  avancar(t, 4 * 60)
  assert.deepEqual(app.notificacoes.filter(n => n.path.endsWith('sondaPerdida')), [])
  avancar(t, 3 * 60)
  const volume = app.valores['tanks.fuel.0.currentVolume'] * 1000
  assert.ok(volume < 120 - 0.15 && volume > 120 - 0.3, `litros ${volume}`) // ~6 min a 2 L/h depois de a sonda ficar velha
  const aviso = app.notificacoes.filter(n => n.path === 'notifications.tanks.fuel.0.sondaPerdida')
  assert.deepEqual(aviso.map(n => n.state), ['warn'])
  assert.deepEqual(aviso[0].method, ['visual'])
  assert.match(aviso[0].message, /^Sonda do gasóleo sem leitura há mais de 5 min/)
  // a sonda volta
  delete app.ts['tanks.fuel.0.supplyVoltage']
  delete app.ts['tanks.fuel.0.senderVoltage']
  avancar(t, 5)
  p.stop()
  assert.deepEqual(app.notificacoes.filter(n => n.path.endsWith('sondaPerdida')).map(n => n.state), ['warn', 'normal'])
})

test('I-12: sem a sonda, os litros pelo consumo também acendem a reserva (≤ 40 L)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  fs.writeFileSync(path.join(app.dir, 'nivel.json'), JSON.stringify({ litros: 41, t: '2026-09-29T08:00:00Z' }))
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  Object.assign(app.self, { 'propulsion.main.revolutions': 30, 'propulsion.main.fuel.rate': 2 / 3600 / 1000 }) // 2 L/h, sem sonda
  avancar(t, 3600)
  const reserva = app.notificacoes.filter(n => n.path === 'notifications.tanks.fuel.0.reserva').map(n => n.state)
  p.stop()
  assert.ok(Math.abs(app.valores['tanks.fuel.0.currentVolume'] * 1000 - 39) < 0.05)
  assert.deepEqual(reserva, ['warn'])
})

test('I-12 (E-M15): sem a sonda, rotações e consumo velhos (o J1939 parou) não descontam litros', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  fs.writeFileSync(path.join(app.dir, 'nivel.json'), JSON.stringify({ litros: 118, t: '2026-09-29T08:00:00Z' }))
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const velho = new Date(Date.now() - 60 * 1000).toISOString()
  Object.assign(app.self, { 'propulsion.main.revolutions': 30, 'propulsion.main.fuel.rate': 2 / 3600 / 1000 })
  Object.assign(app.ts, { 'propulsion.main.revolutions': velho, 'propulsion.main.fuel.rate': velho })
  avancar(t, 30 * 60)
  p.stop()
  assert.equal(app.valores['tanks.fuel.0.currentVolume'] * 1000, 118) // sem sonda desde o arranque: o nível guardado, sem descontar
})

// Auditoria I-21: um alarme ativo quando o plugin para (reinício pelo Admin UI) ficava na árvore para
// sempre; e um que ficou preso de antes nunca saía.
test('I-21: ao parar, os alarmes ativos passam a normal', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = (0.1 + 0.6 * 30 / 200) * 12.6 // 30 L: reserva
  avancar(t, 200)
  p.stop()
  assert.deepEqual(app.notificacoes.filter(n => n.path === 'notifications.tanks.fuel.0.reserva').map(n => n.state), ['warn', 'normal'])
})

test('I-21: uma tabela nova (folha importada) não deixa presos os alarmes do nível antigo', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = 0.19 * 12.6 // 30 L nesta tabela: reserva
  avancar(t, 200)
  assert.ok(app.notificacoes.some(n => n.path.endsWith('reserva') && n.state === 'warn'))
  // a folha do multímetro diz que a razão 0,19 são ~83 L (entre 0,12 = 60 L e 0,30 = 120 L)
  const linhas = [[0, 0.10], [60, 0.12], [120, 0.30], [200, 0.70]].map(([litros, razao]) => ({ litros, sonda: razao * 12.6, alimentacao: 12.6 }))
  const imp = await chamar(r.post['/calibracao/importar'], { linhas })
  assert.equal(imp.ok, true, imp.erro)
  p.stop()
  assert.deepEqual(app.notificacoes.filter(n => n.path.endsWith('reserva')).map(n => n.state).slice(0, 2), ['warn', 'normal'])
})

test('I-21: ao arrancar, as notificações deste plugin presas na árvore passam a normal', () => {
  const app = appFalso()
  app.self['notifications.tanks.fuel.0.fuga'] = { state: 'alarm', method: ['visual', 'sound'], message: 'Possível fuga' }
  app.self['notifications.tanks.fuel.0.reserva'] = { state: 'normal', method: [], message: 'Normal' }
  const p = criar(app)
  p.start({})
  p.stop()
  assert.deepEqual(app.notificacoes.map(n => `${n.path}:${n.state}`), ['notifications.tanks.fuel.0.fuga:normal'])
})

test('C1: a fuga de gasóleo é publicada com apito contínuo', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = (0.1 + 0.6 * 150 / 200) * 12.6 // 150 L
  avancar(t, 240)
  app.self['tanks.fuel.0.senderVoltage'] = (0.1 + 0.6 * 140 / 200) * 12.6 // 140 L, motor parado
  avancar(t, 240)
  p.stop()
  const fuga = app.notificacoes.find(n => n.path === 'notifications.tanks.fuel.0.fuga')
  assert.equal(fuga?.state, 'alarm', JSON.stringify(app.notificacoes))
  assert.equal(fuga.apito, 'continuo')
})

// Auditoria I-30: a verificação via a tabela ordenada pelos litros (que sobem sempre): não verificava nada.
test('I-30: uma folha incoerente (a razão desce aos 100 L, engano de leitura) é recusada com 422 e a tabela fica igual', async () => {
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const r = rotasDe(p)
  const linhas = [[0, 0.10], [50, 0.25], [100, 0.22], [150, 0.45], [200, 0.70]].map(([litros, razao]) => ({ litros, sonda: razao * 12.6, alimentacao: 12.6 }))
  const res = await chamar(r.post['/calibracao/importar'], { linhas, cheio: true })
  p.stop()
  assert.equal(res.status, 422)
  assert.equal(app.opcoesGuardadas, null)
})

test('I-30: uma calibração completa com um ponto incoerente (a razão desce) é recusada com 422', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.7, litros: 200 }] })
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.5
  const razaoDe = (L) => (L === 15 ? 0.15 : 0.12 + 0.004 * L) // aos 15 L a leitura desce (engano)
  app.self['tanks.fuel.0.senderVoltage'] = razaoDe(0) * 12.5
  await chamar(r.post['/calibracao/iniciar'], {})
  avancar(t, 40)
  for (let L = 5; L <= 25; L += 5) {
    const a = await chamar(r.post['/calibracao/adicionar'], { litros: '5' })
    assert.equal(a.ok, true, a.erro)
    app.self['tanks.fuel.0.senderVoltage'] = razaoDe(L) * 12.5
    avancar(t, 45)
  }
  const fim = await chamar(r.post['/calibracao/terminar'], {})
  p.stop()
  assert.equal(fim.status, 422, JSON.stringify(fim))
  assert.equal(app.opcoesGuardadas, null)
})

// Auditoria M-67 (E-M10): com a alimentação ≤ 1 V o estado dizia "razão undefined".
test('M-67: o estado do plugin nunca diz "undefined": sem razão "—", com razão a vírgula decimal', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({})
  app.self['tanks.fuel.0.supplyVoltage'] = 0.5 // medidor sem alimentação
  app.self['tanks.fuel.0.senderVoltage'] = 0.2
  avancar(t, 2)
  assert.equal(app.estado, 'Falta calibrar (0 pontos) · razão —')
  app.self['tanks.fuel.0.supplyVoltage'] = 12.5
  app.self['tanks.fuel.0.senderVoltage'] = 0.25 * 12.5
  avancar(t, 2)
  p.stop()
  assert.equal(app.estado, 'Falta calibrar (0 pontos) · razão 0,250')
})

// Auditoria M-68 (E-M12): "Abasteci" com mais do que cabia gravava o ponto com 200 L em silêncio.
test('M-68: "Abasteci" que não cabia (mais de 5 L acima da capacidade) dá 422 e a tabela fica igual; até +5 L conta como cheio', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ tabela: [{ razao: 0.1, litros: 0 }, { razao: 0.4, litros: 100 }] }) // calibrado só até aos 100 L
  const r = rotasDe(p)
  app.self['tanks.fuel.0.supplyVoltage'] = 12.6
  app.self['tanks.fuel.0.senderVoltage'] = 0.4 * 12.6 // 100 L
  avancar(t, 200)
  app.self['tanks.fuel.0.senderVoltage'] = 0.72 * 12.6 // atestou: a boia no topo
  avancar(t, 200)
  // diz que meteu 150 L: com 100 antes não cabiam num depósito de 200 (os litros, ou o nível, estavam errados)
  const a = await chamar(r.post['/abastecimento'], { litros: '150' })
  assert.equal(a.status, 422)
  assert.match(a.erro, /não cabia/)
  assert.equal(app.opcoesGuardadas, null)
  const b = await chamar(r.post['/abastecimento'], { litros: '103' }) // 100 + 103 = 203: dentro da folga, fica cheio
  p.stop()
  assert.equal(b.status, 200, b.erro)
  assert.equal(b.depois, 200)
})

test('importar a folha do multímetro', async (t) => {
  const app = appFalso()
  const p = criar(app)
  p.start({})
  const r = rotasDe(p)
  const linhas = [0, 20, 60, 120, 200].map(L => ({ litros: L, sonda: (0.1 + 0.003 * L) * 12.6, alimentacao: 12.6 }))
  const res = await chamar(r.post['/calibracao/importar'], { linhas, cheio: true })
  p.stop()
  assert.equal(res.ok, true)
  assert.equal(res.tabela.length, 5)
  assert.equal(app.opcoesGuardadas.capacidadeL, 200)
})
