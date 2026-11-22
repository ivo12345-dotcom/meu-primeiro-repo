'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoBloco, juntar, fechar, emFalta } = require('../lib/movimento')

test('o bloco guarda os inteiros de cada leitura, pela ordem de chegada', () => {
  let b = novoBloco()
  assert.equal(fechar(b), null)
  for (let i = 0; i < 10; i++) b = juntar(b, { tipo: 'movimento', n: 1042 + i, k: 10, a: [512, -2980, 9320 + i], w: [-12, 35, 4], q: [0, 1736, 0, 9848], precisao: 349, estado: 3 })
  const v = fechar(b)
  assert.deepEqual(v.n, [1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051])
  assert.deepEqual(v.k, Array(10).fill(10))
  assert.deepEqual(v.a[9], [512, -2980, 9329])
  assert.deepEqual(v.w[0], [-12, 35, 4])
  assert.deepEqual(v.q[0], [0, 1736, 0, 9848])
  assert.deepEqual(Object.keys(v), ['n', 'k', 'a', 'w', 'q'])
})

test('Review Focus 3: leituras em falta, sem contar o reinício da caixa', () => {
  assert.equal(emFalta(null, 5), 0)
  assert.equal(emFalta(5, 6), 0)
  assert.equal(emFalta(5, 9), 3)
  assert.equal(emFalta(90000, 2), 0)
  assert.equal(emFalta(5, 5000), 0)
})
