'use strict'
// "Algés (CNA)" → "alges-cna": sem acentos, minúsculas, hífenes, sem hífenes nas pontas; com max,
// corta a esse tamanho. O único ajudante para os ids dos destinos do Ivo (index.js), das
// alternativas (lib/calculo.js) e o nome do ficheiro GPX (lib/plano.js).

function slug (s, max = Infinity) {
  const r = String(s ?? '').normalize('NFD').replace(/[\u{300}-\u{36F}]/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return Number.isFinite(max) ? r.slice(0, max) : r
}

module.exports = { slug }
