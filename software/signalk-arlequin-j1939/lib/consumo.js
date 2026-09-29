'use strict'
// Consumo estimado do D1-20 a partir das rotações: curva "Fuel Consumption,
// at calculated propeller load exp. 3" da ficha técnica da Volvo Penta
// (lida do gráfico, 29/09/2026). As 850 rpm (ralenti) são extrapoladas.
// É uma estimativa com um hélice teórico: calibrar com o depósito (fator).

const CURVA = [
  [850, 0.4], [1200, 0.5], [1400, 0.7], [1600, 0.9], [1800, 1.0], [2000, 1.3],
  [2200, 1.6], [2400, 2.0], [2600, 2.4], [2800, 3.0], [3000, 3.7], [3200, 4.6]
]

function litrosHora (rpm, fator = 1) {
  if (!(rpm > 300)) return 0
  if (rpm <= CURVA[0][0]) return CURVA[0][1] * fator
  for (let i = 1; i < CURVA.length; i++) {
    const [r1, l1] = CURVA[i]
    if (rpm <= r1) {
      const [r0, l0] = CURVA[i - 1]
      return (l0 + (l1 - l0) * (rpm - r0) / (r1 - r0)) * fator
    }
  }
  return CURVA[CURVA.length - 1][1] * fator
}

const m3s = (lh) => lh / 3600 / 1000

module.exports = { CURVA, litrosHora, m3s }
