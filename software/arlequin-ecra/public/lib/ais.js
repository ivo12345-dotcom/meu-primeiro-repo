// AIS no ecrã: os alvos por ordem de perigo e o tipo do navio em pt-PT.
//   alvosAis: o CPA/TCPA de cada alvo (lib/cpa.js, o mesmo cálculo do plugin signalk-arlequin-ais) e a classe;
//     enquanto o alarme do plugin estiver ativo é "perigo" (auditoria M-50: o plugin só o limpa acima de
//     0,6 MN, e o ecrã chamava "atenção" a um alvo com o alarme a tocar).
//   tipoAis: o SignalK manda design.aisShipType = { id, name } com o nome em inglês ("Cargo ship",
//     "Pleasure"…): o ecrã traduz pelo código da norma AIS (ITU-R M.1371), nunca mostra o nome do servidor
//     (auditoria I-32).

import { cpa, classificar } from './cpa.js'

export const AIS_VELHO = 10 * 60 * 1000 // um alvo sem posição há mais de 10 min sai da lista
const ORDEM = { perigo: 0, atencao: 1, seguro: 2, afasta: 3, desconhecido: 4 }
const comAlarme = (notificacoes, mmsi) => notificacoes.some(n => n?.caminho === `notifications.arlequin.ais.${mmsi}` && (n.state === 'alarm' || n.state === 'emergency'))

// { vessels (os alvos do store), eu { position, cog, sog }, notificacoes, agora } → [{ ...alvo, r, classe }]
export function alvosAis ({ vessels = [], eu = {}, notificacoes = [], agora = Date.now() } = {}) {
  const lista = []
  for (const a of vessels) {
    if (!a?.position || !(agora - a.em <= AIS_VELHO)) continue
    const r = cpa(eu, a)
    const classe = comAlarme(notificacoes, a.mmsi) ? 'perigo' : classificar(r)
    lista.push({ ...a, r, classe })
  }
  return lista.sort((x, y) => (ORDEM[x.classe] - ORDEM[y.classe]) || ((x.r?.distancia ?? 1e9) - (y.r?.distancia ?? 1e9)))
}

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
