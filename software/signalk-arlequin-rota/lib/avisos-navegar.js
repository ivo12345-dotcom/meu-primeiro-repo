'use strict'
// Os avisos a navegar (desenho 3b-2, "Avisos"): as regras de cada um, em funções puras com o relógio
// de fora. Só com o plano "a navegar"; nenhum muda a rota. Todos com method ['visual', 'sound'].
//
// notifications.rota.lembrete.<id>  alert  30 min antes de cada evento (hora deslizada) e até à hora
//   dele: rizar ou largar rizo (vela), chuva e visibilidade e passagem da frente (tempo), pôr do sol
//   (noite), a chegada de noite, a viragem num ponto da rota e a rotação do vento previsto (Tarefa
//   8.5). Sem GPS, os de sítio (rizar, viragem, chegada) param.
// notifications.rota.comer          alert  só com "só eu": de 3 em 3 h desde a saída real, 15 min.
// notifications.rota.recalcula      warn   atraso (média de 10 min) > 30 min, ou o vento medido (média
//   de 10 min) afastado do previsto P50 mais de ±30 % E mais de 4 nós durante 30 min seguidos (com a
//   previsão de calma, P50 0 nós, só os 4 nós). Apaga-se quando os dois voltam ao normal durante 10 min
//   seguidos. Os "seguidos" só contam amostras a ≤ 2 min umas das outras (um salto do relógio recomeça).
// notifications.rota.recursos       warn   gasóleo à chegada < 40 L ou bateria à chegada < 50 %.
// notifications.rota.previsao       warn com a previsão mais recente com mais de 6 h; alarm (com
//   apito: 'curto') com mais de 12 h ou sem previsão nenhuma.
// notifications.rota.barometro      warn   queda > 3 hPa em 3 h (amostras de minuto a minuto); apaga-se
//   com a queda em 3 h ≤ 2 hPa.
// notifications.rota.alarmeTerra    alert (apito: 'curto')  60 min antes da hora de alarme que os contactos
//   em terra têm, com o plano aberto (à espera de sair, a navegar ou em pausa; passada a hora fica): "Os
//   contactos em terra ligam ao MRCC às HH:MM: avisa-os ou Terminar" (revisão final I2); com o plano
//   fechado e o "cheguei bem"/"viagem terminada" ainda por entregar (auditoria K-12): "O «cheguei bem»
//   ainda não chegou a terra: os contactos ligam ao MRCC às HH:MM — liga-lhes". Só no ecrã: o porto não o
//   manda ao Telegram (a lista dos avisos para o Telegram é decisão do Ivo). alarmeTerra({ aberto, alarme
//   (ms), fecho: null | 'chegada' | 'terminado' }, agora).
//
// avaliar(estado, entrada, agora) → { estado, avisos: { caminho: { state, method, message, apito?, chave? } } }
//   entrada: { navegar, tripulacao, saida (ms), destino (nome), semGps, atrasoMin, vento: { medido,
//   previsto, desvioNos, desvioPct } | null, previsaoIdadeH | null (sem previsão), barometro: [{ t, hPa }],
//   recursos: { gasoleoChegadaL, bateriaChegadaPct }, eventos (deslizados, lib/acompanhamento.js),
//   chegadaNoite }. Os temporizadores ("30 min seguidos", "10 min normal") vivem no estado, em
//   memória: num reinício recomeçam (avisar mais tarde, nunca a dobrar).
// publicar(publicados, avisos) → { publicados, deltas: [{ path, value }] }: só as mudanças de estado (ou
//   de motivo, a chave, num aviso já ativo); o que estava publicado e desapareceu volta a normal. A
//   mensagem fica a do momento em que o aviso apareceu (outro delta fazia o ecrã apitar outra vez).
// publicadosDaArvore(arvore): o que já está publicado (a árvore notifications.rota do SignalK), para
//   um reinício não publicar outra vez o que já está ativo.

const { asHoras } = require('./plano')

const MIN = 60000
const H = 3600000
const PREFIXO = 'notifications.rota'
const METODO = Object.freeze(['visual', 'sound'])
const LIMITES = Object.freeze({
  lembreteMin: 30,
  comerH: 3,
  comerMin: 15,
  atrasoMin: 30,
  ventoPct: 30,
  ventoNos: 4,
  ventoSeguidosMin: 30,
  normalSeguidosMin: 10,
  gasoleoL: 40,
  bateriaPct: 50,
  previsaoAvisoH: 6,
  previsaoAlarmeH: 12,
  quedaHpa: 3,
  quedaApagaHpa: 2,
  janelaBaroH: 3,
  amostrasMaxMin: 2,
  alarmeTerraMin: 60
})
const CAMINHO_ALARME_TERRA = `${PREFIXO}.alarmeTerra`

const virgula = (x, d = 1) => x.toFixed(d).replace('.', ',')
// Os números das mensagens arredondam para o lado do aviso: nunca "atraso de 30 min" com o limite de
// mais de 30, nem "~40 L" com o de menos de 40 (o -1e-9 tira o erro de vírgula flutuante).
const acima = (x, d = 0) => Math.ceil(x * 10 ** d - 1e-9) / 10 ** d
const abaixo = (x) => Math.floor(x + 1e-9)
const novoEstado = () => ({ ventoForaDesde: null, recalcula: false, normalDesde: null, motivos: [], barometro: false, ultimaT: null })
const aviso = (state, message, extra = {}) => ({ state, method: [...METODO], message, ...extra })
const normal = () => aviso('normal', '')

// ---------- barómetro ----------
const juntarPressao = (amostras, amostra, agora) => [...amostras, amostra].filter(a => a.t >= agora - LIMITES.janelaBaroH * H - 5 * MIN)
// a queda (hPa) desde a amostra mais antiga das últimas 3 h até à mais recente; null sem amostras
function quedaEm3h (amostras, agora) {
  const dentro = amostras.filter(a => a.t >= agora - LIMITES.janelaBaroH * H && a.t <= agora && Number.isFinite(a.hPa)).sort((a, b) => a.t - b.t)
  if (!dentro.length) return null
  return dentro[0].hPa - dentro.at(-1).hPa
}

// ---------- lembretes ----------
const asHorasM = (t, agora) => { const s = asHoras(t, agora); return s.charAt(0).toUpperCase() + s.slice(1) }
function textoLembrete (e, t, agora, { chegadaNoite, destino }) {
  const quando = asHorasM(t, agora)
  if (e.tipo === 'vela') return `${quando}: ${e.texto}`
  if (e.tipo === 'noite' && /^pôr do sol/i.test(e.texto)) return `${quando}: pôr do sol — luzes, arnês, come antes de escurecer`
  if (e.tipo === 'tempo' && /^chuva/i.test(e.texto)) return `${quando}: chuva e pouca visibilidade — radar ligado e luzes`
  if (e.tipo === 'tempo' && /frente|roda/i.test(e.texto)) return `${quando}: ${e.texto}`
  if (e.tipo === 'chegada' && chegadaNoite) return `${quando}: chegada de noite a ${destino || 'destino'}`
  // os gerados do plano (Tarefa 8.5): a viragem num ponto da rota e a rotação do vento previsto
  if (e.tipo === 'viragem' || e.tipo === 'vento') return `${quando}: ${String(e.texto).charAt(0).toLowerCase()}${String(e.texto).slice(1)}`
  return null
}

function lembretes (entrada, agora) {
  const out = {}
  for (const e of entrada.eventos || []) {
    const t = Date.parse(e.t)
    if (!Number.isFinite(t) || agora < t - LIMITES.lembreteMin * MIN || agora >= t) continue
    if (entrada.semGps && e.sitio) continue
    const texto = textoLembrete(e, t, agora, entrada)
    if (texto) out[`${PREFIXO}.lembrete.${e.id}`] = aviso('alert', texto)
  }
  return out
}

function comer (entrada, agora) {
  if (entrada.tripulacao !== 'so' || !Number.isFinite(entrada.saida)) return normal()
  const desde = agora - entrada.saida
  const k = Math.floor(desde / (LIMITES.comerH * H))
  if (k >= 1 && desde - k * LIMITES.comerH * H < LIMITES.comerMin * MIN) return aviso('alert', `Come e bebe: ${LIMITES.comerH} h ao leme`)
  return normal()
}

// ---------- recalcula ----------
function recalcula (est, entrada, agora) {
  const atraso = Number.isFinite(entrada.atrasoMin) ? entrada.atrasoMin : null
  const condAtraso = atraso != null && atraso > LIMITES.atrasoMin
  const v = entrada.vento
  // com a previsão de calma (P50 0 nós, sem percentagem) só a regra dos 4 nós
  const pctOk = (x) => (Number.isFinite(x.desvioPct) ? Math.abs(x.desvioPct) > LIMITES.ventoPct : x.previsto === 0)
  const foraVento = !!v && Number.isFinite(v.desvioNos) && Math.abs(v.desvioNos) > LIMITES.ventoNos && pctOk(v)
  est.ventoForaDesde = foraVento ? est.ventoForaDesde ?? agora : null
  const condVento = foraVento && agora - est.ventoForaDesde >= LIMITES.ventoSeguidosMin * MIN
  const motivos = [...(condAtraso ? ['atraso'] : []), ...(condVento ? ['vento'] : [])]
  if (!est.recalcula && motivos.length) { est.recalcula = true; est.normalDesde = null; est.motivos = motivos }
  else if (est.recalcula) {
    est.motivos = [...new Set([...est.motivos, ...motivos])]
    if (!condAtraso && !foraVento) {
      est.normalDesde = est.normalDesde ?? agora
      if (agora - est.normalDesde >= LIMITES.normalSeguidosMin * MIN) { est.recalcula = false; est.normalDesde = null; est.motivos = [] }
    } else est.normalDesde = null
  }
  if (!est.recalcula) return normal()
  const partes = []
  if (condAtraso) partes.push(`atraso de ${acima(atraso)} min sobre o plano`)
  if (foraVento && (condVento || est.motivos.includes('vento'))) partes.push(`vento de ${Math.round(v.medido)} nós, previsto ${Math.round(v.previsto)}${Number.isFinite(v.desvioPct) ? ` (${v.desvioPct >= 0 ? '+' : '−'}${Math.round(Math.abs(v.desvioPct))} %)` : ''}`)
  // a voltar ao normal (os 10 min): o motivo que havia
  if (!partes.length) partes.push(est.motivos.includes('atraso') ? 'atraso sobre o plano a voltar ao normal' : 'vento a voltar ao previsto')
  return aviso('warn', `Recalcula a rota: ${partes.join(' · ')}`, { chave: est.motivos.join(' ') })
}

function recursosAviso (entrada) {
  const r = entrada.recursos || {}
  const partes = []
  if (Number.isFinite(r.gasoleoChegadaL) && r.gasoleoChegadaL < LIMITES.gasoleoL) partes.push(['gasoleo', `gasóleo à chegada ~${abaixo(r.gasoleoChegadaL)} L`])
  if (Number.isFinite(r.bateriaChegadaPct) && r.bateriaChegadaPct < LIMITES.bateriaPct) partes.push(['bateria', `bateria à chegada ~${abaixo(r.bateriaChegadaPct)} %`])
  if (!partes.length) return normal()
  return aviso('warn', `Recursos: ${partes.map(p => p[1]).join(' · ')}`, { chave: partes.map(p => p[0]).join(' ') })
}

function previsaoAviso (entrada) {
  const h = entrada.previsaoIdadeH
  if (h == null || !Number.isFinite(h)) return aviso('alarm', 'Sem previsão: confia nos instrumentos e no barómetro', { apito: 'curto' })
  if (h > LIMITES.previsaoAlarmeH) return aviso('alarm', `Previsão com ${Math.round(h)} h: confia nos instrumentos e no barómetro`, { apito: 'curto' })
  if (h > LIMITES.previsaoAvisoH) return aviso('warn', `Previsão com ${Math.round(h)} h`)
  return normal()
}

function barometroAviso (est, entrada, agora) {
  const queda = quedaEm3h(entrada.barometro || [], agora)
  if (queda == null) { est.barometro = false; return normal() }
  if (!est.barometro && queda > LIMITES.quedaHpa) est.barometro = true
  else if (est.barometro && queda <= LIMITES.quedaApagaHpa) est.barometro = false
  return est.barometro ? aviso('warn', `Barómetro: caiu ${virgula(acima(queda, 1))} hPa em 3 h — o tempo pode piorar antes do previsto`) : normal()
}

function avaliar (estado0, entrada, agora) {
  const est = { ...novoEstado(), ...estado0 }
  if (!entrada.navegar) {
    const n = novoEstado()
    return { estado: n, avisos: Object.fromEntries(['comer', 'recalcula', 'recursos', 'previsao', 'barometro'].map(k => [`${PREFIXO}.${k}`, normal()])) }
  }
  // os "seguidos" (30 min do vento, 10 min normal) só com amostras a ≤ 2 min umas das outras: um salto
  // do relógio (para a frente ou para trás) recomeça-os
  if (est.ultimaT != null && (agora - est.ultimaT > LIMITES.amostrasMaxMin * MIN || agora < est.ultimaT)) { est.ventoForaDesde = null; est.normalDesde = null }
  est.ultimaT = agora
  const avisos = {
    ...lembretes(entrada, agora),
    [`${PREFIXO}.comer`]: comer(entrada, agora),
    [`${PREFIXO}.recalcula`]: recalcula(est, entrada, agora),
    [`${PREFIXO}.recursos`]: recursosAviso(entrada),
    [`${PREFIXO}.previsao`]: previsaoAviso(entrada),
    [`${PREFIXO}.barometro`]: barometroAviso(est, entrada, agora)
  }
  return { estado: est, avisos }
}

// ---------- a hora de alarme em terra (revisão final I2) ----------
// fecho (auditoria K-12): com o plano já fechado, o "cheguei bem" ('chegada') ou a "viagem terminada"
// ('terminado') deste envio ainda por entregar a terra (sem rede na marina, o porto desligado): o aviso
// fica, também depois da hora de alarme, até a mensagem chegar.
const FECHO_TEXTO = Object.freeze({ chegada: 'O «cheguei bem»', terminado: 'A «viagem terminada»' })
function alarmeTerra ({ aberto, alarme, fecho = null }, agora) {
  if (!(aberto || fecho) || !Number.isFinite(alarme) || agora < alarme - LIMITES.alarmeTerraMin * MIN) return normal()
  const chave = new Date(alarme).toISOString()
  if (fecho) return aviso('alert', `${FECHO_TEXTO[fecho] ?? 'A mensagem de fecho'} ainda não chegou a terra: os contactos ligam ao MRCC ${asHoras(alarme, agora)} — liga-lhes`, { apito: 'curto', chave: `${chave} ${fecho}` })
  return aviso('alert', `Os contactos em terra ligam ao MRCC ${asHoras(alarme, agora)}: avisa-os ou Terminar`, { apito: 'curto', chave })
}

// ---------- publicar ----------
function publicar (publicados0 = {}, avisos = {}) {
  const publicados = { ...publicados0 }
  const deltas = []
  const valor = (a) => { const { chave, ...v } = a; return v }
  for (const [caminho, a] of Object.entries(avisos)) {
    const antes = publicados[caminho]
    const chave = a.chave ?? null
    const mudou = !antes || antes.state !== a.state || (a.state !== 'normal' && antes.chave != null && chave != null && antes.chave !== chave)
    if (mudou) deltas.push({ path: caminho, value: valor(a) })
    publicados[caminho] = { state: a.state, chave: mudou ? chave : antes.chave ?? chave }
  }
  for (const [caminho, antes] of Object.entries(publicados0)) {
    if (caminho in avisos || antes.state === 'normal') continue
    deltas.push({ path: caminho, value: normal() })
    publicados[caminho] = { state: 'normal', chave: null }
  }
  return { publicados, deltas }
}

function publicadosDaArvore (arvore, prefixo = PREFIXO) {
  const out = {}
  if (!arvore || typeof arvore !== 'object') return out
  if (arvore.value && typeof arvore.value === 'object' && typeof arvore.value.state === 'string') out[prefixo] = { state: arvore.value.state, chave: null }
  for (const [k, v] of Object.entries(arvore)) {
    if (['value', 'timestamp', '$source', 'values', 'meta'].includes(k)) continue
    Object.assign(out, publicadosDaArvore(v, `${prefixo}.${k}`))
  }
  return out
}

module.exports = { PREFIXO, METODO, LIMITES, CAMINHO_ALARME_TERRA, alarmeTerra, acima, novoEstado, juntarPressao, quedaEm3h, avaliar, publicar, publicadosDaArvore }
