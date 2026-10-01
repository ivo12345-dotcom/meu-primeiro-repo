'use strict'
// Telegram FALSO para testes em casa: finge a API de bots (getUpdates com long
// polling, sendMessage, sendPhoto, sendDocument, sendLocation). Guarda o que o barco envia e
// deixa "escrever" mensagens como se fosse o telemóvel do Ivo.
//   node telegram-falso.js 8081          → servidor em http://localhost:8081
//   POST /_escrever { chatId, text }      → mensagem do "telemóvel"
//   POST /_bloquear { chatId }            → esse chat passa a recusar (como quem bloqueou o bot)
//   POST /_pendurar { chatId }            → os envios para esse chat nunca têm resposta (rede pendurada)
//   GET  /_enviados                       → o que o barco enviou (sendDocument: nomeFicheiro e conteudo)

const http = require('node:http')

function criarTelegramFalso ({ porta = 0 } = {}) {
  const enviados = []
  const fila = []
  let proximoId = 1
  const espera = [] // pedidos getUpdates em long polling
  const bloqueados = new Set()
  const pendurados = new Set()
  const pendentes = [] // as respostas que nunca chegam (só se fecham no fim)

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

  // As partes de um corpo multipart/form-data: { nome: { dados (Buffer), ficheiro?, tipo? } }
  function lerMultipart (corpo, tipo) {
    const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(tipo || '')
    if (!b) return {}
    const fronteira = Buffer.from(`--${b[1] || b[2]}`)
    const partes = {}
    let i = corpo.indexOf(fronteira)
    while (i >= 0) {
      const ini = i + fronteira.length
      if (corpo.subarray(ini, ini + 2).toString() === '--') break
      const fim = corpo.indexOf(fronteira, ini)
      if (fim < 0) break
      const parte = corpo.subarray(ini + 2, fim - 2) // sem o \r\n depois da fronteira e antes da seguinte
      const sep = parte.indexOf('\r\n\r\n')
      const cab = parte.subarray(0, sep).toString('utf8')
      const nome = /name="([^"]+)"/.exec(cab)?.[1]
      if (nome) partes[nome] = { dados: parte.subarray(sep + 4), ficheiro: /filename="([^"]*)"/.exec(cab)?.[1], tipo: /content-type: ([^\r\n]+)/i.exec(cab)?.[1] }
      i = fim
    }
    return partes
  }

  const servidor = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => {
      const corpo = Buffer.concat(partes)
      const url = req.url
      if (url === '/_enviados') return responder(res, 200, enviados)
      if (url === '/_escrever') { const j = JSON.parse(corpo.toString() || '{}'); escrever(j.chatId, j.text); return responder(res, 200, { ok: true }) }
      if (url === '/_bloquear') { const j = JSON.parse(corpo.toString() || '{}'); bloqueados.add(String(j.chatId)); return responder(res, 200, { ok: true }) }
      if (url === '/_pendurar') { const j = JSON.parse(corpo.toString() || '{}'); pendurados.add(String(j.chatId)); return responder(res, 200, { ok: true }) }
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(url)
      if (!m) return responder(res, 404, { ok: false, description: 'Not Found' })
      const metodo = m[2]
      // um chat bloqueado recusa, como o Telegram quando a pessoa bloqueou o bot
      // um chat pendurado nunca responde (como uma ligação que fica a meio)
      const recusar = (chat) => {
        if (pendurados.has(String(chat))) { pendentes.push(res); return true }
        if (!bloqueados.has(String(chat))) return false
        responder(res, 403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })
        return true
      }
      if (metodo === 'sendPhoto' || metodo === 'sendDocument') {
        const partes = lerMultipart(corpo, req.headers['content-type'])
        const chat = partes.chat_id?.dados.toString('utf8')
        if (recusar(chat)) return
        const caption = partes.caption ? partes.caption.dados.toString('utf8') : ''
        if (metodo === 'sendPhoto') {
          const f = partes.photo?.dados
          enviados.push({ metodo, chatId: chat, caption, jpeg: !!f && f[0] === 0xff && f[1] === 0xd8 && f[2] === 0xff, bytes: corpo.length })
        } else {
          const f = partes.document
          enviados.push({ metodo, chatId: chat, caption, nomeFicheiro: f?.ficheiro ?? null, tipo: f?.tipo ?? null, conteudo: f ? f.dados.toString('utf8') : null, bytes: corpo.length })
        }
        return responder(res, 200, { ok: true, result: { message_id: proximoId++ } })
      }
      const j = JSON.parse(corpo.toString() || '{}')
      if (['sendMessage', 'sendLocation'].includes(metodo) && recusar(j.chat_id)) return
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
        bloquear: (chatId) => bloqueados.add(String(chatId)),
        pendurar: (chatId) => pendurados.add(String(chatId)),
        fechar: () => new Promise(r => {
          espera.splice(0).forEach(({ res }) => responder(res, 200, { ok: true, result: [] }))
          pendentes.splice(0).forEach(res => res.destroy())
          servidor.closeAllConnections?.()
          servidor.close(r)
        })
      })
    })
  })
}

if (require.main === module) {
  criarTelegramFalso({ porta: Number(process.argv[2] || 8081) }).then(t => console.log(`Telegram falso em ${t.url}`))
}

module.exports = { criarTelegramFalso }
