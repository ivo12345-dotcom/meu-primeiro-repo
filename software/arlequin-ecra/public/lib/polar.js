// Polar do Arlequin: velocidade alvo por interpolação bilinear, % da polar e
// ângulos ótimos de VMG. A tabela fica em graus e nós; a interface é SI.

const NO = 1852 / 3600
const GRAU = Math.PI / 180

// CSV "TWA;TWS6;TWS10;…" com linhas de comentário começadas por #.
export function lerPolar (texto) {
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
  return { tws, twa, v }
}

// Índice i tal que lista[i] <= x <= lista[i+1], e a fração entre os dois.
function entre (lista, x) {
  if (x <= lista[0]) return [0, 0]
  const n = lista.length - 1
  if (x >= lista[n]) return [n - 1, 1]
  let i = 0
  while (lista[i + 1] < x) i++
  return [i, (x - lista[i]) / (lista[i + 1] - lista[i])]
}

function alvoNos (p, aGraus, twsNos) {
  if (aGraus < p.twa[0]) return 0 // dentro do ângulo morto
  const [i, fi] = entre(p.twa, aGraus)
  const [j, fj] = entre(p.tws, twsNos)
  const v00 = p.v[i][j]
  const v01 = p.v[i][j + 1]
  const v10 = p.v[i + 1][j]
  const v11 = p.v[i + 1][j + 1]
  return (v00 * (1 - fj) + v01 * fj) * (1 - fi) + (v10 * (1 - fj) + v11 * fj) * fi
}

function anguloAbs (twaRad) {
  let a = Math.abs(twaRad / GRAU) % 360
  if (a > 180) a = 360 - a
  return a
}

export function velocidadeAlvo (p, twaRad, twsMs) {
  return alvoNos(p, anguloAbs(twaRad), twsMs / NO) * NO
}

// STW / velocidade alvo (0–1+). null quando não há alvo (ângulo morto).
export function percentagem (p, stwMs, twaRad, twsMs) {
  const alvo = velocidadeAlvo(p, twaRad, twsMs)
  if (!alvo || typeof stwMs !== 'number') return null
  return stwMs / alvo
}

// Ângulos (rad) com a melhor VMG de bolina (≤ 90°) e de popa (≥ 90°).
export function angulosOtimos (p, twsMs) {
  const twsNos = twsMs / NO
  let bolina = { a: p.twa[0], vmg: -Infinity }
  let popa = { a: 180, vmg: -Infinity }
  for (let a = p.twa[0]; a <= 180; a += 0.5) {
    const v = alvoNos(p, a, twsNos)
    const vmg = v * Math.cos(a * GRAU)
    if (a <= 90 && vmg > bolina.vmg) bolina = { a, vmg }
    if (a >= 90 && -vmg > popa.vmg) popa = { a, vmg: -vmg }
  }
  return {
    bolina: bolina.a * GRAU,
    vmgBolina: bolina.vmg * NO,
    popa: popa.a * GRAU,
    vmgPopa: popa.vmg * NO
  }
}
