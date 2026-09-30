'use strict'
// Maré na barra do Tejo. As preia-mares de Cascais saem da série horária
// sea_level_height_msl da Open-Meteo (máximos locais, com uma parábola pelos 3
// valores à volta de cada máximo). A corrente na barra é o modelo do simular.mjs
// (APROXIMADO): só a leste de 9°25' W, até 1,8 nó, vazante para 250° e enchente
// para 70°, estofo 45 min depois da preia-mar. Ao largo vale a corrente da Open-Meteo.

const MIN = 60000
const H = 3600000

// [{ t (ms), altura (m) }] das preia-mares, por ordem. Dois máximos a menos de
// `separacaoH` horas: fica o mais alto (o ruído de uma série quase plana não conta).
function preiaMares (t, nivel, { separacaoH = 6 } = {}) {
  const out = []
  for (let i = 1; i < nivel.length - 1; i++) {
    const y0 = nivel[i - 1]; const y1 = nivel[i]; const y2 = nivel[i + 1]
    if (y0 == null || y1 == null || y2 == null) continue
    if (!(y1 >= y0 && y1 > y2)) continue
    const den = y0 - 2 * y1 + y2
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0 // em passos (horas)
    const passo = (t[i + 1] - t[i - 1]) / 2
    const pm = { t: Math.round(t[i] + d * passo), altura: y1 - 0.25 * (y0 - y2) * d }
    const ant = out.at(-1)
    if (ant && pm.t - ant.t < separacaoH * H) { if (pm.altura > ant.altura) out[out.length - 1] = pm } else out.push(pm)
  }
  return out
}

const PADRAO = Object.freeze({ lonLimite: -9.42, vMax: 1.8, dirVazante: 250, dirEnchente: 70, estofoMin: 45, periodoH: 12.42 })

// correnteMare(lat, lon, t) → { v (nós), dir (graus, para onde vai) }.
// Entre dois estofos seguidos o ciclo dura o que vai de um ao outro; antes do
// primeiro e depois do último, periodoH (com uma só preia-mar é o simular.mjs tal e qual).
function criarMareTejo (preias, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const estofos = preias.map(p => p.t + o.estofoMin * MIN).sort((a, b) => a - b)
  return function correnteMare (lat, lon, t) {
    if (lon < o.lonLimite || !estofos.length) return { v: 0, dir: 0 }
    let fase
    let k = -1
    for (let i = 0; i < estofos.length; i++) if (estofos[i] <= t) k = i
    if (k >= 0 && k < estofos.length - 1) fase = 2 * Math.PI * (t - estofos[k]) / (estofos[k + 1] - estofos[k])
    else fase = 2 * Math.PI * (t - estofos[Math.max(0, k)]) / (o.periodoH * H)
    const v = o.vMax * Math.sin(fase)
    return v >= 0 ? { v, dir: o.dirVazante } : { v: -v, dir: o.dirEnchente }
  }
}

module.exports = { PADRAO, preiaMares, criarMareTejo }
