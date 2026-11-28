'use strict'
// As contas da escuta do vento (ensaio/ouvir-vento.js), sem placa nenhuma: juntar as respostas do comando
// "cru" numa fita só, parti-la em linhas, dizer o que é cada linha e dar o veredicto.
const test = require('node:test')
const assert = require('node:assert/strict')
const { ANEL, lerResposta, juntar, emLinhas, classificar, veredicto } = require('./cru')

const hex = (texto) => Buffer.from(texto, 'latin1').toString('hex').toUpperCase()
const resposta = (total, texto) => `total=${total};hex=${hex(texto)}`
const MWV = '$IIMWV,35.0,R,14.0,N,A*3E'
const VWR = '$IIVWR,35.0,R,14.0,N,7.2,M,25.9,K*71'

test('a resposta do comando cru lê-se: o total e as letras', () => {
  assert.deepEqual(lerResposta('total=5;hex=2441420D0A'), { total: 5, bytes: Buffer.from('$AB\r\n', 'latin1') })
  assert.deepEqual(lerResposta('total=0;hex='), { total: 0, bytes: Buffer.alloc(0) })
  for (const ma of ['desconhecido', 'total=5', 'total=x;hex=00', 'total=5;hex=0', 'total=5;hex=ZZ', '', null]) {
    assert.equal(lerResposta(ma), null, `aceitou "${ma}"`)
  }
})

test('o anel da caixa tem 80 letras: é o que cabe numa linha de 200', () => {
  assert.equal(ANEL, 80)
  assert.ok(5 + 3 + 1 + ('total=4294967295;hex='.length + 2 * ANEL) + 3 <= 200)
})

test('a primeira resposta só marca o ponto de partida: o que já lá estava não é desta escuta', () => {
  const f = juntar(null, resposta(300, 'restos de antes'))
  assert.equal(f.total, 300)
  assert.equal(f.bytes.length, 0)
  assert.equal(f.perdidas, 0)
  assert.equal(f.recomecos, 0)
})

test('cada resposta acrescenta só as letras novas, mesmo quando repete as anteriores', () => {
  let f = juntar(null, resposta(100, 'xxxx'))
  f = juntar(f, resposta(105, 'xxxx$IIMW'))      // 5 novas
  f = juntar(f, resposta(105, 'xxxx$IIMW'))      // nenhuma
  f = juntar(f, resposta(110, 'xxxx$IIMWV,35.')) // mais 5
  assert.equal(f.bytes.toString('latin1'), '$IIMWV,35.')
  assert.equal(f.total, 110)
  assert.equal(f.perdidas, 0)
})

test('se entraram mais letras do que o anel guarda, as que faltam contam-se como perdidas', () => {
  let f = juntar(null, resposta(0, ''))
  const anel = 'A'.repeat(ANEL)
  f = juntar(f, resposta(ANEL + 30, anel)) // entraram 110, o anel só tem as últimas 80
  assert.equal(f.bytes.length, ANEL)
  assert.equal(f.perdidas, 30)
})

test('a caixa recomeçou a meio (o total voltou atrás): conta-se o recomeço e segue-se do que ela tiver', () => {
  let f = juntar(null, resposta(5000, 'antes'))
  f = juntar(f, resposta(5003, 'antesabc'))
  f = juntar(f, resposta(4, 'novo'))
  assert.equal(f.recomecos, 1)
  assert.equal(f.bytes.toString('latin1'), 'abcnovo')
  assert.equal(f.total, 4)
})

test('o total dá a volta aos 4 mil milhões sem se perder nada', () => {
  let f = juntar(null, resposta(4294967294, 'zz'))
  f = juntar(f, resposta(2, 'zzabcd')) // 4 novas: duas antes da volta e duas depois
  assert.equal(f.bytes.toString('latin1'), 'abcd')
  assert.equal(f.recomecos, 0)
  assert.equal(f.perdidas, 0)
})

test('a fita parte-se em linhas inteiras; o que ainda vai a meio fica à espera', () => {
  const r = emLinhas(Buffer.from(`${MWV}\r\n${VWR}\r\n$IIMW`, 'latin1'))
  assert.deepEqual(r.linhas, [MWV, VWR])
  assert.equal(r.resto.toString('latin1'), '$IIMW')
  assert.deepEqual(emLinhas(Buffer.from('\r\n\r\n', 'latin1')).linhas, [])
})

test('cada linha é uma de seis coisas', () => {
  assert.deepEqual(classificar(MWV), { classe: 'mwv-boa', tipo: 'MWV', angulo: 35, velocidade: 14, referencia: 'R', unidade: 'N', valida: 'A' })
  assert.equal(classificar('$IIMWV,35.0,R,14.0,N,A*00').classe, 'mwv-soma-errada')
  assert.equal(classificar('$IIMWV,35.0,R,14.0,N,A').classe, 'mwv-sem-soma')
  assert.deepEqual(classificar(VWR), { classe: 'outra-boa', tipo: 'VWR' })
  assert.deepEqual(classificar('$WIVWR,35.0,R,14.0,N,7.2,M,25.9,K'), { classe: 'outra-sem-soma', tipo: 'VWR' })
  assert.equal(classificar('ÿþ\u0003abc').classe, 'lixo')
  assert.equal(classificar('IIMWV,35.0').classe, 'lixo')
  assert.equal(classificar('$IIVWR,35.0,R*00').classe, 'lixo', 'uma frase que não é o MWV e tem a soma errada é lixo')
})

const conta = (mexidas, bytes, frases, invalidas) => ({ 'vento-mexidas': mexidas, 'vento-bytes': bytes, 'vento-frases': frases, 'vento-invalidas': invalidas })
const repetida = (linha, n) => Array.from({ length: n }, () => linha)

test('veredicto: frases boas e nenhuma estragada é o que se quer', () => {
  const v = veredicto({ segundos: 20, linhas: repetida(MWV, 20), contadores: conta(4000, 540, 20, 0), perdidas: 0 })
  assert.equal(v.passa, true)
  assert.match(v.texto, /20 frases de vento boas em 20 s/)
  assert.match(v.texto, /35° e 14 nós/)
})

test('veredicto: o fio parado diz que não chega sinal', () => {
  const v = veredicto({ segundos: 20, linhas: [], contadores: conta(0, 0, 0, 0), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /não chega sinal/)
})

test('veredicto: o fio mexe mas não se forma letra nenhuma', () => {
  const v = veredicto({ segundos: 20, linhas: [], contadores: conta(37, 0, 0, 0), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /mexe/)
  assert.match(v.texto, /nenhuma letra/)
})

test('veredicto: a frase do vento sem a soma no fim', () => {
  const v = veredicto({ segundos: 20, linhas: repetida('$WIMWV,35.0,R,14.0,N,A', 20), contadores: conta(4000, 480, 0, 20), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /sem a soma/)
})

test('veredicto: frases boas, mas de outro tipo', () => {
  const v = veredicto({ segundos: 20, linhas: repetida(VWR, 20), contadores: conta(6000, 800, 0, 0), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /outro tipo/)
  assert.match(v.texto, /VWR/)
})

test('veredicto: frases de vento com a soma errada são sinal estragado pelo caminho', () => {
  const v = veredicto({ segundos: 20, linhas: repetida('$IIMWV,35.0,R,14.0,N,A*00', 20), contadores: conta(4000, 540, 0, 20), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /estragad/)
})

test('veredicto: letras que não são texto apontam para a velocidade ou o sentido do sinal', () => {
  const v = veredicto({ segundos: 20, linhas: repetida('ÿ\u0081\u0003ð', 30), contadores: conta(9000, 300, 0, 30), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /não são texto/)
})

test('veredicto: boas e estragadas ao mesmo tempo não passa, e diz quantas', () => {
  const linhas = [...repetida(MWV, 15), ...repetida('$IIMWV,35.0,R,14.0,N,A*00', 5)]
  const v = veredicto({ segundos: 20, linhas, contadores: conta(4000, 540, 15, 5), perdidas: 0 })
  assert.equal(v.passa, false)
  assert.match(v.texto, /15 boas/)
  assert.match(v.texto, /5 estragadas/)
})

test('veredicto: a caixa conta frases boas mesmo que a escuta não as tenha apanhado todas', () => {
  // o veredicto das boas vem dos contadores da caixa; as linhas só servem para explicar o resto
  const v = veredicto({ segundos: 20, linhas: repetida(MWV, 3), contadores: conta(4000, 540, 20, 0), perdidas: 40 })
  assert.equal(v.passa, true)
})
