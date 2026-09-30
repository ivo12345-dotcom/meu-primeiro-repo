'use strict'
// O que se sabe sem a AI: a polar do Arlequin e a curva de consumo da Volvo.
//
// Polar: o CSV do ecrã (software/arlequin-ecra/public/polar-arlequin.csv), lido por um
// caminho configurável. lerPolar e a interpolação bilinear são as de
// arlequin-ecra/public/lib/polar.js (ESM, com a interface em SI), passadas para
// CommonJS e para nós e graus: velocidadePolar(p, twa°, tws nós) = velocidadeAlvo(p, twa rad, tws m/s) / NO.
// Fora da tabela fica no bordo (acima de 20 nós de vento vale a coluna dos 20);
// abaixo do primeiro ângulo (ângulo morto) é 0.
//
// Curva da Volvo: a mesma tabela de signalk-arlequin-j1939/lib/consumo.js (CURVA),
// copiada e não importada, para o plugin da rota não depender do outro pacote.
// O teste confere que as duas continuam iguais.

const fs = require('node:fs')
const path = require('node:path')

// <repo>/software/arlequin-ecra/public/polar-arlequin.csv
const POLAR_PADRAO = path.join(__dirname, '..', '..', 'arlequin-ecra', 'public', 'polar-arlequin.csv')

// CSV "TWA;TWS6;TWS10;…" com linhas de comentário começadas por #.
function lerPolar (texto) {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const cab = linhas[0].split(';')
  const tws = cab.slice(1).map(c => Number(c.replace(/[^0-9.]/g, '')))
  const twa = []
  const v = []
  for (const l of linhas.slice(1)) {
    const c = l.split(';').map(Number)
    twa.push(c[0])
    v.push(c.slice(1))
  }
  if (!tws.length || !twa.length || v.some(r => r.length !== tws.length || r.some(x => !Number.isFinite(x)))) throw new Error('polar ilegível')
  return { tws, twa, v }
}

function carregarPolar (caminho = POLAR_PADRAO) {
  return lerPolar(fs.readFileSync(caminho, 'utf8'))
}

function entre (lista, x) {
  if (x <= lista[0]) return [0, 0]
  const n = lista.length - 1
  if (x >= lista[n]) return [n - 1, 1]
  let i = 0
  while (lista[i + 1] < x) i++
  return [i, (x - lista[i]) / (lista[i + 1] - lista[i])]
}

// Velocidade da polar (nós) com |TWA| em graus (qualquer sinal ou volta) e TWS em nós.
function velocidadePolar (p, twaGraus, twsNos) {
  let a = Math.abs(twaGraus) % 360
  if (a > 180) a = 360 - a
  if (a < p.twa[0]) return 0
  const [i, fi] = entre(p.twa, a)
  const [j, fj] = entre(p.tws, twsNos)
  const v00 = p.v[i][j]
  const v01 = p.v[i][j + 1]
  const v10 = p.v[i + 1][j]
  const v11 = p.v[i + 1][j + 1]
  return (v00 * (1 - fj) + v01 * fj) * (1 - fi) + (v10 * (1 - fj) + v11 * fj) * fi
}

// Consumo do D1-20 pelas rotações (L/h): "Fuel Consumption, at calculated propeller
// load exp. 3" da ficha da Volvo Penta. Cópia de signalk-arlequin-j1939/lib/consumo.js.
const CURVA = [
  [850, 0.4], [1200, 0.5], [1400, 0.7], [1600, 0.9], [1800, 1.0], [2000, 1.3],
  [2200, 1.6], [2400, 2.0], [2600, 2.4], [2800, 3.0], [3000, 3.7], [3200, 4.6]
]

function litrosHora (rpm, fator = 1) {
  if (!(rpm > 300)) return 0
  if (rpm <= CURVA[0][0]) return CURVA[0][1] * fator
  for (let i = 1; i < CURVA.length; i++) {
    const [r1, l1] = CURVA[i]
    if (rpm <= r1) {
      const [r0, l0] = CURVA[i - 1]
      return (l0 + (l1 - l0) * (rpm - r0) / (r1 - r0)) * fator
    }
  }
  return CURVA[CURVA.length - 1][1] * fator
}

module.exports = { POLAR_PADRAO, lerPolar, carregarPolar, velocidadePolar, CURVA, litrosHora }
