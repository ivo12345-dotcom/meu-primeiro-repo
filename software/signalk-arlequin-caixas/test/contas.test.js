'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../lib/contas')
const perto = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} não é ${b}`)
const GRAU = Math.PI / 180

test('log: 10 impulsos por segundo são 2 nós', () => {
  let e = c.novoLog()
  for (let i = 0; i <= 4; i++) e = c.juntarLog(e, { ms: 1000 + 500 * i, impulsos: 100 + 5 * i, periodoUs: 100000 })
  assert.equal(c.hzLog(e), 10)
  perto(c.velocidadeNaAgua(10), 1.028888)
  perto(c.velocidadeNaAgua(10, 0.25), 1.28611)
})

test('log devagar usa o período do último impulso; parado dá 0; sem 2 s de leituras dá null', () => {
  let e = c.novoLog()
  e = c.juntarLog(e, { ms: 0, impulsos: 7, periodoUs: 1000000 })
  assert.equal(c.hzLog(e), null)
  for (const [ms, impulsos] of [[500, 7], [1000, 8], [1500, 8], [2000, 9]]) e = c.juntarLog(e, { ms, impulsos, periodoUs: 1000000 })
  assert.equal(c.hzLog(e), 1)
  let p = c.novoLog()
  for (let i = 0; i <= 4; i++) p = c.juntarLog(p, { ms: 500 * i, impulsos: 42, periodoUs: 0 })
  assert.equal(c.hzLog(p), 0)
})

// Revisão final (22/11/2026): devagar, um impulso falso colado ao anterior (um período de 200 µs)
// dava 5000 impulsos por segundo, ou seja, 1000 nós durante um segundo. O período nunca pode dizer mais
// do que os impulsos contados na janela deixam: n impulsos em t segundos são, no máximo, (n + 1) / t.
test('log devagar: um impulso falso não dá um pico de velocidade', () => {
  let e = c.novoLog()
  for (const [ms, impulsos, periodoUs] of [[0, 10, 1000000], [1000, 11, 1000000], [2000, 12, 1000000], [3000, 14, 200]]) e = c.juntarLog(e, { ms, impulsos, periodoUs })
  const hz = c.hzLog(e)
  assert.ok(hz > 0 && hz <= 5 / 3 + 1e-9, `${hz} impulsos por segundo`)
  assert.ok(c.velocidadeNaAgua(hz) / c.NO < 0.4, 'menos de meio nó, não centenas')
  // e um período honesto continua a valer por inteiro
  let h = c.novoLog()
  for (const [ms, impulsos] of [[0, 7], [1000, 8], [2000, 9]]) h = c.juntarLog(h, { ms, impulsos, periodoUs: 1000000 })
  assert.equal(c.hzLog(h), 1)
})

test('Review Focus 3: a caixa reinicia e a conta recomeça, sem negativos nem picos', () => {
  let e = c.novoLog()
  for (let i = 0; i <= 4; i++) e = c.juntarLog(e, { ms: 90000 + 500 * i, impulsos: 5000 + 5 * i, periodoUs: 100000 })
  e = c.juntarLog(e, { ms: 300, impulsos: 2, periodoUs: 0 })
  assert.equal(c.hzLog(e), null)
  for (let i = 1; i <= 4; i++) e = c.juntarLog(e, { ms: 300 + 500 * i, impulsos: 2 + 5 * i, periodoUs: 100000 })
  assert.equal(c.hzLog(e), 10)
})

test('vento aparente: ângulo para os dois bordos, desvio e fator', () => {
  perto(c.ventoAparente({ angulo: 350, velocidade: 7.5 }, {}).angleApparent, -0.174533)
  perto(c.ventoAparente({ angulo: 90, velocidade: 7.5 }, { desvioVento: 5 }).angleApparent, 1.658063)
  perto(c.ventoAparente({ angulo: 180, velocidade: 7.5 }, {}).angleApparent, Math.PI)
  perto(c.ventoAparente({ angulo: 10, velocidade: 10 }, { fatorVento: 1.1 }).speedApparent, 11)
})

test('eixos: 24 montagens válidas; eixos paralelos não', () => {
  assert.deepEqual(c.eixos('+y', '+z'), { f: [0, 1, 0], u: [0, 0, 1], s: [1, 0, 0] })
  assert.deepEqual(c.eixos('+x', '+z'), { f: [1, 0, 0], u: [0, 0, 1], s: [0, -1, 0] })
  assert.equal(c.eixos('+x', '-x'), null)
  assert.equal(c.eixos('+q', '+z'), null)
})

test('atitude: proa, adornamento a estibordo e proa a subir', () => {
  const plano = c.eixos('+y', '+z')
  let r = c.atitude([0, 0, 0, 1], plano) // o y do sensor aponta ao norte
  perto(r.heading, 0); perto(r.roll, 0); perto(r.pitch, 0)
  perto(c.atitude([0, 0, 0, 1], c.eixos('+x', '+z')).heading, Math.PI / 2) // o x aponta a leste
  perto(c.atitude([0, 0, 0.707107, 0.707107], c.eixos('+x', '+z')).heading, 0) // rodado 90° para a esquerda
  r = c.atitude([0, 0.173648, 0, 0.984808], plano) // 20° sobre o eixo norte: estibordo desce
  perto(r.roll, 0.349066); perto(r.pitch, 0); perto(r.heading, 0)
  r = c.atitude([0.087156, 0, 0, 0.996195], plano) // 10° sobre o eixo leste: a proa sobe
  perto(r.pitch, 0.174533); perto(r.roll, 0)
  assert.equal(c.atitude([0, 0, 0, 0], plano), null)
})

test('desvios da proa: fixo e por rumo, com a volta aos 360°', () => {
  const t = [{ rumo: 0, desvio: 2 }, { rumo: 180, desvio: -2 }]
  perto(c.corrigirProa(0, { tabelaDesvios: t }), 2 * GRAU)
  perto(c.corrigirProa(90 * GRAU, { tabelaDesvios: t }), 90 * GRAU)
  perto(c.corrigirProa(270 * GRAU, { tabelaDesvios: t }), 270 * GRAU)
  perto(c.corrigirProa(359 * GRAU, { desvioProa: 3 }), 2 * GRAU)
  perto(c.corrigirProa(10 * GRAU, { tabelaDesvios: [{ rumo: 77, desvio: -4 }] }), 6 * GRAU)
  perto(c.corrigirInclinacao({ roll: 0.1, pitch: 0.02 }, { desvioAdorno: 2, desvioCaimento: -1 }).roll, 0.1 - 2 * GRAU)
})
