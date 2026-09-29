// Conversões SI → unidades de bordo e formatação pt-PT. Sem dado → "—".

export const nos = (ms) => ms * 3600 / 1852
export const graus = (rad) => rad * 180 / Math.PI
export const celsius = (k) => Math.round((k - 273.15) * 1e6) / 1e6
export const hpa = (pa) => pa / 100
export const mn = (m) => m / 1852

const ok = (v) => typeof v === 'number' && Number.isFinite(v)

export function num (v, casas = 0) {
  if (!ok(v)) return '—'
  const t = v.toFixed(casas)
  return (Number(t) === 0 ? (0).toFixed(casas) : t).replace('.', ',')
}

// Rumo verdadeiro com 3 dígitos: 035°
export function rumo (rad) {
  if (!ok(rad)) return '—'
  const g = ((Math.round(graus(rad)) % 360) + 360) % 360
  return `${String(g).padStart(3, '0')}°`
}

// Ângulo relativo com o bordo: negativo = BB (bombordo), positivo = EB.
export function anguloBordo (rad) {
  if (!ok(rad)) return '—'
  const g = Math.round(Math.abs(graus(rad)))
  if (g === 0 || g === 180) return `${g}°`
  return `${g}° ${rad < 0 ? 'BB' : 'EB'}`
}

export const velocidade = (ms, casas = 1) => ok(ms) ? num(nos(ms), casas) : '—'
export const distancia = (m, casas = 1) => ok(m) ? num(mn(m), casas) : '—'

export function duracao (s) {
  if (!ok(s)) return '—'
  if (s < 3600) return `${Math.round(s / 60)} min`
  const h = Math.floor(s / 3600)
  const m = Math.round((s - h * 3600) / 60)
  return `${h} h ${String(m).padStart(2, '0')}`
}

export function hora (d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
