// Escolhe o alarme para a barra de cima, decide o som e a página de destino, e cala-o.
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

// O mais grave. Entre os da mesma gravidade, primeiro o que ainda apita (auditoria I-08: com dois alarmes AIS, o
// chip ficava preso no 1.º, já silenciado, e o 2.º — o que apitava — não se calava).
export function maisGrave (lista) {
  let melhor = null
  for (const n of lista) {
    if (nivel(n) === 0) continue
    if (!melhor || nivel(n) > nivel(melhor) || (nivel(n) === nivel(melhor) && deveTocar(n) && !deveTocar(melhor))) melhor = n
  }
  return melhor
}

// O alarme da barra de cima (revisão F3, Important 4): o que está a apitar agora, com o botão dele — primeiro o
// de apito contínuo por calar, depois o de apito curto por calar, só depois os já calados (reconhecidos,
// silenciados ou sem som); dentro de cada grupo o mais grave e, entre iguais, o primeiro. Antes ia sempre o mais
// grave: com o fumo já reconhecido, a água no porão apitava sem botão na barra (e o toque no chip levava à
// Carta, sem nada para calar). Calado um, o seguinte que apita passa para a barra: calam-se todos, um a um.
const GRUPO = { continuo: 0, curto: 1 }
export function alarmeDaBarra (lista) {
  let melhor = null
  let chave = null
  for (const n of lista || []) {
    if (nivel(n) === 0) continue
    const c = [GRUPO[deveTocar(n)] ?? 2, -nivel(n)]
    if (!melhor || c[0] < chave[0] || (c[0] === chave[0] && c[1] < chave[1])) { melhor = n; chave = c }
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

// ---------- calar ----------
// Como o SignalK 2.33 cala uma notificação (api/notifications): pelo id que o gestor das notificações lhe dá
// (POST /signalk/v2/api/notifications/<id>/silence ou /acknowledge; o servidor guarda o calado no alarme e
// recusa silenciar uma emergência: "Cannot silence Emergency Alarm!"); sem esse id — o SignalK com a gestão das
// notificações desligada (settings.notifications.manageNotifications: false; aí a API v2 responde 501) ou um
// valor sem id — pelo caminho: PUT /signalk/v1/api/vessels/self/<caminho>/method = ['visual'] (o put.js do
// servidor muda o method da notificação: deixa de apitar e continua à vista).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idDoServidor = (n) => (typeof n?.id === 'string' && UUID.test(n.id) ? n.id : null)
export const NAO_DEIXA = 'não se cala no ecrã: o SignalK não deixa'

// 'silenciar' | 'reconhecer' | null, só enquanto apita (auditoria I-08). Com o id do servidor: 'silenciar' onde ele
// deixa (nunca a emergência, nem canSilence: false), senão 'reconhecer' (o reconhecido deixa de apitar e continua
// à vista), senão null (o servidor não deixa nenhum dos dois). Sem o id: pelo caminho, 'reconhecer' na emergência
// (fica à vista, como no servidor) e 'silenciar' no resto.
export function acaoCalar (al) {
  if (!deveTocar(al)) return null
  if (!idDoServidor(al)) return al.state === 'emergency' ? 'reconhecer' : 'silenciar'
  const st = al.status || {}
  if (al.state !== 'emergency' && st.canSilence !== false) return 'silenciar'
  if (st.canAcknowledge !== false) return 'reconhecer'
  return null
}

// Os atributos do botão de calar: o id do servidor, ou (sem ele) o caminho.
export const dadosCalar = (al) => (idDoServidor(al) ? `data-id="${esc(al.id)}"` : `data-caminho="${esc(al.caminho)}"`)

// O botão de calar, para o dedo (44 px), fora do chip que leva à página do alarme; a apitar sem maneira de o
// calar (o servidor não deixa), o porquê.
export function botaoCalar (al) {
  const a = acaoCalar(al)
  if (a) return `<button class="silenciar" data-acao="${a}" ${dadosCalar(al)}>${a}</button>`
  return deveTocar(al) ? `<span class="chip falha calar">${NAO_DEIXA}</span>` : ''
}

// Cala uma notificação (acao: 'silenciar' | 'reconhecer') com o pedir do ecrã (signalk.js: o erro já vem em pt-PT).
// Pelo id; se o servidor não gere as notificações (501), pelo caminho; sem id, pelo caminho. Outra recusa (ex.: a
// emergência que não se silencia) passa para quem chama (a barra mostra-a).
export async function calar (n, acao, pedir) {
  const id = idDoServidor(n)
  if (id) {
    try {
      return await pedir(`/signalk/v2/api/notifications/${encodeURIComponent(id)}/${acao === 'reconhecer' ? 'acknowledge' : 'silence'}`, { method: 'POST' })
    } catch (err) {
      if (err?.status !== 501 || !n.caminho) throw err
    }
  }
  if (typeof n?.caminho !== 'string' || !n.caminho.startsWith('notifications.')) throw Object.assign(new Error('o SignalK já não tem este alarme'), { status: 404 })
  return pedir(`/signalk/v1/api/vessels/self/${n.caminho.split('.').map(encodeURIComponent).join('/')}/method`, { method: 'PUT', body: { value: ['visual'] } })
}

// O chip do alarme na barra de cima e, ao lado, o botão de calar. O texto vem dos plugins (eventos da rota, nomes
// dos destinos do Ivo): passa sempre pelo esc.
export function chipAlarme (al) {
  if (!al) return ''
  return `<span class="chip ${al.state === 'warn' || al.state === 'alert' ? 'aviso' : 'alarme'}" data-acao="ir-alarme" data-caminho="${esc(al.caminho)}">⚠ ${esc(al.message || al.caminho)}</span>${botaoCalar(al)}`
}
