'use strict'
// A entrega da fila ao Telegram (lib/entrega.js) sem o plugin: o ritmo (a pausa de 1 s entre mensagens), o
// limite dos 100, o recuo e o retry_after. Auditoria F4b, revisão da F4, Menor 13: o ritmo e o limite não
// tinham teste (os da fila ponta a ponta usam pausaFilaMs: 0). Com um cliente falso, relógios à mão e a pausa
// por espiar, nada espera por tempo nenhum.
const test = require('node:test')
const assert = require('node:assert/strict')
const { criarEntrega, PAUSA_MS } = require('../lib/entrega')
const { porNaFila, MAX_FILA, MAX_RECUSAS } = require('../lib/fila')

const S = 1000
const sem = (texto) => Object.assign(new Error(`Telegram sendMessage: sem ligação (${texto})`), { semLigacao: true })
const recusa = (codigo, descricao) => Object.assign(new Error(`Telegram sendMessage: ${descricao}`), { codigo, descricao })
const alarme = (i, estado = 'alarm') => ({ texto: `🚨 Alarme ${i}`, caminho: `notifications.x.n${i}`, estado })

// Uma entrega com a fila na memória: `eventos` tem o que aconteceu pela ordem ("enviar <texto>" e "pausa <ms>");
// `falhar(chatId, texto)` devolve o erro a dar a esse envio (ou nada: o Telegram aceita).
function montar ({ fila = [], chats = ['111'], ...opcoes } = {}) {
  const x = { parede: Date.parse('2026-10-02T10:00:00Z'), mono: 5000, erros: [], eventos: [], envios: [], gravacoes: 0, falhar: () => null }
  x.fila = porNaFila([], fila, x.parede, { mono: x.mono }).fila
  const cliente = {
    async sendMessage (id, texto) {
      x.envios.push({ id, texto })
      x.eventos.push(`enviar ${texto}`)
      const erro = x.falhar(id, texto)
      if (erro) throw erro
      return {}
    }
  }
  x.entrega = criarEntrega({
    app: { error: (e) => x.erros.push(e) },
    agora: () => x.parede,
    monotono: () => x.mono,
    cliente: () => cliente,
    chats: () => chats,
    fila: () => x.fila,
    gravar: (f) => { x.fila = f; x.gravacoes++ },
    pausar: async (ms) => { x.eventos.push(`pausa ${ms}`) },
    ...opcoes
  })
  x.passar = (ms) => { x.parede += ms; x.mono += ms }
  x.textos = () => x.fila.map(i => i.texto)
  return x
}

test('o ritmo: uma pausa de 1 s entre duas mensagens seguidas da fila (o limite do Telegram por chat) e nenhuma depois da última', async () => {
  assert.equal(PAUSA_MS, 1000)
  const x = montar({ fila: [alarme(1), alarme(2), alarme(3)] })
  await x.entrega.enviar()
  assert.deepEqual(x.eventos, ['enviar 🚨 Alarme 1', 'pausa 1000', 'enviar 🚨 Alarme 2', 'pausa 1000', 'enviar 🚨 Alarme 3'])
  assert.deepEqual(x.fila, [])
  // com uma só mensagem não há pausa nenhuma
  const y = montar({ fila: [alarme(1)] })
  await y.entrega.enviar()
  assert.deepEqual(y.eventos, ['enviar 🚨 Alarme 1'])
})

test('o ritmo: com a pausa a 0 (os testes ponta a ponta) não há espera nenhuma; a pausa também é a que se pede', async () => {
  const sem0 = montar({ fila: [alarme(1), alarme(2)], pausaMs: 0 })
  await sem0.entrega.enviar()
  assert.deepEqual(sem0.eventos, ['enviar 🚨 Alarme 1', 'enviar 🚨 Alarme 2'])
  const meio = montar({ fila: [alarme(1), alarme(2)], pausaMs: 250 })
  await meio.entrega.enviar()
  assert.deepEqual(meio.eventos, ['enviar 🚨 Alarme 1', 'pausa 250', 'enviar 🚨 Alarme 2'])
})

test('o ritmo: depois de desistir de uma mensagem que o Telegram recusa sempre também há a pausa, e o aviso ao Ivo segue ao fim da fila', async () => {
  const x = montar({ fila: [alarme(1), alarme(2)] })
  // a 1.ª já foi recusada 2 vezes: a 3.ª (agora) é a última
  x.fila = x.fila.map((i, k) => (k === 0 ? { ...i, recusas: MAX_RECUSAS - 1 } : i))
  x.falhar = (id, texto) => (texto === '🚨 Alarme 1' ? recusa(400, 'Bad Request: message is too long') : null)
  await x.entrega.enviar()
  assert.deepEqual(x.eventos, [
    'enviar 🚨 Alarme 1', 'pausa 1000',
    'enviar 🚨 Alarme 2', 'pausa 1000',
    'enviar ⚠️ O Telegram recusou 3 vezes uma mensagem e desisti dela (a mensagem é demasiado longa para o Telegram): «🚨 Alarme 1»'
  ])
  assert.deepEqual(x.fila, [])
  assert.deepEqual(x.erros, [
    'Telegram sendMessage: Bad Request: message is too long',
    'fila do Telegram: desisti de "🚨 Alarme 1" ao fim de 3 recusas (Telegram sendMessage: Bad Request: message is too long)'
  ])
})

test('o limite: a fila não passa das 100 mensagens; a que sobra é a mais antiga e menos grave, com uma linha no registo', () => {
  assert.equal(MAX_FILA, 100)
  const x = montar()
  const novos = Array.from({ length: 101 }, (_, i) => alarme(i))
  const fila = x.entrega.acrescentar([], novos)
  assert.equal(fila.length, 100)
  assert.equal(fila[0].texto, '🚨 Alarme 1')
  assert.equal(fila.at(-1).texto, '🚨 Alarme 100')
  assert.deepEqual(x.erros, ['fila do Telegram cheia: já não vou entregar "🚨 Alarme 0"'])
  // a cheia continua cheia: mais uma, mais uma que sai
  const mais = x.entrega.acrescentar(fila, [alarme(101)])
  assert.equal(mais.length, 100)
  assert.deepEqual(x.erros.slice(1), ['fila do Telegram cheia: já não vou entregar "🚨 Alarme 1"'])
  // o limite pede-se (a dependência dos testes)
  const curta = montar({ max: 2 })
  assert.equal(curta.entrega.acrescentar([], [alarme(1), alarme(2), alarme(3)]).length, 2)
})

test('o recuo: 2 s, 4 s, 8 s … pelo relógio monotónico (a hora de parede não conta), e nunca menos do que o retry_after do Telegram', async () => {
  const x = montar({ fila: [alarme(1)] })
  x.falhar = () => sem('fetch failed')
  const tentativas = () => x.envios.length
  await x.entrega.enviar()
  assert.equal(tentativas(), 1)
  // dentro do recuo de 2 s não tenta, mesmo que a hora de parede ande (o NTP)
  x.parede += 3600 * S
  x.mono += 1999
  await x.entrega.enviar()
  assert.equal(tentativas(), 1)
  x.mono += 1
  await x.entrega.enviar()
  assert.equal(tentativas(), 2)
  // o 2.º recuo é de 4 s
  x.mono += 3999
  await x.entrega.enviar()
  assert.equal(tentativas(), 2)
  x.mono += 1
  await x.entrega.enviar()
  assert.equal(tentativas(), 3)
  // o Telegram pede 35 s (429): é o que se espera, mesmo sendo o recuo seguinte de 8 s
  x.falhar = () => Object.assign(recusa(429, 'Too Many Requests: retry after 35'), { esperarS: 35 })
  x.mono += 8 * S
  await x.entrega.enviar()
  assert.equal(tentativas(), 4)
  x.mono += 34999
  await x.entrega.enviar()
  assert.equal(tentativas(), 4, 'dentro dos 35 s que o Telegram pediu')
  x.mono += 1
  x.falhar = () => null
  await x.entrega.enviar()
  assert.equal(tentativas(), 5)
  assert.deepEqual(x.fila, [])
})

test('um envio de cada vez: duas chamadas ao mesmo tempo não mandam a mesma mensagem duas vezes', async () => {
  const x = montar({ fila: [alarme(1), alarme(2)], chats: ['111', '222'] })
  await Promise.all([x.entrega.enviar(), x.entrega.enviar(), x.entrega.enviar()])
  // cada mensagem vai uma vez a cada chat
  assert.deepEqual(x.envios.map(e => `${e.id}:${e.texto}`).sort(), ['111:🚨 Alarme 1', '111:🚨 Alarme 2', '222:🚨 Alarme 1', '222:🚨 Alarme 2'])
  assert.deepEqual(x.fila, [])
})

test('o estado do plugin: quantas por entregar, as tentativas falhadas e as recusadas pelo Telegram', async () => {
  const x = montar({ fila: [alarme(1), alarme(2)] })
  assert.equal(x.entrega.resumo(), ' · 2 por entregar')
  x.falhar = () => sem('fetch failed')
  await x.entrega.enviar()
  assert.equal(x.entrega.resumo(), ' · 2 por entregar (1 tentativa falhada)')
  x.mono += 2 * S
  await x.entrega.enviar()
  assert.equal(x.entrega.resumo(), ' · 2 por entregar (2 tentativas falhadas)')
  x.entrega.repor()
  assert.equal(x.entrega.resumo(), ' · 2 por entregar')
})
