// Conversões SI → unidades de bordo e formatação pt-PT. Sem dado → "—".

import { hmLisboa } from './rota-texto.js'

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

// "34 min", "3 h 05". Os minutos totais arredondam-se primeiro (auditoria M-36: dava "60 min" e "1 h 60").
export function duracao (s) {
  if (!ok(s)) return '—'
  const t = Math.round(s / 60)
  if (t < 60) return `${t} min`
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`
}

// HH:MM na hora de Lisboa (auditoria I-31, decisão do Ivo n.º 22: nunca a hora local do browser, que no Pi
// em UTC dava uma hora a menos do que a faixa da rota no mesmo ecrã); "—" sem hora.
export const hora = (d) => hmLisboa(d)
