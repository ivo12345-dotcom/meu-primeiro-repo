'use strict'
// J1939: ID de 29 bits, linhas do candump -L e descodificação das PGN que o
// MDI do Volvo Penta D1-20B manda. Valores em SI, caminhos SignalK.
// "Sem dado" segundo a norma: 1 byte > 0xFA, 2 bytes > 0xFAFF, 4 bytes > 0xFAFFFFFF.

const K = 273.15
const NA1 = 0xFA
const NA2 = 0xFAFF
const NA4 = 0xFAFFFFFF

function partesId (id) {
  const prioridade = (id >>> 26) & 0x7
  let pgn = (id >>> 8) & 0x3FFFF
  const pf = (pgn >>> 8) & 0xFF
  let destino = 255
  if (pf < 240) { // PDU1: o PS é o destino, não faz parte do PGN
    destino = pgn & 0xFF
    pgn &= 0x3FF00
  }
  return { prioridade, pgn, origem: id & 0xFF, destino }
}

const construirId = (prioridade, pgn, origem) => (((prioridade & 7) << 26) | (pgn << 8) | (origem & 0xFF)) >>> 0

// "(1727600000.123456) can1 18FEEE00#6EFFFFFFFFFFFFFF" → trama, ou null.
const LINHA = /^\((\d+)\.(\d+)\)\s+(\S+)\s+([0-9A-Fa-f]{8})#([0-9A-Fa-f]*)\s*$/
function lerLinha (linha) {
  const m = LINHA.exec(linha)
  if (!m) return null
  const id = parseInt(m[4], 16)
  const dados = Uint8Array.from((m[5].match(/../g) || []).map(h => parseInt(h, 16)))
  const t = Number(m[1]) * 1000 + Math.floor(Number(m[2].padEnd(6, '0').slice(0, 6)) / 1000)
  return { t, iface: m[3], id, ...partesId(id), dados }
}

function linhaCandump ({ t, pgn, origem = 0, prioridade = 6, dados, iface = 'can1' }) {
  const seg = Math.floor(t / 1000)
  const us = String((t % 1000) * 1000).padStart(6, '0')
  const id = construirId(prioridade, pgn, origem).toString(16).toUpperCase().padStart(8, '0')
  const hex = [...dados].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
  return `(${seg}.${us}) ${iface} ${id}#${hex}`
}

const u8 = (d, i) => d[i] > NA1 ? null : d[i]
const u16 = (d, i) => { const v = d[i] | (d[i + 1] << 8); return v > NA2 ? null : v }
const u32 = (d, i) => { const v = (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0; return v > NA4 ? null : v }

const DESCODIFICADORES = {
  // EEC1: SPN 190 rotações, bytes 4–5, 0,125 rpm/bit
  61444: (d) => {
    const v = u16(d, 3)
    return v === null ? [] : [{ path: 'propulsion.main.revolutions', value: v * 0.125 / 60 }]
  },
  // HOURS: SPN 247 horas totais, bytes 1–4, 0,05 h/bit
  65253: (d) => {
    const v = u32(d, 0)
    return v === null ? [] : [{ path: 'propulsion.main.runTime', value: Math.round(v * 0.05 * 3600) }]
  },
  // ET1: SPN 110 água (byte 1, °C − 40); SPN 175 óleo (bytes 3–4, 0,03125 °C − 273)
  65262: (d) => {
    const r = []
    const agua = u8(d, 0)
    if (agua !== null) r.push({ path: 'propulsion.main.temperature', value: agua - 40 + K })
    const oleo = u16(d, 2)
    if (oleo !== null) r.push({ path: 'propulsion.main.oilTemperature', value: oleo * 0.03125 - 273 + K })
    return r
  },
  // EFL/P1: SPN 100 pressão do óleo, byte 4, 4 kPa/bit
  65263: (d) => {
    const v = u8(d, 3)
    return v === null ? [] : [{ path: 'propulsion.main.oilPressure', value: v * 4000 }]
  },
  // LFE: SPN 183 consumo, bytes 1–2, 0,05 L/h
  65266: (d) => {
    const v = u16(d, 0)
    return v === null ? [] : [{ path: 'propulsion.main.fuel.rate', value: v * 0.05 / 3600 / 1000 }]
  },
  // VEP1: SPN 167 carga (3–4), 168 bateria (5–6), 158 chave (7–8), 0,05 V
  65271: (d) => {
    const v = u16(d, 2) ?? u16(d, 4) ?? u16(d, 6)
    return v === null ? [] : [{ path: 'propulsion.main.alternatorVoltage', value: v * 0.05 }]
  }
}

// As PGN daqui têm 8 bytes; uma trama mais curta (candump cortado, outro aparelho no barramento) não
// dá valores — com bytes em falta o u8 dava NaN e o u16 lia-os como 0 (auditoria M-61).
const BYTES = 8

function descodificar (pgn, dados) {
  const f = DESCODIFICADORES[pgn]
  return f && dados && dados.length >= BYTES ? f(dados) : []
}

module.exports = { partesId, construirId, lerLinha, linhaCandump, descodificar, BYTES, PGNS: Object.keys(DESCODIFICADORES).map(Number) }
