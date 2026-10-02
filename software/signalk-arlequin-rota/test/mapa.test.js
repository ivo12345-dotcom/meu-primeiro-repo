'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const prev = require('../lib/previsao')
const base = require('../lib/base')
const mapa = require('../lib/mapa')
const { calcular } = require('../lib/calculo')

const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const P29 = prev.interpretar(FIX.pontos.map(c.P), FIX.forecast, FIX.marine, FIX.obtidaSimulada)
const costa = c.carregarCosta()
const polar = base.carregarPolar()
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const de = (id) => c.P(costa.destinos.find(d => d.id === id).aproximacao.at(-1))
const deps = () => ({ costa, polar, modelos: {}, versoes: {}, obterPrevisao: async () => ({ previsao: P29, obtida: P29.obtida, idadeH: 0.5, aviso: null }) })
const entrada = (de0, destino) => ({ instrumentos: { posicao: de(de0), socPct: 90, gasoleoL: 124 }, destino, tripulacao: 'so', sairAgora: false, agora: AGORA })
const cache = {}
const correr = (k, e) => (cache[k] ??= calcular(e, deps()))
const dentro = (j, [lat, lon]) => lat >= j.latMin && lat <= j.latMax && lon >= j.lonMin && lon <= j.lonMax
const emTerraSimplificada = (m, p) => m.terra.reduce((n, anel) => n + (c.dentroAnel(p, anel) ? 1 : 0), 0) % 2 === 1
const MIN10 = 600000

test('janela: abrange todos os pontos com 10% de margem; um só ponto ganha um tamanho mínimo', () => {
  const j = mapa.janela([[38, -9.5], [39, -9]])
  assert.deepEqual(j, { latMin: 37.9, latMax: 39.1, lonMin: -9.55, lonMax: -8.95 })
  const u = mapa.janela([[38.5, -9.2]])
  assert.ok(u.latMax - u.latMin >= 0.02 - 1e-9 && u.lonMax - u.lonMin >= 0.02 - 1e-9)
  assert.ok(dentro(u, [38.5, -9.2]))
})

test('recortarAnel: corta um anel [lon, lat] pela janela e devolve [lat, lon]', () => {
  const j = { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 }
  // quadrado de 0,5 a 2: sobra o quadrado 0,5–1
  const r = mapa.recortarAnel([[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2], [0.5, 0.5]], j)
  assert.equal(r.length, 4)
  for (const p of r) assert.ok(dentro(j, p), JSON.stringify(p))
  const area = (a) => Math.abs(a.reduce((s, p, i) => { const q = a[(i + 1) % a.length]; return s + p[1] * q[0] - q[1] * p[0] }, 0)) / 2
  assert.ok(Math.abs(area(r) - 0.25) < 1e-9)
  // todo fora: vazio
  assert.deepEqual(mapa.recortarAnel([[3, 3], [4, 3], [4, 4], [3, 3]], j), [])
})

test('simplificarAnel: Douglas–Peucker num anel fechado, nenhum ponto tirado a mais da tolerância', () => {
  // um quadrado de ~6 MN com 400 pontos e um serrilhado de ±0,02 MN: fica com poucos pontos
  const anel = []
  const lado = 0.1
  for (let i = 0; i < 400; i++) {
    const s = (i % 100) / 100 * lado
    const z = (i % 2 ? 0.02 : -0.02) / 60
    const k = Math.floor(i / 100)
    anel.push(k === 0 ? [38 + z, -9 + s] : k === 1 ? [38 + s, -9 + lado + z] : k === 2 ? [38 + lado + z, -9 + lado - s] : [38 + lado - s, -9 + z])
  }
  const esc = c.escalas(38.05)
  const idx = mapa.simplificarAnel(anel, 0.1, esc)
  assert.ok(idx.length <= 8, `${idx.length}`)
  for (let i = 0; i < idx.length; i++) assert.ok(idx[i] < (idx[i + 1] ?? Infinity))
})

test('montarMapa protege os pontos dados: a simplificação não fecha por cima da rota uma enseada estreita', () => {
  // terra: um retângulo de ~47 × 30 MN com uma enseada estreita (0,1 MN de largo, ~5 MN de fundo) aberta a norte
  const terra = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-9.6, 38], [-9.101, 38], [-9.101, 37.92], [-9.099, 37.92], [-9.099, 38], [-8.6, 38], [-8.6, 37.5], [-9.6, 37.5], [-9.6, 38]]] } }] }
  const costaTeste = c.criarCosta({ terra })
  const rota = [[38.05, -9.1], [37.95, -9.1], [38.05, -9.05]]
  const longe = [37.6, -9.5] // em terra: só alarga a janela
  assert.ok(!costaTeste.emTerra(c.P(rota[1])), 'o ponto da enseada é mar')
  // sem o ponto da enseada a proteger, 6 MN de tolerância fecham a enseada: o ponto passa a terra
  const semProtecao = mapa.montarMapa(costaTeste, { pontos: [rota[0], rota[2], longe] }, { toleranciaMn: 6 })
  assert.ok(emTerraSimplificada(semProtecao, c.P(rota[1])))
  // com a rota protegida, fica no mar
  const m = mapa.montarMapa(costaTeste, { pontos: [...rota, longe] }, { toleranciaMn: 6 })
  for (const p of rota) assert.ok(!emTerraSimplificada(m, c.P(p)), JSON.stringify(p))
  assert.ok(emTerraSimplificada(m, c.P(longe)))
  // um ponto em terra na costa original não se protege: não muda nada
  const m2 = mapa.montarMapa(costaTeste, { pontos: [...rota, longe, [37.95, -9.15]] }, { toleranciaMn: 6 })
  assert.deepEqual(m2.terra, m.terra)
})

test('montarMapa: no máximo 2000 pontos de terra; se passar, aumenta a tolerância', () => {
  const pts = [[38.6, -9.5], [39.4, -9.2]]
  const m = mapa.montarMapa(costa, { pontos: pts }, { maxPontos: 150 })
  const n = m.terra.reduce((s, a) => s + a.length, 0)
  assert.ok(n <= 150, `${n}`)
  assert.ok(m.terra.length >= 1)
  for (const a of m.terra) { assert.ok(a.length >= 3); for (const p of a) assert.ok(dentro(m.janela, p)) }
})

test('montarMapa: a tolerância sobe no máximo até 0,5 MN e os ilhéus só saem com a tolerância inicial (a Berlenga e os cabos ficam); se não couber, regista', () => {
  const pts = [[38.6, -9.6], [39.5, -9.2]]
  const registos = []
  const m = mapa.montarMapa(costa, { pontos: pts }, { maxPontos: 10, log: (msg) => registos.push(msg) })
  assert.equal(mapa.PADRAO.toleranciaMaxMn, 0.5)
  // com 10 pontos não cabe: fica a tolerância máxima, e diz quantos pontos ficaram
  assert.equal(registos.length, 1)
  assert.match(registos[0], /^mini-mapa: \d+ pontos de terra com a tolerância máxima \(0,5 MN\)$/)
  // a Berlenga (≈ 1 MN) continua desenhada: um anel com pelo menos metade do tamanho
  const esc = c.escalas(39.4)
  const berlenga = m.terra.filter(a => a.every(([lat, lon]) => lat > 39.40 && lat < 39.43 && lon > -9.52 && lon < -9.50))
  assert.ok(berlenga.some(a => {
    const lats = a.map(p => p[0]); const lons = a.map(p => p[1])
    return Math.hypot((Math.max(...lons) - Math.min(...lons)) * esc.kx, (Math.max(...lats) - Math.min(...lats)) * esc.ky) >= 0.5
  }), JSON.stringify(berlenga))
  // e os cabos (a ~1 MN da ponta) continuam terra
  for (const p of [[39.3600, -9.4020], [38.7806, -9.4800]]) {
    assert.ok(costa.emTerra(c.P(p)), `${p} é terra na costa`)
    assert.ok(emTerraSimplificada(m, c.P(p)), `${p} desapareceu do mini-mapa`)
  }
})

test('montarMapa: recusa uma tolerância inicial <= 0 (a subida nunca saía do sítio e prendia o servidor) e a subida tem um limite de voltas', () => {
  const pts = [[38.6, -9.6], [39.5, -9.2]]
  for (const t of [0, -0.1, NaN]) {
    assert.throws(() => mapa.montarMapa(costa, { pontos: pts }, { toleranciaMn: t }), { message: 'mini-mapa: a tolerância tem de ser um número maior do que 0 MN' })
  }
  // uma tolerância minúscula (mas > 0) levaria centenas de voltas a chegar ao máximo: pára ao fim de 40 e regista
  const terra = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-9.2, 38], [-9, 38], [-9, 38.2], [-9.2, 38.2], [-9.2, 38]]] } }] }
  const registos = []
  const m = mapa.montarMapa(c.criarCosta({ terra }), { pontos: [[38.25, -9.25], [37.95, -8.95]] }, { toleranciaMn: 1e-12, maxPontos: 1, log: (msg) => registos.push(msg) })
  assert.ok(m.terra.length)
  assert.equal(mapa.PADRAO.maxVoltas, 40)
  assert.deepEqual(registos.map(r => r.replace(/[\d,]+ pontos/, 'N pontos').replace(/\(.*\)/, '(…)')), ['mini-mapa: N pontos de terra ao fim de 40 voltas (…)'])
})

test('montarMapa: um anel pequeno que é um buraco (mar dentro de terra) com um ponto protegido lá dentro não sai', () => {
  // terra: um quadrado de ~12 MN com um buraco de ~0,03 MN (abaixo da tolerância) onde está um ponto da rota
  const terra = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-9.2, 38], [-9, 38], [-9, 38.2], [-9.2, 38.2], [-9.2, 38]], [[-9.1003, 38.0997], [-9.0997, 38.0997], [-9.0997, 38.1003], [-9.1003, 38.1003], [-9.1003, 38.0997]]] } }] }
  const costaTeste = c.criarCosta({ terra })
  const buraco = [38.1, -9.1]
  assert.ok(!costaTeste.emTerra(c.P(buraco)), 'o ponto no buraco é mar')
  const m = mapa.montarMapa(costaTeste, { pontos: [buraco, [38.25, -9.25], [37.95, -8.95]] })
  assert.ok(!emTerraSimplificada(m, c.P(buraco)), 'o buraco fechou-se por cima do ponto protegido')
  assert.ok(emTerraSimplificada(m, c.P([38.05, -9.05])))
  // sem ponto lá dentro, o buraco pequeno sai (só acrescenta terra onde não há rota)
  const m2 = mapa.montarMapa(costaTeste, { pontos: [[38.25, -9.25], [37.95, -8.95]] })
  assert.equal(m2.terra.length, 1)
})

test('simplificarProtegendo: quando não consegue repor um ponto protegido, regista pelo log (não fica calado)', () => {
  // um ponto bem dentro de um quadrado: nenhuma aresta simplificada o cobre (não devia ser protegido)
  const anel = [[38, -9], [38, -8.99], [38, -8.98], [38.02, -8.98], [38.02, -9]]
  const registos = []
  const idx = mapa.simplificarProtegendo([anel], 0.1, c.escalas(38.01), [{ lat: 38.01, lon: -8.99 }], (msg) => registos.push(msg))
  assert.equal(idx.length, 1)
  assert.equal(registos.length, 1)
  assert.match(registos[0], /^mini-mapa: 1 ponto\(s\) da rota ficam em terra no contorno simplificado$/)
})

test('o cálculo passa o registo (deps.log) ao mini-mapa', async () => {
  const original = mapa.montarMapa
  const registos = []
  mapa.montarMapa = (k, x, o = {}) => { o.log?.('mini-mapa: teste'); return original(k, x, o) }
  try {
    const r = await calcular(entrada('cascais', 'alges'), { ...deps(), log: (msg) => registos.push(msg) })
    assert.equal(r.erro, undefined, r.erro)
    assert.ok(r.mapa)
  } finally { mapa.montarMapa = original }
  assert.deepEqual(registos, ['mini-mapa: teste'])
})

test('Algés → Peniche (29/09): o resultado traz o mapa — janela com tudo, ≤ 2000 pontos, a rota de 5 MN no mar, zonas da barra', async () => {
  const r = await correr('ap', entrada('alges', 'peniche'))
  assert.equal(r.erro, undefined, r.erro)
  const m = r.mapa
  assert.deepEqual(Object.keys(m), ['janela', 'terra', 'zonas'])
  for (const a of r.alternativas) for (const p of a.rota) assert.ok(dentro(m.janela, p), JSON.stringify(p))
  for (const d of r.desistencia) assert.ok(dentro(m.janela, [d.lat, d.lon]))
  const n = m.terra.reduce((s, a) => s + a.length, 0)
  assert.ok(n > 100 && n <= 2000, `${n} pontos`)
  for (const anel of m.terra) for (const p of anel) assert.ok(p.every(Number.isFinite))
  const a5 = r.alternativas.filter(a => a.afastamento === 5)
  assert.ok(a5.length)
  let vistos = 0
  for (const a of a5) {
    for (const p of a.rota) {
      if (costa.emTerra(c.P(p))) continue // dentro de um porto que o OSM fecha: já é terra na costa original
      vistos++
      assert.ok(!emTerraSimplificada(m, c.P(p)), `ponto da rota em terra no contorno simplificado: ${p}`)
    }
  }
  assert.ok(vistos > 20)
  const zonas = m.zonas.map(z => z.nome)
  assert.ok(zonas.some(z => /Cachopo do Norte/.test(z)), zonas.join())
  assert.ok(zonas.some(z => /Berlengas/.test(z)), zonas.join())
  assert.ok(!zonas.some(z => /São Vicente/.test(z)), zonas.join())
  for (const z of m.zonas) { assert.equal(typeof z.nome, 'string'); assert.ok(z.pontos.length >= 3) }
})

test('cada alternativa traz o rasto provável de 10 em 10 min: { lat, lon, t, motor, noite } e o tempo previsto (twd, vis: Tarefa 8.5; tws: revisão final I4), da partida à chegada', async () => {
  const r = await correr('ap', entrada('alges', 'peniche'))
  for (const a of r.alternativas) {
    const ra = a.rasto
    assert.ok(ra.length > 20)
    for (const p of ra) {
      assert.deepEqual(Object.keys(p).slice(0, 5), ['lat', 'lon', 't', 'motor', 'noite'])
      assert.ok(Object.keys(p).slice(5).every(k => k === 'twd' || k === 'tws' || k === 'vis'), JSON.stringify(p))
      assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon))
      assert.equal(typeof p.motor, 'boolean')
      assert.equal(typeof p.noite, 'boolean')
    }
    assert.equal(ra[0].t, a.partida)
    for (let i = 1; i < ra.length - 1; i++) assert.equal(Date.parse(ra[i].t) - Date.parse(ra[i - 1].t), MIN10, `${a.id} ${i}`)
    const ultimo = Date.parse(ra.at(-1).t) - Date.parse(ra.at(-2).t)
    assert.ok(ultimo > 0 && ultimo <= MIN10)
    assert.equal(ra.at(-1).t, a.chegada.p50)
    // a 5 MN e só a motor: o rasto vai todo a motor
    if (a.propulsao === 'motor') assert.ok(ra.every(p => p.motor))
  }
})

test('Peniche → Nazaré: as zonas das Berlengas e das Estelas e Farilhões, e o rasto pelo canal no mar', async () => {
  const r = await correr('pn', entrada('peniche', 'nazare'))
  assert.equal(r.erro, undefined, r.erro)
  const zonas = r.mapa.zonas.map(z => z.nome)
  assert.ok(zonas.some(z => /Berlengas/.test(z)))
  assert.ok(zonas.some(z => /Estelas/.test(z)))
  const k = r.alternativas.find(a => a.canal)
  assert.ok(k)
  for (const p of k.rota) if (!costa.emTerra(c.P(p))) assert.ok(!emTerraSimplificada(r.mapa, c.P(p)), JSON.stringify(p))
})
