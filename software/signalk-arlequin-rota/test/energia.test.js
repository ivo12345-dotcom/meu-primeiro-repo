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

// Decisão do Ivo n.º 4 (auditoria I-13, 02/10): o banco de serviço é o de 440 Ah (bancos 2 + 3, o do
// SmartShunt, cujo SoC a rota recebe) e o solar entra com perdas (fator 0,65, como o simulador).
test('valores do barco (decisão n.º 4; solar 2 × 625 W desde 06/10): 440 Ah, 4,5 A de dia, 6 A de noite, 2 × 2,7 m² a 23% × 0,65 de perdas, 12,7 V, alternador 45 A', () => {
  assert.deepEqual({ ...PADRAO }, { capacidadeAh: 440, socInicial: 1, consumoDiaA: 4.5, consumoNoiteA: 6, paineis: 2, areaPainelM2: 2.7, rendimento: 0.23, fatorSolar: 0.65, tensaoV: 12.7, alternadorA: 45 })
  quase(solarA(PADRAO, 1000), 1000 * 5.4 * 0.23 * 0.65 / 12.7) // ~64 A ao sol a pino (sem perdas eram ~98 A; com os 2 × 305 W de antes, ~34 A)
  assert.equal(solarA(PADRAO, null), 0)
  assert.equal(solarA(PADRAO, -5), 0)
  // a mesma coisa que o simulador (arlequin-simulador/lib/modelo.js): 440 Ah e fatorSolar 0,65
  const sim = require('../../arlequin-simulador/lib/modelo').PADRAO
  assert.equal(PADRAO.capacidadeAh, sim.capacidadeAh)
  assert.equal(PADRAO.fatorSolar, sim.fatorSolar)
})

test('a sonda da auditoria (E-I2): uma noite de 12 h a navegar desde 80 % chega a ~64 % (com 200 Ah dava 44 % e excluía)', () => {
  const e = criarEnergia({ socInicial: 0.8 })
  const r = correr(e, e.inicio(0), 12 * 60, { motor: false, noite: true })
  quase(r.soc, (352 - 72) / 440, 1e-9) // 63,6 %, como o simulador e o NAVEGACAO
  assert.ok(r.soc * 100 >= 50)
  // com o banco antigo (só se passado à mão) a mesma noite dava 44 %
  const velho = criarEnergia({ socInicial: 0.8, capacidadeAh: 200 })
  quase(correr(velho, velho.inicio(0), 12 * 60, { motor: false, noite: true }).soc, 0.44, 1e-9)
})

test('sem sol nem motor: 4,5 Ah por hora de dia e 6 de noite, de minuto a minuto', () => {
  const e = criarEnergia({ socInicial: 0.8 })
  const s0 = e.inicio(0)
  assert.equal(s0.ah, 352)
  quase(correr(e, s0, 60, { motor: false, noite: false, w: { radiacao: 0 } }).estado.ah, 347.5, 1e-6)
  const noite = correr(e, s0, 120, { motor: false, noite: true, w: { radiacao: 400 } }) // de noite o solar não conta
  quase(noite.estado.ah, 340, 1e-6)
  quase(noite.soc, 340 / 440, 1e-9)
  assert.equal(noite.estado.t, 120 * MIN)
})

test('solar pela radiação (com as perdas) e alternador com o motor; fica entre 0 e 100%', () => {
  const e = criarEnergia()
  const s = e.inicio(0, 0.5)
  const r = e.passo(s, { dtMs: H, motor: false, noite: false, w: { radiacao: 500 } })
  quase(r.solar, 500 * 5.4 * 0.23 * 0.65 / 12.7) // 2 × 625 W (06/10): 2 × 2,7 m² a 23 %
  quase(r.estado.ah, 220 + r.solar - 4.5)
  quase(e.passo(s, { dtMs: H, motor: true, noite: true, radiacao: 0 }).estado.ah, 220 + 45 - 6)
  assert.equal(correr(e, e.inicio(0, 0.99), 600, { motor: true, noite: false }).soc, 1)
  assert.equal(correr(criarEnergia({ capacidadeAh: 10 }), { ah: 0.05 }, 60, { motor: false, noite: true }).soc, 0)
  // sem perdas (fatorSolar 1) é o de antes
  quase(solarA({ ...PADRAO, fatorSolar: 1 }, 500), 500 * 5.4 * 0.23 / 12.7)
})

test('tudo configurável (e os null ficam no valor por omissão)', () => {
  const e = criarEnergia({ capacidadeAh: 400, consumoDiaA: 3, alternadorA: 60, tensaoV: null, fatorSolar: null })
  assert.equal(e.config.tensaoV, 12.7)
  assert.equal(e.config.fatorSolar, 0.65)
  const r = e.passo(e.inicio(0, 0.5), { dtMs: H, motor: true, noite: false, w: {} })
  quase(r.estado.ah, 200 + 60 - 3)
  assert.equal(criarEnergia({ fatorSolar: 0.5 }).config.fatorSolar, 0.5)
})
