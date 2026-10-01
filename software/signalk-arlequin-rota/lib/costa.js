'use strict'
// A costa: terra (OSM), linhas a 3/5/8 MN, zonas a evitar e destinos (dados/).
// Ponto em terra, distância à terra, troços que cortam terra ou zonas, e as
// linhas de costa (projetar, andar ao longo, juntar-se, seguir).
//
// Posições em { lat, lon } (graus). Distâncias em milhas náuticas (MN).
// Os cruzamentos e o "ponto dentro" fazem-se em graus lon/lat: uma projeção
// equirretangular é afim, por isso não muda quem cruza quem. As distâncias usam
// um plano local à volta do ponto com as escalas do elipsoide WGS84 (a esfera
// errava 0,3% de leste para oeste, 0,015 MN a 5 MN), o que chega para uns 30 MN.
//
// A terra tem milhares de vértices: as arestas ficam numa grelha de 0,05°
// (~3 MN) montada uma vez; o "ponto em terra" usa só as arestas da faixa de
// latitude do ponto (raio para leste, conta cruzamentos).

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const GRAU = Math.PI / 180
const A_WGS = 6378137
const E2_WGS = 0.00669437999014

// MN por grau de latitude (ky) e de longitude (kx) à latitude dada (WGS84).
function escalas (lat) {
  const s = Math.sin(lat * GRAU)
  const w = 1 - E2_WGS * s * s
  const M = A_WGS * (1 - E2_WGS) / (w * Math.sqrt(w))
  const N = A_WGS / Math.sqrt(w)
  return { ky: M * GRAU / 1852, kx: N * Math.cos(lat * GRAU) * GRAU / 1852 }
}
const PASTA_DADOS = path.join(__dirname, '..', 'dados')

const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d } // graus, −180…180
function P (x) {
  const p = Array.isArray(x) ? { lat: x[0], lon: x[1] } : { lat: x?.lat, lon: x?.lon }
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) throw new Error(`coordenadas inválidas: ${JSON.stringify(x)}`)
  return p
}

// Distância (MN) e rumo (graus verdadeiros) de a para b, no plano local de a.
function vetor (a, b) {
  const { kx, ky } = escalas((a.lat + b.lat) / 2)
  const dx = (b.lon - a.lon) * kx
  const dy = (b.lat - a.lat) * ky
  return { mn: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy) / GRAU) }
}
const distanciaMn = (a, b) => vetor(a, b).mn

// Ponto a `mn` milhas de p no rumo dado.
function deslocar (p, rumo, mn) {
  const e = escalas(p.lat)
  const lat = p.lat + mn * Math.cos(rumo * GRAU) / e.ky
  return { lat, lon: p.lon + mn * Math.sin(rumo * GRAU) / escalas((p.lat + lat) / 2).kx }
}

// Distância (MN) de p ao segmento [a, b] e a fração t (0–1) do ponto mais perto.
function distanciaSegmento (p, a, b) {
  const { kx, ky } = escalas(p.lat)
  const ax = (a.lon - p.lon) * kx; const ay = (a.lat - p.lat) * ky
  const bx = (b.lon - p.lon) * kx; const by = (b.lat - p.lat) * ky
  const dx = bx - ax; const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
  return { mn: Math.hypot(ax + t * dx, ay + t * dy), t }
}

// Os segmentos [p1,p2] e [p3,p4] tocam-se (incluindo encostar e sobrepor). Em x=lon, y=lat.
function orient (ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return v > 1e-15 ? 1 : v < -1e-15 ? -1 : 0
}
function noSegmento (ax, ay, bx, by, cx, cy) {
  return Math.min(ax, bx) - 1e-12 <= cx && cx <= Math.max(ax, bx) + 1e-12 && Math.min(ay, by) - 1e-12 <= cy && cy <= Math.max(ay, by) + 1e-12
}
function segmentosTocam (x1, y1, x2, y2, x3, y3, x4, y4) {
  const o1 = orient(x1, y1, x2, y2, x3, y3)
  const o2 = orient(x1, y1, x2, y2, x4, y4)
  const o3 = orient(x3, y3, x4, y4, x1, y1)
  const o4 = orient(x3, y3, x4, y4, x2, y2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && noSegmento(x1, y1, x2, y2, x3, y3)) return true
  if (o2 === 0 && noSegmento(x1, y1, x2, y2, x4, y4)) return true
  if (o3 === 0 && noSegmento(x3, y3, x4, y4, x1, y1)) return true
  if (o4 === 0 && noSegmento(x3, y3, x4, y4, x2, y2)) return true
  return false
}

// Ponto dentro de um anel [[lat, lon], …] (paridade).
function dentroAnel (p, anel) {
  let dentro = false
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [yi, xi] = anel[i]; const [yj, xj] = anel[j]
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < xi + (p.lat - yi) * (xj - xi) / (yj - yi)) dentro = !dentro
  }
  return dentro
}

// ---------- a terra, com a grelha ----------

// aneis: lista de anéis [[lon, lat], …] (exteriores e buracos; a paridade trata dos buracos).
function criarTerra (aneis, celula = 0.05) {
  let n = 0
  for (const a of aneis) n += a.length
  const ar = new Float64Array(n * 4) // x1 y1 x2 y2 (lon, lat)
  let m = 0
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const anel of aneis) {
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i]; const b = anel[(i + 1) % anel.length]
      if (a[0] === b[0] && a[1] === b[1]) continue
      ar.set([a[0], a[1], b[0], b[1]], m * 4); m++
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1])
    }
  }
  if (!m) return { m: 0, arestas: ar, celula, x0: 0, y0: 0, nx: 0, ny: 0, celulas: [], faixas: [], marca: new Uint32Array(0), volta: 0 }
  const x0 = Math.floor(minX / celula) * celula - celula
  const y0 = Math.floor(minY / celula) * celula - celula
  const nx = Math.ceil((maxX - x0) / celula) + 2
  const ny = Math.ceil((maxY - y0) / celula) + 2
  const celulas = new Array(nx * ny)
  const faixas = Array.from({ length: ny }, () => [])
  for (let e = 0; e < m; e++) {
    const x1 = ar[e * 4]; const y1 = ar[e * 4 + 1]; const x2 = ar[e * 4 + 2]; const y2 = ar[e * 4 + 3]
    const ix1 = Math.floor((Math.min(x1, x2) - x0) / celula); const ix2 = Math.floor((Math.max(x1, x2) - x0) / celula)
    const iy1 = Math.floor((Math.min(y1, y2) - y0) / celula); const iy2 = Math.floor((Math.max(y1, y2) - y0) / celula)
    for (let iy = iy1; iy <= iy2; iy++) {
      faixas[iy].push(e)
      for (let ix = ix1; ix <= ix2; ix++) (celulas[iy * nx + ix] ||= []).push(e)
    }
  }
  return { m, arestas: ar, celula, x0, y0, nx, ny, celulas, faixas, marca: new Uint32Array(m), volta: 0 }
}

function emTerraGrelha (g, p) {
  const iy = Math.floor((p.lat - g.y0) / g.celula)
  if (iy < 0 || iy >= g.ny) return false
  const ar = g.arestas
  let dentro = false
  for (const e of g.faixas[iy]) {
    const x1 = ar[e * 4]; const y1 = ar[e * 4 + 1]; const x2 = ar[e * 4 + 2]; const y2 = ar[e * 4 + 3]
    if ((y1 > p.lat) !== (y2 > p.lat) && p.lon < x1 + (p.lat - y1) * (x2 - x1) / (y2 - y1)) dentro = !dentro
  }
  return dentro
}

// Visita cada aresta das células [ix1..ix2]×[iy1..iy2] uma só vez; fn(e) true pára.
function visitar (g, ix1, ix2, iy1, iy2, fn) {
  if (++g.volta === 0xffffffff) { g.marca.fill(0); g.volta = 1 }
  const v = g.volta
  for (let iy = Math.max(0, iy1); iy <= Math.min(g.ny - 1, iy2); iy++) {
    for (let ix = Math.max(0, ix1); ix <= Math.min(g.nx - 1, ix2); ix++) {
      const c = g.celulas[iy * g.nx + ix]
      if (!c) continue
      for (const e of c) {
        if (g.marca[e] === v) continue
        g.marca[e] = v
        if (fn(e)) return true
      }
    }
  }
  return false
}

// Distância (MN) do ponto à aresta mais perto; 0 em terra; Infinity se nada até maxMn.
function distanciaTerraGrelha (g, p, maxMn = 30) {
  if (!g.m) return Infinity
  if (emTerraGrelha(g, p)) return 0
  const ar = g.arestas
  const ix = Math.floor((p.lon - g.x0) / g.celula)
  const iy = Math.floor((p.lat - g.y0) / g.celula)
  const k = escalas(p.lat)
  const lado = g.celula * Math.min(k.kx, k.ky) // MN do lado mais curto da célula
  let melhor = Infinity
  const a = { lat: 0, lon: 0 }; const b = { lat: 0, lon: 0 }
  const medir = (e) => {
    a.lon = ar[e * 4]; a.lat = ar[e * 4 + 1]; b.lon = ar[e * 4 + 2]; b.lat = ar[e * 4 + 3]
    const d = distanciaSegmento(p, a, b).mn
    if (d < melhor) melhor = d
    return false
  }
  // Anéis de células à volta: depois do anel r, o que falta está a ≥ r × lado.
  if (++g.volta === 0xffffffff) { g.marca.fill(0); g.volta = 1 }
  const v = g.volta
  const cel = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= g.nx || cy >= g.ny) return
    const c = g.celulas[cy * g.nx + cx]
    if (!c) return
    for (const e of c) { if (g.marca[e] !== v) { g.marca[e] = v; medir(e) } }
  }
  for (let r = 0; ; r++) {
    if (r === 0) cel(ix, iy)
    else {
      for (let k = -r; k <= r; k++) { cel(ix + k, iy - r); cel(ix + k, iy + r) }
      for (let k = -r + 1; k <= r - 1; k++) { cel(ix - r, iy + k); cel(ix + r, iy + k) }
    }
    if (melhor <= r * lado) return melhor
    if (r * lado > maxMn) return melhor <= maxMn ? melhor : Infinity
    if (ix - r < 0 && iy - r < 0 && ix + r >= g.nx && iy + r >= g.ny) return melhor
  }
}

function cruzaTerraGrelha (g, a, b) {
  if (!g.m) return false
  if (emTerraGrelha(g, a) || emTerraGrelha(g, b)) return true
  const ar = g.arestas
  const ix1 = Math.floor((Math.min(a.lon, b.lon) - g.x0) / g.celula); const ix2 = Math.floor((Math.max(a.lon, b.lon) - g.x0) / g.celula)
  const iy1 = Math.floor((Math.min(a.lat, b.lat) - g.y0) / g.celula); const iy2 = Math.floor((Math.max(a.lat, b.lat) - g.y0) / g.celula)
  return visitar(g, ix1, ix2, iy1, iy2, (e) => segmentosTocam(a.lon, a.lat, b.lon, b.lat, ar[e * 4], ar[e * 4 + 1], ar[e * 4 + 2], ar[e * 4 + 3]))
}

// ---------- zonas ----------

function prepararZona (z) {
  const anel = z.poligono
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity
  for (const [la, lo] of anel) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo) }
  return { ...z, caixa: { minLat, maxLat, minLon, maxLon } }
}

function trocoTocaZona (z, a, b) {
  const c = z.caixa
  if (Math.max(a.lat, b.lat) < c.minLat || Math.min(a.lat, b.lat) > c.maxLat || Math.max(a.lon, b.lon) < c.minLon || Math.min(a.lon, b.lon) > c.maxLon) return false
  if (dentroAnel(a, z.poligono) || dentroAnel(b, z.poligono)) return true
  const anel = z.poligono
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    if (segmentosTocam(a.lon, a.lat, b.lon, b.lat, anel[j][1], anel[j][0], anel[i][1], anel[i][0])) return true
  }
  return false
}

// ---------- linhas de costa ----------
// Uma linha é { pts: [{lat, lon}], s: Float64Array (MN acumuladas), total }.
// As linhas dos dados vão de norte para sul (e depois para leste no Algarve):
// "sentido" +1 é no sentido dos índices, −1 ao contrário.

function prepararLinha (pontos) {
  const pts = pontos.map(P)
  const s = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + distanciaMn(pts[i - 1], pts[i])
  return { pts, s, total: s[pts.length - 1] }
}

function indiceEm (linha, s) {
  const S = linha.s
  if (s <= 0) return 0
  if (s >= linha.total) return S.length - 2
  let lo = 0; let hi = S.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m }
  return lo
}

// Posição a s MN do início da linha (limitada às pontas), com o rumo da linha nesse troço (sentido +1).
function posicao (linha, s) {
  const i = indiceEm(linha, s)
  const a = linha.pts[i]; const b = linha.pts[i + 1]
  const L = linha.s[i + 1] - linha.s[i]
  const f = L > 0 ? Math.max(0, Math.min(1, (s - linha.s[i]) / L)) : 0
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, s: Math.max(0, Math.min(linha.total, s)), i, rumo: vetor(a, b).rumo }
}

// O ponto da linha mais perto de p, com s entre de e ate (por omissão, a linha toda).
function projetar (linha, p, { de = 0, ate = linha.total } = {}) {
  const lo = Math.min(de, ate); const hi = Math.max(de, ate)
  let melhor = null
  const i1 = indiceEm(linha, lo); const i2 = indiceEm(linha, hi)
  for (let i = i1; i <= i2; i++) {
    const a = linha.pts[i]; const b = linha.pts[i + 1]
    const L = linha.s[i + 1] - linha.s[i]
    const { t } = distanciaSegmento(p, a, b)
    let s = linha.s[i] + t * L
    s = Math.max(lo, Math.min(hi, s))
    const q = posicao(linha, s)
    const d = distanciaMn(p, q)
    if (!melhor || d < melhor.dist) melhor = { ...q, dist: d }
  }
  return melhor
}

// Juntar-se à linha "à frente": o ponto mais perto de p entre de e ate cujo troço de p até lá
// faz no máximo anguloMax graus com o rumo da linha no sentido da viagem (anguloMax = 90
// dá o pé da perpendicular). Sem nenhum que sirva, o mais perto.
function juntar (linha, p, sentido, { de = sentido > 0 ? 0 : linha.total, ate = sentido > 0 ? linha.total : 0, anguloMax = 60, passo = 0.1 } = {}) {
  let melhor = null
  const n = Math.max(1, Math.ceil(Math.abs(ate - de) / passo))
  for (let k = 0; k <= n; k++) {
    const q = posicao(linha, de + (ate - de) * k / n)
    const v = vetor(p, q)
    const rumoViagem = sentido > 0 ? q.rumo : norm(q.rumo + 180)
    if (v.mn > 0.05 && Math.abs(dif(v.rumo, rumoViagem)) > anguloMax) continue
    if (!melhor || v.mn < melhor.dist) melhor = { ...q, dist: v.mn }
  }
  return melhor || projetar(linha, p, { de, ate })
}

// Pontos de rota ao longo da linha de s1 a s2 (qualquer sentido), com troços ≤ passoMax MN
// e sem se afastar da linha mais do que `tolerancia` MN nos vértices saltados.
function seguirLinha (linha, s1, s2, { passoMax = 2, tolerancia = 0.02 } = {}) {
  if (s1 === s2) { const q = posicao(linha, s1); return [{ lat: q.lat, lon: q.lon, s: q.s }] }
  const sentido = s2 >= s1 ? 1 : -1
  // vértices estritamente entre s1 e s2, no sentido da viagem
  const cand = [posicao(linha, s1)]
  if (sentido > 0) { for (let i = 0; i < linha.pts.length; i++) if (linha.s[i] > s1 && linha.s[i] < s2) cand.push({ ...linha.pts[i], s: linha.s[i] }) } else { for (let i = linha.pts.length - 1; i >= 0; i--) if (linha.s[i] < s1 && linha.s[i] > s2) cand.push({ ...linha.pts[i], s: linha.s[i] }) }
  cand.push(posicao(linha, s2))
  // divide os troços compridos para haver candidatos de passoMax em passoMax
  const densos = [cand[0]]
  for (let i = 1; i < cand.length; i++) {
    const L = Math.abs(cand[i].s - cand[i - 1].s)
    const n = Math.ceil(L / passoMax - 1e-9)
    for (let k = 1; k < n; k++) densos.push(posicao(linha, cand[i - 1].s + (cand[i].s - cand[i - 1].s) * k / n))
    densos.push(cand[i])
  }
  // guloso: do ponto atual, o mais longe possível sem passar passoMax nem a tolerância
  const out = [densos[0]]
  let i = 0
  while (i < densos.length - 1) {
    let j = i + 1
    for (let k = i + 2; k < densos.length; k++) {
      if (distanciaMn(densos[i], densos[k]) > passoMax + 1e-9) break
      let ok = true
      for (let m = i + 1; m < k && ok; m++) if (distanciaSegmento(densos[m], densos[i], densos[k]).mn > tolerancia) ok = false
      if (!ok) break
      j = k
    }
    out.push(densos[j])
    i = j
  }
  return out.map(q => ({ lat: q.lat, lon: q.lon, s: q.s }))
}

// ---------- a costa completa ----------

function criarCosta ({ terra, linhas = {}, zonas = [], destinos = [] }, { celula = 0.05 } = {}) {
  const aneis = []
  for (const f of terra?.features || []) {
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) for (const anel of poly) aneis.push(anel)
  }
  const grelha = criarTerra(aneis, celula)
  const zonasP = zonas.map(prepararZona)
  const linhasP = {}
  for (const [d, pts] of Object.entries(linhas)) linhasP[d] = prepararLinha(pts)

  const emTerra = (p) => emTerraGrelha(grelha, P(p))
  const distanciaTerra = (p, maxMn) => distanciaTerraGrelha(grelha, P(p), maxMn)
  const cruzaTerra = (a, b) => cruzaTerraGrelha(grelha, P(a), P(b))
  const zonaCruzada = (a, b) => zonasP.find(z => trocoTocaZona(z, P(a), P(b))) || null

  // null se o troço está livre; senão { motivo: 'terra' } ou { motivo: 'zona', zona }.
  function verificarTroco (a, b, { terra: vTerra = true, zonas: vZonas = true } = {}) {
    if (vTerra && cruzaTerra(a, b)) return { motivo: 'terra' }
    if (vZonas) { const z = zonaCruzada(a, b); if (z) return { motivo: 'zona', zona: z.nome } }
    return null
  }

  // Os troços da aproximação de um destino (do largo ao cais). A terra verifica-se em TODOS os
  // troços por omissão; só a partir da `entrada` (a boca do porto ou da barra) se dispensa, e só
  // nos destinos com `portoFechadoOsm: true` (o OSM fecha o rio/doca/bacia com terra ali dentro).
  function verificarAproximacao (destino) {
    const ap = destino.aproximacao.map(P)
    const entradaValida = Number.isInteger(destino.entrada) && destino.entrada >= 1 && destino.entrada <= ap.length - 1
    const entrada = entradaValida ? destino.entrada : ap.length - 1
    const problemas = []
    if (!entradaValida) problemas.push({ motivo: 'entrada inválida' })
    for (let i = 1; i < ap.length; i++) {
      const r = verificarTroco(ap[i - 1], ap[i], { terra: i <= entrada || !destino.portoFechadoOsm })
      if (r) problemas.push({ troco: i, ...r })
    }
    return problemas
  }

  const linha = (d) => linhasP[String(d)] || null

  // aneis: os da terra, em bruto ([[lon, lat], …]), para o mini-mapa (lib/mapa.js) desenhar a mesma costa
  return { grelha, aneis, zonas: zonasP, destinos, linhas: linhasP, linha, emTerra, distanciaTerra, cruzaTerra, zonaCruzada, verificarTroco, verificarAproximacao }
}

function lerGz (f) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f))) }

// Lê os ficheiros de dados/ (ou de outra pasta) e monta a costa.
function carregarCosta (pasta = PASTA_DADOS, opcoes) {
  return criarCosta({
    terra: lerGz(path.join(pasta, 'terra.geojson.gz')),
    linhas: lerGz(path.join(pasta, 'linhas-costa.json.gz')),
    zonas: JSON.parse(fs.readFileSync(path.join(pasta, 'zonas.json'), 'utf8')),
    destinos: JSON.parse(fs.readFileSync(path.join(pasta, 'destinos.json'), 'utf8'))
  }, opcoes)
}

module.exports = {
  PASTA_DADOS,
  escalas,
  norm,
  dif,
  P,
  vetor,
  distanciaMn,
  deslocar,
  distanciaSegmento,
  segmentosTocam,
  dentroAnel,
  prepararLinha,
  posicao,
  projetar,
  juntar,
  seguirLinha,
  criarCosta,
  carregarCosta
}
