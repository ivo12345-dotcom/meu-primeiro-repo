'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novaSessao, passoSessao } = require('../lib/sessao')

const MIN = 60 * 1000
const T0 = Date.parse('2026-10-01T12:00:00Z')

function correr (passos, inicial = novaSessao()) {
  let s = inicial
  const fechadas = []
  for (const [agora, l] of passos) {
    const r = passoSessao(s, l, agora)
    s = r.sessao
    if (r.fechada) fechadas.push(r.fechada)
  }
  return { s, fechadas }
}

test('motor 1 h a 60 A: sessão com 60 Ah e 1 h de motor', () => {
  const passos = []
  for (let m = 0; m <= 60; m++) passos.push([T0 + m * MIN, { motorLigado: true, corrente: 60, soc: 0.55 + m * 0.004 }])
  passos.push([T0 + 61 * MIN, { motorLigado: false, corrente: -2, soc: 0.79 }])
  const { s, fechadas } = correr(passos)
  assert.equal(fechadas.length, 1)
  const f = fechadas[0]
  assert.equal(f.inicio, new Date(T0).toISOString())
  assert.equal(f.fim, new Date(T0 + 61 * MIN).toISOString())
  assert.equal(f.duracaoMin, 61)
  assert.equal(f.ah, 61) // 61 min a 60 A (o último intervalo ainda tinha o motor ligado)
  assert.equal(f.socInicial, 0.55)
  assert.equal(f.socFinal, 0.79)
  assert.equal(Math.round(s.runTimeS), 61 * 60)
  assert.equal(s.aberta, null)
})

test('corrente negativa durante a sessão não desconta Ah', () => {
  const { fechadas } = correr([
    [T0, { motorLigado: true, corrente: -5, soc: 0.6 }],
    [T0 + 30 * MIN, { motorLigado: true, corrente: -5, soc: 0.6 }],
    [T0 + 31 * MIN, { motorLigado: false, corrente: -5, soc: 0.6 }]
  ])
  assert.equal(fechadas[0].ah, 0)
})

test('buraco de dados maior que 2 min não é integrado nem conta horas', () => {
  const { s, fechadas } = correr([
    [T0, { motorLigado: true, corrente: 60, soc: 0.6 }],
    [T0 + 10 * MIN, { motorLigado: true, corrente: 60, soc: 0.6 }],
    [T0 + 11 * MIN, { motorLigado: false, corrente: 0, soc: 0.6 }]
  ])
  assert.equal(fechadas[0].ah, 1)
  assert.equal(Math.round(s.runTimeS), 60)
})

test('horas de motor acumulam entre sessões e partem do valor guardado', () => {
  const inicial = { ...novaSessao(), runTimeS: 3600 }
  const { s } = correr([
    [T0, { motorLigado: true, corrente: 10, soc: 0.6 }],
    [T0 + MIN, { motorLigado: false, corrente: 0, soc: 0.6 }]
  ], inicial)
  assert.equal(Math.round(s.runTimeS), 3660)
})

test('motor parado o tempo todo: nenhuma sessão', () => {
  const { fechadas, s } = correr([
    [T0, { motorLigado: false, corrente: 5, soc: 0.9 }],
    [T0 + MIN, { motorLigado: false, corrente: 5, soc: 0.9 }]
  ])
  assert.deepEqual(fechadas, [])
  assert.equal(s.runTimeS, 0)
})
