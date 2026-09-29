'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novaSaidas, atualizar } = require('../lib/saidas')
const { PORTOS, distanciaMn } = require('../lib/geo')

const NO = 1852 / 3600
const ALGES = PORTOS.find(p => p.nome.startsWith('Algés'))
const CASCAIS = PORTOS.find(p => p.nome === 'Cascais')
const ponto = (f) => ({ latitude: ALGES.lat + (CASCAIS.lat - ALGES.lat) * f, longitude: ALGES.lon + (CASCAIS.lon - ALGES.lon) * f })

test('Algés → Cascais: 30 min a motor, 1 h à vela, pára 10 min → resumo', () => {
  let s = novaSaidas()
  let t = Date.UTC(2026, 8, 29, 13, 0, 0)
  let terminada = null
  const passo = (a) => { const r = atualizar(s, { t, ...a }, PORTOS); s = r.s; if (r.terminada) terminada = r.terminada; t += 10000 }
  for (let i = 0; i < 30; i++) passo({ pos: ponto(0), sog: 0, motor: false, soc: 0.95 }) // 5 min no porto
  assert.equal(s.emCurso, null)
  const total = 540 // 90 min em passos de 10 s
  const mn = distanciaMn(ALGES, CASCAIS)
  const sog = mn / 1.5 * NO
  for (let i = 1; i <= total; i++) passo({ pos: ponto(i / total), sog, motor: i <= 180, litrosHora: i <= 180 ? 1.3 : undefined, soc: 0.9 })
  assert.ok(s.emCurso, 'a saída começou')
  for (let i = 0; i < 62; i++) passo({ pos: ponto(1), sog: 0, motor: false, soc: 0.9 }) // 10 min e pouco parado
  assert.ok(terminada, 'a saída terminou')
  assert.equal(terminada.de, 'Algés (CNA)')
  assert.equal(terminada.para, 'Cascais')
  assert.ok(terminada.milhas > mn - 0.7 && terminada.milhas < mn - 0.3, `milhas ${terminada.milhas} (reta ${mn})`)
  assert.ok(terminada.horasMotor > 0.38 && terminada.horasMotor < 0.45, `motor ${terminada.horasMotor}`)
  assert.ok(terminada.horasVela > 0.95 && terminada.horasVela < 1.02, `vela ${terminada.horasVela}`)
  assert.ok(Math.abs(terminada.gasoleoL - 1.3 * terminada.horasMotor) < 0.03)
  assert.equal(terminada.socFim, 0.9)
  assert.equal(terminada.simulado, false)
  assert.equal(s.emCurso, null)
  assert.equal(s.ultimoPorto, 'Cascais')
})

test('buracos de mais de 6 min não somam; simulado marca a saída toda', () => {
  let s = novaSaidas()
  const longe = { latitude: 39.0, longitude: -9.6 }
  s = atualizar(s, { t: 0, pos: longe, sog: 3, motor: true, simulado: true }, PORTOS).s
  s = atualizar(s, { t: 3600000, pos: longe, sog: 3, motor: true }, PORTOS).s
  assert.equal(s.emCurso.horasMotor, 0)
  assert.equal(s.emCurso.simulado, true)
})
