import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lerPolar, velocidadeAlvo, percentagem, angulosOtimos } from '../public/lib/polar.js'

const csv = readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8')
const NO = 1852 / 3600
const rad = (g) => g * Math.PI / 180

test('lê o CSV da polar (ignora comentários)', () => {
  const p = lerPolar(csv)
  assert.deepEqual(p.tws, [6, 10, 14, 20])
  assert.equal(p.twa.length, 10)
  assert.equal(p.v[2][2], 6.6) // TWA 60, TWS 14
})

test('velocidade alvo exata num ponto da tabela', () => {
  const p = lerPolar(csv)
  assert.ok(Math.abs(velocidadeAlvo(p, rad(60), 14 * NO) - 6.6 * NO) < 1e-9)
})

test('interpolação bilinear entre pontos', () => {
  const p = lerPolar(csv)
  // TWA 67,5 (meio de 60 e 75), TWS 12 (meio de 10 e 14): média dos 4 cantos
  const esperado = (5.9 + 6.15 + 6.6 + 6.8) / 4
  assert.ok(Math.abs(velocidadeAlvo(p, rad(67.5), 12 * NO) / NO - esperado) < 1e-9)
})

test('fora da tabela: prende aos limites; ângulo negativo (BB) = positivo', () => {
  const p = lerPolar(csv)
  assert.ok(Math.abs(velocidadeAlvo(p, rad(-60), 30 * NO) / NO - 6.85) < 1e-9)
  assert.equal(velocidadeAlvo(p, rad(20), 14 * NO), 0) // dentro do ângulo morto
})

test('percentagem da polar', () => {
  const p = lerPolar(csv)
  const r = percentagem(p, 5.676 * NO, rad(60), 14 * NO)
  assert.equal(Math.round(r * 100), 86)
  assert.equal(percentagem(p, 5 * NO, rad(20), 14 * NO), null)
})

test('ângulos ótimos de VMG para 14 nós', () => {
  const p = lerPolar(csv)
  const a = angulosOtimos(p, 14 * NO)
  const bolina = a.bolina * 180 / Math.PI
  const popa = a.popa * 180 / Math.PI
  assert.ok(bolina >= 42 && bolina <= 55, `bolina ${bolina}`)
  assert.ok(popa >= 140 && popa <= 180, `popa ${popa}`)
  assert.ok(a.vmgBolina > 4 * NO)
})
