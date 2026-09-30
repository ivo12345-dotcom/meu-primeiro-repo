'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const prev = require('../lib/previsao')
const m = require('../lib/mare')

const H = 3600000
const MIN = 60000
const T = 12.42 * H

test('preia-mares de uma sinusoide horária: as horas certas a menos de 1 min, a altura a 1 cm', () => {
  const hw0 = Date.UTC(2026, 8, 29, 3, 17, 30)
  const t = []; const y = []
  for (let i = 0; i < 72; i++) { t.push(Date.UTC(2026, 8, 29) + i * H); y.push(0.1 + 1.5 * Math.cos(2 * Math.PI * (t[i] - hw0) / T)) }
  const pms = m.preiaMares(t, y)
  assert.equal(pms.length, 6)
  pms.forEach((p, k) => {
    assert.ok(Math.abs(p.t - (hw0 + k * T)) < MIN, `preia-mar ${k}: ${(p.t - hw0 - k * T) / MIN} min`)
    assert.ok(Math.abs(p.altura - 1.6) < 0.01)
  })
  // nulls e ruído: um máximo pequeno a 2 h de um maior não conta; buracos saltam-se
  const y2 = y.slice(); y2[20] = null; y2[21] = null
  assert.equal(m.preiaMares(t, y2).length, 6)
  assert.deepEqual(m.preiaMares([0, H, 2 * H, 3 * H, 4 * H], [0, 1, 0.5, 0.9, 0]).map(p => Math.round(p.t / MIN)), [60 + 10]) // parábola por (0; 1; 0,5): 10 min depois
})

test('preia-mares de Cascais na previsão real de 29/09 (Open-Meteo, nível do mar)', () => {
  const f = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
  const p = prev.interpretar(f.pontos.map(c.P), f.forecast, f.marine, f.obtidaSimulada)
  const n = prev.nivelDoMar(p)
  const pms = m.preiaMares(n.t, n.nivel)
  assert.deepEqual(pms.map(x => new Date(x.t).toISOString().slice(0, 16)), [
    '2026-09-29T03:06', '2026-09-29T15:23', '2026-09-30T03:45', '2026-09-30T16:05', '2026-10-01T04:27', '2026-10-01T16:55'
  ])
  // a tabela de marés dava 16:37 locais (15:37 UTC) para a da tarde de 29/09: 14 min de diferença
  assert.ok(Math.abs(pms[1].t - Date.parse('2026-09-29T15:37Z')) < 20 * MIN)
  for (let i = 1; i < pms.length; i++) assert.ok(pms[i].t - pms[i - 1].t > 12 * H && pms[i].t - pms[i - 1].t < 13 * H)
})

test('corrente na barra: estofo 45 min depois da preia-mar, vazante para 250°, enchente para 70°, só a leste de 9°25\'W', () => {
  const pm = Date.UTC(2026, 8, 29, 15, 37)
  const mare = m.criarMareTejo([{ t: pm }])
  const estofo = pm + 45 * MIN
  assert.ok(mare(38.67, -9.3, estofo).v < 1e-9)
  const v1 = mare(38.67, -9.3, estofo + T / 4)
  assert.ok(Math.abs(v1.v - 1.8) < 1e-9); assert.equal(v1.dir, 250)
  const v3 = mare(38.67, -9.3, estofo + 3 * T / 4)
  assert.ok(Math.abs(v3.v - 1.8) < 1e-9); assert.equal(v3.dir, 70)
  // antes da preia-mar (fim da enchente): entra
  assert.equal(mare(38.67, -9.3, pm - H).dir, 70)
  assert.deepEqual(mare(38.67, -9.45, estofo + T / 4), { v: 0, dir: 0 })
  assert.deepEqual(m.criarMareTejo([])(38.67, -9.3, pm), { v: 0, dir: 0 })
  // com uma só preia-mar é exatamente a fórmula do simular.mjs
  for (let t = pm - 5 * H; t < pm + 20 * H; t += 7 * MIN) {
    const fase = 2 * Math.PI * (t - (pm + 45 * MIN)) / (12.42 * 3600000)
    const v = 1.8 * Math.sin(fase)
    assert.deepEqual(mare(38.68, -9.35, t), v >= 0 ? { v, dir: 250 } : { v: -v, dir: 70 })
  }
})

test('corrente com várias preia-mares: cada ciclo dura de um estofo ao seguinte', () => {
  const pms = [{ t: 0 }, { t: 12 * H }, { t: 25 * H }]
  const mare = m.criarMareTejo(pms)
  const e = (i) => pms[i].t + 45 * MIN
  assert.ok(Math.abs(mare(38.67, -9.3, e(0) + 3 * H).v - 1.8) < 1e-9) // 1/4 de um ciclo de 12 h
  assert.ok(Math.abs(mare(38.67, -9.3, e(1) + 3.25 * H).v - 1.8) < 1e-9) // 1/4 de um ciclo de 13 h
  assert.ok(mare(38.67, -9.3, e(1)).v < 1e-9)
  assert.equal(mare(38.67, -9.3, e(2) + 9 * H).dir, 70) // depois da última: 12,42 h
})
