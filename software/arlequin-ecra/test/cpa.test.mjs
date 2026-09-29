import test from 'node:test'
import assert from 'node:assert/strict'
import { cpa, classificar, LIMITES_AIS } from '../public/lib/cpa.js'

const NO = 1852 / 3600 // m/s
const rad = (g) => g * Math.PI / 180
const PENICHE = { latitude: 39.36, longitude: -9.40 }

// Ponto a d MN na marcação b (graus) a partir de p.
function desloca (p, dMn, bGraus) {
  const d = dMn * 1852
  const b = rad(bGraus)
  const dLat = d * Math.cos(b) / 111320
  const dLon = d * Math.sin(b) / (111320 * Math.cos(rad(p.latitude)))
  return { latitude: p.latitude + dLat, longitude: p.longitude + dLon }
}

test('rota de colisão frontal: CPA ~0 e TCPA = distância / velocidade relativa', () => {
  const eu = { position: PENICHE, cog: rad(0), sog: 5 * NO }
  const ele = { position: desloca(PENICHE, 2, 0), cog: rad(180), sog: 7 * NO }
  const r = cpa(eu, ele)
  assert.ok(r.cpa < 5, `cpa ${r.cpa}`)
  assert.ok(Math.abs(r.tcpa - 600) < 3, `tcpa ${r.tcpa}`) // 2 MN a 12 nós = 10 min
  assert.ok(Math.abs(r.distancia - 3704) < 5)
  assert.ok(Math.abs(r.marcacao - 0) < 0.01 || Math.abs(r.marcacao - 2 * Math.PI) < 0.01)
})

test('navio a cruzar: CPA certo', () => {
  // Ele a 1 MN a leste, a ir para norte a 5 nós; eu parado → CPA = 1 MN já.
  const eu = { position: PENICHE, cog: 0, sog: 0 }
  const ele = { position: desloca(PENICHE, 1, 90), cog: 0, sog: 5 * NO }
  const r = cpa(eu, ele)
  assert.ok(Math.abs(r.cpa - 1852) < 5, `cpa ${r.cpa}`)
  assert.ok(Math.abs(r.tcpa) < 2)
})

test('a afastar-se: TCPA negativo', () => {
  const eu = { position: PENICHE, cog: 0, sog: 5 * NO }
  const ele = { position: desloca(PENICHE, 1, 180), cog: rad(180), sog: 6 * NO }
  const r = cpa(eu, ele)
  assert.ok(r.tcpa < 0)
})

test('dados em falta: null', () => {
  assert.equal(cpa({ position: PENICHE, cog: 0, sog: 1 }, { position: null, cog: 0, sog: 1 }), null)
  assert.equal(cpa({ position: PENICHE }, { position: PENICHE, cog: 0, sog: 1 }), null)
})

test('classificação com os limites 0,5 MN / 20 min', () => {
  assert.equal(LIMITES_AIS.cpa, 0.5 * 1852)
  assert.equal(LIMITES_AIS.tcpa, 20 * 60)
  assert.equal(classificar({ cpa: 400, tcpa: 700 }), 'perigo')
  assert.equal(classificar({ cpa: 400, tcpa: 1500 }), 'atencao') // perto mas daqui a 25 min
  assert.equal(classificar({ cpa: 3000, tcpa: 700 }), 'seguro')
  assert.equal(classificar({ cpa: 400, tcpa: -60 }), 'afasta')
  assert.equal(classificar(null), 'desconhecido')
})
