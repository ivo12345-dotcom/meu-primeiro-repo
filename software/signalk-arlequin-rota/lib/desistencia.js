'use strict'
// Pontos de desistência (desenho 3a): de 5 em 5 MN ao longo da rota e ao passar cada cabo
// (os pontos da linha de costa onde o rumo roda mais de 30°). Em cada um:
//   - o abrigo mais perto da lista (abrigo: true), pela rota do mar (lib/rotas.js a 5 MN,
//     ou 8 MN, com o vento previsto à hora do ponto: a rota direta perto da costa só com vento
//     de terra; ou direto se o troço não tocar em terra nem em zonas e o rotas.js não o recusou
//     pelo vento de terra), a distância, a hora a
//     que lá se chega a motor (rpmCruzeiro, cenário provável: quem chama dá a função eta) e
//     o ângulo ao vento previsto nessa perna ("a favor", "de través", "contra");
//   - voltar à partida (se a partida é um porto da lista), da mesma maneira.
// Resumo: "até às HH:MM ainda voltas a X com vento a favor" — o último ponto em que voltar à
// partida tem vento a favor ou de través.
//
// O vento da perna: |TWA| entre a direção do vento (corrigida, P50) no ponto e à hora, e o
// rumo direto do ponto ao porto do abrigo (o fim da aproximação; o largo pode já ter ficado para trás). < 60° contra; 60°–120° de través; > 120° a favor.
//
// Os cabos são detetados na geometria da rota fora dos portos (as ligações e a linha de costa;
// cabosDaRota): o rumo 2 MN antes contra o rumo 2 MN depois (a linha tem vértices de ~1 MN e
// um cabo largo roda aos poucos). Os nomes vêm de
// uma lista curta de cabos da costa continental (posições aproximadas; o mais perto a ≤ 10 MN).

const c = require('./costa')
const rotas = require('./rotas')

const PADRAO = Object.freeze({ passoMn: 5, anguloCabo: 30, janelaCaboMn: 2, amostraCaboMn: 0.5, candidatos: 2, fuso: 'Europe/Lisbon' })

// Posições aproximadas (conhecimento geral; só servem para dar nome ao cabo).
const CABOS = Object.freeze([
  { nome: 'Cabo Mondego', lat: 40.19, lon: -8.906 },
  { nome: 'Nazaré', lat: 39.604, lon: -9.085 },
  { nome: 'Cabo Carvoeiro', lat: 39.36, lon: -9.408 },
  { nome: 'Cabo da Roca', lat: 38.781, lon: -9.499 },
  { nome: 'Cabo Raso', lat: 38.709, lon: -9.486 },
  { nome: 'Cabo Espichel', lat: 38.414, lon: -9.216 },
  { nome: 'Cabo de Sines', lat: 37.955, lon: -8.887 },
  { nome: 'Cabo Sardão', lat: 37.6, lon: -8.816 },
  { nome: 'Cabo de São Vicente', lat: 37.023, lon: -8.997 },
  { nome: 'Ponta de Sagres', lat: 36.997, lon: -8.949 }
])

function ventoNaPerna (twd, rumo) {
  if (twd == null || !Number.isFinite(twd)) return { twa: null, texto: null }
  const twa = Math.abs(c.dif(twd, rumo))
  return { twa, texto: twa < 60 ? 'contra' : twa <= 120 ? 'de través' : 'a favor' }
}

// Os cabos na linha entre s1 e s2: [{ s, lat, lon, rodaGraus, nome }].
function cabos (linha, s1, s2, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const lo = Math.min(s1, s2); const hi = Math.max(s1, s2)
  const cand = []
  for (let s = lo; s <= hi + 1e-9; s += o.amostraCaboMn) {
    const a = c.posicao(linha, s - o.janelaCaboMn); const p = c.posicao(linha, s); const b = c.posicao(linha, s + o.janelaCaboMn)
    if (c.distanciaMn(a, p) < o.janelaCaboMn * 0.5 || c.distanciaMn(p, b) < o.janelaCaboMn * 0.5) continue
    const roda = Math.abs(c.dif(c.vetor(p, b).rumo, c.vetor(a, p).rumo))
    cand.push({ s, lat: p.lat, lon: p.lon, roda })
  }
  // grupos seguidos acima do limiar → o de maior rotação
  const out = []
  let grupo = null
  for (const x of cand) {
    if (x.roda > o.anguloCabo) {
      if (grupo && x.s - grupo.fim <= o.amostraCaboMn + 1e-9) { grupo.fim = x.s; if (x.roda > grupo.max.roda) grupo.max = x } else { grupo = { fim: x.s, max: x }; out.push(grupo) }
    }
  }
  return out.map(g => {
    const m = g.max
    let nome = null; let d = 10
    for (const k of CABOS) { const dk = c.distanciaMn(m, k); if (dk <= d) { d = dk; nome = k.nome } }
    return { s: m.s, lat: m.lat, lon: m.lon, rodaGraus: m.roda, nome }
  })
}

// Os cabos da rota: na parte fora dos portos (do largo da partida ao largo do destino: as
// ligações e a linha de costa). Mede-se na geometria da rota e não só na linha de costa,
// porque a ligação do largo à linha também dobra cabos (de Cascais para norte, a rota
// liga-se à linha já a norte do Cabo da Roca).
function cabosDaRota (pontosRota, opcoes = {}) {
  const i0 = pontosRota.findIndex(p => p.perna === 'ligacao')
  let i1 = -1
  for (let i = pontosRota.length - 1; i >= 0; i--) if (pontosRota[i].perna === 'ligacao' || pontosRota[i].perna === 'linha') { i1 = i; break }
  if (i0 < 1 || i1 <= i0) return []
  const sub = pontosRota.slice(i0 - 1, i1 + 1)
  const linha = c.prepararLinha(sub)
  return linha.total > 0 ? cabos(linha, 0, linha.total, opcoes) : []
}

// Pontos a cada passoMn ao longo da geometria da rota: [{ lat, lon, milhas }].
function marcos (pontosRota, passoMn) {
  const out = []
  let acum = 0
  let prox = passoMn
  for (let i = 1; i < pontosRota.length; i++) {
    const a = pontosRota[i - 1]; const b = pontosRota[i]
    const L = c.distanciaMn(a, b)
    while (L > 0 && prox <= acum + L) {
      const f = (prox - acum) / L
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, milhas: prox })
      prox += passoMn
    }
    acum += L
  }
  // o último marco a menos de metade do passo do fim não interessa (já se está a chegar)
  return out.filter(m => acum - m.milhas >= passoMn / 2)
}

// A rota do mar de p até ao destino d (5 MN, 8 MN ou direta). twd(lat, lon, t), horaPartida (a
// hora no ponto) e log vão para o rotas.gerarRota, como no cálculo: a rota direta perto da costa
// só com vento de terra. Sem rota do rotas.js, o troço reto do ponto ao largo — mas nunca quando
// o rotas.js a recusou pelo vento de terra (o troço reto contornava a regra).
// → { pontos, milhas } | null
function rotaAte (costa, p, d, { twd, horaPartida, log } = {}) {
  let porVento = false
  for (const af of [5, 8]) {
    const r = rotas.gerarRota(costa, { partida: p, destino: d, afastamento: af, twd, horaPartida, log })
    if (!r.excluida) return { pontos: r.pontos, milhas: r.milhas }
    if (r.porVento) porVento = true
  }
  if (porVento) return null
  const largo = c.P(d.largo)
  if (!costa.verificarTroco(p, largo)) {
    const ap = d.aproximacao.map(c.P)
    const pontos = [{ ...p, perna: null, nome: 'Desistência' }, ...ap.map((q, i) => ({ ...q, perna: i === 0 ? 'ligacao' : 'aproximacao', costaLivre: true, nome: i === ap.length - 1 ? d.nome : undefined }))]
    let milhas = 0
    for (let i = 1; i < pontos.length; i++) milhas += c.distanciaMn(pontos[i - 1], pontos[i])
    return { pontos, milhas }
  }
  return null
}

// Para um ponto e hora: ir para o destino d. eta(pontos, t) → ms da chegada; twd(lat, lon, t); log.
function irPara (costa, p, t, d, { eta, twd, log }) {
  const r = rotaAte(costa, p, d, { twd, horaPartida: t, log })
  if (!r) return null
  const rumo = c.vetor(p, c.P(d.aproximacao.at(-1))).rumo // direto ao porto (o largo pode ficar para trás)
  const v = ventoNaPerna(twd(p.lat, p.lon, t), rumo)
  let chegada = null
  try { chegada = eta(r.pontos, t) } catch { chegada = null }
  return { id: d.id, nome: d.nome, milhas: r.milhas, chegada: Number.isFinite(chegada) ? new Date(chegada).toISOString() : null, rumo, twa: v.twa, vento: v.texto }
}

// costa; rota: a alternativa (lib/rotas.js: { pontos, afastamento, linha: { de, ate } });
// linhaTempo: os pontos do cenário provável (lib/passagem.js); partida: o porto de partida (destino da
// lista) ou null; eta(pontos, t) e twd(lat, lon, t) do cenário provável; log(msg, erro) (o registo
// dos erros de programação da geometria; no plugin, app.error).
// → { pontos: [{ t, hora, tipo: 'marco' | 'cabo', nome?, lat, lon, milhas, abrigo, voltar }], resumo }
function pontosDesistencia ({ costa, rota, linhaTempo, partida = null, destino = null, eta, twd, log, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const hm = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: o.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const abrigos = costa.destinos.filter(d => d.abrigo) // o próprio destino também conta, se for abrigo
  // os sítios: marcos de 5 em 5 MN e cabos
  const sitios = marcos(rota.pontos, o.passoMn).map(m => ({ ...m, tipo: 'marco' }))
  for (const k of cabosDaRota(rota.pontos, o)) sitios.push({ lat: k.lat, lon: k.lon, tipo: 'cabo', nome: k.nome, rodaGraus: k.rodaGraus })
  // a hora em cada sítio: o ponto da linha do tempo mais perto (para a frente do anterior)
  const comHora = sitios.map(s => {
    let melhor = -1; let d = Infinity
    for (let i = 0; i < linhaTempo.length; i++) {
      const di = c.distanciaMn(s, linhaTempo[i])
      if (di < d) { d = di; melhor = i }
    }
    return { ...s, i: melhor, t: melhor >= 0 ? linhaTempo[melhor].t : null }
  }).filter(s => s.t != null).sort((a, b) => a.t - b.t)
  const out = []
  for (const s of comHora) {
    const p = { lat: s.lat, lon: s.lon }
    const perto = abrigos.map(d => ({ d, mn: c.distanciaMn(p, c.P(d.largo)) })).sort((a, b) => a.mn - b.mn).slice(0, o.candidatos)
    let abrigo = null
    for (const { d } of perto) {
      const r = irPara(costa, p, s.t, d, { eta, twd, log })
      if (r && (!abrigo || r.milhas < abrigo.milhas)) abrigo = r
    }
    const voltar = partida ? irPara(costa, p, s.t, partida, { eta, twd, log }) : null
    const milhasFeitas = s.milhas ?? null
    out.push({ t: new Date(s.t).toISOString(), hora: hm(s.t), tipo: s.tipo, nome: s.nome ?? null, lat: s.lat, lon: s.lon, milhas: milhasFeitas, abrigo, voltar })
  }
  // o resumo
  let resumo
  const alvo = partida?.nome || out[0]?.abrigo?.nome || null
  const lista = partida ? out.map(x => ({ x, r: x.voltar })) : out.map(x => ({ x, r: x.abrigo && x.abrigo.nome === alvo ? x.abrigo : null }))
  const bons = lista.filter(({ r }) => r && (r.vento === 'a favor' || r.vento === 'de través'))
  if (!alvo) resumo = 'Sem abrigo conhecido perto da rota.'
  else if (bons.length) {
    const ult = bons.at(-1)
    resumo = `até às ${ult.x.hora} ainda voltas a ${alvo} com vento ${ult.r.vento === 'a favor' ? 'a favor' : 'de través'}`
  } else if (lista.some(({ r }) => r)) resumo = `voltar a ${alvo} é sempre contra o vento`
  else resumo = `não há como voltar a ${alvo} pela costa`
  return { pontos: out, resumo }
}

module.exports = { PADRAO, CABOS, ventoNaPerna, cabos, cabosDaRota, marcos, rotaAte, pontosDesistencia }
