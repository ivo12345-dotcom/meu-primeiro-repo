// Litros por milha = L/h ÷ nós. Sem andar (< 0,5 nó) não há valor.
const NO = 1852 / 3600

export function litrosPorMilha (lh, velMs) {
  if (typeof lh !== 'number' || typeof velMs !== 'number' || velMs < 0.5 * NO) return null
  return lh / (velMs / NO)
}
