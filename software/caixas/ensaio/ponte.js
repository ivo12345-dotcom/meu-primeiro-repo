'use strict'
// A ponte USB das placas (o chip CP210x, entre a porta série do ESP32 e o cabo USB) e a regra que a
// impede de reter linhas. Aqui estão o modelo da ponte e a regra, para se porem à prova sem placas
// (ensaio/ponte.test.js). A mesma regra, no programa das caixas: AqPonte, em comum/src/arlequin_linhas.h.
//
// O que se viu a 28/11/2026, com a caixa 1 parada em cima da mesa: a ponte entrega os bytes ao portátil
// em pacotes de 64. Enquanto houver bytes a chegar manda pacotes cheios; quando o fio para, manda o
// resto num pacote mais pequeno, e é esse pacote pequeno que faz o portátil entregar tudo ao programa.
// Se o fio parar mesmo no fim de um pacote cheio não há resto: o portátil fica com os bytes e à espera,
// até virem mais. As linhas do movimento tinham então 64 bytes certos, e cada uma esperava pela
// seguinte (100 ms) ou pela do log (até 400 ms). Não se perdia nada: chegava tarde.
//
// A regra: depois de cada linha, se o fio pudesse parar num múltiplo de 64 bytes, a caixa junta-lhe um
// fim de linha a mais (uma linha vazia, que quem lê não conta). O "pudesse" tem uma dúvida dentro: uma
// pausa curta entre duas linhas tanto pode ter chegado para a ponte despachar como não. Por isso a caixa
// faz a conta a partir de todos os sítios onde a ponte pode ter despachado desde a última pausa
// comprida, e junta os fins de linha precisos para nenhuma das contas dar um múltiplo de 64.
const PACOTE = 64
const SOSSEGA_US = 10000 // com o fio parado há mais do que isto, a ponte já despachou de certeza
const INICIOS = 16 // sítios duvidosos de que a caixa se lembra
const US_POR_BYTE = 1e7 / 460800 // dez bits por byte, à velocidade da porta

// A linha do tempo dos bytes no fio: cada escrita sai logo, ou a seguir ao que ainda estiver a sair.
function noFio (escritas) {
  let fim = -Infinity
  return escritas.map((e) => {
    const ini = Math.max(e.t, fim)
    fim = ini + e.n * US_POR_BYTE
    return { ini, fim, n: e.n }
  })
}

// O modelo da ponte. escritas: [{ t: µs em que a caixa escreve, n: bytes }]; sossegoUs: o tempo de fio
// parado ao fim do qual a ponte despacha o resto que tiver (não se conhece: ensaia-se com vários).
// Devolve as retenções: de cada vez que o fio parou com tudo mandado em pacotes cheios, os bytes que
// ficaram à espera no portátil e durante quantos ms (Infinity se não veio mais nada).
function retencoes (escritas, sossegoUs) {
  const fio = noFio(escritas)
  const lista = []
  let desdeOCurto = 0 // bytes desde o último pacote pequeno
  let retidos = 0
  for (let i = 0; i < fio.length; i++) {
    desdeOCurto += fio[i].n
    const parado = i + 1 < fio.length ? fio[i + 1].ini - fio[i].fim : Infinity
    if (parado <= sossegoUs) continue
    if (desdeOCurto % PACOTE !== 0) {
      retidos = 0 // o pacote pequeno liberta tudo
    } else {
      retidos += desdeOCurto
      lista.push({ bytes: retidos, ms: parado / 1000 })
    }
    desdeOCurto = 0
  }
  return lista
}

// A regra da caixa: as mesmas escritas, com os fins de linha a mais que ela junta a cada uma.
function comARegra (escritas) {
  let fim = -Infinity
  let desde = [] // bytes escritos desde cada sítio onde a ponte pode ter despachado
  return escritas.map((e) => {
    const parado = e.t - fim
    if (desde.length === 0 || parado >= SOSSEGA_US) {
      desde = [0] // começa aqui, de certeza
    } else if (parado > 0) {
      if (desde.length === INICIOS) desde.splice(1, 1) // cheio: sai o mais antigo dos duvidosos
      desde.push(0) // a ponte pode ter despachado nesta pausa, ou não
    }
    desde = desde.map(d => d + e.n)
    let aMais = 0
    if (desde.some(d => d % PACOTE === 0)) {
      aMais = 1
      while (aMais < PACOTE && desde.some(d => (d + aMais) % PACOTE === 0)) aMais++
      desde = desde.map(d => d + aMais)
    }
    fim = Math.max(e.t, fim) + (e.n + aMais) * US_POR_BYTE
    return { t: e.t, n: e.n + aMais }
  })
}

module.exports = { PACOTE, SOSSEGA_US, INICIOS, US_POR_BYTE, noFio, retencoes, comARegra }
