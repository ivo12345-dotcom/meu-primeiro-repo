'use strict'
// O GPX do plano de navegação (desenho 3b-1, "Plano pelo Telegram"): GPX 1.1 com um <rte> com os
// pontos da alternativa e os nomes, mais o nome do barco e a data nos metadados.
//
// gpxRota({ titulo, descricao?, nomeRota?, pontos: [{ lat, lon, nome? }], autor?, quando (ms) }) → texto XML
// Os pontos sem nome chamam-se WP<i> (como na rota ativada no SignalK). Os textos escapam-se para XML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c])
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
