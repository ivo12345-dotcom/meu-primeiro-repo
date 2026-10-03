// AIS no ecrã: os alvos por ordem de perigo e o tipo do navio em pt-PT.
//   alvosAis: o CPA/TCPA de cada alvo (lib/cpa.js, o mesmo cálculo do plugin signalk-arlequin-ais) e a classe;
//     enquanto o alarme do plugin estiver ativo é "perigo" (auditoria M-50: o plugin só o limpa acima de
//     0,6 MN, e o ecrã chamava "atenção" a um alvo com o alarme a tocar) e vai à frente da lista, também sem o
//     nosso SOG (o plugin alarma pela velocidade tirada do rasto, que o ecrã não tem). Em porto (contrato C12,
//     emPorto: o plugin publica navigation.arlequin.emPorto) um alvo parado, ou ainda sem velocidade, fica
//     "atenção" (amarelo, sem som) em vez de "perigo".
//   tipoAis: o SignalK manda design.aisShipType = { id, name } com o nome em inglês ("Cargo ship",
//     "Pleasure"…): o ecrã traduz pelo código da norma AIS (ITU-R M.1371), nunca mostra o nome do servidor
//     (auditoria I-32).

import { cpa, classificar, LIMITES_AIS } from './cpa.js'

export const AIS_VELHO = 10 * 60 * 1000 // um alvo sem posição há mais de 10 min sai da lista
const ORDEM = { perigo: 0, atencao: 1, seguro: 2, afasta: 3, desconhecido: 4 }
const comAlarme = (notificacoes, mmsi) => notificacoes.some(n => n?.caminho === `notifications.arlequin.ais.${mmsi}` && (n.state === 'alarm' || n.state === 'emergency'))

// O "em porto" do SignalK (contrato C12): navigation.arlequin.emPorto, true a menos de 0,5 MN de um porto conhecido e
// com o nosso SOG abaixo de 4 nós (o plugin AIS publica-o de 2 em 2 s; null sem a nossa posição). Só conta quando é
// true e recente: false, null, velho (o plugin parou) ou em falta é "fora do porto" — o lado do perigo.
export const EM_PORTO_VELHO_MS = 30000
export const EM_PORTO_AVISO = 'Em porto: os alvos parados aparecem a amarelo e não apitam'
export const emPortoDe = ({ v, idade }) => v('navigation.arlequin.emPorto') === true && typeof idade === 'function' && idade('navigation.arlequin.emPorto') < EM_PORTO_VELHO_MS

// { vessels (os alvos do store), eu { position, cog, sog }, notificacoes, agora, emPorto } → [{ ...alvo, r, classe }]
export function alvosAis ({ vessels = [], eu = {}, notificacoes = [], agora = Date.now(), emPorto = false } = {}) {
  const lista = []
  for (const a of vessels) {
    if (!a?.position || !(agora - a.em <= AIS_VELHO)) continue
    const r = cpa(eu, a)
    const classe = comAlarme(notificacoes, a.mmsi) ? 'perigo' : classificar(r, LIMITES_AIS, { aproxima: false, emPorto })
    lista.push({ ...a, r, classe })
  }
  return lista.sort((x, y) => (ORDEM[x.classe] - ORDEM[y.classe]) || ((x.r?.distancia ?? 1e9) - (y.r?.distancia ?? 1e9)))
}

// O que mostrar do CPA/TCPA de um alvo, a partir das formas que o cpa() devolve (revisão F3, Minor 7; o cpa.js é da
// F6): nunca depende de null >= 0 (que é true: um alvo só com a distância saía como "— MN · —" ou, com outra forma,
// como "afasta-se").
//   'cpa'       { cpa, tcpa }   CPA e TCPA (a aproximar-se)
//   'paralelo'  { cpa }         a velocidade relativa nula (lado a lado ou os dois parados): o CPA é a distância, sem TCPA
//   'afasta'                    TCPA negativo
//   'distancia' { semVelocidade } sem o rumo de um deles ('alvo', 'eu' ou 'ambos'): só a distância
//   'nada'                      sem posição, ou uma forma que não se conhece
// A distância sem CPA diz de quem é o rumo que falta (F3b, item 5; as mesmas palavras do plugin AIS):
const SEM_RUMO = { alvo: 'sem rumo do alvo', eu: 'sem o nosso rumo', ambos: 'sem rumo de nenhum dos dois' }
export const semRumoTexto = (semVelocidade) => SEM_RUMO[semVelocidade] ?? 'sem rumo'
export const SEM_O_NOSSO_RUMO = 'Sem o nosso rumo (COG/SOG do GPS): só a distância de cada alvo, sem CPA nem TCPA'
const finito = (x) => typeof x === 'number' && Number.isFinite(x)
export function leituraCpa (r) {
  if (!r || !finito(r.distancia)) return { tipo: 'nada' }
  if (r.semVelocidade) return { tipo: 'distancia', semVelocidade: r.semVelocidade }
  if (!finito(r.cpa) || typeof r.tcpa !== 'number' || Number.isNaN(r.tcpa)) return { tipo: 'nada' }
  if (r.tcpa < 0) return { tipo: 'afasta' }
  if (r.tcpa === Infinity) return { tipo: 'paralelo', cpa: r.cpa }
  return { tipo: 'cpa', cpa: r.cpa, tcpa: r.tcpa }
}
// Sem o nosso rumo (o semVelocidade 'eu' ou 'ambos' do cpa()): a AIS di-lo numa linha.
export const semONossoRumo = (alvos) => (alvos || []).some(a => a?.r?.semVelocidade === 'eu' || a?.r?.semVelocidade === 'ambos')

const TIPOS = [
  [20, 29, 'Asa de efeito solo'],
  [30, 30, 'Pesca'], [31, 32, 'Reboque'], [33, 33, 'Dragagem ou trabalhos submarinos'], [34, 34, 'Mergulho'],
  [35, 35, 'Militar'], [36, 36, 'Veleiro'], [37, 37, 'Recreio'],
  [40, 49, 'Alta velocidade'],
  [50, 50, 'Piloto'], [51, 51, 'Busca e salvamento'], [52, 52, 'Rebocador'], [53, 53, 'Apoio portuário'],
  [54, 54, 'Combate à poluição'], [55, 55, 'Autoridade'], [56, 57, 'Embarcação local'], [58, 58, 'Transporte médico'],
  [59, 59, 'Navio não combatente'],
  [60, 69, 'Passageiros'], [70, 79, 'Carga'], [80, 89, 'Navio-tanque'], [90, 99, 'Outro']
]

// { id, name } → "Recreio", "Carga · carga perigosa"; "—" sem um código conhecido (nunca o inglês).
export function tipoAis (tipo) {
  const id = tipo && typeof tipo === 'object' ? tipo.id : null
  if (!Number.isInteger(id)) return '—'
  const t = TIPOS.find(([de, ate]) => id >= de && id <= ate)
  if (!t) return '—'
  // nos de alta velocidade, passageiros, carga, navio-tanque e outros, o 2.º algarismo de 1 a 4: carga perigosa
  const perigosa = id >= 40 && !(id >= 50 && id <= 59) && id % 10 >= 1 && id % 10 <= 4
  return perigosa ? `${t[2]} · carga perigosa` : t[2]
}
