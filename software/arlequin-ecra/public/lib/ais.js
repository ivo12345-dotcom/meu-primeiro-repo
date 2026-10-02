// AIS no ecrã: o tipo do navio em pt-PT (auditoria I-32). O SignalK manda design.aisShipType = { id, name }
// com o nome em inglês ("Cargo ship", "Pleasure"…): o ecrã traduz pelo código da norma AIS (ITU-R M.1371),
// nunca mostra o nome do servidor.

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
