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
// As horas de previsão pedidas (48): também o horizonte das partidas e o limite de uma passagem
// (lib/calculo.js, lib/passagem.js; auditoria I-19 e M-20: um só número)
const HORAS_PREVISAO = 48
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
function urls (pontos, { horas = HORAS_PREVISAO } = {}) {
  const grupos = []
  for (let i = 0; i < pontos.length; i += MAX_PONTOS) {
    const g = pontos.slice(i, i + MAX_PONTOS)
    const q = `latitude=${g.map(p => R3(p.lat)).join(',')}&longitude=${g.map(p => R3(p.lon)).join(',')}`
    grupos.push({
      pontos: g,
      // cell_selection=sea nos DOIS pedidos (auditoria K-05): a omissão da Open-Meteo é `land`, que
      // ao largo de Cascais e na barra do Tejo serve o vento de uma célula colada à costa (ou em
      // terra) e o subestima ~40 % (02/10, a 5 MN de terra: 8,4 nós com `land`, 14,5 com `sea`).
      forecast: `https://api.open-meteo.com/v1/forecast?${q}&hourly=${FORECAST.join(',')}&wind_speed_unit=kn&timezone=UTC&forecast_hours=${horas}&cell_selection=sea`,
      // wind_speed_unit=kn também põe a corrente em nós
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
    const ehVelocidade = v === 'wind_speed_10m' || v === 'wind_gusts_10m' || v === 'ocean_current_velocity'
    // Nunca assumir nós silenciosamente: os pedidos pedem sempre wind_speed_unit=kn (ver
    // urls()), por isso uma resposta válida traz sempre 'kn' em hourly_units — uma unidade
    // em falta ou desconhecida é sinal de a Open-Meteo ter mudado de comportamento, e um
    // fator errado dava ventos/correntes errados sem aviso nenhum.
    if (ehVelocidade && PARA_NOS[u] === undefined) throw new Error(`unidade desconhecida da Open-Meteo: ${u ?? '(nenhuma)'}`)
    const f = ehVelocidade ? PARA_NOS[u] : 1
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

// Descarrega a previsão para os pontos. O mar é opcional (sem ele, ondas e corrente a null); com o
// pedido do mar falhado a previsão leva marFalhou: true (auditoria M-11: quem chama pode juntar as
// ondas da previsão guardada mais recente, juntarMarDoArquivo).
async function obterPrevisao ({ pontos, agora = Date.now(), fetch: fetchFn = fetch, horas = HORAS_PREVISAO }) {
  const partes = []
  let marFalhou = false
  for (const g of urls(pontos, { horas })) {
    const forecast = await pedirJson(fetchFn, g.forecast)
    let marine = null
    try { marine = await pedirJson(fetchFn, g.marine) } catch { marine = null; marFalhou = true }
    partes.push(interpretar(g.pontos, forecast, marine, agora))
  }
  const p = juntar(partes)
  return marFalhou ? { ...p, marFalhou: true } : p
}

// Com o pedido do mar falhado (marFalhou), as ondas (altura, período e direção: o que o arquivo
// guarda) da previsão guardada mais recente: para cada ponto sem ondas nenhumas, o ponto guardado
// mais perto a ≤ LIMITE_APROXIMADO_MN, hora a hora (as horas que a guardada não tem ficam null). A
// corrente e o nível do mar não se arquivam: ficam null (a maré do Tejo fica a 0, com o aviso).
// arquivada: a `previsao` de lerArquivo. → uma previsão nova com marDoArquivo (a hora da guardada),
// ou a mesma se não há nada a juntar.
function juntarMarDoArquivo (previsao, arquivada) {
  if (!previsao?.marFalhou || !Array.isArray(arquivada?.pontos) || !arquivada.pontos.length) return previsao
  const CAMPOS_MAR = ['ondas', 'periodo', 'ondasDir']
  let juntou = false
  const pontos = previsao.pontos.map(p => {
    if (p.ondas?.some(x => x != null)) return p
    const perto = arquivada.pontos.map(q => ({ q, mn: c.distanciaMn(p, q) })).filter(x => x.mn <= LIMITE_APROXIMADO_MN && x.q.ondas?.some(v => v != null)).sort((a, b) => a.mn - b.mn)[0]
    if (!perto) return p
    const indice = new Map(perto.q.t.map((t, k) => [t, k]))
    const novo = { ...p }
    for (const campo of CAMPOS_MAR) novo[campo] = p.t.map(t => { const k = indice.get(t); return k === undefined ? null : (perto.q[campo]?.[k] ?? null) })
    juntou = true
    return novo
  })
  return juntou ? { ...previsao, pontos, marDoArquivo: arquivada.obtida } : previsao
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

// tempo(lat, lon, t) → { tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir,
//   aproximado?: [campo,...], semDados?: [campo,...] }
// Fora das horas da previsão fica na primeira ou na última (quem chama vê previsao.inicio/fim).
// Por variável: se o ponto mais perto no espaço tiver null nessa hora (a Marine API devolve
// null perto de terra/baías mesmo com cell_selection=sea), tenta o ponto seguinte mais perto
// (entre os pontos pedidos para esta previsão) até achar um com dado — e marca esse campo em
// `aproximado`. Se nenhum ponto tiver dado, o campo fica null e entra em `semDados`.
// IMPORTANTE para quem consome isto (Tarefa 9, regras de segurança): `semDados` a conter
// 'ondas', 'rajada' ou 'tws' é "desconhecido", nunca "calmo" — falhar para o lado seguro
// (excluir a alternativa ou avisar), nunca tratar como se não houvesse onda/vento nenhum.
// O ponto seguinte só serve até LIMITE_APROXIMADO_MN (auditoria M-09): mais longe, o campo fica
// sem dados (o mar de dezenas de MN dali não é o deste ponto). A ordem dos pontos guarda-se por
// célula de 0,01° e mede-se do centro da célula: assim não depende de qual consulta chegou primeiro
// (antes era a da 1.ª consulta da célula, e uma consulta a mais noutro sítio mudava os resultados).
const LIMITE_APROXIMADO_MN = 15
function criarTempo (previsao) {
  const pts = previsao.pontos
  const cache = new Map()
  // os pontos pedidos ({ j, mn }), do mais perto do centro da célula de (lat, lon) para o mais longe
  const ordemPerto = (lat, lon) => {
    const la = Math.round(lat * 100); const lo = Math.round(lon * 100)
    const k = `${la}|${lo}`
    let ord = cache.get(k)
    if (ord === undefined) {
      const centro = { lat: la / 100, lon: lo / 100 }
      ord = pts.map((p, j) => ({ j, mn: c.distanciaMn(centro, p) })).sort((a, b) => a.mn - b.mn || a.j - b.j)
      cache.set(k, ord)
    }
    return ord
  }
  const valorNoPonto = (p, campo, t) => {
    const s = p[campo]
    if (!s) return null
    const T = p.t
    let i = 0
    if (t >= T.at(-1)) i = T.length - 1
    else if (t > T[0]) { let lo = 0; let hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m } i = lo }
    const j = Math.min(i + 1, T.length - 1)
    const f = j > i ? Math.max(0, Math.min(1, (t - T[i]) / (T[j] - T[i]))) : 0
    return ANGULOS.has(campo) ? linAngulo(s[i], s[j], f) : lin(s[i], s[j], f)
  }
  return function tempo (lat, lon, t) {
    const ord = ordemPerto(lat, lon)
    const out = {}
    const aproximado = []
    const semDados = []
    for (const campo of DO_TEMPO) {
      let valor = null
      for (let k = 0; k < ord.length; k++) {
        if (k > 0 && ord[k].mn > LIMITE_APROXIMADO_MN) break
        valor = valorNoPonto(pts[ord[k].j], campo, t)
        if (valor != null) { if (k > 0) aproximado.push(campo); break }
      }
      out[campo] = valor
      if (valor == null) semDados.push(campo)
    }
    if (aproximado.length) out.aproximado = aproximado
    if (semDados.length) out.semDados = semDados
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
  // fsync do directório-mãe: sem isto, nalguns sistemas de ficheiros um corte de luz
  // logo a seguir ao rename pode não persistir a troca de nome (mesmo com o .tmp já
  // sincronizado). No Windows abrir um directório com fs.openSync costuma falhar
  // (sem suporte) — ignora-se só esse erro, não se finge que o fsync aconteceu.
  try {
    const dfd = fs.openSync(path.dirname(f), 'r')
    try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
  } catch { /* plataforma sem fsync de directório (ex.: Windows) */ }
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
  // todos os candidatos (só exclui datas no futuro) e, dentro deles, os que cumprem o tecto
  // de maxIdadeH: uma previsão mais velha do que isso não cobre de forma fiável uma travessia
  // planeada, mas guarda-se `todos` para se poder dizer *porque* falhou (idade vs. cobertura).
  const todos = nomes.map(n => ({ n, obtida: obtidaDoNome(n) }))
    .filter(x => x.obtida <= agora)
    .sort((a, b) => b.obtida - a.obtida || (a.n < b.n ? -1 : 1))
  const cand = todos.filter(x => agora - x.obtida <= maxIdadeH * H)
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
  // a obtenção mais recente (de `lista`) que sirva para `p` e, dentro dela, o ponto mais perto
  const escolher = (lista, p) => {
    let achou = null
    for (const x of lista) {
      if (achou && x.obtida < achou.obtida) break
      const r = ler(x.n)
      if (!r || !Array.isArray(r.horas) || !r.horas.length) continue
      const d = c.distanciaMn(p, r)
      if (d > raioMn) continue
      const t0 = Date.parse(r.horas[0]); const t1 = Date.parse(r.horas.at(-1))
      if (t0 > desde || t1 < ate) continue
      if (!achou || d < achou.d) achou = { ...x, r, d }
    }
    return achou
  }
  const escolhidos = []
  for (const p of pontos) {
    const achou = escolher(cand, p)
    if (!achou) {
      // nada dentro do tecto de maxIdadeH: se sem esse tecto havia uma previsão que serviria
      // (posição e horas OK), a razão é mesmo a idade — dizer isso, não o genérico
      const semTecto = escolher(todos, p)
      if (semTecto) {
        const h = Math.round((agora - semTecto.obtida) / H)
        return { erro: `a última previsão guardada tem ${h} h (mais de ${maxIdadeH} h): sem previsão válida` }
      }
      return { erro: 'não há previsão guardada que cubra a rota' }
    }
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

module.exports = { MAX_PONTOS, HORAS_PREVISAO, CASCAIS, FORECAST, MARINE, pontosPrevisao, urls, interpretar, obterPrevisao, juntarMarDoArquivo, criarTempo, nivelDoMar, nomeArquivo, registoParte2, escreverAtomico, guardarArquivo, lerArquivo }
