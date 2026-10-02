'use strict'
// A entrega da fila dos alarmes ao Telegram (auditoria K-09, decisão n.º 17): o que o plugin faz com a fila
// de lib/fila.js (que é só lógica pura). Estava no index.js (auditoria F4b, revisão da F4, Menor 15).
//
// A mensagem mais urgente (fila.js, proximo: os alarmes à frente, cada caminho pela sua ordem — o
// "Resolvido" nunca chega antes do seu alarme) vai a todos os chats autorizados ao mesmo tempo e sai da
// fila quando pelo menos um a aceitou; se nenhum aceitou, espera o recuo (2 s … 1 min, ou o retry_after do
// Telegram) e tenta outra vez. Uma que o Telegram recusa em todos os chats sem remédio (recusaDoTelegram)
// sai ao fim de MAX_RECUSAS tentativas, com registo e um aviso ao Ivo (se algum chat a recusou por ser
// essa mensagem: com todos os chats recusados, o aviso não tinha a quem chegar); antes, uma assim
// prendia a fila para sempre (auditoria F4b, revisão da F4, Importante 1). Nunca vai aos contactos do plano.

const { porNaFila, proximo, textoAEnviar, recuoMs, excerto, avisoDeRecusa, MAX_FILA, MAX_RECUSAS } = require('./fila')
const { erroEmPortugues, recusaDoTelegram, registoTelegram } = require('./telegram')

const PAUSA_MS = 1000 // entre duas mensagens seguidas da fila: o Telegram não quer mais do que uma por segundo no mesmo chat
const dormir = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// deps:
//   app          o registo (app.error)
//   agora()      o relógio de parede, em ms (a hora das mensagens e o "(atrasado N min)")
//   cliente()    o cliente do Telegram do momento (null sem token; muda no stop() e no start())
//   chats()      os chats autorizados (nunca os contactos do plano)
//   fila()       a fila gravada (encaminhador.porEnviar)
//   gravar(fila) troca a fila gravada e grava o encaminhador.json
//   pausaMs      a pausa entre duas mensagens seguidas (1 s)
//   pausar(ms)   a espera da pausa (os testes não esperam)
//   max          o limite da fila (100)
// → { acrescentar, enviar, repor, resumo }
function criarEntrega ({ app, agora, cliente, chats, fila, gravar, pausaMs = PAUSA_MS, pausar = dormir, max = MAX_FILA }) {
  let falhas = 0 // tentativas falhadas seguidas
  let recusadas = 0 // mensagens que o Telegram recusou sempre e saíram da fila (desde o arranque)
  let proxima = 0 // agora() a partir do qual se tenta outra vez
  let emCurso = null // o envio em curso (um de cada vez)
  let ultimoErro = null // o registo não repete o mesmo erro a cada recuo

  // a fila + mensagens novas, dentro do limite (o que sair fica no registo)
  function acrescentar (lista, novos) {
    const f = porNaFila(lista, novos, agora(), { max })
    for (const x of f.perdidas) app.error(`fila do Telegram cheia: já não vou entregar "${x.texto}"`)
    return f.fila
  }

  // tira da fila a mensagem entregue (a primeira igual: o mesmo objeto, ou o mesmo texto e hora) e grava
  function tirar (item) {
    const lista = fila()
    const i = lista.findIndex(x => x === item || (x.texto === item.texto && x.desde === item.desde))
    if (i < 0) return
    gravar([...lista.slice(0, i), ...lista.slice(i + 1)])
  }
  function trocar (item, novo) {
    const lista = fila()
    const i = lista.indexOf(item)
    if (i < 0) return
    gravar(lista.map((x, k) => (k === i ? novo : x)))
  }

  // a mensagem que o Telegram recusou MAX_RECUSAS vezes sai da fila: o registo diz qual e porquê; o Ivo
  // recebe um aviso curto (comAviso: algum chat a recusou por ser essa mensagem; nunca de um aviso destes)
  function desistir (item, falhados, comAviso) {
    tirar(item)
    falhas = 0
    proxima = 0
    recusadas++
    app.error(`fila do Telegram: desisti de "${excerto(item.texto, 80)}" ao fim de ${MAX_RECUSAS} recusas (${falhados[0]?.message ?? falhados[0]})`)
    const porMensagem = falhados.find(e => recusaDoTelegram(e) === 'mensagem')
    if (comAviso && !item.sistema) gravar(acrescentar(fila(), [avisoDeRecusa(item, erroEmPortugues(porMensagem))]))
  }

  async function enviar () {
    const c = cliente()
    if (emCurso || !c || !fila().length || agora() < proxima) return
    const ids = chats()
    if (!ids.length) return
    const este = {}
    emCurso = este
    try {
      while (cliente() === c && fila().length) {
        const item = fila()[proximo(fila())]
        const texto = textoAEnviar(item, agora())
        const erros = await Promise.all(ids.map(id => c.sendMessage(id, texto).then(() => null, e => e)))
        const falhados = erros.filter(Boolean)
        if (cliente() !== c) {
          // stop() (e start()) a meio: a fila fica gravada e o arranque trata dela; se esta chegou, sai
          // já da fila (o arranque pode tê-la lido do disco: tira-se pelo texto e pela hora)
          if (falhados.length < ids.length) tirar(item)
          return
        }
        if (falhados.length) {
          const msg = registoTelegram(falhados[0])
          if (msg !== ultimoErro) { ultimoErro = msg; app.error(msg) }
        } else ultimoErro = null
        if (falhados.length === ids.length) {
          const recusas = falhados.map(recusaDoTelegram)
          if (recusas.every(Boolean)) {
            const n = (item.recusas || 0) + 1
            if (n >= MAX_RECUSAS) {
              desistir(item, falhados, recusas.includes('mensagem'))
              if (fila().length && pausaMs > 0) await pausar(pausaMs)
              continue
            }
            trocar(item, { ...item, recusas: n })
          }
          falhas++
          proxima = agora() + recuoMs(falhas, Math.max(0, ...falhados.map(e => e?.esperarS ?? 0)))
          return
        }
        falhas = 0
        proxima = 0
        tirar(item)
        if (fila().length && pausaMs > 0) await pausar(pausaMs)
      }
    } finally {
      if (emCurso === este) emCurso = null
    }
  }

  // o arranque do plugin: recomeça sem tentativas, recusas nem recuo (a fila gravada fica)
  function repor () {
    falhas = 0
    recusadas = 0
    proxima = 0
    emCurso = null
    ultimoErro = null
  }

  // o fim do estado do plugin ("… · Telegram ligado · 3 por entregar (2 tentativas falhadas) · 1 recusada pelo Telegram")
  function resumo () {
    const n = fila().length
    const porEntregar = n ? ` · ${n} por entregar${falhas ? ` (${falhas} ${falhas === 1 ? 'tentativa falhada' : 'tentativas falhadas'})` : ''}` : ''
    const recusa = recusadas ? ` · ${recusadas} ${recusadas === 1 ? 'recusada' : 'recusadas'} pelo Telegram` : ''
    return `${porEntregar}${recusa}`
  }

  return { acrescentar, enviar, repor, resumo }
}

module.exports = { criarEntrega, PAUSA_MS }
