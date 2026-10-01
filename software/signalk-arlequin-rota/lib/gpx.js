'use strict'
// O GPX do plano de navegação (desenho 3b-1, "Plano pelo Telegram"): GPX 1.1 com um <rte> com os
// pontos da alternativa e os nomes, mais o nome do barco e a data nos metadados.
//
// gpxRota({ titulo, descricao?, nomeRota?, pontos: [{ lat, lon, nome? }], autor?, quando (ms) }) → texto XML
// Os pontos sem nome chamam-se WP<i> (como na rota ativada no SignalK). Os textos escapam-se para XML
// e perdem os caracteres que o XML 1.0 não aceita (os de controlo menos o tab, o LF e o CR, U+FFFE,
// U+FFFF e as metades de surrogate soltas): um nome com um deles tornava o GPX inválido.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const FORA_DO_XML = /[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu
const esc = (s) => String(s ?? '').replace(FORA_DO_XML, '').replace(/[&<>"']/g, c => ESC[c])
const coord = (x) => (Number.isFinite(x) ? String(Math.round(x * 1e6) / 1e6) : null)

function gpxRota ({ titulo, descricao, nomeRota, pontos = [], autor, quando }) {
  const t = Number.isFinite(quando) ? `<time>${new Date(quando).toISOString()}</time>` : ''
  const desc = descricao ? `<desc>${esc(descricao)}</desc>` : ''
  const pts = pontos
    .map((p, i) => ({ lat: coord(p.lat), lon: coord(p.lon), nome: p.nome || `WP${i}` }))
    .filter(p => p.lat != null && p.lon != null)
    .map(p => `    <rtept lat="${p.lat}" lon="${p.lon}"><name>${esc(p.nome)}</name></rtept>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Arlequin · melhor rota" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(titulo)}</name>${desc}${autor ? `<author><name>${esc(autor)}</name></author>` : ''}${t}</metadata>`,
    '  <rte>',
    `    <name>${esc(nomeRota || titulo)}</name>${desc}`,
    ...pts,
    '  </rte>',
    '</gpx>',
    ''
  ].join('\n')
}

module.exports = { gpxRota, esc }
