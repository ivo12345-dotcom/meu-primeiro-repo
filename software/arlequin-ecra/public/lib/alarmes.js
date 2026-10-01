// Escolhe o alarme para a barra de cima, decide o som e a página de destino.
// Notificação: { caminho, id, state, method, message, status }.

import { esc } from './rota-texto.js'

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

// 'continuo' | 'curto' | null. Um aviso com apito: 'curto' (a previsão velha da rota, desenho 3b-2,
// que é alarm) dá só o apito curto: o contínuo fica para o perigo imediato (AIS).
export function deveTocar (n) {
  if (!n || nivel(n) === 0) return null
  if (!Array.isArray(n.method) || !n.method.includes('sound')) return null
  if (n.status && (n.status.silenced || n.status.acknowledged)) return null
  if (n.apito === 'curto') return 'curto'
  return nivel(n) >= GRAVIDADE.alarm ? 'continuo' : 'curto'
}

export function paginaDoAlarme (caminho) {
  if (caminho.startsWith('notifications.rota.')) return 'melhor'
  if (caminho.includes('.caixanegra.velas')) return 'velas'
  if (caminho.includes('.caixanegra.')) return 'diario'
  if (caminho.includes('.ais.')) return 'ais'
  if (/energia|propulsion|electrical|tanks/.test(caminho)) return 'motor'
  return 'carta'
}

// Bip curto só no momento em que a ligação ao SignalK cai (não a cada tentativa
// falhada de religar, nem no arranque).
export function bipDeLigacao (estavaLigado, ligado) {
  return estavaLigado === true && ligado === false
}

// O chip do alarme na barra de cima (o mais grave), com o "silenciar" se apita. O texto vem dos plugins
// (eventos da rota, nomes dos destinos do Ivo): passa sempre pelo esc.
export function chipAlarme (al) {
  if (!al) return ''
  return `<span class="chip ${al.state === 'warn' || al.state === 'alert' ? 'aviso' : 'alarme'}" data-acao="ir-alarme" data-caminho="${esc(al.caminho)}">⚠ ${esc(al.message || al.caminho)}${al.id && !al.status?.silenced && al.method?.includes('sound') ? `<span class="x" data-acao="silenciar" data-id="${esc(al.id)}">silenciar</span>` : ''}</span>`
}
