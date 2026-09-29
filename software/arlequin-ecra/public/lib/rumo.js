// Rumos para o leme: correção, bordejo contra o vento e layline, aproar.
// Ângulos em rad, rumos verdadeiros 0–2π.

const DOIS_PI = 2 * Math.PI
const GRAU = Math.PI / 180
const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const norm = (a) => ((a % DOIS_PI) + DOIS_PI) % DOIS_PI

// a − b, sempre entre −π e π.
export function diferenca (a, b) {
  let d = norm(a - b)
  if (d > Math.PI) d -= DOIS_PI
  return d
}

// Quanto e para que lado rodar a proa para chegar ao rumo alvo.
// EB = aumentar o rumo (rodar para estibordo).
export function correcaoLeme (alvo, proa) {
  if (!ok(alvo) || !ok(proa)) return null
  const d = Math.round(diferenca(alvo, proa) / GRAU)
  if (d === 0) return { graus: 0, lado: null }
  return { graus: Math.abs(d), lado: d > 0 ? 'EB' : 'BB' }
}

// Rumos de bolina ótimos quando o WP está contra o vento.
// amuraEB = vento a entrar por estibordo (rumo = vento − ângulo);
// amuraBB = vento a entrar por bombordo (rumo = vento + ângulo).
// Com a proa dada, diz se já se chegou à layline do outro bordo (virar).
export function bordejo ({ rumoWp, direcaoVento, anguloBolina, proa }) {
  const twaWp = Math.abs(diferenca(rumoWp, direcaoVento))
  const amuraEB = norm(direcaoVento - anguloBolina)
  const amuraBB = norm(direcaoVento + anguloBolina)
  const r = { contraVento: twaWp < anguloBolina, amuraEB, amuraBB, virar: false }
  if (ok(proa)) {
    const noEB = Math.abs(diferenca(proa, amuraEB)) < Math.abs(diferenca(proa, amuraBB))
    const outro = noEB ? amuraBB : amuraEB
    const dOutro = diferenca(outro, proa)
    const dWp = diferenca(rumoWp, proa)
    r.bordoAtual = noEB ? 'EB' : 'BB'
    r.virar = Math.sign(dWp) === Math.sign(dOutro) && Math.abs(dWp) >= Math.abs(dOutro) - 2 * GRAU
  }
  return r
}

// Aproar ao vento = pôr a proa na direção de onde vem o vento real.
export function rumoAproar (direcaoVento) {
  return ok(direcaoVento) ? norm(direcaoVento) : null
}
