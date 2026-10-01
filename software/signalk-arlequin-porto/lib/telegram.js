'use strict'
// Cliente mínimo da API de bots do Telegram. Só ligações de SAÍDA (long
// polling): o barco não abre portas. `base` muda para o Telegram falso nos testes.

function criarTelegram ({ token, base = 'https://api.telegram.org', fetchFn = globalThis.fetch }) {
  const url = (metodo) => `${base}/bot${token}/${metodo}`

  async function chamar (metodo, corpo) {
    const r = await fetchFn(url(metodo), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    })
    const j = await r.json()
    if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`)
    return j.result
  }

  // multipart/form-data (fotografias e ficheiros): o campo do ficheiro com o nome dado
  async function enviarFicheiro (metodo, chatId, campo, dados, tipo, nomeFicheiro, caption) {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    if (caption) form.append('caption', caption)
    form.append(campo, new Blob([dados], { type: tipo }), nomeFicheiro)
    const r = await fetchFn(url(metodo), { method: 'POST', body: form })
    const j = await r.json()
    if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`)
    return j.result
  }

  return {
    getUpdates: (offset, timeout = 25) => chamar('getUpdates', { offset, timeout, allowed_updates: ['message'] }),
    sendMessage: (chatId, text) => chamar('sendMessage', { chat_id: chatId, text }),
    sendLocation: (chatId, latitude, longitude) => chamar('sendLocation', { chat_id: chatId, latitude, longitude }),
    sendPhoto: (chatId, jpeg, caption) => enviarFicheiro('sendPhoto', chatId, 'photo', jpeg, 'image/jpeg', 'foto.jpg', caption),
    // um ficheiro qualquer (o GPX do plano de navegação)
    sendDocument: (chatId, dados, nomeFicheiro, caption) => enviarFicheiro('sendDocument', chatId, 'document', dados, String(nomeFicheiro).endsWith('.gpx') ? 'application/gpx+xml' : 'application/octet-stream', nomeFicheiro, caption)
  }
}

module.exports = { criarTelegram }
