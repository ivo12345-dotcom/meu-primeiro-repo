'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas, VELHO, ESPERA } = require('../lib/caixas')
const bat = (caixa, sim = false) => ({ tipo: 'batimento', caixa, ms: 1, fw: '0.1.0', sim, rssi: -58, perdidos: 0 })

test('as duas caixas a falar; a 2 cala-se sem aviso daqui; a 1 cala-se com um aviso só', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(anotarBatimento(e, bat(1), 1000), bat(2), 1000)
  let r = avaliarCaixas(e, 2000)
  assert.equal(r.caixas[1].estado, 'a-receber')
  assert.equal(r.caixas[2].estado, 'a-receber')
  assert.deepEqual(r.notificacoes, [])
  e = anotarBatimento(r.estado, bat(1), 7000)
  r = avaliarCaixas(e, 7000)
  assert.equal(r.caixas[2].estado, 'sem-ligacao')
  assert.match(r.caixas[2].motivo, /caixa do motor não dá sinal/)
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, 7000 + VELHO + 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.match(r.caixas[1].motivo, /não fala há 5 s/)
  assert.match(r.caixas[2].motivo, /sem a caixa dos instrumentos/)
  assert.equal(r.notificacoes.length, 1)
  assert.deepEqual({ ...r.notificacoes[0], message: '' }, { id: 'caixa1', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: '' })
  assert.deepEqual(avaliarCaixas(r.estado, 20000).notificacoes, [])
  r = avaliarCaixas(anotarBatimento(r.estado, bat(1), 21000), 21000)
  assert.deepEqual(r.notificacoes, [{ id: 'caixa1', state: 'normal', method: [], message: 'Normal' }])
})

test('nunca falou: só avisa ao fim de 30 s, e diz porque a porta não abre', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: false, nome: 'COM7', motivo: 'File not found' }, 0)
  let r = avaliarCaixas(e, ESPERA - 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, ESPERA + 1)
  assert.match(r.notificacoes[0].message, /a porta COM7 não abre: File not found/)
})

test('a fingir: vem do último batimento da caixa 1', () => {
  const e = anotarBatimento(novoEstadoCaixas(0), bat(1, true), 100)
  assert.equal(avaliarCaixas(e, 200).sim, true)
  assert.equal(avaliarCaixas(anotarBatimento(e, bat(1, false), 300), 400).sim, false)
})

// Revisão final (22/11/2026): a caixa do motor a fingir, com a dos instrumentos verdadeira, deixava
// sair as rotações sem a marca de simulado.
test('a fingir: basta uma das duas caixas dizer que finge; a do motor só enquanto der sinal', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(anotarBatimento(e, bat(1, false), 1000), bat(2, true), 1000)
  assert.equal(avaliarCaixas(e, 1500).sim, true, 'a caixa do motor a fingir chega para marcar tudo')
  e = anotarBatimento(e, bat(1, false), 7000) // a caixa do motor calou-se há 6 s: o que dizia já não conta
  assert.equal(avaliarCaixas(e, 7100).sim, false)
  e = anotarBatimento(anotarBatimento(e, bat(2, false), 8000), bat(1, true), 8000)
  assert.equal(avaliarCaixas(e, 8100).sim, true)
  e = anotarBatimento(e, bat(1, false), 9000)
  assert.equal(avaliarCaixas(e, 9100).sim, false)
})
