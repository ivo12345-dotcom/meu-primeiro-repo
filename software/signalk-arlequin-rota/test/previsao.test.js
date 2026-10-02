'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const prev = require('../lib/previsao')

const H = 3600000
// A fixture de 29/09 foi gravada antes da auditoria K-05 (02/10): o vento (forecast) veio da célula
// "de terra" (`land`, a omissão da Open-Meteo); só as ondas (marine) vieram com cell_selection=sea.
// Os pedidos de hoje pedem as duas com `sea` (urls(), abaixo). Não se regravou para não mexer nas
// referências dos outros testes: os números do vento de 29/09 junto à costa são os de `land`.
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const PONTOS = FIX.pontos.map(c.P)
const P29 = prev.interpretar(PONTOS, FIX.forecast, FIX.marine, FIX.obtidaSimulada)
const T = (iso) => Date.parse(iso)
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rota-prev-'))

test('urls: vários pontos num pedido, 48 h, UTC, nós; mais de 60 pontos em dois pedidos', () => {
  const [g] = prev.urls(PONTOS)
  assert.match(g.forecast, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=38\.696,38\.61,/)
  assert.match(g.forecast, /hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility,shortwave_radiation/)
  assert.match(g.forecast, /wind_speed_unit=kn&timezone=UTC&forecast_hours=48/)
  // K-05: o vento também da célula de mar (a de terra, a omissão, subestima o vento junto à costa ~40 %)
  assert.match(g.forecast, /&cell_selection=sea(&|$)/)
  assert.equal(new URL(g.forecast).searchParams.get('cell_selection'), 'sea')
  assert.equal(new URL(g.marine).searchParams.get('cell_selection'), 'sea')
  assert.match(g.marine, /^https:\/\/marine-api\.open-meteo\.com\/v1\/marine\?/)
  assert.match(g.marine, /hourly=wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction,sea_level_height_msl/)
  assert.match(g.marine, /cell_selection=sea&wind_speed_unit=kn/)
  const muitos = Array.from({ length: 61 }, (_, i) => ({ lat: 38 + i / 100, lon: -9.5 }))
  const gs = prev.urls(muitos)
  assert.equal(gs.length, 2)
  assert.equal(gs[1].pontos.length, 1)
  assert.equal(gs[0].forecast.match(/latitude=([^&]*)/)[1].split(',').length, 60)
})

test('pontos da previsão: a linha de 5 MN de ~10 em ~10 MN, a partida, o destino e Cascais', () => {
  const costa = c.carregarCosta()
  const pts = prev.pontosPrevisao(costa.linha(5), { partida: { lat: 38.6955, lon: -9.233 }, destino: { lat: 39.353, lon: -9.377 } })
  assert.deepEqual(pts[0], { lat: 38.696, lon: -9.233 })
  assert.ok(pts.some(p => p.lat === 39.353 && p.lon === -9.377))
  assert.ok(pts.some(p => p.lat === 38.69 && p.lon === -9.42))
  assert.ok(pts.length >= 7 && pts.length <= 12, `${pts.length} pontos`)
  // nenhum par a menos de 1 MN
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(c.distanciaMn(pts[i], pts[j]) >= 1)
})

test('interpretar: 9 pontos da fixture de 29/09, horas UTC, corrente em nós, o mar junto pela hora', () => {
  assert.equal(P29.pontos.length, 9)
  const p = P29.pontos[5]
  assert.equal(p.t[0], T('2026-09-29T00:00Z'))
  assert.equal(p.t.length, 72)
  assert.equal(p.tws[15], FIX.forecast[5].hourly.wind_speed_10m[15])
  assert.equal(p.ondas[15], FIX.marine[5].hourly.wave_height[15])
  assert.equal(p.nivel[15], FIX.marine[5].hourly.sea_level_height_msl[15])
  assert.equal(P29.inicio, T('2026-09-29T00:00Z'))
  assert.equal(P29.fim, T('2026-10-01T23:00Z'))
  // um só ponto (objeto, não lista), em km/h e com fuso: converte
  const um = prev.interpretar([{ lat: 39, lon: -9 }], { utc_offset_seconds: 3600, hourly_units: { wind_speed_10m: 'km/h' }, hourly: { time: ['2026-09-29T15:00'], wind_speed_10m: [18.52] } }, null, 0)
  assert.equal(um.pontos[0].t[0], T('2026-09-29T14:00Z'))
  assert.ok(Math.abs(um.pontos[0].tws[0] - 10) < 1e-9)
  assert.deepEqual(um.pontos[0].ondas, [null])
  assert.throws(() => prev.interpretar(PONTOS, FIX.forecast.slice(1), FIX.marine, 0), /8 pontos em vez de 9/)
})

test('unidade desconhecida (ou em falta) da Open-Meteo: erro em vez de assumir nós', () => {
  const desconhecida = { utc_offset_seconds: 0, hourly_units: { wind_speed_10m: 'furlongs/fortnight' }, hourly: { time: ['2026-09-29T15:00'], wind_speed_10m: [10] } }
  assert.throws(
    () => prev.interpretar([{ lat: 39, lon: -9 }], desconhecida, null, 0),
    /unidade desconhecida da Open-Meteo: furlongs\/fortnight/
  )
  const semChave = { utc_offset_seconds: 0, hourly_units: {}, hourly: { time: ['2026-09-29T15:00'], wind_speed_10m: [10] } }
  assert.throws(
    () => prev.interpretar([{ lat: 39, lon: -9 }], semChave, null, 0),
    /unidade desconhecida da Open-Meteo/
  )
  // as respostas reais (pedidas com wind_speed_unit=kn) nunca disparam isto
  assert.doesNotThrow(() => prev.interpretar(PONTOS, FIX.forecast, FIX.marine, 0))
})

test('tempo: o ponto mais perto, linear no tempo, ângulos por seno e cosseno', () => {
  const tempo = prev.criarTempo(P29)
  const p = P29.pontos[5] // linha 5 MN 5, ao largo de Santa Cruz
  const h15 = T('2026-09-29T15:00Z')
  const w = tempo(p.lat + 0.01, p.lon, h15)
  assert.equal(w.tws, p.tws[15])
  assert.equal(w.rajada, p.rajada[15])
  assert.equal(w.visibilidade, p.visibilidade[15])
  const meio = tempo(p.lat, p.lon, h15 + 20 * 60000)
  assert.ok(Math.abs(meio.tws - (p.tws[15] + (p.tws[16] - p.tws[15]) / 3)) < 1e-9)
  assert.ok(Math.abs(meio.radiacao - (p.radiacao[15] + (p.radiacao[16] - p.radiacao[15]) / 3)) < 1e-9)
  // o vento de 29/09 à tarde: S forte, como diz o relatório da fixture
  assert.ok(w.tws > 18 && w.twd > 150 && w.twd < 220, `${w.tws} nós de ${w.twd}°`)
  // em Peniche é a série de Peniche
  assert.equal(tempo(39.35, -9.38, h15).tws, P29.pontos[7].tws[15])
  // ângulos: 350° → 10° a meio dá 0°, não 180°
  const sint = { obtida: 0, inicio: 0, fim: H, pontos: [{ lat: 39, lon: -9, t: [0, H], tws: [10, 20], twd: [350, 10], ondasDir: [null, 300], corrente: [null, null] }] }
  const w2 = prev.criarTempo(sint)(39, -9, H / 2)
  assert.equal(w2.tws, 15)
  assert.ok(Math.abs(c.dif(w2.twd, 0)) < 1e-9)
  assert.equal(w2.ondasDir, 300) // um lado a null: fica o outro
  assert.equal(w2.corrente, null)
  assert.equal(w2.chuva, null) // campo que não há
  // fora das horas: fica na ponta
  assert.equal(prev.criarTempo(sint)(39, -9, 5 * H).tws, 20)
})

test('tempo: ponto mais perto com null → o próximo ponto com dados, marcado aproximado; se nenhum tiver, null e semDados', () => {
  // A (mais perto de 39,-9) tem ondas null nas duas horas; B (mais longe, a 12 MN) tem dados
  // (M-09: com B a 30 MN, como era este teste, já não serve — ver o teste abaixo)
  const dois = {
    obtida: 0,
    inicio: 0,
    fim: H,
    pontos: [
      { lat: 39, lon: -9, t: [0, H], tws: [10, 12], ondas: [null, null], corrente: [null, null] }, // A: mais perto
      { lat: 39.2, lon: -9, t: [0, H], tws: [20, 22], ondas: [2, 3], corrente: [null, null] } // B: mais longe
    ]
  }
  const tempo = prev.criarTempo(dois)
  const w = tempo(39, -9, 0)
  assert.equal(w.tws, 10) // tws tem dados no ponto mais perto: não mexe
  assert.equal(w.ondas, 2) // ondas: A é null, cai para B (o próximo mais perto)
  assert.deepEqual(w.aproximado, ['ondas'])
  // corrente: null em A e em B (nenhum ponto tem dados) → null e semDados
  assert.equal(w.corrente, null)
  assert.ok(w.semDados.includes('corrente'))
  assert.ok(!w.semDados.includes('ondas'))
  assert.ok(!w.semDados.includes('tws'))
})

test('M-09: o valor em falta só vem de outro ponto da previsão a ≤ 15 MN; mais longe é "sem dados" (nunca o mar de dezenas de MN dali)', () => {
  const pontos = (latB) => ({
    obtida: 0,
    inicio: 0,
    fim: H,
    pontos: [
      { lat: 39, lon: -9, t: [0, H], tws: [10, 12], ondas: [null, null] },
      { lat: latB, lon: -9, t: [0, H], tws: [20, 22], ondas: [2, 3] }
    ]
  })
  const perto = prev.criarTempo(pontos(39 + 14 / 60))(39, -9, 0) // B a 14 MN
  assert.equal(perto.ondas, 2)
  assert.deepEqual(perto.aproximado, ['ondas'])
  const longe = prev.criarTempo(pontos(39.5))(39, -9, 0) // B a 30 MN
  assert.equal(longe.ondas, null)
  assert.ok(longe.semDados.includes('ondas'))
  assert.equal(longe.aproximado, undefined)
  assert.equal(longe.tws, 10) // o ponto mais perto, esse, serve sempre
})

test('M-09: a ordem dos pontos por célula não depende de qual consulta chegou primeiro (o mesmo ponto dá sempre o mesmo tempo)', () => {
  // dois pontos de previsão quase à mesma distância de uma célula de 0,01°
  const P = { obtida: 0, inicio: 0, fim: H, pontos: [{ lat: 39, lon: -9.1, t: [0, H], tws: [10, 10] }, { lat: 39, lon: -8.9, t: [0, H], tws: [20, 20] }] }
  const a = { lat: 39.001, lon: -9.0049 } // um pouco mais perto do de oeste
  const b = { lat: 39.001, lon: -8.9951 } // um pouco mais perto do de leste (a mesma célula de 0,01°)
  const um = prev.criarTempo(P); const ra1 = um(a.lat, a.lon, 0).tws; const rb1 = um(b.lat, b.lon, 0).tws
  const outro = prev.criarTempo(P); const rb2 = outro(b.lat, b.lon, 0).tws; const ra2 = outro(a.lat, a.lon, 0).tws
  assert.equal(ra1, ra2)
  assert.equal(rb1, rb2)
})

test('nível do mar de Cascais para a maré', () => {
  const n = prev.nivelDoMar(P29)
  assert.equal(n.t.length, 72)
  assert.deepEqual(n.nivel, FIX.marine[8].hourly.sea_level_height_msl)
  assert.equal(prev.nivelDoMar({ pontos: [{ lat: 41, lon: -9, t: [0], nivel: [1] }] }), null) // longe de Cascais
})

test('obterPrevisao: fetch injetado; o mar falhado fica a null; erro do forecast rebenta', async () => {
  const pedidos = []
  const fetchOk = async (u) => { pedidos.push(u); return { ok: true, json: async () => (u.includes('marine') ? FIX.marine : FIX.forecast) } }
  const r = await prev.obterPrevisao({ pontos: PONTOS, agora: T(FIX.obtidaSimulada), fetch: fetchOk })
  assert.deepEqual(r, P29)
  assert.equal(pedidos.length, 2)
  const semMar = await prev.obterPrevisao({ pontos: PONTOS, agora: 0, fetch: async (u) => (u.includes('marine') ? { ok: false, status: 502 } : { ok: true, json: async () => FIX.forecast }) })
  assert.deepEqual(semMar.pontos[0].ondas.slice(0, 2), [null, null])
  await assert.rejects(prev.obterPrevisao({ pontos: PONTOS, fetch: async () => ({ ok: false, status: 503 }) }), /503/)
})

test('M-11: o pedido do mar falhado fica marcado (marFalhou) e as ondas podem vir da previsão guardada mais recente (juntarMarDoArquivo)', async () => {
  const semMar = await prev.obterPrevisao({ pontos: PONTOS, agora: T(FIX.obtidaSimulada), fetch: async (u) => (u.includes('marine') ? { ok: false, status: 502 } : { ok: true, json: async () => FIX.forecast }) })
  assert.equal(semMar.marFalhou, true)
  assert.equal((await prev.obterPrevisao({ pontos: PONTOS, agora: T(FIX.obtidaSimulada), fetch: async (u) => ({ ok: true, json: async () => (u.includes('marine') ? FIX.marine : FIX.forecast) }) })).marFalhou, undefined)
  // a guardada de 3 h antes (com as ondas de 29/09)
  const pasta = temp()
  prev.guardarArquivo(pasta, { ...P29, obtida: '2026-09-29T11:00:00.000Z' })
  const a = prev.lerArquivo(pasta, { pontos: PONTOS, desde: T('2026-09-29T14:00Z'), ate: T('2026-09-30T02:00Z'), agora: T('2026-09-29T14:00Z') })
  assert.equal(a.erro, undefined)
  const junta = prev.juntarMarDoArquivo(semMar, a.previsao)
  assert.equal(junta.marDoArquivo, '2026-09-29T11:00:00.000Z')
  assert.equal(junta.marFalhou, true)
  for (const [i, p] of junta.pontos.entries()) {
    assert.deepEqual(p.ondas, P29.pontos[i].ondas, `ponto ${i}`) // as mesmas horas e o mesmo ponto
    assert.deepEqual(p.periodo, P29.pontos[i].periodo)
    assert.deepEqual(p.ondasDir, P29.pontos[i].ondasDir)
    assert.deepEqual(p.corrente, semMar.pontos[i].corrente) // a corrente não se arquiva: fica como estava (null)
    assert.deepEqual(p.tws, semMar.pontos[i].tws) // o vento é o de agora
  }
  // não mexe na de entrada; um ponto longe de todos os guardados (> 15 MN) fica sem ondas
  assert.ok(semMar.pontos[0].ondas.every(x => x == null))
  const longe = prev.juntarMarDoArquivo({ ...semMar, pontos: [{ ...semMar.pontos[0], lat: 41, lon: -9 }] }, a.previsao)
  assert.ok(longe.pontos[0].ondas.every(x => x == null))
  // com o mar bom, nada muda
  assert.equal(prev.juntarMarDoArquivo(P29, a.previsao), P29)
})

test('M-11: lerArquivo com soComOndas salta as guardadas sem ondas (a de um pedido do mar falhado, também arquivada) e fica com a mais recente que as tem', async () => {
  const pasta = temp()
  // às 11:00 com o mar; às 13:00 só com o vento (o pedido do mar falhou, e o plugin arquiva-a na mesma)
  prev.guardarArquivo(pasta, { ...P29, obtida: '2026-09-29T11:00:00.000Z' })
  const semMar = await prev.obterPrevisao({ pontos: PONTOS, agora: T('2026-09-29T13:00:00Z'), fetch: async (u) => (u.includes('marine') ? { ok: false, status: 502 } : { ok: true, json: async () => FIX.forecast }) })
  prev.guardarArquivo(pasta, semMar)
  const q = { pontos: PONTOS, desde: T('2026-09-29T14:00Z'), ate: T('2026-09-30T02:00Z'), agora: T('2026-09-29T14:00Z') }
  // sem a opção, a mais recente: a sem ondas (juntar dela não dá nada)
  const recente = prev.lerArquivo(pasta, q)
  assert.equal(recente.obtida, '2026-09-29T13:00:00.000Z')
  assert.equal(prev.juntarMarDoArquivo(semMar, recente.previsao), semMar)
  // com soComOndas, a das 11:00: as ondas juntam-se
  const comOndas = prev.lerArquivo(pasta, { ...q, soComOndas: true })
  assert.equal(comOndas.erro, undefined, comOndas.erro)
  assert.equal(comOndas.obtida, '2026-09-29T11:00:00.000Z')
  const junta = prev.juntarMarDoArquivo(semMar, comOndas.previsao)
  assert.equal(junta.marDoArquivo, '2026-09-29T11:00:00.000Z')
  for (const [i, p] of junta.pontos.entries()) assert.deepEqual(p.ondas, P29.pontos[i].ondas, `ponto ${i}`)
  // só guardadas sem ondas: não há nenhuma que sirva
  const so = temp()
  prev.guardarArquivo(so, semMar)
  assert.equal(prev.lerArquivo(so, { ...q, soComOndas: true }).erro, 'não há previsão guardada que cubra a rota')
})

test('arquivo: um ficheiro por ponto no formato da Parte 2, escrita atómica, nomes sem ":"', () => {
  const pasta = temp()
  const fs1 = prev.guardarArquivo(pasta, P29)
  assert.equal(fs1.length, 9)
  assert.equal(path.basename(fs1[0]), '2026-09-29T14-00-38.696_-9.233.json.gz')
  assert.equal(path.basename(fs1[1]), '2026-09-29T14-00-38.610_-9.460.json.gz')
  assert.deepEqual(fs.readdirSync(pasta).filter(n => n.endsWith('.tmp')), [])
  const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(fs1[5])))
  assert.deepEqual(Object.keys(r), ['obtida', 'lat', 'lon', 'horas', 'tws', 'rajada', 'twd', 'ondas', 'periodo', 'ondasDir'])
  assert.equal(r.obtida, '2026-09-29T14:00:00.000Z')
  assert.equal(r.horas[15], '2026-09-29T15:00:00Z')
  assert.deepEqual(r.tws, P29.pontos[5].tws)
})

test('sem rede: a mais recente que cubra a rota, com a idade e os avisos; sem nenhuma, explica', () => {
  const pasta = temp()
  prev.guardarArquivo(pasta, P29) // obtida 29/09 14:00
  // uma mais nova, só com 2 pontos (não cobre Peniche): não serve para Peniche
  prev.guardarArquivo(pasta, { ...P29, obtida: '2026-09-29T18:00:00.000Z', pontos: P29.pontos.slice(0, 2).map(p => ({ ...p, tws: p.tws.map(x => x + 1) })) })
  const rota = [PONTOS[0], PONTOS[3], PONTOS[7]]
  const desde = T('2026-09-29T15:00Z'); const ate = T('2026-09-30T06:00Z')
  const r = prev.lerArquivo(pasta, { pontos: rota, desde, ate, agora: T('2026-09-29T19:00Z') })
  assert.equal(r.erro, undefined)
  assert.equal(r.obtida, '2026-09-29T14:00:00.000Z') // a mais velha das escolhidas
  assert.equal(r.idadeH, 5)
  assert.equal(r.aviso, null)
  assert.equal(r.previsao.pontos.length, 3)
  assert.equal(r.previsao.pontos[0].t[0], T('2026-09-29T00:00Z'))
  // o ponto de Algés veio da mais nova (18:00, com +1 nó), e do ponto de Algés, não do outro dela
  const tempo = prev.criarTempo(r.previsao)
  assert.equal(tempo(PONTOS[0].lat, PONTOS[0].lon, T('2026-09-29T16:00Z')).tws, P29.pontos[0].tws[16] + 1)
  assert.equal(r.previsao.pontos[0].lat, PONTOS[0].lat)
  assert.equal(tempo(PONTOS[0].lat, PONTOS[0].lon, T('2026-09-29T16:00Z')).chuva, null) // não se arquiva
  const velha = prev.lerArquivo(pasta, { pontos: rota, desde, ate, agora: T('2026-09-29T21:30Z') })
  assert.equal(velha.aviso, 'aviso')
  assert.equal(velha.texto, 'Previsão guardada há 8 h (sem rede)')
  const muito = prev.lerArquivo(pasta, { pontos: rota, desde, ate: T('2026-09-30T20:00Z'), agora: T('2026-09-30T03:00Z') })
  assert.equal(muito.aviso, 'grande')
  assert.equal(muito.texto, 'Previsão velha: a mais recente guardada tem 13 h (sem rede)')
  // não cobre: horas a mais, ponto longe, pasta vazia
  assert.deepEqual(prev.lerArquivo(pasta, { pontos: rota, desde, ate: T('2026-10-02T06:00Z'), agora: T('2026-09-29T19:00Z') }), { erro: 'não há previsão guardada que cubra a rota' })
  assert.match(prev.lerArquivo(pasta, { pontos: [{ lat: 41, lon: -9 }], desde, ate, agora: T('2026-09-29T19:00Z') }).erro, /não há previsão/)
  assert.match(prev.lerArquivo(path.join(pasta, 'nada'), { pontos: rota, desde, ate }).erro, /não há previsão/)
  // as do plugin da AI (um ponto, nome sem posição) também servem
  const ia = temp()
  fs.writeFileSync(path.join(ia, '2026-09-29T14-00.json.gz'), zlib.gzipSync(JSON.stringify(prev.registoParte2(P29.obtida, P29.pontos[3]))))
  assert.equal(prev.lerArquivo(ia, { pontos: [PONTOS[3]], desde, ate, agora: T('2026-09-29T15:00Z') }).previsao.pontos.length, 1)
})

test('lerArquivo: só há uma previsão com mais de 48 h → a razão diz a idade, não o genérico', () => {
  const pasta = temp()
  const velha = { ...P29, obtida: '2026-09-27T10:00:00.000Z' } // 57 h antes do "agora" abaixo
  prev.guardarArquivo(pasta, velha)
  const rota = [PONTOS[0]]
  const desde = T('2026-09-29T15:00Z'); const ate = T('2026-09-30T06:00Z')
  const agora = T('2026-09-29T19:00Z')
  const r = prev.lerArquivo(pasta, { pontos: rota, desde, ate, agora })
  assert.equal(r.erro, 'a última previsão guardada tem 57 h (mais de 48 h): sem previsão válida')
  // se além da idade também não cobrir (posição/horas), continua o erro genérico
  assert.equal(
    prev.lerArquivo(pasta, { pontos: [{ lat: 41, lon: -9 }], desde, ate, agora }).erro,
    'não há previsão guardada que cubra a rota'
  )
})

test('escreverAtomico (via guardarArquivo): tenta fsync do diretório-mãe depois do rename, ignorando erro', () => {
  const pasta = temp()
  const real = fs.openSync
  let tentouAbrirPasta = false
  fs.openSync = (p, ...resto) => {
    if (p === pasta) { tentouAbrirPasta = true; const e = new Error('EISDIR: diretório, não é possível abrir'); e.code = 'EISDIR'; throw e }
    return real(p, ...resto)
  }
  try {
    const fs1 = prev.guardarArquivo(pasta, P29)
    assert.ok(tentouAbrirPasta, 'devia tentar abrir o diretório-mãe para fsync')
    assert.ok(fs.existsSync(fs1[0]))
    assert.deepEqual(fs.readdirSync(pasta).filter(n => n.endsWith('.tmp')), [])
  } finally { fs.openSync = real }
})
