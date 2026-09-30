'use strict'
// O cálculo da melhor rota, do princípio ao fim (desenho 3a):
//   instrumentos + destino + tripulação (+ "sair agora") → previsão → maré → cenários →
//   partidas × afastamentos × propulsão, cada uma nos 3 cenários → segurança → custo →
//   3 melhores e veredicto → avisos, precauções e pontos de desistência → `resultado`.
//
// calcular(entrada, deps) é assíncrona e NUNCA lança: um erro dá { erro: 'mensagem' }.
// Entre partidas cede o event loop (setImmediate), para o SignalK não parar, e chama
// deps.progresso(fração 0–1, texto).
//
// entrada: {
//   instrumentos: { posicao: { lat, lon }, socPct?, gasoleoL?, tendPressao3h? },
//   destino: 'id' | { lat, lon, nome? } | { rotaAtiva: [[lat, lon] | { lat, lon }, …] },
//   tripulacao: 'so' | 'acompanhado', sairAgora: bool, agora: ms }
// deps: {
//   costa (lib/costa.js), polar (lib/base.js), modelos: { velocidade, ventoForca, ventoDirecao, consumo },
//   versoes: { nome: 'v0001' | null },
//   obterPrevisao: async ({ pontos, desde, ate, agora }) → { previsao, obtida, idadeH, aviso, texto } | { erro },
//   opcoes: ver PADRAO, progresso(f, texto), aoCandidatos(lista) (diagnóstico: todos os candidatos avaliados),
//   log(msg, erro)? (o registo dos erros de programação da geometria; no plugin, app.error) }
//
// As alternativas vêm de lib/rotas.js gerarAlternativas (a linha de cada afastamento e as variantes
// por canais, hoje o Canal da Berlenga; a rota direta dos saltos curtos; a saída pelo canal de
// aproximação quando o barco já está nele), com a hora da partida e o vento previsto (P50 corrigido)
// à hora estimada de passagem em cada ponto. A regra do vento de terra (3 MN e a rota direta perto
// da costa) depende da hora da partida: essas geram-se de novo em cada partida. As de 5 e 8 MN
// pela linha não dependem do vento: geram-se uma vez.

const c = require('./costa')
const rotas = require('./rotas')
const prev = require('./previsao')
const mare = require('./mare')
const { simularPassagem, noitePeloSol } = require('./passagem')
const { criarEnergia } = require('./energia')
const { nasceresPores } = require('./sol')
const { criarCenarios, notaIa, NOMES: CENARIOS } = require('./cenarios')
const seguranca = require('./seguranca')
const decisao = require('./decisao')
const { pontosDesistencia } = require('./desistencia')
const avisos = require('./avisos')

const H = 3600000
const MOTIVO_SEM_ROTA_ATIVA = 'não há rota ativa no OpenCPN'
const PADRAO = Object.freeze({
  afastamentoMinimo: 5,
  afastamentos: [3, 5, 8],
  rpmCruzeiro: 2100,
  horasPartidas: 48,
  passoPartidasH: 3,
  energia: {}, // lib/energia.js PADRAO (capacidadeAh, consumoDiaA, …)
  socDesconhecido: 0.8, // sem SoC nos instrumentos
  gasoleoDesconhecidoL: 100, // sem nível do depósito
  passagem: {}, // lib/passagem.js PADRAO (stwMotor, …)
  fuso: 'Europe/Lisbon'
})

const ceder = () => new Promise(resolve => setImmediate(resolve))
const iso = (t) => new Date(t).toISOString()
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null)
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null)

function resolverDestino (costa, destino) {
  if (typeof destino === 'string') {
    const d = costa.destinos.find(x => x.id === destino)
    return d ? { destino: d, aviso: null } : { erro: `destino desconhecido: ${destino}` }
  }
  if (destino && 'rotaAtiva' in destino) {
    if (!Array.isArray(destino.rotaAtiva) || !destino.rotaAtiva.length) return { erro: MOTIVO_SEM_ROTA_ATIVA }
    const r = rotas.destinoDaRotaAtiva(costa, destino.rotaAtiva)
    if (!r) return { erro: MOTIVO_SEM_ROTA_ATIVA }
    if (!r.destino.largo.every(Number.isFinite)) return { erro: 'o fim da rota ativa não tem latitude e longitude válidas' }
    return { destino: r.destino, aviso: r.aviso }
  }
  if (destino && Number.isFinite(destino.lat) && Number.isFinite(destino.lon)) {
    return {
      destino: { id: null, nome: destino.nome || 'Destino', abrigo: false, conhecido: false, largo: [destino.lat, destino.lon], aproximacao: [[destino.lat, destino.lon]], entrada: 0, porConfirmar: true },
      aviso: rotas.AVISO_ROTA_ATIVA
    }
  }
  return { erro: 'falta o destino' }
}

// Simula as 3 passagens (cenários) de uma geometria. prop: 'vela' | 'motor'.
function simular3 (ctx, alt, partida, prop, { guardarPontos = true } = {}) {
  const out = {}
  for (const nome of CENARIOS) {
    const k = ctx.cenarios[nome]
    const opcoes = { ...ctx.o.passagem, rpmCruzeiro: ctx.o.rpmCruzeiro, gasoleoInicial: ctx.gasoleoInicial, fuso: ctx.o.fuso, nomeChegada: ctx.destino.nome }
    if (prop === 'motor') opcoes.limiarVentoMotor = Infinity // só motor
    const r = simularPassagem({
      rota: alt.pontos,
      partida,
      tempo: k.tempo,
      correnteExtra: ctx.correnteExtra,
      velocidadeVela: k.velocidadeVela,
      consumo: k.consumo,
      noite: ctx.noite,
      energia: criarEnergia({ ...ctx.o.energia, socInicial: ctx.soc }),
      opcoes
    })
    out[nome] = guardarPontos ? r : { resumo: r.resumo, pontos: r.pontos }
  }
  return out
}

// O id de uma alternativa: "20260930T0530-5mn-vela", "…-5mn-canal-motor", "…-direto-vela"
// (a rota direta não tem afastamento: nunca "nullmn").
function idAlternativa (partida, alt, prop) {
  const quando = new Date(partida).toISOString().slice(0, 16).replace(/[-:]/g, '')
  const onde = alt.direto || !Number.isFinite(alt.afastamento) ? 'direto' : `${alt.afastamento}mn${alt.canal ? '-canal' : ''}`
  return `${quando}-${onde}-${prop}`
}

// Avalia uma geometria numa partida e propulsão → candidato (sem a linha do tempo, que pesa).
function avaliarCandidato (ctx, alt, partida, prop, costaMinMn) {
  const sims = simular3(ctx, alt, partida, prop)
  const pe = sims.pessimista; const pr = sims.provavel; const ot = sims.otimista
  if (!pe.resumo.chegou || !pr.resumo.chegou || !ot.resumo.chegou) return { foraDaPrevisao: false, naoChega: true }
  if (Date.parse(pe.resumo.chegada) > ctx.previsao.fim) return { foraDaPrevisao: true }
  const seg = seguranca.avaliar({ alternativa: alt, pessimista: pe, provavel: pr, destino: ctx.destino, tripulacao: ctx.tripulacao, sairAgora: ctx.sairAgora, gasoleoInicial: ctx.gasoleoInicial, costaMinMn, opcoes: { afastamentoMinimo: ctx.o.afastamentoMinimo } })
  // sem nível do depósito a regra corre com o valor assumido, mas nunca em silêncio: aviso vermelho
  const avisosVermelhos = ctx.gasoleoAssumido ? [...seg.avisosVermelhos, `gasóleo inicial desconhecido: confirma o depósito (assumi ${ctx.gasoleoInicial} L)`] : seg.avisosVermelhos
  // as horas equivalentes ao leme vêm só de lib/seguranca.js (a mesma regra da calma para o custo e para os limites)
  const lemeEqProvavel = seguranca.horasLemeEquivalentes(pr.pontos)
  const contraVentoH = decisao.horasContraVento(pr.pontos)
  const esperaH = (partida - ctx.agora) / H
  const custo = decisao.custo({ resumo: pr.resumo, esperaH, tripulacao: ctx.tripulacao, lemeEq: lemeEqProvavel, contraVentoH })
  const socMinPe = pe.resumo.socMin
  return {
    id: idAlternativa(partida, alt, prop),
    partida,
    esperaH,
    afastamento: alt.afastamento,
    direto: !!alt.direto,
    canal: alt.canal || null,
    propulsao: prop,
    milhas: alt.milhas,
    geometria: alt,
    excluida: seg.excluida,
    naoRecomendada: seg.naoRecomendada,
    motivos: seg.motivos,
    avisosVermelhos,
    // os avisos que não excluem: os da geometria (lib/rotas.js: salto curto, canal por confirmar,
    // rota ativa) e os da segurança (previsão aproximada ou sem dados em campos não críticos)
    avisosRota: [...(alt.avisos || []), ...seg.avisos],
    costaMinMn: seg.costaMinMn,
    horasLemeEq: { pessimista: seg.horasLemeEq, provavel: lemeEqProvavel },
    contraVentoH,
    chegadaNoite: !!pr.pontos.at(-1)?.noite,
    bateriaMinPct: Number.isFinite(socMinPe) ? socMinPe * 100 : null,
    resumos: { pessimista: pe.resumo, provavel: pr.resumo, otimista: ot.resumo },
    custo
  }
}

// "Amanhã às 06:30, 5 MN, só motor", "Agora, 5 MN pelo Canal da Berlenga, vela e motor",
// "Às 18:30, direta (salto curto), só motor".
const nomeAlternativa = (cand, agora, fuso) => {
  const q = cand.partida === agora ? 'Agora' : decisao.quando(cand.partida, agora, fuso).replace(/^às/, 'Às').replace(/^amanhã/, 'Amanhã').replace(/^dia/, 'Dia')
  const onde = cand.direto || !Number.isFinite(cand.afastamento) ? 'direta (salto curto)' : `${cand.afastamento} MN${cand.canal ? ` pelo ${cand.canal}` : ''}`
  return `${q}, ${onde}, ${cand.propulsao === 'motor' ? 'só motor' : 'vela e motor'}`
}

function eventosComHora (eventos, fuso) {
  const hm = new Intl.DateTimeFormat('pt-PT', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return eventos.map(e => ({ t: iso(e.t), hora: hm.format(e.t), tipo: e.tipo, texto: e.texto }))
}

// O objeto de uma alternativa para o resultado (com a linha do tempo do provável simulada de novo).
function montarAlternativa (ctx, cand, desistenciaResumo) {
  const sims = simular3(ctx, cand.geometria, cand.partida, cand.propulsao)
  const pr = sims.provavel
  const R = cand.resumos
  const alt = {
    id: cand.id,
    nome: nomeAlternativa(cand, ctx.agora, ctx.o.fuso),
    afastamento: cand.afastamento,
    direto: cand.direto,
    canal: cand.canal,
    nota: cand.geometria.nota || null,
    partida: iso(cand.partida),
    esperaH: r2(cand.esperaH),
    propulsao: cand.propulsao,
    chegada: { p10: R.otimista.chegada, p50: R.provavel.chegada, p90: R.pessimista.chegada },
    milhas: r2(cand.milhas),
    milhasSimuladas: r2(R.provavel.milhas),
    horas: { total: r2(R.provavel.duracaoH), vela: r2(R.provavel.horasVela), motor: r2(R.provavel.horasMotor), noite: r2(R.provavel.horasNoite), leme: r2(cand.horasLemeEq.provavel), lemePessimista: r2(cand.horasLemeEq.pessimista) },
    maximos: { vento: r1(R.provavel.ventoMax), rajada: r1(R.provavel.rajadaMax), ondas: r1(Number.isFinite(R.provavel.ondasMax) ? R.provavel.ondasMax : null) },
    maximosPessimista: { vento: r1(R.pessimista.ventoMax), rajada: r1(R.pessimista.rajadaMax), ondas: r1(Number.isFinite(R.pessimista.ondasMax) ? R.pessimista.ondasMax : null) },
    gasoleoL: { p50: r1(R.provavel.gasoleoGasto), p90: r1(R.pessimista.gasoleoGasto) },
    bateriaMin: r1(cand.bateriaMinPct),
    chegadaNoite: cand.chegadaNoite,
    excluida: cand.excluida,
    naoRecomendada: cand.naoRecomendada,
    motivos: cand.motivos,
    avisosVermelhos: cand.avisosVermelhos,
    avisosRota: cand.avisosRota,
    costaMinMn: r2(cand.costaMinMn),
    custo: { total: r2(cand.custo.total), partes: Object.fromEntries(Object.entries(cand.custo.partes).map(([k, v]) => [k, r2(v)])) },
    rota: cand.geometria.pontos.map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]),
    pontosRota: cand.geometria.pontos.map(p => ({ lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5, nome: p.nome ?? null, perna: p.perna ?? null })),
    eventos: eventosComHora(pr.eventos, ctx.o.fuso),
    avisos: avisos.avisosDaPassagem({ passagem: pr, destino: ctx.destino, tripulacao: ctx.tripulacao, opcoes: { fuso: ctx.o.fuso } }),
    precaucoes: avisos.precaucoes({ passagem: pr, tripulacao: ctx.tripulacao, sairAgora: ctx.sairAgora, desistenciaResumo })
  }
  return { alt, sims }
}

async function calcular (entrada, deps) {
  try {
    return await calcularSemRede(entrada, deps)
  } catch (e) {
    return { erro: `erro no cálculo: ${e && e.message ? e.message : String(e)}` }
  }
}

async function calcularSemRede (entrada = {}, deps = {}) {
  const o = { ...PADRAO, ...(deps.opcoes || {}) }
  const progresso = (f, texto) => { try { deps.progresso?.(f, texto) } catch { /* o progresso nunca derruba o cálculo */ } }
  const agora = Number.isFinite(entrada.agora) ? entrada.agora : Date.now()
  const { costa, polar } = deps
  if (!costa) return { erro: 'sem dados da costa' }
  if (!polar) return { erro: 'sem polar' }
  const tripulacao = entrada.tripulacao === 'acompanhado' ? 'acompanhado' : 'so'
  const sairAgora = !!entrada.sairAgora
  const inst = entrada.instrumentos || {}
  const pos = inst.posicao
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return { erro: 'Sem GPS: não sei onde está o barco, por isso não calculo a rota.' }
  const avisosGerais = []

  const rd = resolverDestino(costa, entrada.destino)
  if (rd.erro) return { erro: rd.erro }
  const destino = rd.destino
  if (rd.aviso) avisosGerais.push(rd.aviso)
  const porto = rotas.portoDePartida(costa, pos)
  const emMar = !porto
  if (porto && destino.id && porto.id === destino.id) return { erro: `Já estás em ${destino.nome}.` }
  if (!porto && costa.emTerra(pos)) return { erro: 'A posição do GPS fica em terra e não é nenhum porto da lista: confirma o GPS.' }
  const partidaGeo = porto || { lat: pos.lat, lon: pos.lon, nome: 'Posição atual' }

  // ---------- previsão ----------
  progresso(0.02, 'a obter a previsão')
  const pontosPrev = prev.pontosPrevisao(costa.linha(5), { partida: pos, destino: c.P(destino.largo) })
  let pv
  try {
    pv = await deps.obterPrevisao({ pontos: pontosPrev, desde: agora, ate: agora + 12 * H, agora })
  } catch (e) { pv = { erro: e.message } }
  if (!pv || pv.erro || !pv.previsao) return { erro: `Sem previsão que cubra a rota: ${pv?.erro || 'sem resposta'}. Não calculo sem previsão.` }
  if (pv.aviso && pv.texto) avisosGerais.push(pv.texto)
  const previsao = pv.previsao
  const tempoBruto = prev.criarTempo(previsao)
  const temMar = previsao.pontos.some(p => p.ondas?.some(x => x != null))
  if (!temMar) avisosGerais.push('Sem previsão do mar (ondas e corrente): as ondas ficam desconhecidas, e desconhecido não conta como calmo')

  // maré na barra do Tejo (sem dados do mar: corrente 0, com aviso)
  const nivel = prev.nivelDoMar(previsao)
  const preias = nivel ? mare.preiaMares(nivel.t, nivel.nivel) : []
  let correnteExtra
  if (preias.length) correnteExtra = mare.criarMareTejo(preias)
  else {
    correnteExtra = () => ({ v: 0, dir: 0 })
    avisosGerais.push('Sem dados do mar: a corrente de maré na barra do Tejo fica a 0')
  }

  // noite pelo nascer e pôr do sol calculados (a meio caminho)
  const meio = { lat: (pos.lat + destino.largo[0]) / 2, lon: (pos.lon + destino.largo[1]) / 2 }
  const sol = nasceresPores(meio.lat, meio.lon, agora, Math.max(previsao.fim, agora) + 36 * H)
  const noite = noitePeloSol(sol.nasceres, sol.pores)

  const modelos = deps.modelos || {}
  const obtida = Date.parse(pv.obtida || previsao.obtida)
  const cenarios = criarCenarios({ tempoBruto, modelos, polar, obtida, tendPressao3h: Number.isFinite(inst.tendPressao3h) ? inst.tendPressao3h : null })

  let soc = Number.isFinite(inst.socPct) ? inst.socPct / 100 : null
  if (soc == null) { soc = o.socDesconhecido; avisosGerais.push(`Sem estado da bateria: assumi ${Math.round(soc * 100)}%`) }
  let gasoleoInicial = Number.isFinite(inst.gasoleoL) ? inst.gasoleoL : null
  const gasoleoAssumido = gasoleoInicial == null
  if (gasoleoAssumido) { gasoleoInicial = o.gasoleoDesconhecidoL; avisosGerais.push(`Sem nível do gasóleo: assumi ${gasoleoInicial} L`) }

  const ctx = { o, agora, destino, tripulacao, sairAgora, previsao, cenarios, correnteExtra, noite, soc, gasoleoInicial, gasoleoAssumido }
  // o vento previsto (a direção P50 corrigida, a mesma nos três cenários) para a regra do vento de terra
  const twd = (lat, lon, t) => cenarios.provavel.tempo(lat, lon, t).twd
  const log = typeof deps.log === 'function' ? deps.log : undefined

  // ---------- as alternativas ----------
  const horas = decisao.partidas(agora, { sairAgora, horas: o.horasPartidas, passoH: o.passoPartidasH, fim: previsao.fim })
  // As alternativas de um afastamento numa partida (lib/rotas.js gerarAlternativas). As que não
  // dependem do vento (acima dos 3 MN e sem rota direta) ficam guardadas; a distância à costa de
  // cada geometria mede-se uma vez (é a mesma em todas as partidas).
  const fixas = new Map() // afastamento → [alt]
  const distancias = new Map() // geometria → costaMinMn
  const distancia = (alt) => {
    if (alt.excluida) return null
    const k = alt.pontos.map(p => `${p.lat},${p.lon}`).join(';')
    if (!distancias.has(k)) distancias.set(k, seguranca.distanciaRotaCosta(costa, alt.pontos)?.mn ?? null)
    return distancias.get(k)
  }
  const alternativasDe = (d, tp) => {
    if (fixas.has(d)) return fixas.get(d)
    const alts = rotas.gerarAlternativas(costa, { partida: partidaGeo, destino, afastamento: d, twd, horaPartida: tp, log })
    if (d > seguranca.PADRAO.afastamentoVentoTerra && !alts.some(a => a.direto)) fixas.set(d, alts)
    return alts
  }
  const candidatos = []
  const excluidasAgora = []
  const estat = { partidas: horas.length, simuladas: 0, excluidasRota: 0, foraDaPrevisao: 0, naoChega: 0, velaSemVela: 0 }
  for (let k = 0; k < horas.length; k++) {
    const tp = horas[k]
    progresso(0.05 + 0.75 * k / horas.length, `a simular a partida ${decisao.quando(tp, agora, o.fuso)} (${k + 1} de ${horas.length})`)
    await ceder()
    let direta = false // a rota direta é a mesma a qualquer afastamento: só uma vez por partida
    for (const d of o.afastamentos) {
      for (const alt of alternativasDe(d, tp)) {
        if (alt.direto) { if (direta) continue; direta = true }
        if (alt.excluida) {
          estat.excluidasRota++
          if (tp === agora) excluidasAgora.push(alt.motivo)
          continue
        }
        for (const prop of ['vela', 'motor']) {
          estat.simuladas++
          const cand = avaliarCandidato(ctx, alt, tp, prop, distancia(alt))
          if (cand.foraDaPrevisao) { estat.foraDaPrevisao++; continue }
          if (cand.naoChega) { estat.naoChega++; continue }
          // "vela e motor" que nunca chega a pôr as velas (vento fraco em todos os cenários) é a
          // mesma passagem que "só motor": fica só a de motor, para as 3 melhores não se repetirem
          if (prop === 'vela' && CENARIOS.every(n => cand.resumos[n].horasVela === 0)) { estat.velaSemVela++; continue }
          candidatos.push(cand)
        }
      }
    }
  }
  // nenhuma passagem avaliada: por a previsão ser curta (explica-se) ou por todas as rotas serem
  // impossíveis (segue para o veredicto "Não recomendado" com o motivo)
  if (!candidatos.length && (estat.foraDaPrevisao > 0 || !excluidasAgora.length)) {
    return { erro: `A previsão acaba ${decisao.quando(previsao.fim, agora, o.fuso)}: não cobre nenhuma passagem até ${destino.nome}.` }
  }

  try { deps.aoCandidatos?.(candidatos) } catch { /* só para diagnóstico */ }

  // ---------- no mar: o abrigo mais perto (para "Volta ou abriga-te em X") ----------
  let abrigo = null
  if (emMar && !sairAgora) {
    progresso(0.82, 'a ver o abrigo mais perto')
    const perto = costa.destinos.filter(d => d.abrigo && d.id !== destino.id).map(d => ({ d, mn: c.distanciaMn(pos, c.P(d.largo)) })).sort((a, b) => a.mn - b.mn)[0]
    if (perto) {
      const ctxA = { ...ctx, destino: perto.d }
      for (const af of [5, 8]) {
        const alt = rotas.gerarRota(costa, { partida: partidaGeo, destino: perto.d, afastamento: af, twd, horaPartida: agora, log })
        if (alt.excluida) continue
        const cand = avaliarCandidato(ctxA, alt, agora, 'vela', distancia(alt))
        if (cand.resumos) { abrigo = { destino: perto.d, candidato: cand }; break }
      }
    }
  }

  // ---------- decisão ----------
  progresso(0.85, 'a escolher as 3 melhores')
  const { top, veredicto } = decisao.decidir({ candidatos, agora, tripulacao, sairAgora, emMar, abrigo, fuso: o.fuso, excluidasAgora })

  // ---------- desistência (da melhor) e o objeto de cada alternativa ----------
  let desistencia = []
  let desistenciaResumo = null
  let primeira = null
  if (top.length) {
    progresso(0.9, 'pontos de desistência')
    const sims0 = simular3(ctx, top[0].geometria, top[0].partida, top[0].propulsao)
    const etaMotor = (pontosRota, t0) => {
      const r = simularPassagem({
        rota: pontosRota, partida: t0, tempo: cenarios.provavel.tempo, correnteExtra, velocidadeVela: cenarios.provavel.velocidadeVela, consumo: cenarios.provavel.consumo, noite,
        opcoes: { ...o.passagem, rpmCruzeiro: o.rpmCruzeiro, limiarVentoMotor: Infinity, fuso: o.fuso, maxHoras: 24 }
      })
      return r.resumo.chegou ? Date.parse(r.resumo.chegada) : null
    }
    const d = pontosDesistencia({
      costa, rota: top[0].geometria, linhaTempo: sims0.provavel.pontos, partida: porto, destino, eta: etaMotor,
      twd: (lat, lon, t) => cenarios.provavel.tempo(lat, lon, t).twd, opcoes: { fuso: o.fuso }
    })
    desistencia = d.pontos.map(p => ({ ...p, lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, milhas: r1(p.milhas), abrigo: p.abrigo && { ...p.abrigo, milhas: r1(p.abrigo.milhas), rumo: Math.round(p.abrigo.rumo), twa: p.abrigo.twa == null ? null : Math.round(p.abrigo.twa) }, voltar: p.voltar && { ...p.voltar, milhas: r1(p.voltar.milhas), rumo: Math.round(p.voltar.rumo), twa: p.voltar.twa == null ? null : Math.round(p.voltar.twa) } }))
    desistenciaResumo = d.resumo
    primeira = sims0
  }
  progresso(0.95, 'avisos e precauções')
  const alternativas = []
  for (const cand of top) {
    await ceder()
    alternativas.push(montarAlternativa(ctx, cand, desistenciaResumo).alt)
  }
  if (sairAgora && primeira && alternativas[0]?.avisosVermelhos?.length) avisosGerais.push(...alternativas[0].avisosVermelhos)

  const versoes = deps.versoes || {}
  const resultado = {
    calculadoEm: iso(agora),
    destino: { id: destino.id, nome: destino.nome, conhecido: destino.conhecido, abrigo: destino.abrigo, confirmado: !!destino.confirmado },
    partida: porto ? { id: porto.id, nome: porto.nome, emMar: false } : { nome: 'Posição atual', lat: pos.lat, lon: pos.lon, emMar: true },
    tripulacao,
    sairAgora,
    veredicto,
    alternativas,
    desistencia,
    desistenciaResumo,
    previsao: { obtida: pv.obtida || previsao.obtida, idadeH: r2(Number.isFinite(pv.idadeH) ? pv.idadeH : (agora - Date.parse(previsao.obtida)) / H), aviso: pv.aviso || null, fim: iso(previsao.fim) },
    ia: { versoes, nota: notaIa(modelos) },
    avisos: avisosGerais,
    estatisticas: { ...estat, candidatos: candidatos.length, recomendadas: candidatos.filter(x => decisao.recomendada(x, tripulacao)).length }
  }
  progresso(1, 'pronto')
  return resultado
}

module.exports = { PADRAO, calcular, resolverDestino }
