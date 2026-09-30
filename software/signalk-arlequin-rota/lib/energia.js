'use strict'
// Bateria de serviço simplificada para o planeamento (desenho 3a): parte do SoC
// atual; gasta 4,5 A de dia e 6 A de noite (instrumentos, piloto, luzes, radar);
// o solar dá radiação (W/m²) × área × rendimento / tensão; o alternador 45 A com
// o motor ligado. Tudo configurável no plugin. Lógica pura.
//
// O motor da passagem (lib/passagem.js) usa-a assim:
//   const e = criarEnergia({ socInicial: 0.8 }); estado = e.inicio(t)
//   ({ estado, soc } = e.passo(estado, { dtMs, motor, noite, w }))   (w.radiacao da previsão)

const H = 3600000

const PADRAO = Object.freeze({
  capacidadeAh: 200, // banco de serviço
  socInicial: 1,
  consumoDiaA: 4.5,
  consumoNoiteA: 6,
  paineis: 2, // 2 × 305 W
  areaPainelM2: 1.65,
  rendimento: 0.2,
  tensaoV: 12.7,
  alternadorA: 45
})

// Corrente do solar (A) com a radiação dada (W/m², a null conta 0).
function solarA (c, radiacao) {
  return Math.max(0, radiacao || 0) * c.paineis * c.areaPainelM2 * c.rendimento / c.tensaoV
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
