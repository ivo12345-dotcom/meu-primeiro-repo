'use strict'
// Espaço no SSD. Aos 80%: avisa e apaga do bruto só o que o portátil já
// confirmou, o mais antigo primeiro, até ficar abaixo dos 80%. Aos 95% sem
// nada para apagar: pára o bruto (a tabela continua). Nunca o que não está
// confirmado.

const fs = require('node:fs')

function usoDisco (dir) {
  const s = fs.statfsSync(dir)
  const total = s.blocks * s.bsize
  const livre = s.bavail * s.bsize
  return { total, livre, usadoPct: 100 * (1 - livre / total) }
}

function planear ({ usadoPct, total, ficheiros, confirmados, limiteAviso = 80, limiteParar = 95 }) {
  const r = { aviso: usadoPct >= limiteAviso, apagar: [], pararBruto: false }
  if (!r.aviso) return r
  let pct = usadoPct
  for (const f of [...ficheiros].sort((a, b) => a.ficheiro.localeCompare(b.ficheiro))) {
    if (pct < limiteAviso) break
    if (!confirmados[f.ficheiro]) continue
    r.apagar.push(f.ficheiro)
    pct -= 100 * f.bytes / total
  }
  r.pararBruto = pct >= limiteParar
  return r
}

module.exports = { usoDisco, planear }
