import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { razaoSimulada, TABELA_SIMULADA, tensoesSonda } = require('../lib/sonda.js')
const { litrosDaRazao } = require('../../signalk-arlequin-gasoleo/lib/nivel.js')

test('a tabela do dev devolve os litros da curva simulada', () => {
  for (const l of [10, 50, 124, 190]) {
    const erro = Math.abs(litrosDaRazao(TABELA_SIMULADA, razaoSimulada(l)) - l)
    assert.ok(erro < 3, `${l} L → erro ${erro}`)
  }
})

test('razão independente da tensão; o balanço cresce com o adorno', () => {
  const a = tensoesSonda({ litros: 100, alimentacao: 12.5, aleatorio: () => 0.5 })
  const b = tensoesSonda({ litros: 100, alimentacao: 14.2, aleatorio: () => 0.5 })
  assert.ok(Math.abs(a.sonda / a.alimentacao - b.sonda / b.alimentacao) < 1e-12)
  const calmo = tensoesSonda({ litros: 100, alimentacao: 12.6, aleatorio: () => 1 })
  const adornado = tensoesSonda({ litros: 100, alimentacao: 12.6, roll: 0.35, aleatorio: () => 1 })
  assert.ok(adornado.sonda > calmo.sonda)
})
