'use strict'
// Que notificações seguem para o Telegram: só as mudanças de estado (normal →
// aviso/alarme e de volta), cada caminho no máximo de 10 em 10 min enquanto
// oscilar. No porto (amarrado), os alarmes AIS não seguem: um navio a passar ao
// largo da marina não é perigo para um barco amarrado. Alguns caminhos só
// seguem em alarme (o aviso dos 80% do disco fica no ecrã: só os 95% contam).
// A navegar (desenho 3b-2): os lembretes de evento e o "come e bebe" da rota ficam só no ecrã; a
// previsão velha só segue em alarme (mais de 12 h); recalcula, recursos e barómetro seguem.
// O lembrete da hora de alarme em terra (notifications.rota.alarmeTerra) também fica só no ecrã: a lista dos
// avisos para o Telegram é decisão do Ivo.
// Tudo isto só para os chats autorizados (o do Ivo), nunca para os contactos do plano.
// Um caminho gravado ativo (encaminhador.json) que já não está na árvore desapareceu (o servidor
// reiniciou: a árvore das notificações vem vazia), não se resolveu: passa a normal sem mensagem, e um
// alarme que volte a ser publicado segue outra vez (revisão final C2: mais vale repetido do que perdido).

const ICONE = { warn: '⚠️', alert: '⚠️', alarm: '🚨', emergency: '🔥' }
const ATIVO = new Set(['warn', 'alert', 'alarm', 'emergency'])

// porEnviar: a fila das mensagens que o Telegram ainda não aceitou (lib/fila.js, auditoria K-09)
function novoEncaminhador () {
  return { estados: {}, mensagem: {}, ultimoAlarme: {}, pendente: {}, porEnviar: [] }
}

// notificacoes: [{ caminho, state, message }]
// O limite de 10 min só trava ALARMES repetidos do mesmo caminho; o "resolvido"
// de um alarme que foi enviado segue sempre (senão ficava-se a julgar que continua).
const SO_ALARME = ['notifications.arlequin.caixanegra.disco', 'notifications.rota.previsao']
// Lembretes e avisos só para o ecrã: nunca seguem para o Telegram.
const NUNCA = ['notifications.arlequin.caixanegra.velas', 'notifications.arlequin.caixanegra.relogio', 'notifications.rota.lembrete.', 'notifications.rota.comer', 'notifications.rota.alarmeTerra']
const GRAVE = new Set(['alarm', 'emergency'])
// Um caminho das listas: exato; só um que acaba em ponto final é um prefixo (notifications.rota.lembrete.)
const casa = (caminho, p) => (p.endsWith('.') ? caminho.startsWith(p) : caminho === p)
const casaAlgum = (caminho, lista) => lista.some(p => casa(caminho, p))
// O texto de uma notificação; sem ele, uma frase em pt-PT com o caminho entre parênteses (auditoria
// I-32: antes ia só o caminho, em inglês)
const descricao = (n, state = n.state) => n.message || `${GRAVE.has(state) ? 'Alarme' : 'Aviso'} sem descrição (${String(n.caminho).replace(/^notifications\./, '')})`

function encaminhar (enc0, notificacoes, agora, { intervalo = 10 * 60 * 1000, amarrado = false, ignorarAmarrado = ['notifications.arlequin.ais.'], nunca = NUNCA, soAlarme = SO_ALARME } = {}) {
  const enc = { estados: { ...enc0.estados }, mensagem: { ...enc0.mensagem }, ultimoAlarme: { ...enc0.ultimoAlarme }, pendente: { ...enc0.pendente }, porEnviar: [...(enc0.porEnviar || [])] }
  const mensagens = []
  for (const n of notificacoes) {
    if (casaAlgum(n.caminho, nunca)) continue // lembretes só para o ecrã
    const antes = enc.estados[n.caminho] || 'normal'
    const soGrave = casaAlgum(n.caminho, soAlarme)
    // Para estes caminhos um aviso conta como normal: não segue, e o "resolvido" só sai se houve alarme.
    const agoraEstado = ATIVO.has(n.state) && (!soGrave || GRAVE.has(n.state)) ? n.state : 'normal'
    enc.estados[n.caminho] = agoraEstado
    if (agoraEstado === antes) continue
    if (amarrado && casaAlgum(n.caminho, ignorarAmarrado)) continue
    if (agoraEstado !== 'normal') {
      // Travado pelos 10 min: o estado novo não se grava (auditoria K-08). Fica o anterior, volta a
      // avaliar-se em cada ciclo e segue logo que passem os 10 min, se ainda estiver ativo (um porão
      // que volta a meter água, ou uma escalada warn → alarm, não se perdem).
      if (enc.ultimoAlarme[n.caminho] !== undefined && agora - enc.ultimoAlarme[n.caminho] < intervalo) { enc.estados[n.caminho] = antes; continue }
      const texto = descricao(n, agoraEstado)
      mensagens.push(`${ICONE[agoraEstado]} ${texto}`)
      enc.mensagem[n.caminho] = texto
      enc.ultimoAlarme[n.caminho] = agora
      enc.pendente[n.caminho] = true
    } else if (enc.pendente[n.caminho]) {
      mensagens.push(`✓ Resolvido: ${enc.mensagem[n.caminho] || descricao({ caminho: n.caminho }, 'alarm')}`)
      delete enc.pendente[n.caminho]
    }
  }
  // os que desapareceram da árvore (o servidor reiniciou): normal, sem mensagem nem limite dos 10 min
  const presentes = new Set(notificacoes.map(n => n.caminho))
  for (const [caminho, estado] of Object.entries(enc.estados)) {
    if (estado === 'normal' || presentes.has(caminho)) continue
    enc.estados[caminho] = 'normal'
    delete enc.pendente[caminho]
    delete enc.ultimoAlarme[caminho]
  }
  return { enc, mensagens }
}

// Percorre a árvore notifications.* do SignalK e devolve a lista plana.
function listarNotificacoes (arvore, prefixo = 'notifications') {
  const lista = []
  if (!arvore || typeof arvore !== 'object') return lista
  if (arvore.value && typeof arvore.value === 'object' && 'state' in arvore.value) {
    lista.push({ caminho: prefixo, state: arvore.value.state, message: arvore.value.message })
  }
  for (const [k, v] of Object.entries(arvore)) {
    if (['value', 'timestamp', '$source', 'values', 'meta', 'pgn', 'sentence'].includes(k)) continue
    lista.push(...listarNotificacoes(v, `${prefixo}.${k}`))
  }
  return lista
}

// Alarmes ativos para o /estado do Telegram (sem os lembretes só do ecrã).
function alarmesAtivos (lista, nunca = NUNCA) {
  return lista
    .filter(n => ['alarm', 'emergency', 'warn'].includes(n.state) && !casaAlgum(n.caminho, nunca))
    .map(n => descricao(n))
}

module.exports = { novoEncaminhador, encaminhar, listarNotificacoes, alarmesAtivos, NUNCA, SO_ALARME }
