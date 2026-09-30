'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const prev = require('../lib/previsao')
const base = require('../lib/base')
const { calcular } = require('../lib/calculo')

const H = 3600000
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const P29 = prev.interpretar(FIX.pontos.map(c.P), FIX.forecast, FIX.marine, FIX.obtidaSimulada)
const P29_SEM_MAR = prev.interpretar(FIX.pontos.map(c.P), FIX.forecast, null, FIX.obtidaSimulada)
const costa = c.carregarCosta()
const polar = base.carregarPolar()
const ALGES = c.P(costa.destinos.find(d => d.id === 'alges').aproximacao.at(-1))
const AGORA = Date.parse('2026-09-29T14:32:00Z') // 15:32 em Lisboa
const ORDEM = { segue: 0, volta: 1, espera: 1, 'nao-recomendado': 2 } // menor = melhor

const deps = (o = {}) => ({ costa, polar, modelos: {}, versoes: { velocidade: null }, obterPrevisao: async () => ({ previsao: P29, obtida: P29.obtida, idadeH: 0.5, aviso: null }), ...o })
const entrada = (o = {}) => ({ instrumentos: { posicao: ALGES, socPct: 90, gasoleoL: 124 }, destino: 'peniche', tripulacao: 'so', sairAgora: false, agora: AGORA, ...o })

// Os cálculos pesados fazem-se uma vez e os testes leem daqui.
const cache = {}
const correr = (nome, e, d) => (cache[nome] ??= calcular(e, d))

test('29/09, Algés → Peniche, só eu, 15:32: "Não recomendado sozinho" ou "Espera", com o resultado na forma do desenho', async () => {
  const progresso = []
  const r = await correr('so', entrada(), deps({ progresso: (f, t) => progresso.push([f, t]) }))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(['nao-recomendado', 'espera'].includes(r.veredicto.tipo), r.veredicto.texto)
  assert.ok(r.veredicto.porque.length >= 1 && r.veredicto.porque.length <= 2)
  // a forma do `resultado`
  for (const k of ['veredicto', 'alternativas', 'desistencia', 'previsao', 'ia']) assert.ok(k in r, k)
  assert.deepEqual(Object.keys(r.veredicto), ['tipo', 'texto', 'porque'])
  assert.equal(r.alternativas.length, 3)
  for (const a of r.alternativas) {
    for (const k of ['id', 'nome', 'afastamento', 'partida', 'propulsao', 'chegada', 'milhas', 'horas', 'maximos', 'gasoleoL', 'bateriaMin', 'chegadaNoite', 'excluida', 'naoRecomendada', 'motivos', 'rota', 'eventos', 'avisos', 'precaucoes']) assert.ok(k in a, `alternativa sem ${k}`)
    assert.deepEqual(Object.keys(a.chegada), ['p10', 'p50', 'p90'])
    assert.ok(Date.parse(a.chegada.p10) <= Date.parse(a.chegada.p50) && Date.parse(a.chegada.p50) <= Date.parse(a.chegada.p90))
    for (const k of ['vela', 'motor', 'noite', 'leme']) assert.ok(Number.isFinite(a.horas[k]), k)
    for (const k of ['vento', 'rajada', 'ondas']) assert.ok(Number.isFinite(a.maximos[k]), k)
    assert.ok(a.gasoleoL.p90 >= a.gasoleoL.p50)
    assert.ok(Array.isArray(a.rota[0]) && a.rota[0].length === 2)
    assert.equal(a.excluida, false)
    assert.ok(a.eventos.at(-1).tipo === 'chegada')
    assert.ok(a.precaucoes.some(p => p.id === 'vhf'))
    assert.ok(Date.parse(a.chegada.p90) <= P29.fim) // nenhuma acaba depois da previsão
  }
  // as 3 por custo (as recomendadas primeiro)
  const custos = r.alternativas.map(a => a.custo.total)
  if (r.alternativas.every(a => a.naoRecomendada === r.alternativas[0].naoRecomendada)) assert.deepEqual([...custos].sort((x, y) => x - y), custos)
  assert.deepEqual(r.previsao, { obtida: P29.obtida, idadeH: 0.5, aviso: null, fim: new Date(P29.fim).toISOString() })
  assert.deepEqual(r.ia, { versoes: { velocidade: null }, nota: 'AI: a aprender (polar, previsão ±10% e curva da Volvo)' })
  assert.equal(r.partida.nome, 'Algés (CNA)')
  // desistência da melhor, com o resumo
  assert.ok(r.desistencia.length >= 10)
  assert.match(r.desistenciaResumo, /^até às \d\d:\d\d ainda voltas a Algés \(CNA\) com vento (a favor|de través)$|^voltar a Algés/)
  // progresso de 0 a 1, por ordem
  assert.equal(progresso.at(-1)[0], 1)
  for (let i = 1; i < progresso.length; i++) assert.ok(progresso[i][0] >= progresso[i - 1][0])
  // 17 partidas (agora e de 3 em 3 h até +48 h), as que acabam depois da previsão ficam de fora
  assert.equal(r.estatisticas.partidas, 17)
  assert.ok(r.estatisticas.foraDaPrevisao > 0)
  if (process.env.ROTA_MOSTRAR) console.log(JSON.stringify({ veredicto: r.veredicto, top: r.alternativas.map(a => ({ nome: a.nome, chegada: a.chegada, custo: a.custo, horas: a.horas, maximos: a.maximos, maximosPessimista: a.maximosPessimista, chegadaNoite: a.chegadaNoite, motivos: a.motivos })), estat: r.estatisticas }, null, 1))
})

test('29/09 com "acompanhado": o veredicto é igual ou melhor', async () => {
  const so = await correr('so', entrada(), deps())
  const ac = await correr('acompanhado', entrada({ tripulacao: 'acompanhado' }), deps())
  assert.ok(ORDEM[ac.veredicto.tipo] <= ORDEM[so.veredicto.tipo], `${ac.veredicto.texto} vs ${so.veredicto.texto}`)
  assert.ok(ac.alternativas.every(a => !a.naoRecomendada))
  assert.ok(ac.alternativas[0].custo.total <= so.alternativas[0].custo.total)
  assert.equal(ac.alternativas[0].custo.partes.leme, 0)
})

// O desenho diz que, com a previsão de 29/09, a melhor alternativa chega de dia. Com os dados reais da
// fixture (ondas de 2,5–3 m em todo o período, por isso nunca há "motor em calma") o custo do desenho
// escolhe a partida de 30/09 às 06:30 a motor, que chega às 21:22 (de noite, 3 h depois do pôr do sol):
// ver o relatório C. Fica como "todo" para o Ivo decidir (não se mexe nos limites nem nos pesos).
test('29/09: a melhor alternativa (só eu) chega de dia', { todo: 'com os dados reais a melhor chega às 21:22, de noite — decisão do Ivo' }, async () => {
  const r = await correr('so', entrada(), deps())
  assert.equal(r.alternativas[0].chegadaNoite, false, `${r.alternativas[0].nome} chega ${r.alternativas[0].chegada.p50}`)
})

test('"Sair agora mesmo assim": só a partida de agora, com as não recomendadas, precauções reforçadas e desistência', async () => {
  const r = await correr('agora', entrada({ sairAgora: true }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.equal(r.estatisticas.partidas, 1)
  assert.ok(r.alternativas.length >= 1)
  for (const a of r.alternativas) assert.equal(a.partida, new Date(AGORA).toISOString())
  // hoje às 15:32 há rajadas > 30 no pior caso e > 8 h ao leme: não recomendadas, mas mostradas
  assert.ok(r.alternativas[0].naoRecomendada)
  assert.equal(r.veredicto.tipo, 'nao-recomendado')
  const custos = r.alternativas.map(a => a.custo.total)
  assert.deepEqual([...custos].sort((x, y) => x - y), custos)
  assert.ok(r.alternativas[0].precaucoes.some(p => p.id === 'desistencia'))
  assert.ok(r.desistencia.length > 0)
})

test('sem dados do mar: calcula com a corrente da barra do Tejo a 0 e avisa', async () => {
  const r = await correr('semMar', entrada({ sairAgora: true }), deps({ obterPrevisao: async () => ({ previsao: P29_SEM_MAR, obtida: P29_SEM_MAR.obtida, idadeH: 7, aviso: 'aviso', texto: 'Previsão guardada há 7 h (sem rede)' }) }))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.avisos.includes('Sem dados do mar: a corrente de maré na barra do Tejo fica a 0'))
  assert.ok(r.avisos.includes('Previsão guardada há 7 h (sem rede)'))
  assert.equal(r.previsao.aviso, 'aviso')
  assert.equal(r.previsao.idadeH, 7)
  assert.equal(r.alternativas[0].maximos.ondas, null)
})

test('falhas: sem GPS, sem previsão, destino desconhecido, já no destino, sem polar e erros dentro: nunca lança', async () => {
  assert.match((await calcular(entrada({ instrumentos: {} }), deps())).erro, /^Sem GPS/)
  assert.match((await calcular(entrada(), deps({ obterPrevisao: async () => ({ erro: 'não há previsão guardada que cubra a rota' }) }))).erro, /^Sem previsão que cubra a rota: não há previsão guardada/)
  assert.match((await calcular(entrada(), deps({ obterPrevisao: async () => { throw new Error('rebentou') } }))).erro, /^Sem previsão que cubra a rota: rebentou/)
  assert.equal((await calcular(entrada({ destino: 'atlantida' }), deps())).erro, 'destino desconhecido: atlantida')
  assert.equal((await calcular(entrada({ destino: 'alges' }), deps())).erro, 'Já estás em Algés (CNA).')
  assert.equal((await calcular(entrada(), deps({ polar: null }))).erro, 'sem polar')
  const r = await calcular(entrada(), deps({ costa: { ...costa, linha: () => { throw new Error('costa estragada') } } }))
  assert.equal(r.erro, 'erro no cálculo: costa estragada')
  // previsão curta (acaba antes de qualquer chegada): explica
  const curta = { ...P29, fim: AGORA + 2 * H }
  assert.match((await calcular(entrada(), deps({ obterPrevisao: async () => ({ previsao: curta, obtida: curta.obtida, idadeH: 0 }) }))).erro, /^A previsão acaba às 17:32: não cobre nenhuma passagem até Peniche\.$/)
})

test('no mar (a mais de 0,5 MN de um porto): parte da posição atual; sem SoC nem gasóleo assume e avisa', async () => {
  const r = await calcular(entrada({ instrumentos: { posicao: { lat: 38.97, lon: -9.53 } }, sairAgora: true }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.equal(r.partida.emMar, true)
  assert.deepEqual(r.alternativas[0].rota[0], [38.97, -9.53])
  assert.ok(r.avisos.includes('Sem estado da bateria: assumi 80%'))
  assert.ok(r.avisos.includes('Sem nível do gasóleo: assumi 100 L'))
  assert.equal(r.desistenciaResumo.includes('Algés'), false) // sem porto de partida: volta ao abrigo mais perto
})
