'use strict'
// Telegram FALSO para testes em casa: finge a API de bots (getUpdates com long
// polling, sendMessage, sendPhoto, sendLocation). Guarda o que o barco envia e
// deixa "escrever" mensagens como se fosse o telemóvel do Ivo.
//   node telegram-falso.js 8081          → servidor em http://localhost:8081
//   POST /_escrever { chatId, text }      → mensagem do "telemóvel"
//   GET  /_enviados                       → o que o barco enviou

const http = require('node:http')

function criarTelegramFalso ({ porta = 0 } = {}) {
  const enviados = []
  const fila = []
  let proximoId = 1
  const espera = [] // pedidos getUpdates em long polling

  const responder = (res, codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
  const entregar = () => {
    while (espera.length && fila.length) {
      const { res, offset } = espera.shift()
      const r = fila.filter(u => u.update_id >= offset)
      responder(res, 200, { ok: true, result: r })
    }
  }

  function escrever (chatId, text) {
    fila.push({ update_id: proximoId++, message: { message_id: proximoId, chat: { id: chatId }, from: { id: chatId }, date: Math.floor(Date.now() / 1000), text } })
    entregar()
  }

  const servidor = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => {
      const corpo = Buffer.concat(partes)
      const url = req.url
      if (url === '/_enviados') return responder(res, 200, enviados)
      if (url === '/_escrever') { const j = JSON.parse(corpo.toString() || '{}'); escrever(j.chatId, j.text); return responder(res, 200, { ok: true }) }
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(url)
      if (!m) return responder(res, 404, { ok: false, description: 'Not Found' })
      const metodo = m[2]
      if (metodo === 'sendPhoto') {
        const texto = corpo.toString('latin1')
        const chat = /name="chat_id"\r\n\r\n([^\r]+)/.exec(texto)?.[1]
        const legenda = /name="caption"\r\n\r\n([^\r]*)/.exec(texto)?.[1]
        const jpeg = texto.includes('\xff\xd8\xff')
        enviados.push({ metodo, chatId: chat, caption: legenda ? Buffer.from(legenda, 'latin1').toString('utf8') : '', jpeg, bytes: corpo.length })
        return responder(res, 200, { ok: true, result: { message_id: proximoId++ } })
      }
      const j = JSON.parse(corpo.toString() || '{}')
      if (metodo === 'getUpdates') {
        // Confirma as anteriores (como o Telegram) e espera por novas até ao timeout.
        for (let i = fila.length - 1; i >= 0; i--) if (fila[i].update_id < (j.offset || 0)) fila.splice(i, 1)
        const r = fila.filter(u => u.update_id >= (j.offset || 0))
        if (r.length || !j.timeout) return responder(res, 200, { ok: true, result: r })
        const pedido = { res, offset: j.offset || 0 }
        espera.push(pedido)
        setTimeout(() => { const i = espera.indexOf(pedido); if (i >= 0) { espera.splice(i, 1); responder(res, 200, { ok: true, result: [] }) } }, Math.min(j.timeout, 30) * 1000)
        return
      }
      if (['sendMessage', 'sendLocation'].includes(metodo)) {
        enviados.push({ metodo, chatId: String(j.chat_id), text: j.text, latitude: j.latitude, longitude: j.longitude })
        return responder(res, 200, { ok: true, result: { message_id: proximoId++ } })
      }
      responder(res, 400, { ok: false, description: `método ${metodo} não fingido` })
    })
  })

  return new Promise((resolve) => {
    servidor.listen(porta, () => {
      const url = `http://localhost:${servidor.address().port}`
      resolve({
        url,
        enviados,
        escrever,
        fechar: () => new Promise(r => { espera.splice(0).forEach(({ res }) => responder(res, 200, { ok: true, result: [] })); servidor.close(r) })
      })
    })
  })
}

if (require.main === module) {
  criarTelegramFalso({ porta: Number(process.argv[2] || 8081) }).then(t => console.log(`Telegram falso em ${t.url}`))
}

module.exports = { criarTelegramFalso }
