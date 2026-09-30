'use strict'
// A previsão ao longo da rota (Open-Meteo): um pedido forecast e um marine com
// vários pontos (até 60 por pedido), 48 h, horas em UTC, vento e corrente em nós.
// tempo(lat, lon, t): o ponto de previsão mais perto no espaço, linear no tempo,
// ângulos por seno e cosseno. Cada ponto fica arquivado em previsoes/ no formato
// da Parte 2 (para a AI aprender); sem rede, lê-se o arquivo mais recente que cubra a rota.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('./costa')

const H = 3600000
const MAX_PONTOS = 60
const TEMPO_LIMITE_MS = 30000
const CASCAIS = Object.freeze({ lat: 38.69, lon: -9.42 }) // nível do mar para as preia-mares
const FORECAST = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'visibility', 'shortwave_radiation']
const MARINE = ['wave_height', 'wave_period', 'wave_direction', 'ocean_current_velocity', 'ocean_current_direction', 'sea_level_height_msl']
// campo nosso ← variável da Open-Meteo
const CAMPOS = {
  tws: 'wind_speed_10m', twd: 'wind_direction_10m', rajada: 'wind_gusts_10m', chuva: 'precipitation', visibilidade: 'visibility', radiacao: 'shortwave_radiation',
  ondas: 'wave_height', periodo: 'wave_period', ondasDir: 'wave_direction', corrente: 'ocean_current_velocity', correnteDir: 'ocean_current_direction', nivel: 'sea_level_height_msl'
}
const ANGULOS = new Set(['twd', 'ondasDir', 'correnteDir'])
const DO_TEMPO = ['tws', 'rajada', 'twd', 'chuva', 'visibilidade', 'radiacao', 'ondas', 'periodo', 'ondasDir', 'corrente', 'correnteDir']
const R3 = (x) => Math.round(x * 1000) / 1000

// Os pontos da previsão: a linha de 5 MN de ~10 em ~10 MN entre a partida e o destino,
// mais a partida, o destino e (para a maré) Cascais.
function pontosPrevisao (linha, { partida, destino, passoMn = 10, cascais = true }) {
  const pts = [c.P(partida)]
  if (linha) {
    const sA = c.projetar(linha, c.P(partida)).s
    const sB = c.projetar(linha, c.P(destino)).s
    const n = Math.max(1, Math.round(Math.abs(sB - sA) / passoMn))
    for (let k = 0; k <= n; k++) pts.push(c.posicao(linha, sA + (sB - sA) * k / n))
  }
  pts.push(c.P(destino))
  if (cascais) pts.push(CASCAIS)
  const out = []
  for (const p of pts) {
    const q = { lat: R3(p.lat), lon: R3(p.lon) }
    if (!out.some(o => c.distanciaMn(o, q) < 1)) out.push(q)
  }
  return out
}

// Os URLs, um par (forecast, marine) por cada grupo de até 60 pontos.
function urls (pontos, { horas = 48 } = {}) {
  const grupos = []
  for (let i = 0; i < pontos.length; i += MAX_PONTOS) {
    const g = pontos.slice(i, i + MAX_PONTOS)
    const q = `latitude=${g.map(p => R3(p.lat)).join(',')}&longitude=${g.map(p => R3(p.lon)).join(',')}`
    grupos.push({
      pontos: g,
      forecast: `https://api.open-meteo.com/v1/forecast?${q}&hourly=${FORECAST.join(',')}&wind_speed_unit=kn&timezone=UTC&forecast_hours=${horas}`,
      // wind_speed_unit=kn também põe a corrente em nós; cell_selection=sea evita as células de terra
      marine: `https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join(',')}&timezone=UTC&forecast_hours=${horas}&cell_selection=sea&wind_speed_unit=kn`
    })
  }
  return grupos
}

const PARA_NOS = { kn: 1, 'km/h': 1 / 1.852, 'm/s': 3600 / 1852, mph: 1609.344 / 1852 }

// Uma resposta (de um ponto) → { t: [ms], campo: [...] }; horas em UTC pelo utc_offset_seconds.
function serie (resp, variaveis) {
  const h = resp?.hourly
  if (!h?.time) return null
  const off = (resp.utc_offset_seconds || 0) * 1000
  const out = { t: h.time.map(x => Date.parse(x + 'Z') - off) }
  for (const [campo, v] of Object.entries(CAMPOS)) {
    if (!variaveis.includes(v) || !h[v]) continue
    const u = resp.hourly_units?.[v]
    const f = (v === 'wind_speed_10m' || v === 'wind_gusts_10m' || v === 'ocean_current_velocity') ? (PARA_NOS[u] ?? 1) : 1
    out[campo] = h[v].map(x => (x == null ? null : x * f))
  }
  return out
}

// As respostas (listas, ou um objeto com um só ponto) → a previsão.
// { obtida, inicio, fim, pontos: [{ lat, lon, t: [ms], tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir, nivel }] }
function interpretar (pontos, forecast, marine, obtida) {
  const fc = Array.isArray(forecast) ? forecast : [forecast]
  const mr = marine == null ? [] : Array.isArray(marine) ? marine : [marine]
  if (fc.length !== pontos.length) throw new Error(`a Open-Meteo devolveu ${fc.length} pontos em vez de ${pontos.length}`)
  const out = pontos.map((p, i) => {
    const v = serie(fc[i], FORECAST)
    if (!v) throw new Error('resposta da Open-Meteo sem dados horários')
    const m = serie(mr[i], MARINE)
    const iMar = new Map((m?.t || []).map((t, k) => [t, k]))
    const reg = { lat: p.lat, lon: p.lon, t: v.t }
    for (const campo of Object.keys(CAMPOS)) {
      if (campo in v) reg[campo] = v[campo]
      else reg[campo] = v.t.map(t => { const k = iMar.get(t); return k === undefined || !m[campo] ? null : m[campo][k] })
    }
    return reg
  })
  const inicio = Math.max(...out.map(p => p.t[0]))
  const fim = Math.min(...out.map(p => p.t.at(-1)))
  return { obtida: new Date(obtida).toISOString(), inicio, fim, pontos: out }
}

async function pedirJson (fetchFn, url) {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  if (!r.ok) throw new Error(`Open-Meteo respondeu ${r.status}`)
  return r.json()
}

// Descarrega a previsão para os pontos. O mar é opcional (sem ele, ondas e corrente a null).
async function obterPrevisao ({ pontos, agora = Date.now(), fetch: fetchFn = fetch, horas = 48 }) {
  const partes = []
  for (const g of urls(pontos, { horas })) {
    const forecast = await pedirJson(fetchFn, g.forecast)
    let marine = null
    try { marine = await pedirJson(fetchFn, g.marine) } catch { marine = null }
    partes.push(interpretar(g.pontos, forecast, marine, agora))
  }
  return juntar(partes)
}

function juntar (partes) {
  if (partes.length === 1) return partes[0]
  const pontos = partes.flatMap(p => p.pontos)
  return { obtida: partes[0].obtida, inicio: Math.max(...partes.map(p => p.inicio)), fim: Math.min(...partes.map(p => p.fim)), pontos }
}

// Interpolação linear com nulls: se um lado falta, fica o outro.
function lin (a, b, f) {
  if (a == null) return b ?? null
  if (b == null) return a
  return a + (b - a) * f
}
function linAngulo (a, b, f) {
  if (a == null) return b ?? null
  if (b == null) return a
  const s = Math.sin(a * Math.PI / 180) * (1 - f) + Math.sin(b * Math.PI / 180) * f
  const co = Math.cos(a * Math.PI / 180) * (1 - f) + Math.cos(b * Math.PI / 180) * f
  return c.norm(Math.atan2(s, co) * 180 / Math.PI)
}

// tempo(lat, lon, t) → { tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir }
// Fora das horas da previsão fica na primeira ou na última (quem chama vê previsao.inicio/fim).
function criarTempo (previsao) {
  const pts = previsao.pontos
  const cache = new Map()
  const maisPerto = (lat, lon) => {
    const k = `${Math.round(lat * 100)}|${Math.round(lon * 100)}`
    let i = cache.get(k)
    if (i === undefined) {
      let melhor = Infinity
      const p = { lat, lon }
      pts.forEach((q, j) => { const d = c.distanciaMn(p, q); if (d < melhor) { melhor = d; i = j } })
      cache.set(k, i)
    }
    return pts[i]
  }
  return function tempo (lat, lon, t) {
    const p = maisPerto(lat, lon)
    const T = p.t
    let i = 0
    if (t >= T.at(-1)) i = T.length - 1
    else if (t > T[0]) { let lo = 0; let hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m } i = lo }
    const j = Math.min(i + 1, T.length - 1)
    const f = j > i ? Math.max(0, Math.min(1, (t - T[i]) / (T[j] - T[i]))) : 0
    const out = {}
    for (const campo of DO_TEMPO) {
      const s = p[campo]
      out[campo] = s ? (ANGULOS.has(campo) ? linAngulo(s[i], s[j], f) : lin(s[i], s[j], f)) : null
    }
    return out
  }
}

// A série do nível do mar no ponto mais perto de Cascais (para lib/mare.js).
function nivelDoMar (previsao, ponto = CASCAIS) {
  let melhor = null
  for (const p of previsao.pontos) {
    const d = c.distanciaMn(ponto, p)
    if (p.nivel?.some(x => x != null) && (!melhor || d < melhor.d)) melhor = { p, d }
  }
  if (!melhor || melhor.d > 10) return null
  return { t: melhor.p.t, nivel: melhor.p.nivel, distanciaMn: melhor.d }
}

// ---------- arquivo (formato da Parte 2) ----------

const horaIso = (t) => new Date(t).toISOString().slice(0, 19) + 'Z'
const nomeArquivo = (obtida, lat, lon) => `${new Date(obtida).toISOString().slice(0, 16).replace(':', '-')}-${R3(lat).toFixed(3)}_${R3(lon).toFixed(3)}.json.gz`

// { obtida, lat, lon, horas, tws, rajada, twd, ondas, periodo, ondasDir } de um ponto.
function registoParte2 (obtida, p) {
  return { obtida: new Date(obtida).toISOString(), lat: p.lat, lon: p.lon, horas: p.t.map(horaIso), tws: p.tws, rajada: p.rajada, twd: p.twd, ondas: p.ondas, periodo: p.periodo, ondasDir: p.ondasDir }
}

function escreverAtomico (f, dados) {
  // .tmp com fsync e só depois a troca: um corte de luz não deixa meia previsão
  const fd = fs.openSync(f + '.tmp', 'w')
  try {
    fs.writeSync(fd, dados)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(f + '.tmp', f)
}

// Um ficheiro por ponto: previsoes/AAAA-MM-DDTHH-MM-<lat>_<lon>.json.gz. Devolve os caminhos.
function guardarArquivo (pasta, previsao) {
  fs.mkdirSync(pasta, { recursive: true })
  return previsao.pontos.map(p => {
    const f = path.join(pasta, nomeArquivo(previsao.obtida, p.lat, p.lon))
    escreverAtomico(f, zlib.gzipSync(JSON.stringify(registoParte2(previsao.obtida, p))))
    return f
  })
}

// Sem rede: para cada ponto preciso, a previsão guardada mais recente a ≤ raioMn que cubra
// [desde, ate]. Serve também os ficheiros do plugin da AI (um ponto, AAAA-MM-DDTHH-MM.json.gz).
// → { previsao, obtida, idadeH, aviso: null | 'aviso' | 'grande', texto } ou { erro }.
function lerArquivo (pasta, { pontos, desde, ate, agora = Date.now(), raioMn = 15, maxIdadeH = 48 }) {
  let nomes = []
  try { nomes = fs.readdirSync(pasta).filter(n => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}.*\.json(\.gz)?$/.test(n)) } catch { nomes = [] }
  const obtidaDoNome = (n) => Date.parse(`${n.slice(0, 13)}:${n.slice(14, 16)}:00Z`)
  const cand = nomes.map(n => ({ n, obtida: obtidaDoNome(n) }))
    .filter(x => x.obtida <= agora && agora - x.obtida <= maxIdadeH * H)
    .sort((a, b) => b.obtida - a.obtida || (a.n < b.n ? -1 : 1))
  const lidos = new Map()
  const ler = (n) => {
    if (!lidos.has(n)) {
      try {
        const b = fs.readFileSync(path.join(pasta, n))
        lidos.set(n, JSON.parse(n.endsWith('.gz') ? zlib.gunzipSync(b) : b))
      } catch { lidos.set(n, null) }
    }
    return lidos.get(n)
  }
  const escolhidos = []
  for (const p of pontos) {
    // a obtenção mais recente que sirva e, dentro dela, o ponto mais perto
    let achou = null
    for (const x of cand) {
      if (achou && x.obtida < achou.obtida) break
      const r = ler(x.n)
      if (!r || !Array.isArray(r.horas) || !r.horas.length) continue
      const d = c.distanciaMn(p, r)
      if (d > raioMn) continue
      const t0 = Date.parse(r.horas[0]); const t1 = Date.parse(r.horas.at(-1))
      if (t0 > desde || t1 < ate) continue
      if (!achou || d < achou.d) achou = { ...x, r, d }
    }
    if (!achou) return { erro: 'não há previsão guardada que cubra a rota' }
    if (!escolhidos.some(e => e.n === achou.n)) escolhidos.push(achou)
  }
  const obtida = Math.min(...escolhidos.map(e => e.obtida))
  const pts = escolhidos.map(({ r }) => {
    const reg = { lat: r.lat, lon: r.lon, t: r.horas.map(h => Date.parse(h)) }
    for (const campo of Object.keys(CAMPOS)) reg[campo] = Array.isArray(r[campo]) ? r[campo] : reg.t.map(() => null)
    return reg
  })
  const idadeH = (agora - obtida) / H
  const aviso = idadeH > 12 ? 'grande' : idadeH > 6 ? 'aviso' : null
  const h = Math.round(idadeH)
  const texto = aviso === 'grande' ? `Previsão velha: a mais recente guardada tem ${h} h (sem rede)` : aviso ? `Previsão guardada há ${h} h (sem rede)` : null
  return {
    previsao: { obtida: new Date(obtida).toISOString(), inicio: Math.max(...pts.map(p => p.t[0])), fim: Math.min(...pts.map(p => p.t.at(-1))), pontos: pts },
    obtida: new Date(obtida).toISOString(),
    idadeH,
    aviso,
    texto
  }
}

module.exports = { MAX_PONTOS, CASCAIS, FORECAST, MARINE, pontosPrevisao, urls, interpretar, obterPrevisao, criarTempo, nivelDoMar, nomeArquivo, registoParte2, guardarArquivo, lerArquivo }
