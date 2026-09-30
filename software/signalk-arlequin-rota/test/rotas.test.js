'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

test('no mar entre as Berlengas e o continente: a projeção na linha não dá a volta às ilhas', () => {
  // a 39,39 N 9,45 W (no canal da Berlenga) a linha de 5 MN passa perto duas vezes: a norte
  // (antes de contornar as ilhas) e a sul (depois); ir para Peniche não pode dar a volta às ilhas.
  // Determinístico: cada uma das 3 alternativas verificada por si (nada de "se excluída, salta" —
  // se a janela de projeção for desativada, a de 5 MN passa a "rota absurda" e isto falha).
  const pos = { lat: 39.39, lon: -9.45 }
  const alts = r.gerarRotas(real, { posicao: pos, destino: D('peniche'), afastamentos: [3, 5, 8], twd: 90 })
  assert.equal(alts.length, 3, JSON.stringify(alts.map(a => [a.afastamento, a.direto, a.excluida])))
  const a3 = alts.find(a => a.afastamento === 3)
  assert.equal(a3.excluida, false, a3.motivo)
  assert.ok(a3.milhas > 9 && a3.milhas < 11, `3 MN: ${a3.milhas} MN`)
  assert.ok(a3.pontos.every(p => p.lon > -9.55), '3 MN: passa a oeste das Berlengas')
  const a5 = alts.find(a => a.afastamento === 5)
  assert.equal(a5.excluida, false, a5.motivo)
  assert.ok(a5.milhas > 12 && a5.milhas < 14.5, `5 MN: ${a5.milhas} MN`)
  assert.ok(a5.pontos.every(p => p.lon > -9.55), '5 MN: passa a oeste das Berlengas')
  // a direta (8 MN, mesma rota a qualquer afastamento) fica excluída: a menos de 3 MN da costa
  // (a Berlenga) com vento do mar
  const dir = alts.find(a => a.direto)
  assert.ok(dir, 'devia haver uma alternativa direta')
  assert.equal(dir.excluida, true)
  assert.match(dir.motivo, /^vento do mar em parte da rota: a rota direta passa a 1,\d MN de uma costa a sotavento$/)
})

test('rota absurda (muito mais comprida do que a distância em linha reta): excluída com o motivo', () => {
  // do lado sul do cabo para o lado norte: 1,2 MN em linha reta, mas pela linha de 5 MN dá a volta
  // (11,9 × — um erro de projeção real, bem longe do limite)
  const NORTE_DO_CABO = porto('ncabo', 'Norte do Cabo', [39.01, -9.02], [39.01, -9.01])
  const alt = r.gerarRota(inventada, { partida: SUL_DO_CABO, destino: NORTE_DO_CABO, afastamento: 5 })
  assert.equal(alt.excluida, true)
  assert.match(alt.motivo, /^rota absurda: \d+,\d MN para 1,2 MN em linha reta$/)
  assert.deepEqual(alt.pontos, [])
  const reta = c.distanciaMn(c.P(NORTE_DO_CABO.largo), c.P(SUL_DO_CABO.largo))
  // não fica perto do limite: o erro de projeção passa longe de qualquer fator razoável
  assert.ok(Number(alt.motivo.match(/^rota absurda: (\d+,\d) MN/)[1].replace(',', '.')) > 4.5 * reta, alt.motivo)
  // o limite é 4,0 × a linha reta: as voltas verdadeiras da costa passam (Algés → Setúbal pelo
  // Espichel dá 3,1 ×, Peniche → Nazaré pelas Berlengas 3,0 ×)
  for (const [a, b] of [['alges', 'setubal'], ['alges', 'sesimbra'], ['peniche', 'nazare']]) {
    const x = r.gerarRota(real, { partida: D(a), destino: D(b), afastamento: 5 })
    assert.equal(x.excluida, false, `${a} → ${b}: ${x.motivo}`)
    assert.ok(x.milhas > 2.5 * c.distanciaMn(x.pontos[0], x.pontos.at(-1)))
  }
})

test('fator da "rota absurda" (4,0): nenhum par real de dados/destinos.json a 8 MN passa dele (medido: máx. 3,41 ×)', () => {
  // Todos os 210 pares ordenados de dados/destinos.json, a 8 MN (o afastamento onde a folga da
  // "rota absurda" é menor, por ter a menor folga extra de tracar): ou a rota é normal e fica bem
  // abaixo do fator, ou é um par "dentro do Tejo" (mesma largo — Oeiras ↔ Algés) com o motivo
  // próprio, nunca "rota absurda". Medido sem opções (fatorAbsurdo real de produção, 4,0).
  let maxRatio = 0
  let maxPar = null
  for (const a of real.destinos) {
    for (const b of real.destinos) {
      if (a === b) continue
      const alt = r.gerarRota(real, { partida: a, destino: b, afastamento: 8 })
      if (alt.excluida) {
        assert.match(alt.motivo, /^(sem rota dentro do Tejo|a menos de \d MN da costa)/, `${a.id} → ${b.id}: ${alt.motivo}`)
        continue
      }
      const reta = c.distanciaMn(alt.pontos[0], alt.pontos.at(-1))
      const ratio = alt.milhas / reta
      if (ratio > maxRatio) { maxRatio = ratio; maxPar = [a.id, b.id] }
      assert.ok(ratio < 4.0, `${a.id} → ${b.id}: ${alt.milhas} MN para ${reta} MN (${ratio.toFixed(2)} ×)`)
    }
  }
  // o máximo medido (Algés ↔ Setúbal) fica ≥ 10 % abaixo do fator
  assert.ok(maxRatio > 3.0 && maxRatio < 4.0 / 1.1, `máx. ${maxRatio.toFixed(3)} × (${maxPar})`)
})

test('Tejo: Oeiras ↔ Algés (mesmo largo, a Barra Norte) não tem atalho por dentro do rio', () => {
  const oeiras = D('oeiras')
  const alges = D('alges')
  // ambos entram pelo mesmo largo (a Barra Norte do Tejo): sem essa rota, não é "rota absurda"
  assert.deepEqual(oeiras.largo, alges.largo)
  const ida = r.gerarRota(real, { partida: oeiras, destino: alges, afastamento: 5 })
  assert.equal(ida.excluida, true)
  assert.equal(ida.motivo, 'sem rota dentro do Tejo: sair pela barra ou navegar à vista')
  assert.deepEqual(ida.pontos, [])
  const volta = r.gerarRota(real, { partida: alges, destino: oeiras, afastamento: 8 })
  assert.equal(volta.excluida, true)
  assert.equal(volta.motivo, 'sem rota dentro do Tejo: sair pela barra ou navegar à vista')
  // Cascais também tem o mesmo largo, mas Cascais → Algés continua uma rota direta normal (fica
  // perto da barra, não faz a volta toda como Oeiras ↔ Algés)
  const cascaisAlges = r.gerarRota(real, { partida: D('cascais'), destino: alges, afastamento: 5, twd: 0 })
  assert.equal(cascaisAlges.excluida, false, cascaisAlges.motivo)
  assert.notEqual(cascaisAlges.motivo, 'sem rota dentro do Tejo: sair pela barra ou navegar à vista')
})

// Distância (MN) de p a uma zona: 0 dentro, senão à aresta mais perto.
function distanciaZona (p, z) {
  if (c.dentroAnel(p, z.poligono)) return 0
  const an = z.poligono.map(c.P)
  let mn = Infinity
  for (let i = 1; i < an.length; i++) mn = Math.min(mn, c.distanciaSegmento(p, an[i - 1], an[i]).mn)
  return mn
}

test('dados/canais.json: o Canal da Berlenga fica no mar, a ≥ 2 MN de terra e ≥ 0,5 MN das zonas', () => {
  const canais = JSON.parse(fs.readFileSync(path.join(c.PASTA_DADOS, 'canais.json'), 'utf8'))
  assert.ok(Array.isArray(canais) && canais.length >= 1)
  const berlenga = canais.find(k => k.nome === 'Canal da Berlenga')
  assert.ok(berlenga)
  for (const k of canais) {
    assert.equal(typeof k.nome, 'string')
    assert.equal(typeof k.fonte, 'string')
    assert.equal(k.confirmado, false)
    assert.ok(Number.isFinite(k.ondasMax))
    assert.ok(k.pontos.length >= 2)
    const pts = k.pontos.map(c.P)
    for (let i = 1; i < pts.length; i++) {
      assert.equal(real.verificarTroco(pts[i - 1], pts[i]), null, `${k.nome}: troço ${i}`)
      const n = Math.ceil(c.distanciaMn(pts[i - 1], pts[i]) / 0.05)
      for (let m = 0; m <= n; m++) {
        const q = { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * m / n, lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * m / n }
        assert.ok(real.distanciaTerra(q) >= 2, `${k.nome}: ${q.lat} ${q.lon} a ${real.distanciaTerra(q)} MN de terra`)
        for (const z of real.zonas) assert.ok(distanciaZona(q, z) >= 0.5, `${k.nome}: a ${distanciaZona(q, z)} MN de ${z.nome}`)
      }
    }
  }
  assert.equal(berlenga.ondasMax, 3)
  // do sul (lado de Peniche) para norte, entre o Cabo Carvoeiro e a Berlenga
  assert.ok(berlenga.pontos[0][0] < berlenga.pontos.at(-1)[0])
  for (const [lat, lon] of berlenga.pontos) assert.ok(lat > 39.3 && lat < 39.48 && lon > -9.52 && lon < -9.38, `${lat} ${lon}`)
})

test('Canal da Berlenga: a variante corta a volta às ilhas quando a linha a dá', () => {
  const alts = r.gerarAlternativas(real, { partida: D('peniche'), destino: D('nazare'), afastamento: 5 })
  assert.equal(alts.length, 2)
  const [volta, canal] = alts
  assert.equal(volta.excluida, false, volta.motivo)
  assert.equal(volta.canal, undefined)
  assert.ok(volta.milhas > 55 && volta.milhas < 64, `${volta.milhas} MN`)
  assert.ok(volta.pontos.some(p => p.lon < -9.55), 'a volta passa a oeste das Berlengas')
  assert.equal(canal.excluida, false, canal.motivo)
  assert.equal(canal.canal, 'Canal da Berlenga')
  assert.equal(canal.ondasMax, 3)
  assert.equal(canal.afastamento, 5)
  // ~35 MN: do largo de Peniche direto à ponta sul do canal, o canal (8 MN) e da ponta norte de
  // volta à linha de 5 MN até à Nazaré (19,8 MN em linha reta de cais a cais)
  assert.ok(canal.milhas > 30 && canal.milhas < 38 && canal.milhas < 0.65 * volta.milhas, `${canal.milhas} MN`)
  assert.equal(canal.pontos[canal.pontos.findIndex(p => p.nome === 'Canal da Berlenga') - 1].nome, 'Largo de Peniche')
  assert.ok(canal.pontos.every(p => p.lon > -9.52), 'não vai a oeste da Berlenga')
  assert.ok(canal.avisos.includes('Canal da Berlenga por confirmar na carta'))
  // nota: terra dos dois lados do canal — decisão do Ivo (30/09), não uma falha da regra do vento
  assert.equal(canal.nota, 'Canal da Berlenga: terra dos dois lados; só com ondas < 3 m — por confirmar na carta')
  // passa por todos os pontos do canal, por ordem (de sul para norte), fora da regra do afastamento
  const k = JSON.parse(fs.readFileSync(path.join(c.PASTA_DADOS, 'canais.json'), 'utf8')).find(x => x.nome === 'Canal da Berlenga')
  const idx = k.pontos.map(([lat, lon]) => canal.pontos.findIndex(p => p.lat === lat && p.lon === lon))
  assert.ok(idx.every((x, i) => x > 0 && (i === 0 || x === idx[i - 1] + 1)), JSON.stringify(idx))
  assert.equal(canal.pontos[idx[0]].nome, 'Canal da Berlenga')
  for (const x of idx.slice(1)) assert.equal(canal.pontos[x].perna, 'canal')
  for (const x of idx) assert.equal(canal.pontos[x].costaLivre, true)
  // nenhum troço fora das aproximações toca em terra ou em zonas
  for (let i = 1; i < canal.pontos.length; i++) if (!['porto', 'aproximacao'].includes(canal.pontos[i].perna)) assert.equal(real.verificarTroco(canal.pontos[i - 1], canal.pontos[i]), null, `troço ${i}`)
  // no sentido contrário (Nazaré → Peniche) também, com o canal percorrido de norte para sul
  const inv = r.gerarAlternativas(real, { partida: D('nazare'), destino: D('peniche'), afastamento: 5 })
  const cInv = inv.find(a => a.canal)
  assert.ok(cInv && !cInv.excluida && cInv.milhas < 38, JSON.stringify(inv.map(a => [a.canal, a.milhas, a.motivo])))
  const idxInv = k.pontos.map(([lat, lon]) => cInv.pontos.findIndex(p => p.lat === lat && p.lon === lon))
  assert.ok(idxInv.every((x, i) => i === 0 || x === idxInv[i - 1] - 1), JSON.stringify(idxInv))
  // gerarRotas junta as variantes; gerarRota dá só a da linha
  const todas = r.gerarRotas(real, { posicao: c.P(D('peniche').aproximacao.at(-1)), destino: D('nazare'), afastamentos: [5] })
  assert.deepEqual(todas.map(a => a.canal || null), [null, 'Canal da Berlenga'])
  assert.equal(r.gerarRota(real, { partida: D('peniche'), destino: D('nazare'), afastamento: 5 }).canal, undefined)
})

test('Canal da Berlenga: sem variante quando a rota não dá a volta às ilhas', () => {
  const alts = r.gerarAlternativas(real, { partida: D('alges'), destino: D('peniche'), afastamento: 5 })
  assert.equal(alts.length, 1)
  assert.equal(alts[0].canal, undefined)
  assert.equal(r.gerarAlternativas(real, { partida: D('peniche'), destino: D('cascais'), afastamento: 8 }).length, 1)
  assert.equal(r.gerarAlternativas(real, { partida: D('nazare'), destino: D('figueira'), afastamento: 5 }).length, 1)
})

test('Canal da Berlenga: terra dos dois lados não é vento de terra (decisão do Ivo, 30/09) — mas a linha antes/depois do canal continua sujeita à regra dos 3 MN', () => {
  // com vento de terra em toda a parte (twd 90, como o resto dos testes do canal): a variante de
  // 3 MN passa, mesmo com os pontos do canal a só 2,7 MN de terra (não são verificados)
  const uniforme = r.gerarAlternativas(real, { partida: D('peniche'), destino: D('nazare'), afastamento: 3, twd: 90 })
  const canalUniforme = uniforme.find(a => a.canal)
  assert.equal(canalUniforme.excluida, false, canalUniforme.motivo)
  // vento do mar só no troço da linha depois do canal (lado da Nazaré, lat > 39,45 — fora do
  // canal): a variante fica excluída pelo motivo do vento, tal como a alternativa normal de 3 MN,
  // mesmo sem nenhuma regra de vento nos pontos do canal em si
  const twdNazare = (lat) => (lat > 39.45 ? 270 : 90)
  const misto = r.gerarAlternativas(real, { partida: D('peniche'), destino: D('nazare'), afastamento: 3, twd: twdNazare })
  const linha = misto.find(a => !a.canal)
  const canal = misto.find(a => a.canal)
  assert.equal(linha.excluida, true)
  assert.equal(linha.motivo, VENTO_DO_MAR)
  assert.equal(canal.excluida, true, 'a linha antes/depois do canal também tem de ser verificada')
  assert.equal(canal.motivo, VENTO_DO_MAR)
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
  assert.equal(r.gerarRota(zona, { partida: SUL_DO_CABO, destino: NORTE, afastamento: 5 }).motivo, 'a rota a 5 MN passa na zona a evitar "Zona inventada"')
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
  // O motivo é uma frase para o Ivo, sem o JSON cru dos dados.
  const COORDENADAS = 'coordenadas inválidas: a posição ou um ponto da rota não tem latitude e longitude válidas'
  const semGps = r.gerarRota(inventada, { partida: { lat: NaN, lon: -9.05 }, destino: NORTE, afastamento: 5 })
  assert.equal(semGps.excluida, true)
  assert.equal(semGps.motivo, COORDENADAS)
  assert.deepEqual(semGps.pontos, [])
  // o mesmo para gerarRotas com uma rota ativa do OpenCPN malformada (coordenadas não finitas)
  const alts = r.gerarRotas(inventada, { posicao: { lat: 38.99, lon: -9.02 }, destino: { rotaAtiva: [{ lat: 39.1, lon: NaN }] }, afastamentos: [3, 5] })
  assert.equal(alts.length, 2)
  for (const a of alts) { assert.equal(a.excluida, true); assert.equal(a.motivo, COORDENADAS) }
})

test('erros de programação: motivo fixo para o Ivo e o erro verdadeiro no registo', () => {
  const erros = []
  const log = (...a) => erros.push(a)
  const partida = SUL_DO_CABO
  const quebrada = { ...inventada, linha: () => { throw new TypeError("Cannot read properties of undefined (reading 'pts')") } }
  const alt = r.gerarRota(quebrada, { partida, destino: NORTE, afastamento: 5, log })
  assert.equal(alt.excluida, true)
  assert.equal(alt.motivo, 'erro interno ao gerar esta rota')
  assert.deepEqual(alt.pontos, [])
  assert.equal(erros.length, 1)
  assert.ok(erros[0].some(x => x instanceof TypeError), 'o erro verdadeiro vai para o registo')
  // gerarRotas passa o registo e também não rebenta
  const alts = r.gerarRotas(quebrada, { posicao: { lat: 38.99, lon: -9.01 }, destino: NORTE, afastamentos: [5, 8], log })
  assert.deepEqual(alts.map(a => a.motivo), ['erro interno ao gerar esta rota', 'erro interno ao gerar esta rota'])
  assert.equal(erros.length, 3)
  // coordenadas inválidas não são erro de programação: sem registo
  r.gerarRota(inventada, { partida: { lat: NaN, lon: -9.05 }, destino: NORTE, afastamento: 5, log })
  assert.equal(erros.length, 3)
})

test('sem rota ativa ou sem posição: alternativas excluídas com o motivo, nunca rebenta', () => {
  const vazia = r.gerarRotas(real, { posicao: { lat: 38.9, lon: -9.6 }, destino: { rotaAtiva: [] }, afastamentos: [3, 5] })
  assert.deepEqual(vazia.map(a => [a.afastamento, a.excluida, a.motivo]), [[3, true, 'não há rota ativa no OpenCPN'], [5, true, 'não há rota ativa no OpenCPN']])
  for (const posicao of [null, undefined, { lat: NaN, lon: -9.6 }, {}]) {
    const alts = r.gerarRotas(real, { posicao, destino: D('peniche'), afastamentos: [5, 8] })
    assert.deepEqual(alts.map(a => [a.afastamento, a.excluida, a.motivo]), [[5, true, 'sem posição do GPS: não sei de onde parte o barco'], [8, true, 'sem posição do GPS: não sei de onde parte o barco']])
  }
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
  // o destino avulso cumpre o contrato do costa.js (1 <= entrada <= aproximacao.length - 1)
  assert.equal(avulso.destino.entrada, avulso.destino.aproximacao.length - 1)
  assert.ok(avulso.destino.entrada >= 1)
  assert.deepEqual(real.verificarAproximacao(avulso.destino), [])
  const [alt] = r.gerarRotas(real, { posicao: { lat: 38.6955, lon: -9.233 }, destino: { rotaAtiva: [[38.7, -9.5], [39.1, -9.6]] }, afastamentos: [5] })
  assert.equal(alt.excluida, false, alt.motivo)
  assert.deepEqual(alt.avisos, ['último troço por confirmar na carta'])
  assert.deepEqual([alt.pontos.at(-1).lat, alt.pontos.at(-1).lon], [39.1, -9.6])
  assert.equal(alt.pontos.at(-1).perna, 'ligacao')
  assert.equal(alt.pontos.at(-1).nome, 'Fim da rota ativa')
  for (let i = 1; i < alt.pontos.length; i++) assert.ok(c.distanciaMn(alt.pontos[i - 1], alt.pontos[i]) > 0, `ponto ${i} repetido`)
  assert.equal(r.destinoDaRotaAtiva(real, []), null)
})

test('rápido: as 3 alternativas de Algés → Lagos em menos de 2 s (limite largo, para máquinas lentas)', () => {
  const t = performance.now()
  const alts = r.gerarRotas(real, { posicao: { lat: 38.6955, lon: -9.233 }, destino: D('lagos'), twd: 45 })
  assert.equal(alts.length, 3)
  assert.ok(performance.now() - t < 2000)
})
