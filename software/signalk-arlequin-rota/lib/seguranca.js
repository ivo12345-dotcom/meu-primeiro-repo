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
// OS RASTOS DOS 3 CENÁRIOS (revisão final, I1): as regras do canal, da previsão sem dados, dos
//   limites de vento/rajada/ondas e da chegada de noite avaliam-se no pessimista, no provável E no
//   otimista (o que houver): os cenários não são monótonos na hora (o otimista tem menos vento, vai
//   mais a motor, pode ser o mais lento e apanhar uma frente ou o canal mais tarde). O gasóleo, a
//   bateria e as horas ao leme ficam no pessimista.
// Excluída sempre, numa variante por um canal com `ondasMax` (lib/rotas.js: o Canal da Berlenga,
//   decisão do Ivo de 30/09, só com ondas < 3 m): a onda máxima dos 3 rastos nos troços
//   do canal (perna 'canal' e as ligações que chegam a ele e saem dele) ≥ ondasMax. Contam os
//   pontos do rasto a ≤ corredorCanalMn desses troços (o corredor dos bordos é de 0,7 MN); um rasto
//   sem posições (ou sem nenhum ponto perto) conta a rota toda. Sem ondas previstas num desses
//   pontos é "desconhecido", nunca calmo: também excluída.
// Excluída, ou aviso vermelho em "Sair agora mesmo assim" (desenho 3a):
//   - a previsão sem dados (`semDados` de lib/previsao.js, nos pontos dos 3 rastos) de vento, rajada ou ondas em parte da rota — desconhecido não é calmo. Outros
//     campos sem dados, e os `aproximado` (vieram de um ponto de previsão mais longe), só dão um
//     aviso (avisos[]);
//   - gasóleo < 40 L ou bateria < 50% à chegada, no cenário pessimista. O gasóleo inicial ou a
//     bateria à chegada desconhecidos (não números) dão sempre um aviso vermelho, sem excluir.
// "Não recomendada sozinho" (só com tripulação "so"):
//   - vento médio > 22 nós, rajadas > 30 ou ondas > 3 m (o máximo dos 3 resumos: o vento do
//     pessimista é o P90, e o máximo só acrescenta os momentos que os outros rastos apanham);
//   - mais de 8 h equivalentes ao leme (no pessimista): todas as horas contam, à vela e a motor, e o motor
//     em calma conta metade. Calma (decisão do Ivo, 30/09, ronda C2; emCalma, abaixo):
//     vento < 10 nós E (ondas < 2 m, OU ondas ≤ 3 m com período ≥ 9 s — ondulação comprida,
//     que a roda com travão aguenta). Desconhecido nunca é calma: sem vento ou sem ondas
//     previstos (null) não é calma; acima de 2 m sem período conhecido também não;
//   - chegada de noite a um porto com `conhecido: false`. Conta a chegada de noite em qualquer
//     um dos 3 cenários (pessimista, provável ou otimista).
// "Não recomendada" com tripulação "acompanhado" (decisão do Ivo de 01/10, "limites mais largos";
//   revisão final, I4): vento médio > 28 nós, rajadas > 35 ou ondas > 4 m (o máximo dos 3 resumos,
//   como acima; ventoMaxAcompanhado, rajadaMaxAcompanhado, ondasMaxAcompanhado). Entre os limites
//   de "só eu" e estes: aviso vermelho "acima dos limites a solo: …". As 8 h ao leme e a chegada
//   de noite ficam só para "só eu".

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
  ventoMaxAcompanhado: 28,
  rajadaMaxAcompanhado: 35,
  ondasMaxAcompanhado: 4,
  lemeMaxH: 8,
  corredorCanalMn: 1,
  calmaVento: 10, // nós (menos do que isto)
  calmaOndas: 2, // m (menos do que isto, com qualquer período)
  calmaOndasLongas: 3, // m (até isto, se o período for comprido)
  calmaPeriodo: 9 // s (período mínimo da ondulação comprida)
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

// Um minuto da linha do tempo (lib/passagem.js: { motor, tws, ondas, periodo }) é "motor em calma".
// Desconhecido nunca é calma: vento ou ondas sem previsão (null, undefined, NaN) → não; o período
// só conta entre 2 e 3 m, e aí desconhecido → não (abaixo de 2 m qualquer período serve).
function emCalma (p, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  if (!p || !p.motor || !Number.isFinite(p.tws) || !Number.isFinite(p.ondas)) return false
  if (!(p.tws < o.calmaVento)) return false
  if (p.ondas < o.calmaOndas) return true
  return p.ondas <= o.calmaOndasLongas && Number.isFinite(p.periodo) && p.periodo >= o.calmaPeriodo
}

// Horas equivalentes ao leme numa linha do tempo de 1 min: o motor em calma conta metade.
function horasLemeEquivalentes (pontos, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  let min = 0
  for (const p of pontos) min += emCalma(p, o) ? 0.5 : 1
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
//   pessimista, provavel, otimista: { resumo, pontos } de simularPassagem (o provável e o otimista para o
//     canal, a previsão sem dados, os limites e a chegada de noite; o gasóleo, a bateria e o leme são do pessimista)
//   destino: { nome, conhecido }; tripulacao: 'so' | 'acompanhado'; sairAgora: bool
//   gasoleoInicial (L); costa (para a distância à terra; opcional se costaMinMn vier dado)
//   costaMinMn: a distância já medida (a geometria de 5 e 8 MN é a mesma em todas as partidas)
// → { excluida, naoRecomendada, motivos[], avisosVermelhos[], avisos[], horasLemeEq, costaMinMn, chegadaNoite }
//   (avisos: linhas de aviso que não excluem, ex.: a previsão aproximada)
function avaliar ({ alternativa, pessimista, provavel, otimista, destino, tripulacao, sairAgora = false, gasoleoInicial, costa, costaMinMn, opcoes = {} }) {
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
  // os rastos dos 3 cenários (os que houver): as regras do canal, dos dados, dos limites e da noite
  const rastos = [pessimista, provavel, otimista].filter(x => x && x.resumo)
  // canal com ondasMax: só com ondas abaixo dele, nos 3 rastos (sempre, sozinho ou acompanhado)
  if (Number.isFinite(alternativa.ondasMax)) {
    const nome = alternativa.canal || 'canal'
    const limite = `só com ondas abaixo de ${metros(alternativa.ondasMax)} m`
    const ks = rastos.map(x => ondasNoCanal(alternativa, x.pontos || [], o))
    const maxes = ks.map(x => x.max).filter(Number.isFinite)
    const k = { semOndas: ks.some(x => x.semOndas), max: maxes.length ? Math.max(...maxes) : null }
    if (k.semOndas) {
      // exclusão dura também em "sair agora" (decisão): a regra do Ivo é "só com ondas < 3 m", desconhecido ≠ < 3, e há a volta por fora
      out.excluida = true
      out.motivos.push(`${nome}: sem previsão de ondas no canal (desconhecido não conta como calmo; ${limite})`)
    } else if (k.max >= alternativa.ondasMax) {
      out.excluida = true
      out.motivos.push(`${nome}: ondas até ${virgula(k.max)} m no pior caso (${limite})`)
    }
  }
  // previsão incompleta ao longo da rota (a mesma previsão nos 3 cenários, mas rastos diferentes)
  const inc = previsaoIncompleta(rastos)
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
  out.chegadaNoite = rastos.some(x => !!x.pontos?.at(-1)?.noite)
  // os máximos dos 3 resumos (o que for número)
  const maximo = (k) => { const v = rastos.map(x => x.resumo[k]).filter(Number.isFinite); return v.length ? Math.max(...v) : null }
  const m = { vento: maximo('ventoMax'), rajada: maximo('rajadaMax'), ondas: maximo('ondasMax') }
  // os limites de vento, rajada e ondas: [o máximo, o texto, o limite a solo, o limite acompanhado]
  const limites = [
    [m.vento, (lim, quem) => `vento médio até ${inteiro(m.vento)} nós no pior caso (limite ${lim} ${quem})`, o.ventoMedioMax, o.ventoMaxAcompanhado],
    [m.rajada, (lim, quem) => `rajadas até ${inteiro(m.rajada)} nós no pior caso (limite ${lim} ${quem})`, o.rajadaMax, o.rajadaMaxAcompanhado],
    [m.ondas, (lim, quem) => `ondas até ${virgula(m.ondas)} m no pior caso (limite ${lim} m ${quem})`, o.ondasMax, o.ondasMaxAcompanhado]
  ]
  if (tripulacao === 'acompanhado') {
    const nr = []
    for (const [v, texto, solo, acomp] of limites) {
      if (v > acomp) nr.push(texto(acomp, 'acompanhado'))
      else if (v > solo) out.avisosVermelhos.push(`acima dos limites a solo: ${texto(solo, 'sozinho')}`)
    }
    if (nr.length) { out.naoRecomendada = true; out.motivos.push(...nr) }
  }
  if (tripulacao === 'so') {
    const nr = []
    for (const [v, texto, solo] of limites) if (v > solo) nr.push(texto(solo, 'sozinho'))
    if (out.horasLemeEq > o.lemeMaxH) nr.push(`${virgula(out.horasLemeEq)} h equivalentes ao leme (limite ${o.lemeMaxH} h sozinho)`)
    if (out.chegadaNoite && destino && destino.conhecido === false) nr.push(`chegada de noite a ${destino.nome}, um porto que não conheces`)
    if (nr.length) { out.naoRecomendada = true; out.motivos.push(...nr) }
  }
  return out
}

module.exports = { PADRAO, CAMPOS_CRITICOS, emCalma, horasLemeEquivalentes, distanciaRotaCosta, minimoCosta, trocosCanal, ondasNoCanal, previsaoIncompleta, avaliar }
