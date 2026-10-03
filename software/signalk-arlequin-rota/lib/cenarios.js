'use strict'
// Os três cenários (desenho 3a, "Simulação"): o que cada um dá ao motor da passagem
// (lib/passagem.js) — tempo(lat, lon, t), velocidadeVela(...) e consumo(...).
//
//   pessimista: velocidade P10, vento P90, gasóleo P90
//   provável:   P50 de tudo
//   otimista:   velocidade P90, vento P10, gasóleo P10
//
// O VENTO QUE DECIDE (rizos, motor abaixo de 7 nós, limites de segurança, máximos) é o
// previsto em bruto × a razão do quantil do cenário, dada pelo modelo ventoForca
// (modelos.preverVento), e a direção é a corrigida pelo ventoDirecao (P50). A rajada leva a
// mesma razão. NO PESSIMISTA, a razão do vento que decide nunca fica abaixo de 1 (revisão final,
// I2): um modelo que aprendeu "a previsão exagera" (razão P90 < 1) não pode pôr o pior caso abaixo
// do vento e da rajada previstos em bruto, que decidem os limites de segurança (o P50, o P10 e a
// polar, twsPolar, ficam com a razão do modelo). Com a direção corrigida, o `w` leva corrigido: true e a prevTwd em bruto (o
// lib/passagem.js lança um erro se faltar: nunca duplica a correção no modelo da velocidade).
// A VELOCIDADE À VELA é modelos.preverVelocidade(velocidade, x, stwPolar)[quantil], com o x
// da previsão em bruto (contrato do modelos.js: twaPrevAbs = |TWD previsto EM BRUTO − rumo|,
// que o lib/passagem.js calcula com a prevTwd, nunca o ângulo ao vento corrigido) e stwPolar =
// a polar no ângulo ao vento corrigido (twa) e no vento corrigido do
// quantil CONTRÁRIO ao do vento que decide (pessimista: a polar no vento P10). Porquê: sem
// modelo, P10 = P50 = P90 = a polar; com a polar no vento P90, o pessimista andava MAIS
// depressa, porque mais vento dá mais velocidade na polar (ronda B).
// VENTO SEM PREVISÃO (null, `semDados` de lib/previsao.js): tws, rajada e twsPolar ficam null,
// nunca 0 — desconhecido não é calmo. O lib/passagem.js vai então a motor, sem mexer nos rizos,
// e o lib/seguranca.js não conta essas horas como calma.
// SEM MODELO ventoForca: a razão é 0,9 / 1 / 1,1 (vento ±10%). Sem modelo ventoDirecao: a
// direção prevista tal e qual. Sem modelo da velocidade: a polar. Sem modelo do consumo: a
// curva da Volvo (lib/base.js). Tudo isto vai escrito na nota da AI do resultado.
// A AI DO VENTO SÓ DENTRO DO TREINO (auditoria I-16): os modelos ventoForca e ventoDirecao
// aprenderam com previsões de 0–12 h (signalk-arlequin-ia/lib/modelos.js); com as partidas até
// +48 h a idade da previsão no ponto chega a ~78 h. Além de IDADE_MAX_TREINO_H (ou sem a hora da
// previsão) fica o que se faz sem modelo — vento ±10% e a direção prevista — e a nota da AI di-lo
// (previsaoAlemDoTreino). A tendência do barómetro (tendPressao3h, hPa: pressão agora − há 3 h,
// ou null) entra no modelo como no treino; tendenciaPressao3h tira-a das amostras do barómetro.

const path = require('node:path')
// por caminho relativo e não pelo nome do pacote: no Pi o plugin pode não estar em node_modules (auditoria I-37)
const modelosJs = require(path.join(__dirname, '..', '..', 'signalk-arlequin-ia', 'lib', 'modelos'))
const { velocidadePolar, litrosHora } = require('./base')

const H = 3600000
const MIN = 60000
// a idade máxima da previsão (h) com que a AI do vento aprendeu (treino: 0–12 h)
const IDADE_MAX_TREINO_H = 12
// a tendência do barómetro como no treino (arlequin_ia/variaveis.py, tendencia_pressao): a amostra
// mais perto de há 3 h, a ±10 min
const TENDENCIA_H = 3
const TENDENCIA_TOLERANCIA_MIN = 10
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d }

// decisão (relatório C do protótipo, ponto 7): o vento que decide é o P90 e a polar lê-se no quantil contrário (P10)
const CENARIOS = Object.freeze({
  pessimista: Object.freeze({ vento: 'p90', ventoRazaoMin: 1, ventoPolar: 'p10', velocidade: 'p10', gasoleo: 'p90' }),
  provavel: Object.freeze({ vento: 'p50', ventoPolar: 'p50', velocidade: 'p50', gasoleo: 'p50' }),
  otimista: Object.freeze({ vento: 'p10', ventoPolar: 'p90', velocidade: 'p90', gasoleo: 'p10' })
})
const NOMES = Object.keys(CENARIOS)
const RAZAO_SEM_MODELO = Object.freeze({ p10: 0.9, p50: 1, p90: 1.1 })
// sem previsão (null): fica null, nunca 0 (calma) por coerção de null × razão; a rajada em falta
// não cai no vento médio. Quem consome trata o null como desconhecido.
const vezes = (x, f) => (Number.isFinite(x) ? x * f : null)
const GENOA_POR_RIZOS = [100, 70, 50] // % de genoa com 0, 1 e 2 rizos na grande (planeamento)

// A correção do vento num ponto e hora: { razao: {p10, p50, p90}, twd }.
// Guardada por célula de 0,1° e 10 min (o modelo usa a célula de 0,1° e a hora; a
// previsão é horária): uma passagem são ~900 passos de 1 min.
// A função tem alemDoTreino(): se alguma vez, com um modelo do vento, a previsão no ponto tinha
// mais de IDADE_MAX_TREINO_H (ou a idade era desconhecida) e por isso ficou sem modelo.
function criarCorrecaoVento ({ tempoBruto, modelos = {}, obtida, tendPressao3h = null }) {
  const mF = modelos.ventoForca || null
  const mD = modelos.ventoDirecao || null
  const cache = new Map()
  const tendencia = Number.isFinite(tendPressao3h) ? tendPressao3h : null
  let foraDoTreino = false
  function correcao (lat, lon, t) {
    const w = tempoBruto(lat, lon, t)
    if (!mF && !mD) return { w, razao: RAZAO_SEM_MODELO, twd: w.twd, corrigido: false }
    const idadePrevH = Number.isFinite(obtida) ? Math.max(0, (t - obtida) / H) : null
    // fora do treino (ou idade desconhecida): sem modelo, vento ±10% e a direção prevista
    if (idadePrevH == null || idadePrevH > IDADE_MAX_TREINO_H) { foraDoTreino = true; return { w, razao: RAZAO_SEM_MODELO, twd: w.twd, corrigido: false } }
    const latCel = Math.floor(lat * 10) / 10
    const lonCel = Math.floor(lon * 10) / 10
    // a chave diz também se havia vento e direção previstos (M-10): a 1.ª consulta da célula sem
    // vento não pode deixar as seguintes, com vento, com os ±10% e sem a direção corrigida
    const k = `${latCel}|${lonCel}|${Math.floor(t / 600000)}|${w.tws > 0 ? 1 : 0}|${w.twd != null ? 1 : 0}`
    let r = cache.get(k)
    if (!r) {
      const d = new Date(t)
      const x = {
        latCel, lonCel, prevTws: w.tws, prevTwd: w.twd,
        horaDia: d.getUTCHours() + d.getUTCMinutes() / 60,
        idadePrevH,
        tendPressao3h: tendencia
      }
      const v = modelosJs.preverVento(mF, mD, x, w.tws ?? 0, w.twd ?? 0)
      const razao = mF && w.tws > 0 ? { p10: v.tws.p10 / w.tws, p50: v.tws.p50 / w.tws, p90: v.tws.p90 / w.tws } : RAZAO_SEM_MODELO
      // a direção só se declara corrigida quando há modelo da direção e direção prevista
      r = { razao, twd: w.twd == null ? null : v.twd, corrigido: !!mD && w.twd != null }
      cache.set(k, r)
    }
    return { w, razao: r.razao, twd: r.twd, corrigido: r.corrigido }
  }
  correcao.alemDoTreino = () => foraDoTreino
  return correcao
}

// A tendência do barómetro para o modelo do vento: pressão agora − há 3 h (hPa; a subir +, a cair −),
// como no treino (variaveis.tendencia_pressao): a amostra de "agora" é a mais recente até `agora` e
// com no máximo 10 min; a de "há 3 h" é a mais perto dessa hora a ±10 min. Sem uma delas, null (o
// modelo recebe null, como antes; nunca uma tendência de menos horas como se fosse de 3).
//   amostras: [{ t (ms), hPa }] (as do barómetro do plugin, de minuto a minuto)
function tendenciaPressao3h (amostras, agora, { horas = TENDENCIA_H, toleranciaMin = TENDENCIA_TOLERANCIA_MIN } = {}) {
  if (!Array.isArray(amostras) || !Number.isFinite(agora)) return null
  const ok = amostras.filter(a => a && Number.isFinite(a.t) && Number.isFinite(a.hPa) && a.t <= agora)
  if (!ok.length) return null
  const tol = toleranciaMin * MIN
  const ultima = ok.reduce((m, a) => (a.t > m.t ? a : m))
  if (agora - ultima.t > tol) return null
  const alvo = ultima.t - horas * H
  let antes = null
  for (const a of ok) if (Math.abs(a.t - alvo) <= tol && (!antes || Math.abs(a.t - alvo) < Math.abs(antes.t - alvo))) antes = a
  return antes ? ultima.hPa - antes.hPa : null
}

// { pessimista, provavel, otimista } → cada um { tempo, velocidadeVela, consumo, quantis }.
// polar: de lib/base.js (lerPolar). modelos: { velocidade, ventoForca, ventoDirecao, consumo } (ou nulls).
// tendPressao3h: hPa (pressão agora − há 3 h; tendenciaPressao3h) ou null.
// O objeto tem também previsaoAlemDoTreino (não enumerável): a AI do vento ficou de fora nalgum ponto
// por a previsão ter mais de 12 h (ou idade desconhecida) — para a nota da AI (notaIa).
function criarCenarios ({ tempoBruto, modelos = {}, polar, obtida, tendPressao3h = null }) {
  if (!polar) throw new Error('sem polar')
  const correcao = criarCorrecaoVento({ tempoBruto, modelos, obtida, tendPressao3h })
  const out = {}
  Object.defineProperty(out, 'previsaoAlemDoTreino', { get: () => correcao.alemDoTreino(), enumerable: false })
  for (const [nome, q] of Object.entries(CENARIOS)) {
    const tempo = (lat, lon, t) => {
      const { w, razao, twd, corrigido } = correcao(lat, lon, t)
      // o pessimista nunca abaixo do previsto em bruto (ventoRazaoMin)
      const r = Number.isFinite(q.ventoRazaoMin) ? Math.max(q.ventoRazaoMin, razao[q.vento]) : razao[q.vento]
      return {
        ...w,
        tws: vezes(w.tws, r),
        rajada: vezes(w.rajada, r),
        twd,
        prevTws: w.tws, // em bruto, para o modelo da velocidade
        prevRajada: w.rajada,
        prevTwd: w.twd, // em bruto: o lib/passagem.js tira dela o twaPrevAbs (prevTwdDe)
        // a direção é a corrigida pelo modelo ventoDirecao: o lib/passagem.js exige então a prevTwd
        ...(corrigido ? { corrigido: true } : {}),
        twsPolar: vezes(w.tws, razao[q.ventoPolar]) // o vento corrigido em que se lê a polar
      }
    }
    const velocidadeVela = ({ twa, twaPrevAbs, rizos, w, rumo }) => {
      const stwPolar = velocidadePolar(polar, twa, w.twsPolar)
      const x = {
        prevTws: w.prevTws,
        twaPrevAbs,
        prevRajada: w.prevRajada,
        prevOndas: w.ondas,
        prevPeriodo: w.periodo,
        ondasAnguloRel: w.ondasDir == null || rumo == null ? null : Math.abs(dif(w.ondasDir, rumo)),
        grandeRizos: rizos,
        genoaPct: GENOA_POR_RIZOS[rizos] ?? 100
      }
      return modelosJs.preverVelocidade(modelos.velocidade || null, x, stwPolar)[q.velocidade]
    }
    const consumo = ({ rpm, w, rumo }) => {
      const x = { rpm, prevOndas: w.ondas, ondasAnguloRel: w.ondasDir == null || rumo == null ? null : Math.abs(dif(w.ondasDir, rumo)) }
      return modelosJs.preverConsumo(modelos.consumo || null, x, litrosHora(rpm))[q.gasoleo]
    }
    out[nome] = { tempo, velocidadeVela, consumo, quantis: q }
  }
  return out
}

// A nota da AI para o resultado: que modelos estão em uso e o que se usa no lugar dos que faltam.
// previsaoAlemDoTreino (criarCenarios): com um modelo do vento, a parte da previsão a mais de 12 h foi
// sem ele (vento ±10%, a direção tal e qual) — auditoria I-16.
function notaIa (modelos = {}, { previsaoAlemDoTreino = false } = {}) {
  const falta = []
  if (!modelos.velocidade) falta.push('velocidade pela polar')
  if (!modelos.ventoForca) falta.push('vento previsto ±10%')
  if (!modelos.ventoDirecao) falta.push('direção prevista tal e qual')
  if (!modelos.consumo) falta.push('gasóleo pela curva da Volvo')
  if (falta.length === 4) return 'AI: a aprender (polar, previsão ±10% e curva da Volvo)'
  const base = falta.length ? `AI em uso, sem alguns modelos: ${falta.join(', ')}` : 'AI em uso'
  const alem = previsaoAlemDoTreino && (modelos.ventoForca || modelos.ventoDirecao)
  return alem ? `${base}; além de ${IDADE_MAX_TREINO_H} h de previsão, vento previsto ±10% e direção prevista tal e qual (a AI do vento só aprendeu com previsões de 0–${IDADE_MAX_TREINO_H} h)` : base
}

module.exports = { CENARIOS, NOMES, RAZAO_SEM_MODELO, GENOA_POR_RIZOS, IDADE_MAX_TREINO_H, criarCorrecaoVento, criarCenarios, notaIa, tendenciaPressao3h }
