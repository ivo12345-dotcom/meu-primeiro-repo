'use strict'
// As contas da primeira escuta do motor (ouvir-motor.js), sem placas: recebem as linhas que a caixa 1
// manda ao portátil e dizem o que a caixa 2 ouviu.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { novoCenso } = require('./censo')
const { soma, escrever } = require('../../signalk-arlequin-caixas/lib/linhas')

// Uma trama do motor como a caixa 1 a escreve: a linha do candump mais a soma.
function trama (id, bytes, s = 12, us = 345) {
  const hex = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
  const corpo = `(${s}.${String(us).padStart(6, '0')}) can1 ${id.toString(16).toUpperCase().padStart(8, '0')}#${hex}`
  return `${corpo}*${soma(corpo)}`
}
const batimento2 = (ms, rssi = -58, perdidos = 0) => escrever('B', [2, ms, '0.2.1', 0, rssi, perdidos])

const ROTACOES_2100 = [0x0CF00400, [0xFF, 0xFF, 0xFF, 0xA0, 0x41, 0xFF, 0xFF, 0xFF]]
const AGUA_82 = [0x18FEEE00, [122, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]]
const TENSAO_14_2 = [0x18FEF700, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x1C, 0x01]]
const HORAS_1243_5 = [0x18FEE500, [0x26, 0x61, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]]

test('uma trama de rotações conta-se no tipo dela e dá as rotações', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(trama(...ROTACOES_2100))
  assert.equal(c.estado.tramas, 1)
  assert.match(c.resumo(), /rotações 2100/)
  const t = c.tabela()
  assert.equal(t.length, 1)
  assert.match(t[0], /61444/)
  assert.match(t[0], /rotações/)
  assert.match(t[0], /1 trama/)
  assert.match(t[0], /FF FF FF A0 41 FF FF FF/)
})

test('os valores saem nas unidades de bordo: graus, volts e horas', () => {
  const c = novoCenso({ agora: () => 0 })
  for (const x of [AGUA_82, TENSAO_14_2, HORAS_1243_5]) c.linha(trama(...x))
  const r = c.resumo()
  assert.match(r, /água 82 °C/)
  assert.match(r, /tensão 14,2 V/)
  assert.match(r, /horas 1243,5/)
})

test('o batimento da caixa 2 dá o sinal do rádio e os pacotes perdidos', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(batimento2(1000, -58, 0))
  c.linha(batimento2(2000, -61, 3))
  assert.equal(c.estado.caixa2.batimentos, 2)
  assert.equal(c.estado.caixa2.rssi, -61)
  assert.equal(c.estado.caixa2.perdidos, 3)
  assert.match(c.resumo(), /caixa 2: sinal -61, 3 perdidos/)
})

test('a caixa 2 que recomeça conta-se (o relógio dela volta atrás)', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(batimento2(50000))
  c.linha(batimento2(900))
  assert.equal(c.estado.caixa2.recomecos, 1)
  assert.match(c.resumo(), /1 recomeço/)
})

test('sem batimento da caixa 2 o resumo diz que ela não dá sinal', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(escrever('B', [1, 1000, '0.2.1', 0, 0, 0, 3, 1, 0]))
  assert.match(c.resumo(), /caixa 2: SEM SINAL/)
})

test('a caixa 2 que se cala deixa de contar como viva ao fim de 5 s', () => {
  let agora = 0
  const c = novoCenso({ agora: () => agora })
  c.linha(batimento2(1000))
  agora = 4000
  assert.match(c.resumo(), /caixa 2: sinal -58/)
  agora = 6500
  assert.match(c.resumo(), /caixa 2: SEM SINAL há 6 s/)
})

test('sem tramas o resumo diz que o motor está calado', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(batimento2(1000))
  assert.match(c.resumo(), /motor: nenhuma trama/)
})

test('um tipo de trama que não conhecemos aparece na tabela com os bytes', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(trama(0x18FF8900, [0x03, 0, 0, 0, 0, 0, 0, 0]))
  c.linha(trama(0x18FF8900, [0x00, 0, 0, 0, 0, 0, 0, 0]))
  const t = c.tabela()
  assert.equal(t.length, 1)
  assert.match(t[0], /65417/)
  assert.match(t[0], /2 tramas/)
  assert.match(t[0], /2 valores diferentes/)
  assert.match(t[0], /00 00 00 00 00 00 00 00/)
})

test('a tabela separa o mesmo tipo vindo de aparelhos diferentes e ordena por tipo', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha(trama(0x18FEEE11, AGUA_82[1]))
  c.linha(trama(...AGUA_82))
  c.linha(trama(...ROTACOES_2100))
  const t = c.tabela()
  assert.equal(t.length, 3)
  assert.match(t[0], /61444/)
  assert.match(t[1], /65262.*aparelho 0\b/)
  assert.match(t[2], /65262.*aparelho 17\b/)
})

test('o ritmo conta-se pelo relógio do portátil', () => {
  let agora = 0
  const c = novoCenso({ agora: () => agora })
  for (let i = 0; i < 20; i++) c.linha(trama(...ROTACOES_2100))
  agora = 2000
  assert.match(c.resumo(), /motor: 20 tramas \(10\/s\)/)
})

test('uma linha estragada conta-se e não rebenta', () => {
  const c = novoCenso({ agora: () => 0 })
  c.linha('lixo')
  c.linha(trama(...ROTACOES_2100).replace('A041', 'A042'))
  c.linha('')
  assert.equal(c.estado.estragadas, 2)
  assert.equal(c.estado.tramas, 0)
})
