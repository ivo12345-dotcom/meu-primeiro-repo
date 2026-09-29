'use strict'
// A sonda do gasóleo a fingir: razão sonda/alimentação com uma curva NÃO linear
// inventada (a boia de braço num depósito irregular) e o balanço do gasóleo,
// que cresce com o adorno e a velocidade. A tabela do dev usa esta mesma curva.

const razaoSimulada = (litros) => 0.10 + 0.60 * Math.sqrt(Math.max(0, Math.min(200, litros)) / 200)

// Pontos de calibração que correspondem à curva (para a configuração do dev).
const TABELA_SIMULADA = [0, 5, 10, 20, 40, 60, 80, 120, 160, 200].map(l => ({ razao: Math.round(razaoSimulada(l) * 10000) / 10000, litros: l }))

// { litros, alimentacao (V), roll (rad), sog (m/s), aleatorio () → 0..1 }
function tensoesSonda ({ litros, alimentacao, roll = 0, sog = 0, aleatorio = Math.random }) {
  const balanco = 0.01 + 0.08 * Math.min(1, Math.abs(roll) / (20 * Math.PI / 180)) + 0.01 * Math.min(1, sog / 3)
  const razao = Math.max(0.05, razaoSimulada(litros) + (aleatorio() * 2 - 1) * balanco)
  return { sonda: razao * alimentacao, alimentacao }
}

module.exports = { razaoSimulada, TABELA_SIMULADA, tensoesSonda }
