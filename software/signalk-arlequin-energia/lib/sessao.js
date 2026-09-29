'use strict'
// Sessão de carga pelo motor: abre quando o motor liga, fecha quando para.
// Integra os Ah que entram no banco de serviço e soma as horas de motor.
// Cada intervalo entre duas leituras conta com o estado da leitura anterior.

const MAX_INTERVALO = 2 * 60 * 1000 // buracos maiores não se integram

function novaSessao () {
  return { aberta: null, runTimeS: 0, anterior: null }
}

const arred1 = (x) => Math.round(x * 10) / 10

function passoSessao (sessao, leitura, agora) {
  let { aberta, runTimeS } = sessao
  const ant = sessao.anterior
  let fechada = null

  if (ant && ant.motorLigado) {
    const dt = agora - ant.agora
    if (dt > 0 && dt <= MAX_INTERVALO) {
      runTimeS += dt / 1000
      if (aberta) aberta = { ...aberta, ah: aberta.ah + Math.max(ant.corrente ?? 0, 0) * dt / 3600000 }
    }
  }

  if (leitura.motorLigado && !aberta) {
    aberta = { inicio: agora, socInicial: leitura.soc, ah: 0 }
  } else if (!leitura.motorLigado && aberta) {
    fechada = {
      inicio: new Date(aberta.inicio).toISOString(),
      fim: new Date(agora).toISOString(),
      duracaoMin: Math.round((agora - aberta.inicio) / 60000),
      ah: arred1(aberta.ah),
      socInicial: aberta.socInicial,
      socFinal: leitura.soc
    }
    aberta = null
  }

  return {
    sessao: { aberta, runTimeS, anterior: { agora, motorLigado: leitura.motorLigado, corrente: leitura.corrente } },
    fechada
  }
}

module.exports = { novaSessao, passoSessao }
