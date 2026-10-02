'use strict'
// A fila das mensagens dos alarmes por entregar ao Telegram (auditoria K-09, decisão n.º 17 do dono).
// Uma mensagem que o Telegram não aceitou (sem rede, router a reiniciar) não se perde: fica na fila,
// gravada no encaminhador.json com a hora a que devia ter saído, e tenta-se outra vez com um recuo de
// 2 s até 1 min, até ser entregue a pelo menos um chat autorizado. Nunca caduca (um "Água no porão"
// não caduca): sai pela ordem em que entrou, com "(atrasado N min)" quando chega com 1 min ou mais de
// atraso. Lógica pura: o plugin (index.js) envia e grava.

const MIN = 60000
const MAX_FILA = 100 // um limite de segurança do ficheiro: acima dele sai a mais antiga (com registo)
const RECUO_MIN_MS = 2000
const RECUO_MAX_MS = MIN

// fila + textos novos (pela ordem), com a hora a que deviam sair → { fila, perdidas: [item] }
function porNaFila (fila, textos, agora, max = MAX_FILA) {
  const nova = [...fila, ...textos.map(texto => ({ texto, desde: agora }))]
  const perdidas = nova.length > max ? nova.splice(0, nova.length - max) : []
  return { fila: nova, perdidas }
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

// A fila lida do encaminhador.json: só os itens com texto e hora (um ficheiro antigo não a tem).
function filaValida (x) {
  return Array.isArray(x) ? x.filter(i => i && typeof i.texto === 'string' && i.texto && Number.isFinite(i.desde)).map(i => ({ texto: i.texto, desde: i.desde })) : []
}

module.exports = { porNaFila, textoAEnviar, recuoMs, filaValida, MAX_FILA, RECUO_MAX_MS }
