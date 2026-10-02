'use strict'
// Pontos de desistência (desenho 3a): de 5 em 5 MN ao longo da rota e ao passar cada cabo
// (os pontos da linha de costa onde o rumo roda mais de 30°). Em cada um:
//   - o abrigo mais perto da lista (abrigo: true), pela rota do mar (lib/rotas.js a 5 MN,
//     ou 8 MN, com o vento previsto à hora do ponto: a rota direta perto da costa só com vento
//     de terra; ou direto se o troço não tocar em terra nem em zonas), a distância, a hora a
//     que lá se chega a motor (rpmCruzeiro, cenário provável: quem chama dá a função eta) e
//     o ângulo ao vento previsto nessa perna ("a favor", "de través", "contra");
//   - voltar à partida (se a partida é um porto da lista), da mesma maneira.
// Fugas junto à costa (decisão do Ivo de 30/09, "Mostrar sempre"): primeiro a fuga pela linha
// dos 5 MN (ou 8, ou o troço reto) que passa a regra do vento de terra; se só houver a fuga junto
// à costa (< 3 MN / direta) com vento do mar, aparece na mesma, NUNCA escondida, com o
// avisoVermelho "fuga junto à costa com vento do mar (a sotavento) — só em último recurso: …".
// As exclusões duras (terra, zonas a evitar) continuam: sem fuga nenhuma, o ponto diz porquê
// (semAbrigo / semVolta: "sem fuga possível daqui: …").
// Resumo: "até às HH:MM ainda voltas a X com vento a favor" — o último ponto em que voltar à
// partida (no mar: ao abrigo do 1.º ponto) tem vento a favor ou de través, por uma fuga sem aviso.
// Os pontos antes dele sem essa fuga (junto à costa, ou sem fuga nenhuma) não se saltam em
// silêncio: "…, exceto junto ao Cabo Raso às 07:30, onde a fuga é junto à costa com vento do mar".
//
// O vento da perna: |TWA| entre a direção do vento (corrigida, P50) no ponto e à hora, e o
// rumo direto do ponto ao porto do abrigo (o fim da aproximação; o largo pode já ter ficado para trás). < 60° contra; 60°–120° de través; > 120° a favor.
//
// Os cabos são detetados na geometria da rota fora dos portos (as ligações e a linha de costa;
// cabosDaRota): o rumo 2 MN antes contra o rumo 2 MN depois (a linha tem vértices de ~1 MN e
// um cabo largo roda aos poucos). Os nomes vêm de
// uma lista curta de cabos da costa continental (posições aproximadas; o mais perto a ≤ 10 MN).

const { setImmediate: ceder } = require('node:timers/promises')
const c = require('./costa')
const rotas = require('./rotas')

const PADRAO = Object.freeze({ passoMn: 5, anguloCabo: 30, janelaCaboMn: 2, amostraCaboMn: 0.5, juntarCaboMn: 10, candidatos: 2, fuso: 'Europe/Lisbon' })

const AVISO_COSTA = 'fuga junto à costa com vento do mar (a sotavento) — só em último recurso'
const AVISO_COSTA_SEM_VENTO = 'fuga junto à costa sem vento previsto — só em último recurso'
const SEM_FUGA = 'sem fuga possível daqui'

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
  const nomeados = out.map(g => {
    const m = g.max
    let nome = null; let d = 10
    for (const k of CABOS) { const dk = c.distanciaMn(m, k); if (dk <= d) { d = dk; nome = k.nome } }
    return { s: m.s, lat: m.lat, lon: m.lon, rodaGraus: m.roda, nome }
  })
  // o mesmo cabo dobrado em várias voltas seguidas (a linha contorna-o aos bocados): fica a maior
  const juntos = []
  for (const k of nomeados) {
    const ant = juntos.at(-1)
    if (ant && k.nome && ant.nome === k.nome && Math.abs(k.s - ant.s) <= o.juntarCaboMn) { if (k.rodaGraus > ant.rodaGraus) juntos[juntos.length - 1] = k } else juntos.push(k)
  }
  return juntos
}

// Os cabos da rota: na parte fora dos portos (do largo da partida ao largo do destino: as
// ligações e a linha de costa). Mede-se na geometria da rota e não só na linha de costa,
// porque a ligação do largo à linha também dobra cabos (de Cascais para norte, a rota
// liga-se à linha já a norte do Cabo da Roca).
// Cada cabo leva também milhasRota: as milhas desde o início da rota (para os sítios irem pela ordem
// da rota, horasNosSitios).
function cabosDaRota (pontosRota, opcoes = {}) {
  const i0 = pontosRota.findIndex(p => p.perna === 'ligacao')
  let i1 = -1
  for (let i = pontosRota.length - 1; i >= 0; i--) if (pontosRota[i].perna === 'ligacao' || pontosRota[i].perna === 'linha') { i1 = i; break }
  if (i0 < 1 || i1 <= i0) return []
  const sub = pontosRota.slice(i0 - 1, i1 + 1)
  const linha = c.prepararLinha(sub)
  let antes = 0
  for (let i = 1; i < i0; i++) antes += c.distanciaMn(pontosRota[i - 1], pontosRota[i])
  return linha.total > 0 ? cabos(linha, 0, linha.total, opcoes).map(k => ({ ...k, milhasRota: antes + k.s })) : []
}

// A passagem "perto" de um sítio: o corredor dos bordos é de ±0,7 MN à volta da perna.
const PERTO_MN = 1.5
// A hora de cada sítio (auditoria M-08): pela ordem da rota (milhas), o ponto da linha do tempo mais
// perto PARA A FRENTE do do sítio anterior — a 1.ª aproximação (a ≤ PERTO_MN), não a mais perto de
// todas: numa ida e volta (ou à volta das Berlengas) a volta pode passar mais perto e roubava a hora
// da ida. → os sítios pela ordem dada, cada um com { i, t } (−1 e null sem linha do tempo).
function horasNosSitios (sitios, linhaTempo) {
  const ordem = sitios.map((s, k) => ({ s, k })).sort((a, b) => (a.s.milhasRota ?? a.s.milhas ?? 0) - (b.s.milhasRota ?? b.s.milhas ?? 0) || a.k - b.k)
  const out = new Array(sitios.length)
  let desde = 0
  for (const { s, k } of ordem) {
    let melhor = -1; let d = Infinity
    for (let i = desde; i < linhaTempo.length; i++) {
      const di = c.distanciaMn(s, linhaTempo[i])
      if (di < d) { d = di; melhor = i } else if (d <= PERTO_MN && di > d + 0.25) break
    }
    out[k] = { ...s, i: melhor, t: melhor >= 0 ? linhaTempo[melhor].t : null }
    if (melhor >= 0) desde = melhor
  }
  return out
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

// O aviso vermelho de uma fuga que a regra do vento de terra recusava (motivo: o texto do rotas.js).
function avisoCosta (motivo) {
  const aviso = /não há vento previsto/.test(motivo) ? AVISO_COSTA_SEM_VENTO : AVISO_COSTA
  return `${aviso}: ${motivo.replace(/^vento do mar em parte da rota: /, '')}`
}

// O troço reto de recurso: do ponto ao largo de d e a aproximação. Só se não tocar em terra nem
// em zonas; a regra do vento de terra corre nele como na rota direta do rotas.js (ventoDoMar,
// com a distância mínima à terra no troço do ponto ao largo). → { pontos, milhas, motivoVento } | null
function trocoReto (costa, p, d, { twd, horaPartida }) {
  const largo = c.P(d.largo)
  if (costa.verificarTroco(p, largo)) return null
  const ap = d.aproximacao.map(c.P)
  const pontos = [{ ...p, perna: null, nome: 'Desistência' }, ...ap.map((q, i) => ({ ...q, perna: i === 0 ? 'ligacao' : 'aproximacao', costaLivre: true, nome: i === ap.length - 1 ? d.nome : undefined }))]
  let milhas = 0
  for (let i = 1; i < pontos.length; i++) milhas += c.distanciaMn(pontos[i - 1], pontos[i])
  const n = Math.max(1, Math.ceil(c.distanciaMn(p, largo) / 0.1))
  let costaMinMn = Infinity
  for (let k = 0; k <= n; k++) costaMinMn = Math.min(costaMinMn, costa.distanciaTerra({ lat: p.lat + (largo.lat - p.lat) * k / n, lon: p.lon + (largo.lon - p.lon) * k / n }, 50))
  const motivoVento = rotas.ventoDoMar(costa, { direto: true, pontos, costaMinMn }, { twd, horaPartida })
  return { pontos, milhas, motivoVento }
}

// A fuga de p até ao destino d. twd(lat, lon, t), horaPartida (a hora no ponto) e log vão para o
// rotas.gerarRota, como no cálculo. Por esta ordem:
//   1. a rota do rotas.js a 5 MN, ou a 8 MN, com a regra do vento de terra (a direta perto da
//      costa só com vento de terra);
//   2. o troço reto de recurso, se passar a mesma regra;
//   3. só se a regra do vento a recusou: a mesma rota sem a regra (junto à costa), com o aviso
//      vermelho — nunca escondida (decisão do Ivo de 30/09); ou o troço reto com o aviso;
//   4. sem fuga: o porquê (as exclusões duras do rotas.js: terra, zonas a evitar, sem passagem).
// → { pontos, milhas, avisoVermelho: null | texto } | { semFuga: motivo }
function rotaAte (costa, p, d, { twd, horaPartida, log } = {}) {
  const motivos = []
  let motivoVento = null
  for (const af of [5, 8]) {
    const r = rotas.gerarRota(costa, { partida: p, destino: d, afastamento: af, twd, horaPartida, log })
    if (!r.excluida) return { pontos: r.pontos, milhas: r.milhas, avisoVermelho: null }
    if (r.porVento) motivoVento ??= r.motivo
    else motivos.push(r.motivo)
  }
  const reto = trocoReto(costa, p, d, { twd, horaPartida })
  if (reto && !reto.motivoVento) return { pontos: reto.pontos, milhas: reto.milhas, avisoVermelho: null }
  if (motivoVento) {
    // sem a regra (afastamentoVentoTerra 0): as outras verificações do rotas.js ficam todas
    for (const af of [5, 8]) {
      const r = rotas.gerarRota(costa, { partida: p, destino: d, afastamento: af, twd, horaPartida, log, opcoes: { afastamentoVentoTerra: 0 } })
      if (!r.excluida) return { pontos: r.pontos, milhas: r.milhas, avisoVermelho: avisoCosta(motivoVento) }
    }
  }
  if (reto) return { pontos: reto.pontos, milhas: reto.milhas, avisoVermelho: avisoCosta(reto.motivoVento) }
  return { semFuga: [...new Set(motivos)].join('; ') || 'não há rota' }
}

// Para um ponto e hora: ir para o destino d. eta(pontos, t) → ms da chegada; twd(lat, lon, t); log.
// → a fuga { id, nome, milhas, chegada, rumo, twa, vento, avisoVermelho } | { semFuga: motivo }
function irPara (costa, p, t, d, { eta, twd, log }) {
  const r = rotaAte(costa, p, d, { twd, horaPartida: t, log })
  if (r.semFuga) return r
  const rumo = c.vetor(p, c.P(d.aproximacao.at(-1))).rumo // direto ao porto (o largo pode ficar para trás)
  const v = ventoNaPerna(twd(p.lat, p.lon, t), rumo)
  let chegada = null
  try { chegada = eta(r.pontos, t) } catch { chegada = null }
  return { id: d.id, nome: d.nome, milhas: r.milhas, chegada: Number.isFinite(chegada) ? new Date(chegada).toISOString() : null, rumo, twa: v.twa, vento: v.texto, avisoVermelho: r.avisoVermelho }
}

// A melhor de duas fugas: a sem aviso vermelho primeiro (a linha dos 5 MN antes da costa), depois a mais curta.
const melhorFuga = (a, b) => !b || (!!a.avisoVermelho - !!b.avisoVermelho || a.milhas - b.milhas) < 0

// Onde fica um ponto, para o resumo: "junto ao Cabo Raso às 07:30", "às 08:31 (10 MN feitas)".
function ondeFica (x) {
  // "junto ao Cabo Raso", "junto à Ponta de Sagres" (lib/costa.js sitio, auditoria M-19)
  if (x.tipo === 'cabo') return x.nome ? `${c.sitio.junto(x.nome)} às ${x.hora}` : `num cabo às ${x.hora}`
  return `às ${x.hora} (${String(Math.round(x.milhas * 10) / 10).replace('.', ',')} MN feitas)`
}

// Porque é que um ponto não tem uma fuga sem aviso: r a fuga (com aviso) ou null; sem o semAbrigo/semVolta.
function porqueBuraco (r, sem) {
  if (r) return r.avisoVermelho.startsWith(AVISO_COSTA_SEM_VENTO) ? 'a fuga é junto à costa sem vento previsto' : 'a fuga é junto à costa com vento do mar'
  return `não há fuga possível: ${String(sem).replace(`${SEM_FUGA}: `, '')}`
}

// O resumo. itens: [{ x (o ponto), r (a fuga que conta: voltar, ou no mar o abrigo), sem }]; alvo: o nome.
function resumir (itens, alvo) {
  if (!itens.length) return 'sem pontos de desistência nesta rota'
  const limpa = (r) => r && !r.avisoVermelho
  const buracos = (lista) => lista.filter(({ r }) => !limpa(r)).map(({ x, r, sem }) => ({ onde: ondeFica(x), porque: porqueBuraco(r, sem) }))
  const atencao = (lista) => { const b = buracos(lista); return b.length ? `; atenção: ${b.map(k => `${k.onde} ${k.porque}`).join('; ')}` : '' }
  if (!alvo) return `${SEM_FUGA} para nenhum abrigo (${itens[0].sem.replace(`${SEM_FUGA}: `, '')})`
  const doAlvo = itens.filter(({ r }) => limpa(r) && r.nome === alvo)
  const bons = doAlvo.filter(({ r }) => r.vento === 'a favor' || r.vento === 'de través')
  if (bons.length) {
    const ult = bons.at(-1)
    const b = buracos(itens.slice(0, itens.indexOf(ult)))
    return `até às ${ult.x.hora} ainda voltas ${c.sitio.a(alvo)} com vento ${ult.r.vento}${b.length ? `, exceto ${b.map(k => `${k.onde}, onde ${k.porque}`).join('; e ')}` : ''}`
  }
  if (doAlvo.length) return `voltar ${c.sitio.a(alvo)} é sempre contra o vento${atencao(itens)}`
  if (itens.some(({ r }) => r && r.nome === alvo)) return `${c.sitio.para(alvo)} só há fuga junto à costa, em último recurso${atencao(itens.filter(({ r }) => !r))}`
  const primeiro = itens.find(({ r }) => !r)
  return `${SEM_FUGA} ${c.sitio.para(alvo)}: ${primeiro.sem.replace(`${SEM_FUGA}: `, '')}`
}

// costa; rota: a alternativa (lib/rotas.js: { pontos, afastamento, linha: { de, ate } });
// linhaTempo: os pontos do cenário provável (lib/passagem.js); partida: o porto de partida (destino da
// lista) ou null; eta(pontos, t) e twd(lat, lon, t) do cenário provável; log(msg, erro) (o registo
// dos erros de programação da geometria; no plugin, app.error).
// Assíncrona: cede o event loop em cada ponto (cada um gera várias rotas), para o SignalK não parar.
// → Promise<{ pontos: [{ t, hora, tipo: 'marco' | 'cabo', nome?, lat, lon, milhas, abrigo, voltar, semAbrigo, semVolta }], resumo }>
//   abrigo/voltar: a fuga (com avisoVermelho null ou o texto) ou null; semAbrigo/semVolta: null ou
//   "sem fuga possível daqui: …" (voltar null e semVolta null: não há partida para onde voltar).
async function pontosDesistencia ({ costa, rota, linhaTempo, partida = null, destino = null, eta, twd, log, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const hm = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: o.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const abrigos = costa.destinos.filter(d => d.abrigo) // o próprio destino também conta, se for abrigo
  // os sítios: marcos de 5 em 5 MN e cabos
  const sitios = marcos(rota.pontos, o.passoMn).map(m => ({ ...m, tipo: 'marco' }))
  for (const k of cabosDaRota(rota.pontos, o)) sitios.push({ lat: k.lat, lon: k.lon, tipo: 'cabo', nome: k.nome, rodaGraus: k.rodaGraus, milhasRota: k.milhasRota })
  // a hora em cada sítio: o ponto da linha do tempo mais perto para a frente do do sítio anterior
  // (pela ordem da rota; horasNosSitios)
  const comHora = horasNosSitios(sitios, linhaTempo).filter(s => s.t != null).sort((a, b) => a.t - b.t)
  const out = []
  for (const s of comHora) {
    await ceder()
    const p = { lat: s.lat, lon: s.lon }
    const perto = abrigos.map(d => ({ d, mn: c.distanciaMn(p, c.P(d.largo)) })).sort((a, b) => a.mn - b.mn).slice(0, o.candidatos)
    let abrigo = null
    const semMotivos = []
    for (const { d } of perto) {
      const r = irPara(costa, p, s.t, d, { eta, twd, log })
      if (r.semFuga) semMotivos.push(r.semFuga)
      else if (melhorFuga(r, abrigo)) abrigo = r
    }
    const volta = partida ? irPara(costa, p, s.t, partida, { eta, twd, log }) : null
    const milhasFeitas = s.milhas ?? null
    out.push({
      t: new Date(s.t).toISOString(),
      hora: hm(s.t),
      tipo: s.tipo,
      nome: s.nome ?? null,
      lat: s.lat,
      lon: s.lon,
      milhas: milhasFeitas,
      abrigo,
      voltar: volta && !volta.semFuga ? volta : null,
      semAbrigo: abrigo ? null : `${SEM_FUGA}: ${[...new Set(semMotivos)].join('; ') || 'não há abrigos na lista'}`,
      semVolta: volta?.semFuga ? `${SEM_FUGA}: ${volta.semFuga}` : null
    })
  }
  // o resumo: a volta à partida; no mar, o abrigo do 1.º ponto que o tenha
  const alvo = partida?.nome || out.find(x => x.abrigo)?.abrigo.nome || null
  const itens = partida ? out.map(x => ({ x, r: x.voltar, sem: x.semVolta })) : out.map(x => ({ x, r: x.abrigo, sem: x.semAbrigo }))
  return { pontos: out, resumo: resumir(itens, alvo) }
}

module.exports = { PADRAO, CABOS, ventoNaPerna, cabos, cabosDaRota, marcos, horasNosSitios, rotaAte, pontosDesistencia }
