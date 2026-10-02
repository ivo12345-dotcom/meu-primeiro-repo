'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { proaVerdadeira, DECLINACAO_MAX_MS } = require('../lib/proa')

const GRAU = Math.PI / 180
const graus = (rad) => Math.round(rad / GRAU * 10) / 10

test('proa verdadeira: a headingTrue quando há; senão a magnética + a declinação (positiva para leste)', () => {
  assert.equal(proaVerdadeira({ headingTrue: 1.2, headingMagnetic: 0.5, magneticVariation: -0.1 }), 1.2)
  assert.equal(graus(proaVerdadeira({ headingMagnetic: 30 * GRAU, magneticVariation: -2 * GRAU })), 28)
  assert.equal(graus(proaVerdadeira({ headingTrue: null, headingMagnetic: 30 * GRAU, magneticVariation: 2 * GRAU })), 32)
})

test('proa verdadeira: dá a volta pelo Norte (fica entre 0 e 360°)', () => {
  assert.equal(graus(proaVerdadeira({ headingMagnetic: 1 * GRAU, magneticVariation: -2 * GRAU })), 359)
  assert.equal(graus(proaVerdadeira({ headingMagnetic: 359 * GRAU, magneticVariation: 2 * GRAU })), 1)
})

test('proa verdadeira: sem declinação não se usa a magnética como se fosse verdadeira; sem nada, undefined', () => {
  assert.equal(proaVerdadeira({ headingMagnetic: 0.5 }), undefined)
  assert.equal(proaVerdadeira({ headingMagnetic: 0.5, magneticVariation: null }), undefined)
  assert.equal(proaVerdadeira({ magneticVariation: 0.1 }), undefined)
  assert.equal(proaVerdadeira({}), undefined)
})

test('a declinação muda devagar (é do sítio): conta durante 1 h', () => {
  assert.equal(DECLINACAO_MAX_MS, 3600000)
})
