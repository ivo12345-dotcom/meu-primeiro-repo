'use strict'
// Junta o simulador e o plugin de energia com um "app" SignalK falso e corre
// cenários de vários dias em milissegundos.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criarPlugin = require('..')
const { criarModelo, avancar } = require('../../arlequin-simulador/lib/modelo')
const { CENARIOS, passoEm } = require('../../arlequin-simulador/lib/cenarios')
const { deltaDaLeitura } = require('../../arlequin-simulador/lib/delta')

function appFalso () {
  const app = {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-int-')),
    notificacoes: [],
    runTime: [],
    estado: '',
    receber: null,
    getDataDirPath: () => app.dir,
    handleMessage: (id, delta) => {
      for (const u of delta.updates) {
        for (const v of u.values) {
          if (v.path.startsWith('notifications.')) {
            app.notificacoes.push({ t: Date.parse(u.timestamp), id: v.path.split('.').pop(), ...v.value })
          } else if (v.path.endsWith('.runTime')) app.runTime.push(v.value)
        }
      }
    },
    subscriptionmanager: { subscribe: (sub, unsubs, erro, cb) => { app.receber = cb; unsubs.push(() => {}) } },
    setPluginStatus: (s) => { app.estado = s },
    setPluginError: (e) => { throw new Error(e) },
    error: (e) => { throw new Error(e) },
    debug: () => {}
  }
  return app
}

function correrCenario (nome, inicio = '2026-01-10T08:00:00') {
  const app = appFalso()
  const plugin = criarPlugin(app)
  plugin.start({})
  const cenario = CENARIOS[nome]
  let m = criarModelo(cenario.opcoes, new Date(inicio).getTime())
  const leituras = []
  for (let minuto = 0; ; minuto++) {
    const passo = passoEm(cenario, minuto)
    if (!passo) break
    const r = avancar(m, 60 * 1000, passo)
    m = r.modelo
    leituras.push({ ...r.leitura, navegar: !!passo.navegar })
    app.receber(deltaDaLeitura(r.leitura))
  }
  plugin.stop()
  return { app, leituras }
}

const sequencia = (ns) => ns.map(n => `${n.id}:${n.state}`)

test('inverno a navegar: pede para ligar, o motor liga, pede para desligar, regista a carga', async () => {
  const { app, leituras } = correrCenario('inverno-navegar')
  const seq = sequencia(app.notificacoes)
  const i = seq.indexOf('ligarMotor:warn')
  assert.ok(i >= 0, seq.join(' '))
  assert.deepEqual(seq.slice(i, i + 4), ['ligarMotor:warn', 'ligarMotor:normal', 'desligarMotor:warn', 'desligarMotor:normal'])
  assert.ok(!seq.includes('servicoCritico:alarm'), 'o motor auto tem de evitar o crítico')

  // A navegar há mais de 5 min: o aviso leva som mesmo de noite.
  const aviso = app.notificacoes[i]
  const l = leituras.find(x => Math.abs(x.t - aviso.t) < 1000)
  assert.equal(l.navegar, true)
  assert.deepEqual(aviso.method, ['visual', 'sound'])

  await new Promise(r => setTimeout(r, 50)) // deixa acabar a escrita assíncrona do JSONL
  const sessoes = fs.readFileSync(path.join(app.dir, 'sessoes-carga.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(sessoes.length >= 1)
  assert.ok(sessoes[0].ah > 50, `Ah ${sessoes[0].ah}`)
  assert.equal(Math.round(sessoes[0].socInicial * 100), 55)
  assert.equal(Math.round(sessoes[0].socFinal * 100), 85)
  assert.ok(app.runTime.length > 0)
  assert.ok(fs.existsSync(path.join(app.dir, 'runtime.json')))
})

test('descarga sem motor: 55% no ecrã e depois alarme crítico com som', () => {
  const { app } = correrCenario('descarga-critica')
  const seq = sequencia(app.notificacoes)
  assert.ok(seq.indexOf('ligarMotor:warn') < seq.indexOf('servicoCritico:alarm'), seq.join(' '))
  const critico = app.notificacoes.find(n => n.id === 'servicoCritico')
  assert.deepEqual(critico.method, ['visual', 'sound'])
  assert.equal(critico.apito, 'curto') // contrato C1: o apito vai no valor publicado
})

test('bateria do motor fraca (motor parado há horas): alarme na 1.ª leitura baixa, limpa a 12,6 V', () => {
  const { app } = correrCenario('motor-fraca')
  const fraca = app.notificacoes.filter(n => n.id === 'motorFraca')
  assert.deepEqual(fraca.map(n => n.state), ['alarm', 'normal'])
  const inicioQueda = new Date('2026-01-10T10:00:00').getTime()
  // O 1.º passo do segmento de 12,0 V fica carimbado às 10:01.
  assert.equal(Math.round((fraca[0].t - inicioQueda) / 60000), 1)
})

test('verão a navegar sem piloto: o sol chega, nenhum alarme', () => {
  const { app } = correrCenario('verao-navegar', '2026-07-10T08:00:00')
  assert.deepEqual(app.notificacoes, [])
})

test('parado no porto de noite: o aviso dos 55% fica só no ecrã', () => {
  const app = appFalso()
  const plugin = criarPlugin(app)
  plugin.start({})
  let m = criarModelo({ socInicial: 0.556, fatorSolar: 0 }, new Date('2026-01-10T22:00:00').getTime())
  for (let i = 0; i < 180; i++) {
    const r = avancar(m, 60 * 1000, {})
    m = r.modelo
    app.receber(deltaDaLeitura(r.leitura))
  }
  plugin.stop()
  const aviso = app.notificacoes.find(n => n.id === 'ligarMotor')
  assert.ok(aviso, 'devia ter pedido para ligar o motor')
  assert.deepEqual(aviso.method, ['visual'])
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

test('K-11: com a segurança do SignalK (router.access) o GET /sessoes regista-se "readonly"; nada fica só para admin', () => {
  const r = niveis(criarPlugin(appFalso()))
  assert.deepEqual(r.direto, [], 'nenhuma rota sem nível (ficava só para admin)')
  assert.deepEqual(r.nivel, { 'GET /sessoes': 'readonly' })
  assert.ok(r.funcoes)
})

test('GET /sessoes devolve as cargas, a mais recente primeiro', async () => {
  const { app } = correrCenario('inverno-navegar')
  await new Promise(r => setTimeout(r, 50))
  const plugin = criarPlugin(app)
  plugin.start({})
  const rotas = {}
  plugin.registerWithRouter({ get: (p, h) => { rotas[p] = h } })
  let resposta
  rotas['/sessoes']({ query: {} }, { json: (j) => { resposta = j } })
  plugin.stop()
  assert.ok(resposta.sessoes.length >= 1)
  assert.ok(resposta.sessoes[0].ah > 50)
  assert.ok(resposta.runTimeS > 3600)
})

test('horas de motor (auditoria K-07): o J1939 publicou-as há mais de 5 min (ignição desligada): continua a não publicar as suas', () => {
  const app = appFalso()
  app.getSelfPath = (p) => p === 'propulsion.main.runTime'
    ? { value: 4475000, $source: 'signalk-arlequin-j1939', timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }
    : undefined
  const plugin = criarPlugin(app)
  plugin.start({})
  let m = criarModelo({ socInicial: 0.9 }, Date.now())
  for (let i = 0; i < 5; i++) {
    const r = avancar(m, 60 * 1000, { motor: true })
    m = r.modelo
    app.receber(deltaDaLeitura(r.leitura))
  }
  plugin.stop()
  assert.deepEqual(app.runTime, [])
})

test('horas de motor: um null de outra fonte não conta (só um número de horas)', () => {
  const app = appFalso()
  app.getSelfPath = (p) => p === 'propulsion.main.runTime'
    ? { value: null, $source: 'outra-fonte', timestamp: new Date().toISOString() }
    : undefined
  const plugin = criarPlugin(app)
  plugin.start({})
  let m = criarModelo({ socInicial: 0.9 }, Date.now())
  for (let i = 0; i < 5; i++) {
    const r = avancar(m, 60 * 1000, { motor: true })
    m = r.modelo
    app.receber(deltaDaLeitura(r.leitura))
  }
  plugin.stop()
  assert.ok(app.runTime.length > 0)
})

test('horas de motor: não publica se o J1939 (outra fonte) já as publica', () => {
  const app = appFalso()
  app.getSelfPath = (p) => p === 'propulsion.main.runTime'
    ? { value: 4475000, $source: 'signalk-arlequin-j1939', timestamp: new Date().toISOString() }
    : undefined
  const plugin = criarPlugin(app)
  plugin.start({})
  let m = criarModelo({ socInicial: 0.9 }, Date.now())
  for (let i = 0; i < 5; i++) {
    const r = avancar(m, 60 * 1000, { motor: true })
    m = r.modelo
    app.receber(deltaDaLeitura(r.leitura))
  }
  plugin.stop()
  assert.deepEqual(app.runTime, [])
})
