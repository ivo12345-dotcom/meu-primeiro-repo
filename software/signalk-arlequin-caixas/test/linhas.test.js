'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { ler, escrever, soma, linhaMotor, BAUD, MAX_LINHA } = require('../lib/linhas')

test('soma e escrever: como no NMEA 0183', () => {
  assert.equal(soma('AQB,1,123456,0.1.0,0,0,0'), '65')
  assert.equal(escrever('B', [1, 123456, '0.1.0', 0, 0, 0]), '$AQB,1,123456,0.1.0,0,0,0*65')
  assert.equal(BAUD, 460800)
  assert.equal(MAX_LINHA, 200)
})

test('batimento das duas caixas', () => {
  assert.deepEqual(ler('$AQB,1,123456,0.1.0,0,0,0*65'), { tipo: 'batimento', caixa: 1, ms: 123456, fw: '0.1.0', sim: false, rssi: 0, perdidos: 0 })
  assert.deepEqual(ler('$AQB,2,120000,0.1.0,1,-58,3*70\r'), { tipo: 'batimento', caixa: 2, ms: 120000, fw: '0.1.0', sim: true, rssi: -58, perdidos: 3 })
})

test('log e movimento: os inteiros tal como chegam', () => {
  assert.deepEqual(ler('$AQL,123500,5210,38462*48'), { tipo: 'log', ms: 123500, impulsos: 5210, periodoUs: 38462 })
  assert.deepEqual(ler('$AQM,1042,10,512,-2980,9320,-12,35,4,0,1736,0,9848,349,3*54'),
    { tipo: 'movimento', n: 1042, k: 10, a: [512, -2980, 9320], w: [-12, 35, 4], q: [0, 1736, 0, 9848], precisao: 349, estado: 3 })
})

test('vento: só o aparente (R) válido (A), em m/s', () => {
  const v = ler('$IIMWV,35.0,R,14.0,N,A*3E')
  assert.equal(v.tipo, 'vento')
  assert.equal(v.angulo, 35)
  assert.ok(Math.abs(v.velocidade - 7.202216) < 1e-6)
  assert.deepEqual(ler('$IIMWV,350.0,R,7.5,M,A*3A'), { tipo: 'vento', angulo: 350, velocidade: 7.5 })
  assert.equal(ler('$IIMWV,35.0,T,14.0,N,A*38'), null) // vento real: não é o que o mostrador mede
  assert.equal(ler('$IIMWV,35.0,R,14.0,N,V*29'), null) // o mostrador diz que não vale
})

test('motor: a trama, e a linha para o plugin do motor com a hora do portátil', () => {
  const m = ler('(12.345678) can1 0cf00400#ffffff004bffffff')
  assert.deepEqual(m, { tipo: 'motor', id: 0x0CF00400, dados: 'FFFFFF004BFFFFFF' })
  assert.equal(linhaMotor(m, 1_727_600_000_123), '(1727600000.123000) can1 0CF00400#FFFFFF004BFFFFFF')
})

test('Review Focus 4: lixo e linhas fora dos limites dão null, nunca um valor', () => {
  const M = [1042, 10, 512, -2980, 9320, -12, 35, 4, 0, 1736, 0, 9848, 349, 3]
  const com = (i, v) => escrever('M', M.map((x, j) => (j === i ? v : x)))
  for (const l of [
    '', 'ola', '\u0000ÿ\u0012', '$AQB,1,123456,0.1.0,0,0,0*66', '$AQB,1,123456,0.1.0,0,0,0', '$AQB,1,123456*00',
    escrever('B', [3, 1, '0.1.0', 0, 0, 0]), escrever('B', [1, 1, 'versao com espacos', 0, 0, 0]),
    escrever('B', [1, 1, '0.1.0', 2, 0, 0]), escrever('B', [1, 1, '0.1.0', 0, 5, 0]),
    escrever('L', [1, -4, 0]), escrever('L', [1, '12.5', 0]), escrever('L', [1, 2]),
    com(1, 0), com(2, 200000), com(5, 400000), com(11, 20000), com(11, 5000) /* norma 0,53 */, com(12, 40000), com(13, 4),
    '(12.3) can1 0CF004#00', '(12.3) can1 0CF00400#F', '$AQB,' + '1,'.repeat(120) + '*00'
  ]) assert.equal(ler(l), null, JSON.stringify(l))
  assert.equal(ler(escrever('M', [1, 10, 0, 0, 9807, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null) // quaternião nulo
  assert.notEqual(ler(escrever('B', [1, 1, '0.1.0', 0, 0, 0, 77, 'futuro'])), null) // campos a mais: aceita
})
