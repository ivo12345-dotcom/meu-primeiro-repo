'use strict'
// Quando treinar sozinho: o barco está parado (velocidade < 0,5 nó e motor
// parado) há 1 h e há uma saída terminada mais recente do que o último treino.

const NO = 1852 / 3600
const HORA = 3600000

function avaliarDisparo (e0, { agora, sog, rpm, ultimaSaidaMs, ultimoTreinoMs }) {
  const parado = !((sog ?? 0) >= 0.5 * NO) && !(rpm > 5)
  const e = { paradoDesde: parado ? (e0.paradoDesde ?? agora) : null }
  const treinar = parado && agora - e.paradoDesde >= HORA && (ultimaSaidaMs ?? 0) > (ultimoTreinoMs ?? 0)
  return { e, treinar }
}

module.exports = { avaliarDisparo }
