'use strict'
// Cliente mínimo da API de bots do Telegram. Só ligações de SAÍDA (long
// polling): o barco não abre portas. `base` muda para o Telegram falso nos testes.
// Cada chamada tem um limite de tempo (limiteMs, 10 s); o getUpdates, que fica à espera até
// `timeout` s (long polling), tem esse tempo mais o limite, e pode ser cortado por quem o pediu (o
// sinal: o stop() do plugin, auditoria I-22) — aí o erro traz `cancelado`. Os erros trazem `codigo` e
// `descricao` quando o Telegram respondeu (e `esperarS`, o retry_after de um 429), ou `semLigacao`
// quando não respondeu (sem rede, recusado, o limite).

const LIMITE_MS = 10000

function criarTelegram ({ token, base = 'https://api.telegram.org', fetchFn = globalThis.fetch, limiteMs = LIMITE_MS }) {
  const url = (metodo) => `${base}/bot${token}/${metodo}`
  const cancelado = (metodo) => Object.assign(new Error(`Telegram ${metodo}: cancelado`), { cancelado: true })
  // o token nunca entra num erro (vai para o registo e para o ecrã), mesmo que um texto de fora o traga
  // (uma mensagem do fetch com o URL inteiro)
  const semToken = (texto) => (token ? String(texto).split(String(token)).join('<token>') : String(texto))

  async function pedir (metodo, opcoes, ms = limiteMs, sinal = null) {
    const signal = sinal ? AbortSignal.any([AbortSignal.timeout(ms), sinal]) : AbortSignal.timeout(ms)
    let r
    try {
      r = await fetchFn(url(metodo), { ...opcoes, signal })
    } catch (e) {
      if (sinal?.aborted) throw cancelado(metodo)
      const porque = e?.name === 'TimeoutError' ? `sem resposta em ${Math.round(ms / 1000)} s` : e?.cause?.code || e?.message
      throw Object.assign(new Error(`Telegram ${metodo}: sem ligação (${semToken(porque)})`), { semLigacao: true })
    }
    let j
    try { j = await r.json() } catch (e) {
      if (sinal?.aborted) throw cancelado(metodo)
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw Object.assign(new Error(`Telegram ${metodo}: sem ligação (a resposta não chegou toda)`), { semLigacao: true })
      throw Object.assign(new Error(`Telegram ${metodo}: resposta inválida (HTTP ${r.status})`), { codigo: r.status, descricao: `resposta inválida (HTTP ${r.status})` })
    }
    if (!j.ok) {
      const descricao = semToken(j.description || `HTTP ${r.status}`)
      const esperarS = Number.isFinite(j.parameters?.retry_after) ? j.parameters.retry_after : null
      throw Object.assign(new Error(`Telegram ${metodo}: ${descricao}`), { codigo: j.error_code ?? r.status, descricao, esperarS })
    }
    return j.result
  }

  const chamar = (metodo, corpo, ms, sinal) => pedir(metodo, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }, ms, sinal)

  // multipart/form-data (fotografias e ficheiros): o campo do ficheiro com o nome dado
  function enviarFicheiro (metodo, chatId, campo, dados, tipo, nomeFicheiro, caption) {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    if (caption) form.append('caption', caption)
    form.append(campo, new Blob([dados], { type: tipo }), nomeFicheiro)
    return pedir(metodo, { method: 'POST', body: form })
  }

  return {
    getUpdates: (offset, timeout = 25, sinal = null) => chamar('getUpdates', { offset, timeout, allowed_updates: ['message'] }, timeout * 1000 + limiteMs, sinal),
    sendMessage: (chatId, text) => chamar('sendMessage', { chat_id: chatId, text }),
    sendLocation: (chatId, latitude, longitude) => chamar('sendLocation', { chat_id: chatId, latitude, longitude }),
    sendPhoto: (chatId, jpeg, caption) => enviarFicheiro('sendPhoto', chatId, 'photo', jpeg, 'image/jpeg', 'foto.jpg', caption),
    // um ficheiro qualquer (o GPX do plano de navegação; .gpx em maiúsculas ou minúsculas)
    sendDocument: (chatId, dados, nomeFicheiro, caption) => enviarFicheiro('sendDocument', chatId, 'document', dados, /\.gpx$/i.test(String(nomeFicheiro)) ? 'application/gpx+xml' : 'application/octet-stream', nomeFicheiro, caption)
  }
}

// O erro de uma chamada em pt-PT, para o ecrã (falhas[].erro do plano) e para o Telegram: nunca a
// descrição em inglês do Telegram (auditoria I-32; o pormenor fica no registo). null: um erro que não
// se conhece.
function erroConhecido (e) {
  const d = String(e?.descricao ?? '')
  if (e?.semLigacao) return 'sem ligação ao Telegram'
  if (e?.codigo === 403) return /kicked/i.test(d) ? 'tirou o bot do grupo' : /deactivated/i.test(d) ? 'a conta do Telegram já não existe' : 'bloqueou o bot'
  if (e?.codigo === 400 && /chat not found/i.test(d)) return 'o chat não existe ou nunca falou com o bot: confirma o código'
  if (e?.codigo === 400 && /too long/i.test(d)) return 'a mensagem é demasiado longa para o Telegram'
  if (e?.codigo === 400 && /text is empty/i.test(d)) return 'a mensagem está vazia'
  if (e?.codigo === 413 || (e?.codigo === 400 && /too (big|large)/i.test(d))) return 'o ficheiro é demasiado grande para o Telegram'
  if (e?.codigo === 401 || e?.codigo === 404) return 'token do bot inválido'
  if (e?.codigo === 409) return 'outro programa está a ler as mensagens deste bot'
  if (e?.codigo === 429) return `o Telegram pediu para esperar: tenta daqui a ${Number.isFinite(e.esperarS) ? `${e.esperarS} s` : 'pouco'}`
  if (Number.isInteger(e?.codigo) && e.codigo >= 500) return `o Telegram está com problemas (código ${e.codigo})`
  return null
}
function erroEmPortugues (e) {
  return erroConhecido(e) ?? (e?.codigo != null ? `erro do Telegram (código ${e.codigo})` : 'erro do Telegram')
}

// Uma recusa do Telegram que não passa com outra tentativa (auditoria F4b, revisão da F4, Importante 1):
// 'chat' (esse chat não recebe nada: bloqueou o bot, não existe, um código mal escrito) ou 'mensagem' (o
// Telegram não aceita esse texto: demasiado longo, vazio, mal codificado — qualquer outro 400). null: a
// que passa com o tempo (sem rede, o Telegram com problemas, 429, o token inválido que se corrige na
// configuração, um erro do programa).
const RECUSA_DO_CHAT = /chat not found|peer_id_invalid|user not found|chat_write_forbidden|not enough rights|have no rights|bot was blocked|bot is not a member|group chat was upgraded/i
function recusaDoTelegram (e) {
  if (e?.semLigacao || e?.cancelado) return null
  if (e?.codigo === 403) return 'chat'
  if (e?.codigo === 400) return RECUSA_DO_CHAT.test(String(e?.descricao ?? '')) ? 'chat' : 'mensagem'
  if (e?.codigo === 413) return 'mensagem'
  return null
}

module.exports = { criarTelegram, erroEmPortugues, erroConhecido, recusaDoTelegram, LIMITE_MS }
