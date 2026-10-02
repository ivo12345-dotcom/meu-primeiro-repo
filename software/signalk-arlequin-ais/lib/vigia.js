'use strict'
// Vigia AIS: para cada alvo decide se há alarme de colisão. Lógica pura; o
// cálculo de CPA/TCPA vem de arlequin-ecra/public/lib/cpa.js (injetado), para
// o ecrã e o servidor darem exatamente o mesmo resultado.
//
// Além do CPA/TCPA (auditoria K-01 e I-09, decisão n.º 3):
//   - sem a velocidade de um dos barcos (sem SOG nem COG, ou SOG sem COG), o alarme sai pela
//     distância: a menos de 0,5 MN e a aproximar-se (a distância desceu 50 m nos últimos 3 min e não
//     voltou a subir 25 m) — a memória das distâncias fica aqui, de avaliação em avaliação;
//   - amarrado ou fundeado (o nosso SOG abaixo de 0,5 nó durante 5 min; só deixa de estar com 1 min
//     seguido a andar, para rodar à âncora ou um salto do GPS não contarem), os alvos também parados
//     (SOG abaixo de 0,5 nó) não dão alarme. Um alvo que se mexe dá sempre alarme.

const VELHO = 10 * 60 * 1000 // alvo sem posição há mais de 10 min = desapareceu
const LIMPA_CPA = 0.6 * 1852 // histerese: só limpa acima de 0,6 MN
const PARADO_PADRAO = 0.5 * 1852 / 3600 // m/s (0,5 nó), se o cálculo não trouxer o seu
const AMARRADO = 5 * 60 * 1000 // tanto tempo abaixo de 0,5 nó = amarrado ou fundeado
const LARGOU = 60 * 1000 // tanto tempo seguido a andar = largou
const JANELA_APROX = 3 * 60 * 1000 // a memória das distâncias de cada alvo
const APROX_M = 50 // a aproximar-se: desceu pelo menos isto na janela …
const VOLTA_M = 25 // … e não voltou a subir isto desde o mais perto (já passou)

const nm = (m) => (m / 1852).toFixed(1).replace('.', ',')
const SEM_RUMO = { alvo: 'alvo sem rumo', eu: 'sem o nosso rumo', ambos: 'sem rumo de nenhum dos dois' }

// Sem o tempo que falta: a mensagem fica parada, o TCPA vivo está no ecrã.
function mensagem (a, r) {
  if (r.semVelocidade) return `${a.nome || a.mmsi} a ${nm(r.distancia)} MN e a aproximar-se · ${SEM_RUMO[r.semVelocidade]}`
  return `${a.nome || a.mmsi} em rota de colisão · CPA ${nm(r.cpa)} MN`
}

function novaMemoria () {
  return { amarrado: false, paradoDesde: null, andarDesde: null, distancias: {} }
}

// O nosso barco amarrado/fundeado? Entra com 5 min parado, sai com 1 min seguido a andar.
function amarracao (m, eu, agora, parado) {
  const quieto = typeof eu.sog === 'number' && eu.sog < parado
  const paradoDesde = quieto ? (m.paradoDesde ?? agora) : null
  const andarDesde = quieto ? null : (m.andarDesde ?? agora)
  const amarrado = m.amarrado
    ? !(andarDesde !== null && agora - andarDesde >= LARGOU)
    : paradoDesde !== null && agora - paradoDesde >= AMARRADO
  return { amarrado, paradoDesde, andarDesde }
}

// hist: [{ t, d }] da janela, já com a distância de agora (d).
function aproximaSe (hist, d) {
  if (hist.length < 2) return false
  let max = -Infinity
  let min = Infinity
  for (const h of hist) { if (h.d > max) max = h.d; if (h.d < min) min = h.d }
  return max - d >= APROX_M && d - min < VOLTA_M
}

// eu: { position, cog, sog }; alvos: [{ mmsi, nome, position, cog, sog, em }]
// ativos: { mmsi: true }; memoria: a que a avaliação anterior devolveu (ou nada, na primeira).
// Devolve { ativos, notificacoes: [{ mmsi, state, method, message, apito? }], memoria }
function avaliarAlvos (ativos, eu, alvos, agora, calc, memoria = novaMemoria()) {
  const { cpa, classificar } = calc
  const parado = calc.PARADO ?? PARADO_PADRAO
  const m = { ...amarracao({ ...novaMemoria(), ...memoria }, eu, agora, parado), distancias: {} }
  const antes = memoria.distancias || {}
  const novos = {}
  const notificacoes = []
  const vistos = new Set()

  for (const a of alvos) {
    if (!a.em || agora - a.em > VELHO) continue
    vistos.add(a.mmsi)
    const r = cpa(eu, a)
    const hist = r ? [...(antes[a.mmsi] || []).filter(h => h.t > agora - JANELA_APROX), { t: agora, d: r.distancia }] : []
    m.distancias[a.mmsi] = hist
    const aprox = r ? aproximaSe(hist, r.distancia) : false
    const classe = classificar(r, undefined, { aproxima: aprox })
    const estava = !!ativos[a.mmsi]
    let perigo = classe === 'perigo'
    if (!perigo && estava && r) {
      perigo = r.semVelocidade
        ? aprox && r.distancia < LIMPA_CPA
        : r.tcpa >= 0 && Number.isFinite(r.tcpa) && r.cpa < LIMPA_CPA
    }
    // Amarrado ou fundeado: um alvo também parado nunca é colisão (decisão n.º 3).
    if (perigo && m.amarrado && typeof a.sog === 'number' && a.sog < parado) perigo = false
    if (perigo) {
      novos[a.mmsi] = true
      // colisão = perigo imediato: apito contínuo (decisão n.º 2, contrato C1)
      if (!estava) notificacoes.push({ mmsi: a.mmsi, state: 'alarm', method: ['visual', 'sound'], apito: 'continuo', message: mensagem(a, r) })
    } else if (estava) {
      notificacoes.push({ mmsi: a.mmsi, state: 'normal', method: [], message: 'Normal' })
    }
  }
  // Alvos que desapareceram com alarme ativo: limpa.
  for (const mmsi of Object.keys(ativos)) {
    if (!vistos.has(mmsi)) notificacoes.push({ mmsi, state: 'normal', method: [], message: 'Alvo perdido' })
  }
  return { ativos: novos, notificacoes, memoria: m }
}

module.exports = { avaliarAlvos, novaMemoria, VELHO }
