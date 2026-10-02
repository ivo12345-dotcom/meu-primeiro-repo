'use strict'
// A fila das mensagens dos alarmes por entregar ao Telegram (auditoria K-09, decisão n.º 17 do dono).
// Uma mensagem que o Telegram não aceitou (sem rede, router a reiniciar) não se perde: fica na fila,
// gravada no encaminhador.json com a hora a que devia ter saído, e tenta-se outra vez com um recuo de
// 2 s até 1 min, até ser entregue a pelo menos um chat autorizado. Uma falta de rede nunca a faz caducar
// (um "Água no porão" não caduca); chega com "(atrasado N min)" quando sai com 1 min ou mais de atraso.
// Lógica pura: o envio e a gravação são de lib/entrega.js e do plugin (index.js).
//
// Revisão da F4 (auditoria F4b, Importante 1): uma mensagem que o Telegram recusa sempre já não prende a
// fila. O texto entra cortado abaixo do limite do Telegram (4096 caracteres) e bem formado (sem meios
// emojis); uma recusa que não passa com outra tentativa (lib/telegram.js, recusaDoTelegram) em todos os
// chats tira-a da fila ao fim de MAX_RECUSAS tentativas (o plugin regista-o e avisa o Ivo). A fila já não
// sai só pela ordem de entrada: os alarmes passam à frente dos avisos e dos "Resolvido" (proximo), mas
// cada caminho sai sempre pela sua ordem (o "Resolvido" nunca antes do seu alarme). Acima do limite dos
// 100 (aparar) nunca sai um alarme deixando o seu "Resolvido" órfão.
//
// Cada mensagem: { texto, desde, caminho, estado, recusas? } — caminho: o da notificação (null nos avisos
// do próprio plugin, que levam sistema: true); estado: o da notificação ('emergency', 'alarm', 'alert',
// 'warn'; 'normal' no "Resolvido"); recusas: as tentativas recusadas.

const MIN = 60000
const MAX_FILA = 100 // um limite de segurança do ficheiro (aparar)
const MAX_TEXTO = 4000 // o Telegram aceita até 4096: sobra espaço para o "(atrasado N min)"
const MAX_RECUSAS = 3 // tentativas recusadas (em todos os chats) até a mensagem sair da fila
const RECUO_MIN_MS = 2000
const RECUO_MAX_MS = MIN
const ESTADOS = new Set(['emergency', 'alarm', 'alert', 'warn', 'normal'])
// a pressa de cada estado (menos é mais urgente): o fumo, os alarmes, os avisos; o "Resolvido" e os
// avisos do plugin no fim
const PRIORIDADE = { emergency: 0, alarm: 1, alert: 2, warn: 2 }
const prioridade = (item) => PRIORIDADE[item.estado] ?? 3

// O texto como o Telegram o aceita: bem formado (um meio emoji perdido passa a "�": o Telegram recusa o
// que não é UTF-8) e, acima de MAX_TEXTO, cortado com "…" (sem partir um emoji ao meio).
function cortarTexto (texto) {
  const t = String(texto).toWellFormed()
  if (t.length <= MAX_TEXTO) return t
  let fim = MAX_TEXTO - 1
  const c = t.charCodeAt(fim - 1)
  if (c >= 0xd800 && c <= 0xdbff) fim-- // a 1.ª metade de um emoji: sai o emoji todo
  return `${t.slice(0, fim)}…`
}

// novo: o texto de um aviso do próprio plugin, ou { texto, caminho, estado } (o encaminhador: lib/mensagens.js)
function itemNovo (novo, agora) {
  if (typeof novo === 'string') return { texto: cortarTexto(novo), desde: agora, caminho: null, sistema: true }
  return { texto: cortarTexto(novo.texto), desde: agora, caminho: novo.caminho, estado: novo.estado }
}

// fila + mensagens novas (pela ordem), com a hora a que deviam sair → { fila, perdidas: [item] }
function porNaFila (fila, novos, agora, { max = MAX_FILA } = {}) {
  return aparar([...fila, ...novos.map(n => itemNovo(n, agora))], max)
}

// Acima de `max`, o que sai primeiro (nunca um alarme cujo "Resolvido" fica na fila):
// 1. as oscilações: um "Resolvido" seguido de outra mensagem do mesmo caminho (os dois; ficam o 1.º alarme e o fim);
// 2. os casos já acabados: as mensagens de um caminho que termina num "Resolvido" (todas; os avisos antes dos
//    alarmes, os mais antigos primeiro);
// 3. os avisos do próprio plugin, o mais antigo;
// 4. um "Resolvido" solto (o seu alarme já foi entregue), o mais antigo;
// 5. a mensagem ativa menos grave, a mais antiga.
function aparar (fila, max = MAX_FILA) {
  const f = [...fila]
  const perdidas = []
  const tirar = (indices) => {
    const fora = []
    for (const i of [...indices].sort((a, b) => b - a)) fora.unshift(f.splice(i, 1)[0])
    perdidas.push(...fora)
  }
  while (f.length > max) {
    // 1.
    const i1 = f.findIndex((x, i) => x.caminho != null && x.estado === 'normal' && f.some((y, j) => j > i && y.caminho === x.caminho))
    if (i1 >= 0) { tirar([i1, f.findIndex((y, j) => j > i1 && y.caminho === f[i1].caminho)]); continue }
    // 2.
    const casos = new Map()
    f.forEach((x, i) => {
      if (x.caminho == null) return
      const c = casos.get(x.caminho) || { indices: [], p: 3 }
      c.indices.push(i)
      if (x.estado !== 'normal') c.p = Math.min(c.p, prioridade(x))
      casos.set(x.caminho, c)
    })
    let caso = null
    for (const c of casos.values()) {
      if (c.indices.length < 2 || f[c.indices.at(-1)].estado !== 'normal') continue // ainda ativo, ou um "Resolvido" solto
      if (!caso || c.p > caso.p || (c.p === caso.p && c.indices[0] < caso.indices[0])) caso = c
    }
    if (caso) { tirar(caso.indices); continue }
    // 3. e 4.
    const i3 = f.findIndex(x => x.caminho == null)
    if (i3 >= 0) { tirar([i3]); continue }
    const i4 = f.findIndex(x => x.estado === 'normal')
    if (i4 >= 0) { tirar([i4]); continue }
    // 5.
    let k = 0
    for (let j = 1; j < f.length; j++) if (prioridade(f[j]) > prioridade(f[k])) k = j
    tirar([k])
  }
  return { fila: f, perdidas }
}

// O índice da próxima mensagem a enviar: a cabeça de cada caminho (a mais antiga que tem na fila: a ordem
// de cada caminho nunca muda), com a pressa da mais urgente desse caminho na fila (um aviso que escalou
// para alarme não fica para trás); entre essas, a mais urgente e, a seguir, a mais antiga. -1 com a fila
// vazia. Os avisos do próprio plugin (sem caminho) saem entre si pela ordem.
function proximo (fila) {
  const cabecas = new Map()
  fila.forEach((x, i) => {
    const c = cabecas.get(x.caminho ?? null)
    if (!c) cabecas.set(x.caminho ?? null, { i, p: prioridade(x) })
    else c.p = Math.min(c.p, prioridade(x))
  })
  let melhor = null
  for (const c of cabecas.values()) if (!melhor || c.p < melhor.p || (c.p === melhor.p && c.i < melhor.i)) melhor = c
  return melhor ? melhor.i : -1
}

// O texto a enviar agora: com "(atrasado N min)" a partir de 1 min de atraso.
function textoAEnviar (item, agora) {
  const n = Math.floor((agora - item.desde) / MIN)
  return n >= 1 ? `${item.texto} (atrasado ${n} min)` : item.texto
}

// A espera até à tentativa seguinte, depois de `falhas` tentativas falhadas seguidas: 2, 4, 8, 16,
// 32 s e depois 1 min; nunca menos do que o Telegram pediu (retry_after de um 429, em s).
function recuoMs (falhas, esperarS = 0) {
  const recuo = Math.min(RECUO_MAX_MS, RECUO_MIN_MS * 2 ** Math.max(0, falhas - 1))
  return Math.max(recuo, Number.isFinite(esperarS) && esperarS > 0 ? esperarS * 1000 : 0)
}

// As primeiras letras de um texto (para o registo e para o aviso ao Ivo), sem partir um emoji.
function excerto (texto, n = 60) {
  const letras = Array.from(String(texto))
  return letras.length > n ? `${letras.slice(0, n - 1).join('')}…` : String(texto)
}

// O aviso ao Ivo de uma mensagem que o Telegram recusou sempre (`porque`: em pt-PT).
const avisoDeRecusa = (item, porque) => `⚠️ O Telegram recusou ${MAX_RECUSAS} vezes uma mensagem e desisti dela (${porque}): «${excerto(item.texto)}»`

// A fila lida do encaminhador.json: só os itens com texto e hora. A fila gravada pela versão anterior só
// tem { texto, desde }: o estado vem do ícone e o caminho do texto (o alarme e o seu "Resolvido" juntos).
const semIcone = (texto) => texto.replace(/^(?:✓ Resolvido: |🔥 |🚨 |⚠️ )/u, '')
const estadoPeloIcone = (texto) => (texto.startsWith('✓ Resolvido: ') ? 'normal' : texto.startsWith('🔥') ? 'emergency' : texto.startsWith('🚨') ? 'alarm' : 'warn')
function filaValida (x) {
  if (!Array.isArray(x)) return []
  return x.filter(i => i && typeof i.texto === 'string' && i.texto && Number.isFinite(i.desde)).map(i => {
    const sistema = i.sistema === true && !i.caminho
    const caminho = typeof i.caminho === 'string' && i.caminho ? i.caminho : sistema ? null : `texto:${semIcone(i.texto)}`
    const item = { texto: i.texto, desde: i.desde, caminho }
    if (sistema) item.sistema = true
    else item.estado = ESTADOS.has(i.estado) ? i.estado : estadoPeloIcone(i.texto)
    if (Number.isInteger(i.recusas) && i.recusas > 0) item.recusas = i.recusas
    return item
  })
}

module.exports = { porNaFila, aparar, proximo, cortarTexto, textoAEnviar, recuoMs, excerto, avisoDeRecusa, filaValida, prioridade, MAX_FILA, MAX_TEXTO, MAX_RECUSAS, RECUO_MAX_MS }
