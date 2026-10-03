// Os erros dos pedidos em pt-PT, iguais em todas as páginas (auditoria K-11 e I-32): nunca o código HTTP
// cru, o "Failed to fetch" do browser nem o inglês do SignalK. O erro verdadeiro fica no detalhe do erro
// (e.detalhe), para o registo do ecrã (window.arlequin.app.erros).

// Com a segurança do SignalK ligada, a conta "read/write" do ecrã sem sessão (ou uma rota só de admin): 401.
export const SEM_AUTORIZACAO = 'o SignalK recusou o pedido (sem sessão iniciada neste ecrã?): entra no SignalK e tenta outra vez'
export const SEM_LIGACAO = 'sem ligação ao SignalK'

// As mensagens da API v2 do SignalK (notificações) que o ecrã pode receber.
const DO_SERVIDOR = {
  'Cannot silence Emergency Alarm!': 'um alarme de emergência não se silencia: só se reconhece',
  'Alarm cannot be silenced!': 'este alarme não se pode silenciar',
  'Alarm already silenced or acknowledged!': 'o alarme já estava silenciado',
  'Alarm cannot be acknowledged!': 'este alarme não se pode reconhecer',
  'Alarm already acknowledged!': 'o alarme já estava reconhecido',
  // o id que o ecrã tem já não está no servidor (reiniciou?), ou não é um id do servidor
  'Alarm not found!': 'o SignalK já não tem este alarme',
  'Invalid Data supplied.': 'o id do alarme não é válido',
  // settings.notifications.manageNotifications: false (o ecrã cala então pelo caminho)
  'Core notification management is disabled on this server.': 'o SignalK não está a gerir os alarmes (as notificações estão desligadas nas definições)'
}
export const doServidor = (m) => (typeof m === 'string' ? DO_SERVIDOR[m.trim()] ?? null : null)

// Uma mensagem que explica (a do plugin, em pt-PT), não só o código. A única definição: a Melhor rota
// (paginas/melhor/pedir.js) importa-a daqui (revisão F3, Minor 15).
export const explicado = (m) => typeof m === 'string' && m.trim() !== '' && !/^\d{3}$/.test(m.trim()) && m !== SEM_LIGACAO

// A frase do que falhou. quem: "o plugin do gasóleo", "a caixa negra", "a AI", "o diário"…
export function motivo (err, quem = 'o plugin') {
  const s = err?.status
  const m = err?.message
  const f = /^a\s/i.test(quem) // feminino: "a AI não está instalada"
  if (!s) return `${quem} não responde`
  if (s === 401 || s === 403) return SEM_AUTORIZACAO
  if (explicado(m)) return m.trim()
  if (s === 404) return `${quem} não está ${f ? 'instalada ou ligada' : 'instalado ou ligado'}`
  if (s === 503) return `${quem} não está ${f ? 'ligada' : 'ligado'}`
  return `${quem} deu um erro (HTTP ${s})`
}

// A falha do POST /janela do plugin do ecrã (as janelas do OpenCPN ou o modo noite dele), para a barra: curta,
// porque a barra tem pouco espaço; fica até um pedido seguinte correr bem.
export function falhaJanela (err, corpo = {}) {
  const s = err?.status
  if (s === 401 || s === 403) return 'OpenCPN: sem permissão (entra no SignalK)'
  if (!s) return 'OpenCPN: sem ligação ao plugin do ecrã'
  return typeof corpo?.noite === 'boolean' ? 'OpenCPN: o modo noite não mudou' : 'OpenCPN: as janelas não mudaram'
}

// A falha do silenciar/reconhecer de um alarme, para a barra (curta, em pt-PT; revisão F3, Important 4: também as
// recusas do caminho v1 — o PUT …/method responde só com o código).
const CALAR_CODIGO = {
  404: 'o SignalK já não tem este alarme',
  405: 'o SignalK não deixa calar este alarme',
  501: DO_SERVIDOR['Core notification management is disabled on this server.']
}
export function falhaCalar (err, acao = 'silenciar') {
  const s = err?.status
  const o = acao === 'reconhecer' ? 'não reconheceu' : 'não silenciou'
  if (s === 401 || s === 403) return `${o}: sem permissão (entra no SignalK)`
  if (!s) return `${o}: ${SEM_LIGACAO}`
  if (explicado(err.message)) return `${o}: ${err.message.trim()}`
  if (CALAR_CODIGO[s]) return `${o}: ${CALAR_CODIGO[s]}`
  return `${o}: o SignalK recusou (HTTP ${s})`
}
