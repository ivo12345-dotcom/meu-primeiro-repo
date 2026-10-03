// Blocos repetidos entre páginas.

import { velocidade, distancia, duracao, num, rumo, anguloBordo, graus, nos } from '../lib/formato.js'
import { barra } from '../lib/desenho.js'
import { esc, idade as haTempo } from '../lib/rota-texto.js'
import { leituraCpa, semRumoTexto } from '../lib/ais.js'

const ok = (v) => typeof v === 'number' && Number.isFinite(v)

// O consumo de cruzeiro do D1-20B: 1,45 L/h a 2100 rpm, o mesmo que a rota planeia (rota/lib/base.js:
// litrosHora(RPM_CRUZEIRO)) e o simulador cruza (F3b, item 7; antes 0,9 L/h). Nenhum plugin o publica.
export const CONSUMO_CRUZEIRO = 1.45 / 3600 / 1000 // m³/s (1,45 L/h)
export const VELOCIDADE_MOTOR = 5.5 * 1852 / 3600 // m/s
// Os limites dos alarmes (auditoria M-51): a cor do ecrã muda onde o alarme dispara.
export const RESERVA_GASOLEO_L = 40 // a reserva do plugin do gasóleo (≤ 40 L, signalk-arlequin-gasoleo/lib/nivel.js)
export const TEMPERATURA_ALARME_C = 95 // o sobreaquecimento do J1939 (≥ 95 °C, signalk-arlequin-j1939/lib/motor.js)

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

// Gasóleo: litros, autonomia em horas e em MN (ao consumo atual ou de cruzeiro). O plugin do gasóleo publica o nível
// de segundo a segundo; sem a sonda e sem leitura do motor deixa de o publicar (a hora dele na árvore envelhece,
// revisão F6b): com mais de 2 min o nível é velho — "sem leitura (último N L, há X min)", nunca os litros como atuais
// (nem a barra, nem a cor da reserva, nem a autonomia). O 2 min é largo para o plugin (a sonda vale 60 s) e curto para
// um depósito que se esvazia devagar.
export const NIVEL_GASOLEO_VELHO_MS = 2 * 60 * 1000
export function gasoleo (ctx) {
  const nivel = ctx.v('tanks.fuel.0.currentLevel')
  const cap = ctx.v('tanks.fuel.0.capacity')
  if (!ok(nivel) || !ok(cap)) return { html: '<span class="lab">sem dados do depósito</span>', nivel: null, litros: null }
  const litros = nivel * cap * 1000
  const idadeMs = typeof ctx.idade === 'function' ? ctx.idade('tanks.fuel.0.currentLevel') : 0
  if (!(idadeMs <= NIVEL_GASOLEO_VELHO_MS)) {
    const agora = Number.isFinite(ctx.agora) ? ctx.agora : Date.now()
    const ha = Number.isFinite(idadeMs) ? `, ${haTempo(agora - idadeMs, agora)}` : ''
    return { html: `<span class="atencao sem-leitura">sem leitura (último ${num(litros, 0)} L${ha})</span>`, nivel: null, litros: null, velho: { litros, idadeMs } }
  }
  const taxa = ctx.v('propulsion.main.fuel.rate')
  const consumo = ok(taxa) && taxa > 0 ? taxa : CONSUMO_CRUZEIRO
  const horas = (nivel * cap) / consumo / 3600
  const sog = ctx.v('navigation.speedOverGround')
  const vel = ok(taxa) && taxa > 0 && ok(sog) && sog > 0.5 ? sog : VELOCIDADE_MOTOR
  const milhas = horas * 3600 * vel / 1852
  return {
    nivel,
    litros,
    html: `${num(litros, 0)} L de ${num(cap * 1000, 0)} · ~${num(horas, 0)} h · ~${num(milhas, 0)} MN`
  }
}

// a cor da barra do gasóleo
// vermelho a ≤ 40 L, como a reserva do plugin (antes: < 20 % da capacidade, que só dava 40 L com 200 L); cinzento sem
// leitura (um nível velho não é verde nem vermelho)
export const corGasoleo = (g) => (g.velho ? 'var(--linha)' : ok(g.litros) && g.litros <= RESERVA_GASOLEO_L + 1e-9 ? 'var(--bb)' : 'var(--verde)')

export function tileGasoleo (ctx, grande = false) {
  const g = gasoleo(ctx)
  return `<div class="tile"><div class="linha"><span class="lab">Gasóleo</span><span class="${grande ? 'v' : ''}">${g.html}</span></div>${barra(g.nivel, corGasoleo(g))}</div>`
}

// O motor pelas rotações (Hz) e pela ligação do plugin J1939 (auditoria I-23; contrato C11): true a trabalhar
// (> 5 Hz = 300 rpm), false desligado, null sem leitura. Sem tramas há 5 s o J1939 publica as rotações a null, e
// isso é tanto a ignição desligada como a leitura perdida com o motor a trabalhar: o ecrã não pode dizer
// "desligado" por um null. A propulsion.main.ligacao distingue-os: 'calado' (a interface CAN de pé e ninguém a
// falar: a ignição desligada) é desligado — e conta como vela —; 'sem-ligacao' (a interface em baixo ou o leitor
// a falhar) é desconhecido; 'a-receber', pelas rotações (a null: o MDI fala mas sem a EEC1, sem leitura). Sem o
// estado (um plugin antigo, os 1.ºs 5 s) ou com um valor que não se conhece, pelas rotações como até aqui.
export const motorLigado = (rpm, ligacao) => (ligacao === 'calado' ? false : ligacao === 'sem-ligacao' ? null : ok(rpm) ? rpm > 5 : null)

// O estado do motor de um contexto ({ v, idade }): as rotações e a ligação. O plugin publica a ligação de segundo
// a segundo; com mais de 20 s está parado (e as rotações com ela): não se sabe, nunca "desligado".
export const LIGACAO_MOTOR_VELHA_MS = 20000
export function motorEstado (ctx) {
  const ligacao = ctx.v('propulsion.main.ligacao')
  const velha = typeof ligacao === 'string' && typeof ctx.idade === 'function' && !(ctx.idade('propulsion.main.ligacao') < LIGACAO_MOTOR_VELHA_MS)
  return motorLigado(ctx.v('propulsion.main.revolutions'), velha ? 'sem-ligacao' : ligacao)
}
export const ESTADO_MOTOR = { true: 'a trabalhar', false: 'motor desligado', null: 'sem leitura do motor' }
export const CLASSE_MOTOR = { true: 'amarelo', false: 'ok', null: 'lab' }

export function motorResumo (ctx) {
  const rpm = ctx.v('propulsion.main.revolutions')
  const m = motorEstado(ctx)
  const ligado = m === true
  const horas = ctx.v('propulsion.main.runTime')
  const soc = ctx.v('electrical.batteries.servico.capacity.stateOfCharge')
  return {
    ligado,
    semLeitura: m === null,
    estado: ligado ? `<span class="amarelo">a trabalhar · ${num(rpm * 60, 0)} rpm</span>` : `<span class="${CLASSE_MOTOR[m]}">${ESTADO_MOTOR[m]}</span>`,
    // o SoC para baixo, como a página Motor e o plugin da energia (49,6 % é 49 %, auditoria M-51)
    detalhe: `${ok(horas) ? num(horas / 3600, 0) + ' h' : '— h'} · serviço ${ok(soc) ? num(Math.floor(soc * 100 + 1e-9), 0) + '%' : '—'}`
  }
}

// Um alvo na Carta: o nome e o CPA · TCPA (lib/ais.js leituraCpa); sem o rumo de um dos barcos, a distância e o
// porquê (revisão F3, Minor 7: dava "— MN · —").
export function linhaAlvo (a) {
  const cls = a.classe === 'perigo' ? 'perigo' : a.classe === 'atencao' ? 'atencao' : ''
  const l = leituraCpa(a.r)
  const cpaTxt = l.tipo === 'cpa' ? `${distancia(l.cpa)} MN · ${duracao(l.tcpa)}`
    : l.tipo === 'paralelo' ? `${distancia(l.cpa)} MN · —`
      : l.tipo === 'afasta' ? 'afasta-se'
        : l.tipo === 'distancia' ? `${distancia(a.r.distancia)} MN · ${semRumoTexto(l.semVelocidade)}`
          : '—'
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
