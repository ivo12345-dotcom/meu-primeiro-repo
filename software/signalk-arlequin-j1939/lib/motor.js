'use strict'
// Estado do motor (ligado/parado, com histerese) e alarmes calculados a partir
// dos valores, até se conhecer o mapa dos alarmes próprios do MDI, e do estado da ligação (C11).
// Limites aprovados pelo Ivo (29/09): 95 °C e 13,0 V.

const K = 273.15
const MIN = 60000

const LIMITES = Object.freeze({
  rpmLiga: 300, rpmPara: 200,
  tempAlarme: 95, tempLimpa: 92, // °C
  voltMin: 13.0, voltLimpa: 13.3, // V
  alternadorEspera: 2 * MIN
})

const num1 = (v) => v.toFixed(1).replace('.', ',')

// O apito de cada alarme (decisão n.º 2 do Ivo, contrato C1 da auditoria): o motor a sobreaquecer é
// perigo imediato (contínuo); os outros alarmes, curto. Os avisos não precisam do campo.
const apitoDe = (id, estado) => (estado === 'alarm' || estado === 'emergency' ? { apito: id === 'overTemperature' ? 'continuo' : 'curto' } : {})

function novoEstadoMotor () {
  return { ligado: false, ligadoDesde: null, ativos: {} }
}

// l: { rpm (rpm), temp (K), volt (V), ligacao } — qualquer um pode faltar (null).
// ligacao (contrato C11, o estado da ligação que o plugin calcula: lib/ligacao.js):
//   'calado' (a ignição desligada): o motor está parado e os alarmes calculados voltam a normal (o
//     sobreaquecimento já não apita em contínuo com o motor desligado);
//   'sem-ligacao', ou null (ainda não se sabe): nada muda — um alarme ativo não se dá por resolvido nem se
//     acende um novo (não há leitura);
//   'a-receber', ou sem o campo: as regras de sempre.
function avaliarMotor (e, l, agora, lim = LIMITES) {
  if (l.ligacao === 'sem-ligacao' || l.ligacao === null) return { estado: e, estadoMudou: null, notificacoes: [] }
  let { ligado, ligadoDesde } = e
  let estadoMudou = null
  if (l.ligacao === 'calado') {
    const notificacoes = Object.keys(e.ativos).map(id => ({ id, state: 'normal', method: [], message: 'Normal' }))
    return { estado: { ligado: false, ligadoDesde: null, ativos: {} }, estadoMudou: ligado ? 'stopped' : null, notificacoes }
  }
  if (typeof l.rpm === 'number') {
    if (!ligado && l.rpm > lim.rpmLiga) { ligado = true; ligadoDesde = agora; estadoMudou = 'started' }
    else if (ligado && l.rpm < lim.rpmPara) { ligado = false; ligadoDesde = null; estadoMudou = 'stopped' }
  }

  const ativos = { ...e.ativos }
  const notificacoes = []
  const mudar = (id, deve, estado, mensagem) => {
    if (deve === null || deve === !!ativos[id]) return
    if (deve) { ativos[id] = true; notificacoes.push({ id, state: estado, method: ['visual', 'sound'], message: mensagem, ...apitoDe(id, estado) }) }
    else { delete ativos[id]; notificacoes.push({ id, state: 'normal', method: [], message: 'Normal' }) }
  }

  if (typeof l.temp === 'number') {
    const c = l.temp - K
    const deve = ativos.overTemperature ? c >= lim.tempLimpa : c >= lim.tempAlarme
    mudar('overTemperature', deve, 'alarm', `Motor a ${Math.round(c)} °C — sobreaquecimento`)
  }

  let alt = null
  if (!ligado) alt = false
  else if (typeof l.volt === 'number' && agora - ligadoDesde >= lim.alternadorEspera) {
    alt = ativos.alternadorNaoCarrega ? l.volt < lim.voltLimpa : l.volt < lim.voltMin
  }
  mudar('alternadorNaoCarrega', alt, 'warn', `Alternador a ${typeof l.volt === 'number' ? num1(l.volt) : '—'} V — não está a carregar`)

  return { estado: { ligado, ligadoDesde, ativos }, estadoMudou, notificacoes }
}

module.exports = { LIMITES, novoEstadoMotor, avaliarMotor, apitoDe }
