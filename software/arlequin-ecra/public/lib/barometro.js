// Tendência do barómetro: guarda 6 h de amostras em memória e dá a variação
// em hPa por 3 h (a medida usada a bordo para ver o tempo a mudar).

const H = 3600 * 1000
const GUARDAR = 6 * H

export function criarBarometro () {
  return { amostras: [] }
}

export function registarPressao (b, pa, t) {
  const amostras = b.amostras.filter(a => a.t >= t - GUARDAR)
  amostras.push({ t, pa })
  return { amostras }
}

// { sentido: 'sobe'|'desce'|'estavel', hpa3h } ou null com menos de 1 h.
export function tendencia (b, agora) {
  const a = b.amostras
  if (!a.length) return null
  const alvo = agora - 3 * H
  const antiga = a.reduce((m, x) => Math.abs(x.t - alvo) < Math.abs(m.t - alvo) ? x : m, a[0])
  const atual = a[a.length - 1]
  const span = atual.t - antiga.t
  if (span < H) return null
  const hpa3h = Math.round((atual.pa - antiga.pa) / 100 * (3 * H / span) * 100) / 100
  const sentido = Math.abs(hpa3h) < 0.5 ? 'estavel' : hpa3h > 0 ? 'sobe' : 'desce'
  return { sentido, hpa3h }
}

// O barómetro guardado no browser (auditoria I-06): estragado volta vazio; só ficam as amostras com números.
export function lerBarometro (x) {
  const lista = Array.isArray(x?.amostras) ? x.amostras : []
  return { amostras: lista.filter(a => a && Number.isFinite(a.t) && Number.isFinite(a.pa)) }
}
