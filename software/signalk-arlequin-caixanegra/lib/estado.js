'use strict'
// Últimos valores do próprio barco, a partir das mensagens do SignalK, com a
// hora a que chegaram. Marca quando chegam dados do simulador: essas linhas
// ficam "simulado" e nunca ensinam a AI.

const SIMULADOR = 'arlequin-simulador'

function novoEstado () { return { valores: {}, ultimoSimulado: -Infinity } }

function doProprio (delta, selfContext) {
  return !delta.context || delta.context === 'vessels.self' || delta.context === selfContext
}

function aplicar (estado, delta, selfContext, agora) {
  if (!doProprio(delta, selfContext)) return estado
  for (const u of delta.updates || []) {
    const fonte = u.$source || ''
    if (fonte === SIMULADOR || fonte.startsWith(SIMULADOR + '.')) estado.ultimoSimulado = agora
    for (const { path, value } of u.values || []) {
      if (!path || path.startsWith('notifications.')) continue
      estado.valores[path] = { value, t: agora }
    }
  }
  return estado
}

function valor (estado, caminho, agora, maxIdadeMs = 15000) {
  const v = estado.valores[caminho]
  if (!v || agora - v.t > maxIdadeMs) return undefined
  return v.value
}

function simuladoRecente (estado, agora, janelaMs = 15000) {
  return agora - estado.ultimoSimulado <= janelaMs
}

module.exports = { novoEstado, aplicar, valor, simuladoRecente, SIMULADOR }
