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

test('cada alternativa traz o rasto provável de 10 em 10 min: { lat, lon, t, motor, noite }, da partida à chegada', async () => {
  const r = await correr('ap', entrada('alges', 'peniche'))
  for (const a of r.alternativas) {
    const ra = a.rasto
    assert.ok(ra.length > 20)
    for (const p of ra) {
      assert.deepEqual(Object.keys(p), ['lat', 'lon', 't', 'motor', 'noite'])
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
