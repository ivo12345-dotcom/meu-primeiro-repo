// Escolhe o alarme para a barra de cima, decide o som e a página de destino.
// Notificação: { caminho, id, state, method, message, status }.

import { esc } from './rota-texto.js'

// A gravidade de cada estado do SignalK (uma só fonte: a barra, os avisos da rota no Leme e a lista do Motor).
export const GRAVIDADE = Object.freeze({ normal: 0, nominal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 })
// A cor do texto de cada gravidade nas listas: o alerta sem cor, o aviso âmbar, o alarme e a emergência a vermelho.
export const COR_GRAVIDADE = Object.freeze({ alert: '', warn: 'atencao', alarm: 'perigo', emergency: 'perigo' })

export const nivel = (n) => GRAVIDADE[n?.state] ?? 0

// As ativas (acima de normal), da mais grave para a menos; entre iguais, pela ordem de chegada (revisão F3,
// Important 3: a lista do Motor vinha pela ordem de chegada e a mais grave podia ficar por baixo).
export const porGravidade = (lista) => [...(lista || [])].filter(n => nivel(n) > 0).sort((a, b) => nivel(b) - nivel(a))

// O mais grave para a barra. Entre os da mesma gravidade, primeiro o que ainda apita (auditoria I-08: com
// dois alarmes AIS, o chip ficava preso no 1.º, já silenciado, e o 2.º — o que apitava — não se calava).
export function maisGrave (lista) {
  let melhor = null
  for (const n of lista) {
    if (nivel(n) === 0) continue
    if (!melhor || nivel(n) > nivel(melhor) || (nivel(n) === nivel(melhor) && deveTocar(n) && !deveTocar(melhor))) melhor = n
  }
  return melhor
}

// 'continuo' | 'curto' | null (contrato C1, decisão do Ivo n.º 2 de 02/10). O apito contínuo quer dizer
// "levanta-te já": só o perigo imediato, que os plugins marcam com apito: 'continuo' no valor da notificação
// (colisão AIS, fumo, água no porão, fuga de gasóleo, motor a sobreaquecer). Sem o campo apito (um plugin
// de antes do contrato, ou de terceiros) só a emergência dá o contínuo. Tudo o resto com som — o disco a
// 95 %, a bateria do motor fraca, o serviço crítico, os avisos da rota (apito: 'curto'), um alarm sem o
// campo — dá o apito curto. Silenciado, reconhecido ou sem som: nada.
export function deveTocar (n) {
  if (!n || nivel(n) === 0) return null
  if (!Array.isArray(n.method) || !n.method.includes('sound')) return null
  if (n.status && (n.status.silenced || n.status.acknowledged)) return null
  if (n.apito === 'continuo') return 'continuo'
  if (n.apito == null && n.state === 'emergency') return 'continuo'
  return 'curto'
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

// Como calar uma notificação que apita (auditoria I-08): 'silenciar' onde o servidor deixa (o SignalK recusa
// silenciar uma emergência, "Cannot silence Emergency Alarm!", e respeita o canSilence de cada uma);
// senão 'reconhecer' (o reconhecido deixa de apitar e continua à vista); senão null. Só com o id do
// servidor e enquanto apita.
export function acaoCalar (al) {
  if (!al?.id || !deveTocar(al)) return null
  const st = al.status || {}
  if (al.state !== 'emergency' && st.canSilence !== false) return 'silenciar'
  if (st.canAcknowledge !== false) return 'reconhecer'
  return null
}

// O botão de calar, para o dedo (44 px), fora do chip que leva à página do alarme.
export function botaoCalar (al) {
  const a = acaoCalar(al)
  return a ? `<button class="silenciar" data-acao="${a}" data-id="${esc(al.id)}">${a}</button>` : ''
}

// O chip do alarme na barra de cima (o mais grave) e, ao lado, o botão de calar. O texto vem dos plugins
// (eventos da rota, nomes dos destinos do Ivo): passa sempre pelo esc.
export function chipAlarme (al) {
  if (!al) return ''
  return `<span class="chip ${al.state === 'warn' || al.state === 'alert' ? 'aviso' : 'alarme'}" data-acao="ir-alarme" data-caminho="${esc(al.caminho)}">⚠ ${esc(al.message || al.caminho)}</span>${botaoCalar(al)}`
}
