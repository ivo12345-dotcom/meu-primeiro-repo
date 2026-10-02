'use strict'
// Proa verdadeira (rad, 0…2π): a navigation.headingTrue quando há; senão a
// navigation.headingMagnetic + a declinação (navigation.magneticVariation, positiva
// para leste, como no SignalK). As bússolas do barco (ST4000+, ST50) dão a proa
// magnética: sem isto, a janela do "estável" nunca tinha proa e a AI não aprendia
// nada (auditoria I-11). Sem declinação não há proa: a magnética nunca passa por
// verdadeira (2° de erro em Peniche mudavam o ângulo ao vento que a AI aprende).

const VOLTA = 2 * Math.PI
// A declinação é do sítio e muda devagar (décimas de grau em dezenas de milhas):
// vale durante 1 h, mesmo que só chegue de vez em quando (RMC, PGN 127258, derived-data).
const DECLINACAO_MAX_MS = 3600000

function proaVerdadeira ({ headingTrue, headingMagnetic, magneticVariation }) {
  if (Number.isFinite(headingTrue)) return headingTrue
  if (!Number.isFinite(headingMagnetic) || !Number.isFinite(magneticVariation)) return undefined
  return ((headingMagnetic + magneticVariation) % VOLTA + VOLTA) % VOLTA
}

module.exports = { proaVerdadeira, DECLINACAO_MAX_MS }
