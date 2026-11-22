'use strict'
// O bloco do movimento: as leituras do sensor de um segundo (10, em regra), tal como chegam, para a
// caixa negra gravar num delta só. Guardam-se os inteiros da linha (aceleração em mm/s², rotação em
// 0,1 mrad/s, quaternião × 10 000) e o número de ordem de cada uma, para se ver depois se faltou alguma.

function novoBloco () {
  return { n: [], k: [], a: [], w: [], q: [] }
}

function juntar (bloco, m) {
  return {
    n: [...bloco.n, m.n],
    k: [...bloco.k, m.k],
    a: [...bloco.a, [...m.a]],
    w: [...bloco.w, [...m.w]],
    q: [...bloco.q, [...m.q]]
  }
}

// O valor a publicar, ou null se não chegou nenhuma leitura.
function fechar (bloco) {
  return bloco.n.length ? { n: bloco.n, k: bloco.k, a: bloco.a, w: bloco.w, q: bloco.q } : null
}

// Quantas leituras faltaram entre duas seguidas. Um salto para trás, ou de 1000 ou mais, é a caixa a
// reiniciar (o número de ordem recomeça): não conta.
function emFalta (nAnterior, n) {
  if (nAnterior === null || nAnterior === undefined) return 0
  const salto = n - nAnterior - 1
  return salto >= 1 && salto <= 999 ? salto : 0
}

module.exports = { novoBloco, juntar, fechar, emFalta }
