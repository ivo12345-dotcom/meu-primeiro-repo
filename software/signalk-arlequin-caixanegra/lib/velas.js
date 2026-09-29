'use strict'
// Estado das velas: só o Ivo sabe (nenhum sensor vê rizos nem a genoa
// enrolada), por isso escolhe-se no ecrã. Se o vento mudar muito sem mudança
// nas velas, passada 1 h, lembra "as velas continuam assim?".

const GRANDE = [0, 1, 2, -1] // inteira, 1 rizo, 2 rizos, arriada
const GENOA = [100, 70, 50, 0] // % desenrolada; 0 = enrolada
const HORA = 3600000
const BASE_MINIMA = 2 * 1852 / 3600 // 2 nós: numa calmaria a percentagem sobre zero não diz nada

function novoEstadoVelas () {
  return { grandeRizos: 0, genoaPct: 100, mudouEm: null, twsNaMudanca: null, lembradoEm: null }
}

function mudar (e, { grandeRizos, genoaPct }, agora, tws) {
  if (grandeRizos !== undefined && !GRANDE.includes(grandeRizos)) throw new Error('Grande: 0, 1, 2 rizos ou -1 (arriada)')
  if (genoaPct !== undefined && !GENOA.includes(genoaPct)) throw new Error('Genoa: 100, 70, 50 ou 0 (enrolada)')
  return {
    ...e,
    ...(grandeRizos !== undefined ? { grandeRizos } : {}),
    ...(genoaPct !== undefined ? { genoaPct } : {}),
    mudouEm: agora,
    twsNaMudanca: Number.isFinite(tws) ? tws : null,
    lembradoEm: null
  }
}

function precisaLembrete (e, agora, tws) {
  if (!Number.isFinite(tws) || !Number.isFinite(e.twsNaMudanca)) return false
  const desde = Math.max(e.mudouEm ?? 0, e.lembradoEm ?? 0)
  if (agora - desde < HORA) return false
  const base = Math.max(e.twsNaMudanca, BASE_MINIMA)
  return Math.abs(tws - base) / base > 0.4
}

module.exports = { GRANDE, GENOA, novoEstadoVelas, mudar, precisaLembrete }
