'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { acrescentarPonto } = require('../lib/tabela')

function appFalso () {
  const app = { self: {}, valores: {}, notificacoes: [], estado: '', opcoesGuardadas: null }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-gasoleo-'))
  app.getDataDirPath = () => app.dir
  app.getSelfPath = (p) => (p in app.self ? { value: app.self[p] } : undefined)
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
