'use strict'
// Geometria de cada alternativa (desenho 3a, "Geração das rotas"), para cada
// afastamento d (3, 5 ou 8 MN):
//   1. saída: a aproximação do porto de partida ao contrário (do cais ao largo),
//      ou a posição atual se o barco estiver a mais de 0,5 MN de qualquer porto; se a
//      posição estiver a ≤ 0,5 MN de um troço da aproximação de um porto (ex.: no canal do
//      Tejo), vai ao ponto mais perto dela e segue-a até ao largo (ou até ao cais, se esse
//      porto for o destino: uma só alternativa, `direto`);
//   2. juntar-se à linha de d MN à frente, no sentido da viagem;
//   3. seguir a linha até ao ponto mais perto do largo do destino (pontos de ≤ 2 MN);
//   4. entrada: a aproximação do destino (do largo ao cais);
//   5. nenhum troço toca em terra nem em zonas (a terra não se verifica dentro do
//      porto, da `entrada` para dentro, porque o OSM fecha rios e bacias).
// Um troço de ligação que corte terra tenta os pontos seguintes da linha até 5 MN;
// se nenhum servir, tenta ligar mais de lado (até à perpendicular); sem forma, a
// alternativa fica excluída com o motivo.
// Onde a linha passa perto duas vezes (dá a volta às Berlengas), a partida e o destino
// projetam-se em cada passagem e fica o par mais curto compatível com a viagem; e nenhuma
// alternativa pode ter mais de 3,5 × a distância em linha reta ("rota absurda").
//
// Cada ponto da rota: { lat, lon, nome?, perna, costaLivre? }. `perna` é o troço
// que CHEGA a esse ponto: 'porto' (dentro da entrada), 'aproximacao', 'ligacao'
// ou 'linha'. costaLivre: fora da regra do afastamento mínimo (tudo menos a linha).

const c = require('./costa')

const RAIO_PORTO_MN = 0.5
const AVISO_ROTA_ATIVA = 'último troço por confirmar na carta'

// O porto de onde se parte: o destino da lista com o cais a ≤ 0,5 MN da posição.
function portoDePartida (costa, posicao, raioMn = RAIO_PORTO_MN) {
  let melhor = null
  for (const d of costa.destinos) {
    const cais = c.P(d.aproximacao.at(-1))
    const mn = c.distanciaMn(posicao, cais)
    if (mn <= raioMn && (!melhor || mn < melhor.mn)) melhor = { destino: d, mn }
  }
  return melhor?.destino || null
}

// O destino pela rota ativa do OpenCPN: o último ponto. Se for o largo (ou o cais) de um
// destino da lista, é esse; senão um destino avulso com o aviso.
function destinoDaRotaAtiva (costa, pontos, raioMn = RAIO_PORTO_MN) {
  if (!pontos?.length) return null
  const fim = c.P(pontos.at(-1))
  for (const d of costa.destinos) {
    if (c.distanciaMn(fim, c.P(d.largo)) <= raioMn || c.distanciaMn(fim, c.P(d.aproximacao.at(-1))) <= raioMn) return { destino: d, aviso: null }
  }
  return {
    destino: { id: null, nome: 'Fim da rota ativa', abrigo: false, conhecido: false, largo: [fim.lat, fim.lon], aproximacao: [[fim.lat, fim.lon]], entrada: 0, porConfirmar: true },
    aviso: AVISO_ROTA_ATIVA
  }
}

// A normal à linha em s que aponta para terra (graus): o lado com a terra mais perto.
function rumoParaTerra (costa, linha, s) {
  const q = c.posicao(linha, s)
  const esq = c.norm(q.rumo - 90)
  const dir = c.norm(q.rumo + 90)
  return costa.distanciaTerra(c.deslocar(q, esq, 1), 50) <= costa.distanciaTerra(c.deslocar(q, dir, 1), 50) ? esq : dir
}

// O vento (de onde vem, twd) vem do lado de terra da linha em s, ±tolerancia graus.
function ventoDeTerra (costa, linha, s, twd, tolerancia = 60) {
  return Math.abs(c.dif(twd, rumoParaTerra(costa, linha, s))) <= tolerancia
}

const pernaDe = (i, entrada) => i > entrada ? 'porto' : 'aproximacao'
const entradaDe = (d) => Number.isInteger(d.entrada) ? d.entrada : d.aproximacao.length - 1

// Pontos da saída: o cais primeiro, o largo por último.
function pontosSaida (porto) {
  const ap = porto.aproximacao.map(c.P)
  const entrada = entradaDe(porto)
  const out = []
  for (let i = ap.length - 1; i >= 0; i--) {
    const p = { ...ap[i], perna: i === ap.length - 1 ? null : pernaDe(i + 1, entrada), costaLivre: true }
    if (i === ap.length - 1) p.nome = `${porto.nome} (partida)`
    if (i === 0) p.nome = `Largo de ${porto.nome}`
    out.push(p)
  }
  return out
}

// Pontos da entrada: o largo primeiro (chega-se pela ligação), o cais por último.
function pontosEntrada (destino) {
  const ap = destino.aproximacao.map(c.P)
  const entrada = entradaDe(destino)
  return ap.map((q, i) => {
    const p = { ...q, perna: i === 0 ? 'ligacao' : pernaDe(i, entrada), costaLivre: true }
    if (i === 0 && ap.length > 1) p.nome = `Largo de ${destino.nome}`
    if (i === ap.length - 1) p.nome = destino.nome
    return p
  })
}

// A aproximação (de um destino da lista, ou do próprio destino) com um troço a ≤ raioMn da
// posição: { destino, ap, i, q } (q = o ponto mais perto no troço i, de ap[i-1] a ap[i]), a do
// destino primeiro, senão a mais perto. Só aproximações sem problemas e com o troço da posição
// até q livre (a terra dispensa-se só dentro dos portos que o OSM fecha).
function naAproximacao (costa, pos, destino, raioMn) {
  const lista = [...(destino?.aproximacao && !destino.porConfirmar ? [destino] : []), ...costa.destinos.filter(d => d !== destino)]
  let melhor = null
  for (const d of lista) {
    const ap = d.aproximacao.map(c.P)
    const entrada = entradaDe(d)
    let aqui = null
    for (let i = 1; i < ap.length; i++) {
      const { mn, t } = c.distanciaSegmento(pos, ap[i - 1], ap[i])
      if (mn <= raioMn && (!aqui || mn < aqui.mn)) aqui = { destino: d, ap, i, t, mn, entrada }
    }
    if (!aqui) continue
    if (costa.verificarAproximacao(d).length) continue
    const a = aqui.ap[aqui.i - 1]; const b = aqui.ap[aqui.i]
    aqui.q = { lat: a.lat + (b.lat - a.lat) * aqui.t, lon: a.lon + (b.lon - a.lon) * aqui.t }
    const dentroDoPorto = aqui.i > entrada && d.portoFechadoOsm
    if (costa.verificarTroco(pos, aqui.q, { terra: !dentroDoPorto })) continue
    if (d === destino) return aqui
    if (!melhor || aqui.mn < melhor.mn) melhor = aqui
  }
  return melhor
}

// Os pontos da aproximação a partir do ponto q (sem a posição): 'fora' até ao largo, 'dentro'
// até ao cais. O troço da posição até q conta como parte do troço i da aproximação.
function pontosAproximacaoDesde ({ destino, ap, i, t, q, entrada }, sentido) {
  const out = []
  const perto = (a, b) => c.distanciaMn(a, b) < 0.01
  if (sentido === 'fora') {
    if (!perto(q, ap[i - 1])) out.push({ ...q, perna: pernaDe(i, entrada) })
    for (let k = i - 1; k >= 0; k--) out.push({ ...ap[k], perna: pernaDe(k + 1, entrada), ...(k === 0 ? { nome: `Largo de ${destino.nome}` } : {}) })
  } else {
    if (!perto(q, ap[i])) out.push({ ...q, perna: pernaDe(i, entrada) })
    for (let k = i; k < ap.length; k++) out.push({ ...ap[k], perna: pernaDe(k, entrada), ...(k === ap.length - 1 ? { nome: destino.nome } : {}) })
  }
  for (const p of out) p.costaLivre = true
  return out
}

function milhasDe (pontos) {
  let m = 0
  for (let i = 1; i < pontos.length; i++) m += c.distanciaMn(pontos[i - 1], pontos[i])
  return m
}

// Procura o ponto da linha para ligar a p (juntar: de p para a linha; sair: da linha para p).
// Ordem: o ponto "à frente" (≤ anguloMax); os seguintes até maxAvancoMn; depois mais de lado,
// do ponto à frente até à perpendicular. Devolve { s, lat, lon } ou null.
function ligar (costa, linha, p, sentido, janela, { anguloMax, maxAvancoMn, passoMn }, sair) {
  const livre = (q) => sair ? !costa.verificarTroco(q, p) : !costa.verificarTroco(p, q)
  const dentro = (s) => (s - janela.de) * sentido >= -1e-9 && (s - janela.ate) * sentido <= 1e-9
  const j = c.juntar(linha, p, sentido, { de: janela.de, ate: janela.ate, anguloMax })
  if (!j) return null
  // 1) o ponto à frente e os seguintes, até maxAvancoMn
  for (let k = 0; k * passoMn <= maxAvancoMn + 1e-9; k++) {
    const s = j.s + sentido * k * passoMn
    if (!dentro(s)) break
    const q = c.posicao(linha, s)
    if (livre(q)) return q
  }
  // 2) mais de lado: da perpendicular (fica atrás) até ao ponto à frente, o mais perto que sirva
  const pe = c.projetar(linha, p, { de: janela.de, ate: janela.ate })
  const cand = []
  const n = Math.ceil(Math.abs(j.s - pe.s) / passoMn)
  for (let k = 0; k <= n; k++) {
    const s = pe.s + (j.s - pe.s) * (n ? k / n : 0)
    if (!dentro(s)) continue
    const q = c.posicao(linha, s)
    cand.push({ q, mn: c.distanciaMn(p, q) })
  }
  cand.sort((a, b) => a.mn - b.mn)
  for (const { q } of cand) if (livre(q)) return q
  return null
}

const MOTIVO_VENTO_MAR = 'vento do mar em parte da rota: a 3 MN ficava perto de uma costa a sotavento'
const H_MS = 3600e3
const NOTA_DIRETO = 'salto curto entre portos vizinhos: rota direta junto à costa'
const NOTA_DIRETO_MAR = 'destino perto da posição atual: rota direta'
const fmtMn = (x) => x.toFixed(1).replace('.', ',')

// O vento previsto (de onde vem) num ponto: twd é um número (o mesmo em toda a parte) ou uma
// função. Com horaPartida (ms), a função recebe também a hora estimada de passagem no ponto
// (horaPartida + milhas desde a partida a o.nosEta nós); sem ela, só (lat, lon): quem chama fecha
// a função sobre a hora de partida (a previsão da partida em toda a rota).
function ventoEm (twd, p, milhasDesdePartida, horaPartida, o) {
  if (typeof twd !== 'function') return twd
  if (!Number.isFinite(horaPartida)) return twd(p.lat, p.lon)
  return twd(p.lat, p.lon, horaPartida + milhasDesdePartida / o.nosEta * H_MS)
}

// A regra dos 3 MN (desenho: "3 MN só com vento de terra", decisão do Ivo de 30/09): em cada ponto
// da linha seguida (os que têm `s`), o vento previsto tem de vir do lado de terra da linha (a normal
// que aponta para terra, ±o.toleranciaVento). Devolve o motivo da exclusão, ou null.
function ventoDoMarNaRota (costa, linha, pontos, { twd, horaPartida }, o) {
  let milhas = 0
  for (let i = 0; i < pontos.length; i++) {
    if (i > 0) milhas += c.distanciaMn(pontos[i - 1], pontos[i])
    const p = pontos[i]
    if (!Number.isFinite(p.s)) continue
    const vento = ventoEm(twd, p, milhas, horaPartida, o)
    if (!Number.isFinite(vento)) return `a ${o.afastamentoVentoTerra} MN só com vento de terra, e não há vento previsto para a rota`
    if (!ventoDeTerra(costa, linha, p.s, vento, o.toleranciaVento)) return MOTIVO_VENTO_MAR
  }
  return null
}

// Nos saltos curtos (sem linha): os pontos dos troços fora das aproximações, de 2 em 2 MN no
// máximo; a normal para terra é a da linha dos 3 MN mais perto de cada ponto.
function ventoDoMarNoDireto (costa, pontos, costaMinMn, { twd, horaPartida }, o) {
  const linha = costa.linha(o.afastamentoVentoTerra)
  if (!linha) return null
  const motivo = `vento do mar em parte da rota: a rota direta passa a ${fmtMn(costaMinMn)} MN de uma costa a sotavento`
  let milhas = 0
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]; const b = pontos[i]
    const L = c.distanciaMn(a, b)
    if (pontos[i].perna === 'ligacao') {
      const n = Math.max(1, Math.ceil(L / o.passoMax))
      for (let k = 0; k <= n; k++) {
        const q = { lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }
        const vento = ventoEm(twd, q, milhas + L * k / n, horaPartida, o)
        if (!Number.isFinite(vento)) return `a menos de ${o.afastamentoVentoTerra} MN da costa só com vento de terra, e não há vento previsto para a rota`
        if (!ventoDeTerra(costa, linha, c.projetar(linha, q).s, vento, o.toleranciaVento)) return motivo
      }
    }
    milhas += L
  }
  return null
}

// A distância mínima (MN) à terra nos troços fora das aproximações (ligações, linha, canal),
// de o.passo em o.passo MN; null se a rota é toda aproximação.
function distanciaMinimaTerra (costa, pontos, passo = 0.1) {
  let mn = Infinity
  for (let i = 1; i < pontos.length; i++) {
    const perna = pontos[i].perna
    if (perna === 'porto' || perna === 'aproximacao') continue
    const a = pontos[i - 1]; const b = pontos[i]
    const n = Math.max(1, Math.ceil(c.distanciaMn(a, b) / passo))
    for (let k = 0; k <= n; k++) mn = Math.min(mn, costa.distanciaTerra({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }, 50))
  }
  return Number.isFinite(mn) ? mn : null
}

// As projeções de p na linha que valem a pena: os mínimos locais da distância (a linha pode
// passar perto duas vezes, ex.: antes e depois de contornar as Berlengas), até `margem` MN pior
// do que o mais perto, no máximo `max`, do mais perto para o mais longe.
function projecoes (linha, p, { passo = 0.25, margem = 4, max = 3 } = {}) {
  const n = Math.max(1, Math.ceil(linha.total / passo))
  const d = new Float64Array(n + 1)
  for (let k = 0; k <= n; k++) d[k] = c.distanciaMn(p, c.posicao(linha, linha.total * k / n))
  const minimos = []
  for (let k = 0; k <= n; k++) {
    if ((k > 0 && d[k] > d[k - 1]) || (k < n && d[k] >= d[k + 1])) continue
    const s = linha.total * k / n
    minimos.push(c.projetar(linha, p, { de: s - passo, ate: s + passo }))
  }
  minimos.sort((a, b) => a.dist - b.dist)
  return minimos.filter(m => m.dist <= minimos[0].dist + margem).slice(0, max)
}

// A geometria de uma alternativa (passos 2 a 5): de inicio (a saída, o último ponto é onde se
// deixa a aproximação) a entrada (o primeiro ponto é o largo do destino). Tenta os pares de
// projeções compatíveis com a viagem (o troço de linha entre eles não passa de o.fatorAbsurdo ×
// a distância em linha reta, mais a ida e volta à linha) e fica com o mais curto que sirva.
// → { pontos, direto, j, l, sentido } ou { problema } (o do par mais natural: os mais perto).
function tracar (costa, linha, inicio, entrada, afastamento, o) {
  const pA = inicio.at(-1)
  const pB = entrada[0]
  const candA = projecoes(linha, pA)
  const candB = projecoes(linha, pB)
  const folga = o.fatorAbsurdo * c.distanciaMn(pA, pB) + 2 * afastamento + 2
  let pares = []
  for (const a of candA) for (const b of candB) if (Math.abs(b.s - a.s) <= folga) pares.push([a.s, b.s])
  if (!pares.length) pares = [[candA[0].s, candB[0].s]]
  let melhor = null
  let primeiroProblema = null
  for (const [sA, sB] of pares) {
    const r = tracarPar(costa, linha, pA, pB, sA, sB, afastamento, o)
    if (r.problema) { primeiroProblema ||= r.problema; continue }
    const pontos = [...inicio.map(p => ({ ...p })), ...r.meio, ...entrada.map(p => ({ ...p }))]
    const problema = verificarTrocos(costa, pontos)
    if (problema) { primeiroProblema ||= problema; continue }
    const milhas = milhasDe(pontos)
    if (!melhor || milhas < melhor.milhas) melhor = { pontos, milhas, direto: !r.meio.length, j: r.j, l: r.l, sentido: r.sentido }
  }
  return melhor || { problema: primeiroProblema }
}

// Um par de projeções: juntar-se à linha à frente (entre sA e sB), sair dela para o largo do
// destino, e os pontos da linha entre as duas (vazio se a linha seguida fica com ≤ 0,5 MN: vai
// direto de largo a largo).
function tracarPar (costa, linha, pA, pB, sA, sB, afastamento, o) {
  const sentido = sB >= sA ? 1 : -1
  // 2. juntar-se à linha (à frente, entre a partida e o destino)
  const j = ligar(costa, linha, pA, sentido, { de: sA, ate: sB }, o, false)
  // 3. sair da linha para o largo do destino (olhando para trás a partir do destino)
  const l = j && ligar(costa, linha, pB, -sentido, { de: sB, ate: j.s }, o, true)
  if (!j || !l) return { problema: { motivo: 'terra' } }
  if ((l.s - j.s) * sentido > 0.5) return { meio: pontosLinha(linha, j.s, l.s, afastamento, o), j, l, sentido }
  // partida e destino perto um do outro na linha (a saída da linha ficava antes da entrada
  // nela): vai direto de largo a largo
  if (costa.verificarTroco(pA, pB)) return { problema: { motivo: 'terra' } }
  return { meio: [], j, l, sentido }
}

// Os pontos da linha de s1 a s2 (troços ≤ o.passoMax); o primeiro chega pela ligação.
function pontosLinha (linha, s1, s2, afastamento, o) {
  const meio = c.seguirLinha(linha, s1, s2, { passoMax: o.passoMax, tolerancia: o.tolerancia })
    .map((q, i) => ({ lat: q.lat, lon: q.lon, s: q.s, perna: i === 0 ? 'ligacao' : 'linha' }))
  meio[0].nome = `Linha de ${afastamento} MN`
  return meio
}

// 5. verificação final dos troços fora dos portos (ligações, linha, canal): o primeiro problema
// ({ motivo: 'terra' | 'zona', zona? }) ou null. As aproximações verificam-se à parte
// (verificarAproximacao); a última ligação da rota ativa avulsa também se verifica aqui.
function verificarTrocos (costa, pontos) {
  for (let i = 1; i < pontos.length; i++) {
    const perna = pontos[i].perna
    if (perna === 'porto' || perna === 'aproximacao') continue
    const r = costa.verificarTroco(pontos[i - 1], pontos[i])
    if (r) return r
  }
  return null
}

// Mais de o.fatorAbsurdo vezes a distância em linha reta do primeiro ao último ponto: o motivo.
function rotaAbsurda (pontos, o) {
  const milhas = milhasDe(pontos)
  const reta = c.distanciaMn(pontos[0], pontos.at(-1))
  return milhas > o.fatorAbsurdo * reta ? `rota absurda: ${fmtMn(milhas)} MN para ${fmtMn(reta)} MN em linha reta` : null
}

function descreverProblema (r) {
  if (r.motivo === 'zona') return `passa na zona a evitar "${r.zona}"`
  if (r.motivo === 'entrada inválida') return 'tem a entrada mal definida nos dados'
  return 'toca em terra'
}

// Uma alternativa: { afastamento, pontos, milhas, excluida, motivo?, avisos[] }.
// partida: um destino da lista (porto de partida) ou { lat, lon } (no mar);
// destino: um destino da lista (ou o avulso da rota ativa);
// twd: direção do vento previsto (número, ou função (lat, lon[, t]) → graus), só para os 3 MN;
// horaPartida (ms, opcional): com ela a função recebe a hora estimada de passagem em cada ponto.
function gerarRota (costa, { partida, destino, afastamento, twd, horaPartida, opcoes = {} }) {
  const o = { anguloMax: 60, maxAvancoMn: 5, passoMn: 0.25, passoMax: 2, tolerancia: 0.02, toleranciaVento: 60, afastamentoVentoTerra: 3, nosEta: 5, raioAproximacao: RAIO_PORTO_MN, fatorAbsurdo: 3.5, ...opcoes }
  const nomeA = partida.nome || 'a posição atual'
  const nomeB = destino.nome
  const alt = { afastamento, pontos: [], milhas: 0, excluida: false, avisos: [] }
  const excluir = (motivo) => ({ ...alt, excluida: true, motivo })
  // Coordenadas não finitas (posição sem GPS, rota ativa malformada, dados corrompidos) fazem
  // lib/costa.js rebentar (`P()`); aqui isso não pode escapar por resolver, fica excluída com o motivo.
  try {
    if (destino.porConfirmar) alt.avisos.push(AVISO_ROTA_ATIVA)

    // 1. saída
    let inicio
    if (partida.aproximacao) {
      const prob = costa.verificarAproximacao(partida)
      if (prob.length) return excluir(`a saída de ${partida.nome} ${descreverProblema(prob[0])}`)
      inicio = pontosSaida(partida)
    } else {
      if (costa.emTerra(partida)) return excluir('a posição atual fica em terra')
      const pos = { lat: partida.lat, lon: partida.lon, nome: 'Posição atual', perna: null }
      // dentro da aproximação de um porto (ex.: no canal do Tejo): segue-a, não parte a direito
      const na = naAproximacao(costa, pos, destino, o.raioAproximacao)
      if (na && na.destino === destino) {
        // já na aproximação do destino: segue-a para dentro, até ao cais
        const pontos = [pos, ...pontosAproximacaoDesde(na, 'dentro')]
        alt.afastamento = null
        alt.direto = true
        alt.avisos.push(`já na aproximação de ${destino.nome}: segue-a até ao cais`)
        for (const p of pontos) p.costaLivre = true
        return { ...alt, pontos, milhas: milhasDe(pontos), costaMinMn: null, sentido: null, linha: { de: null, ate: null } }
      }
      inicio = na ? [pos, ...pontosAproximacaoDesde(na, 'fora')] : [pos]
    }
    // 4. entrada (verifica-se já)
    if (!destino.porConfirmar) {
      const prob = costa.verificarAproximacao(destino)
      if (prob.length) return excluir(`a entrada de ${destino.nome} ${descreverProblema(prob[0])}`)
    }
    const entrada = pontosEntrada(destino)

    const linha = costa.linha(afastamento)
    if (!linha) return excluir(`não há linha de costa a ${afastamento} MN`)
    const semPassagem = `não há passagem a ${afastamento} MN entre ${nomeA} e ${nomeB}`
    const t = tracar(costa, linha, inicio, entrada, afastamento, o)
    if (t.problema) return excluir(t.problema.motivo === 'terra' ? semPassagem : `a rota a ${afastamento} MN ${descreverProblema(t.problema)}`)
    const { pontos, direto, j, l, sentido } = t
    if (direto) {
      // salto curto (a linha seguida ficava com ≤ 0,5 MN): uma só alternativa, a mesma a qualquer
      // afastamento, marcada `direto`, com a distância real à terra; perto da costa (< 3 MN) só com
      // vento de terra, como os 3 MN
      alt.afastamento = null
      alt.direto = true
      alt.avisos.push(partida.aproximacao ? NOTA_DIRETO : NOTA_DIRETO_MAR)
    }
    // rede de segurança contra voltas da linha (ilhas, cabos): nunca mais de o.fatorAbsurdo × a
    // distância em linha reta do início ao fim
    const absurda = rotaAbsurda(pontos, o)
    if (absurda) return excluir(absurda)

    const costaMinMn = distanciaMinimaTerra(costa, pontos)
    if (direto) {
      if (costaMinMn < o.afastamentoVentoTerra) {
        const motivo = ventoDoMarNoDireto(costa, pontos, costaMinMn, { twd, horaPartida }, o)
        if (motivo) return excluir(motivo)
      }
    } else if (afastamento <= o.afastamentoVentoTerra) {
      // 3 MN só com vento de terra, em TODOS os pontos da linha seguida (não só à saída)
      const motivo = ventoDoMarNaRota(costa, linha, pontos, { twd, horaPartida }, o)
      if (motivo) return excluir(motivo)
    }
    for (const p of pontos) { delete p.s; if (p.perna === 'linha') delete p.costaLivre; else p.costaLivre = true }
    return { ...alt, pontos, milhas: milhasDe(pontos), costaMinMn, sentido, linha: { de: direto ? null : j.s, ate: direto ? null : l.s } }
  } catch (e) {
    return excluir(e.message)
  }
}

// As alternativas para cada afastamento. posicao: { lat, lon } do barco; destino: da lista
// (ou { rotaAtiva: [[lat, lon] | {lat, lon}, …] } para usar o fim da rota ativa do OpenCPN).
function gerarRotas (costa, { posicao, destino, afastamentos = [3, 5, 8], twd, horaPartida, opcoes }) {
  let dest = destino
  if (destino?.rotaAtiva) {
    let r
    try {
      r = destinoDaRotaAtiva(costa, destino.rotaAtiva)
    } catch (e) {
      // pontos da rota ativa malformados (coordenadas não finitas): nenhuma alternativa possível
      return afastamentos.map(afastamento => ({ afastamento, pontos: [], milhas: 0, excluida: true, motivo: e.message, avisos: [] }))
    }
    if (!r) return []
    dest = r.destino
  }
  const partida = portoDePartida(costa, posicao) || { lat: posicao.lat, lon: posicao.lon }
  const alts = []
  for (const d of afastamentos) {
    const a = gerarRota(costa, { partida, destino: dest, afastamento: d, twd, horaPartida, opcoes })
    // a rota direta é a mesma a qualquer afastamento: só uma vez
    if (a.direto && alts.some(x => x.direto)) continue
    alts.push(a)
  }
  return alts
}

module.exports = { RAIO_PORTO_MN, AVISO_ROTA_ATIVA, portoDePartida, destinoDaRotaAtiva, rumoParaTerra, ventoDeTerra, gerarRota, gerarRotas }
