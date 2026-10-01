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
// alternativa pode ter mais de 4,0 × a distância em linha reta ("rota absurda").
// Onde a linha dá a volta às Berlengas, gerarAlternativas junta uma variante "via Canal da
// Berlenga" (dados/canais.json, decisão do Ivo de 30/09), marcada com `canal` e `ondasMax`; os
// troços do canal (terra dos dois lados) ficam FORA da regra do vento de terra (só as ondas
// decidem, Task 9), mas a linha antes/depois do canal continua sujeita a ela.
// Dois portos com a mesma "largo" (ex.: Cascais/Oeiras/Algés, todos pela Barra Norte do Tejo) não
// têm atalho por dentro do rio entre as suas aproximações: em vez de "rota absurda", o motivo é
// "sem rota dentro do Tejo".
//
// Cada ponto da rota: { lat, lon, nome?, perna, costaLivre?, s? }. `perna` é o troço
// que CHEGA a esse ponto: 'porto' (dentro da entrada), 'aproximacao', 'ligacao',
// 'linha' ou 'canal'. costaLivre: fora da regra do afastamento mínimo (tudo menos a linha).
// s: a posição (MN) na linha seguida, só nos pontos da linha (para ventoDoMar voltar a
// verificar a regra do vento de terra numa alternativa já traçada).

const fs = require('node:fs')
const path = require('node:path')
const c = require('./costa')

const RAIO_PORTO_MN = 0.5
const AVISO_ROTA_ATIVA = 'último troço por confirmar na carta'
const MOTIVO_ERRO_INTERNO = 'erro interno ao gerar esta rota'
const MOTIVO_COORDENADAS = 'coordenadas inválidas: a posição ou um ponto da rota não tem latitude e longitude válidas'
const MOTIVO_SEM_ROTA_ATIVA = 'não há rota ativa no OpenCPN'
const MOTIVO_SEM_POSICAO = 'sem posição do GPS: não sei de onde parte o barco'
const MOTIVO_VENTO_MAR = 'vento do mar em parte da rota: a 3 MN ficava perto de uma costa a sotavento'
const MOTIVO_SEM_ROTA_TEJO = 'sem rota dentro do Tejo: sair pela barra ou navegar à vista'
const H_MS = 3600e3
const NOTA_DIRETO = 'salto curto entre portos vizinhos: rota direta junto à costa'
const NOTA_DIRETO_MAR = 'destino perto da posição atual: rota direta'
const fmtMn = (x) => x.toFixed(1).replace('.', ',')
const logPadrao = (...a) => console.error(...a)
// A regra do vento de terra (os 3 MN e a rota direta perto da costa): nosEta, os nós da hora
// estimada de passagem em cada ponto; passoMax, as amostras (MN) nos troços da rota direta.
const VENTO = Object.freeze({ toleranciaVento: 60, afastamentoVentoTerra: 3, nosEta: 5, passoMax: 2 })

// Um canal só entra na lista se tiver nome, ≥ 2 pontos com lat/lon finitos e ondasMax (usado pela
// Task 9); um canal inválido fica de fora (registado), sem impedir os outros.
function canalValido (k, log) {
  const ok = !!k && typeof k.nome === 'string' && Array.isArray(k.pontos) && k.pontos.length >= 2 &&
    k.pontos.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) &&
    Number.isFinite(k.ondasMax)
  if (!ok) { try { log(`signalk-arlequin-rota: canal inválido em canais.json ignorado: ${JSON.stringify(k)}`) } catch { /* nunca rebenta */ } }
  return ok
}

// Canais entre ilhas e o continente que a linha contorna por fora (dados/canais.json). Um
// canais.json em falta, ilegível ou mal formado desativa só as variantes por canal (lista vazia,
// registado); nunca impede as alternativas normais (o erro não escapa daqui).
function carregarCanais (pasta = c.PASTA_DADOS, log = logPadrao) {
  try {
    const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'canais.json'), 'utf8'))
    if (!Array.isArray(dados)) throw new Error('canais.json não é uma lista')
    return dados.filter(k => canalValido(k, log))
  } catch (e) {
    try { log('signalk-arlequin-rota: erro ao ler dados/canais.json; variantes por canal desativadas', e) } catch { /* nunca rebenta */ }
    return []
  }
}
const CANAIS = carregarCanais()

// Uma exceção a gerar uma rota nunca escapa (não pode derrubar o servidor): coordenadas não finitas
// (lib/costa.js, `P()`) dão um motivo em português sem o JSON cru; qualquer outra é um erro de
// programação: motivo fixo para o Ivo e o erro verdadeiro no registo.
function motivoDoErro (e, log) {
  if (/^coordenadas inválidas/.test(e?.message)) return MOTIVO_COORDENADAS
  try { log('signalk-arlequin-rota: erro ao gerar uma rota', e) } catch { /* o registo não pode rebentar */ }
  return MOTIVO_ERRO_INTERNO
}

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
    // aproximação de 2 pontos iguais para a `entrada` ser válida (1 = o último índice), como o
    // costa.js exige; pontosEntrada junta os pontos repetidos
    destino: { id: null, nome: 'Fim da rota ativa', abrigo: false, conhecido: false, largo: [fim.lat, fim.lon], aproximacao: [[fim.lat, fim.lon], [fim.lat, fim.lon]], entrada: 1, porConfirmar: true },
    aviso: AVISO_ROTA_ATIVA
  }
}

// A zona a evitar que contém p, ou null.
function zonaDaPosicao (costa, p) {
  return costa.zonas.find(z => c.dentroAnel(p, z.poligono)) || null
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

// Pontos da saída: o cais primeiro, o largo por último. Um ponto repetido (o destino avulso, com 2
// pontos iguais) junta-se ao anterior, que fica com o nome da partida.
function pontosSaida (porto) {
  const ap = porto.aproximacao.map(c.P)
  const entrada = entradaDe(porto)
  const out = []
  for (let i = ap.length - 1; i >= 0; i--) {
    const p = { ...ap[i], perna: i === ap.length - 1 ? null : pernaDe(i + 1, entrada), costaLivre: true }
    if (i === ap.length - 1) p.nome = `${porto.nome} (partida)`
    if (i === 0) p.nome = `Largo de ${porto.nome}`
    const antes = out.at(-1)
    if (antes && antes.lat === p.lat && antes.lon === p.lon) continue
    out.push(p)
  }
  return out
}

// Pontos da entrada: o largo primeiro (chega-se pela ligação), o cais por último.
function pontosEntrada (destino) {
  const ap = destino.aproximacao.map(c.P)
  const entrada = entradaDe(destino)
  const out = []
  ap.forEach((q, i) => {
    const p = { ...q, perna: i === 0 ? 'ligacao' : pernaDe(i, entrada), costaLivre: true }
    if (i === 0 && ap.length > 1) p.nome = `Largo de ${destino.nome}`
    if (i === ap.length - 1) p.nome = destino.nome
    // um ponto repetido (o destino avulso da rota ativa) junta-se ao anterior, com o nome dele
    const antes = out.at(-1)
    if (antes && antes.lat === p.lat && antes.lon === p.lon) { if (p.nome) antes.nome = p.nome } else out.push(p)
  })
  return out
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

// O rumo (graus) do ponto de terra mais perto de q: dos rumos de 5 em 5°, aquele em que o ponto
// à distância da terra fica mais perto dela. Para os troços que não estão numa linha (a linha
// mais perto pode ser a do outro lado de um canal).
function rumoTerraMaisPerto (costa, q) {
  const d = costa.distanciaTerra(q, 50)
  if (!Number.isFinite(d) || d === 0) return null
  let melhor = null
  for (let rumo = 0; rumo < 360; rumo += 5) {
    const x = costa.distanciaTerra(c.deslocar(q, rumo, d), 50)
    if (!melhor || x < melhor.x) melhor = { rumo, x }
  }
  return melhor.rumo
}

// Nos saltos curtos (sem linha): os pontos dos troços fora das aproximações, de 2 em 2 MN no
// máximo; a normal para terra é o rumo do ponto de terra mais perto. Só interessa o vento onde a
// costa fica mesmo a menos de afastamentoVentoTerra: mais longe não há "sotavento" a temer nesse
// ponto (os 3 MN, não os 5/8 da linha — a regra é sempre a de perto de terra).
function ventoDoMarNoDireto (costa, pontos, costaMinMn, { twd, horaPartida }, o) {
  const motivo = `vento do mar em parte da rota: a rota direta passa a ${fmtMn(costaMinMn)} MN de uma costa a sotavento`
  let milhas = 0
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]; const b = pontos[i]
    const L = c.distanciaMn(a, b)
    if (pontos[i].perna === 'ligacao') {
      const n = Math.max(1, Math.ceil(L / o.passoMax))
      for (let k = 0; k <= n; k++) {
        const q = { lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }
        if (costa.distanciaTerra(q, 50) >= o.afastamentoVentoTerra) continue
        const vento = ventoEm(twd, q, milhas + L * k / n, horaPartida, o)
        if (!Number.isFinite(vento)) return `a menos de ${o.afastamentoVentoTerra} MN da costa só com vento de terra, e não há vento previsto para a rota`
        const paraTerra = rumoTerraMaisPerto(costa, q)
        if (paraTerra != null && Math.abs(c.dif(vento, paraTerra)) > o.toleranciaVento) return motivo
      }
    }
    milhas += L
  }
  return null
}

// A regra do vento de terra de uma alternativa já traçada: a da linha a ≤ afastamentoVentoTerra
// (ventoDoMarNaRota) e a rota direta a menos de afastamentoVentoTerra da costa (ventoDoMarNoDireto).
// → o motivo da exclusão (os mesmos textos do gerar), ou null. O gerar usa-a com a hora estimada a
// o.nosEta nós; lib/calculo.js volta a usá-la com a hora a que o barco passa de facto em cada ponto
// nos rastos simulados (sem horaPartida, twd(lat, lon): quem chama fecha a hora).
function ventoDoMar (costa, alt, { twd, horaPartida } = {}, opcoes = {}) {
  const o = { ...VENTO, ...opcoes }
  if (!alt || alt.excluida) return null
  if (alt.direto) {
    if (alt.costaMinMn == null || !(alt.costaMinMn < o.afastamentoVentoTerra)) return null
    return ventoDoMarNoDireto(costa, alt.pontos, alt.costaMinMn, { twd, horaPartida }, o)
  }
  if (!(alt.afastamento <= o.afastamentoVentoTerra)) return null
  return ventoDoMarNaRota(costa, costa.linha(alt.afastamento), alt.pontos, { twd, horaPartida }, o)
}

// A distância mínima (MN) à terra nos troços fora das aproximações (ligações, linha, canal),
// de `passo` em `passo` MN; null se a rota é toda aproximação.
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

// Variantes por canais: onde a linha seguida dá a volta a ilhas (as Berlengas), sai da linha (ou
// da saída, ex.: o largo de Peniche) para a ponta do canal, segue os pontos do canal e volta à
// linha (ou vai direto ao largo do destino) do outro lado. Escolhe os pontos de ligação com o
// maior ganho em milhas sobre a linha; só há variante se o ganho for ≥ o.ganhoCanalMinMn (ou
// seja, se a rota passar mesmo pela volta). As ligações e os troços do canal ficam livres de
// terra e de zonas, e uma ligação não se chega mais a terra do que as suas pontas (nem do que o
// afastamento): assim não corta caminho por dentro da linha. → [{ pontos, canal }].
function variantesCanal (costa, linha, inicio, entrada, { j, l }, afastamento, o) {
  const pA = inicio.at(-1)
  const pB = entrada[0]
  // pontos candidatos a ligar ao canal, com u = milhas ao longo da rota desde pA
  const uJ = c.distanciaMn(pA, j)
  const amostras = [{ p: pA, u: 0, s: null }]
  const nA = Math.max(1, Math.ceil(Math.abs(l.s - j.s) / 0.5))
  for (let k = 0; k <= nA; k++) {
    const s = j.s + (l.s - j.s) * k / nA
    amostras.push({ p: c.posicao(linha, s), u: uJ + Math.abs(s - j.s), s })
  }
  amostras.push({ p: pB, u: uJ + Math.abs(l.s - j.s) + c.distanciaMn(l, pB), s: null })
  amostras.forEach((a, i) => { a.i = i })
  // a ligação p–q não se chega mais a terra do que as suas pontas (nem do que o afastamento)
  const naoCorta = (p, q) => {
    const exigida = Math.min(afastamento, costa.distanciaTerra(p, 50), costa.distanciaTerra(q, 50)) - 0.1
    const n = Math.max(1, Math.ceil(c.distanciaMn(p, q) / 0.25))
    for (let k = 1; k < n; k++) if (costa.distanciaTerra({ lat: p.lat + (q.lat - p.lat) * k / n, lon: p.lon + (q.lon - p.lon) * k / n }, 50) < exigida) return false
    return true
  }
  const out = []
  for (const canal of o.canais || []) {
    const kp = canal.pontos.map(c.P)
    if (kp.some((q, i) => i > 0 && costa.verificarTroco(kp[i - 1], q))) continue
    const comprimento = milhasDe(kp)
    let melhor = null
    for (const pts of [kp, [...kp].reverse()]) { // nos dois sentidos
      const E = pts[0]; const X = pts.at(-1)
      const pares = []
      for (const a of amostras) {
        if (c.distanciaMn(a.p, E) > o.raioCanalMn) continue
        for (const b of amostras) {
          if (b.u <= a.u || c.distanciaMn(b.p, X) > o.raioCanalMn) continue
          const ganho = (b.u - a.u) - (c.distanciaMn(a.p, E) + comprimento + c.distanciaMn(X, b.p))
          if (ganho >= o.ganhoCanalMinMn && (!melhor || ganho > melhor.ganho)) pares.push({ ganho, a, b })
        }
      }
      pares.sort((x, y) => y.ganho - x.ganho)
      const ok = new Map()
      const serve = (q, ponta, chave) => {
        if (!ok.has(chave)) ok.set(chave, !costa.verificarTroco(q, ponta) && naoCorta(q, ponta))
        return ok.get(chave)
      }
      for (const par of pares) {
        if (serve(par.a.p, E, `a${par.a.i}`) && serve(par.b.p, X, `b${par.b.i}`)) { melhor = { ...par, pts }; break }
      }
    }
    if (!melhor) continue
    const { a, b, pts } = melhor
    const antes = a.s == null ? [] : pontosLinha(linha, j.s, a.s, afastamento, o)
    const noCanal = pts.map((q, i) => ({ lat: q.lat, lon: q.lon, perna: i === 0 ? 'ligacao' : 'canal', ...(i === 0 ? { nome: canal.nome } : {}) }))
    const depois = b.s == null ? [] : pontosLinha(linha, b.s, l.s, afastamento, o)
    const pontos = [...inicio.map(p => ({ ...p })), ...antes, ...noCanal, ...depois, ...entrada.map(p => ({ ...p }))]
    if (verificarTrocos(costa, pontos)) continue
    out.push({ pontos, canal })
  }
  return out
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

// Dois portos com a mesma "largo" (≤ 0,05 MN): não há atalho por dentro do rio/baía entre as suas
// aproximações, só sair até ao largo comum e voltar a entrar (ex.: Oeiras ↔ Algés, ambos pela
// Barra Norte do Tejo, dá 4,5 × a reta). Não é uma rota absurda (erro de projeção): é mesmo assim,
// e o Ivo decide (sair pela barra ou ir à vista) — motivo à parte, não "rota absurda".
function mesmoLargo (a, b) {
  return !!(a?.largo && b?.largo) && c.distanciaMn(c.P(a.largo), c.P(b.largo)) < 0.05
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

// Uma alternativa: { afastamento, pontos, milhas, costaMinMn, excluida, motivo?, avisos[],
// direto?, canal?, ondasMax? }.
// partida: um destino da lista (porto de partida) ou { lat, lon } (no mar);
// destino: um destino da lista (ou o avulso da rota ativa);
// twd: direção do vento previsto (número, ou função (lat, lon[, t]) → graus), só para os 3 MN;
// horaPartida (ms, opcional): com ela a função recebe a hora estimada de passagem em cada ponto.
// costaMinMn: a distância mínima à terra nos troços fora das aproximações (null se não há).
// Excluída pela regra do vento de terra (ventoDoMar): também `porVento: true`.
// gerarRota dá só a alternativa da linha; gerarAlternativas dá também as variantes por canais
// (hoje só o Canal da Berlenga), a seguir a ela.
function gerarRota (costa, args) {
  return gerar(costa, args, false)[0]
}

function gerarAlternativas (costa, args) {
  return gerar(costa, args, true)
}

function gerar (costa, { partida, destino, afastamento, twd, horaPartida, opcoes = {}, log = logPadrao }, comVariantes) {
  // fatorAbsurdo: medido em TODOS os pares de dados/destinos.json (3/5/8 MN, os dois sentidos) —
  // a rota verdadeira mais comprida é Algés ↔ Setúbal a 8 MN, 3,41 × a reta; o caso mais perto do
  // lado absurdo é Oeiras ↔ Algés (a volta ao largo comum do Tejo — tratada à parte por
  // MOTIVO_SEM_ROTA_TEJO/mesmoLargo, não por este fator), 4,52 ×; o erro de projeção do cabo
  // inventado (teste "rota absurda") dá 11,9 ×. 4,0 fica a ≥ 10 % dos dois lados
  // (3,41 × 1,1 = 3,75; 4,52 / 1,1 = 4,11).
  const o = { ...VENTO, anguloMax: 60, maxAvancoMn: 5, passoMn: 0.25, tolerancia: 0.02, raioAproximacao: RAIO_PORTO_MN, fatorAbsurdo: 4.0, canais: CANAIS, raioCanalMn: 10, ganhoCanalMinMn: 5, ...opcoes }
  const alt = { afastamento, pontos: [], milhas: 0, excluida: false, avisos: [] }
  const excluir = (motivo) => [{ ...alt, excluida: true, motivo }]
  // nada escapa daqui (motivoDoErro): nunca pode derrubar o servidor
  try {
    const nomeA = partida.nome || 'a posição atual'
    const nomeB = destino.nome
    if (destino.porConfirmar) alt.avisos.push(AVISO_ROTA_ATIVA)

    // 1. saída
    let inicio
    if (partida.aproximacao) {
      const prob = costa.verificarAproximacao(partida)
      if (prob.length) return excluir(`a saída de ${partida.nome} ${descreverProblema(prob[0])}`)
      inicio = pontosSaida(partida)
    } else {
      if (costa.emTerra(partida)) return excluir('a posição atual fica em terra')
      const zona = zonaDaPosicao(costa, partida)
      if (zona) return excluir(`a posição está dentro de uma zona a evitar (${zona.nome})`)
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
        return [{ ...alt, pontos, milhas: milhasDe(pontos), costaMinMn: null, sentido: null, linha: { de: null, ate: null } }]
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
    if (t.direto) {
      // salto curto (a linha seguida ficava com ≤ 0,5 MN): uma só alternativa, a mesma a qualquer
      // afastamento, marcada `direto`, com a distância real à terra; perto da costa (< 3 MN) só com
      // vento de terra, como os 3 MN
      alt.afastamento = null
      alt.direto = true
      alt.avisos.push(partida.aproximacao ? NOTA_DIRETO : NOTA_DIRETO_MAR)
    }
    const linhaSeguida = { de: t.direto ? null : t.j.s, ate: t.direto ? null : t.l.s }
    const geometrias = [{ pontos: t.pontos, extra: {}, avisos: [] }]
    if (comVariantes && !t.direto) {
      for (const v of variantesCanal(costa, linha, inicio, entrada, t, afastamento, o)) {
        // NOTA para lib/seguranca.js: uma alternativa com `ondasMax` fica EXCLUÍDA quando a onda
        // máxima do cenário pessimista nos troços do canal (perna 'canal' e as ligações a ele)
        // for ≥ ondasMax (decisão do Ivo de 30/09: o Canal da Berlenga só com ondas < 3 m).
        // Terra dos dois lados do canal (não há "o lado do mar"): a regra do vento de terra nunca
        // poderia servir aí, por isso não se aplica — decisão do Ivo, não um esquecimento. Os
        // pontos do canal (perna 'canal') não têm `s`, por isso ventoDoMarNaRota salta-os
        // sozinha; a linha antes/depois do canal continua com `s` e fica sujeita à regra dos 3 MN
        // como qualquer outra alternativa.
        const avisos = v.canal.confirmado === false ? [`${v.canal.nome} por confirmar na carta`] : []
        const nota = `${v.canal.nome}: terra dos dois lados; só com ondas < ${v.canal.ondasMax} m — por confirmar na carta`
        geometrias.push({ pontos: v.pontos, extra: { canal: v.canal.nome, ondasMax: v.canal.ondasMax, nota }, avisos })
      }
    }
    return geometrias.map(({ pontos, extra, avisos }) => {
      const a = { ...alt, ...extra, avisos: [...alt.avisos, ...avisos] }
      const fora = (motivo) => ({ ...a, excluida: true, motivo })
      // rede de segurança contra voltas da linha (ilhas, cabos): nunca mais de o.fatorAbsurdo × a
      // distância em linha reta do início ao fim
      const absurda = rotaAbsurda(pontos, o)
      if (absurda) {
        // dentro do Tejo (mesmo largo dos dois lados): não é um erro de projeção, é mesmo assim
        if (t.direto && partida.aproximacao && destino.aproximacao && !destino.porConfirmar && mesmoLargo(partida, destino)) return fora(MOTIVO_SEM_ROTA_TEJO)
        return fora(absurda)
      }
      const costaMinMn = distanciaMinimaTerra(costa, pontos)
      // 3 MN só com vento de terra, em TODOS os pontos da linha seguida (não só à saída); a rota
      // direta a menos de 3 MN da costa também (ventoDoMar)
      const motivo = ventoDoMar(costa, { ...a, pontos, costaMinMn }, { twd, horaPartida }, o)
      if (motivo) return { ...fora(motivo), porVento: true }
      for (const p of pontos) { if (p.perna === 'linha') delete p.costaLivre; else p.costaLivre = true }
      return { ...a, pontos, milhas: milhasDe(pontos), costaMinMn, sentido: t.sentido, linha: linhaSeguida }
    })
  } catch (e) {
    return excluir(motivoDoErro(e, log))
  }
}

// As alternativas para cada afastamento (e as variantes por canais, a seguir à de cada um; a
// direta só uma vez). posicao: { lat, lon } do barco; destino: da lista (ou { rotaAtiva:
// [[lat, lon] | {lat, lon}, …] } para usar o fim da rota ativa do OpenCPN). log(msg, erro): o
// registo dos erros de programação (por omissão console.error; no plugin, app.error).
function gerarRotas (costa, { posicao, destino, afastamentos = [3, 5, 8], twd, horaPartida, opcoes, log = logPadrao }) {
  const todas = (motivo) => afastamentos.map(afastamento => ({ afastamento, pontos: [], milhas: 0, excluida: true, motivo, avisos: [] }))
  try {
    if (!Number.isFinite(posicao?.lat) || !Number.isFinite(posicao?.lon)) return todas(MOTIVO_SEM_POSICAO)
    let dest = destino
    if (destino?.rotaAtiva) {
      const r = destinoDaRotaAtiva(costa, destino.rotaAtiva)
      if (!r) return todas(MOTIVO_SEM_ROTA_ATIVA)
      dest = r.destino
    }
    const partida = portoDePartida(costa, posicao) || { lat: posicao.lat, lon: posicao.lon }
    const alts = []
    for (const d of afastamentos) {
      for (const a of gerarAlternativas(costa, { partida, destino: dest, afastamento: d, twd, horaPartida, opcoes, log })) {
        // a rota direta é a mesma a qualquer afastamento: só uma vez
        if (a.direto && alts.some(x => x.direto)) continue
        alts.push(a)
      }
    }
    return alts
  } catch (e) {
    // ex.: pontos da rota ativa malformados (coordenadas não finitas)
    return todas(motivoDoErro(e, log))
  }
}

module.exports = { RAIO_PORTO_MN, AVISO_ROTA_ATIVA, CANAIS, carregarCanais, portoDePartida, destinoDaRotaAtiva, rumoParaTerra, ventoDeTerra, ventoDoMarNoDireto, ventoDoMar, gerarRota, gerarAlternativas, gerarRotas }
