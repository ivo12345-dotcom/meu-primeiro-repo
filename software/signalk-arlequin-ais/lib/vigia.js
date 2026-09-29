'use strict'
// Vigia AIS: para cada alvo decide se há alarme de colisão. Lógica pura; o
// cálculo de CPA/TCPA vem de arlequin-ecra/public/lib/cpa.js (injetado), para
// o ecrã e o servidor darem exatamente o mesmo resultado.

const VELHO = 10 * 60 * 1000 // alvo sem posição há mais de 10 min = desapareceu
const LIMPA_CPA = 0.6 * 1852 // histerese: só limpa acima de 0,6 MN

const nm = (m) => (m / 1852).toFixed(1).replace('.', ',')

function mensagem (a, r) {
  const min = Math.max(0, Math.round(r.tcpa / 60))
  return `${a.nome || a.mmsi}: CPA ${nm(r.cpa)} MN daqui a ${min} min`
}

// eu: { position, cog, sog }; alvos: [{ mmsi, nome, position, cog, sog, em }]
// ativos: { mmsi: true }. Devolve { ativos, notificacoes: [{ mmsi, state, method, message }] }
function avaliarAlvos (ativos, eu, alvos, agora, { cpa, classificar }) {
  const novos = {}
  const notificacoes = []
  const vistos = new Set()

  for (const a of alvos) {
    if (!a.em || agora - a.em > VELHO) continue
    vistos.add(a.mmsi)
    const r = cpa(eu, a)
    const classe = classificar(r)
    const estava = !!ativos[a.mmsi]
    const perigo = classe === 'perigo' || (estava && r && r.tcpa >= 0 && r.cpa < LIMPA_CPA)
    if (perigo) {
      novos[a.mmsi] = true
      if (!estava) notificacoes.push({ mmsi: a.mmsi, state: 'alarm', method: ['visual', 'sound'], message: mensagem(a, r) })
    } else if (estava) {
      notificacoes.push({ mmsi: a.mmsi, state: 'normal', method: [], message: 'Normal' })
    }
  }
  // Alvos que desapareceram com alarme ativo: limpa.
  for (const mmsi of Object.keys(ativos)) {
    if (!vistos.has(mmsi)) notificacoes.push({ mmsi, state: 'normal', method: [], message: 'Alvo perdido' })
  }
  return { ativos: novos, notificacoes }
}

module.exports = { avaliarAlvos, VELHO }
