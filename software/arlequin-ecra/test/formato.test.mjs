import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../public/lib/formato.js'

test('conversões SI', () => {
  assert.equal(f.nos(1), 1.9438444924406046)
  assert.equal(f.graus(Math.PI), 180)
  assert.equal(f.celsius(373.15), 100)
  assert.equal(f.hpa(101325), 1013.25)
  assert.equal(f.mn(1852), 1)
})

test('números com vírgula e — quando falta', () => {
  assert.equal(f.num(5.94, 1), '5,9')
  assert.equal(f.num(null, 1), '—')
  assert.equal(f.num(undefined), '—')
  assert.equal(f.num(NaN), '—')
  assert.equal(f.num(1243, 0), '1243')
  assert.equal(f.num(-0.04, 1), '0,0')
})

test('rumos com 3 dígitos e 0–359', () => {
  assert.equal(f.rumo(0.6109), '035°')
  assert.equal(f.rumo(-0.1), '354°')
  assert.equal(f.rumo(2 * Math.PI), '000°')
  assert.equal(f.rumo(null), '—')
})

test('ângulo de vento com bordo', () => {
  assert.equal(f.anguloBordo(-1.0123), '58° BB')
  assert.equal(f.anguloBordo(0.7), '40° EB')
  assert.equal(f.anguloBordo(null), '—')
})

test('velocidade em nós, distância em MN, duração', () => {
  assert.equal(f.velocidade(3.0), '5,8')
  assert.equal(f.distancia(5741.2), '3,1')
  assert.equal(f.duracao(2040), '34 min')
  assert.equal(f.duracao(3 * 3600 + 5 * 60), '3 h 05')
  assert.equal(f.duracao(null), '—')
})

test('auditoria M-36: a duração arredonda primeiro os minutos totais — nunca "60 min" nem "1 h 60"', () => {
  assert.equal(f.duracao(3599), '1 h 00')
  assert.equal(f.duracao(3570), '1 h 00')
  assert.equal(f.duracao(3540), '59 min')
  assert.equal(f.duracao(7199), '2 h 00')
  assert.equal(f.duracao(5399), '1 h 30')
  assert.equal(f.duracao(29), '0 min')
  assert.equal(f.duracao(0), '0 min')
})

import { polarSvg } from '../public/lib/desenho.js'
import { readFileSync } from 'node:fs'
import { lerPolar } from '../public/lib/polar.js'
test('auditoria M-37: acima de 20 nós a curva da polar é a da coluna dos 20 nós (não a dos 6)', () => {
  const p = lerPolar(readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8'))
  const curva = (tws) => polarSvg(p, tws).match(/<polyline points="([^"]+)"/)[1]
  assert.equal(curva(25), curva(20))
  assert.notEqual(curva(25), curva(6))
  assert.equal(curva(4), curva(6), 'abaixo dos 6 nós, a dos 6')
})

// auditoria I-31 (decisão do Ivo n.º 22): a hora do ecrã é sempre a de Lisboa, seja qual for o fuso do Pi
// (antes: a hora local do browser — o teste construía a data no fuso da máquina)
test('hora de Lisboa HH:MM (verão UTC+1, inverno UTC+0), nunca a do fuso do browser', () => {
  assert.equal(f.hora(new Date(Date.parse('2026-09-29T13:32:00Z'))), '14:32')
  assert.equal(f.hora(new Date(Date.parse('2026-12-01T13:32:00Z'))), '13:32')
  assert.equal(f.hora(new Date(Date.parse('2026-07-14T23:30:00Z'))), '00:30')
  assert.equal(f.hora(new Date(NaN)), '—')
})

import { litrosPorMilha } from '../public/lib/consumo-milha.js'
test('litros por milha no ecrã', () => {
  assert.ok(Math.abs(litrosPorMilha(2.0, 5 * 1852 / 3600) - 0.4) < 1e-9)
  assert.equal(litrosPorMilha(2.0, 0.1), null)
})
