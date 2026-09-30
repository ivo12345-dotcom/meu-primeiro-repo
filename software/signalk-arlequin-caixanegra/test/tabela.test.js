'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const est = require('../lib/estavel')
const tabela = require('../lib/tabela')

const NO = 1852 / 3600
const GRAU = Math.PI / 180

function janelaDe (segundos, proaGraus) {
  const j = est.novaJanela()
  for (let s = 0; s <= segundos; s++) est.juntar(j, { t: s * 1000, proa: proaGraus(s) * GRAU, stw: 5 * NO, tws: (12 + (s === 30 ? 6 : 0)) * NO })
  return j
}

test('estável: 2 min com a proa firme, longe do porto', () => {
  const j = janelaDe(125, () => 90 + Math.sin(0.3) * 3)
  assert.equal(est.estavel(j, { longeDoPorto: true }), true)
  assert.equal(est.estavel(j, { longeDoPorto: false }), false)
})

test('a janela só guarda 120 s e a rajada é o máximo nela', () => {
  const j = janelaDe(125, () => 90)
  assert.ok(j[j.length - 1].t - j[0].t <= 120000)
  const j2 = janelaDe(100, () => 90)
  assert.ok(Math.abs(est.rajada(j2) / NO - 18) < 1e-9)
})

test('não é estável: proa a variar 20°, janela curta, parado, ou sensor em falta', () => {
  assert.equal(est.estavel(janelaDe(125, (s) => 80 + (s % 40 < 20 ? 0 : 20)), { longeDoPorto: true }), false)
  assert.equal(est.estavel(janelaDe(90, () => 90), { longeDoPorto: true }), false)
  const parado = est.novaJanela()
  for (let s = 0; s <= 125; s++) est.juntar(parado, { t: s * 1000, proa: 1, stw: 0.3, tws: 5 })
  assert.equal(est.estavel(parado, { longeDoPorto: true }), false)
  const semVento = est.novaJanela()
  for (let s = 0; s <= 125; s++) est.juntar(semVento, { t: s * 1000, proa: 1, stw: 3, tws: undefined })
  assert.equal(est.estavel(semVento, { longeDoPorto: true }), false)
})

test('estável a passar pelo Norte (355° → 5°)', () => {
  const j = janelaDe(125, (s) => (355 + (s % 10)) % 360) // 355°…359°, 0°…4°
  assert.equal(est.estavel(j, { longeDoPorto: true }), true)
})

test('linha da tabela em unidades de gente; vazio quando falta', () => {
  const valores = {
    'navigation.position': { latitude: 39.123456, longitude: -9.5 },
    'navigation.headingTrue': 350 * GRAU,
    'navigation.speedOverGround': 5 * NO,
    'navigation.speedThroughWater': 4.5 * NO,
    'environment.wind.speedTrue': 15 * NO,
    'environment.wind.angleTrueWater': -60 * GRAU,
    'environment.wind.directionTrue': 290 * GRAU,
    'navigation.attitude': { roll: -12 * GRAU, pitch: 2 * GRAU },
    'environment.outside.pressure': 101250,
    'propulsion.main.revolutions': 0,
    'sails.grande.rizos': 1,
    'sails.genoa.percentagem': 70,
    'electrical.batteries.servico.capacity.stateOfCharge': 0.92
  }
  const texto = tabela.linha({ v: (c) => valores[c], agora: Date.UTC(2026, 8, 29, 14, 0, 0), rajadaMs: 20 * NO, simulado: false, estavel: true })
  const campos = Object.fromEntries(tabela.COLUNAS.map((c, i) => [c, texto.split(',')[i]]))
  assert.equal(campos.t, '2026-09-29T14:00:00.000Z')
  assert.equal(campos.lat, '39.12346')
  assert.equal(campos.proa, '350.0')
  assert.equal(campos.sog, '5.00')
  assert.equal(campos.twa, '-60.0')
  assert.equal(campos.twd, '290.0')
  assert.equal(campos.rajada, '20.00')
  assert.equal(campos.adorno, '-12.0')
  assert.equal(campos.pressao, '1012.5')
  assert.equal(campos.rpm, '0')
  assert.equal(campos.grandeRizos, '1')
  assert.equal(campos.genoaPct, '70')
  assert.equal(campos.soc, '92')
  assert.equal(campos.cog, '')
  assert.equal(campos.litrosHora, '')
  assert.equal(campos.simulado, '0')
  assert.equal(campos.estavel, '1')
  assert.equal(campos.consumoMedido, '')
  assert.equal(texto.split(',').length, tabela.COLUNAS.length)
})

test('consumoMedido (a última das 25 colunas): 1 medido pelo MDI, 0 estimado pela curva, vazio sem origem', () => {
  assert.equal(tabela.COLUNAS.length, 25)
  assert.equal(tabela.COLUNAS.at(-1), 'consumoMedido')
  const col = (origem) => tabela.linha({ v: (c) => (c === 'propulsion.main.fuel.rateOrigem' ? origem : undefined), agora: 0, rajadaMs: NaN, simulado: false, estavel: false }).split(',').at(-1)
  assert.equal(col('medido'), '1')
  assert.equal(col('estimado'), '0')
  assert.equal(col(undefined), '')
  assert.equal(col(null), '')
  assert.equal(col('constructor'), '')
})

test('um valor null do SignalK (desconhecido) fica em branco, nunca 0', () => {
  const valores = { 'propulsion.main.revolutions': null, 'propulsion.main.fuel.rate': null, 'navigation.speedOverGround': null }
  const texto = tabela.linha({ v: (c) => valores[c], agora: Date.UTC(2026, 8, 29, 14, 0, 0), rajadaMs: null, simulado: false, estavel: false })
  const campos = Object.fromEntries(tabela.COLUNAS.map((c, i) => [c, texto.split(',')[i]]))
  assert.equal(campos.rpm, '')
  assert.equal(campos.litrosHora, '')
  assert.equal(campos.sog, '')
  assert.equal(campos.rajada, '')
})

test('ficheiro por dia: cabeçalho só no início, dia novo → ficheiro novo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-tabela-'))
  const d1 = Date.UTC(2026, 8, 29, 23, 59, 50)
  tabela.escrever(dir, d1, 'a')
  tabela.escrever(dir, d1 + 5000, 'b')
  tabela.escrever(dir, d1 + 15000, 'c')
  const ler = (n) => zlib.gunzipSync(fs.readFileSync(path.join(dir, n))).toString('utf8').trim().split('\n')
  assert.deepEqual(ler('2026-09-29.csv.gz'), [tabela.COLUNAS.join(','), 'a', 'b'])
  assert.deepEqual(ler('2026-09-30.csv.gz'), [tabela.COLUNAS.join(','), 'c'])
})
