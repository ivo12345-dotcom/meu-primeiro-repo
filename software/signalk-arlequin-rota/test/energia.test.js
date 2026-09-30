'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { PADRAO, solarA, criarEnergia } = require('../lib/energia')

const H = 3600000
const MIN = 60000
const quase = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`)

// Avança de minuto a minuto (como a passagem) durante `min` minutos.
function correr (e, estado, min, ctx) {
  let r = { estado, soc: estado.ah / e.config.capacidadeAh }
  for (let i = 0; i < min; i++) r = e.passo(r.estado, { dtMs: MIN, ...ctx })
  return r
}

test('valores do desenho: 200 Ah, 4,5 A de dia, 6 A de noite, 2 × 1,65 m² a 20%, 12,7 V, alternador 45 A', () => {
  assert.deepEqual({ ...PADRAO }, { capacidadeAh: 200, socInicial: 1, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 1.65, rendimento: 0.2, tensaoV: 12.7, alternadorA: 45 })
  quase(solarA(PADRAO, 1000), 1000 * 3.3 * 0.2 / 12.7) // ~52 A, perto dos 2 × 305 W
  assert.equal(solarA(PADRAO, null), 0)
  assert.equal(solarA(PADRAO, -5), 0)
})

test('sem sol nem motor: 4,5 Ah por hora de dia e 6 de noite, de minuto a minuto', () => {
  const e = criarEnergia({ socInicial: 0.8 })
  const s0 = e.inicio(0)
  assert.equal(s0.ah, 160)
  quase(correr(e, s0, 60, { motor: false, noite: false, w: { radiacao: 0 } }).estado.ah, 155.5, 1e-6)
  const noite = correr(e, s0, 120, { motor: false, noite: true, w: { radiacao: 400 } }) // de noite o solar não conta
  quase(noite.estado.ah, 148, 1e-6)
  quase(noite.soc, 0.74, 1e-9)
  assert.equal(noite.estado.t, 120 * MIN)
})

test('solar pela radiação e alternador com o motor; fica entre 0 e 100%', () => {
  const e = criarEnergia()
  const s = e.inicio(0, 0.5)
  const r = e.passo(s, { dtMs: H, motor: false, noite: false, w: { radiacao: 500 } })
  quase(r.solar, 500 * 3.3 * 0.2 / 12.7)
  quase(r.estado.ah, 100 + r.solar - 4.5)
  quase(e.passo(s, { dtMs: H, motor: true, noite: true, radiacao: 0 }).estado.ah, 100 + 45 - 6)
  assert.equal(correr(e, e.inicio(0, 0.99), 600, { motor: true, noite: false }).soc, 1)
  assert.equal(correr(criarEnergia({ capacidadeAh: 10 }), { ah: 0.05 }, 60, { motor: false, noite: true }).soc, 0)
})

test('tudo configurável (e os null ficam no valor por omissão)', () => {
  const e = criarEnergia({ capacidadeAh: 400, consumoDiaA: 3, alternadorA: 60, tensaoV: null })
  assert.equal(e.config.tensaoV, 12.7)
  const r = e.passo(e.inicio(0, 0.5), { dtMs: H, motor: true, noite: false, w: {} })
  quase(r.estado.ah, 200 + 60 - 3)
})
