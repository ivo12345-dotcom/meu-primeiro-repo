'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novaCurva, amostra, resumo, criarDetetor, estavel, litrosPorMilha } = require('../lib/curva')

const NO = 1852 / 3600

test('litros por milha = L/h ÷ nós; sem andar não há valor', () => {
  assert.ok(Math.abs(litrosPorMilha(2.0, 5 * NO) - 0.4) < 1e-9)
  assert.equal(litrosPorMilha(2.0, 0.3 * NO), null)
  assert.equal(litrosPorMilha(null, 5 * NO), null)
})

test('regime estável: rotações dentro de 60 rpm durante 30 s', () => {
  let d = criarDetetor()
  for (let s = 0; s < 30; s++) d = estavel(d, 2400 + (s % 2) * 20, s * 1000).d
  assert.equal(estavel(d, 2410, 30000).estavel, true)
  let d2 = criarDetetor()
  for (let s = 0; s < 30; s++) d2 = estavel(d2, 2000 + s * 10, s * 1000).d
  assert.equal(estavel(d2, 2300, 30000).estavel, false)
})

test('curva aprendida: médias por faixa de 200 rpm e a mais económica', () => {
  let c = novaCurva()
  for (let i = 0; i < 120; i++) c = amostra(c, { rpm: 2050, lh: 1.3, vel: 4.3 * NO })
  for (let i = 0; i < 120; i++) c = amostra(c, { rpm: 2450, lh: 2.0, vel: 5.2 * NO })
  for (let i = 0; i < 120; i++) c = amostra(c, { rpm: 1250, lh: 0.5, vel: 2.5 * NO }) // lento demais
  for (let i = 0; i < 10; i++) c = amostra(c, { rpm: 2850, lh: 3.0, vel: 6.1 * NO }) // poucos dados
  const r = resumo(c)
  assert.deepEqual(r.faixas.map(f => f.de), [1200, 2000, 2400])
  const f2000 = r.faixas.find(f => f.de === 2000)
  assert.equal(f2000.ate, 2200)
  assert.ok(Math.abs(f2000.nos - 4.3) < 1e-9)
  assert.ok(Math.abs(f2000.lmn - 1.3 / 4.3) < 1e-9)
  // a de 1200 gasta menos por milha, mas abaixo de 3 nós não conta como regime
  assert.equal(r.melhor.de, 2000)
})
