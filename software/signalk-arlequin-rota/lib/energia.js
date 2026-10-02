'use strict'
// Bateria de serviço simplificada para o planeamento (desenho 3a): parte do SoC
// atual; gasta 4,5 A de dia e 6 A de noite (instrumentos, piloto, luzes, radar);
// o solar dá radiação (W/m²) × área × rendimento × fator de perdas / tensão; o alternador
// 45 A com o motor ligado. Tudo configurável no plugin. Lógica pura.
//
// O banco é o de serviço do barco, 440 Ah (bancos 2 + 3, NAVEGACAO §5b): o SoC que a rota recebe
// vem do SmartShunt em fração desses 440 Ah, por isso os Ah gastos descontam-se nos mesmos 440
// (decisão do Ivo n.º 4, auditoria I-13, 02/10; antes eram 200 Ah e a bateria descia 2,2 × mais
// depressa do que no barco). O limite dos 50 % à chegada (lib/seguranca.js) mantém-se.
// O solar com perdas (fatorSolar 0,65: regulador, painéis deitados, sombras do radome, da retranca
// e das velas; o NAVEGACAO §5c dá 0,55–0,75), como o simulador (arlequin-simulador/lib/modelo.js).
//
// O motor da passagem (lib/passagem.js) usa-a assim:
//   const e = criarEnergia({ socInicial: 0.8 }); estado = e.inicio(t)
//   ({ estado, soc } = e.passo(estado, { dtMs, motor, noite, w }))   (w.radiacao da previsão)

const H = 3600000

const PADRAO = Object.freeze({
  capacidadeAh: 440, // banco de serviço (bancos 2 + 3, AGM)
  socInicial: 1,
  consumoDiaA: 4.5,
  consumoNoiteA: 6,
  paineis: 2, // 2 × 305 W
  areaPainelM2: 1.65,
  rendimento: 0.2,
  fatorSolar: 0.65, // perdas (0,55–0,75)
  tensaoV: 12.7,
  alternadorA: 45
})

// Corrente do solar (A) com a radiação dada (W/m², a null conta 0). Uma configuração sem fatorSolar
// (de antes de 02/10) fica com o das perdas, nunca sem perdas por omissão.
function solarA (c, radiacao) {
  return Math.max(0, radiacao || 0) * c.paineis * c.areaPainelM2 * c.rendimento * (c.fatorSolar ?? PADRAO.fatorSolar) / c.tensaoV
}

function criarEnergia (opcoes = {}) {
  const c = { ...PADRAO }
  for (const [k, v] of Object.entries(opcoes)) if (v != null) c[k] = v
  return {
    config: c,
    inicio (t, soc = c.socInicial) {
      return { t, ah: c.capacidadeAh * Math.max(0, Math.min(1, soc)) }
    },
    // ctx: { dtMs, motor, noite, w: { radiacao }, radiacao? } → { estado, soc, corrente, solar }
    passo (estado, ctx) {
      const radiacao = ctx.radiacao ?? ctx.w?.radiacao
      const solar = ctx.noite ? 0 : solarA(c, radiacao)
      const corrente = solar + (ctx.motor ? c.alternadorA : 0) - (ctx.noite ? c.consumoNoiteA : c.consumoDiaA)
      const ah = Math.max(0, Math.min(c.capacidadeAh, estado.ah + corrente * ctx.dtMs / H))
      return { estado: { t: (estado.t ?? 0) + ctx.dtMs, ah }, soc: ah / c.capacidadeAh, corrente, solar }
    }
  }
}

module.exports = { PADRAO, solarA, criarEnergia }
