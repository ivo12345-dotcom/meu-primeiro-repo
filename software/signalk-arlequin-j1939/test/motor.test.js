'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { litrosHora, CURVA } = require('../lib/consumo')
const { novoEstadoMotor, avaliarMotor } = require('../lib/motor')
const { novaDescoberta, registar, alarmesDoMapa } = require('../lib/descoberta')

const MIN = 60000
const K = 273.15
const T0 = 1_727_600_000_000

test('consumo: pontos da curva Volvo Penta e interpolação', () => {
  assert.equal(litrosHora(2400), 2.0)
  assert.equal(litrosHora(1800), 1.0)
  assert.equal(litrosHora(3200), 4.6)
  assert.ok(Math.abs(litrosHora(2500) - 2.2) < 1e-9)
  assert.equal(litrosHora(3500), 4.6) // acima do nominal: prende
  assert.equal(litrosHora(700), 0.4) // ralenti (extrapolado)
  assert.equal(litrosHora(100), 0) // parado
  assert.ok(Math.abs(litrosHora(2400, 1.1) - 2.2) < 1e-9) // fator de calibração
  assert.equal(CURVA[0][0], 850)
})

function correr (passos) {
  let e = novoEstadoMotor()
  const todas = []
  const estados = []
  for (const [agora, l] of passos) {
    const r = avaliarMotor(e, l, agora)
    e = r.estado
    todas.push(...r.notificacoes.map(n => ({ ...n, agora })))
    if (r.estadoMudou) estados.push(r.estadoMudou)
  }
  return { e, todas, estados }
}

test('estado ligado/parado com histerese (300/200 rpm)', () => {
  const { estados } = correr([
    [T0, { rpm: 0 }], [T0 + 1000, { rpm: 250 }], [T0 + 2000, { rpm: 850 }],
    [T0 + 3000, { rpm: 250 }], [T0 + 4000, { rpm: 150 }]
  ])
  assert.deepEqual(estados, ['started', 'stopped'])
})

test('sobreaquecimento: alarme a 95 °C, limpa abaixo de 92 °C', () => {
  const { todas } = correr([
    [T0, { rpm: 2400, temp: 94 + K }], [T0 + 1000, { rpm: 2400, temp: 95 + K }],
    [T0 + 2000, { rpm: 2400, temp: 93 + K }], [T0 + 3000, { rpm: 2400, temp: 91 + K }]
  ])
  const t = todas.filter(n => n.id === 'overTemperature')
  assert.deepEqual(t.map(n => n.state), ['alarm', 'normal'])
  assert.deepEqual(t[0].method, ['visual', 'sound'])
  assert.match(t[0].message, /95 °C/)
})

test('alternador não carrega: só com o motor ligado há 2 min e < 13,0 V', () => {
  const { todas } = correr([
    [T0, { rpm: 2000, volt: 12.4 }],
    [T0 + MIN, { rpm: 2000, volt: 12.4 }],
    [T0 + 2 * MIN, { rpm: 2000, volt: 12.4 }],
    [T0 + 3 * MIN, { rpm: 2000, volt: 13.1 }],
    [T0 + 4 * MIN, { rpm: 2000, volt: 13.4 }]
  ])
  const a = todas.filter(n => n.id === 'alternadorNaoCarrega')
  assert.deepEqual(a.map(n => [n.state, (n.agora - T0) / MIN]), [['warn', 2], ['normal', 4]])
  assert.match(a[0].message, /12,4 V/)
})

test('alternador: parar o motor limpa o aviso', () => {
  const { todas } = correr([
    [T0, { rpm: 2000, volt: 12.4 }], [T0 + 2 * MIN, { rpm: 2000, volt: 12.4 }], [T0 + 3 * MIN, { rpm: 0, volt: 12.4 }]
  ])
  assert.deepEqual(todas.filter(n => n.id === 'alternadorNaoCarrega').map(n => n.state), ['warn', 'normal'])
})

const hex = (s) => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)))

test('descoberta: regista só as mudanças da 65417 e diz que bits mudaram', () => {
  let d = novaDescoberta()
  const mudancas = []
  for (const [t, b, rpm] of [[1, '0300000000000000', 0], [2, '0300000000000000', 0], [3, '0000000000000000', 900], [4, '0000000000000000', 900]]) {
    const r = registar(d, { t, pgn: 65417, origem: 0, dados: hex(b) }, rpm)
    d = r.d
    if (r.mudou) mudancas.push(r.mudou)
  }
  assert.equal(mudancas.length, 2)
  assert.equal(mudancas[0].bytes, '03 00 00 00 00 00 00 00')
  assert.deepEqual(mudancas[1].bitsMudados, ['byte0.bit0 1→0', 'byte0.bit1 1→0'])
  assert.equal(mudancas[1].rpm, 900)
  assert.equal(d.vistas[65417].n, 4)
})

test('descoberta: conta todas as PGN vistas, mas só guarda mudanças das proprietárias', () => {
  let d = novaDescoberta()
  const r1 = registar(d, { t: 1, pgn: 61444, origem: 0, dados: hex('FFFFFF803EFFFFFF') }, 2000)
  d = r1.d
  const r2 = registar(d, { t: 2, pgn: 61444, origem: 0, dados: hex('FFFFFF003FFFFFFF') }, 2016)
  assert.equal(r2.mudou, null)
  assert.equal(r2.d.vistas[61444].n, 2)
})

test('mapa de bits → alarmes do MDI', () => {
  const mapa = [{ byte: 0, bit: 0, id: 'lowOilPressure', mensagem: 'Pressão de óleo baixa' }, { byte: 0, bit: 1, id: 'lowSystemVoltage', mensagem: 'Carga da bateria', estado: 'warn' }]
  const r1 = alarmesDoMapa(mapa, hex('0300000000000000'), {})
  assert.deepEqual(r1.notificacoes.map(n => [n.id, n.state]), [['lowOilPressure', 'alarm'], ['lowSystemVoltage', 'warn']])
  const r2 = alarmesDoMapa(mapa, hex('0200000000000000'), r1.ativos)
  assert.deepEqual(r2.notificacoes.map(n => [n.id, n.state]), [['lowOilPressure', 'normal']])
  assert.deepEqual(alarmesDoMapa(mapa, hex('0200000000000000'), r2.ativos).notificacoes, [])
})
