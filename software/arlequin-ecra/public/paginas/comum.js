// Blocos repetidos entre páginas.

import { velocidade, distancia, duracao, num, rumo, anguloBordo, graus, nos } from '../lib/formato.js'
import { barra } from '../lib/desenho.js'
import { esc } from '../lib/rota-texto.js'

const ok = (v) => typeof v === 'number' && Number.isFinite(v)

export const CONSUMO_CRUZEIRO = 0.9 / 3600 / 1000 // m³/s (0,9 L/h)
export const VELOCIDADE_MOTOR = 5.5 * 1852 / 3600 // m/s

export function tile (lab, valorHtml, extra = '', cls = 'v') {
  return `<div class="tile"><div class="lab">${lab}</div><div class="${cls}">${valorHtml}</div>${extra}</div>`
}

export function ventoTexto (ctx) {
  const awa = ctx.v('environment.wind.angleApparent')
  const aws = ctx.v('environment.wind.speedApparent')
  const tws = ctx.v('environment.wind.speedTrue')
  const twd = ctx.v('environment.wind.directionTrue')
  return {
    aparente: `${anguloBordo(awa)} · ${velocidade(aws)} nós`,
    real: `real ${velocidade(tws)} nós de ${rumo(twd)}`
  }
}

// Gasóleo: litros, autonomia em horas e em MN (ao consumo atual ou de cruzeiro).
export function gasoleo (ctx) {
  const nivel = ctx.v('tanks.fuel.0.currentLevel')
  const cap = ctx.v('tanks.fuel.0.capacity')
  if (!ok(nivel) || !ok(cap)) return { html: '<span class="lab">sem dados do depósito</span>', nivel: null }
  const litros = nivel * cap * 1000
  const taxa = ctx.v('propulsion.main.fuel.rate')
  const consumo = ok(taxa) && taxa > 0 ? taxa : CONSUMO_CRUZEIRO
  const horas = (nivel * cap) / consumo / 3600
  const sog = ctx.v('navigation.speedOverGround')
  const vel = ok(taxa) && taxa > 0 && ok(sog) && sog > 0.5 ? sog : VELOCIDADE_MOTOR
  const milhas = horas * 3600 * vel / 1852
  return {
    nivel,
    html: `${num(litros, 0)} L de ${num(cap * 1000, 0)} · ~${num(horas, 0)} h · ~${num(milhas, 0)} MN`
  }
}

// a cor da barra do gasóleo
export const corGasoleo = (g) => (g.nivel !== null && g.nivel < 0.2 ? 'var(--bb)' : 'var(--verde)')

export function tileGasoleo (ctx, grande = false) {
  const g = gasoleo(ctx)
  return `<div class="tile"><div class="linha"><span class="lab">Gasóleo</span><span class="${grande ? 'v' : ''}">${g.html}</span></div>${barra(g.nivel, corGasoleo(g))}</div>`
}

// O motor pelas rotações (Hz) do J1939 (auditoria I-23): true a trabalhar (> 5 Hz = 300 rpm), false
// desligado, null sem leitura (o J1939 publica null sem tramas há 5 s: tanto a ignição desligada como o
// sensor perdido com o motor a trabalhar — o ecrã não pode dizer "desligado").
export const motorLigado = (rpm) => (ok(rpm) ? rpm > 5 : null)
export const ESTADO_MOTOR = { true: 'a trabalhar', false: 'desligado', null: 'sem leitura do motor' }
export const CLASSE_MOTOR = { true: 'amarelo', false: 'ok', null: 'lab' }

export function motorResumo (ctx) {
  const rpm = ctx.v('propulsion.main.revolutions')
  const m = motorLigado(rpm)
  const ligado = m === true
  const horas = ctx.v('propulsion.main.runTime')
  const soc = ctx.v('electrical.batteries.servico.capacity.stateOfCharge')
  return {
    ligado,
    semLeitura: m === null,
    estado: ligado ? `<span class="amarelo">a trabalhar · ${num(rpm * 60, 0)} rpm</span>` : `<span class="${CLASSE_MOTOR[m]}">${ESTADO_MOTOR[m]}</span>`,
    detalhe: `${ok(horas) ? num(horas / 3600, 0) + ' h' : '— h'} · serviço ${ok(soc) ? num(soc * 100, 0) + '%' : '—'}`
  }
}

export function linhaAlvo (a) {
  const cls = a.classe === 'perigo' ? 'perigo' : a.classe === 'atencao' ? 'atencao' : ''
  const cpaTxt = a.r && a.r.tcpa >= 0 ? `${distancia(a.r.cpa)} MN · ${duracao(a.r.tcpa)}` : a.r && a.r.tcpa < 0 ? 'afasta-se' : '—'
  return `<div class="linha ${cls}"><span>${esc(a.name || a.mmsi)}</span><span>${cpaTxt}</span></div>`
}

// A proa verdadeira (auditoria I-11): navigation.headingTrue; sem ela, a magnética + a declinação
// (navigation.magneticVariation, a leste positiva: verdadeira = magnética + declinação), porque as bússolas
// do barco são magnéticas. Sem nenhuma, ou sem a declinação, null ("—"). → { valor (rad), magnetica } | null
export function proa (ctx) {
  const v = ctx.v('navigation.headingTrue')
  if (ok(v)) return { valor: v, magnetica: false }
  const m = ctx.v('navigation.headingMagnetic')
  const d = ctx.v('navigation.magneticVariation')
  if (ok(m) && ok(d)) return { valor: (((m + d) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), magnetica: true }
  return null
}
// " (mag.)" quando a proa vem da bússola magnética (a declinação pode estar errada uns graus)
export const marcaMag = (p) => (p?.magnetica ? ' (mag.)' : '')

export function proximoWp (ctx) {
  const dist = ctx.v('navigation.course.calcValues.distance') ?? ctx.v('navigation.courseRhumbline.nextPoint.distance')
  const rumoWp = ctx.v('navigation.course.calcValues.bearingTrue') ?? ctx.v('navigation.courseRhumbline.nextPoint.bearingTrue')
  const xte = ctx.v('navigation.course.calcValues.crossTrackError') ?? ctx.v('navigation.courseRhumbline.crossTrackError')
  const ttg = ctx.v('navigation.course.calcValues.timeToGo')
  const vmg = ctx.v('navigation.course.calcValues.velocityMadeGood')
  // o nome do ponto (o SignalK põe o do coordinatesMeta da rota); sem ele, qual é na rota ativa ("ponto 3 de
  // 57", auditoria M-49: dizia sempre "WP"); sem rota, "WP"
  const np = ctx.v('navigation.course.nextPoint')?.name
  const ar = ctx.v('navigation.course.activeRoute')
  const nome = typeof np === 'string' && np.trim() ? np
    : Number.isInteger(ar?.pointIndex) && Number.isInteger(ar?.pointTotal) ? `ponto ${ar.pointIndex + 1} de ${ar.pointTotal}` : 'WP'
  return { ativo: ok(dist), dist, rumoWp, xte, ttg, vmg, nome }
}

export { velocidade, distancia, duracao, num, rumo, anguloBordo, graus, nos, ok, esc }
