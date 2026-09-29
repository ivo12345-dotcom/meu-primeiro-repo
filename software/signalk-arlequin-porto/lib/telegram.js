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

  return {
    getUpdates: (offset, timeout = 25) => chamar('getUpdates', { offset, timeout, allowed_updates: ['message'] }),
    sendMessage: (chatId, text) => chamar('sendMessage', { chat_id: chatId, text }),
    sendLocation: (chatId, latitude, longitude) => chamar('sendLocation', { chat_id: chatId, latitude, longitude }),
    async sendPhoto (chatId, jpeg, caption) {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      if (caption) form.append('caption', caption)
      form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'foto.jpg')
      const r = await fetchFn(url('sendPhoto'), { method: 'POST', body: form })
      const j = await r.json()
      if (!j.ok) throw new Error(`Telegram sendPhoto: ${j.description || r.status}`)
      return j.result
    }
  }
}

module.exports = { criarTelegram }
