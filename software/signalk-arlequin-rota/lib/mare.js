'use strict'
// Maré na barra do Tejo. As preia-mares de Cascais saem da série horária
// sea_level_height_msl da Open-Meteo (máximos locais, com uma parábola pelos 3
// valores à volta de cada máximo). A corrente na barra é o modelo do simular.mjs
// (APROXIMADO): até 1,8 nó, vazante para 250° e enchente para 70°, estofo 45 min depois
// da preia-mar. SÓ NA BARRA E NO ESTUÁRIO DO TEJO: a caixa 38,60–38,72 N, 9,40–9,00 W
// (a barra a leste de 9°24' W, os Cachopos e o Bugio, o rio até Lisboa). O limite oeste fica a
// leste da marina de Cascais (9°25' W; decisão do Ivo n.º 8, auditoria M-12: a corrente fictícia é
// a da barra, não a da baía de Cascais; até 02/10 era 9,42 W e apanhava a entrada da marina por
// 0,003°). Fora dela (o resto da costa, de Caminha a VRSA) é 0: ao largo vale a corrente da
// Open-Meteo. O simular.mjs (Algés → Peniche, o resultado de referência de 29/09) usa esta mesma
// caixa, sem nada passado à mão, desde 03/10: a referência foi regravada com ela (chegada 05:03;
// era 05:01 com o limite oeste antigo de 9,42 W, e 05:00 até 01/10, quando a corrente se aplicava
// a tudo a leste de 9°25' W sem limite de latitude) (auditoria D-01, M-12).

const MIN = 60000
const H = 3600000

// [{ t (ms), altura (m) }] das preia-mares, por ordem. Dois máximos a menos de
// `separacaoH` horas: fica o mais alto (o ruído de uma série quase plana não conta).
// Um pico exatamente na primeira ou na última amostra da série nunca é reportado: a
// parábola usa os 3 pontos à volta do máximo (i-1, i, i+1), e nos extremos falta um deles,
// por isso não há como confirmar que é mesmo um máximo (podia continuar a subir fora da
// janela). É uma limitação aceite, não um bug — quem chama com uma janela curta (arquivo
// do plugin da AI, ou um [desde, ate] apertado) pode perder a preia-mar de uma ponta.
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

const PADRAO = Object.freeze({ latMin: 38.60, latMax: 38.72, lonMin: -9.40, lonMax: -9.00, vMax: 1.8, dirVazante: 250, dirEnchente: 70, estofoMin: 45, periodoH: 12.42 })

// correnteMare(lat, lon, t) → { v (nós), dir (graus, para onde vai) }.
// Entre dois estofos seguidos o ciclo dura o que vai de um ao outro; antes do
// primeiro e depois do último, periodoH (com uma só preia-mar é o simular.mjs tal e qual).
function criarMareTejo (preias, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const estofos = preias.map(p => p.t + o.estofoMin * MIN).sort((a, b) => a - b)
  return function correnteMare (lat, lon, t) {
    if (!(lat >= o.latMin && lat <= o.latMax && lon >= o.lonMin && lon <= o.lonMax) || !estofos.length) return { v: 0, dir: 0 }
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
