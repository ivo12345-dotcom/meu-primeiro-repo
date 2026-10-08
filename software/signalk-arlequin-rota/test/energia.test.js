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

// Decisão do Ivo de 08/10 (depois das fotos): o banco de serviço é o par Tudor TK960 AGM, 2 × 96 Ah = 192 Ah
// (576 quando as 4 novas entrarem; até 08/10 contava-se 440, decisão n.º 4) e o solar entra com perdas
// (fator 0,65, como o simulador).
test('valores do barco (08/10; solar 2 × 625 W Yingli desde 06/10): 192 Ah, 4,5 A de dia, 6 A de noite, 2 × 2,8 m² a 22,4% × 0,65 de perdas, 12,7 V, alternador 45 A', () => {
  assert.deepEqual({ ...PADRAO }, { capacidadeAh: 192, socInicial: 1, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 2.8, rendimento: 0.224, fatorSolar: 0.65, tensaoV: 12.7, alternadorA: 45 })
  quase(solarA(PADRAO, 1000), 1000 * 5.6 * 0.224 * 0.65 / 12.7) // ~64 A ao sol a pino (sem perdas eram ~99 A; com os 2 × 305 W de antes, ~34 A)
  assert.equal(solarA(PADRAO, null), 0)
  assert.equal(solarA(PADRAO, -5), 0)
  // a mesma coisa que o simulador (arlequin-simulador/lib/modelo.js): 192 Ah e fatorSolar 0,65
  const sim = require('../../arlequin-simulador/lib/modelo').PADRAO
  assert.equal(PADRAO.capacidadeAh, sim.capacidadeAh)
  assert.equal(PADRAO.fatorSolar, sim.fatorSolar)
})

test('a sonda da auditoria (E-I2): uma noite de 12 h a navegar desde 80 % chega a 42,5 % com os 192 Ah reais (com 440 dava 63,6 %; com 576, as 4 novas, dá 67,5 %)', () => {
  const e = criarEnergia({ socInicial: 0.8 })
  const r = correr(e, e.inicio(0), 12 * 60, { motor: false, noite: true })
  quase(r.soc, (153.6 - 72) / 192, 1e-9) // 42,5 %: abaixo dos 50 % da regra; é a consequência do banco pequeno até as 4 novas entrarem
  assert.ok(r.soc * 100 < 50)
  const grande = criarEnergia({ socInicial: 0.8, capacidadeAh: 576 })
  quase(correr(grande, grande.inicio(0), 12 * 60, { motor: false, noite: true }).soc, (460.8 - 72) / 576, 1e-9) // 67,5 % com as 4 novas
  // com o banco antigo (só se passado à mão) a mesma noite dava 44 %
  const velho = criarEnergia({ socInicial: 0.8, capacidadeAh: 200 })
  quase(correr(velho, velho.inicio(0), 12 * 60, { motor: false, noite: true }).soc, 0.44, 1e-9)
})

test('sem sol nem motor: 4,5 Ah por hora de dia e 6 de noite, de minuto a minuto', () => {
  const e = criarEnergia({ socInicial: 0.8 })
  const s0 = e.inicio(0)
  quase(s0.ah, 153.6, 1e-9)
  quase(correr(e, s0, 60, { motor: false, noite: false, w: { radiacao: 0 } }).estado.ah, 149.1, 1e-6)
  const noite = correr(e, s0, 120, { motor: false, noite: true, w: { radiacao: 400 } }) // de noite o solar não conta
  quase(noite.estado.ah, 141.6, 1e-6)
  quase(noite.soc, 141.6 / 192, 1e-9)
  assert.equal(noite.estado.t, 120 * MIN)
})

test('solar pela radiação (com as perdas) e alternador com o motor; fica entre 0 e 100%', () => {
  const e = criarEnergia()
  const s = e.inicio(0, 0.5)
  const r = e.passo(s, { dtMs: H, motor: false, noite: false, w: { radiacao: 500 } })
  quase(r.solar, 500 * 5.6 * 0.224 * 0.65 / 12.7) // 2 × 625 W Yingli (06/10): 2 × 2,8 m² a 22,4 %
  quase(r.estado.ah, 96 + r.solar - 4.5)
  quase(e.passo(s, { dtMs: H, motor: true, noite: true, radiacao: 0 }).estado.ah, 96 + 45 - 6)
  assert.equal(correr(e, e.inicio(0, 0.99), 600, { motor: true, noite: false }).soc, 1)
  assert.equal(correr(criarEnergia({ capacidadeAh: 10 }), { ah: 0.05 }, 60, { motor: false, noite: true }).soc, 0)
  // sem perdas (fatorSolar 1) é o de antes
  quase(solarA({ ...PADRAO, fatorSolar: 1 }, 500), 500 * 5.6 * 0.224 / 12.7)
})

test('tudo configurável (e os null ficam no valor por omissão)', () => {
  const e = criarEnergia({ capacidadeAh: 400, consumoDiaA: 3, alternadorA: 60, tensaoV: null, fatorSolar: null })
  assert.equal(e.config.tensaoV, 12.7)
  assert.equal(e.config.fatorSolar, 0.65)
  const r = e.passo(e.inicio(0, 0.5), { dtMs: H, motor: true, noite: false, w: {} })
  quase(r.estado.ah, 200 + 60 - 3)
  assert.equal(criarEnergia({ fatorSolar: 0.5 }).config.fatorSolar, 0.5)
})
