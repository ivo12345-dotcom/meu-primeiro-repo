// CPA/TCPA com um plano local (equiretangular) à volta do nosso barco.
// Chega para distâncias AIS (dezenas de MN). Unidades SI: m, s, rad, m/s.
// Usado pelo ecrã e pelo plugin signalk-arlequin-ais (mesmo cálculo).

const M_POR_GRAU = 111320

export const LIMITES_AIS = Object.freeze({ cpa: 0.5 * 1852, tcpa: 20 * 60 })

const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const temPos = (p) => p && ok(p.latitude) && ok(p.longitude)

// barco: { position: {latitude, longitude}, cog (rad), sog (m/s) }
export function cpa (eu, ele) {
  if (!eu || !ele || !temPos(eu.position) || !temPos(ele.position)) return null
  if (!ok(eu.cog) || !ok(eu.sog) || !ok(ele.cog) || !ok(ele.sog)) return null

  const cosLat = Math.cos(eu.position.latitude * Math.PI / 180)
  const rx = (ele.position.longitude - eu.position.longitude) * M_POR_GRAU * cosLat
  const ry = (ele.position.latitude - eu.position.latitude) * M_POR_GRAU
  const vx = ele.sog * Math.sin(ele.cog) - eu.sog * Math.sin(eu.cog)
  const vy = ele.sog * Math.cos(ele.cog) - eu.sog * Math.cos(eu.cog)

  const distancia = Math.hypot(rx, ry)
  const marcacao = (Math.atan2(rx, ry) + 2 * Math.PI) % (2 * Math.PI)
  const v2 = vx * vx + vy * vy
  if (v2 < 1e-9) return { cpa: distancia, tcpa: 0, distancia, marcacao }

  const tcpa = -(rx * vx + ry * vy) / v2
  const cpaM = Math.hypot(rx + vx * tcpa, ry + vy * tcpa)
  return { cpa: cpaM, tcpa, distancia, marcacao }
}

// 'perigo' | 'atencao' | 'seguro' | 'afasta' | 'desconhecido'
export function classificar (r, lim = LIMITES_AIS) {
  if (!r) return 'desconhecido'
  if (r.tcpa < 0) return 'afasta'
  if (r.cpa < lim.cpa && r.tcpa < lim.tcpa) return 'perigo'
  if (r.cpa < lim.cpa) return 'atencao'
  return 'seguro'
}
