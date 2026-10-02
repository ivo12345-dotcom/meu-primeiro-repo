'use strict'
// Água doce do Arlequin: depósitos flexíveis com bombas de PÉ (lavatório do WC e
// lava-loiça). Conta-se as pedaladas (reed switch + íman no pedal) e cada
// pedalada vale X litros (calibrado com uma jarra de 1 L). Nível = o que tinha
// ao encher − o gasto desde então. A bomba de água do mar não conta.
// Lógica pura, um tanque de cada vez. Aviso de água a acabar: ≤ 20% (limpa 25%).
// O nível só se sabe depois de um "Enchi" ou de um nível posto à mão (nivelConhecido; auditoria I-29,
// decisão n.º 23 do Ivo): antes disso não há nível, nunca "cheio" por omissão.

const DIA = 24 * 3600 * 1000
const GUARDAR = 7 * DIA

function novoTanque () {
  // desde: início da observação (primeira contagem ou último "encher"), para o ritmo
  return { litrosAoEncher: null, gastoL: 0, ultimaContagem: null, historico: [], calibracao: null, desde: null, nivelConhecido: false }
}

// Contador acumulado de pedaladas vindo do sensor. Se descer, o sensor
// reiniciou: a nova contagem conta toda.
function contagem (t, contador, agora, cfg) {
  if (typeof contador !== 'number') return t
  const n = { ...t, ultimaContagem: contador, desde: t.desde ?? agora }
  if (t.ultimaContagem === null) return n
  const delta = contador >= t.ultimaContagem ? contador - t.ultimaContagem : contador
  if (delta === 0) return n
  const litros = delta * cfg.litrosPorPedalada
  n.gastoL = t.gastoL + litros
  n.historico = [...t.historico.filter(h => h.t > agora - GUARDAR), { t: agora, litros }]
  if (t.calibracao) n.calibracao = { pedaladas: t.calibracao.pedaladas + delta }
  return n
}

// "Enchi": fica na capacidade. Sem cfg, fica "cheio" pela capacidade de quem ler.
function encher (t, agora) {
  return { ...t, litrosAoEncher: null, gastoL: 0, desde: agora, nivelConhecido: true }
}

function definirNivel (t, litros, agora) {
  return { ...t, litrosAoEncher: litros, gastoL: 0, desde: agora, nivelConhecido: true }
}

// litrosAoEncher null = cheio (capacidade). Nunca abaixo de 0 nem acima da capacidade.
// Sem nunca "Enchi" nem nível à mão: { litros: null, fracao: null }.
function nivel (t, cfg) {
  if (!t.nivelConhecido) return { litros: null, fracao: null }
  const base = t.litrosAoEncher ?? cfg.capacidadeL
  const litros = Math.max(0, Math.min(cfg.capacidadeL, base - t.gastoL))
  return { litros, fracao: litros / cfg.capacidadeL }
}

function avaliarAlarme (ativo, fracao, limite = 0.20, limpa = 0.25) {
  if (typeof fracao !== 'number') return { ativo, mudou: false }
  const deve = ativo ? fracao <= limpa : fracao <= limite
  return { ativo: deve, mudou: deve !== ativo }
}

// Litros por dia na janela desde o último "encher" (ou a primeira contagem),
// no máximo 3 dias; com menos de 12 h de observação não se inventa.
function ritmoDiario (t, agora, cfg) {
  if (t.desde === null || t.desde === undefined) return null
  const inicio = Math.max(agora - 3 * DIA, t.desde)
  const janela = agora - inicio
  if (janela < DIA / 2) return null
  const gasto = t.historico.filter(h => h.t > inicio).reduce((a, h) => a + h.litros, 0)
  const litrosDia = gasto / (janela / DIA)
  const { litros } = nivel(t, cfg)
  return { litrosDia, dias: litros !== null && litrosDia > 0 ? litros / litrosDia : null }
}

function iniciarCalibracao (t) {
  return { ...t, calibracao: { pedaladas: 0 } }
}

function terminarCalibracao (t, litros) {
  const p = t.calibracao?.pedaladas || 0
  if (p === 0) throw new Error('nenhuma pedalada contada: o sensor está ligado?')
  return { pedaladas: p, litrosPorPedalada: litros / p }
}

module.exports = { novoTanque, contagem, encher, definirNivel, nivel, avaliarAlarme, ritmoDiario, iniciarCalibracao, terminarCalibracao }
