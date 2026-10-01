'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const base = require('../lib/base')
const sol = require('../lib/sol')
const { criarCenarios, notaIa, RAZAO_SEM_MODELO } = require('../lib/cenarios')

const SW = path.join(__dirname, '..', '..')
const NO = 1852 / 3600
const fixa = (v) => ({ feature_names: [], tree_info: [{ tree_structure: { leaf_value: v } }] })

test('polar: o CSV do ecrã pelo caminho de origem, igual à polar.js do ecrã em todo o lado', async () => {
  assert.equal(base.POLAR_PADRAO, path.join(SW, 'arlequin-ecra', 'public', 'polar-arlequin.csv'))
  const p = base.carregarPolar()
  const ecra = await import('file://' + path.join(SW, 'arlequin-ecra', 'public', 'lib', 'polar.js').replace(/\\/g, '/'))
  const pe = ecra.lerPolar(fs.readFileSync(base.POLAR_PADRAO, 'utf8'))
  assert.deepEqual(p, pe)
  for (let twa = -200; twa <= 380; twa += 7.3) {
    for (let tws = 0; tws <= 30; tws += 1.7) {
      const nos = ecra.velocidadeAlvo(pe, twa * Math.PI / 180, tws * NO) / NO
      assert.ok(Math.abs(base.velocidadePolar(p, twa, tws) - nos) < 1e-9, `${twa}° ${tws} nós`)
    }
  }
  assert.equal(base.velocidadePolar(p, 30, 12), 0) // ângulo morto
  assert.equal(base.velocidadePolar(p, 90, 25), base.velocidadePolar(p, 90, 20)) // acima da tabela fica nos 20
  assert.throws(() => base.lerPolar('TWA;TWS6\n42;x'), /polar ilegível/)
})

test('curva da Volvo: a mesma tabela e a mesma interpolação do plugin J1939', () => {
  const j = require(path.join(SW, 'signalk-arlequin-j1939', 'lib', 'consumo.js'))
  assert.deepEqual(base.CURVA, j.CURVA)
  for (let rpm = 0; rpm <= 3500; rpm += 37) assert.equal(base.litrosHora(rpm), j.litrosHora(rpm))
  assert.ok(Math.abs(base.litrosHora(2100) - 1.45) < 1e-12)
})

test('nascer e pôr do sol (NOAA) a menos de 2 min dos da Open-Meteo na fixture de 29/09', () => {
  const f = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
  const { latitude, longitude, daily } = f.sol
  daily.time.forEach((dia, i) => {
    const r = sol.nascerPor(Date.parse(dia + 'T12:00Z'), latitude, longitude)
    const nascer = Date.parse(daily.sunrise[i] + 'Z'); const por = Date.parse(daily.sunset[i] + 'Z')
    // a Open-Meteo dá o minuto truncado: compara com o meio desse minuto
    assert.ok(Math.abs(r.nascer - (nascer + 30000)) <= 120000, `${dia} nascer ${new Date(r.nascer).toISOString()}`)
    assert.ok(Math.abs(r.por - (por + 30000)) <= 120000, `${dia} pôr ${new Date(r.por).toISOString()}`)
  })
  // Lisboa no solstício de verão: nasce ~06:12 locais (05:12 UTC), põe-se ~21:05 (20:05 UTC)
  const v = sol.nascerPor(Date.UTC(2026, 5, 21), 38.72, -9.14)
  assert.ok(Math.abs(v.nascer - Date.UTC(2026, 5, 21, 5, 12)) < 3 * 60000)
  assert.ok(Math.abs(v.por - Date.UTC(2026, 5, 21, 20, 5)) < 3 * 60000)
  // sol da meia-noite / noite polar: sem nascer nem pôr
  assert.deepEqual(sol.nascerPor(Date.UTC(2026, 5, 21), 80, 0), { nascer: null, por: null })
  const l = sol.nasceresPores(38.9, -9.4, Date.UTC(2026, 8, 29, 14), Date.UTC(2026, 9, 1, 12))
  assert.equal(l.nasceres.length, 5) // 28/09 a 02/10
  assert.ok(l.nasceres.every((n, i) => n < l.pores[i]))
})

// Um "tempo" com o vento fixo, para os cenários.
const tempoFixo = (w = {}) => () => ({ tws: 10, rajada: 14, twd: 0, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 1, periodo: 8, ondasDir: 0, corrente: 0, correnteDir: 0, ...w })

test('cenários sem modelos: vento ±10%, a polar no vento do quantil contrário, a curva da Volvo', () => {
  const polar = base.carregarPolar()
  const k = criarCenarios({ tempoBruto: tempoFixo(), modelos: {}, polar, obtida: 0 })
  const w = { pe: k.pessimista.tempo(39, -9.5, 0), pr: k.provavel.tempo(39, -9.5, 0), ot: k.otimista.tempo(39, -9.5, 0) }
  assert.deepEqual(RAZAO_SEM_MODELO, { p10: 0.9, p50: 1, p90: 1.1 })
  assert.ok(Math.abs(w.pe.tws - 11) < 1e-12 && Math.abs(w.pe.rajada - 15.4) < 1e-12)
  assert.equal(w.pr.tws, 10)
  assert.ok(Math.abs(w.ot.tws - 9) < 1e-12)
  for (const x of Object.values(w)) { assert.equal(x.prevTws, 10); assert.equal(x.prevRajada, 14); assert.equal(x.twd, 0) }
  // velocidade: pessimista lê a polar em 9 nós, otimista em 11
  const ctx = (c) => ({ twa: 90, twaPrevAbs: 90, rizos: 0, w: c, rumo: 90 })
  assert.ok(Math.abs(k.pessimista.velocidadeVela(ctx(w.pe)) - base.velocidadePolar(polar, 90, 9)) < 1e-12)
  assert.ok(Math.abs(k.provavel.velocidadeVela(ctx(w.pr)) - base.velocidadePolar(polar, 90, 10)) < 1e-12)
  assert.ok(Math.abs(k.otimista.velocidadeVela(ctx(w.ot)) - base.velocidadePolar(polar, 90, 11)) < 1e-12)
  assert.ok(k.pessimista.velocidadeVela(ctx(w.pe)) < k.otimista.velocidadeVela(ctx(w.ot)))
  for (const n of ['pessimista', 'provavel', 'otimista']) assert.equal(k[n].consumo({ rpm: 2100, w: w.pr, rumo: 0 }), base.litrosHora(2100))
  assert.equal(notaIa({}), 'AI: a aprender (polar, previsão ±10% e curva da Volvo)')
})

test('cenários com modelos: a razão do vento e a direção do modelo, os quantis de velocidade e de gasóleo, o x certo', () => {
  const polar = base.carregarPolar()
  const vistos = []
  // peso 1 na célula (10 nós, 105°): a do vento previsto EM BRUTO (twaPrevAbs 110°), não a do corrigido (twa 90°)
  const velocidade = { quantis: { p10: fixa(1), p50: fixa(5), p90: fixa(50) }, celulas: { '10|105': 10 } }
  const modelos = {
    velocidade,
    ventoForca: { quantis: { p10: fixa(0.8), p50: fixa(1.2), p90: fixa(1.4) } },
    ventoDirecao: { quantis: { p50: fixa(20) } },
    consumo: { quantis: { p10: fixa(1), p50: fixa(2), p90: fixa(2.5) } }
  }
  const k = criarCenarios({ tempoBruto: tempoFixo(), modelos, polar, obtida: Date.UTC(2026, 8, 29, 12), tendPressao3h: -1 })
  const t = Date.UTC(2026, 8, 29, 15, 30)
  const pe = k.pessimista.tempo(39.05, -9.51, t)
  const pr = k.provavel.tempo(39.05, -9.51, t)
  const ot = k.otimista.tempo(39.05, -9.51, t)
  assert.ok(Math.abs(pe.tws - 14) < 1e-9 && Math.abs(pr.tws - 12) < 1e-9 && Math.abs(ot.tws - 8) < 1e-9)
  assert.equal(pr.twd, 20)
  assert.ok(Math.abs(pe.twsPolar - 8) < 1e-9) // pessimista: a polar no vento P10
  // o modelo da velocidade recebe a previsão em bruto e as velas; limites de 40–120% da polar
  const orig = require('signalk-arlequin-ia/lib/modelos').preverVelocidade
  const mod = require('signalk-arlequin-ia/lib/modelos')
  mod.preverVelocidade = (m, x, s) => { vistos.push(x); return orig(m, x, s) }
  try {
    // rumo 110°: ao vento corrigido (20°) twa = −90° (a polar); ao previsto em bruto (0°) twaPrevAbs = 110° (o modelo)
    const vPe = k.pessimista.velocidadeVela({ twa: -90, twaPrevAbs: 110, rizos: 1, w: pe, rumo: 110 })
    const vOt = k.otimista.velocidadeVela({ twa: -90, twaPrevAbs: 110, rizos: 0, w: ot, rumo: 110 })
    assert.ok(Math.abs(vPe - 0.4 * base.velocidadePolar(polar, 90, 8)) < 1e-9) // P10 = 1 nó → limitado a 40%
    assert.ok(Math.abs(vOt - 1.2 * base.velocidadePolar(polar, 90, 14)) < 1e-9) // P90 = 50 → 120% da polar no vento P90
  } finally { mod.preverVelocidade = orig }
  assert.deepEqual(vistos[0], { prevTws: 10, twaPrevAbs: 110, prevRajada: 14, prevOndas: 1, prevPeriodo: 8, ondasAnguloRel: 110, grandeRizos: 1, genoaPct: 70 })
  // gasóleo: P90 no pessimista, P10 no otimista (dentro de 50–200% da Volvo)
  assert.equal(k.pessimista.consumo({ rpm: 2100, w: pe, rumo: 0 }), 2.5)
  assert.equal(k.otimista.consumo({ rpm: 2100, w: ot, rumo: 0 }), 1)
  assert.equal(notaIa(modelos), 'AI em uso')
  assert.match(notaIa({ velocidade }), /^AI em uso, sem alguns modelos: vento previsto ±10%/)
})

test('cenários que corrigem a direção: w.corrigido = true e w.prevTwd em bruto; o motor da passagem dá ao modelo o twaPrevAbs do previsto em bruto', () => {
  const { simularPassagem } = require('../lib/passagem')
  const polar = base.carregarPolar()
  // sem modelo da direção: a direção é a prevista tal e qual, não se declara corrigida
  const semDir = criarCenarios({ tempoBruto: tempoFixo({ twd: 270 }), modelos: {}, polar, obtida: 0 })
  const w0 = semDir.pessimista.tempo(39, -9.5, 0)
  assert.equal(w0.corrigido, undefined)
  assert.equal(w0.prevTwd, 270)
  // com o modelo da direção (+20°): twd corrigida 290, prevTwd 270 (em bruto), corrigido
  const modelos = { ventoDirecao: { quantis: { p50: fixa(20) } } }
  const k = criarCenarios({ tempoBruto: tempoFixo({ twd: 270 }), modelos, polar, obtida: 0 })
  for (const nome of ['pessimista', 'provavel', 'otimista']) {
    const w = k[nome].tempo(39, -9.5, 0)
    assert.equal(w.twd, 290)
    assert.equal(w.prevTwd, 270)
    assert.equal(w.corrigido, true)
  }
  // sem direção prevista (null) não há correção a declarar (o prevTwdDe não pode rebentar)
  const semTwd = criarCenarios({ tempoBruto: tempoFixo({ twd: null }), modelos, polar, obtida: 0 })
  assert.notEqual(semTwd.provavel.tempo(39, -9.5, 0).corrigido, true)
  // pelo motor da passagem: rumo 000°, vento corrigido de 290° (twa −70°, a polar), previsto de 270° (twaPrevAbs 90°)
  const mod = require('signalk-arlequin-ia/lib/modelos')
  const orig = mod.preverVelocidade
  const vistos = []
  mod.preverVelocidade = (m, x, s) => { vistos.push({ x, s }); return orig(m, x, s) }
  try {
    const c = k.provavel
    simularPassagem({
      rota: [{ nome: 'A', lat: 39, lon: -9.5 }, { nome: 'B', lat: 39 + 5 / 60, lon: -9.5 }],
      partida: Date.UTC(2026, 8, 29, 12),
      tempo: c.tempo,
      velocidadeVela: c.velocidadeVela,
      consumo: c.consumo,
      noite: () => false,
      opcoes: { motorNasAproximacoes: false }
    })
  } finally { mod.preverVelocidade = orig }
  assert.ok(vistos.length > 0)
  assert.ok(Math.abs(vistos[0].x.twaPrevAbs - 90) < 1e-6, `twaPrevAbs ${vistos[0].x.twaPrevAbs}`)
  assert.ok(Math.abs(vistos[0].s - base.velocidadePolar(polar, 70, 10)) < 1e-6) // a polar no vento corrigido
})

test('cenários: vento ou rajada sem previsão (null) fica null — desconhecido nunca é calmo (0) nem a rajada cai no vento médio', () => {
  const polar = base.carregarPolar()
  const modelos = { ventoForca: { quantis: { p10: fixa(0.8), p50: fixa(1.2), p90: fixa(1.4) } } }
  for (const m of [{}, modelos]) {
    const semVento = criarCenarios({ tempoBruto: tempoFixo({ tws: null, rajada: null, semDados: ['tws', 'rajada'] }), modelos: m, polar, obtida: 0 })
    const semRajada = criarCenarios({ tempoBruto: tempoFixo({ rajada: null, semDados: ['rajada'] }), modelos: m, polar, obtida: 0 })
    for (const n of ['pessimista', 'provavel', 'otimista']) {
      const w = semVento[n].tempo(39, -9.5, 0)
      assert.equal(w.tws, null, n)
      assert.equal(w.rajada, null, n)
      assert.equal(w.twsPolar, null, n)
      assert.equal(w.prevTws, null, n)
      const r = semRajada[n].tempo(39, -9.5, 0)
      assert.ok(Number.isFinite(r.tws) && r.tws > 0, n)
      assert.equal(r.rajada, null, n) // nem 0, nem o vento médio
    }
  }
})

test('I2: o vento que decide no pessimista nunca fica abaixo da previsão em bruto (modelo que aprendeu "a previsão exagera", razão P90 < 1)', () => {
  const polar = base.carregarPolar()
  const modelos = { ventoForca: { quantis: { p10: fixa(0.6), p50: fixa(0.7), p90: fixa(0.8) } } }
  const k = criarCenarios({ tempoBruto: tempoFixo({ tws: 26, rajada: 32 }), modelos, polar, obtida: 0 })
  const pe = k.pessimista.tempo(39, -9.5, 0)
  const pr = k.provavel.tempo(39, -9.5, 0)
  const ot = k.otimista.tempo(39, -9.5, 0)
  // pessimista: a razão P90 0,8 sobe para 1 → 26 nós e rajadas de 32 (os previstos), nunca 20,8 / 25,6
  assert.equal(pe.tws, 26)
  assert.equal(pe.rajada, 32)
  // o P50 e o P10 ficam como estão; a polar (twsPolar) também
  assert.ok(Math.abs(pr.tws - 26 * 0.7) < 1e-9)
  assert.ok(Math.abs(ot.tws - 26 * 0.6) < 1e-9)
  assert.ok(Math.abs(pe.twsPolar - 26 * 0.6) < 1e-9) // pessimista: a polar no P10
  assert.ok(Math.abs(ot.twsPolar - 26 * 0.8) < 1e-9) // otimista: a polar no P90, sem o mínimo
  // com razão P90 > 1 fica a do modelo
  const k2 = criarCenarios({ tempoBruto: tempoFixo({ tws: 20, rajada: 25 }), modelos: { ventoForca: { quantis: { p10: fixa(0.9), p50: fixa(1), p90: fixa(1.3) } } }, polar, obtida: 0 })
  assert.ok(Math.abs(k2.pessimista.tempo(39, -9.5, 0).tws - 26) < 1e-9)
})
