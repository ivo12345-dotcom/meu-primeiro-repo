'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoTanque, contagem, encher, definirNivel, nivel, avaliarAlarme, ritmoDiario, iniciarCalibracao, terminarCalibracao } = require('../lib/agua')

const H = 3600 * 1000
const D = 24 * H
const CFG = { capacidadeL: 80, litrosPorPedalada: 0.35 }

test('pedaladas → litros gastos; o contador do sensor pode recomeçar', () => {
  let t = encher(novoTanque(), 0)
  t = contagem(t, 100, 1000, CFG) // primeira leitura: só referência
  t = contagem(t, 120, 2000, CFG) // +20 pedaladas = 7 L
  assert.ok(Math.abs(nivel(t, CFG).litros - 73) < 1e-9)
  t = contagem(t, 5, 3000, CFG) // o ESP32 reiniciou: conta 5 desde zero
  assert.ok(Math.abs(nivel(t, CFG).litros - 71.25) < 1e-9)
})

test('nível nunca abaixo de zero; "encher" põe na capacidade', () => {
  let t = encher(novoTanque(), 0)
  t = contagem(t, 0, 0, CFG)
  t = contagem(t, 1000, 1000, CFG) // 350 L num depósito de 80
  assert.equal(nivel(t, CFG).litros, 0)
  t = encher(t, 2000)
  assert.equal(nivel(t, CFG).litros, 80)
  assert.equal(nivel(t, CFG).fracao, 1)
})

test('definir o nível à mão (meio cheio, por exemplo)', () => {
  const t = definirNivel(novoTanque(), 30, 0, CFG)
  assert.equal(nivel(t, CFG).litros, 30)
})

// Auditoria I-29 (decisão n.º 23): sem nunca carregar em "Enchi" nem pôr o nível à mão, o nível não se
// sabe — nunca "cheio" por omissão.
test('I-29: um depósito novo (nunca "Enchi" nem nível à mão) não tem nível; "Enchi" e o nível à mão dão-no', () => {
  let t = novoTanque()
  t = contagem(t, 10, 1000, CFG)
  t = contagem(t, 30, 2000, CFG)
  assert.deepEqual(nivel(t, CFG), { litros: null, fracao: null })
  assert.equal(ritmoDiario(contagem(t, 40, 13 * H, CFG), 13 * H, CFG).dias, null)
  assert.equal(nivel(encher(t, 3000), CFG).litros, 80)
  assert.equal(nivel(definirNivel(t, 25, 3000), CFG).litros, 25)
})

test('alarme de água a acabar: ≤ 20%, limpa acima de 25%', () => {
  let a = avaliarAlarme(false, 0.19)
  assert.deepEqual(a, { ativo: true, mudou: true })
  a = avaliarAlarme(true, 0.22)
  assert.deepEqual(a, { ativo: true, mudou: false })
  a = avaliarAlarme(true, 0.26)
  assert.deepEqual(a, { ativo: false, mudou: true })
  assert.deepEqual(avaliarAlarme(false, null), { ativo: false, mudou: false })
})

test('ritmo: litros por dia nos últimos 3 dias e dias que faltam', () => {
  let t = encher(novoTanque(), 0)
  t = contagem(t, 0, 0, CFG)
  // 3 dias a gastar 20 pedaladas (7 L) por dia
  for (let d = 1; d <= 3; d++) t = contagem(t, 20 * d, d * D, CFG)
  const r = ritmoDiario(t, 3 * D, CFG)
  assert.ok(Math.abs(r.litrosDia - 7) < 1e-9)
  assert.ok(Math.abs(r.dias - (80 - 21) / 7) < 1e-9)
})

test('ritmo: com menos de 12 h de histórico não inventa', () => {
  let t = encher(novoTanque(), 0)
  t = contagem(t, 0, 0, CFG)
  t = contagem(t, 10, H, CFG)
  assert.equal(ritmoDiario(t, H, CFG), null)
})

test('calibrar a bomba: pedaladas para encher uma jarra de 1 L', () => {
  let t = encher(novoTanque(), 0)
  t = contagem(t, 50, 0, CFG)
  t = iniciarCalibracao(t)
  t = contagem(t, 53, 1000, CFG)
  t = contagem(t, 54, 2000, CFG)
  const r = terminarCalibracao(t, 1)
  assert.equal(r.pedaladas, 4)
  assert.equal(r.litrosPorPedalada, 0.25)
  assert.throws(() => terminarCalibracao(iniciarCalibracao(t), 1), /nenhuma pedalada/)
})
