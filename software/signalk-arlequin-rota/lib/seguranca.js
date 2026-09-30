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
//     que fica é a real, costaMinMn do rotas.js. Fora da rota direta, a distância desconhecida
//     (null: não dada, sem costa, sem troços de linha) exclui: "distância à costa desconhecida".
// Excluída sempre, numa variante por um canal com `ondasMax` (lib/rotas.js: o Canal da Berlenga,
//   decisão do Ivo de 30/09, só com ondas < 3 m): a onda máxima do cenário pessimista nos troços
//   do canal (perna 'canal' e as ligações que chegam a ele e saem dele) ≥ ondasMax. Contam os
//   pontos do rasto a ≤ corredorCanalMn desses troços (o corredor dos bordos é de 0,7 MN); um rasto
//   sem posições (ou sem nenhum ponto perto) conta a rota toda. Sem ondas previstas num desses
//   pontos é "desconhecido", nunca calmo: também excluída.
// Excluída, ou aviso vermelho em "Sair agora mesmo assim" (desenho 3a):
//   - a previsão sem dados (`semDados` de lib/previsao.js, nos pontos do rasto do pessimista ou
//     do provável) de vento, rajada ou ondas em parte da rota — desconhecido não é calmo. Outros
//     campos sem dados, e os `aproximado` (vieram de um ponto de previsão mais longe), só dão um
//     aviso (avisos[]);
//   - gasóleo < 40 L ou bateria < 50% à chegada, no cenário pessimista. O gasóleo inicial ou a
//     bateria à chegada desconhecidos (não números) dão sempre um aviso vermelho, sem excluir.
// "Não recomendada sozinho" (só com tripulação "so"), no cenário pessimista:
//   - vento médio > 22 nós, rajadas > 30 ou ondas > 3 m;
//   - mais de 8 h equivalentes ao leme: todas as horas contam, à vela e a motor, e o motor
//     em calma (vento < 10 nós e ondas < 1,5 m) conta metade. Sem vento ou sem ondas
//     previstos (null) nunca é calma;
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
// Para baixo, para o que fica abaixo de um mínimo (39,6 L nunca diz "40 L"); a folga de 1e-9 só
// tira o erro da vírgula flutuante (0,29 × 100 = 28,999…).
const inteiroAbaixo = (x) => String(Math.floor(x + 1e-9))
const metros = (x) => (Number.isInteger(x) ? String(x) : virgula(x))

// Os campos da previsão (lib/previsao.js) em português, para os motivos e avisos.
const NOMES_CAMPOS = Object.freeze({
  tws: 'vento', rajada: 'rajadas', twd: 'direção do vento', chuva: 'chuva', visibilidade: 'visibilidade', radiacao: 'radiação solar',
  ondas: 'ondas', periodo: 'período das ondas', ondasDir: 'direção das ondas', corrente: 'corrente', correnteDir: 'direção da corrente'
})
// Sem estes, a segurança não sabe o que conta (limites, calma): desconhecido → excluída (ou aviso
// vermelho em "sair agora").
const CAMPOS_CRITICOS = Object.freeze(['tws', 'rajada', 'ondas'])
const lista = (campos) => {
  const n = campos.map(k => NOMES_CAMPOS[k] || k)
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n.at(-1)}` : n[0]
}

// Os campos sem dados e aproximados nos pontos dos rastos dados. → { semDados: Set, aproximado: Set }
function previsaoIncompleta (passagens) {
  const semDados = new Set()
  const aproximado = new Set()
  for (const x of passagens) {
    for (const p of x?.pontos || []) {
      for (const k of p.semDados || []) semDados.add(k)
      for (const k of p.aproximado || []) aproximado.add(k)
    }
  }
  return { semDados, aproximado }
}

// Horas equivalentes ao leme numa linha do tempo de 1 min (lib/passagem.js).
function horasLemeEquivalentes (pontos, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  let min = 0
  for (const p of pontos) {
    // vento ou ondas sem previsão (null) nunca é calma: conta inteiro
    const calma = p.motor && Number.isFinite(p.tws) && p.tws < o.calmaVento && Number.isFinite(p.ondas) && p.ondas < o.calmaOndas
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
  // decisão (desenho 3a): min(afastamento, 5) só na de ≤ 3 MN (vento de terra); todas as outras 5 MN
  return afastamento <= o.afastamentoVentoTerra ? Math.min(afastamento, o.afastamentoMinimo) : o.afastamentoMinimo
}

// Avalia uma alternativa.
//   alternativa: a de lib/rotas.js ({ afastamento, pontos, excluida, motivo? })
//   pessimista, provavel: { resumo, pontos } de simularPassagem (o provável só para a chegada de noite)
//   destino: { nome, conhecido }; tripulacao: 'so' | 'acompanhado'; sairAgora: bool
//   gasoleoInicial (L); costa (para a distância à terra; opcional se costaMinMn vier dado)
//   costaMinMn: a distância já medida (a geometria de 5 e 8 MN é a mesma em todas as partidas)
// → { excluida, naoRecomendada, motivos[], avisosVermelhos[], avisos[], horasLemeEq, costaMinMn, chegadaNoite }
//   (avisos: linhas de aviso que não excluem, ex.: a previsão aproximada)
function avaliar ({ alternativa, pessimista, provavel, destino, tripulacao, sairAgora = false, gasoleoInicial, costa, costaMinMn, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const out = { excluida: false, naoRecomendada: false, motivos: [], avisosVermelhos: [], avisos: [], horasLemeEq: null, costaMinMn: null, chegadaNoite: false }
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
    const medida = costaMinMn !== undefined ? costaMinMn : (costa ? distanciaRotaCosta(costa, alternativa.pontos, o)?.mn : null)
    const dCosta = Number.isFinite(medida) ? medida : null
    out.costaMinMn = dCosta
    if (dCosta == null) {
      // sem distância (não dada, sem costa ou sem troços de linha para medir): desconhecida não
      // passa o mínimo — falha para o lado seguro
      out.excluida = true
      out.motivos.push('distância à costa desconhecida')
    } else if (dCosta < minimo - o.toleranciaMn) {
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
      // exclusão dura também em "sair agora" (decisão): a regra do Ivo é "só com ondas < 3 m", desconhecido ≠ < 3, e há a volta por fora
      out.excluida = true
      out.motivos.push(`${nome}: sem previsão de ondas no canal (desconhecido não conta como calmo; ${limite})`)
    } else if (k.max >= alternativa.ondasMax) {
      out.excluida = true
      out.motivos.push(`${nome}: ondas até ${virgula(k.max)} m no pior caso (${limite})`)
    }
  }
  // previsão incompleta ao longo da rota (a mesma previsão nos dois cenários)
  const inc = previsaoIncompleta([pessimista, provavel])
  const criticos = CAMPOS_CRITICOS.filter(k => inc.semDados.has(k))
  const outros = [...inc.semDados].filter(k => !CAMPOS_CRITICOS.includes(k))
  // excluída, ou aviso vermelho em "sair agora" (como o gasóleo e a bateria)
  const vermelho = []
  if (criticos.length) vermelho.push(`sem previsão de ${lista(criticos)} em parte da rota: desconhecido não conta como calmo`)
  if (outros.length) out.avisos.push(`sem previsão de ${lista(outros)} em parte da rota`)
  if (inc.aproximado.size) out.avisos.push(`previsão de ${lista([...inc.aproximado])} aproximada em parte da rota (de um ponto de previsão mais longe)`)
  // gasóleo e bateria à chegada, no pessimista
  // (desconhecidos: aviso vermelho sempre, que não exclui — o Ivo confirma-os a bordo)
  const desconhecido = []
  const fica = gasoleoInicial - r.gasoleoGasto
  if (!Number.isFinite(gasoleoInicial)) desconhecido.push('gasóleo inicial desconhecido: confirma o depósito')
  else if (!Number.isFinite(fica)) desconhecido.push('gasóleo à chegada desconhecido')
  else if (fica < o.gasoleoMinL) vermelho.push(`chegas com ${inteiroAbaixo(Math.max(0, fica))} L de gasóleo no pior caso (mínimo ${o.gasoleoMinL} L)`)
  if (!Number.isFinite(r.socFinal)) desconhecido.push('bateria à chegada desconhecida')
  else if (r.socFinal * 100 < o.bateriaMinPct) vermelho.push(`chegas com a bateria a ${inteiroAbaixo(Math.max(0, r.socFinal * 100))}% no pior caso (mínimo ${o.bateriaMinPct}%)`)
  if (vermelho.length) {
    if (sairAgora) out.avisosVermelhos.push(...vermelho)
    else { out.excluida = true; out.motivos.push(...vermelho) }
  }
  out.avisosVermelhos.push(...desconhecido)
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

module.exports = { PADRAO, CAMPOS_CRITICOS, horasLemeEquivalentes, distanciaRotaCosta, minimoCosta, trocosCanal, ondasNoCanal, previsaoIncompleta, avaliar }
