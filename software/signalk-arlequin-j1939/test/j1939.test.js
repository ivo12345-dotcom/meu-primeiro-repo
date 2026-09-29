'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { partesId, lerLinha, descodificar, construirId, linhaCandump } = require('../lib/j1939')

const hex = (s) => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)))
const valor = (vals, path) => vals.find(v => v.path === path)?.value

test('ID de 29 bits: PDU2 (PGN com grupo), prioridade e origem', () => {
  assert.deepEqual(partesId(0x18FEEE00), { prioridade: 6, pgn: 65262, origem: 0, destino: 255 })
  assert.deepEqual(partesId(0x0CF00400), { prioridade: 3, pgn: 61444, origem: 0, destino: 255 })
})

test('ID de 29 bits: PDU1 (PF < 240) tira o destino do PGN', () => {
  // TP.CM (60416 = 0xEC00) do 0x00 para o 0xFF
  assert.deepEqual(partesId(0x1CECFF00), { prioridade: 7, pgn: 60416, origem: 0, destino: 255 })
  assert.deepEqual(partesId(0x18EA2100), { prioridade: 6, pgn: 59904, origem: 0, destino: 0x21 })
})

test('linha do candump -L', () => {
  const t = lerLinha('(1727600000.123456) can1 18FEEE00#6EFFFFFFFFFFFFFF')
  assert.equal(t.pgn, 65262)
  assert.equal(t.origem, 0)
  assert.equal(t.t, 1727600000123)
  assert.deepEqual([...t.dados], [0x6e, 255, 255, 255, 255, 255, 255, 255])
  assert.equal(lerLinha('lixo'), null)
  assert.equal(lerLinha('(1.0) can1 123#00'), null) // ID de 11 bits: não é J1939
})

test('construir e ler dão o mesmo', () => {
  const l = linhaCandump({ t: 1727600000000, pgn: 61444, origem: 0, prioridade: 3, dados: hex('FFFFFF803EFFFFFF') })
  assert.equal(l, '(1727600000.000000) can1 0CF00400#FFFFFF803EFFFFFF')
  assert.equal(lerLinha(l).pgn, 61444)
  assert.equal(construirId(3, 65262, 0), 0x0CFEEE00)
})

test('EEC1 61444: rotações (0,125 rpm/bit), como no projeto aberto', () => {
  // 0x3E80 = 16000 × 0,125 = 2000 rpm; projeto aberto: (Data[4]*256 + Data[3]) / 8
  const v = descodificar(61444, hex('FFFFFF803EFFFFFF'))
  assert.ok(Math.abs(valor(v, 'propulsion.main.revolutions') - 2000 / 60) < 1e-9)
  assert.deepEqual(descodificar(61444, hex('FFFFFFFFFFFFFFFF')), [])
})

test('HOURS 65253: 4 bytes a 0,05 h (não rebenta aos 3276 h)', () => {
  // 1243,5 h = 24870 → 0x00006126
  assert.equal(valor(descodificar(65253, hex('26610000FFFFFFFF')), 'propulsion.main.runTime'), 1243.5 * 3600)
  // 5000 h = 100000 = 0x000186A0: o projeto aberto (2 bytes) dava 1726,8 h
  assert.equal(valor(descodificar(65253, hex('A0860100FFFFFFFF')), 'propulsion.main.runTime'), 5000 * 3600)
  assert.deepEqual(descodificar(65253, hex('FFFFFFFFFFFFFFFF')), [])
})

test('ET1 65262: água (°C − 40) e óleo (0,03125 °C − 273)', () => {
  const v = descodificar(65262, hex('7AFF2029FFFFFFFF'))
  assert.equal(valor(v, 'propulsion.main.temperature'), (0x7a - 40) + 273.15) // 82 °C
  // 0x2920 = 10528 × 0,03125 − 273 = 56 °C
  assert.ok(Math.abs(valor(v, 'propulsion.main.oilTemperature') - (56 + 273.15)) < 1e-9)
  const so = descodificar(65262, hex('6EFFFFFFFFFFFFFF'))
  assert.equal(so.length, 1)
  assert.equal(valor(so, 'propulsion.main.temperature'), 70 + 273.15)
})

test('EFL/P1 65263: pressão do óleo 4 kPa/bit; o D1 não manda (FF)', () => {
  assert.equal(valor(descodificar(65263, hex('FFFFFF57FFFFFFFF')), 'propulsion.main.oilPressure'), 0x57 * 4000)
  assert.deepEqual(descodificar(65263, hex('FFFFFFFFFFFFFFFF')), [])
})

test('LFE 65266: consumo 0,05 L/h → m³/s', () => {
  // 40 × 0,05 = 2 L/h
  const v = descodificar(65266, hex('2800FFFFFFFFFFFF'))
  assert.ok(Math.abs(valor(v, 'propulsion.main.fuel.rate') - 2 / 3600 / 1000) < 1e-15)
})

test('VEP1 65271: usa a primeira tensão disponível (167, 168, 158)', () => {
  // só a 158 (bytes 7–8), como o MDI: 0x011C = 284 × 0,05 = 14,2 V; projeto aberto: (Data[7]*256 + Data[6]) / 20
  assert.ok(Math.abs(valor(descodificar(65271, hex('FFFFFFFFFFFF1C01')), 'propulsion.main.alternatorVoltage') - 14.2) < 1e-9)
  // 167 presente (bytes 3–4) ganha: 0x0104 = 260 × 0,05 = 13,0 V
  assert.ok(Math.abs(valor(descodificar(65271, hex('FFFF0401FFFF1C01')), 'propulsion.main.alternatorVoltage') - 13.0) < 1e-9)
  assert.deepEqual(descodificar(65271, hex('FFFFFFFFFFFFFFFF')), [])
})

test('PGN desconhecida: nada', () => {
  assert.deepEqual(descodificar(65417, hex('0300000000000000')), [])
})
