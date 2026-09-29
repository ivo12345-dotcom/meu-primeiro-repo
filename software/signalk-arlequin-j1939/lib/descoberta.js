'use strict'
// Descoberta dos alarmes do MDI: a PGN 65417 é própria da Volvo e ninguém a
// publicou. Guarda cada mudança dos bytes das PGN proprietárias (0xFF00–0xFFFF)
// com os bits que mudaram e as rotações nesse momento. Com a ignição ligada e o
// motor parado acendem os alarmes de óleo e de carga: vê-se que bits são.
// Depois o mapa (byte, bit → alarme) vai para a configuração do plugin.

const proprietaria = (pgn) => pgn >= 0xFF00 && pgn <= 0xFFFF

const hexBytes = (d) => [...d].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

function novaDescoberta () {
  return { vistas: {} } // pgn → { n, origem, t, bytes }
}

function bitsMudados (antes, depois) {
  const r = []
  for (let i = 0; i < Math.max(antes.length, depois.length); i++) {
    const x = (antes[i] ?? 0) ^ (depois[i] ?? 0)
    for (let b = 0; b < 8; b++) {
      if (x & (1 << b)) r.push(`byte${i}.bit${b} ${(antes[i] >> b) & 1}→${(depois[i] >> b) & 1}`)
    }
  }
  return r
}

// Devolve { d, mudou: null | { t, pgn, origem, bytes, bitsMudados, rpm } }
function registar (d, trama, rpm = null) {
  const antes = d.vistas[trama.pgn]
  const bytes = hexBytes(trama.dados)
  const vistas = { ...d.vistas, [trama.pgn]: { n: (antes?.n || 0) + 1, origem: trama.origem, t: trama.t, bytes, dados: trama.dados } }
  let mudou = null
  if (proprietaria(trama.pgn) && (!antes || antes.bytes !== bytes)) {
    mudou = { t: trama.t, pgn: trama.pgn, origem: trama.origem, bytes, bitsMudados: antes ? bitsMudados(antes.dados, trama.dados) : [], rpm }
  }
  return { d: { vistas }, mudou }
}

// mapa: [{ byte, bit, id, mensagem, estado = 'alarm' }]; ativos: { id: true }
function alarmesDoMapa (mapa, dados, ativos) {
  const novos = { ...ativos }
  const notificacoes = []
  for (const m of mapa || []) {
    const ligado = ((dados[m.byte] ?? 0) >> m.bit) & 1
    if (ligado && !novos[m.id]) {
      novos[m.id] = true
      notificacoes.push({ id: m.id, state: m.estado || 'alarm', method: ['visual', 'sound'], message: m.mensagem })
    } else if (!ligado && novos[m.id]) {
      delete novos[m.id]
      notificacoes.push({ id: m.id, state: 'normal', method: [], message: 'Normal' })
    }
  }
  return { ativos: novos, notificacoes }
}

module.exports = { novaDescoberta, registar, alarmesDoMapa, proprietaria, hexBytes }
