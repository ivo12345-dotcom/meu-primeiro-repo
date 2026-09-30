'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../lib/costa')
const r = require('../lib/rotas')

const real = c.carregarCosta()
const D = (id) => real.destinos.find(d => d.id === id)

// Distância mínima à terra ao longo dos troços com perna 'linha', de 0,1 em 0,1 MN.
function minimoNaLinha (costa, pontos) {
  let mn = Infinity
  for (let i = 1; i < pontos.length; i++) {
    if (pontos[i].perna !== 'linha') continue
    const a = pontos[i - 1]; const b = pontos[i]
    const n = Math.ceil(c.distanciaMn(a, b) / 0.1)
    for (let k = 0; k <= n; k++) mn = Math.min(mn, costa.distanciaTerra({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }))
  }
  return mn
}

// Deriva a perna esperada de um ponto da aproximação a partir de `entrada` e do comprimento
// da lista (a mesma regra do lib/rotas.js), em vez de fixar índices: os dados de destinos.json
// mudam de tamanho (a Barra Norte de Algés ganhou mais pontos), mas a regra não.
function pernaEsperadaSaida (destino, k) { // k = índice no array de saída (pontosSaida); 0 = cais
  const entrada = Number.isInteger(destino.entrada) ? destino.entrada : destino.aproximacao.length - 1
  const i = destino.aproximacao.length - k
  return i > entrada ? 'porto' : 'aproximacao'
}
function pernaEsperadaEntrada (destino, i) { // i = índice na aproximação; 0 = largo
  if (i === 0) return 'ligacao'
  const entrada = Number.isInteger(destino.entrada) ? destino.entrada : destino.aproximacao.length - 1
  return i > entrada ? 'porto' : 'aproximacao'
}

test('Algés → Peniche a 5 MN: do cais ao cais, e depois do largo de Cascais nunca a menos de 4,9 MN de terra', () => {
  const alt = r.gerarRota(real, { partida: D('alges'), destino: D('peniche'), afastamento: 5 })
  assert.equal(alt.excluida, false, alt.motivo)
  const p = alt.pontos
  assert.equal(p[0].nome, 'Algés (CNA) (partida)')
  assert.equal(p.at(-1).nome, 'Peniche')
  const alges = D('alges')
  const largoIdx = alges.aproximacao.length - 1 // último ponto de pontosSaida = o largo
  for (let k = 1; k <= largoIdx; k++) assert.equal(p[k].perna, pernaEsperadaSaida(alges, k), `p[${k}].perna (saída de Algés)`)
  assert.equal(p[largoIdx].nome, 'Largo de Algés (CNA)')
  assert.equal(p[largoIdx + 1].perna, 'ligacao')
  const peniche = D('peniche')
  const cauda = p.slice(-peniche.aproximacao.length)
  cauda.forEach((x, i) => assert.equal(x.perna, pernaEsperadaEntrada(peniche, i), `entrada[${i}].perna (Peniche)`))
  const mn = minimoNaLinha(real, p)
  assert.ok(mn >= 4.9, `mínimo ${mn}`)
  for (let i = 1; i < p.length; i++) if (p[i].perna === 'linha') assert.ok(c.distanciaMn(p[i - 1], p[i]) <= 2 + 1e-6)
  // nenhuma ligação nem troço da linha toca em terra ou zonas
  for (let i = 1; i < p.length; i++) if (p[i].perna === 'linha' || p[i].perna === 'ligacao') assert.equal(real.verificarTroco(p[i - 1], p[i]), null)
  assert.ok(alt.milhas > 58 && alt.milhas < 68, `${alt.milhas} MN`)
  assert.equal(p.filter(x => x.costaLivre).length, p.filter(x => x.perna !== 'linha').length)
})

const VENTO_DO_MAR = 'vento do mar em parte da rota: a 3 MN ficava perto de uma costa a sotavento'

test('3 MN só com vento de terra EM TODA a linha seguida; os 5 e 8 MN não dependem do vento', () => {
  // Nazaré → Figueira: costa oeste direita, a normal para terra fica entre 085° e 115° em toda a linha
  const com = r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3, twd: 90 })
  assert.equal(com.excluida, false, com.motivo)
  const mar = r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3, twd: 280 })
  assert.equal(mar.excluida, true)
  assert.equal(mar.motivo, VENTO_DO_MAR)
  assert.match(r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3 }).motivo, /não há vento previsto/)
  assert.equal(r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 5, twd: 280 }).excluida, false)
  // a normal para terra na linha de 5 MN à latitude da Ericeira aponta para leste
  const L = real.linha(5)
  const s = c.projetar(L, { lat: 38.96, lon: -9.53 }).s
  assert.ok(Math.abs(c.dif(r.rumoParaTerra(real, L, s), 90)) < 30)
})

test('3 MN: o vento de terra à saída não chega, conta a linha toda (costa a sotavento mais à frente)', () => {
  // Algés → Peniche com NW: à saída (Cascais, terra a norte) o vento é de terra, mas na costa
  // oeste vem do mar
  assert.equal(r.gerarRota(real, { partida: D('alges'), destino: D('peniche'), afastamento: 3, twd: 315 }).motivo, VENTO_DO_MAR)
  // Lagos → Sines com W: de terra em parte da costa sul, do mar na costa alentejana
  assert.equal(r.gerarRota(real, { partida: D('lagos'), destino: D('sines'), afastamento: 3, twd: 270 }).motivo, VENTO_DO_MAR)
  // o vento pode mudar ao longo da rota: com a hora de partida, a função recebe a hora estimada
  // de passagem em cada ponto (a 5 nós desde a partida)
  const T0 = Date.parse('2026-09-30T08:00:00Z')
  const horas = []
  const fn = (lat, lon, t) => { horas.push(t); return 90 }
  const alt = r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3, twd: fn, horaPartida: T0 })
  assert.equal(alt.excluida, false, alt.motivo)
  assert.ok(horas.length >= 10, `${horas.length} pontos`)
  for (let i = 1; i < horas.length; i++) assert.ok(horas[i] > horas[i - 1])
  assert.ok(horas[0] > T0 && horas[0] < T0 + 3600e3, 'o primeiro ponto da linha fica a menos de 5 MN da partida')
  const ultimaH = (horas.at(-1) - T0) / 3600e3
  assert.ok(ultimaH > 0.8 * alt.milhas / 5 && ultimaH < alt.milhas / 5, `${ultimaH} h para ${alt.milhas} MN`)
  // o vento roda para o mar ao fim de 3 h (a ~15 MN): excluída
  const roda = (lat, lon, t) => (t < T0 + 3 * 3600e3 ? 90 : 270)
  assert.equal(r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3, twd: roda, horaPartida: T0 }).motivo, VENTO_DO_MAR)
  // sem hora de partida, a função é chamada só com (lat, lon): a previsão da hora de partida
  const args = []
  r.gerarRota(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 3, twd: (...a) => { args.push(a.length); return 90 } })
  assert.ok(args.length > 0 && args.every(n => n === 2))
})

const NOTA_DIRETO = 'salto curto entre portos vizinhos: rota direta junto à costa'

test('salto curto entre portos vizinhos: UMA alternativa direta, com a distância real à terra', () => {
  // Cascais → Algés: o largo é o mesmo, não há linha a seguir a nenhum afastamento
  const ca = r.gerarRotas(real, { posicao: c.P(D('cascais').aproximacao.at(-1)), destino: D('alges'), twd: 0 })
  assert.equal(ca.length, 1, JSON.stringify(ca.map(a => [a.afastamento, a.direto, a.motivo])))
  const [d] = ca
  assert.equal(d.excluida, false, d.motivo)
  assert.equal(d.direto, true)
  assert.equal(d.afastamento, null)
  assert.ok(d.costaMinMn > 2 && d.costaMinMn < 3, `${d.costaMinMn}`)
  assert.ok(d.avisos.includes(NOTA_DIRETO))
  assert.equal(d.pontos[0].nome, 'Cascais (partida)')
  assert.equal(d.pontos.at(-1).nome, 'Algés (CNA)')
  assert.equal(d.pontos.filter(p => p.perna === 'linha').length, 0)
  // Lagos → Portimão: a 3 MN segue a linha (é outra rota), a 5 e 8 MN seria a direta repetida
  // (vento de NNW: de terra em todo o troço direto; no largo de Lagos a terra mais perto é a Ponta
  // da Piedade, a oeste, por isso o norte puro fica a 71° da normal)
  const lp = r.gerarRotas(real, { posicao: c.P(D('lagos').aproximacao.at(-1)), destino: D('portimao'), twd: 340 })
  assert.deepEqual(lp.map(a => [a.afastamento, !!a.direto]), [[3, false], [null, true]])
  const dir = lp[1]
  assert.equal(dir.excluida, false, dir.motivo)
  // a distância mínima real (do largo de Lagos ao de Portimão), não 5 nem 8
  assert.ok(dir.costaMinMn > 1 && dir.costaMinMn < 2.5, `${dir.costaMinMn}`)
  let mn = Infinity
  for (let i = 1; i < dir.pontos.length; i++) {
    if (dir.pontos[i].perna !== 'ligacao') continue
    const a = dir.pontos[i - 1]; const b = dir.pontos[i]
    for (let k = 0; k <= 50; k++) mn = Math.min(mn, real.distanciaTerra({ lat: a.lat + (b.lat - a.lat) * k / 50, lon: a.lon + (b.lon - a.lon) * k / 50 }))
  }
  assert.ok(Math.abs(mn - dir.costaMinMn) < 0.05, `${mn} vs ${dir.costaMinMn}`)
  // a menos de 3 MN da costa: a regra dos 3 MN aplica-se (vento do sul = do mar na costa algarvia)
  const sul = r.gerarRotas(real, { posicao: c.P(D('lagos').aproximacao.at(-1)), destino: D('portimao'), twd: 180 })
  const dirSul = sul.find(a => a.direto)
  assert.equal(dirSul.excluida, true)
  assert.match(dirSul.motivo, /^vento do mar em parte da rota: a rota direta passa a 1,\d MN de uma costa a sotavento$/)
  // gerarRota sozinha também marca a direta
  const so = r.gerarRota(real, { partida: D('cascais'), destino: D('alges'), afastamento: 5, twd: 0 })
  assert.equal(so.direto, true)
  assert.equal(so.afastamento, null)
})

test('partida dentro da aproximação de um porto (no Tejo): segue a aproximação até ao largo', () => {
  const pos = { lat: 38.69, lon: -9.26 } // no canal do Tejo, a 1,2 MN do CNA
  assert.equal(r.portoDePartida(real, pos), null)
  const sines = r.gerarRotas(real, { posicao: pos, destino: D('sines'), twd: 45 })
  for (const a of sines) assert.doesNotMatch(a.motivo || '', /não há passagem/, `${a.afastamento}: ${a.motivo}`)
  const a5 = sines.find(a => a.afastamento === 5)
  assert.equal(a5.excluida, false, a5.motivo)
  assert.equal(a5.pontos[0].nome, 'Posição atual')
  // do ponto mais perto da aproximação de Algés, para fora, até ao largo (pela Barra Norte)
  const largo = a5.pontos.findIndex(p => p.nome === 'Largo de Algés (CNA)')
  assert.ok(largo > 1, 'passa pelo largo de Algés')
  for (let i = 1; i <= largo; i++) assert.ok(['aproximacao', 'porto'].includes(a5.pontos[i].perna), `p[${i}].perna = ${a5.pontos[i].perna}`)
  assert.ok(c.distanciaMn(a5.pontos[0], a5.pontos[1]) < 0.5)
  for (let i = 1; i < a5.pontos.length; i++) assert.equal(real.verificarTroco(a5.pontos[i - 1], a5.pontos[i], { terra: true, zonas: true }), null, `troço ${i}`)
  // para o próprio Algés: segue a aproximação para dentro, até ao cais (não sai à barra)
  const alges = r.gerarRotas(real, { posicao: pos, destino: D('alges'), twd: 45 })
  assert.equal(alges.length, 1)
  assert.equal(alges[0].excluida, false, alges[0].motivo)
  assert.equal(alges[0].direto, true)
  assert.equal(alges[0].pontos.at(-1).nome, 'Algés (CNA)')
  assert.ok(alges[0].milhas < 2, `${alges[0].milhas} MN`)
})

// Costa inventada: costa N-S em 9,0 W com um cabo fino para oeste a 39,0 N (até 9,08 W),
// um ilhéu junto à linha e uma lagoa fechada; a "linha de 5 MN" é uma reta em 9,15 W.
const terra = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-9.0, 38.4], [-8.5, 38.4], [-8.5, 39.6], [-9.0, 39.6], [-9.0, 39.002], [-9.08, 39.002], [-9.08, 38.998], [-9.0, 38.998], [-9.0, 38.4]], [[-8.9, 38.65], [-8.8, 38.65], [-8.8, 38.75], [-8.9, 38.75], [-8.9, 38.65]]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-9.088, 39.226], [-9.082, 39.226], [-9.082, 39.232], [-9.088, 39.232], [-9.088, 39.226]]] } }
  ]
}
// aproximacao: [largo, cais], entrada: 1 (o cais é o próprio ponto de entrada; com uma lista de
// só 2 pontos, entrada tem de ser o último índice — lib/costa.js exige 1 <= entrada <= length-1).
// O cais fica no mar (a oeste de 9,0 W, tal como o largo): com a `entrada` na lista toda, a terra
// verifica-se sempre neste troço (só se dispensa com `portoFechadoOsm`), por isso não pode cair
// dentro da terra inventada como caía na versão antiga do costa.js (que dispensava com entrada 0).
const porto = (id, nome, largo, cais) => ({ id, nome, abrigo: true, conhecido: true, largo, aproximacao: [largo, cais], entrada: 1 })
const SUL_DO_CABO = porto('sul', 'Sul do Cabo', [38.99, -9.02], [38.99, -9.01])
const NORTE = porto('norte', 'Norte', [39.45, -9.05], [39.45, -9.01])
const JUNTO_ILHEU = porto('ilheu', 'Junto ao Ilhéu', [39.2, -9.02], [39.2, -9.01])
const LAGOA = porto('lagoa', 'Lagoa', [38.7, -8.85], [38.72, -8.85])
const inventada = c.criarCosta({ terra, destinos: [SUL_DO_CABO, NORTE, JUNTO_ILHEU, LAGOA], linhas: { 5: [[39.6, -9.15], [38.4, -9.15]] } })

test('a ligação à linha que corta o cabo é corrigida (liga mais de lado, a sul do cabo)', () => {
  const L = inventada.linha(5)
  const p = c.P(SUL_DO_CABO.largo)
  // o ponto "à frente" (≤ 60°) fica a norte do cabo e o troço corta-o
  const frente = c.juntar(L, p, -1)
  assert.ok(frente.lat > 39.04)
  assert.equal(inventada.cruzaTerra(p, frente), true)
  const alt = r.gerarRota(inventada, { partida: SUL_DO_CABO, destino: NORTE, afastamento: 5 })
  assert.equal(alt.excluida, false, alt.motivo)
  const liga = alt.pontos.find(x => x.nome === 'Linha de 5 MN')
  assert.ok(liga.lat < 38.9985, `liga em ${liga.lat}`) // passa a sul do cabo
  for (let i = 1; i < alt.pontos.length; i++) if (alt.pontos[i].perna !== 'porto') assert.equal(inventada.cruzaTerra(alt.pontos[i - 1], alt.pontos[i]), false)
})

test('a ligação que passa num ilhéu avança pela linha até ficar livre (≤ 5 MN)', () => {
  const L = inventada.linha(5)
  const p = c.P(JUNTO_ILHEU.largo)
  const frente = c.juntar(L, p, -1)
  assert.equal(inventada.cruzaTerra(p, frente), true)
  const alt = r.gerarRota(inventada, { partida: JUNTO_ILHEU, destino: NORTE, afastamento: 5 })
  assert.equal(alt.excluida, false, alt.motivo)
  const liga = alt.pontos.find(x => x.nome === 'Linha de 5 MN')
  assert.ok(liga.lat > frente.lat && c.distanciaMn(liga, frente) <= 5, `liga em ${liga.lat}`)
  assert.equal(inventada.cruzaTerra(p, liga), false)
})

test('sem passagem: excluída com o motivo em português', () => {
  const alt = r.gerarRota(inventada, { partida: NORTE, destino: LAGOA, afastamento: 5 })
  assert.equal(alt.excluida, true)
  assert.equal(alt.motivo, 'não há passagem a 5 MN entre Norte e Lagoa')
  assert.deepEqual(alt.pontos, [])
  const semLinha = r.gerarRota(inventada, { partida: NORTE, destino: SUL_DO_CABO, afastamento: 8 })
  assert.equal(semLinha.motivo, 'não há linha de costa a 8 MN')
  const emTerra = r.gerarRota(inventada, { partida: { lat: 39.3, lon: -8.9 }, destino: NORTE, afastamento: 5 })
  assert.equal(emTerra.motivo, 'a posição atual fica em terra')
  const zona = c.criarCosta({ terra, destinos: [], zonas: [{ nome: 'Zona inventada', poligono: [[39.0, -9.2], [39.0, -9.1], [39.3, -9.1], [39.3, -9.2], [39.0, -9.2]] }], linhas: { 5: [[39.6, -9.15], [38.4, -9.15]] } })
  assert.match(r.gerarRota(zona, { partida: SUL_DO_CABO, destino: NORTE, afastamento: 5 }).motivo, /passa na zona a evitar "Zona inventada"|não há passagem/)
})

test('entrada inválida e coordenadas não finitas: excluída com o motivo em português, nunca rebenta', () => {
  // lib/costa.js: verificarAproximacao reporta 'entrada inválida' (sem rebentar) quando o destino
  // não tem um índice de entrada válido (1 <= entrada <= aproximacao.length - 1)
  const semEntrada = { ...NORTE, entrada: 0 }
  const alt = r.gerarRota(inventada, { partida: SUL_DO_CABO, destino: semEntrada, afastamento: 5 })
  assert.equal(alt.excluida, true)
  assert.match(alt.motivo, /^a entrada de Norte /)
  assert.match(alt.motivo, /entrada mal definida/)
  // lib/costa.js: P() rebenta com coordenadas não finitas; gerarRota apanha o erro e exclui a
  // alternativa em vez de deixar a exceção escapar por resolver (nunca pode derrubar o servidor).
  const semGps = r.gerarRota(inventada, { partida: { lat: NaN, lon: -9.05 }, destino: NORTE, afastamento: 5 })
  assert.equal(semGps.excluida, true)
  assert.equal(typeof semGps.motivo, 'string')
  assert.deepEqual(semGps.pontos, [])
  // o mesmo para gerarRotas com uma rota ativa do OpenCPN malformada (coordenadas não finitas)
  const alts = r.gerarRotas(inventada, { posicao: { lat: 38.99, lon: -9.02 }, destino: { rotaAtiva: [{ lat: 39.1, lon: NaN }] }, afastamentos: [3, 5] })
  assert.equal(alts.length, 2)
  for (const a of alts) { assert.equal(a.excluida, true); assert.equal(typeof a.motivo, 'string') }
})

test('partida: do porto (≤ 0,5 MN do cais) ou da posição atual no mar', () => {
  assert.equal(r.portoDePartida(real, { lat: 38.6955, lon: -9.233 }).id, 'alges')
  assert.equal(r.portoDePartida(real, { lat: 39.353 + 0.4 / 60, lon: -9.377 }).id, 'peniche')
  assert.equal(r.portoDePartida(real, { lat: 38.9, lon: -9.6 }), null)
  const [a3, a5] = r.gerarRotas(real, { posicao: { lat: 38.9, lon: -9.6 }, destino: D('peniche'), afastamentos: [3, 5], twd: 90 })
  assert.equal(a5.excluida, false, a5.motivo)
  assert.equal(a5.pontos[0].nome, 'Posição atual')
  assert.equal(a5.pontos[1].perna, 'ligacao')
  assert.equal(a3.afastamento, 3)
  const [doPorto] = r.gerarRotas(real, { posicao: { lat: 38.6955, lon: -9.233 }, destino: D('peniche'), afastamentos: [5] })
  assert.equal(doPorto.pontos[0].nome, 'Algés (CNA) (partida)')
})

test('destino pela rota ativa do OpenCPN: o largo da lista, ou um ponto avulso com o aviso', () => {
  const lista = r.destinoDaRotaAtiva(real, [[38.7, -9.5], [39.31, -9.421]])
  assert.equal(lista.destino.id, 'peniche')
  assert.equal(lista.aviso, null)
  const avulso = r.destinoDaRotaAtiva(real, [{ lat: 38.7, lon: -9.5 }, { lat: 39.1, lon: -9.6 }])
  assert.equal(avulso.destino.porConfirmar, true)
  assert.equal(avulso.aviso, 'último troço por confirmar na carta')
  const [alt] = r.gerarRotas(real, { posicao: { lat: 38.6955, lon: -9.233 }, destino: { rotaAtiva: [[38.7, -9.5], [39.1, -9.6]] }, afastamentos: [5] })
  assert.equal(alt.excluida, false, alt.motivo)
  assert.deepEqual(alt.avisos, ['último troço por confirmar na carta'])
  assert.deepEqual([alt.pontos.at(-1).lat, alt.pontos.at(-1).lon], [39.1, -9.6])
  assert.equal(alt.pontos.at(-1).perna, 'ligacao')
  assert.equal(r.destinoDaRotaAtiva(real, []), null)
})

test('rápido: as 3 alternativas de Algés → Lagos em menos de 300 ms', () => {
  const t = performance.now()
  const alts = r.gerarRotas(real, { posicao: { lat: 38.6955, lon: -9.233 }, destino: D('lagos'), twd: 45 })
  assert.equal(alts.length, 3)
  assert.ok(performance.now() - t < 300)
})
