'use strict'
// Nascer e pôr do sol calculados (algoritmo do NOAA Solar Calculator: posição do sol
// pelas séries de Meeus, zénite 90,833° = refração e raio do disco), para qualquer
// data e posição, sem rede. Erro típico < 1 min nas latitudes de Portugal.
// Horas em ms UTC.

const GRAU = Math.PI / 180
const DIA = 86400000

const seculoJuliano = (jd) => (jd - 2451545) / 36525

function sol (t) {
  const L0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const m = M * GRAU
  const C = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289
  const omega = (125.04 - 1934.136 * t) * GRAU
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * GRAU
  const seg = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
  const eps = (23 + (26 + seg / 60) / 60 + 0.00256 * Math.cos(omega)) * GRAU
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const y = Math.tan(eps / 2) ** 2
  const l0 = L0 * GRAU
  const eqTempo = 4 / GRAU * (y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m)) // min
  return { dec, eqTempo }
}

// Minutos UTC do nascer (nascer = true) ou do pôr, a partir do jd às 0 h UTC; null sem nascer/pôr.
function minutosEvento (nascer, jd0, lat, lon, minutos = 720) {
  const { dec, eqTempo } = sol(seculoJuliano(jd0 + minutos / 1440))
  const cosHA = Math.cos(90.833 * GRAU) / (Math.cos(lat * GRAU) * Math.cos(dec)) - Math.tan(lat * GRAU) * Math.tan(dec)
  if (cosHA > 1 || cosHA < -1) return null
  const ha = Math.acos(cosHA) / GRAU * (nascer ? 1 : -1)
  return 720 - 4 * (lon + ha) - eqTempo
}

// { nascer, por } (ms UTC) no dia UTC que contém `dia` (ms), na posição (graus, lon a leste +).
function nascerPor (dia, lat, lon) {
  const zero = Math.floor(dia / DIA) * DIA
  const jd0 = zero / DIA + 2440587.5
  const evento = (nascer) => {
    let m = minutosEvento(nascer, jd0, lat, lon)
    if (m == null) return null
    m = minutosEvento(nascer, jd0, lat, lon, m) // segunda passagem com o sol à hora do evento
    return m == null ? null : Math.round(zero + m * 60000)
  }
  return { nascer: evento(true), por: evento(false) }
}

// Listas de nasceres e pores (ms) para os dias de `desde` − 1 a `ate` + 1 (para passagem.noitePeloSol).
function nasceresPores (lat, lon, desde, ate) {
  const nasceres = []
  const pores = []
  for (let d = Math.floor(desde / DIA) * DIA - DIA; d <= ate + DIA; d += DIA) {
    const r = nascerPor(d, lat, lon)
    if (r.nascer != null && r.por != null) { nasceres.push(r.nascer); pores.push(r.por) }
  }
  return { nasceres, pores }
}

module.exports = { nascerPor, nasceresPores }
