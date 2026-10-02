'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { criarModelo, avancar, PADRAO } = require('../lib/modelo')

const MIN = 60 * 1000
// Meia-noite local, para as horas do dia baterem certo em qualquer fuso.
const MEIA_NOITE = new Date(2026, 9, 1, 0, 0, 0).getTime()

function dia (passo, opcoes = {}) {
  let m = criarModelo(opcoes, MEIA_NOITE)
  const leituras = []
  for (let i = 0; i < 24 * 60; i++) {
    const r = avancar(m, MIN, passo)
    m = r.modelo
    leituras.push(r.leitura)
  }
  return { m, leituras }
}

test('no porto, sem sol: gasta ~27 Ah por dia', () => {
  const { m } = dia({}, { fatorSolar: 0, socInicial: 0.8 })
  const gasto = 440 * 0.8 - m.ah
  assert.ok(Math.abs(gasto - 26.4) < 0.5, `gasto ${gasto}`)
})

test('a navegar, sem sol nem motor: gasta perto dos ~120 Ah do balanço (com frigorífico)', () => {
  const { m } = dia({ navegar: true, frigorifico: true }, { fatorSolar: 0, socInicial: 0.9 })
  const gasto = 440 * 0.9 - m.ah
  assert.ok(gasto > 105 && gasto < 135, `gasto ${gasto}`)
})

test('solar 2×305 W num dia de verão produz 150–230 Ah', () => {
  const { leituras } = dia({}, { socInicial: 0.5, nascer: 6.5, por: 21, horasSolPico: 6.5 })
  const ahSol = leituras.reduce((a, l) => a + (l.pv[0] + l.pv[1]) / 13.5 / 60, 0)
  assert.ok(ahSol > 150 && ahSol < 230, `sol ${ahSol}`)
})

test('dia e noite seguem o nascer e o pôr do sol', () => {
  const { leituras } = dia({})
  assert.equal(leituras[6 * 60].modo, 'night') // 06:01
  assert.equal(leituras[12 * 60].modo, 'day')
  assert.equal(leituras[21 * 60].modo, 'night')
})

test('motor auto liga a 55% e desliga a 85%', () => {
  let m = criarModelo({ fatorSolar: 0, socInicial: 0.56 }, MEIA_NOITE)
  const estados = []
  for (let i = 0; i < 48 * 60; i++) {
    const r = avancar(m, MIN, { navegar: true, motor: 'auto' })
    if (r.modelo.motor !== m.motor) estados.push([r.modelo.motor, Math.round(r.leitura.soc * 100)])
    m = r.modelo
  }
  assert.deepEqual(estados.slice(0, 2), [[true, 55], [false, 85]])
})

test('AGM: acima de 80% a corrente de carga cai', () => {
  let m = criarModelo({ fatorSolar: 0, socInicial: 0.95 }, MEIA_NOITE)
  const r = avancar(m, MIN, { motor: true })
  assert.ok(r.leitura.corrente < PADRAO.alternadorA - PADRAO.consumoPortoA - 10)
  m = criarModelo({ fatorSolar: 0, socInicial: 0.6 }, MEIA_NOITE)
  const r2 = avancar(m, MIN, { motor: true })
  assert.ok(Math.abs(r2.leitura.corrente - (PADRAO.alternadorA - PADRAO.consumoPortoA)) < 0.01)
})

// Auditoria M-69: o motor do simulador cruza às rotações de cruzeiro da rota (2100 rpm).
test('M-69: o motor do simulador anda a 2100 rpm (35 Hz)', () => {
  const m = criarModelo({}, MEIA_NOITE)
  assert.equal(avancar(m, MIN, { motor: true }).leitura.rpm * 60, 2100)
})

test('bateria do motor: 14,2 V com o motor ligado, valor do passo em repouso', () => {
  const m = criarModelo({}, MEIA_NOITE)
  assert.equal(avancar(m, MIN, { motor: true }).leitura.vMotor, 14.2)
  assert.equal(avancar(m, MIN, { vMotor: 12.0 }).leitura.vMotor, 12.0)
})
