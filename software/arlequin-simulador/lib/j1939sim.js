'use strict'
// O simulador a "falar J1939": gera as linhas candump que o MDI do D1-20B
// mandaria, para o plugin signalk-arlequin-j1939 as descodificar no portátil.
// A PGN 65417 leva um padrão INVENTADO (só para testar a descoberta):
// byte 0 = 0x03 com a ignição ligada e o motor parado, 0x00 a trabalhar.

const { linhaCandump } = require('../../signalk-arlequin-j1939/lib/j1939')

const u16 = (v) => [v & 0xFF, (v >> 8) & 0xFF]
const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]

// m: { t (ms), rpm, tempK, volt, horasS }
function tramasMotor (m) {
  const t = m.t
  const rpmRaw = Math.round(m.rpm / 0.125)
  const tempRaw = Math.max(0, Math.min(250, Math.round(m.tempK - 273.15 + 40)))
  const voltRaw = Math.round(m.volt / 0.05)
  const horasRaw = Math.round(m.horasS / 3600 / 0.05)
  const trama = (pgn, dados, prioridade = 6) => linhaCandump({ t, pgn, origem: 0, prioridade, dados: Uint8Array.from(dados) })
  return [
    trama(61444, [0xFF, 0xFF, 0xFF, ...u16(rpmRaw), 0xFF, 0xFF, 0xFF], 3),
    trama(65262, [tempRaw, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
    trama(65271, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, ...u16(voltRaw)]),
    trama(65253, [...u32(horasRaw), 0xFF, 0xFF, 0xFF, 0xFF]),
    trama(65417, [m.rpm > 300 ? 0x00 : 0x03, 0, 0, 0, 0, 0, 0, 0])
  ]
}

module.exports = { tramasMotor }
