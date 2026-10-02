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

test('posição em falta: null (sem distância não há nada a dizer)', () => {
  assert.equal(cpa({ position: PENICHE, cog: 0, sog: 1 }, { position: null, cog: 0, sog: 1 }), null)
  assert.equal(cpa({ cog: 0, sog: 1 }, { position: PENICHE, cog: 0, sog: 1 }), null)
})

// Auditoria K-01: sem COG (o AIS manda 360 = "não disponível" e o SignalK nem publica o campo)
// o alarme não pode desaparecer. Abaixo de 0,5 nó o barco conta como parado, sem precisar do COG.
test('K-01: navio fundeado sem COG à nossa proa (SOG 0) conta como parado e dá perigo', () => {
  const eu = { position: PENICHE, cog: 0, sog: 6 * NO }
  const ele = { position: desloca(PENICHE, 1, 0), sog: 0 } // sem cog
  const r = cpa(eu, ele)
  assert.ok(r && !r.semVelocidade, JSON.stringify(r))
  assert.ok(r.cpa < 5, `cpa ${r.cpa}`)
  assert.ok(Math.abs(r.tcpa - 600) < 3, `tcpa ${r.tcpa}`) // 1 MN a 6 nós = 10 min
  assert.equal(classificar(r), 'perigo')
})

test('K-01: nós parados sem COG (SOG 0,2 nó) e um cargueiro a 12 nós direito a nós a 2 MN: perigo', () => {
  const eu = { position: PENICHE, sog: 0.2 * NO } // sem cog
  const ele = { position: desloca(PENICHE, 2, 90), cog: rad(270), sog: 12 * NO }
  const r = cpa(eu, ele)
  assert.ok(r && !r.semVelocidade, JSON.stringify(r))
  assert.ok(r.cpa < 5, `cpa ${r.cpa}`)
  assert.ok(Math.abs(r.tcpa - 600) < 3, `tcpa ${r.tcpa}`)
  assert.equal(classificar(r), 'perigo')
})

test('K-01: abaixo de 0,5 nó conta como parado mesmo com COG (o GPS a "derivar" parado); 0,6 nó já conta', () => {
  const alvo = { position: desloca(PENICHE, 0.05, 0), cog: 0, sog: 0 } // a ~90 m a norte, parado
  const parado = cpa({ position: PENICHE, cog: 0, sog: 0.45 * NO }, alvo)
  assert.equal(parado.tcpa, Infinity)
  assert.equal(classificar(parado), 'atencao')
  const anda = cpa({ position: PENICHE, cog: 0, sog: 0.6 * NO }, alvo)
  assert.ok(anda.tcpa > 0 && anda.tcpa < LIMITES_AIS.tcpa, `tcpa ${anda.tcpa}`)
  assert.equal(classificar(anda), 'perigo')
})

// Auditoria I-09 (decisão n.º 3): dois barcos parados não são colisão.
test('I-09: dois barcos amarrados a 300 m (SOG 0 nos dois): atenção, nunca perigo (TCPA infinito)', () => {
  const eu = { position: PENICHE, cog: 0, sog: 0 }
  const ele = { position: desloca(PENICHE, 300 / 1852, 45), cog: rad(200), sog: 0 }
  const r = cpa(eu, ele)
  assert.equal(r.tcpa, Infinity)
  assert.ok(Math.abs(r.cpa - 300) < 2, `cpa ${r.cpa}`)
  assert.equal(classificar(r), 'atencao')
  assert.equal(classificar(cpa(eu, { ...ele, position: desloca(PENICHE, 1, 45) })), 'seguro')
})

test('I-09: lado a lado ao mesmo rumo e à mesma velocidade: não é colisão', () => {
  const eu = { position: PENICHE, cog: rad(30), sog: 6 * NO }
  const ele = { position: desloca(PENICHE, 0.2, 120), cog: rad(30), sog: 6 * NO }
  const r = cpa(eu, ele)
  assert.equal(r.tcpa, Infinity)
  assert.equal(classificar(r), 'atencao')
})

test('K-01: sem SOG nem COG do alvo, só a distância: perto = atenção, perto e a aproximar-se = perigo, longe = desconhecido', () => {
  const eu = { position: PENICHE, cog: 0, sog: 5 * NO }
  const r = cpa(eu, { position: desloca(PENICHE, 0.3, 0) })
  assert.equal(r.semVelocidade, 'alvo')
  assert.ok(Math.abs(r.distancia - 0.3 * 1852) < 2, `distância ${r.distancia}`)
  assert.equal(r.cpa, null)
  assert.equal(r.tcpa, null)
  assert.equal(classificar(r), 'atencao')
  assert.equal(classificar(r, LIMITES_AIS, { aproxima: true }), 'perigo')
  const longe = cpa(eu, { position: desloca(PENICHE, 2, 0) })
  assert.equal(classificar(longe, LIMITES_AIS, { aproxima: true }), 'desconhecido')
})

test('K-01: velocidade desconhecida nos dois sentidos (SOG ≥ 0,5 nó sem COG, ou sem SOG)', () => {
  const ali = desloca(PENICHE, 0.3, 0)
  assert.equal(cpa({ position: PENICHE, sog: 6 * NO }, { position: ali, cog: 0, sog: 0 }).semVelocidade, 'eu')
  assert.equal(cpa({ position: PENICHE, cog: 0, sog: 0 }, { position: ali, sog: 6 * NO }).semVelocidade, 'alvo')
  assert.equal(cpa({ position: PENICHE, cog: 0 }, { position: ali, cog: 0, sog: 0 }).semVelocidade, 'eu')
  assert.equal(cpa({ position: PENICHE }, { position: ali }).semVelocidade, 'ambos')
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
