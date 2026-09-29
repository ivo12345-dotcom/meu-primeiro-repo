'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { iniciar, amostra, adicionar, desfazer, terminar, importar, estavelAgora } = require('../lib/calibracao')

const S = 1000
// Curva de teste: razão sobe com os litros, mas a boia PARA acima dos 185 L.
const razaoDe = (L) => 0.1 + 0.6 * Math.min(L, 185) / 200

// Alimenta a sessão durante `seg` segundos com o nível L e devolve a sessão.
function esperar (c, L, seg, t0) {
  for (let s = 0; s < seg; s++) c = amostra(c, { t: t0 + s * S, razao: razaoDe(L) })
  return c
}

test('estabilidade: 20 s de leituras dentro de ±0,002', () => {
  const agora = 100 * S
  const firmes = Array.from({ length: 20 }, (_, i) => ({ t: agora - i * S, razao: 0.4 + (i % 2) * 0.003 }))
  assert.equal(estavelAgora(firmes, agora), true)
  const mexidas = firmes.map((a, i) => ({ ...a, razao: 0.4 + i * 0.002 }))
  assert.equal(estavelAgora(mexidas, agora), false)
  assert.equal(estavelAgora(firmes.slice(0, 10), agora), false) // poucas
})

test('calibração passo a passo: 0 L e depois +5 L, grava quando estabiliza', () => {
  let c = iniciar(0)
  c = esperar(c, 0, 40, 0)
  assert.deepEqual(c.pontos.map(p => p.litros), [0]) // o vazio grava-se sozinho
  c = adicionar(c, 5, 40 * S)
  assert.equal(c.pendente.litros, 5)
  c = esperar(c, 5, 10, 40 * S) // ainda a mexer / pouco tempo
  assert.equal(c.pontos.length, 1)
  c = esperar(c, 5, 40, 50 * S)
  assert.deepEqual(c.pontos.map(p => p.litros), [0, 5])
  assert.equal(c.pendente, null)
  assert.ok(Math.abs(c.pontos[1].razao - razaoDe(5)) < 1e-9)
})

test('não aceita +5 L enquanto o anterior não gravou', () => {
  let c = esperar(iniciar(0), 0, 40, 0)
  c = adicionar(c, 5, 40 * S)
  assert.throws(() => adicionar(c, 5, 41 * S), /ainda a estabilizar/)
})

test('boia parada no topo: regista onde parou e não mete pontos repetidos', () => {
  let c = esperar(iniciar(0), 0, 40, 0)
  let t = 40 * S
  for (let L = 5; L <= 200; L += 5) {
    c = adicionar(c, 5, t)
    c = esperar(c, L, 45, t)
    t += 45 * S
  }
  assert.equal(c.total, 200)
  const litros = c.pontos.map(p => p.litros)
  assert.equal(litros[litros.length - 1], 185) // a boia deixou de subir aos 185 L
  assert.deepEqual(c.boiaParada, { de: 185, ate: 200 })
})

test('desfazer tira o último ponto e os litros dele', () => {
  let c = esperar(iniciar(0), 0, 40, 0)
  c = adicionar(c, 5, 40 * S)
  c = esperar(c, 5, 40, 40 * S)
  c = desfazer(c)
  assert.deepEqual(c.pontos.map(p => p.litros), [0])
  assert.equal(c.total, 0)
})

test('desfazer com um ponto ainda a estabilizar volta ao total de antes', () => {
  let c = esperar(iniciar(0), 0, 40, 0)
  c = adicionar(c, 5, 40 * S)
  c = esperar(c, 5, 40, 40 * S)
  c = adicionar(c, 10, 80 * S) // enganou-se: eram 5
  c = desfazer(c)
  assert.equal(c.total, 5)
  assert.equal(c.pendente, null)
  assert.deepEqual(c.pontos.map(p => p.litros), [0, 5])
})

test('terminar: devolve a tabela e, se estiver cheio, a capacidade real', () => {
  let c = esperar(iniciar(0), 0, 40, 0)
  let t = 40 * S
  for (let L = 10; L <= 60; L += 10) { c = adicionar(c, 10, t); c = esperar(c, L, 45, t); t += 45 * S }
  const r = terminar(c, { cheio: true })
  assert.equal(r.tabela.length, 7)
  assert.equal(r.capacidadeL, 60)
  assert.throws(() => terminar(iniciar(0), {}), /pelo menos 2 pontos/)
})

test('importar a folha do multímetro: tensões → razões, sem a boia parada', () => {
  const folha = [0, 50, 100, 150, 185, 190, 200].map(L => ({ litros: L, sonda: razaoDe(L) * 12.4, alimentacao: 12.4 }))
  const r = importar(folha)
  assert.deepEqual(r.tabela.map(p => p.litros), [0, 50, 100, 150, 185])
  assert.deepEqual(r.boiaParada, { de: 185, ate: 200 })
  assert.ok(Math.abs(r.tabela[1].razao - razaoDe(50)) < 1e-4)
  assert.throws(() => importar([{ litros: 0, sonda: 1, alimentacao: 0 }]), /alimentação/)
})
