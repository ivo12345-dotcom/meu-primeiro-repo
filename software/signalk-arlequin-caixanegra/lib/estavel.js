'use strict'
// "Navegação estável" (só estas linhas ensinam a AI): 2 min seguidos com a proa
// a variar menos de 10°, velocidade na água acima de 1 nó, longe dos portos e
// com proa, velocidade e vento a dar valores. A mesma janela dá a rajada.

const JANELA_MS = 120000
const NO = 1852 / 3600
const GRAU = Math.PI / 180

function novaJanela () { return [] }

// amostra: { t (ms), proa (rad), stw (m/s), tws (m/s) }
function juntar (janela, amostra) {
  janela.push(amostra)
  while (janela.length && amostra.t - janela[0].t > JANELA_MS) janela.shift()
  return janela
}

function rajada (janela) {
  let m
  for (const a of janela) if (Number.isFinite(a.tws)) m = m === undefined ? a.tws : Math.max(m, a.tws)
  return m
}

function estavel (janela, { longeDoPorto }) {
  if (!longeDoPorto || janela.length < 2) return false
  if (janela[janela.length - 1].t - janela[0].t < JANELA_MS - 10000) return false
  const ref = janela[0].proa
  let lo = 0
  let hi = 0
  for (const a of janela) {
    if (!Number.isFinite(a.proa) || !Number.isFinite(a.stw) || !Number.isFinite(a.tws)) return false
    if (a.stw <= 1 * NO) return false
    let d = ((a.proa - ref) / GRAU) % 360
    if (d > 180) d -= 360
    if (d < -180) d += 360
    lo = Math.min(lo, d)
    hi = Math.max(hi, d)
  }
  return hi - lo < 10
}

module.exports = { novaJanela, juntar, rajada, estavel, JANELA_MS }
