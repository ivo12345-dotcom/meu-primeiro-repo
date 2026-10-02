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

// { sentido: 'sobe'|'desce'|'estavel', hpa3h } ou null ("a medir") sem ~3 h de amostras. A medida é a da
// rota (o quedaEm3h do aviso do barómetro, signalk-arlequin-rota/lib/avisos-navegar.js): a diferença entre
// a amostra mais antiga das últimas 3 h e a mais recente, sem extrapolar (auditoria M-44: com 1 h o ecrã
// multiplicava por 3 e dizia "▼ 3,6 hPa/3 h" quando a rota, com a mesma hora, contava 1,2).
const MINIMO = 2.75 * H // as amostras são de minuto a minuto: "~3 h"
export function tendencia (b, agora) {
  const a = b.amostras.filter(x => x.t >= agora - 3 * H && x.t <= agora)
  if (!a.length) return null
  const antiga = a.reduce((m, x) => (x.t < m.t ? x : m), a[0])
  const atual = a.reduce((m, x) => (x.t > m.t ? x : m), a[0])
  if (atual.t - antiga.t < MINIMO) return null
  const hpa3h = Math.round((atual.pa - antiga.pa) / 100 * 100) / 100
  const sentido = Math.abs(hpa3h) < 0.5 ? 'estavel' : hpa3h > 0 ? 'sobe' : 'desce'
  return { sentido, hpa3h }
}

// O barómetro guardado no browser (auditoria I-06): estragado volta vazio; só ficam as amostras com números.
export function lerBarometro (x) {
  const lista = Array.isArray(x?.amostras) ? x.amostras : []
  return { amostras: lista.filter(a => a && Number.isFinite(a.t) && Number.isFinite(a.pa)) }
}
