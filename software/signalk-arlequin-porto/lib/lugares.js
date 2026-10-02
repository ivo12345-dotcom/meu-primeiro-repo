'use strict'
// Os portos e fundeadouros conhecidos (auditoria I-20, decisão n.º 24 do dono): o ponto de amarração só
// se grava sozinho junto a um deles — a menos de 1 km da boca ou do interior do porto —, nunca no mar.
// Os portos vêm dos destinos da rota (software/signalk-arlequin-rota/dados/destinos.json, a mesma lista
// das saídas da caixa negra; aqui só se lê): de cada um, os pontos da aproximação a partir do último
// antes da boca (a entrada, o canal e a marina). Os outros (fundeadouros, bóias, a Ericeira que a caixa
// negra também conhece) vêm da configuração do plugin. "Conhecido" quer dizer só "está na lista": não é
// o `conhecido` dos destinos da rota (os portos que o Ivo conhece de noite).

const fs = require('node:fs')
const path = require('node:path')

const DESTINOS_DA_ROTA = path.join(__dirname, '..', '..', 'signalk-arlequin-rota', 'dados', 'destinos.json')
const RAIO_LUGAR_M = 1000
const EXTRAS = Object.freeze([{ nome: 'Ericeira', latitude: 38.9630, longitude: -9.4180 }])

const R = 6371000
const GRAU = Math.PI / 180
const valido = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180

// destinos da rota ([{ nome, aproximacao: [[lat, lon]], entrada }]) → [{ nome, pontos: [{ latitude, longitude }] }]
function lugaresDosDestinos (destinos) {
  const out = []
  for (const d of Array.isArray(destinos) ? destinos : []) {
    const ap = Array.isArray(d?.aproximacao) ? d.aproximacao : []
    const desde = Math.max(0, (Number.isInteger(d?.entrada) ? d.entrada : 0) - 1)
    const pontos = ap.slice(desde).filter(p => Array.isArray(p) && valido(p[0], p[1])).map(p => ({ latitude: p[0], longitude: p[1] }))
    if (pontos.length) out.push({ nome: String(d.nome || d.id || 'porto'), pontos })
  }
  return out
}

// → { lugares, erro: null | texto }
function lerDestinosDaRota (ficheiro = DESTINOS_DA_ROTA) {
  try {
    return { lugares: lugaresDosDestinos(JSON.parse(fs.readFileSync(ficheiro, 'utf8'))), erro: null }
  } catch (e) {
    return { lugares: [], erro: `não li os portos dos destinos da rota (${ficheiro}): ${e.code || e.message}` }
  }
}

// [{ nome, latitude, longitude }] da configuração → [{ nome, pontos }] (os mal escritos ficam de fora)
function lugaresDaConfiguracao (lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter(x => x && valido(Number(x.latitude), Number(x.longitude)))
    .map(x => {
      const latitude = Number(x.latitude)
      const longitude = Number(x.longitude)
      return { nome: String(x.nome || '').trim() || `lugar ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, pontos: [{ latitude, longitude }] }
    })
}

// metros, numa projeção plana à volta de pos (chega para uns quilómetros)
function plano (p, ref) {
  return { x: (p.longitude - ref.longitude) * GRAU * Math.cos(ref.latitude * GRAU) * R, y: (p.latitude - ref.latitude) * GRAU * R }
}
function aoTroco (a, b) { // distância da origem ao troço a–b
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0
  return Math.hypot(a.x + t * dx, a.y + t * dy)
}
function distanciaAoLugar (pos, lugar) {
  const pts = lugar.pontos.map(p => plano(p, pos))
  if (pts.length === 1) return Math.hypot(pts[0].x, pts[0].y)
  let melhor = Infinity
  for (let i = 1; i < pts.length; i++) melhor = Math.min(melhor, aoTroco(pts[i - 1], pts[i]))
  return melhor
}

// o nome do lugar conhecido a menos de `raio` m da posição, ou null
function lugarPerto (pos, lugares, raio = RAIO_LUGAR_M) {
  if (!pos || !valido(pos.latitude, pos.longitude)) return null
  let melhor = null
  for (const l of lugares) {
    const d = distanciaAoLugar(pos, l)
    if (d <= raio && (!melhor || d < melhor.d)) melhor = { nome: l.nome, d }
  }
  return melhor ? melhor.nome : null
}

module.exports = { DESTINOS_DA_ROTA, RAIO_LUGAR_M, EXTRAS, lugaresDosDestinos, lerDestinosDaRota, lugaresDaConfiguracao, distanciaAoLugar, lugarPerto }
