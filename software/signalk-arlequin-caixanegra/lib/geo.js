'use strict'
// Distâncias em milhas e o porto mais perto (lista configurável no plugin).

const GRAU = Math.PI / 180

const PORTOS = [
  { nome: 'Peniche', lat: 39.3530, lon: -9.3770 },
  { nome: 'Algés (CNA)', lat: 38.6955, lon: -9.2330 },
  { nome: 'Oeiras', lat: 38.6780, lon: -9.3160 },
  { nome: 'Cascais', lat: 38.6925, lon: -9.4175 },
  { nome: 'Ericeira', lat: 38.9630, lon: -9.4180 },
  { nome: 'Nazaré', lat: 39.5845, lon: -9.0735 },
  { nome: 'Sesimbra', lat: 38.4410, lon: -9.1060 }
]

const lat = (p) => p.latitude ?? p.lat
const lon = (p) => p.longitude ?? p.lon

function distanciaMn (a, b) {
  const la1 = lat(a) * GRAU
  const la2 = lat(b) * GRAU
  const dla = la2 - la1
  const dlo = (lon(b) - lon(a)) * GRAU
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2
  return 2 * Math.asin(Math.sqrt(h)) * 3440.065
}

function portoMaisPerto (pos, portos = PORTOS) {
  if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) return null
  let melhor = null
  for (const p of portos) {
    const mn = distanciaMn(pos, p)
    if (!melhor || mn < melhor.mn) melhor = { nome: p.nome, mn }
  }
  return melhor
}

module.exports = { PORTOS, distanciaMn, portoMaisPerto }
