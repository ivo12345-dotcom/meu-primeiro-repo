'use strict'
// A viagem acelerada do dev (desenho 3b-2, validação ao vivo): o barco segue o rasto provável do plano,
// com um atraso forçado a meio (parado), uma queda do barómetro e o gasóleo a descer mais do que o
// plano conta. Só as contas (sem SignalK).
const test = require('node:test')
const assert = require('node:assert/strict')
const { posicaoNoRasto, criarCenario } = require('../viagem-acelerada')

const MIN = 60000
const H = 3600000
const T0 = Date.parse('2026-10-01T16:00:00Z')
const iso = (t) => new Date(t).toISOString()
// 1 h para norte a 6 nós (0,1° de latitude), de 10 em 10 min
const RASTO = Array.from({ length: 7 }, (_, i) => ({ lat: 38.7 + i * 0.1 / 6, lon: -9.5, t: iso(T0 + i * 10 * MIN), motor: true, noite: false }))

test('posicaoNoRasto: interpolada na hora do plano, com o SOG e o rumo do troço; antes do início no 1.º ponto e depois do fim no último, parado', () => {
  const p = posicaoNoRasto(RASTO, T0 + 15 * MIN)
  assert.ok(Math.abs(p.lat - (38.7 + 0.025)) < 1e-9)
  assert.equal(p.lon, -9.5)
  assert.ok(Math.abs(p.sogNos - 6) < 0.05, p.sogNos)
  assert.ok(Math.abs(p.cog) < 1e-6)
  assert.deepEqual(posicaoNoRasto(RASTO, T0 - H), { lat: 38.7, lon: -9.5, sogNos: 0, cog: 0, fim: false })
  const f = posicaoNoRasto(RASTO, T0 + 2 * H)
  assert.equal(f.lat, RASTO.at(-1).lat)
  assert.equal(f.sogNos, 0)
  assert.equal(f.fim, true)
})

test('o cenário: parado durante o atraso forçado (a hora do plano não anda), a pressão cai e o gasóleo desce só a andar', () => {
  const c = criarCenario({ t0: T0, duracaoMs: 10 * H, atrasoEm: 0.3, atrasoMin: 60, baroEm: 0.5, baroQueda: 4, baroHoras: 2, pressao: 1015, gasoleo: 70, consumo: 2.5 })
  // antes do atraso (3 h): a hora do plano é a simulada
  let e = c(T0 + 2 * H)
  assert.equal(e.tPlano, T0 + 2 * H)
  assert.equal(e.parado, false)
  assert.equal(e.pressaoHpa, 1015)
  assert.ok(Math.abs(e.gasoleoL - (70 - 2 * 2.5)) < 1e-9)
  // no atraso: parado, a hora do plano fica nas 3 h
  e = c(T0 + 3.5 * H)
  assert.equal(e.parado, true)
  assert.equal(e.tPlano, T0 + 3 * H)
  assert.ok(Math.abs(e.gasoleoL - (70 - 3 * 2.5)) < 1e-9, 'parado não gasta')
  // depois: 60 min atrás do plano
  e = c(T0 + 5 * H)
  assert.equal(e.tPlano, T0 + 4 * H)
  // o barómetro: começa a cair às 5 h, 4 hPa em 2 h
  assert.equal(c(T0 + 6 * H).pressaoHpa, 1013)
  assert.equal(c(T0 + 8 * H).pressaoHpa, 1011)
  assert.equal(c(T0 + 9 * H).pressaoHpa, 1011)
})
