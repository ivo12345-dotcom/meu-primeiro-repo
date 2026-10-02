// CPA/TCPA com um plano local (equiretangular) à volta do nosso barco.
// Chega para distâncias AIS (dezenas de MN). Unidades SI: m, s, rad, m/s.
// Usado pelo ecrã e pelo plugin signalk-arlequin-ais (mesmo cálculo e mesma classificação).
//
// A velocidade de cada barco (auditoria K-01 e I-09, decisão n.º 3):
//   - SOG abaixo de 0,5 nó (PARADO) conta como parado, sem precisar do COG: um navio fundeado manda
//     COG 360 ("não disponível") e o SignalK nem publica o campo; o nosso GPS parado "deriva" e
//     também pode calar o COG;
//   - a partir de 0,5 nó é preciso o COG; sem ele, ou sem SOG, a velocidade é desconhecida.
// Com as duas velocidades, o CPA/TCPA de sempre. Com a velocidade relativa nula (os dois parados, ou
// lado a lado ao mesmo rumo e à mesma velocidade) ninguém se aproxima: TCPA infinito, nunca 'perigo'.
// Sem a velocidade de um deles não há CPA: só a distância, com semVelocidade = 'alvo' | 'eu' | 'ambos';
// quem tem o histórico (o plugin AIS) diz se o alvo se aproxima, e aí classificar dá 'perigo' a menos
// de 0,5 MN (a regra da distância). O plugin, que guarda o rasto de cada barco, passa-lhe a velocidade
// estimada pelo rasto quando falta a medida; o ecrã não tem rasto.
// O resultado diz também se cada barco está parado: euParado, alvoParado (true/false; undefined sem
// velocidade conhecida).
//
// Em porto (decisão do Ivo de 02/10, contrato C12): com emPorto (o plugin AIS publica-o em
// navigation.arlequin.emPorto: a menos de 0,5 MN de um porto conhecido e com o nosso SOG abaixo de
// 4 nós) um alvo parado, ou ainda sem velocidade conhecida, nunca é 'perigo': fica 'atencao' (amarelo
// no ecrã, sem som). Um alvo em movimento dá 'perigo' como fora do porto.

const M_POR_GRAU = 111320

export const LIMITES_AIS = Object.freeze({ cpa: 0.5 * 1852, tcpa: 20 * 60 })
export const PARADO = 0.5 * 1852 / 3600 // m/s (0,5 nó)
// "Em porto" (contrato C12): a menos disto de um porto conhecido e com o nosso SOG abaixo disto.
export const LIMITES_PORTO = Object.freeze({ distancia: 0.5 * 1852, sog: 4 * 1852 / 3600 })

const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const temPos = (p) => p && ok(p.latitude) && ok(p.longitude)

// { vx, vy, parado } (m/s, x para leste, y para norte), ou null se não se sabe.
function velocidade (b) {
  if (!ok(b.sog)) return null
  if (b.sog < PARADO) return { vx: 0, vy: 0, parado: true }
  if (!ok(b.cog)) return null
  return { vx: b.sog * Math.sin(b.cog), vy: b.sog * Math.cos(b.cog), parado: false }
}

// barco: { position: {latitude, longitude}, cog (rad), sog (m/s) }
// → { cpa, tcpa, distancia, marcacao, euParado, alvoParado }
//   | { cpa: null, tcpa: null, distancia, marcacao, semVelocidade, euParado, alvoParado } | null (sem posição)
export function cpa (eu, ele) {
  if (!eu || !ele || !temPos(eu.position) || !temPos(ele.position)) return null

  const cosLat = Math.cos(eu.position.latitude * Math.PI / 180)
  const rx = (ele.position.longitude - eu.position.longitude) * M_POR_GRAU * cosLat
  const ry = (ele.position.latitude - eu.position.latitude) * M_POR_GRAU
  const distancia = Math.hypot(rx, ry)
  const marcacao = (Math.atan2(rx, ry) + 2 * Math.PI) % (2 * Math.PI)

  const vEu = velocidade(eu)
  const vEle = velocidade(ele)
  const parados = { euParado: vEu?.parado, alvoParado: vEle?.parado }
  if (!vEu || !vEle) {
    const semVelocidade = !vEu && !vEle ? 'ambos' : !vEu ? 'eu' : 'alvo'
    return { cpa: null, tcpa: null, distancia, marcacao, semVelocidade, ...parados }
  }

  const vx = vEle.vx - vEu.vx
  const vy = vEle.vy - vEu.vy
  const v2 = vx * vx + vy * vy
  if (v2 < 1e-9) return { cpa: distancia, tcpa: Infinity, distancia, marcacao, ...parados }

  const tcpa = -(rx * vx + ry * vy) / v2
  const cpaM = Math.hypot(rx + vx * tcpa, ry + vy * tcpa)
  return { cpa: cpaM, tcpa, distancia, marcacao, ...parados }
}

// 'perigo' | 'atencao' | 'seguro' | 'afasta' | 'desconhecido'
// aproxima: só conta sem a velocidade de um dos barcos (semVelocidade): true se a distância está a
// diminuir (quem chama tem o histórico). Sem ela, perto fica 'atencao' e longe 'desconhecido'.
// emPorto (contrato C12): um alvo parado, ou sem velocidade conhecida, nunca dá 'perigo' (fica 'atencao').
export function classificar (r, lim = LIMITES_AIS, { aproxima = false, emPorto = false } = {}) {
  if (!r) return 'desconhecido'
  const caladoNoPorto = emPorto && r.alvoParado !== false
  if (r.semVelocidade) return r.distancia < lim.cpa ? (aproxima && !caladoNoPorto ? 'perigo' : 'atencao') : 'desconhecido'
  if (r.tcpa < 0) return 'afasta'
  if (r.cpa < lim.cpa && r.tcpa < lim.tcpa) return caladoNoPorto ? 'atencao' : 'perigo'
  if (r.cpa < lim.cpa) return 'atencao'
  return 'seguro'
}
