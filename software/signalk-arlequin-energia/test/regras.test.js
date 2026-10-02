'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstado, avaliar, LIMITES } = require('../lib/regras')

const MIN = 60 * 1000
const T0 = Date.parse('2026-10-01T12:00:00Z')

// Leitura base: dia, parado, motor parado, tudo normal.
function leitura (extra = {}) {
  return { soc: 0.9, socEm: extra.agora ?? T0, vMotor: 12.7, rpm: 0, sog: 0, modo: 'day', ...extra }
}

// Corre uma sequência de leituras e junta todas as notificações emitidas.
function correr (passos) {
  let estado = novoEstado()
  const todas = []
  for (const [agora, l] of passos) {
    const r = avaliar(estado, { ...leitura({ agora }), ...l, socEm: l.socEm ?? agora }, agora)
    estado = r.estado
    todas.push(...r.notificacoes.map(n => ({ ...n, agora })))
  }
  return { estado, todas }
}

const ids = (ns) => ns.map(n => `${n.id}:${n.state}`)

test('tudo normal não emite nada', () => {
  const { todas } = correr([[T0, {}], [T0 + MIN, {}]])
  assert.deepEqual(todas, [])
})

test('55% com motor parado de dia: ligarMotor warn com som', () => {
  const { todas } = correr([[T0, { soc: 0.55 }]])
  assert.deepEqual(ids(todas), ['ligarMotor:warn'])
  assert.deepEqual(todas[0].method, ['visual', 'sound'])
  assert.match(todas[0].message, /55%.*liga o motor/)
})

test('ligarMotor tem histerese: só limpa acima de 58%', () => {
  const { todas } = correr([
    [T0, { soc: 0.55 }],
    [T0 + MIN, { soc: 0.57 }],
    [T0 + 2 * MIN, { soc: 0.59 }]
  ])
  assert.deepEqual(ids(todas), ['ligarMotor:warn', 'ligarMotor:normal'])
})

test('ligarMotor limpa quando o motor liga', () => {
  const { todas } = correr([
    [T0, { soc: 0.55 }],
    [T0 + MIN, { soc: 0.55, rpm: 30 }]
  ])
  assert.deepEqual(ids(todas), ['ligarMotor:warn', 'ligarMotor:normal'])
})

test('ligarMotor repete de 30 em 30 minutos', () => {
  const passos = []
  for (let m = 0; m <= 61; m++) passos.push([T0 + m * MIN, { soc: 0.54 }])
  const { todas } = correr(passos)
  assert.deepEqual(todas.map(n => (n.agora - T0) / MIN), [0, 30, 60])
})

test('de noite e parado: ligarMotor só no ecrã', () => {
  const { todas } = correr([[T0, { soc: 0.55, modo: 'night' }]])
  assert.deepEqual(todas[0].method, ['visual'])
})

test('de noite a navegar (>1 nó durante 5 min): ligarMotor com som', () => {
  const passos = []
  for (let m = 0; m <= 5; m++) passos.push([T0 + m * MIN, { sog: 2.5, modo: 'night' }])
  passos.push([T0 + 6 * MIN, { sog: 2.5, modo: 'night', soc: 0.55 }])
  const { todas, estado } = correr(passos)
  assert.equal(estado.navegar.estado, true)
  assert.deepEqual(todas[0].method, ['visual', 'sound'])
})

test('rodar no fundeadouro (picos curtos de velocidade) não conta como navegar', () => {
  const passos = []
  for (let m = 0; m <= 20; m++) passos.push([T0 + m * MIN, { sog: m % 4 === 0 ? 0.8 : 0.2 }])
  const { estado } = correr(passos)
  assert.equal(estado.navegar.estado, false)
})

test('carga pedida (motor ligado a 55%): aos 85% "já podes desligar", uma vez; limpa quando o motor para', () => {
  const { todas } = correr([
    [T0, { soc: 0.55 }],
    [T0 + MIN, { soc: 0.55, rpm: 30 }],
    [T0 + 2 * MIN, { soc: 0.84, rpm: 30 }],
    [T0 + 3 * MIN, { soc: 0.85, rpm: 30 }],
    [T0 + 4 * MIN, { soc: 0.86, rpm: 30 }],
    [T0 + 5 * MIN, { soc: 0.86, rpm: 0 }]
  ])
  assert.deepEqual(ids(todas), ['ligarMotor:warn', 'ligarMotor:normal', 'desligarMotor:warn', 'desligarMotor:normal'])
  assert.match(todas[2].message, /85%.*desligar o motor/)
})

test('sair da marina a motor com a bateria cheia: NÃO diz "já podes desligar"', () => {
  const { todas } = correr([
    [T0, { soc: 0.95, rpm: 30 }],
    [T0 + MIN, { soc: 0.95, rpm: 30 }],
    [T0 + 60 * MIN, { soc: 0.96, rpm: 30 }]
  ])
  assert.deepEqual(todas, [])
})

test('abaixo de 50%: servicoCritico alarm com som mesmo de noite parado', () => {
  const { todas } = correr([[T0, { soc: 0.49, modo: 'night' }]])
  const critico = todas.find(n => n.id === 'servicoCritico')
  assert.equal(critico.state, 'alarm')
  assert.deepEqual(critico.method, ['visual', 'sound'])
})

// Auditoria I-07 (decisão n.º 2, contrato C1): o apito contínuo é só para o perigo imediato; a bateria
// de serviço crítica e a do motor fraca são alarmes com apito curto. Os avisos não precisam do campo.
test('C1: servicoCritico e motorFraca levam apito curto; os avisos não levam o campo', () => {
  const { todas } = correr([
    [T0, { soc: 0.49, vMotor: 12.0 }],
    [T0 + 5 * MIN, { soc: 0.49, vMotor: 12.0 }]
  ])
  const apito = Object.fromEntries(todas.map(n => [n.id, n.apito]))
  assert.deepEqual(apito, { ligarMotor: undefined, servicoCritico: 'curto', motorFraca: 'curto' })
})

test('servicoCritico limpa só acima de 52%', () => {
  const { todas } = correr([
    [T0, { soc: 0.49 }],
    [T0 + MIN, { soc: 0.51 }],
    [T0 + 2 * MIN, { soc: 0.53 }]
  ])
  assert.deepEqual(ids(todas.filter(n => n.id === 'servicoCritico')), ['servicoCritico:alarm', 'servicoCritico:normal'])
})

test('bateria do motor fraca só conta com o motor parado há 5 min', () => {
  const { todas } = correr([
    [T0, { vMotor: 12.0 }],
    [T0 + 4 * MIN, { vMotor: 12.0 }],
    [T0 + 5 * MIN, { vMotor: 12.0 }]
  ])
  const fraca = todas.filter(n => n.id === 'motorFraca')
  assert.deepEqual(fraca.map(n => (n.agora - T0) / MIN), [5])
  assert.equal(fraca[0].state, 'alarm')
  assert.match(fraca[0].message, /12,0 V/)
})

test('motorFraca limpa acima de 12,4 V', () => {
  const { todas } = correr([
    [T0, { vMotor: 12.0 }],
    [T0 + 5 * MIN, { vMotor: 12.0 }],
    [T0 + 6 * MIN, { vMotor: 12.3 }],
    [T0 + 7 * MIN, { vMotor: 12.5 }]
  ])
  assert.deepEqual(ids(todas), ['motorFraca:alarm', 'motorFraca:normal'])
})

test('SoC sem atualizar há mais de 5 min: sensorPerdido só no ecrã, alarmes de SoC ficam como estão', () => {
  const { todas, estado } = correr([
    [T0, { soc: 0.55 }],
    [T0 + 6 * MIN, { soc: 0.55, socEm: T0 }]
  ])
  assert.deepEqual(ids(todas), ['ligarMotor:warn', 'sensorPerdido:warn'])
  assert.deepEqual(todas[1].method, ['visual'])
  assert.ok(estado.ativos.ligarMotor)
})

test('percentagem arredonda para baixo: 49,9% não aparece como 50%', () => {
  const { todas } = correr([[T0, { soc: 0.499 }]])
  const critico = todas.find(n => n.id === 'servicoCritico')
  assert.match(critico.message, /^Serviço a 49%/)
})

test('limites exportados batem certo com o desenho', () => {
  assert.equal(LIMITES.ligar, 0.55)
  assert.equal(LIMITES.desligar, 0.85)
  assert.equal(LIMITES.critico, 0.50)
  assert.equal(LIMITES.motorFraca, 12.2)
})
