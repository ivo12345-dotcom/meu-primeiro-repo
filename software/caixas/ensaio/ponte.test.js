'use strict'
// A regra que impede a ponte USB da placa de reter linhas (ensaio/ponte.js), posta à prova num modelo
// da ponte, sem placa nenhuma. O programa das caixas tem a mesma regra em arlequin_linhas.h (AqPonte);
// na placa, quem a prova é o comando "surto" (ensaio/caixa1.test.js).
const test = require('node:test')
const assert = require('node:assert/strict')
const { PACOTE, SOSSEGA_US, US_POR_BYTE, retencoes, comARegra } = require('./ponte')

// Escritas seguidas: { t: µs em que a caixa escreve, n: bytes }.
const umaSo = (n) => [{ t: 0, n }]

test('o modelo da ponte: um envio que acaba num múltiplo de 64 bytes fica retido até virem mais bytes', () => {
  assert.equal(PACOTE, 64)
  // a linha do movimento com a caixa parada, a 28/11: 63 letras e o fim de linha
  assert.equal(retencoes(umaSo(64), 1000).length, 1)
  assert.equal(retencoes(umaSo(128), 1000).length, 1)
  assert.equal(retencoes(umaSo(63), 1000).length, 0)
  assert.equal(retencoes(umaSo(65), 1000).length, 0)
  // duas linhas escritas de seguida contam juntas: 30 + 34
  assert.equal(retencoes([{ t: 0, n: 30 }, { t: 5, n: 34 }], 1000).length, 1)
  // a linha retida sai quando chega a seguinte, se essa não acabar também num múltiplo
  const cemMs = 100000
  const r = retencoes([{ t: 0, n: 64 }, { t: cemMs, n: 64 }, { t: 2 * cemMs, n: 25 }], 1000)
  assert.deepEqual(r.map(x => x.bytes), [64, 128], 'as duas linhas de 64 ficaram à espera da de 25')
  assert.ok(Math.abs(r[0].ms - 100) < 2 && Math.abs(r[1].ms - 100) < 2, JSON.stringify(r))
})

test('com a regra, uma linha de 64 bytes leva um fim de linha a mais e já não fica retida', () => {
  for (const n of [64, 128, 192]) {
    const saida = comARegra(umaSo(n))
    assert.deepEqual(saida, [{ t: 0, n: n + 1 }])
    assert.equal(retencoes(saida, 1000).length, 0)
  }
  // as que não precisam ficam como estão
  for (const n of [25, 38, 63, 65, 66, 127, 129]) assert.deepEqual(comARegra(umaSo(n)), umaSo(n))
})

test('com a regra, duas linhas de seguida que somam 64 bytes também não ficam retidas', () => {
  const saida = comARegra([{ t: 0, n: 30 }, { t: 5, n: 34 }])
  assert.deepEqual(saida.map(e => e.n), [30, 35])
  assert.equal(retencoes(saida, 1000).length, 0)
})

test('a pausa duvidosa: não se sabe se a ponte despachou a meio, e a regra serve para os dois casos', () => {
  // 65 bytes, uma pausa curta, 63 bytes. Se a ponte não despachou na pausa, são 128 (retidos). Se
  // despachou, os 63 vão sozinhos, e um único byte a mais fazia deles 64 (retidos na mesma): são dois.
  const escritas = [{ t: 0, n: 65 }, { t: Math.round(65 * US_POR_BYTE) + 600, n: 63 }]
  const saida = comARegra(escritas)
  assert.deepEqual(saida.map(e => e.n), [65, 65])
  for (const sossego of [100, 500, 700, 2000, 9000]) {
    assert.equal(retencoes(saida, sossego).length, 0, `ponte que despacha ao fim de ${sossego} µs`)
  }
  // sem a regra, ficava retido sempre que a ponte não despachasse na pausa
  assert.equal(retencoes(escritas, 2000).length, 1)
  assert.equal(retencoes(escritas, 100).length, 0)
})

test('depois de 10 ms de fio parado a conta recomeça: a ponte já despachou de certeza', () => {
  assert.equal(SOSSEGA_US, 10000)
  // 40 bytes, 50 ms de pausa, 24 bytes: não somam (a ponte despachou os 40 há muito)
  const escritas = [{ t: 0, n: 40 }, { t: 50000, n: 24 }]
  assert.deepEqual(comARegra(escritas), escritas)
  assert.equal(retencoes(escritas, 1000).length, 0)
})

test('milhares de sequências ao acaso, com a ponte a despachar ao fim de 0,1 a 9 ms: nenhuma linha retida', () => {
  let semente = 20261128
  const acaso = () => { semente = (Math.imul(semente, 1103515245) + 12345) >>> 0; return semente / 4294967296 }
  const entre = (a, b) => a + Math.floor(acaso() * (b - a + 1))
  const sequencia = () => {
    const escritas = []
    let t = 0
    const quantas = entre(1, 40)
    for (let i = 0; i < quantas; i++) {
      const tipo = acaso() // pausas de todos os tamanhos: coladas, duvidosas e claras
      t += tipo < 0.3 ? entre(0, 50) : tipo < 0.75 ? entre(50, 4000) : entre(4000, 200000)
      escritas.push({ t, n: acaso() < 0.4 ? [64, 128, 32, 63, 65, 25, 39, 30, 34][entre(0, 8)] : entre(12, 200) })
    }
    return escritas
  }
  const SOSSEGOS = [100, 300, 700, 1000, 1500, 2500, 5000, 9000]
  let semRegra = 0
  let bytes = 0
  let aMais = 0
  for (let k = 0; k < 5000; k++) {
    const s = sequencia()
    const c = comARegra(s)
    bytes += s.reduce((a, e) => a + e.n, 0)
    aMais += c.reduce((a, e) => a + e.n, 0) - s.reduce((a, e) => a + e.n, 0)
    for (const x of SOSSEGOS) {
      if (retencoes(s, x).length) semRegra++
      assert.deepEqual(retencoes(c, x), [], `sequência ${k}, ponte a ${x} µs: ${JSON.stringify(s)}`)
    }
  }
  assert.ok(semRegra > 5000, `o ensaio não chegou a pôr a ponte em apuros (${semRegra} retenções sem a regra)`)
  assert.ok(aMais / bytes < 0.002, `a regra gasta de mais: ${aMais} bytes em ${bytes}`)
})
