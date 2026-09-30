'use strict'
// As regras de segurança (desenho 3a, "Segurança"). Regras fixas: a AI não as muda.
//
// Excluída sempre:
//   - um troço em terra, numa zona a evitar ou no separador de tráfego (lib/rotas.js já
//     as marca `excluida` com o motivo);
//   - mais perto da costa do que o afastamento mínimo (5 MN, configurável) fora das
//     aproximações. MEDE-SE A GEOMETRIA DA ROTA (os troços da linha, `costaLivre` falso),
//     e não o rasto simulado: o rasto tem os bordos e as cambadelas no corredor de ±0,7 MN,
//     e isso é o barco a navegar, não a rota que se escolhe (ronda B, ponto 4).
//     A rota de 3 MN é a exceção do desenho ("3 MN só com vento de terra", que o rotas.js
//     já só gera com vento de terra): para ela o mínimo é 3 MN. Tolerância de 0,1 MN
//     (as linhas estão a d ± 0,05 MN da terra; nos dados reais até 0,055 MN por dentro).
//     A rota direta (salto curto, `direto`, afastamento null) não tem linha: não se lhe aplica
//     este mínimo (o rotas.js já só a deixa perto de terra com vento de terra) e a distância
//     que fica é a real, costaMinMn do rotas.js.
// Excluída sempre, numa variante por um canal com `ondasMax` (lib/rotas.js: o Canal da Berlenga,
//   decisão do Ivo de 30/09, só com ondas < 3 m): a onda máxima do cenário pessimista nos troços
//   do canal (perna 'canal' e as ligações que chegam a ele e saem dele) ≥ ondasMax. Contam os
//   pontos do rasto a ≤ corredorCanalMn desses troços (o corredor dos bordos é de 0,7 MN); um rasto
//   sem posições (ou sem nenhum ponto perto) conta a rota toda. Sem ondas previstas num desses
//   pontos é "desconhecido", nunca calmo: também excluída.
// Excluída, ou aviso vermelho em "Sair agora mesmo assim": gasóleo < 40 L ou bateria < 50%
//   à chegada, no cenário pessimista.
// "Não recomendada sozinho" (só com tripulação "so"), no cenário pessimista:
//   - vento médio > 22 nós, rajadas > 30 ou ondas > 3 m;
//   - mais de 8 h equivalentes ao leme: todas as horas contam, à vela e a motor, e o motor
//     em calma (vento < 10 nós e ondas < 1,5 m) conta metade. Sem ondas previstas (sem
//     dados do mar) nunca é calma;
//   - chegada de noite a um porto com `conhecido: false`. Conta a chegada de noite no
//     cenário pessimista OU no provável (a chegada mais provável de noite também conta).

const c = require('./costa')

const PADRAO = Object.freeze({
  afastamentoMinimo: 5,
  toleranciaMn: 0.1,
  passoAmostraMn: 0.25,
  afastamentoVentoTerra: 3,
  gasoleoMinL: 40,
  bateriaMinPct: 50,
  ventoMedioMax: 22,
  rajadaMax: 30,
  ondasMax: 3,
  lemeMaxH: 8,
  corredorCanalMn: 1,
  calmaVento: 10,
  calmaOndas: 1.5
})

const virgula = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',')
const inteiro = (x) => String(Math.round(x))
const metros = (x) => (Number.isInteger(x) ? String(x) : virgula(x))

// Horas equivalentes ao leme numa linha do tempo de 1 min (lib/passagem.js).
function horasLemeEquivalentes (pontos, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  let min = 0
  for (const p of pontos) {
    const calma = p.motor && p.tws < o.calmaVento && p.ondas != null && p.ondas < o.calmaOndas
    min += calma ? 0.5 : 1
  }
  return min / 60
}

// A menor distância à terra da geometria da rota, só nos troços fora das aproximações
// (os que chegam a um ponto com costaLivre falso: a linha). → { mn, lat, lon } | null.
function distanciaRotaCosta (costa, pontos, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  let melhor = null
  for (let i = 1; i < pontos.length; i++) {
    if (pontos[i].costaLivre) continue
    const a = pontos[i - 1]; const b = pontos[i]
    const dLat = b.lat - a.lat; const dLon = b.lon - a.lon
    const mnAprox = Math.hypot(dLat * 60, dLon * 60 * Math.cos(a.lat * Math.PI / 180))
    const n = Math.max(1, Math.ceil(mnAprox / o.passoAmostraMn))
    for (let k = 0; k <= n; k++) {
      const p = { lat: a.lat + dLat * k / n, lon: a.lon + dLon * k / n }
      const d = costa.distanciaTerra(p, 30)
      if (!melhor || d < melhor.mn) melhor = { mn: d, lat: p.lat, lon: p.lon }
    }
  }
  return melhor
}

// Os troços do canal de uma variante (lib/rotas.js): os que chegam a um ponto 'canal', a ligação
// que chega ao primeiro e a que sai do último. → [[a, b], …]
function trocosCanal (pontos) {
  const out = []
  for (let i = 1; i < pontos.length; i++) {
    const noCanal = pontos[i].perna === 'canal'
    const entra = pontos[i].perna === 'ligacao' && pontos[i + 1]?.perna === 'canal'
    const sai = pontos[i - 1].perna === 'canal' && !noCanal
    if (noCanal || entra || sai) out.push([pontos[i - 1], pontos[i]])
  }
  return out
}

// A onda máxima do rasto (pontos de lib/passagem.js) nos troços do canal da alternativa.
// → { max (m | null), semOndas (algum ponto sem ondas previstas), isolado (false: a rota toda) }
function ondasNoCanal (alternativa, rasto, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const trocos = trocosCanal(alternativa.pontos || [])
  const comPos = rasto.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  const perto = trocos.length ? comPos.filter(p => trocos.some(([a, b]) => c.distanciaSegmento(p, a, b).mn <= o.corredorCanalMn)) : []
  const isolado = perto.length > 0
  const usar = isolado ? perto : rasto
  let max = null
  let semOndas = usar.length === 0
  for (const p of usar) {
    if (Number.isFinite(p.ondas)) max = max == null ? p.ondas : Math.max(max, p.ondas)
    else semOndas = true
  }
  return { max, semOndas, isolado }
}

// O mínimo à costa que se aplica a uma alternativa. Sem afastamento (null: nunca devia chegar
// aqui fora de uma rota direta), o mínimo por omissão — nunca 0 por coerção de null.
function minimoCosta (afastamento, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  if (!Number.isFinite(afastamento)) return o.afastamentoMinimo
  return afastamento <= o.afastamentoVentoTerra ? Math.min(afastamento, o.afastamentoMinimo) : o.afastamentoMinimo
}

// Avalia uma alternativa.
//   alternativa: a de lib/rotas.js ({ afastamento, pontos, excluida, motivo? })
//   pessimista, provavel: { resumo, pontos } de simularPassagem (o provável só para a chegada de noite)
//   destino: { nome, conhecido }; tripulacao: 'so' | 'acompanhado'; sairAgora: bool
//   gasoleoInicial (L); costa (para a distância à terra; opcional se costaMinMn vier dado)
//   costaMinMn: a distância já medida (a geometria de 5 e 8 MN é a mesma em todas as partidas)
// → { excluida, naoRecomendada, motivos[], avisosVermelhos[], horasLemeEq, costaMinMn, chegadaNoite }
function avaliar ({ alternativa, pessimista, provavel, destino, tripulacao, sairAgora = false, gasoleoInicial, costa, costaMinMn, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const out = { excluida: false, naoRecomendada: false, motivos: [], avisosVermelhos: [], horasLemeEq: null, costaMinMn: null, chegadaNoite: false }
  if (alternativa.excluida) {
    out.excluida = true
    out.motivos.push(alternativa.motivo || 'rota impossível')
    return out
  }
  if (alternativa.direto) {
    // rota direta (salto curto, lib/rotas.js): afastamento null e sem linha; a distância é a real
    // à terra (costaMinMn do rotas.js), e o rotas.js já só a deixa a < 3 MN com vento de terra
    out.costaMinMn = Number.isFinite(alternativa.costaMinMn) ? alternativa.costaMinMn : (Number.isFinite(costaMinMn) ? costaMinMn : null)
  } else {
    const minimo = minimoCosta(alternativa.afastamento, o)
    const dCosta = costaMinMn !== undefined ? costaMinMn : distanciaRotaCosta(costa, alternativa.pontos, o)?.mn ?? null
    out.costaMinMn = dCosta
    if (dCosta != null && dCosta < minimo - o.toleranciaMn) {
      out.excluida = true
      out.motivos.push(`a rota passa a ${virgula(dCosta)} MN da costa (mínimo ${inteiro(minimo)} MN)`)
    }
  }
  if (!pessimista) return out
  const r = pessimista.resumo
  // canal com ondasMax: só com ondas abaixo dele, no pessimista (sempre, sozinho ou acompanhado)
  if (Number.isFinite(alternativa.ondasMax)) {
    const nome = alternativa.canal || 'canal'
    const limite = `só com ondas abaixo de ${metros(alternativa.ondasMax)} m`
    const k = ondasNoCanal(alternativa, pessimista.pontos || [], o)
    if (k.semOndas) {
      out.excluida = true
      out.motivos.push(`${nome}: sem previsão de ondas no canal (desconhecido não conta como calmo; ${limite})`)
    } else if (k.max >= alternativa.ondasMax) {
      out.excluida = true
      out.motivos.push(`${nome}: ondas até ${virgula(k.max)} m no pior caso (${limite})`)
    }
  }
  // gasóleo e bateria à chegada, no pessimista
  const vermelho = []
  if (Number.isFinite(gasoleoInicial)) {
    const fica = gasoleoInicial - r.gasoleoGasto
    if (fica < o.gasoleoMinL) vermelho.push(`chegas com ${inteiro(Math.max(0, fica))} L de gasóleo no pior caso (mínimo ${o.gasoleoMinL} L)`)
  }
  if (Number.isFinite(r.socFinal) && r.socFinal * 100 < o.bateriaMinPct) vermelho.push(`chegas com a bateria a ${inteiro(r.socFinal * 100)}% no pior caso (mínimo ${o.bateriaMinPct}%)`)
  if (vermelho.length) {
    if (sairAgora) out.avisosVermelhos.push(...vermelho)
    else { out.excluida = true; out.motivos.push(...vermelho) }
  }
  out.horasLemeEq = horasLemeEquivalentes(pessimista.pontos, o)
  const ultimoPe = pessimista.pontos.at(-1)
  const ultimoPr = provavel?.pontos?.at(-1)
  out.chegadaNoite = !!(ultimoPe?.noite || ultimoPr?.noite)
  if (tripulacao === 'so') {
    const nr = []
    if (r.ventoMax > o.ventoMedioMax) nr.push(`vento médio até ${inteiro(r.ventoMax)} nós no pior caso (limite ${o.ventoMedioMax} sozinho)`)
    if (r.rajadaMax > o.rajadaMax) nr.push(`rajadas até ${inteiro(r.rajadaMax)} nós no pior caso (limite ${o.rajadaMax} sozinho)`)
    if (r.ondasMax > o.ondasMax) nr.push(`ondas até ${virgula(r.ondasMax)} m no pior caso (limite ${o.ondasMax} m sozinho)`)
    if (out.horasLemeEq > o.lemeMaxH) nr.push(`${virgula(out.horasLemeEq)} h equivalentes ao leme (limite ${o.lemeMaxH} h sozinho)`)
    if (out.chegadaNoite && destino && destino.conhecido === false) nr.push(`chegada de noite a ${destino.nome}, um porto que não conheces`)
    if (nr.length) { out.naoRecomendada = true; out.motivos.push(...nr) }
  }
  return out
}

module.exports = { PADRAO, horasLemeEquivalentes, distanciaRotaCosta, minimoCosta, trocosCanal, ondasNoCanal, avaliar }
