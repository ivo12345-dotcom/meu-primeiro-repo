'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const c = require('../lib/costa')
const prev = require('../lib/previsao')
const base = require('../lib/base')
const rotas = require('../lib/rotas')
const decisao = require('../lib/decisao')
const { calcular, ventoDoMarNosRastos } = require('../lib/calculo')

const H = 3600000
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'previsao-2026-09-29.json.gz'))))
const P29 = prev.interpretar(FIX.pontos.map(c.P), FIX.forecast, FIX.marine, FIX.obtidaSimulada)
const P29_SEM_MAR = prev.interpretar(FIX.pontos.map(c.P), FIX.forecast, null, FIX.obtidaSimulada)
const costa = c.carregarCosta()
const polar = base.carregarPolar()
const ALGES = c.P(costa.destinos.find(d => d.id === 'alges').aproximacao.at(-1))
const AGORA = Date.parse('2026-09-29T14:32:00Z') // 15:32 em Lisboa
const ORDEM = { segue: 0, volta: 1, espera: 1, 'nao-recomendado': 2 } // menor = melhor

const de = (id) => c.P(costa.destinos.find(d => d.id === id).aproximacao.at(-1))
// uma cópia da previsão de 29/09 com cada ponto mudado por f(ponto, índice)
const mudar = (P, f) => { const x = structuredClone(P); x.pontos.forEach(f); return x }
const deps = (o = {}) => ({ costa, polar, modelos: {}, versoes: { velocidade: null }, obterPrevisao: async () => ({ previsao: P29, obtida: P29.obtida, idadeH: 0.5, aviso: null }), ...o })
const comPrevisao = (P, o = {}) => deps({ obterPrevisao: async () => ({ previsao: P, obtida: P.obtida, idadeH: 0.5, aviso: null }), ...o })
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
    for (const k of ['id', 'nome', 'afastamento', 'partida', 'propulsao', 'chegada', 'milhas', 'horas', 'maximos', 'gasoleoL', 'bateriaMin', 'chegadaNoite', 'excluida', 'naoRecomendada', 'motivos', 'rota', 'eventos', 'avisos', 'precaucoes', 'avisosVermelhos', 'avisosRota', 'direto', 'canal', 'nota']) assert.ok(k in a, `alternativa sem ${k}`)
    assert.deepEqual(Object.keys(a.chegada), ['p10', 'p50', 'p90'])
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

// Expectativa do Ivo (ronda C2, conhecendo a previsão real): com só eu, esperar ganha — a melhor
// alternativa não parte antes de 30/09 (hora de Lisboa): "Espera até amanhã às 06:30". Substitui a
// do desenho ("a melhor chega de dia"), que com os dados reais não se cumpre: a melhor (30/09 06:30,
// 5 MN a motor) chega às 21:46, de noite. Os limites e os pesos não foram mexidos por causa disto.
test('29/09 (só eu): esperar ganha — "Espera até amanhã às 06:30", a melhor parte a 30/09', async () => {
  const r = await correr('so', entrada(), deps())
  assert.equal(r.veredicto.texto, 'Espera até amanhã às 06:30')
  const dia = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(Date.parse(t))
  const melhor = r.alternativas[0]
  assert.ok(dia(melhor.partida) >= '2026-09-30', `${melhor.nome} parte ${melhor.partida}`)
  assert.ok(melhor.esperaH > 0)
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
  assert.ok(r.avisos.includes('Sem previsão do mar (ondas e corrente): as ondas ficam desconhecidas, e desconhecido não conta como calmo'))
  assert.ok(r.avisos.includes('Previsão guardada há 7 h (sem rede)'))
  assert.equal(r.previsao.aviso, 'aviso')
  assert.equal(r.previsao.idadeH, 7)
  assert.equal(r.alternativas[0].maximos.ondas, null)
})

test('M-11: as ondas vindas da previsão guardada (o pedido do mar falhou) dão o aviso com a idade dela', async () => {
  const comArquivo = { ...P29, marFalhou: true, marDoArquivo: new Date(AGORA - 3 * H).toISOString() }
  const r = await correr('marDoArquivo', entrada({ sairAgora: true }), comPrevisao(comArquivo))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.avisos.includes('Ondas da previsão guardada há 3 h (o pedido do mar falhou)'), JSON.stringify(r.avisos))
  // sem ela, nada
  assert.ok(!(await correr('agora', entrada({ sairAgora: true }), deps())).avisos.some(x => /^Ondas da previsão guardada/.test(x)))
})

test('falhas: sem GPS, sem previsão, destino desconhecido, já no destino, sem polar e erros dentro: nunca lança', async () => {
  assert.match((await calcular(entrada({ instrumentos: {} }), deps())).erro, /^Sem GPS/)
  assert.match((await calcular(entrada(), deps({ obterPrevisao: async () => ({ erro: 'não há previsão guardada que cubra a rota' }) }))).erro, /^Sem previsão que cubra a rota: não há previsão guardada/)
  // I-32: uma exceção (erro de programação, em inglês do JavaScript) nunca chega ao Ivo: frase fixa e o erro no registo
  const registo = []
  const log = (msg, e) => registo.push([msg, e])
  assert.equal((await calcular(entrada(), deps({ log, obterPrevisao: async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')") } }))).erro, 'Sem previsão que cubra a rota: erro interno ao obter a previsão (o pormenor ficou no registo do SignalK). Não calculo sem previsão.')
  assert.equal(registo.length, 1)
  assert.ok(registo[0][1] instanceof TypeError)
  assert.equal((await calcular(entrada({ destino: 'atlantida' }), deps())).erro, 'destino desconhecido: atlantida')
  assert.equal((await calcular(entrada({ destino: 'alges' }), deps())).erro, 'Já estás em Algés (CNA).')
  assert.equal((await calcular(entrada(), deps({ polar: null }))).erro, 'sem polar')
  const r = await calcular(entrada(), deps({ costa: { ...costa, linha: () => { throw new Error('costa estragada') } } }))
  assert.equal(r.erro, 'Erro interno no cálculo da rota: o pormenor ficou no registo do SignalK.')
  const r2 = await calcular(entrada(), deps({ log, costa: { ...costa, linha: () => { throw new Error('costa estragada') } } }))
  assert.equal(r2.erro, r.erro)
  assert.equal(registo.at(-1)[1].message, 'costa estragada')
  assert.match(registo.at(-1)[0], /erro no cálculo/)
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
  // o gasóleo inicial desconhecido é um aviso vermelho em cada alternativa (a regra corre com os 100 L assumidos)
  for (const a of r.alternativas) assert.ok(a.avisosVermelhos.includes('gasóleo inicial desconhecido: confirma o depósito (assumi 100 L)'), JSON.stringify(a.avisosVermelhos))
  // I-14: a bateria desconhecida também (a regra dos 50 % à chegada corre com os 80 % assumidos), nunca em silêncio
  for (const a of r.alternativas) assert.ok(a.avisosVermelhos.includes('estado da bateria desconhecido: confirma a carga (assumi 80%)'), JSON.stringify(a.avisosVermelhos))
  // em "sair agora" os avisos vermelhos da 1.ª passam aos gerais, mas o gasóleo e a bateria assumidos só uma vez
  assert.equal(r.avisos.filter(x => /assumi 100 L/.test(x)).length, 1, JSON.stringify(r.avisos))
  assert.equal(r.avisos.filter(x => /assumi 80%/.test(x)).length, 1, JSON.stringify(r.avisos))
  // com a bateria conhecida, nada disto
  const conhecida = await correr('so', entrada(), deps())
  for (const a of conhecida.alternativas) assert.ok(!a.avisosVermelhos.some(x => /estado da bateria desconhecido/.test(x)), JSON.stringify(a.avisosVermelhos))
  assert.equal(r.desistenciaResumo.includes('Algés'), false) // sem porto de partida: volta ao abrigo mais perto
})

test('alternativas pelo rotas.gerarAlternativas em cada partida (hora da partida, vento previsto e o registo): Peniche → Nazaré tem a variante pelo Canal da Berlenga', async () => {
  const orig = rotas.gerarAlternativas
  const origRota = rotas.gerarRota
  const chamadas = []
  const chamadasRota = [] // as da desistência
  rotas.gerarAlternativas = (costa, args) => { chamadas.push(args); return orig(costa, args) }
  rotas.gerarRota = (costa, args) => { chamadasRota.push(args); return origRota(costa, args) }
  const log = () => {}
  let cands = []
  try {
    const r = await calcular(entrada({ instrumentos: { posicao: de('peniche'), socPct: 90, gasoleoL: 124 }, destino: 'nazare' }), deps({ log, aoCandidatos: l => { cands = l } }))
    assert.equal(r.erro, undefined, r.erro)
  } finally { rotas.gerarAlternativas = orig; rotas.gerarRota = origRota }
  // a desistência também recebe o vento previsto, a hora de cada ponto e o registo
  assert.ok(chamadasRota.length > 0)
  for (const a of chamadasRota) { assert.equal(typeof a.twd, 'function'); assert.ok(Number.isFinite(a.horaPartida)); assert.equal(a.log, log) }
  const partidas = decisao.partidas(AGORA, { fim: P29.fim })
  assert.ok(chamadas.length > 0)
  for (const a of chamadas) {
    assert.ok(partidas.includes(a.horaPartida), `${a.horaPartida}`)
    assert.equal(typeof a.twd, 'function')
    assert.ok(Number.isFinite(a.twd(39.4, -9.5, a.horaPartida)))
    assert.equal(a.log, log)
  }
  // a regra dos 3 MN depende do vento à hora da partida: a de 3 MN gera-se em cada partida
  assert.deepEqual([...new Set(chamadas.filter(a => a.afastamento === 3).map(a => a.horaPartida))], partidas)
  assert.ok(cands.some(k => k.canal === 'Canal da Berlenga'), 'sem a variante pelo canal')
  assert.equal(new Set(cands.map(k => k.id)).size, cands.length, 'ids repetidos')
})

test('cada alternativa diz se vai sem vela (semVela, < 0,1 h de vela no provável, em bruto): o mesmo critério da junção das repetidas (revisão final, 9)', async () => {
  let cands = []
  const r = await calcular(entrada({ instrumentos: { posicao: de('peniche'), socPct: 90, gasoleoL: 124 }, destino: 'nazare' }), deps({ aoCandidatos: l => { cands = l } }))
  assert.equal(r.erro, undefined, r.erro)
  for (const a of r.alternativas) {
    const k = cands.find(x => x.id === a.id)
    assert.equal(typeof a.semVela, 'boolean', a.id)
    assert.equal(a.semVela, decisao.semVela(k), a.id)
  }
})

test('a variante pelo Canal da Berlenga no texto da alternativa: nome, canal, nota e o aviso "por confirmar na carta"', async () => {
  const calmo = mudar(P29, p => { p.ondas = p.ondas.map(x => (x == null ? null : x * 0.6)) })
  const r = await calcular(entrada({ instrumentos: { posicao: de('peniche'), socPct: 90, gasoleoL: 124 }, destino: 'nazare', tripulacao: 'acompanhado' }), comPrevisao(calmo))
  assert.equal(r.erro, undefined, r.erro)
  const k = r.alternativas.find(a => a.canal)
  assert.ok(k, JSON.stringify(r.alternativas.map(a => a.nome)))
  assert.equal(k.canal, 'Canal da Berlenga')
  assert.match(k.nome, /, 5 MN pelo Canal da Berlenga, (vela e motor|só motor)$/)
  assert.match(k.id, /^\d{8}T\d{4}-5mn-canal-da-berlenga-(vela|motor)$/) // o nome do canal no id (com mais canais, não se repetem)
  assert.equal(k.nota, 'Canal da Berlenga: terra dos dois lados; só com ondas < 3 m — por confirmar na carta')
  assert.ok(k.avisosRota.includes('Canal da Berlenga por confirmar na carta'))
  for (const a of r.alternativas.filter(a => !a.canal)) { assert.equal(a.canal, null); assert.equal(a.nota, null) }
})

test('rota direta (salto curto) Cascais → Algés: uma por partida, com id e nome com sentido; o vento de terra é o da hora de cada partida', async () => {
  let cands = []
  const r = await calcular(entrada({ instrumentos: { posicao: de('cascais'), socPct: 90, gasoleoL: 124 }, destino: 'alges' }), deps({ aoCandidatos: l => { cands = l } }))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.alternativas.length >= 1)
  for (const a of r.alternativas) {
    assert.equal(a.direto, true)
    assert.equal(a.afastamento, null)
    assert.match(a.id, /^\d{8}T\d{4}-direto-(vela|motor)$/)
    assert.match(a.nome, /, direta \(salto curto\), (vela e motor|só motor)$/)
    assert.ok(a.avisosRota.includes('salto curto entre portos vizinhos: rota direta junto à costa'))
  }
  assert.doesNotMatch(JSON.stringify({ v: r.veredicto, a: r.alternativas.map(a => [a.id, a.nome]) }), /null ?mn/i)
  // uma só direta por partida e propulsão (a mesma a 3, 5 e 8 MN)
  const chaves = cands.map(k => `${k.partida}|${k.propulsao}`)
  assert.equal(new Set(chaves).size, chaves.length)
  // agora o vento é do mar (excluída), mais tarde já é de terra: calculado à hora de cada partida
  assert.match(r.veredicto.porque[0], /^Agora: vento do mar em parte da rota/)
  assert.ok(cands.some(k => k.partida > AGORA && !k.excluida))
})

test('a energia entra na simulação (a bateria à chegada é conhecida) e os avisos da segurança passam para a alternativa', async () => {
  const r = await correr('so', entrada(), deps())
  for (const a of r.alternativas) {
    assert.ok(Number.isFinite(a.bateriaMin), `${a.bateriaMin}`)
    assert.ok(!a.avisosVermelhos.some(x => /bateria/.test(x)), JSON.stringify(a.avisosVermelhos))
  }
  // rajadas só no primeiro ponto de previsão: nos outros vêm aproximadas (seguranca.avaliar → avisos[])
  const aprox = mudar(P29, (p, i) => { if (i > 0) p.rajada = p.rajada.map(() => null) })
  const r2 = await calcular(entrada({ sairAgora: true }), comPrevisao(aprox))
  assert.equal(r2.erro, undefined, r2.erro)
  assert.ok(r2.alternativas[0].avisosRota.includes('previsão de rajadas aproximada em parte da rota (de um ponto de previsão mais longe)'), JSON.stringify(r2.alternativas[0].avisosRota))
})

test('"Sair agora": inclui as não recomendadas e os avisos vermelhos (previsão em falta, gasóleo), nunca as exclusões duras', async () => {
  // gasóleo curto: em "sair agora" é aviso vermelho; sem "sair agora" exclui
  const pouco = entrada({ instrumentos: { posicao: ALGES, socPct: 90, gasoleoL: 45 } })
  const s = await calcular({ ...pouco, sairAgora: true }, deps())
  assert.equal(s.erro, undefined, s.erro)
  assert.ok(s.alternativas.length >= 1)
  assert.ok(s.alternativas.some(a => a.avisosVermelhos.some(x => / L de gasóleo no pior caso/.test(x))), JSON.stringify(s.alternativas.map(a => a.avisosVermelhos)))
  let cands = []
  const n = await calcular(pouco, deps({ aoCandidatos: l => { cands = l } }))
  const semGasoleo = cands.filter(k => k.motivos.some(x => / L de gasóleo no pior caso/.test(x)))
  assert.ok(semGasoleo.length > 0 && semGasoleo.every(k => k.excluida))
  assert.ok(n.alternativas.every(a => !semGasoleo.some(k => k.id === a.id)))
  // sem previsão de rajadas: em "sair agora" aviso vermelho; sem "sair agora" todas excluídas
  const semRajada = mudar(P29, p => { p.rajada = p.rajada.map(() => null) })
  const sr = await calcular(entrada({ sairAgora: true }), comPrevisao(semRajada))
  assert.equal(sr.erro, undefined, sr.erro)
  assert.ok(sr.alternativas.length >= 1)
  for (const a of sr.alternativas) assert.ok(a.avisosVermelhos.some(x => /^sem previsão de rajadas em parte da rota/.test(x)), JSON.stringify(a.avisosVermelhos))
  const nr = await calcular(entrada(), comPrevisao(semRajada))
  assert.equal(nr.alternativas.length, 0)
  assert.equal(nr.veredicto.tipo, 'nao-recomendado')
  // exclusão dura (o Canal da Berlenga com ondas ≥ 3 m): nunca aparece, nem em "sair agora"
  const mar = mudar(P29, p => { p.ondas = p.ondas.map(x => (x == null ? null : Math.max(x, 3.2))) })
  let cc = []
  const k = await calcular(entrada({ instrumentos: { posicao: de('peniche'), socPct: 90, gasoleoL: 124 }, destino: 'nazare', sairAgora: true }), comPrevisao(mar, { aoCandidatos: l => { cc = l } }))
  assert.equal(k.erro, undefined, k.erro)
  const canal = cc.filter(x => x.canal)
  assert.ok(canal.length > 0 && canal.every(x => x.excluida), JSON.stringify(canal.map(x => x.motivos)))
  assert.ok(k.alternativas.length >= 1)
  for (const a of k.alternativas) { assert.equal(a.excluida, false); assert.equal(a.canal, null) }
  assert.ok(k.alternativas.some(a => a.naoRecomendada)) // ondas > 3 m: não recomendadas, mas mostradas
})

test('K-06 (decisão do Ivo n.º 1): "Sair agora" com o gasóleo curto, sem previsão do mar ou com a previsão a acabar antes da chegada: "Não recomendado" (nunca "Segue"), com o motivo e os avisos vermelhos; continua a poder ativar-se', async () => {
  const MESMO_ASSIM = 'Se saíres mesmo assim, revê as precauções e os pontos de desistência.'
  const hmLisboa = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const casos = [
    // a sonda do auditor (Algés → Peniche, acompanhado, 45 L no depósito): era "Segue" a verde (com
    // "chegas com 22 L" na lista por baixo); qual das alternativas fica à frente é a do menor custo
    ['gasóleo', entrada({ instrumentos: { posicao: ALGES, socPct: 90, gasoleoL: 45 }, tripulacao: 'acompanhado', sairAgora: true }), deps(), () => /^chegas com (2\d|3\d) L de gasóleo no pior caso \(mínimo 40 L\)$/],
    ['sem mar', entrada({ tripulacao: 'acompanhado', sairAgora: true }), comPrevisao(P29_SEM_MAR), () => /^sem previsão de ondas em parte da rota: desconhecido não conta como calmo$/],
    // a hora é a da chegada mais tarde da 1.ª alternativa (p90), em Lisboa
    ['previsão curta', entrada({ tripulacao: 'acompanhado', sairAgora: true }), comPrevisao({ ...P29, fim: AGORA + 2 * H }), (a0) => new RegExp(`^a previsão acaba antes da chegada \\(${hmLisboa(Date.parse(a0.chegada.p90))}\\): o fim da passagem é sem previsão$`)]
  ]
  for (const [nome, e, d, padrao] of casos) {
    const r = await calcular(e, d)
    assert.equal(r.erro, undefined, `${nome}: ${r.erro}`)
    assert.equal(r.veredicto.tipo, 'nao-recomendado', `${nome}: ${JSON.stringify(r.veredicto)}`)
    assert.equal(r.veredicto.texto, 'Não recomendado')
    // o veredicto fala da 1.ª alternativa (a melhor para sair agora) e do motivo dela
    const a0 = r.alternativas[0]
    const motivo = a0.motivos[0]
    assert.match(motivo, padrao(a0), nome)
    const rota = `a ${a0.afastamento} MN${a0.propulsao === 'motor' ? ' a motor' : ''}`
    assert.deepEqual(r.veredicto.porque, [`A melhor para sair agora (${rota}, agora): ${motivo}.`, MESMO_ASSIM], nome)
    // as alternativas mostram-se (podem ativar-se), não recomendadas, com o motivo e o aviso vermelho
    assert.equal(r.alternativas.length, 3, nome)
    for (const a of r.alternativas) {
      assert.equal(a.excluida, false, nome)
      assert.equal(a.excluidaSemSairAgora, true, `${nome}: ${a.id}`)
      assert.equal(a.naoRecomendada, true, `${nome}: ${a.id}`)
      assert.equal(a.motivos.length, 1, `${nome}: ${JSON.stringify(a.motivos)}`)
      assert.ok(a.avisosVermelhos.includes(a.motivos[0]), `${nome}: ${JSON.stringify(a.avisosVermelhos)}`)
    }
    assert.equal(r.estatisticas.recomendadas, 0, nome)
  }
  // sem "sair agora" a mesma passagem com 45 L fica de fora (excluída), como sempre
  let cands = []
  await calcular(entrada({ instrumentos: { posicao: ALGES, socPct: 90, gasoleoL: 45 }, tripulacao: 'acompanhado' }), deps({ aoCandidatos: l => { cands = l } }))
  const agora = cands.filter(k => k.partida === AGORA)
  assert.ok(agora.length > 0 && agora.every(k => k.excluida && !k.excluidaSemSairAgora), JSON.stringify(agora.map(k => [k.id, k.excluida, k.motivos])))
})

test('I-16: a tendência do barómetro dos instrumentos vai para o modelo do vento; a AI do vento só até 12 h de previsão, e a nota do resultado di-lo', async () => {
  const mod = require('signalk-arlequin-ia/lib/modelos')
  const fixa = (v) => ({ feature_names: [], tree_info: [{ tree_structure: { leaf_value: v } }] })
  const modelos = { ventoForca: { quantis: { p10: fixa(0.9), p50: fixa(1), p90: fixa(1.1) } } }
  const orig = mod.preverVento
  const vistos = []
  mod.preverVento = (mF, mD, x, ...r) => { vistos.push(x); return orig(mF, mD, x, ...r) }
  let r
  try {
    r = await calcular(entrada({ instrumentos: { posicao: ALGES, socPct: 90, gasoleoL: 124, tendPressao3h: -2.5 }, sairAgora: true }), deps({ modelos }))
  } finally { mod.preverVento = orig }
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(vistos.length > 0)
  assert.ok(vistos.every(x => x.tendPressao3h === -2.5), 'a tendência dos instrumentos chega ao modelo')
  assert.ok(vistos.every(x => x.idadePrevH <= 12), JSON.stringify(vistos.map(x => x.idadePrevH).filter(x => x > 12).slice(0, 3)))
  // a passagem de 15 h com a previsão obtida às 14:00 passa das 12 h: a nota di-lo
  assert.equal(r.ia.nota, 'AI em uso, sem alguns modelos: velocidade pela polar, direção prevista tal e qual, gasóleo pela curva da Volvo; além de 12 h de previsão, vento previsto ±10% e direção prevista tal e qual (a AI do vento só aprendeu com previsões de 0–12 h)')
  // sem modelos do vento, a nota de sempre
  assert.equal((await correr('agora', entrada({ sairAgora: true }), deps())).ia.nota, 'AI: a aprender (polar, previsão ±10% e curva da Volvo)')
})

test('I-19 (decisão do Ivo n.º 5): as passagens longas calculam-se até ao fim da previsão (48 h, não 30 h): Peniche → Sines, → Lagos e Leixões → Peniche', async () => {
  const { HORAS_PREVISAO } = require('../lib/previsao')
  const passagem = require('../lib/passagem')
  assert.equal(HORAS_PREVISAO, 48)
  assert.equal(passagem.PADRAO.maxHoras, HORAS_PREVISAO)
  // a sonda do auditor ("Sair agora", acompanhado): todas davam "Nenhuma das N passagens … dentro de 30 h"
  let maisDe30 = false
  for (const [de0, para] of [['peniche', 'sines'], ['peniche', 'lagos'], ['leixoes', 'peniche']]) {
    const r = await calcular(entrada({ instrumentos: { posicao: de(de0), socPct: 90, gasoleoL: 200 }, destino: para, tripulacao: 'acompanhado', sairAgora: true }), deps())
    assert.equal(r.erro, undefined, `${de0} → ${para}: ${r.erro}`)
    assert.ok(r.alternativas.length >= 1, `${de0} → ${para}`)
    if (r.alternativas.some(a => a.horas.total > 30)) maisDe30 = true
  }
  assert.ok(maisDe30, 'alguma passagem passa das 30 h')
  // sem "sair agora" simula-se só até ao fim da previsão: com a previsão a acabar 20 h depois, as
  // partidas que já não chegam antes dele contam como "fora da previsão", nunca como "não chega"
  const curta = { ...P29, fim: AGORA + 20 * H }
  let cands = []
  const r = await calcular(entrada(), comPrevisao(curta, { aoCandidatos: l => { cands = l } }))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.estatisticas.foraDaPrevisao > 0, JSON.stringify(r.estatisticas))
  assert.equal(r.estatisticas.naoChega, 0, JSON.stringify(r.estatisticas))
  assert.ok(cands.length > 0)
  for (const k of cands) assert.ok(Date.parse(k.chegadas.p90) <= curta.fim, k.id)
})

test('M-05: em "Sair agora" sem previsão de rajadas nem de ondas, o custo conta-as como os limites a solo (nunca como zero)', async () => {
  const semNada = mudar(P29, p => { p.rajada = p.rajada.map(() => null); p.ondas = p.ondas.map(() => null) })
  const r = await calcular(entrada({ sairAgora: true, tripulacao: 'acompanhado' }), comPrevisao(semNada))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.alternativas.length > 0)
  for (const a of r.alternativas) {
    assert.equal(a.custo.partes.rajada, 5, a.id) // 0,5 × (30 − 20)
    assert.equal(a.custo.partes.ondas, 2, a.id) // 2 × (3 − 2)
  }
})

test('o cálculo nunca lança: previsão estragada, sem rota ativa, posição null, entrada e dependências em falta', async () => {
  const casos = [
    [entrada(), deps({ obterPrevisao: async () => ({ previsao: { pontos: null } }) })],
    [entrada(), deps({ obterPrevisao: async () => ({ previsao: 'lixo' }) })],
    [entrada(), deps({ obterPrevisao: async () => ({ previsao: { ...P29, pontos: [{ lat: 39, lon: -9.4, t: null }] } }) })],
    [entrada(), deps({ obterPrevisao: async () => ({ previsao: { ...P29, fim: NaN, obtida: 'ontem' } }) })],
    [entrada(), deps({ obterPrevisao: async () => null })],
    [entrada(), deps({ obterPrevisao: () => { throw new Error('síncrono') } })],
    [entrada(), deps({ obterPrevisao: 'não é função' })],
    [entrada({ destino: { rotaAtiva: [] } }), deps()],
    [entrada({ destino: { rotaAtiva: null } }), deps()],
    [entrada({ destino: { rotaAtiva: [[NaN, 1]] } }), deps()],
    [entrada({ destino: null }), deps()],
    [entrada({ instrumentos: { posicao: null } }), deps()],
    [entrada({ instrumentos: null }), deps()],
    [null, deps()],
    [undefined, undefined],
    [entrada(), null]
  ]
  for (const [e, d] of casos) {
    const r = await calcular(e, d)
    assert.ok(r && (typeof r.erro === 'string' || r.veredicto), JSON.stringify(r).slice(0, 200))
  }
  assert.equal((await calcular(entrada({ destino: { rotaAtiva: [] } }), deps())).erro, 'não há rota ativa no OpenCPN')
  assert.equal((await calcular(entrada({ destino: { rotaAtiva: null } }), deps())).erro, 'não há rota ativa no OpenCPN')
  assert.match((await calcular(entrada({ instrumentos: { posicao: null } }), deps())).erro, /^Sem GPS/)
  assert.equal((await calcular(entrada(), deps({ obterPrevisao: async () => ({ previsao: { pontos: null } }) }))).erro, 'Erro interno no cálculo da rota: o pormenor ficou no registo do SignalK.')
})

test('a regra do vento de terra (3 MN) volta a verificar-se à hora a que o barco passa nos rastos simulados, não só à hora estimada a 5 nós', async () => {
  // Nazaré → Figueira a 3 MN, agora (15:32): vento de leste (de terra) até às 23:30 de Lisboa e
  // depois de oeste (do mar). A 5 nós o rotas.js estima o fim da linha antes disso: passa.
  // A motor o barco só chega à Figueira às 00:51 (os 3 rastos) e passa o fim da linha já com o
  // vento do mar: excluída, com o motivo do rotas.js. À vela chega às 23:29 no pior caso e passa
  // a linha antes de rodar: fica. (Revisão final, C1: sem a maré fictícia do Tejo nesta costa as
  // passagens são mais rápidas — antes a motor chegava à 01:25 e o vento rodava às 00:45. Com o
  // vento a rodar entre as 23:05 e as 23:55 de Lisboa o resultado é o mesmo: a meio.)
  const roda = Date.parse('2026-09-29T22:30:00Z')
  const P = mudar(P29, p => { p.twd = p.t.map(t => (t < roda ? 90 : 270)) })
  let cands = []
  const r = await calcular(entrada({ instrumentos: { posicao: de('nazare'), socPct: 90, gasoleoL: 124 }, destino: 'figueira', tripulacao: 'acompanhado' }), comPrevisao(P, { aoCandidatos: l => { cands = l } }))
  assert.equal(r.erro, undefined, r.erro)
  const VENTO_DO_MAR = 'vento do mar em parte da rota: a 3 MN ficava perto de uma costa a sotavento'
  const motor = cands.find(k => k.id === '20260929T1432-3mn-motor')
  const vela = cands.find(k => k.id === '20260929T1432-3mn-vela')
  assert.ok(motor && vela, JSON.stringify(cands.filter(k => k.partida === AGORA).map(k => k.id)))
  assert.equal(motor.excluida, true)
  assert.equal(motor.motivos[0], VENTO_DO_MAR)
  assert.ok(!vela.motivos.includes(VENTO_DO_MAR), JSON.stringify(vela.motivos))
  assert.ok(r.alternativas.every(a => a.id !== motor.id))
})

test('a regra do vento de terra verifica-se nos rastos dos 3 cenários: também no otimista, que pode ser o mais lento', () => {
  // Nazaré → Figueira a 3 MN (a costa a leste): vento de leste (de terra) até rodar para oeste (do mar).
  // O pessimista e o provável passam antes de rodar; o otimista (menos vento, mais motor: Peniche →
  // Cascais, 29/09, chega depois do pessimista) passa já com o vento do mar.
  const alt = rotas.gerarRota(costa, { partida: costa.destinos.find(d => d.id === 'nazare'), destino: costa.destinos.find(d => d.id === 'figueira'), afastamento: 3, twd: 90 })
  assert.equal(alt.excluida, false, alt.motivo)
  const roda = AGORA + 10 * H
  const ctx = { costa, twd: (lat, lon, t) => (t < roda ? 90 : 270) }
  const rasto = (atraso) => ({ pontos: alt.pontos.map((q, i) => ({ lat: q.lat, lon: q.lon, t: AGORA + atraso + i * 60000 })) })
  const cedo = rasto(0)
  const VENTO_DO_MAR = 'vento do mar em parte da rota: a 3 MN ficava perto de uma costa a sotavento'
  assert.equal(ventoDoMarNosRastos(ctx, alt, { pessimista: cedo, provavel: cedo, otimista: cedo }), null)
  assert.equal(ventoDoMarNosRastos(ctx, alt, { pessimista: cedo, provavel: cedo, otimista: rasto(12 * H) }), VENTO_DO_MAR)
})

test('chegada { p10, p50, p90 } por ordem de hora: Peniche → Cascais, onde o otimista (menos vento, mais motor) chega depois do pessimista', async () => {
  let cands = []
  const r = await calcular(entrada({ instrumentos: { posicao: de('peniche'), socPct: 90, gasoleoL: 124 }, destino: 'cascais' }), deps({ aoCandidatos: l => { cands = l } }))
  assert.equal(r.erro, undefined, r.erro)
  // o caso invertido existe: um candidato cujo otimista chega depois do pessimista
  assert.ok(cands.some(k => Date.parse(k.resumos.otimista.chegada) > Date.parse(k.resumos.pessimista.chegada)))
  for (const a of r.alternativas) {
    const k = cands.find(x => x.id === a.id)
    const t = ['otimista', 'provavel', 'pessimista'].map(n => Date.parse(k.resumos[n].chegada))
    assert.ok(Date.parse(a.chegada.p10) <= Date.parse(a.chegada.p50) && Date.parse(a.chegada.p50) <= Date.parse(a.chegada.p90), `${a.id} ${JSON.stringify(a.chegada)}`)
    assert.equal(Date.parse(a.chegada.p10), Math.min(...t))
    assert.equal(Date.parse(a.chegada.p50), t[1]) // o provável, que fica sempre entre as duas pontas
    assert.equal(Date.parse(a.chegada.p90), Math.max(...t))
  }
  // o corte do fim da previsão é pela chegada mais tarde dos três cenários
  for (const k of cands) assert.ok(Math.max(...['otimista', 'provavel', 'pessimista'].map(n => Date.parse(k.resumos[n].chegada))) <= P29.fim, k.id)
})

test('"Sair agora" com a previsão a acabar antes da chegada: a passagem fica, com o aviso vermelho (sem "sair agora" continua de fora)', async () => {
  const hm = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const curta = { ...P29, fim: AGORA + 2 * H }
  const r = await calcular(entrada({ sairAgora: true }), comPrevisao(curta))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.alternativas.length >= 1)
  for (const a of r.alternativas) {
    assert.ok(Date.parse(a.chegada.p90) > curta.fim)
    assert.ok(a.avisosVermelhos.includes(`a previsão acaba antes da chegada (${hm(Date.parse(a.chegada.p90))}): o fim da passagem é sem previsão`), JSON.stringify(a.avisosVermelhos))
  }
  // dentro da previsão não há o aviso
  const dentro = await correr('agora', entrada({ sairAgora: true }), deps())
  for (const a of dentro.alternativas) assert.ok(!a.avisosVermelhos.some(x => /^a previsão acaba/.test(x)))
  // sem "sair agora": as passagens que acabam depois da previsão ficam de fora (o erro explica)
  assert.match((await calcular(entrada(), comPrevisao(curta))).erro, /^A previsão acaba às 17:32/)
})

test('o cálculo cede o event loop entre partidas e na desistência, e acaba', async () => {
  let voltas = 0
  let acabou = false
  const contar = () => { voltas++; if (!acabou) setImmediate(contar) }
  setImmediate(contar)
  const r = await calcular(entrada(), deps())
  acabou = true
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.desistencia.length >= 10)
  assert.ok(voltas >= r.estatisticas.partidas + r.desistencia.length, `${voltas} voltas do event loop (${r.estatisticas.partidas} partidas, ${r.desistencia.length} pontos de desistência)`)
})

test('sem simulações repetidas: 3 cenários por candidato e só o provável outra vez para cada uma das 3 melhores (a 1.ª também serve a desistência)', async () => {
  const passagem = require('../lib/passagem')
  const orig = passagem.simularPassagem
  let n = 0
  // as da desistência (a hora de chegada a motor a cada abrigo) têm maxHoras 24: não contam
  passagem.simularPassagem = (a) => { if (a.opcoes?.maxHoras !== 24) n++; return orig(a) }
  let r
  try { r = await calcular(entrada(), deps()) } finally { passagem.simularPassagem = orig }
  assert.equal(r.erro, undefined, r.erro)
  assert.equal(n, 3 * r.estatisticas.simuladas + r.alternativas.length)
})

test('sem nenhuma passagem: a mensagem diz a causa verdadeira (previsão curta, não chega, ou as duas)', async () => {
  // só "não chega" (2 h de simulação para Algés → Peniche): não é a previsão
  const nc = await calcular(entrada(), deps({ opcoes: { passagem: { maxHoras: 2 } } }))
  assert.match(nc.erro, /^Nenhuma das \d+ passagens simuladas chega a Peniche dentro de 2 h\.$/)
  // as duas: as partidas cedo não chegam em 15 h, as que chegam acabam depois da previsão
  // (revisão final, C1: sem a maré fictícia do Tejo à chegada a Peniche as passagens são ~0,3 h
  // mais rápidas; era 15,5 h e o fim às 21:32)
  const P = { ...P29, fim: AGORA + 29.5 * H }
  const as2 = await calcular(entrada(), comPrevisao(P, { opcoes: { passagem: { maxHoras: 15 } } }))
  assert.match(as2.erro, /^Nenhuma passagem até Peniche: \d+ acabam depois do fim da previsão \(amanhã às 21:02\) e \d+ não chegam dentro de 15 h\.$/)
  // só a previsão curta: a mensagem de sempre
  const curta = { ...P29, fim: AGORA + 2 * H }
  assert.equal((await calcular(entrada(), comPrevisao(curta))).erro, 'A previsão acaba às 17:32: não cobre nenhuma passagem até Peniche.')
})

test('um progresso ou aoCandidatos assíncrono que rejeita não derruba o processo (nem o cálculo)', async () => {
  const rejeicoes = []
  const apanhar = (e) => rejeicoes.push(e)
  process.on('unhandledRejection', apanhar)
  try {
    const r = await calcular(entrada({ sairAgora: true }), deps({ progresso: async () => { throw new Error('progresso') }, aoCandidatos: async () => { throw new Error('candidatos') } }))
    assert.equal(r.erro, undefined, r.erro)
    assert.ok(r.veredicto)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(rejeicoes.map(e => e.message), [])
  } finally { process.off('unhandledRejection', apanhar) }
})

test('no mar, sem "sair agora": continuar agora não é recomendado e o abrigo mais perto é → "Volta ou abriga-te em Cascais"', async () => {
  // ao largo de Cascais (a mais de 0,5 MN de qualquer porto), a caminho de Peniche, só eu, 15:32 de 29/09
  const r = await calcular(entrada({ instrumentos: { posicao: { lat: 38.66, lon: -9.47 }, socPct: 90, gasoleoL: 124 } }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.equal(r.partida.emMar, true)
  assert.equal(r.veredicto.tipo, 'volta')
  assert.equal(r.veredicto.texto, 'Volta ou abriga-te em Cascais')
  assert.match(r.veredicto.porque[0], /^Agora: /)
  assert.match(r.veredicto.porque[1], /^Até Cascais são \d+,\d MN: chegas às \d\d:\d\d \(de (dia|noite)\)/)
})

test('M-14 (decisão do Ivo n.º 9): no mar, o abrigo do "Volta" avalia todas as rotas do cálculo até ele (os 3 afastamentos, a direta e o canal) e as duas propulsões, e fica a melhor recomendada', async () => {
  // ao largo de Cascais, a caminho de Peniche, só eu, 15:32 de 29/09 (o caso do "Volta" acima)
  let info = null
  const pedidas = []
  const orig = rotas.gerarAlternativas
  rotas.gerarAlternativas = (k, x) => { if (x.destino?.id === 'cascais') pedidas.push([x.afastamento, x.horaPartida]); return orig(k, x) }
  let r
  try {
    r = await calcular(entrada({ instrumentos: { posicao: { lat: 38.66, lon: -9.47 }, socPct: 90, gasoleoL: 124 } }), deps({ aoAbrigo: (x) => { info = x } }))
  } finally { rotas.gerarAlternativas = orig }
  assert.equal(r.erro, undefined, r.erro)
  // o veredicto fala da melhor recomendada até ao abrigo: só a motor (era a 1.ª que se simulava, a de 5 MN à vela, às 18:10)
  assert.equal(r.veredicto.tipo, 'volta')
  assert.equal(r.veredicto.texto, 'Volta ou abriga-te em Cascais')
  assert.equal(r.veredicto.porque[1], 'Até Cascais são 10,3 MN: chegas às 17:52 (de dia), vento até 12 nós, ondas até 2,1 m.')
  assert.ok(info, 'o abrigo avaliado chega ao aoAbrigo')
  assert.equal(info.destino.id, 'cascais')
  // as rotas do cálculo até ao abrigo (gerarAlternativas: as linhas, a direta e o canal) nos 3 afastamentos, a partir agora
  assert.deepEqual(pedidas, [[3, AGORA], [5, AGORA], [8, AGORA]])
  // cada uma à vela e só a motor (era só "vela e motor" a 5 e 8 MN)
  assert.deepEqual([...new Set(info.candidatos.map(k => k.propulsao))].sort(), ['motor', 'vela'])
  assert.ok(info.candidatos.every(k => k.partida === AGORA))
  // fica a melhor recomendada, pelo custo
  const recomendadas = info.candidatos.filter(k => decisao.recomendada(k, 'so')).sort((a, b) => a.custo.total - b.custo.total)
  assert.ok(recomendadas.length > 1, JSON.stringify(info.candidatos.map(k => k.id)))
  assert.equal(info.escolhido, recomendadas[0])
  assert.equal(info.escolhido.id, '20260929T1432-5mn-motor')
})

test('M-14 (decisão do Ivo n.º 9): no mar, o abrigo é o mais perto pelo porto (não pelo largo, que Cascais, Oeiras e Algés partilham) e pode ser o próprio destino', async () => {
  const noite = Date.parse('2026-09-29T21:00:00Z') // 22:00 em Lisboa
  const perto = { lat: 38.665, lon: -9.33 } // a 0,9 MN do porto de Oeiras, a 5 MN de Cascais
  // a caminho de Peniche: o abrigo mais perto é Oeiras (era Cascais, o 1.º da lista com o mesmo largo),
  // com a rota direta (o salto curto até ao porto) entre as avaliadas
  let info = null
  await calcular(entrada({ instrumentos: { posicao: perto, socPct: 90, gasoleoL: 124 }, agora: noite }), deps({ aoAbrigo: (x) => { info = x } }))
  assert.ok(info, 'o abrigo avaliado chega ao aoAbrigo')
  assert.equal(info.destino.id, 'oeiras')
  assert.ok(info.candidatos.some(k => k.direto), JSON.stringify(info.candidatos.map(k => k.id)))
  // a caminho de Oeiras, o abrigo mais perto é o destino: é ele (era o seguinte da lista), com as partidas de agora dele
  info = null
  const r = await calcular(entrada({ instrumentos: { posicao: perto, socPct: 90, gasoleoL: 124 }, destino: 'oeiras', agora: noite }), deps({ aoAbrigo: (x) => { info = x } }))
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(info, 'o abrigo avaliado chega ao aoAbrigo')
  assert.equal(info.destino.id, 'oeiras')
  assert.ok(info.candidatos.length > 0 && info.candidatos.every(k => k.partida === noite), JSON.stringify(info.candidatos.map(k => k.id)))
  // de noite, sozinho, num porto que não conheces: nem continuar nem o abrigo (o mesmo porto) são recomendados — nunca "Volta" para outro
  assert.equal(decisao.recomendada(info.escolhido, 'so'), false)
  assert.notEqual(r.veredicto.tipo, 'volta')
  // ao largo de Cascais a caminho de Cascais: o abrigo é Cascais (era Oeiras)
  info = null
  await calcular(entrada({ instrumentos: { posicao: { lat: 38.66, lon: -9.47 }, socPct: 90, gasoleoL: 124 }, destino: 'cascais' }), deps({ aoAbrigo: (x) => { info = x } }))
  assert.ok(info, 'o abrigo avaliado chega ao aoAbrigo')
  assert.equal(info.destino.id, 'cascais')
})

test('I1: a segurança recebe os 3 rastos (também o otimista) e a "chegada de noite" da alternativa é a da segurança, não só a do provável', async () => {
  const seguranca = require('../lib/seguranca')
  const orig = seguranca.avaliar
  const vistos = []
  // a segurança diz "chegada de noite" (como se só o otimista chegasse de noite)
  seguranca.avaliar = (a) => { vistos.push(a); return { ...orig(a), chegadaNoite: true } }
  let r
  let cands = []
  try { r = await calcular(entrada({ tripulacao: 'acompanhado', sairAgora: true }), deps({ aoCandidatos: l => { cands = l } })) } finally { seguranca.avaliar = orig }
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(vistos.length > 0)
  for (const a of vistos) {
    assert.ok(a.otimista && Array.isArray(a.otimista.pontos) && a.otimista.resumo, 'otimista')
    assert.notEqual(a.otimista, a.pessimista)
  }
  assert.ok(cands.length > 0)
  for (const k of cands) assert.equal(k.chegadaNoite, true, k.id)
  for (const a of r.alternativas) assert.equal(a.chegadaNoite, true, a.id)
})

test('M4: em "Sair agora" o resumo da desistência (calculado para a 1.ª alternativa) só vai nas precauções da 1.ª; as outras dizem para qual foi calculado', async () => {
  const r = await correr('agora', entrada({ sairAgora: true }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.alternativas.length >= 2, String(r.alternativas.length))
  assert.ok(r.desistenciaResumo)
  const texto = (a) => a.precaucoes.find(p => p.id === 'desistencia').texto
  assert.equal(texto(r.alternativas[0]), `Pontos de desistência revistos: ${r.desistenciaResumo}`)
  for (const a of r.alternativas.slice(1)) assert.equal(texto(a), 'Pontos de desistência revistos (calculados para a 1.ª alternativa)', a.id)
})

test('I3 (regressão): um destino { lat, lon, nome } (o /calcular por coordenadas, porConfirmar) dá alternativas, nenhuma "entrada mal definida"', async () => {
  const r = await calcular(entrada({ destino: { lat: 38.4512, lon: -8.95, nome: 'Fundeadouro' }, tripulacao: 'acompanhado', sairAgora: true }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.ok(r.alternativas.length > 0, JSON.stringify(r.veredicto))
  assert.ok(!JSON.stringify(r).includes('entrada mal definida'), JSON.stringify(r.veredicto))
})

test('decisão 6 (Ivo): no mar, o Recalcular com "sair agora" (só a partida imediata) mantém "Volta ou abriga-te em X" e os pontos de desistência', async () => {
  const r = await calcular(entrada({ instrumentos: { posicao: { lat: 38.66, lon: -9.47 }, socPct: 90, gasoleoL: 124 }, sairAgora: true }), deps())
  assert.equal(r.erro, undefined, r.erro)
  assert.equal(r.partida.emMar, true)
  assert.equal(r.veredicto.tipo, 'volta')
  assert.equal(r.veredicto.texto, 'Volta ou abriga-te em Cascais')
  assert.match(r.veredicto.porque[1], /^Até Cascais são \d+,\d MN: /)
  // só a partida imediata (nada de "partida amanhã às 06:00" a meio da viagem)
  assert.ok(r.alternativas.length > 0)
  for (const a of r.alternativas) assert.equal(Date.parse(a.partida), AGORA)
  assert.ok(r.desistencia.length > 0)
})

test('Tarefa 8.5: o rasto provável leva a direção do vento previsto (twd, graus) e a visibilidade (vis, m) quando a previsão a tem (para os lembretes de rotação do vento e de chuva a navegar)', async () => {
  const r = await correr('so', entrada(), deps())
  const temVis = P29.pontos.some(p => (p.visibilidade || []).some(Number.isFinite))
  for (const a of r.alternativas) {
    for (const p of a.rasto) {
      assert.ok(Number.isInteger(p.twd) && p.twd >= 0 && p.twd < 360, JSON.stringify(p))
      // revisão final I4: o vento previsto em nós (a rotação do vento só com 6 nós ou mais)
      assert.ok(Number.isFinite(p.tws) && p.tws >= 0 && Math.round(p.tws * 10) === p.tws * 10, JSON.stringify(p))
      if (temVis) assert.ok(Number.isFinite(p.vis) && p.vis >= 0, JSON.stringify(p))
    }
  }
  assert.ok(temVis, 'a previsão de 29/09 tem a visibilidade')
})
