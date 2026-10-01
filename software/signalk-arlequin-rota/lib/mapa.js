'use strict'
// O mini-mapa do resultado (desenho 3b-1, "Mini-mapa"): a janela, a terra recortada e simplificada,
// e as zonas a evitar dentro da janela. O ecrã desenha-o (public/lib/mapa.js); aqui só os dados.
//
// montarMapa(costa, { pontos }, opcoes) → { janela: { latMin, latMax, lonMin, lonMax },
//   terra: [[[lat, lon], …], …], zonas: [{ nome, tipo, pontos: [[lat, lon], …] }] }
//   costa: a de lib/costa.js (a mesma terra com que as rotas se verificam: costa.aneis, costa.zonas);
//   pontos: [[lat, lon], …] — as rotas, os rastos e os pontos de desistência. A janela abrange-os
//     com 10% de margem, e os que são mar na costa original continuam mar no contorno simplificado
//     (a simplificação nunca fecha uma enseada ou um porto por cima da rota);
//   opcoes: { margem: 0.1, toleranciaMn: 0.1, toleranciaMaxMn: 0.5, maxPontos: 2000, maxVoltas: 40, log }. Com mais
//     de maxPontos de terra, a tolerância sobe (× 1,5) até caber, mas nunca passa de toleranciaMaxMn
//     (com mais, os cabos e a Berlenga começavam a deformar-se); se nem assim couber, fica com os
//     pontos que tiver e regista-o; a subida pára ao fim de maxVoltas (40), também com registo. Uma
//     toleranciaMn que não seja um número > 0 é recusada (erro): a subida nunca sairia do sítio.
//     log(msg): o registo (no plugin, app.error), também quando a
//     proteção dos pontos não consegue repor um ponto no mar.
//   Os ilhéus mais pequenos do que a tolerância INICIAL saem (a subida da tolerância não os tira),
//     menos os que têm um ponto protegido lá dentro: pela paridade, um anel pequeno pode ser um
//     buraco (mar dentro de terra), e tirá-lo punha esse ponto em terra.
//
// A terra recorta-se à janela (Sutherland–Hodgman, que serve para anéis côncavos: as partes que
// saem e voltam ficam ligadas pela borda da janela, sem mudar o que é terra lá dentro) e
// simplifica-se com Douglas–Peucker num plano local em MN. As coordenadas arredondam-se a 1e-4°
// (~11 m) antes de simplificar, para a verificação dos pontos protegidos ser a do que se envia.

const c = require('./costa')

const PADRAO = Object.freeze({ margem: 0.1, toleranciaMn: 0.1, toleranciaMaxMn: 0.5, maxPontos: 2000, maxVoltas: 40, spanMin: 0.02 })
const r4 = (x) => Math.round(x * 1e4) / 1e4

// A janela que abrange os pontos [[lat, lon]], com a margem (fração de cada lado) e um tamanho mínimo.
function janela (pontos, margem = PADRAO.margem, spanMin = PADRAO.spanMin) {
  let latMin = Infinity; let latMax = -Infinity; let lonMin = Infinity; let lonMax = -Infinity
  for (const [lat, lon] of pontos) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat); lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon)
  }
  if (!Number.isFinite(latMin)) return null
  const alargar = (a, b) => {
    const s = b - a
    if (s * (1 + 2 * margem) >= spanMin) return [a - s * margem, b + s * margem]
    const meio = (a + b) / 2
    return [meio - spanMin / 2, meio + spanMin / 2]
  }
  const [la, lb] = alargar(latMin, latMax)
  const [oa, ob] = alargar(lonMin, lonMax)
  const r = (x) => Math.round(x * 1e6) / 1e6
  return { latMin: r(la), latMax: r(lb), lonMin: r(oa), lonMax: r(ob) }
}

// Recorta um anel GeoJSON [[lon, lat], …] à janela → [[lat, lon], …] (sem repetir o 1.º no fim).
function recortarAnel (anel, j) {
  let pts = anel.map(([lon, lat]) => [lat, lon])
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop()
  // as 4 bordas: [dentro(p), cruzamento(a, b)]
  const bordas = [
    [(p) => p[1] >= j.lonMin, (a, b) => { const t = (j.lonMin - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), j.lonMin] }],
    [(p) => p[1] <= j.lonMax, (a, b) => { const t = (j.lonMax - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), j.lonMax] }],
    [(p) => p[0] >= j.latMin, (a, b) => { const t = (j.latMin - a[0]) / (b[0] - a[0]); return [j.latMin, a[1] + t * (b[1] - a[1])] }],
    [(p) => p[0] <= j.latMax, (a, b) => { const t = (j.latMax - a[0]) / (b[0] - a[0]); return [j.latMax, a[1] + t * (b[1] - a[1])] }]
  ]
  for (const [dentro, cruzar] of bordas) {
    if (!pts.length) break
    const out = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]; const b = pts[i]
      const da = dentro(a); const db = dentro(b)
      if (db) { if (!da) out.push(cruzar(a, b)); out.push(b) } else if (da) out.push(cruzar(a, b))
    }
    pts = out
  }
  return pts
}

// Distância (no plano local, MN) do ponto p ao segmento [a, b]; pontos [lat, lon], esc: { kx, ky }.
function distSeg (p, a, b, esc) {
  const ax = a[1] * esc.kx; const ay = a[0] * esc.ky
  const dx = b[1] * esc.kx - ax; const dy = b[0] * esc.ky - ay
  const px = p[1] * esc.kx - ax; const py = p[0] * esc.ky - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0
  return Math.hypot(px - t * dx, py - t * dy)
}

// O vértice da cadeia i..j (exclusive; índices em volta do anel) mais longe do segmento [i, j].
function maisLonge (anel, i, j, esc) {
  const n = anel.length
  let k = -1; let d = -1
  for (let m = (i + 1) % n; m !== j; m = (m + 1) % n) {
    const dm = distSeg(anel[m], anel[i], anel[j], esc)
    if (dm > d) { d = dm; k = m }
  }
  return { k, d }
}

// Douglas–Peucker num anel fechado [[lat, lon]] → os índices que ficam, por ordem.
function simplificarAnel (anel, tolMn, esc) {
  const n = anel.length
  if (n <= 3) return anel.map((_, i) => i)
  // os dois pontos de partida: o 0 e o mais longe dele
  let b = 0; let d = -1
  for (let i = 1; i < n; i++) { const di = Math.hypot((anel[i][1] - anel[0][1]) * esc.kx, (anel[i][0] - anel[0][0]) * esc.ky); if (di > d) { d = di; b = i } }
  const fica = new Uint8Array(n)
  fica[0] = 1; fica[b] = 1
  const pilha = [[0, b], [b, 0]]
  while (pilha.length) {
    const [i, j] = pilha.pop()
    if ((i + 1) % n === j) continue
    const m = maisLonge(anel, i, j, esc)
    if (m.k >= 0 && m.d > tolMn) { fica[m.k] = 1; pilha.push([i, m.k], [m.k, j]) }
  }
  const out = []
  for (let i = 0; i < n; i++) if (fica[i]) out.push(i)
  return out
}

// Ponto { lat, lon } em terra pela paridade de todos os anéis [[lat, lon]].
const emTerra = (aneis, p) => aneis.reduce((s, a) => s + (c.dentroAnel(p, a) ? 1 : 0), 0) % 2 === 1

function caixa (pts) {
  let a = Infinity; let b = -Infinity; let x = Infinity; let y = -Infinity
  for (const [lat, lon] of pts) { a = Math.min(a, lat); b = Math.max(b, lat); x = Math.min(x, lon); y = Math.max(y, lon) }
  return { latMin: a, latMax: b, lonMin: x, lonMax: y }
}
const naCaixa = (k, p) => p.lat >= k.latMin && p.lat <= k.latMax && p.lon >= k.lonMin && p.lon <= k.lonMax

// O tamanho de um anel [[lat, lon]] (a diagonal da caixa, MN).
const tamanho = (a, esc) => { const k = caixa(a); return Math.hypot((k.lonMax - k.lonMin) * esc.kx, (k.latMax - k.latMin) * esc.ky) }

// Simplifica os anéis com a tolerância dada (um número, ou uma por anel) e repõe vértices até nenhum
// ponto protegido (mar na costa original) ficar em terra. → [[índices]] por anel. Se não conseguir
// (não há aresta a refinar, o que não devia acontecer), fica como está e regista-o por log(msg).
function simplificarProtegendo (aneis, tolMn, esc, protegidos, log) {
  const idx = aneis.map((a, r) => simplificarAnel(a, Array.isArray(tolMn) ? tolMn[r] : tolMn, esc))
  const desistir = (errados) => {
    log?.(`mini-mapa: ${errados.length} ponto(s) da rota ficam em terra no contorno simplificado`)
    return idx
  }
  let errados = []
  for (let volta = 0; volta < 10000; volta++) {
    const atual = idx.map((ix, r) => ix.map(i => aneis[r][i]))
    errados = protegidos.filter(p => emTerra(atual.filter(a => a.length >= 3), p))
    if (!errados.length) return idx
    let mudou = false
    for (const p of errados) {
      // a(s) aresta(s) que cobrem o ponto: a cadeia original i..j fechada pela aresta contém-no
      for (let r = 0; r < aneis.length; r++) {
        const ix = idx[r]; const anel = aneis[r]; const n = anel.length
        for (let q = 0; q < ix.length; q++) {
          const i = ix[q]; const j = ix[(q + 1) % ix.length]
          if ((i + 1) % n === j) continue
          const cadeia = []
          for (let m = i; ; m = (m + 1) % n) { cadeia.push(anel[m]); if (m === j) break }
          if (!naCaixa(caixa(cadeia), p) || !c.dentroAnel(p, cadeia)) continue
          const { k } = maisLonge(anel, i, j, esc)
          if (k < 0) continue
          ix.splice(q + 1, 0, k); ix.sort((x, y) => x - y)
          mudou = true
          break
        }
      }
    }
    if (!mudou) return desistir(errados)
  }
  return desistir(errados)
}

function montarMapa (costa, { pontos = [] } = {}, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  if (!(o.toleranciaMn > 0)) throw new Error('mini-mapa: a tolerância tem de ser um número maior do que 0 MN')
  const pts = pontos.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const j = janela(pts, o.margem, o.spanMin)
  if (!j) return null
  const esc = c.escalas((j.latMin + j.latMax) / 2)
  // os anéis da terra que tocam a janela, recortados e arredondados
  const aneis = []
  for (const anel of costa?.aneis || []) {
    let fora = true
    for (const [lon, lat] of anel) if (lat >= j.latMin && lat <= j.latMax && lon >= j.lonMin && lon <= j.lonMax) { fora = false; break }
    if (fora) {
      // um anel que envolve a janela toda (sem vértices lá dentro) também conta
      const k = caixa(anel.map(([lon, lat]) => [lat, lon]))
      if (k.latMax < j.latMin || k.latMin > j.latMax || k.lonMax < j.lonMin || k.lonMin > j.lonMax) continue
    }
    const rec = recortarAnel(anel, j).map(([lat, lon]) => [r4(lat), r4(lon)])
    const limpo = rec.filter((p, i) => { const q = rec[(i + rec.length - 1) % rec.length]; return rec.length === 1 || p[0] !== q[0] || p[1] !== q[1] })
    if (limpo.length >= 3) aneis.push(limpo)
  }
  // os pontos a proteger: os que são mar na terra recortada (a mesma que se simplifica)
  const protegidos = pts.map(([lat, lon]) => ({ lat, lon })).filter(p => !emTerra(aneis, p))
  // os ilhéus mais pequenos do que a tolerância inicial saem, menos os que têm um ponto protegido
  // lá dentro (um anel pequeno pode ser um buraco: tirá-lo punha esse ponto em terra)
  const grandes = aneis.filter(a => {
    if (tamanho(a, esc) >= o.toleranciaMn) return true
    const k = caixa(a)
    return protegidos.some(p => naCaixa(k, p) && c.dentroAnel(p, a))
  })
  const tamanhos = grandes.map(a => tamanho(a, esc))
  const tolMax = Math.max(o.toleranciaMn, o.toleranciaMaxMn)
  let tol = o.toleranciaMn
  let terra = []
  for (let volta = 1; ; volta++) {
    // com a tolerância subida, nenhum anel se simplifica com mais de 1/4 do seu tamanho (a Berlenga,
    // com ~0,9 MN, desaparecia com 0,5 MN), mas nunca com menos do que a tolerância inicial
    const tols = tamanhos.map(t => Math.max(o.toleranciaMn, Math.min(tol, t / 4)))
    const idx = simplificarProtegendo(grandes, tols, esc, protegidos, o.log)
    terra = idx.map((ix, r) => ix.map(i => grandes[r][i])).filter(a => a.length >= 3)
    const n = terra.reduce((s, a) => s + a.length, 0)
    if (n <= o.maxPontos) break
    if (tol >= tolMax) {
      o.log?.(`mini-mapa: ${n} pontos de terra com a tolerância máxima (${String(tolMax).replace('.', ',')} MN)`)
      break
    }
    if (volta >= o.maxVoltas) {
      o.log?.(`mini-mapa: ${n} pontos de terra ao fim de ${o.maxVoltas} voltas (tolerância ${String(Math.round(tol * 1000) / 1000).replace('.', ',')} MN)`)
      break
    }
    tol = Math.min(tol * 1.5, tolMax)
  }
  // as zonas a evitar cuja caixa toca a janela (inteiras: são pequenas)
  const zonas = (costa?.zonas || []).filter(z => {
    const k = caixa(z.poligono)
    return !(k.latMax < j.latMin || k.latMin > j.latMax || k.lonMax < j.lonMin || k.lonMin > j.lonMax)
  }).map(z => ({ nome: z.nome, tipo: z.tipo || null, pontos: z.poligono.map(([lat, lon]) => [r4(lat), r4(lon)]) }))
  return { janela: j, terra, zonas }
}

module.exports = { PADRAO, janela, recortarAnel, simplificarAnel, simplificarProtegendo, montarMapa }
