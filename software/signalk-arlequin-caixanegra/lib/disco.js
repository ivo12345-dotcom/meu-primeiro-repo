'use strict'
// Espaço no SSD. Aos 80%: apaga do bruto só o que o portátil já confirmou, o
// mais antigo primeiro, até ficar abaixo dos 75% (5% de folga, senão voltava
// aos 80% daí a uma hora e o aviso ia e vinha). Só avisa se, depois de apagar
// tudo o que se pode, continuar acima dos 80% (falta confirmar no portátil).
// Aos 95% sem nada para apagar: pára o bruto (a tabela continua). Nunca o que
// não está confirmado.

const fs = require('node:fs')

function usoDisco (dir) {
  const s = fs.statfsSync(dir)
  const total = s.blocks * s.bsize
  const livre = s.bavail * s.bsize
  return { total, livre, usadoPct: 100 * (1 - livre / total) }
}

const FOLGA = 5 // % abaixo do limite do aviso até onde se apaga

function planear ({ usadoPct, total, ficheiros, confirmados, limiteAviso = 80, limiteParar = 95 }) {
  const r = { aviso: false, apagar: [], pararBruto: false }
  if (usadoPct < limiteAviso) return r
  let pct = usadoPct
  for (const f of [...ficheiros].sort((a, b) => a.ficheiro.localeCompare(b.ficheiro))) {
    if (pct < limiteAviso - FOLGA) break
    if (!confirmados[f.ficheiro]) continue
    r.apagar.push(f.ficheiro)
    pct -= 100 * f.bytes / total
  }
  r.aviso = pct >= limiteAviso
  r.pararBruto = pct >= limiteParar
  return r
}

module.exports = { usoDisco, planear }
