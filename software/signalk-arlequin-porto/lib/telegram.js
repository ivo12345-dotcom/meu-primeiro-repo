'use strict'
// Cliente mínimo da API de bots do Telegram. Só ligações de SAÍDA (long
// polling): o barco não abre portas. `base` muda para o Telegram falso nos testes.
// Cada chamada tem um limite de tempo (limiteMs, 10 s); o getUpdates, que fica à espera até
// `timeout` s (long polling), tem esse tempo mais o limite. Os erros trazem `codigo` e `descricao`
// quando o Telegram respondeu, ou `semLigacao` quando não respondeu (sem rede, recusado, o limite).

const LIMITE_MS = 10000

function criarTelegram ({ token, base = 'https://api.telegram.org', fetchFn = globalThis.fetch, limiteMs = LIMITE_MS }) {
  const url = (metodo) => `${base}/bot${token}/${metodo}`

  async function pedir (metodo, opcoes, ms = limiteMs) {
    let r
    try {
      r = await fetchFn(url(metodo), { ...opcoes, signal: AbortSignal.timeout(ms) })
    } catch (e) {
      const porque = e?.name === 'TimeoutError' ? `sem resposta em ${Math.round(ms / 1000)} s` : e?.cause?.code || e?.message
      throw Object.assign(new Error(`Telegram ${metodo}: sem ligação (${porque})`), { semLigacao: true })
    }
    let j
    try { j = await r.json() } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw Object.assign(new Error(`Telegram ${metodo}: sem ligação (a resposta não chegou toda)`), { semLigacao: true })
      throw Object.assign(new Error(`Telegram ${metodo}: resposta inválida (HTTP ${r.status})`), { codigo: r.status, descricao: `resposta inválida (HTTP ${r.status})` })
    }
    if (!j.ok) {
      const descricao = j.description || `HTTP ${r.status}`
      throw Object.assign(new Error(`Telegram ${metodo}: ${descricao}`), { codigo: j.error_code ?? r.status, descricao })
    }
    return j.result
  }

  const chamar = (metodo, corpo, ms) => pedir(metodo, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }, ms)

  // multipart/form-data (fotografias e ficheiros): o campo do ficheiro com o nome dado
  function enviarFicheiro (metodo, chatId, campo, dados, tipo, nomeFicheiro, caption) {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    if (caption) form.append('caption', caption)
    form.append(campo, new Blob([dados], { type: tipo }), nomeFicheiro)
    return pedir(metodo, { method: 'POST', body: form })
  }

  return {
    getUpdates: (offset, timeout = 25) => chamar('getUpdates', { offset, timeout, allowed_updates: ['message'] }, timeout * 1000 + limiteMs),
    sendMessage: (chatId, text) => chamar('sendMessage', { chat_id: chatId, text }),
    sendLocation: (chatId, latitude, longitude) => chamar('sendLocation', { chat_id: chatId, latitude, longitude }),
    sendPhoto: (chatId, jpeg, caption) => enviarFicheiro('sendPhoto', chatId, 'photo', jpeg, 'image/jpeg', 'foto.jpg', caption),
    // um ficheiro qualquer (o GPX do plano de navegação; .gpx em maiúsculas ou minúsculas)
    sendDocument: (chatId, dados, nomeFicheiro, caption) => enviarFicheiro('sendDocument', chatId, 'document', dados, /\.gpx$/i.test(String(nomeFicheiro)) ? 'application/gpx+xml' : 'application/octet-stream', nomeFicheiro, caption)
  }
}

// O erro de uma chamada em pt-PT, para o ecrã (falhas[].erro do plano).
function erroEmPortugues (e) {
  if (e?.semLigacao) return 'sem ligação ao Telegram'
  if (e?.codigo === 403) return 'bloqueou o bot'
  if (e?.codigo != null) return `erro do Telegram: ${e.descricao}`
  return `erro do Telegram: ${e?.message ?? e}`
}

module.exports = { criarTelegram, erroEmPortugues, LIMITE_MS }
