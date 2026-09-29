// Escolhe o alarme para a barra de cima, decide o som e a página de destino.
// Notificação: { caminho, id, state, method, message, status }.

const GRAVIDADE = { normal: 0, nominal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 }

const nivel = (n) => GRAVIDADE[n.state] ?? 0

export function maisGrave (lista) {
  let melhor = null
  for (const n of lista) {
    if (nivel(n) === 0) continue
    if (!melhor || nivel(n) > nivel(melhor)) melhor = n
  }
  return melhor
}

// 'continuo' | 'curto' | null
export function deveTocar (n) {
  if (!n || nivel(n) === 0) return null
  if (!Array.isArray(n.method) || !n.method.includes('sound')) return null
  if (n.status && (n.status.silenced || n.status.acknowledged)) return null
  return nivel(n) >= GRAVIDADE.alarm ? 'continuo' : 'curto'
}

export function paginaDoAlarme (caminho) {
  if (caminho.includes('.ais.')) return 'ais'
  if (/energia|propulsion|electrical|tanks/.test(caminho)) return 'motor'
  return 'carta'
}
