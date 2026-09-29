// Resumo da viagem: acumula distância, tempos, gasóleo, vento e pressão.
// O ecrã guarda-o no localStorage; "Nova viagem" começa outro.

const MAX_DT = 60 // s: buracos maiores não contam
const MIN_A_ANDAR = 0.5 * 1852 / 3600 // 0,5 nó

export function novaViagem (t0) {
  return {
    inicio: t0,
    ultimo: null,
    distancia: 0, // m
    tempoVela: 0, // s
    tempoMotor: 0, // s
    gasoleoL: 0,
    ventoMax: 0, // m/s
    pressaoInicial: null, // Pa
    pressaoFinal: null
  }
}

const ok = (v) => typeof v === 'number' && Number.isFinite(v)

// l: { t (ms), sog (m/s), motor (bool), fuelRate (m³/s), ventoReal (m/s), pressao (Pa) }
export function acumular (v, l) {
  const n = { ...v, ultimo: l.t }
  if (v.ultimo !== null) {
    const dt = (l.t - v.ultimo) / 1000
    if (dt > 0 && dt <= MAX_DT) {
      if (ok(l.sog)) n.distancia += l.sog * dt
      if (l.motor) n.tempoMotor += dt
      else if (ok(l.sog) && l.sog > MIN_A_ANDAR) n.tempoVela += dt
      if (l.motor && ok(l.fuelRate)) n.gasoleoL += l.fuelRate * dt * 1000
    }
  }
  if (ok(l.ventoReal)) n.ventoMax = Math.max(n.ventoMax, l.ventoReal)
  if (ok(l.pressao)) {
    if (n.pressaoInicial === null) n.pressaoInicial = l.pressao
    n.pressaoFinal = l.pressao
  }
  return n
}
