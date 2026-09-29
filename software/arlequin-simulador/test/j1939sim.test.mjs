import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { tramasMotor } = require('../lib/j1939sim.js')
const { lerLinha, descodificar } = require('../../signalk-arlequin-j1939/lib/j1939.js')

test('as tramas do simulador descodificam-se nos valores de partida', () => {
  const linhas = tramasMotor({ t: 1727600000000, rpm: 1800, tempK: 358.15, volt: 14.2, horasS: 1243.5 * 3600 })
  const vals = {}
  for (const l of linhas) {
    const t = lerLinha(l)
    for (const v of descodificar(t.pgn, t.dados)) vals[v.path] = v.value
  }
  assert.equal(vals['propulsion.main.revolutions'] * 60, 1800)
  assert.equal(vals['propulsion.main.temperature'], 358.15)
  assert.ok(Math.abs(vals['propulsion.main.alternatorVoltage'] - 14.2) < 1e-9)
  assert.equal(vals['propulsion.main.runTime'], 1243.5 * 3600)
  assert.equal(lerLinha(linhas[4]).pgn, 65417)
})
