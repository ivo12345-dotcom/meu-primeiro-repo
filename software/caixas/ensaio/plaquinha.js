'use strict'
// As contas do ensaio da plaquinha do vento (o optoacoplador entre o mostrador NASA e o RX2 da caixa 1).
// A caixa 1 faz de mostrador: manda a frase pelo pino TX2, ao contrário (repouso em baixo), e a
// plaquinha tem de a trazer direita ao RX2. Aqui só se fazem contas: quem fala com a placa é o
// plaquinha-vento.js.
const { soma } = require('../../signalk-arlequin-caixas/lib/linhas')

// Três ventos diferentes, para passarem bits diferentes; o último com uma segunda frase colada à
// primeira (o mostrador verdadeiro pode mandar mais do que o MWV).
const FASES = [
  { nome: '35,0° e 14,0 nós', graus: 350, nos: 140, extra: false },
  { nome: '123,4° e 5,6 nós', graus: 1234, nos: 56, extra: false },
  { nome: '359,9° e 99,9 nós, com uma segunda frase colada', graus: 3599, nos: 999, extra: true }
]

// Os valores do comando "vento" de uma fase: décimos de grau, décimos de nó, segunda frase, por fora.
const comandoDaFase = (f) => [f.graus, f.nos, f.extra ? 1 : 0, 1]

// A frase que a caixa escreve para esses décimos (a mesma conta do ensaio.h).
function fraseEsperada (graus, nos) {
  const corpo = `IIMWV,${Math.trunc(graus / 10)}.${graus % 10},R,${Math.trunc(nos / 10)}.${nos % 10},N,A`
  return `$${corpo}*${soma(corpo)}`
}

const E_VENTO = /^\$..MWV,/

// O resultado de uma fase: segundos de escuta, a frase esperada, as linhas que a caixa mandou ao portátil
// nesse tempo e os contadores do comando "estado" antes e depois.
function contas ({ segundos, esperada, linhas, antes, depois }) {
  const vento = linhas.filter(l => E_VENTO.test(l))
  const recebidas = vento.filter(l => l === esperada).length
  const outras = vento.length - recebidas
  const d = (chave) => depois[chave] - antes[chave]
  const invalidas = d('vento-invalidas')
  const bytes = d('vento-bytes')
  const mexidas = d('vento-mexidas')
  const r = { recebidas, esperadas: segundos, outras, invalidas, bytes, mexidas, passa: false, diagnostico: '' }
  if (recebidas >= segundos - 2 && invalidas === 0 && outras === 0) {
    r.passa = true
    r.diagnostico = `passa: ${recebidas} frases certas em ${segundos} s, nenhuma estragada`
  } else if (bytes === 0 && mexidas === 0) {
    r.diagnostico = 'não chega nada ao pino do vento: ver o fio do TX2 ao AMARELO, o VERDE no GND, o PC817 ' +
      'no suporte (a pinta e a metade certa) e o díodo (a risca)'
  } else if (bytes === 0) {
    r.diagnostico = `o pino mexe (${mexidas} mudanças) mas não dá bytes: sinal fraco ou muito lento; ver os ` +
      '3,3 V na resistência de 2,2 kΩ e trocar o PC817 por outro'
  } else if (invalidas > 0 || outras > 0) {
    r.diagnostico = `chegam bytes (${bytes}) mas há frases estragadas (${invalidas} deitadas fora, ${outras} ` +
      'diferentes da mandada): o optoacoplador não acompanha; trocar o PC817 por outro ou baixar a resistência dos 3,3 V'
  } else {
    r.diagnostico = `faltam frases: ${recebidas} em ${segundos} s, sem nenhuma estragada; ver se algum fio está mal encostado`
  }
  return r
}

module.exports = { FASES, comandoDaFase, fraseEsperada, contas }
