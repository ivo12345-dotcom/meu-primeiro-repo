import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../public/lib/formato.js'

test('conversões SI', () => {
  assert.equal(f.nos(1), 1.9438444924406046)
  assert.equal(f.graus(Math.PI), 180)
  assert.equal(f.celsius(373.15), 100)
  assert.equal(f.hpa(101325), 1013.25)
  assert.equal(f.mn(1852), 1)
})

test('números com vírgula e — quando falta', () => {
  assert.equal(f.num(5.94, 1), '5,9')
  assert.equal(f.num(null, 1), '—')
  assert.equal(f.num(undefined), '—')
  assert.equal(f.num(NaN), '—')
  assert.equal(f.num(1243, 0), '1243')
  assert.equal(f.num(-0.04, 1), '0,0')
})

test('rumos com 3 dígitos e 0–359', () => {
  assert.equal(f.rumo(0.6109), '035°')
  assert.equal(f.rumo(-0.1), '354°')
  assert.equal(f.rumo(2 * Math.PI), '000°')
  assert.equal(f.rumo(null), '—')
})

test('ângulo de vento com bordo', () => {
  assert.equal(f.anguloBordo(-1.0123), '58° BB')
  assert.equal(f.anguloBordo(0.7), '40° EB')
  assert.equal(f.anguloBordo(null), '—')
})

test('velocidade em nós, distância em MN, duração', () => {
  assert.equal(f.velocidade(3.0), '5,8')
  assert.equal(f.distancia(5741.2), '3,1')
  assert.equal(f.duracao(2040), '34 min')
  assert.equal(f.duracao(3 * 3600 + 5 * 60), '3 h 05')
  assert.equal(f.duracao(null), '—')
})

test('hora local HH:MM', () => {
  const d = new Date(2026, 8, 29, 14, 32)
  assert.equal(f.hora(d), '14:32')
})
