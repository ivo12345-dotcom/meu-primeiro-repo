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
// mesma razão. Com a direção corrigida, o `w` leva corrigido: true e a prevTwd em bruto (o
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

const modelosJs = require('signalk-arlequin-ia/lib/modelos')
const { velocidadePolar, litrosHora } = require('./base')

const H = 3600000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d }

const CENARIOS = Object.freeze({
  pessimista: Object.freeze({ vento: 'p90', ventoPolar: 'p10', velocidade: 'p10', gasoleo: 'p90' }),
  provavel: Object.freeze({ vento: 'p50', ventoPolar: 'p50', velocidade: 'p50', gasoleo: 'p50' }),
  otimista: Object.freeze({ vento: 'p10', ventoPolar: 'p90', velocidade: 'p90', gasoleo: 'p10' })
})
const NOMES = Object.keys(CENARIOS)
const RAZAO_SEM_MODELO = Object.freeze({ p10: 0.9, p50: 1, p90: 1.1 })
const GENOA_POR_RIZOS = [100, 70, 50] // % de genoa com 0, 1 e 2 rizos na grande (planeamento)

// A correção do vento num ponto e hora: { razao: {p10, p50, p90}, twd }.
// Guardada por célula de 0,1° e 10 min (o modelo usa a célula de 0,1° e a hora; a
// previsão é horária): uma passagem são ~900 passos de 1 min.
function criarCorrecaoVento ({ tempoBruto, modelos = {}, obtida, tendPressao3h = null }) {
  const mF = modelos.ventoForca || null
  const mD = modelos.ventoDirecao || null
  const cache = new Map()
  return function correcao (lat, lon, t) {
    const w = tempoBruto(lat, lon, t)
    if (!mF && !mD) return { w, razao: RAZAO_SEM_MODELO, twd: w.twd, corrigido: false }
    const latCel = Math.floor(lat * 10) / 10
    const lonCel = Math.floor(lon * 10) / 10
    const k = `${latCel}|${lonCel}|${Math.floor(t / 600000)}`
    let r = cache.get(k)
    if (!r) {
      const d = new Date(t)
      const x = {
        latCel, lonCel, prevTws: w.tws, prevTwd: w.twd,
        horaDia: d.getUTCHours() + d.getUTCMinutes() / 60,
        idadePrevH: Number.isFinite(obtida) ? Math.max(0, (t - obtida) / H) : null,
        tendPressao3h
      }
      const v = modelosJs.preverVento(mF, mD, x, w.tws ?? 0, w.twd ?? 0)
      const razao = mF && w.tws > 0 ? { p10: v.tws.p10 / w.tws, p50: v.tws.p50 / w.tws, p90: v.tws.p90 / w.tws } : RAZAO_SEM_MODELO
      // a direção só se declara corrigida quando há modelo da direção e direção prevista
      r = { razao, twd: w.twd == null ? null : v.twd, corrigido: !!mD && w.twd != null }
      cache.set(k, r)
    }
    return { w, razao: r.razao, twd: r.twd, corrigido: r.corrigido }
  }
}

// { pessimista, provavel, otimista } → cada um { tempo, velocidadeVela, consumo, quantis }.
// polar: de lib/base.js (lerPolar). modelos: { velocidade, ventoForca, ventoDirecao, consumo } (ou nulls).
function criarCenarios ({ tempoBruto, modelos = {}, polar, obtida, tendPressao3h = null }) {
  if (!polar) throw new Error('sem polar')
  const correcao = criarCorrecaoVento({ tempoBruto, modelos, obtida, tendPressao3h })
  const out = {}
  for (const [nome, q] of Object.entries(CENARIOS)) {
    const tempo = (lat, lon, t) => {
      const { w, razao, twd, corrigido } = correcao(lat, lon, t)
      const r = razao[q.vento]
      // sem previsão (null): fica null, nunca 0 (calma) por coerção de null × razão; a rajada em
      // falta não cai no vento médio. Quem consome trata o null como desconhecido.
      const vezes = (x, f) => (Number.isFinite(x) ? x * f : null)
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
function notaIa (modelos = {}) {
  const falta = []
  if (!modelos.velocidade) falta.push('velocidade pela polar')
  if (!modelos.ventoForca) falta.push('vento previsto ±10%')
  if (!modelos.ventoDirecao) falta.push('direção prevista tal e qual')
  if (!modelos.consumo) falta.push('gasóleo pela curva da Volvo')
  if (falta.length === 4) return 'AI: a aprender (polar, previsão ±10% e curva da Volvo)'
  return falta.length ? `AI em uso, sem alguns modelos: ${falta.join(', ')}` : 'AI em uso'
}

module.exports = { CENARIOS, NOMES, RAZAO_SEM_MODELO, GENOA_POR_RIZOS, criarCorrecaoVento, criarCenarios, notaIa }
