'use strict'
// As contas do ensaio de resistência, sem placas: o que o resistencia.js tem de apanhar.
// Revisão final das caixas (23/11/2026): o ensaio de resistência dava "LIMPO" a uma caixa que se calava
// a meio (o registo das 13:56 ficou 7 minutos parado nas 8402 linhas a dizer "0 s sem batimento").
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoContador } = require('./contador')
const { escrever, soma } = require('../../signalk-arlequin-caixas/lib/linhas')

// Um relógio de portátil a fingir, que só anda quando o ensaio manda.
function relogio (inicio = 1_800_000_000_000) {
  let t = inicio
  const agora = () => t
  agora.passa = (ms) => { t += ms }
  return agora
}

const bat1 = (ms, { sim = 1, perdidos = 0, sensor = 4, arranque = 1, rsts = 0 } = {}) => escrever('B', [1, ms, '0.2.1', sim, 0, perdidos, sensor, arranque, rsts])
const bat2 = (ms, { sim = 1, rssi = -22, perdidos = 0 } = {}) => escrever('B', [2, ms, '0.2.1', sim, rssi, perdidos])
const mov = (n) => escrever('M', [n, 10, 512, -2980, 9320, -12, 35, 4, 0, 1736, 0, 9848, 349, 3])
const motor = (s) => { const corpo = `(${s}.000000) can1 0CF00400#FFFFFF004BFFFFFF`; return `${corpo}*${soma(corpo)}` }

// Um segundo do que chega pelo cabo com as duas caixas a mandar: batimentos, log, vento, movimento, motor.
function umSegundo (c, agora, s, { caixa2 = true, n0 = s * 10 } = {}) {
  c.linha(bat1(s * 1000))
  if (caixa2) c.linha(bat2(s * 1000 + 300))
  c.linha(escrever('L', [s * 1000, s * 26, 38462]))
  c.linha('$IIMWV,35.0,R,14.0,N,A*3E')
  for (let i = 0; i < 10; i++) c.linha(mov(n0 + i))
  if (caixa2) c.linha(motor(s))
  agora.passa(1000)
  c.tique()
}

test('uma hora normal com as duas caixas sai limpa', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 3600; s++) umSegundo(c, agora, s)
  const v = c.veredicto()
  assert.deepEqual(v.falhas, [])
  assert.equal(v.limpo, true)
  assert.equal(c.c.batimentos, 3600)
  assert.equal(c.c.batimentos2, 3600)
  assert.equal(c.c.movimento, 36000)
  assert.match(c.resumo(), /0 estragadas/)
})

test('uma caixa que se cala a meio não sai limpa: o silêncio conta-se pelo relógio do portátil', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 120; s++) umSegundo(c, agora, s, { caixa2: false })
  assert.equal(c.veredicto().limpo, true)
  for (let s = 0; s < 180; s++) { // três minutos sem chegar nada
    agora.passa(1000)
    c.tique()
  }
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.ok(c.segundosSemBatimento() >= 178, `${c.segundosSemBatimento()} s sem batimento`)
  assert.ok(c.c.maiorSilencioMs >= 179000, `maior silêncio ${c.c.maiorSilencioMs} ms`)
  assert.match(v.falhas.join(' | '), /sem batimento da caixa 1/)
  assert.match(c.resumo(), /1[78]\d s sem batimento/)
})

test('uma caixa que nunca chega a falar não sai limpa', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 0; s < 60; s++) {
    agora.passa(1000)
    c.tique()
  }
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /sem batimento da caixa 1/)
})

test('a porta que fecha a meio (o cabo saiu) dá falhas, e diz porquê', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 10; s++) umSegundo(c, agora, s, { caixa2: false })
  c.fechou('o cabo USB saiu ou a placa desligou-se')
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /a porta fechou: o cabo USB saiu/)
})

test('com a caixa 2 presente, o silêncio dela e os pacotes que o rádio perdeu contam', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 30; s++) umSegundo(c, agora, s)
  assert.equal(c.veredicto().limpo, true)
  // a caixa 2 cala-se 20 s (a 1 continua), e volta com 11 pacotes perdidos contados pela caixa 1
  for (let s = 31; s <= 50; s++) umSegundo(c, agora, s, { caixa2: false, n0: s * 10 })
  assert.equal(c.veredicto().limpo, false, 'a caixa 2 calada conta mesmo antes de voltar')
  assert.ok(c.segundosSemBatimento2() >= 18)
  c.linha(bat2(51300, { perdidos: 11 }))
  umSegundo(c, agora, 52, { n0: 520 })
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.equal(c.c.perdidosNoRadio, 11)
  assert.ok(c.segundosSemBatimento2() >= 18, `${c.segundosSemBatimento2()} s sem batimento da caixa 2`)
  assert.match(v.falhas.join(' | '), /caixa 2/)
  assert.match(v.falhas.join(' | '), /11 pacotes perdidos no rádio/)
})

test('pedidas as duas caixas, a caixa 2 que nunca aparece dá falhas', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 30; s++) umSegundo(c, agora, s, { caixa2: false })
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /a caixa 2 nunca deu sinal/)
  // sem as pedir, uma caixa só sai limpa
  const so = novoContador({ agora })
  for (let s = 1; s <= 30; s++) umSegundo(so, agora, s, { caixa2: false })
  assert.equal(so.veredicto().limpo, true)
})

test('a caixa que recomeça, as linhas que ela não conseguiu mandar e as estragadas dão falhas', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 10; s++) umSegundo(c, agora, s, { caixa2: false })
  c.linha(bat1(500)) // o relógio da caixa voltou atrás: recomeçou
  assert.equal(c.c.recomecos, 1)
  c.linha(bat1(1500, { perdidos: 3 })) // três linhas que a caixa deitou fora por não caberem na porta
  c.linha('$AQL,1,2,3*00') // soma errada
  c.linha('ÿÿÿ$AQM,1,2')
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.equal(c.c.estragadas, 2)
  assert.equal(c.c.deitadasForaPelaCaixa, 3)
  assert.equal(c.exemplos.length, 2)
  assert.match(v.falhas.join(' | '), /1 recomeço/)
  assert.match(v.falhas.join(' | '), /2 linhas estragadas/)
  assert.match(v.falhas.join(' | '), /3 linhas que a caixa não conseguiu mandar/)
})

test('leituras de movimento em falta contam-se pelo número de ordem; as cópias deitadas fora só se mostram', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 5; s++) umSegundo(c, agora, s, { caixa2: false })
  c.linha(mov(65)) // saltou do 59 para o 65: faltam 5
  c.repetidas(1200)
  const v = c.veredicto()
  assert.equal(c.c.leiturasEmFalta, 5)
  assert.equal(v.limpo, false)
  assert.match(c.resumo(), /1200 cópias deitadas fora/)
  const limpa = novoContador({ agora })
  for (let s = 1; s <= 5; s++) umSegundo(limpa, agora, s, { caixa2: false })
  limpa.repetidas(1200)
  assert.equal(limpa.veredicto().limpo, true, 'as cópias da ponte USB não são falha: são linhas boas repetidas')
})
