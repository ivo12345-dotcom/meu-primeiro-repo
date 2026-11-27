'use strict'
// As contas do ensaio da plaquinha do vento (ensaio/plaquinha-vento.js), sem placa nenhuma.
const test = require('node:test')
const assert = require('node:assert/strict')
const { FASES, comandoDaFase, fraseEsperada, contas } = require('./plaquinha')

const ESTADO = { 'vento-mexidas': 1000, 'vento-bytes': 500, 'vento-frases': 20, 'vento-invalidas': 0 }
const mais = (bytes, frases, invalidas, mexidas) => ({
  'vento-mexidas': ESTADO['vento-mexidas'] + mexidas,
  'vento-bytes': ESTADO['vento-bytes'] + bytes,
  'vento-frases': ESTADO['vento-frases'] + frases,
  'vento-invalidas': ESTADO['vento-invalidas'] + invalidas
})
const repetida = (frase, n) => Array.from({ length: n }, () => frase)

test('a frase esperada é a que a caixa escreve: um décimo de grau e um décimo de nó, com a soma', () => {
  assert.equal(fraseEsperada(350, 140), '$IIMWV,35.0,R,14.0,N,A*3E')
  assert.equal(fraseEsperada(3599, 5), '$IIMWV,359.9,R,0.5,N,A*' + fraseEsperada(3599, 5).slice(-2))
  assert.match(fraseEsperada(1234, 56), /^\$IIMWV,123\.4,R,5\.6,N,A\*[0-9A-F]{2}$/)
})

test('o comando de cada fase pede sempre o caminho por fora (o quarto valor a 1)', () => {
  assert.ok(FASES.length >= 3)
  for (const f of FASES) {
    const c = comandoDaFase(f)
    assert.equal(c.length, 4)
    assert.equal(c[3], 1, 'sem o quarto valor a frase ia por dentro da placa e a plaquinha não era ensaiada')
  }
  assert.ok(FASES.some(f => f.extra), 'falta uma fase com duas frases coladas')
})

test('tudo certo: uma frase por segundo, nenhuma estragada', () => {
  const f = fraseEsperada(350, 140)
  const r = contas({ segundos: 20, esperada: f, linhas: repetida(f, 20), antes: ESTADO, depois: mais(540, 20, 0, 4000) })
  assert.equal(r.passa, true)
  assert.equal(r.recebidas, 20)
  assert.equal(r.invalidas, 0)
  assert.match(r.diagnostico, /^passa/)
})

test('uma frase a menos no princípio ou no fim da janela ainda passa; três a menos já não', () => {
  const f = fraseEsperada(350, 140)
  assert.equal(contas({ segundos: 20, esperada: f, linhas: repetida(f, 19), antes: ESTADO, depois: mais(513, 19, 0, 3800) }).passa, true)
  const r = contas({ segundos: 20, esperada: f, linhas: repetida(f, 17), antes: ESTADO, depois: mais(540, 17, 0, 4000) })
  assert.equal(r.passa, false)
  assert.match(r.diagnostico, /faltam/)
})

test('não chega nada ao pino: diz por onde procurar', () => {
  const r = contas({ segundos: 20, esperada: fraseEsperada(350, 140), linhas: [], antes: ESTADO, depois: mais(0, 0, 0, 0) })
  assert.equal(r.passa, false)
  assert.equal(r.recebidas, 0)
  assert.match(r.diagnostico, /não chega nada/)
})

test('o pino mexe mas não dá bytes nem frases: sinal fraco ou muito lento', () => {
  const r = contas({ segundos: 20, esperada: fraseEsperada(350, 140), linhas: [], antes: ESTADO, depois: mais(0, 0, 0, 900) })
  assert.equal(r.passa, false)
  assert.match(r.diagnostico, /mexe/)
})

test('chegam bytes mas as frases vêm estragadas: o optoacoplador não acompanha', () => {
  const r = contas({ segundos: 20, esperada: fraseEsperada(350, 140), linhas: [], antes: ESTADO, depois: mais(500, 0, 18, 3500) })
  assert.equal(r.passa, false)
  assert.equal(r.invalidas, 18)
  assert.match(r.diagnostico, /estragad/)
})

test('uma só frase estragada em vinte chega para chumbar', () => {
  const f = fraseEsperada(350, 140)
  const r = contas({ segundos: 20, esperada: f, linhas: repetida(f, 19), antes: ESTADO, depois: mais(540, 19, 1, 4000) })
  assert.equal(r.passa, false)
  assert.equal(r.invalidas, 1)
})

test('uma frase de vento diferente da esperada chumba (não é a que se mandou)', () => {
  const f = fraseEsperada(350, 140)
  const r = contas({ segundos: 20, esperada: f, linhas: [...repetida(f, 19), fraseEsperada(350, 141)], antes: ESTADO, depois: mais(540, 20, 0, 4000) })
  assert.equal(r.passa, false)
  assert.equal(r.outras, 1)
})

test('linhas que não são do vento (batimentos, log) não contam para nada', () => {
  const f = fraseEsperada(350, 140)
  const linhas = [...repetida(f, 20), '$AQB,1,123,0.2.2,1,0,0,3,1,0*00', '$AQL,123,0,0*00']
  const r = contas({ segundos: 20, esperada: f, linhas, antes: ESTADO, depois: mais(540, 20, 0, 4000) })
  assert.equal(r.passa, true)
  assert.equal(r.outras, 0)
})
