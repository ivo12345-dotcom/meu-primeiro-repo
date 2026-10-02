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
// Um caminho gravado ativo (encaminhador.json) que já não está na árvore desapareceu: no SignalK 2.33,
// ao parar um plugin o servidor apaga da árvore os valores dele (removeSource) e o plugin volta a
// publicar os seus alarmes ativos quando arranca; depois de um reinício do servidor a árvore vem vazia.
// Desaparecido não quer dizer resolvido (nota do SignalK 2.33, auditoria F4b): o estado fica; se o
// caminho volta ainda ativo, não se repete; se volta normal, o "✓ Resolvido"; se não volta em 2 min (o
// plugin arrancou e já não o tem ativo), o "✓ Resolvido" também. Antes (revisão final C2) passava logo
// a normal sem mensagem: o alarme que voltava repetia-se e o que limpara nunca tinha o "Resolvido".

const ICONE = { warn: '⚠️', alert: '⚠️', alarm: '🚨', emergency: '🔥' }
const ATIVO = new Set(['warn', 'alert', 'alarm', 'emergency'])
const GRACA_MS = 2 * 60 * 1000 // o tempo que um caminho desaparecido tem para voltar antes do "Resolvido"

// porEnviar: a fila das mensagens que o Telegram ainda não aceitou (lib/fila.js, auditoria K-09);
// desaparecido: { caminho: quando saiu da árvore } dos caminhos ativos que desapareceram
function novoEncaminhador () {
  return { estados: {}, mensagem: {}, ultimoAlarme: {}, pendente: {}, desaparecido: {}, porEnviar: [] }
}

// notificacoes: [{ caminho, state, message }]
// O limite de 10 min só trava ALARMES repetidos do mesmo caminho; o "resolvido"
// de um alarme que foi enviado segue sempre (senão ficava-se a julgar que continua).
const SO_ALARME = ['notifications.arlequin.caixanegra.disco', 'notifications.rota.previsao']
// Lembretes e avisos só para o ecrã: nunca seguem para o Telegram. Também os de uma sonda, de um sensor
// ou de uma ligação perdidos, de qualquer plugin (contrato C11: os caminhos que acabam em .sondaPerdida,
// .sensorPerdido ou .semLigacao).
const NUNCA = ['notifications.arlequin.caixanegra.velas', 'notifications.arlequin.caixanegra.relogio', 'notifications.rota.lembrete.', 'notifications.rota.comer', 'notifications.rota.alarmeTerra', '.sondaPerdida', '.sensorPerdido', '.semLigacao']
const GRAVE = new Set(['alarm', 'emergency'])
// Um caminho das listas: exato; um que acaba em ponto final é um prefixo (notifications.rota.lembrete.);
// um que começa por ponto, o fim do caminho (.sondaPerdida)
const casa = (caminho, p) => (p.startsWith('.') ? caminho.endsWith(p) : p.endsWith('.') ? caminho.startsWith(p) : caminho === p)
const casaAlgum = (caminho, lista) => lista.some(p => casa(caminho, p))
// O texto de uma notificação; sem ele, uma frase em pt-PT com o caminho entre parênteses (auditoria
// I-32: antes ia só o caminho, em inglês)
const descricao = (n, state = n.state) => n.message || `${GRAVE.has(state) ? 'Alarme' : 'Aviso'} sem descrição (${String(n.caminho).replace(/^notifications\./, '')})`

// → { enc, mensagens: [texto], itens: [{ texto, caminho, estado }] } (os itens: as mesmas mensagens com o
// caminho e o estado, para a fila do Telegram as ordenar: lib/fila.js)
function encaminhar (enc0, notificacoes, agora, { intervalo = 10 * 60 * 1000, graca = GRACA_MS, amarrado = false, ignorarAmarrado = ['notifications.arlequin.ais.'], nunca = NUNCA, soAlarme = SO_ALARME } = {}) {
  const enc = { estados: { ...enc0.estados }, mensagem: { ...enc0.mensagem }, ultimoAlarme: { ...enc0.ultimoAlarme }, pendente: { ...enc0.pendente }, desaparecido: { ...enc0.desaparecido }, porEnviar: [...(enc0.porEnviar || [])] }
  const mensagens = []
  const itens = []
  const enviar = (texto, caminho, estado) => { mensagens.push(texto); itens.push({ texto, caminho, estado }) }
  const resolvido = (caminho) => {
    enviar(`✓ Resolvido: ${enc.mensagem[caminho] || descricao({ caminho }, 'alarm')}`, caminho, 'normal')
    delete enc.pendente[caminho]
  }
  for (const n of notificacoes) {
    if (casaAlgum(n.caminho, nunca)) { // só para o ecrã (o que uma versão antiga gravou dele esquece-se, sem mensagem)
      for (const k of ['estados', 'mensagem', 'ultimoAlarme', 'pendente', 'desaparecido']) delete enc[k][n.caminho]
      continue
    }
    delete enc.desaparecido[n.caminho] // está na árvore (ou voltou)
    const antes = enc.estados[n.caminho] || 'normal'
    const soGrave = casaAlgum(n.caminho, soAlarme)
    // Para estes caminhos um aviso conta como normal: não segue, e o "resolvido" só sai se houve alarme.
    const agoraEstado = ATIVO.has(n.state) && (!soGrave || GRAVE.has(n.state)) ? n.state : 'normal'
    enc.estados[n.caminho] = agoraEstado
    if (agoraEstado === antes) continue
    if (agoraEstado !== 'normal') {
      // Amarrado, um alarme AIS não segue e o estado novo não se grava (como no K-08: auditoria F4b,
      // revisão da F4, Menor 10): segue quando o barco deixar de estar amarrado, se ainda estiver ativo.
      // Antes gravava-se e nunca seguia (ao largar, o minuto e meio antes de o ponto se apagar).
      if (amarrado && casaAlgum(n.caminho, ignorarAmarrado)) { enc.estados[n.caminho] = antes; continue }
      // Travado pelos 10 min: o estado novo não se grava (auditoria K-08). Fica o anterior, volta a
      // avaliar-se em cada ciclo e segue logo que passem os 10 min, se ainda estiver ativo (um porão
      // que volta a meter água, ou uma escalada warn → alarm, não se perdem).
      if (enc.ultimoAlarme[n.caminho] !== undefined && agora - enc.ultimoAlarme[n.caminho] < intervalo) { enc.estados[n.caminho] = antes; continue }
      const texto = descricao(n, agoraEstado)
      enviar(`${ICONE[agoraEstado]} ${texto}`, n.caminho, agoraEstado)
      enc.mensagem[n.caminho] = texto
      enc.ultimoAlarme[n.caminho] = agora
      enc.pendente[n.caminho] = true
    } else if (enc.pendente[n.caminho]) {
      // o "Resolvido" de um alarme que foi enviado segue sempre, também amarrado
      resolvido(n.caminho)
    }
  }
  // Os ativos que desapareceram da árvore: o estado fica à espera que voltem; ao fim da graça sem eles,
  // passam a normal com o "✓ Resolvido" (se o alarme foi enviado). Um relógio que andou para trás
  // recomeça a contagem (não a prende).
  const presentes = new Set(notificacoes.map(n => n.caminho))
  for (const [caminho, estado] of Object.entries(enc.estados)) {
    if (estado === 'normal' || presentes.has(caminho)) continue
    const desde = enc.desaparecido[caminho]
    if (desde === undefined || !(agora >= desde)) { enc.desaparecido[caminho] = agora; continue }
    if (agora - desde < graca) continue
    delete enc.desaparecido[caminho]
    enc.estados[caminho] = 'normal'
    if (enc.pendente[caminho]) resolvido(caminho)
  }
  for (const caminho of Object.keys(enc.desaparecido)) if ((enc.estados[caminho] || 'normal') === 'normal') delete enc.desaparecido[caminho]
  return { enc, mensagens, itens }
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

// Alarmes ativos para o /estado do Telegram (sem os lembretes só do ecrã): os mesmos estados que o
// encaminhador conta como ativos, também o alert (auditoria M-54).
function alarmesAtivos (lista, nunca = NUNCA) {
  return lista
    .filter(n => ATIVO.has(n.state) && !casaAlgum(n.caminho, nunca))
    .map(n => descricao(n))
}

module.exports = { novoEncaminhador, encaminhar, listarNotificacoes, alarmesAtivos, ATIVO, NUNCA, SO_ALARME }
