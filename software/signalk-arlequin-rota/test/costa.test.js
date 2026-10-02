'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../lib/costa')

// Terra inventada: um quadrado de 0,2° (39,0–39,2 N; 9,2–9,0 W) com um lago
// (buraco) no meio, uma ilha pequena a oeste, uma zona a evitar e um porto.
const quadrado = [[-9.2, 39.0], [-9.0, 39.0], [-9.0, 39.2], [-9.2, 39.2], [-9.2, 39.0]]
const lago = [[-9.12, 39.08], [-9.08, 39.08], [-9.08, 39.12], [-9.12, 39.12], [-9.12, 39.08]]
const ilha = [[-9.5, 39.1], [-9.49, 39.1], [-9.49, 39.11], [-9.5, 39.11], [-9.5, 39.1]]
const TERRA = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [quadrado, lago] } },
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ilha]] } }
  ]
}
const ZONA = { nome: 'Baixio inventado', tipo: 'baixio', poligono: [[38.9, -9.4], [38.9, -9.3], [38.95, -9.3], [38.95, -9.4], [38.9, -9.4]] }
// Porto na costa oeste do quadrado: o cais fica "em terra" (bacia fechada, como no OSM).
// portoFechadoOsm: true porque o troço 2 (depois da entrada) entra na "bacia" fechada por terra.
const PORTO = { id: 'inventado', nome: 'Porto Inventado', largo: [39.1, -9.3], aproximacao: [[39.1, -9.3], [39.1, -9.21], [39.1, -9.19]], entrada: 1, portoFechadoOsm: true }
const costa = c.criarCosta({ terra: TERRA, zonas: [ZONA], destinos: [PORTO], linhas: { 5: [[39.4, -9.35], [39.1, -9.35], [38.8, -9.35], [38.8, -9.0]] } })

test('ponto em terra: dentro do quadrado, não no lago nem no mar; a ilha conta', () => {
  assert.equal(costa.emTerra({ lat: 39.05, lon: -9.05 }), true)
  assert.equal(costa.emTerra({ lat: 39.1, lon: -9.1 }), false) // o lago (buraco)
  assert.equal(costa.emTerra({ lat: 39.1, lon: -9.3 }), false)
  assert.equal(costa.emTerra({ lat: 39.105, lon: -9.495 }), true)
  assert.equal(costa.emTerra({ lat: 45, lon: -9.1 }), false) // fora da grelha
  assert.equal(costa.emTerra([39.05, -9.05]), true) // também aceita [lat, lon]
})

test('distância à terra em MN (escalas WGS84), 0 em terra, Infinity longe de tudo', () => {
  const k = c.escalas(39.1)
  // a oeste do quadrado 0,1° de longitude, longe da ilha
  assert.ok(Math.abs(costa.distanciaTerra({ lat: 39.15, lon: -9.3 }) - 0.1 * c.escalas(39.15).kx) < 1e-6)
  // a norte, 0,05° de latitude
  assert.ok(Math.abs(costa.distanciaTerra({ lat: 39.25, lon: -9.1 }) - 0.05 * c.escalas(39.25).ky) < 0.01)
  assert.equal(costa.distanciaTerra({ lat: 39.05, lon: -9.05 }), 0)
  assert.equal(costa.distanciaTerra({ lat: 36, lon: -12 }, 20), Infinity)
  // o lago é mar: a distância é à margem mais perto
  assert.ok(Math.abs(costa.distanciaTerra({ lat: 39.1, lon: -9.1 }) - 0.02 * k.kx) < 0.01)
  // 1' de longitude a 39° são 0,779 MN no WGS84 (a esfera dava 0,777)
  assert.ok(Math.abs(c.distanciaMn({ lat: 39, lon: -9 }, { lat: 39, lon: -9 + 1 / 60 }) - 0.7796) < 0.001)
})

test('troços: corta a terra, passa ao lado, encosta num vértice, acaba em terra', () => {
  assert.equal(costa.cruzaTerra({ lat: 39.1, lon: -9.3 }, { lat: 39.1, lon: -8.9 }), true)
  assert.equal(costa.cruzaTerra({ lat: 39.25, lon: -9.3 }, { lat: 39.25, lon: -8.9 }), false)
  assert.equal(costa.cruzaTerra({ lat: 39.3, lon: -9.3 }, { lat: 39.2, lon: -9.2 }), true) // toca no canto
  assert.equal(costa.cruzaTerra({ lat: 39.1, lon: -9.3 }, { lat: 39.1, lon: -9.15 }), true) // acaba em terra
  // de um lado ao outro do lago sem sair dele: não corta
  assert.equal(costa.cruzaTerra({ lat: 39.09, lon: -9.11 }, { lat: 39.11, lon: -9.09 }), false)
})

test('zonas e verificarTroco: diz porquê', () => {
  assert.equal(costa.zonaCruzada({ lat: 38.85, lon: -9.35 }, { lat: 39.0, lon: -9.35 }).nome, 'Baixio inventado')
  assert.equal(costa.zonaCruzada({ lat: 38.92, lon: -9.38 }, { lat: 38.93, lon: -9.37 }).nome, 'Baixio inventado') // dentro
  assert.equal(costa.zonaCruzada({ lat: 38.85, lon: -9.45 }, { lat: 39.0, lon: -9.45 }), null)
  assert.deepEqual(costa.verificarTroco({ lat: 38.85, lon: -9.35 }, { lat: 39.0, lon: -9.35 }), { motivo: 'zona', zona: 'Baixio inventado' })
  assert.deepEqual(costa.verificarTroco({ lat: 39.1, lon: -9.3 }, { lat: 39.1, lon: -8.9 }), { motivo: 'terra' })
  assert.equal(costa.verificarTroco({ lat: 39.1, lon: -9.3 }, { lat: 39.1, lon: -8.9 }, { terra: false }), null)
})

test('coordenadas não finitas: erro claro em vez de responder "livre" (ou rebentar mais à frente)', () => {
  const ok = { lat: 39.1, lon: -9.1 }
  const maus = [
    { lat: NaN, lon: -9.1 },
    { lat: 39.1, lon: NaN },
    { lat: Infinity, lon: -9.1 },
    { lat: 39.1, lon: -Infinity },
    { lat: undefined, lon: -9.1 }
  ]
  for (const p of maus) {
    assert.throws(() => costa.emTerra(p), /coordenadas inválidas/, `emTerra ${JSON.stringify(p)}`)
    assert.throws(() => costa.distanciaTerra(p), /coordenadas inválidas/, `distanciaTerra ${JSON.stringify(p)}`)
    assert.throws(() => costa.cruzaTerra(p, ok), /coordenadas inválidas/, `cruzaTerra(p, ok) ${JSON.stringify(p)}`)
    assert.throws(() => costa.cruzaTerra(ok, p), /coordenadas inválidas/, `cruzaTerra(ok, p) ${JSON.stringify(p)}`)
    assert.throws(() => costa.zonaCruzada(p, ok), /coordenadas inválidas/, `zonaCruzada ${JSON.stringify(p)}`)
    assert.throws(() => costa.verificarTroco(p, ok), /coordenadas inválidas/, `verificarTroco ${JSON.stringify(p)}`)
  }
})

test('zona estreita cortada longe dos vértices; troço exatamente numa fronteira de célula da grelha', () => {
  // polígono estreito (~0,001° ~= 0,06 MN de largura, 0,2° de comprimento): o corte é a meio
  // de um lado comprido, longe dos 4 vértices — testa a interseção segmento-a-segmento, não só os cantos
  const estreita = c.criarCosta({ zonas: [{ nome: 'Baixio estreito', tipo: 'baixio', poligono: [[38.5, -9.6], [38.5, -9.599], [38.7, -9.599], [38.7, -9.6], [38.5, -9.6]] }] })
  assert.equal(estreita.zonaCruzada({ lat: 38.6, lon: -9.65 }, { lat: 38.6, lon: -9.55 }).nome, 'Baixio estreito')
  // -9.15 e as latitudes usadas são múltiplos exatos de 0,05° (celula da grelha da terra): testa
  // que o floor/index na fronteira da célula não falha por arredondamento de vírgula flutuante
  assert.equal(costa.cruzaTerra({ lat: 38.9, lon: -9.15 }, { lat: 39.3, lon: -9.15 }), true)
})

test('aproximação: a terra só se dispensa depois da entrada com portoFechadoOsm; entrada fora do intervalo é reportada', () => {
  assert.deepEqual(costa.verificarAproximacao(PORTO), [])
  assert.deepEqual(costa.verificarAproximacao({ ...PORTO, entrada: 2 }), [{ troco: 2, motivo: 'terra' }])
  // sem portoFechadoOsm, o troço 2 (depois da entrada) volta a contar a terra por omissão
  assert.deepEqual(costa.verificarAproximacao({ ...PORTO, portoFechadoOsm: false }), [{ troco: 2, motivo: 'terra' }])
  assert.deepEqual(costa.verificarAproximacao({ ...PORTO, portoFechadoOsm: undefined }), [{ troco: 2, motivo: 'terra' }])
  // entrada fora de 1…ap.length-1 (aqui 1…2): reportada como problema, mesmo sem portoFechadoOsm
  for (const entrada of [0, -1, 3, 99, undefined, null, 1.5, 'x']) {
    const r = costa.verificarAproximacao({ ...PORTO, entrada })
    assert.equal(r[0].motivo, 'entrada inválida', `entrada ${JSON.stringify(entrada)}`)
  }
  // com entrada inválida cai-se para ap.length - 1 (como antes): a terra continua a verificar-se
  // em todos os troços (aqui, com portoFechadoOsm, o resultado tem os dois problemas)
  assert.deepEqual(costa.verificarAproximacao({ ...PORTO, entrada: undefined }), [{ motivo: 'entrada inválida' }, { troco: 2, motivo: 'terra' }])
})

test('linhas: posição, projeção, juntar à frente (≤ 60°) e seguir com pontos de ≤ 2 MN', () => {
  const L = costa.linha(5)
  assert.ok(Math.abs(L.total - (c.distanciaMn({ lat: 39.4, lon: -9.35 }, { lat: 38.8, lon: -9.35 }) + c.distanciaMn({ lat: 38.8, lon: -9.35 }, { lat: 38.8, lon: -9.0 }))) < 1e-3)
  const p = c.posicao(L, 10)
  assert.ok(Math.abs(p.lon + 9.35) < 1e-12)
  assert.equal(Math.round(p.rumo), 180)
  const q = c.projetar(L, { lat: 39.0, lon: -9.45 })
  assert.ok(Math.abs(q.lat - 39.0) < 1e-6)
  assert.ok(Math.abs(q.dist - 0.1 * c.escalas(39).kx) < 1e-3)
  // juntar a caminho do sul: fica à frente (mais a sul) e o troço faz ≤ 60° com a linha
  const j = c.juntar(L, { lat: 39.0, lon: -9.45 }, 1)
  assert.ok(j.lat < 39.0)
  const v = c.vetor({ lat: 39.0, lon: -9.45 }, j)
  assert.ok(Math.abs(c.dif(v.rumo, 180)) <= 60.001)
  assert.ok(j.dist < q.dist * 1.2)
  // com anguloMax 90 é o pé da perpendicular
  assert.ok(Math.abs(c.juntar(L, { lat: 39.0, lon: -9.45 }, 1, { anguloMax: 90.01, passo: 0.01 }).lat - 39.0) < 0.001)
  // a caminho do norte, fica a norte
  assert.ok(c.juntar(L, { lat: 39.0, lon: -9.45 }, -1).lat > 39.0)
  // seguir: do s = 5 ao fim, passando o canto, troços ≤ 2 MN e o canto incluído
  const pts = c.seguirLinha(L, 5, L.total)
  for (let i = 1; i < pts.length; i++) assert.ok(c.distanciaMn(pts[i - 1], pts[i]) <= 2 + 1e-6)
  assert.ok(pts.some(x => Math.abs(x.lat - 38.8) < 1e-9 && Math.abs(x.lon + 9.35) < 1e-9))
  assert.ok(Math.abs(pts[0].s - 5) < 1e-9 && Math.abs(pts.at(-1).s - L.total) < 1e-9)
  // ao contrário também
  const volta = c.seguirLinha(L, L.total, 5)
  assert.ok(Math.abs(volta.at(-1).s - 5) < 1e-9)
  assert.equal(volta.length, pts.length)
})

test('seguirLinha com s1 === s2: um único ponto, não dois iguais', () => {
  const L = costa.linha(5)
  const pts = c.seguirLinha(L, 5, 5)
  assert.equal(pts.length, 1)
  assert.ok(Math.abs(pts[0].s - 5) < 1e-9)
  const p = c.posicao(L, 5)
  assert.ok(Math.abs(pts[0].lat - p.lat) < 1e-12 && Math.abs(pts[0].lon - p.lon) < 1e-12)
})

// ---------- com os dados reais ----------
const real = c.carregarCosta()

test('dados reais: Lisboa é terra, 38,7 N 9,6 W é mar a ~5 MN da costa', () => {
  assert.equal(real.emTerra({ lat: 38.72, lon: -9.14 }), true)
  assert.equal(real.emTerra({ lat: 38.7, lon: -9.6 }), false)
  const d = real.distanciaTerra({ lat: 38.7, lon: -9.6 })
  assert.ok(d > 4 && d < 7, `distância ${d}`)
  assert.equal(real.emTerra({ lat: 39.415, lon: -9.508 }), true) // a Berlenga
})

test('dados reais: Algés → Barra Norte não toca terra até à entrada; a exceção continua precisa nos portos que o OSM fecha; os 15 portos passam', () => {
  // dados corrigidos: a aproximação de Algés entra pela boca do porto, por isso
  // nenhum troço até à `entrada` toca terra, mesmo sem a exceção
  const alges = real.destinos.find(d => d.id === 'alges')
  const apAlges = alges.aproximacao.map(c.P)
  for (let i = 1; i <= alges.entrada; i++) assert.equal(real.verificarTroco(apAlges[i - 1], apAlges[i]), null, `troço ${i}`)
  assert.deepEqual(real.verificarAproximacao(alges), [])
  // em Viana (`portoFechadoOsm`), o OSM fecha o rio: sem a exceção, o troço logo
  // a seguir à entrada toca na terra do OSM; com a exceção (verificarAproximacao) passa
  const viana = real.destinos.find(d => d.id === 'viana')
  assert.equal(viana.portoFechadoOsm, true)
  const apViana = viana.aproximacao.map(c.P)
  assert.deepEqual(real.verificarTroco(apViana[viana.entrada + 1], apViana[viana.entrada + 2]), { motivo: 'terra' })
  assert.deepEqual(real.verificarAproximacao(viana), [])
  for (const d of real.destinos) assert.deepEqual(real.verificarAproximacao(d), [], d.id)
})

test('dados reais: as linhas ficam a d ± 0,06 MN da terra e o Cachopo do Norte é uma zona', () => {
  for (const d of [3, 5, 8]) {
    const L = real.linha(d)
    let mn = Infinity; let mx = 0
    for (let s = 0; s < L.total; s += 0.25) { const x = real.distanciaTerra(c.posicao(L, s)); mn = Math.min(mn, x); mx = Math.max(mx, x) }
    assert.ok(mn > d - 0.06 && mx < d + 0.06, `${d} MN: ${mn}–${mx}`)
  }
  assert.match(real.zonaCruzada({ lat: 38.65, lon: -9.36 }, { lat: 38.665, lon: -9.345 }).nome, /Cachopo do Norte/)
})

test('dados reais: a grelha poupa trabalho (distância à terra e troços medem só uma parte das milhares de arestas)', () => {
  // Sem relógio de parede (auditoria M-17: era "< 20 ms por consulta", que num Pi ocupado falha por
  // ruído): conta-se o trabalho. Cada consulta marca as arestas que mediu (grelha.marca === volta);
  // um algoritmo linear mediria todas.
  const g = real.grelha
  const medidas = () => { let n = 0; for (let e = 0; e < g.m; e++) if (g.marca[e] === g.volta) n++; return n }
  assert.ok(g.m > 5000, `${g.m} arestas`)
  let maxDist = 0; let somaDist = 0
  for (let i = 0; i < 2000; i++) {
    const d = real.distanciaTerra({ lat: 37 + (i % 50) / 10, lon: -9.9 + (i % 7) / 10 })
    assert.ok(Number.isFinite(d) || d === Infinity)
    const n = medidas(); maxDist = Math.max(maxDist, n); somaDist += n
  }
  let maxTroco = 0
  for (let i = 0; i < 2000; i++) {
    real.cruzaTerra({ lat: 38 + (i % 30) / 10, lon: -9.9 }, { lat: 38.1 + (i % 30) / 10, lon: -9.5 })
    maxTroco = Math.max(maxTroco, medidas())
  }
  // hoje: distância no máximo 1488 (20 %) e em média 319 (4 %) de 7382; troço no máximo 246 (3 %)
  assert.ok(maxDist < g.m / 4 && somaDist / 2000 < g.m / 10, `distância: máx ${maxDist}, média ${somaDist / 2000} de ${g.m}`)
  assert.ok(maxTroco < g.m / 10, `troço: máx ${maxTroco} de ${g.m}`)
  // o "em terra" percorre só a faixa de latitude do ponto
  assert.ok(Math.max(...g.faixas.map(f => f.length)) < g.m / 5)
})

test('M-19: o artigo e as preposições com os nomes dos sítios ("à Nazaré", "na Figueira da Foz", "ao Cabo Raso", "em Peniche")', () => {
  const casos = [
    // [nome, artigo, a, em, de, para, até, junto, com]
    ['Nazaré', 'a', 'à Nazaré', 'na Nazaré', 'da Nazaré', 'para a Nazaré', 'até à Nazaré', 'junto à Nazaré', 'a Nazaré'],
    ['Figueira da Foz', 'a', 'à Figueira da Foz', 'na Figueira da Foz', 'da Figueira da Foz', 'para a Figueira da Foz', 'até à Figueira da Foz', 'junto à Figueira da Foz', 'a Figueira da Foz'],
    ['Ponta de Sagres', 'a', 'à Ponta de Sagres', 'na Ponta de Sagres', 'da Ponta de Sagres', 'para a Ponta de Sagres', 'até à Ponta de Sagres', 'junto à Ponta de Sagres', 'a Ponta de Sagres'],
    ['Berlengas', 'as', 'às Berlengas', 'nas Berlengas', 'das Berlengas', 'para as Berlengas', 'até às Berlengas', 'junto às Berlengas', 'as Berlengas'],
    ['Farilhões', 'os', 'aos Farilhões', 'nos Farilhões', 'dos Farilhões', 'para os Farilhões', 'até aos Farilhões', 'junto aos Farilhões', 'os Farilhões'],
    ['Cabo Raso', 'o', 'ao Cabo Raso', 'no Cabo Raso', 'do Cabo Raso', 'para o Cabo Raso', 'até ao Cabo Raso', 'junto ao Cabo Raso', 'o Cabo Raso'],
    ['Porto', 'o', 'ao Porto', 'no Porto', 'do Porto', 'para o Porto', 'até ao Porto', 'junto ao Porto', 'o Porto'],
    ['Peniche', '', 'a Peniche', 'em Peniche', 'de Peniche', 'para Peniche', 'até Peniche', 'junto a Peniche', 'Peniche'],
    ['Algés (CNA)', '', 'a Algés (CNA)', 'em Algés (CNA)', 'de Algés (CNA)', 'para Algés (CNA)', 'até Algés (CNA)', 'junto a Algés (CNA)', 'Algés (CNA)'],
    // as terras sem artigo que começam como as com artigo
    ['Portimão', '', 'a Portimão', 'em Portimão', 'de Portimão', 'para Portimão', 'até Portimão', 'junto a Portimão', 'Portimão'],
    ['Porto Covo', '', 'a Porto Covo', 'em Porto Covo', 'de Porto Covo', 'para Porto Covo', 'até Porto Covo', 'junto a Porto Covo', 'Porto Covo'],
    // as palavras comuns (o barco no mar, o destino sem nome) vão com minúscula a meio da frase
    ['Posição atual', 'a', 'à posição atual', 'na posição atual', 'da posição atual', 'para a posição atual', 'até à posição atual', 'junto à posição atual', 'a posição atual'],
    ['destino', 'o', 'ao destino', 'no destino', 'do destino', 'para o destino', 'até ao destino', 'junto ao destino', 'o destino']
  ]
  for (const [nome, art, ...frases] of casos) {
    assert.equal(c.artigo(nome), art, nome)
    assert.deepEqual(['a', 'em', 'de', 'para', 'ate', 'junto', 'com'].map(p => c.sitio[p](nome)), frases, nome)
    assert.equal(c.preposicao('em', nome), frases[1])
  }
  assert.throws(() => c.preposicao('sobre', 'Nazaré'), /preposição desconhecida/)
  // nos 15 destinos só a Nazaré e a Figueira da Foz levam artigo
  const real = c.carregarCosta()
  assert.deepEqual(real.destinos.filter(d => c.artigo(d.nome)).map(d => d.id).sort(), ['figueira', 'nazare'])
})
