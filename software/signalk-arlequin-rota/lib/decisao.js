'use strict'
// A decisão (desenho 3a, "Decisão"): o custo de cada alternativa no cenário provável, as
// horas de partida, as 3 melhores e o veredicto com 1–2 frases de porquê.
//
// Custo = horas + 0,25 × horas de espera + 1,5 × horas de noite + 1,0 × horas ao leme (só eu)
//       + 0,5 × (rajada máxima − 20)⁺ + 2 × (onda máxima − 2)⁺ + 0,5 × horas contra o vento
//   - horas ao leme: as equivalentes (o motor em calma conta metade; a calma está definida em
//     lib/seguranca.js, emCalma), só com "so";
//   - horas contra o vento: minutos com vento de 7 nós ou mais a ≤ 50° da proa (bolina, bordos,
//     ou motor contra o vento e o mar). Interpretação nossa: o desenho não a define.
//
// Partidas: agora, +3 h, +6 h e de 3 em 3 h até +48 h (a "melhor janela" é a melhor destas).
// As de +3 h em diante arredondam-se à meia hora. As passagens que acabem depois do fim da
// previsão ficam de fora (quem chama; em "Sair agora" ficam, com aviso vermelho). Com "Sair
// agora mesmo assim", só agora.
//
// As 3 melhores: entre as não excluídas, as recomendadas primeiro e depois por custo (com
// "so" ou "acompanhado", uma "não recomendada" nunca passa à frente de uma recomendada). Em "Sair agora" é
// só pelo custo, com as não recomendadas incluídas. Sem repetidas: uma "vela e motor" com menos de
// 0,1 h de vela (provável) e uma "só motor" também sem vela, com a mesma partida e a mesma geometria
// (afastamento, canal, direta), são a mesma passagem: fica a "só motor" e a vaga passa à seguinte.
//
// Veredicto:
//   segue           a melhor recomendada parte agora;
//   espera          a melhor recomendada parte mais tarde ("Espera até às HH:MM");
//   nao-recomendado nenhuma alternativa passa (com "so": "Não recomendado sozinho"; com
//                   "acompanhado": "Não recomendado", acima de 28/35/4 — lib/seguranca.js);
//   volta           só pedido no mar (a mais de 0,5 MN de um porto): continuar agora não é
//                   recomendado e ir para o abrigo mais perto é ("Volta ou abriga-te em X").

const H = 3600000
const MEIA_HORA = 1800000

const PESOS = Object.freeze({ espera: 0.25, noite: 1.5, leme: 1.0, rajada: 0.5, rajadaBase: 20, ondas: 2, ondasBase: 2, contraVento: 0.5 })
const CONTRA = Object.freeze({ angulo: 50, ventoMin: 7 })

const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d }
const virgula = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',')

function horasContraVento (pontos, o = CONTRA) {
  let n = 0
  for (const p of pontos) if (p.tws >= o.ventoMin && p.twd != null && Math.abs(dif(p.twd, p.proa)) <= o.angulo) n++
  return n / 60
}

// resumo: o do cenário provável; lemeEq: horas equivalentes ao leme (provável); contraVentoH.
function custo ({ resumo, esperaH = 0, tripulacao, lemeEq = 0, contraVentoH = 0 }) {
  const partes = {
    horas: resumo.duracaoH,
    espera: PESOS.espera * esperaH,
    noite: PESOS.noite * resumo.horasNoite,
    leme: tripulacao === 'so' ? PESOS.leme * lemeEq : 0,
    rajada: PESOS.rajada * Math.max(0, resumo.rajadaMax - PESOS.rajadaBase),
    ondas: PESOS.ondas * Math.max(0, (Number.isFinite(resumo.ondasMax) ? resumo.ondasMax : 0) - PESOS.ondasBase),
    contraVento: PESOS.contraVento * contraVentoH
  }
  const total = Object.values(partes).reduce((a, b) => a + b, 0)
  return { total, partes }
}

// As horas de partida (ms). fim: o fim da previsão (as partidas depois dele não servem).
function partidas (agora, { sairAgora = false, horas = 48, passoH = 3, fim = Infinity } = {}) {
  const out = [agora]
  if (sairAgora) return out
  for (let k = passoH; k <= horas; k += passoH) {
    const t = Math.round((agora + k * H) / MEIA_HORA) * MEIA_HORA
    if (t < fim) out.push(t)
  }
  return out
}

// "às 18:30", "amanhã às 08:00", "dia 2 às 08:00" (hora de Lisboa).
function quando (t, agora, fuso = 'Europe/Lisbon') {
  const dia = new Intl.DateTimeFormat('pt-PT', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' })
  const hm = new Intl.DateTimeFormat('pt-PT', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const d0 = dia.format(agora); const d1 = dia.format(t); const amanha = dia.format(agora + 24 * H)
  if (d1 === d0) return `às ${hm}`
  if (d1 === amanha) return `amanhã às ${hm}`
  const n = new Intl.DateTimeFormat('pt-PT', { timeZone: fuso, day: 'numeric' }).format(t)
  return `dia ${n} às ${hm}`
}
const hora = (t, fuso = 'Europe/Lisbon') => new Intl.DateTimeFormat('pt-PT', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)

// naoRecomendada já é a da tripulação (lib/seguranca.js): "sozinho" com "so", os limites de
// acompanhado (28/35/4) com "acompanhado" (decisão do Ivo de 01/10). O argumento fica por compatibilidade.
const recomendada = (c, _tripulacao) => !c.excluida && !c.naoRecomendada

// Menos de 0,1 h de vela no cenário provável (sem número: não se sabe, conta como com vela).
const LIMIAR_VELA_H = 0.1
const semVela = (c) => Number.isFinite(c.resumos?.provavel?.horasVela) && c.resumos.provavel.horasVela < LIMIAR_VELA_H
const mesmaPassagem = (c) => `${c.partida}|${c.direto ? 'direta' : c.afastamento}|${c.canal || ''}`

// Ordena e escolhe as 3 melhores. Decisão (controlador, revisão da Task 10): os "3 melhores por custo, entre as não excluídas" do desenho, com as recomendadas à frente das não recomendadas.
function melhores (candidatos, { tripulacao, sairAgora = false, n = 3 } = {}) {
  const naoExcluidas = candidatos.filter(c => !c.excluida)
  // a "vela e motor" que vai toda a motor, quando há a "só motor" da mesma passagem também sem vela
  const soMotor = new Set(naoExcluidas.filter(c => c.propulsao === 'motor' && semVela(c)).map(mesmaPassagem))
  const ok = naoExcluidas.filter(c => !(c.propulsao !== 'motor' && semVela(c) && soMotor.has(mesmaPassagem(c))))
  const chave = (c) => (sairAgora ? 0 : (recomendada(c, tripulacao) ? 0 : 1))
  return ok.sort((a, b) => chave(a) - chave(b) || a.custo.total - b.custo.total || a.partida - b.partida).slice(0, n)
}

// Frase curta de uma alternativa: "chegas às 06:10 (de noite), vento até 18 nós, ondas até 2,7 m".
function frase (c, agora, fuso) {
  const r = c.resumos.provavel
  // chegadaNoite: de noite em qualquer cenário (lib/seguranca.js); a hora é a do provável, que pode chegar de dia
  const noite = c.chegadaNoite ? (c.chegadaNoiteProvavel === false ? ' (pode ser de noite)' : ' (de noite)') : ' (de dia)'
  const partes = [`chegas ${quando(Date.parse(r.chegada), agora, fuso)}${noite}`, `vento até ${Math.round(r.ventoMax)} nós`]
  if (Number.isFinite(r.ondasMax)) partes.push(`ondas até ${virgula(r.ondasMax)} m`)
  return partes.join(', ')
}
// A rota direta (salto curto, lib/rotas.js) não tem afastamento (null): "direta", nunca "a null MN".
const nomeRota = (c) => `${c.direto || !Number.isFinite(c.afastamento) ? 'direta' : `a ${c.afastamento} MN`}${c.canal ? ` pelo ${c.canal}` : ''}${c.propulsao === 'motor' ? ' a motor' : ''}`
const juntar = (motivos, n = 2) => motivos.slice(0, n).join(' e ')

// candidatos: [{ partida (ms), esperaH, afastamento, propulsao, excluida, naoRecomendada, motivos[],
//   custo: { total }, resumos: { provavel }, chegadaNoite }]
// abrigo (só no mar): { destino, candidato } — o abrigo mais perto, avaliado para partir agora.
// → { top: [candidato], veredicto: { tipo, texto, porque[] } }
function decidir ({ candidatos, agora, tripulacao, sairAgora = false, emMar = false, abrigo = null, fuso = 'Europe/Lisbon', excluidasAgora = [] }) {
  const top = melhores([...candidatos], { tripulacao, sairAgora })
  const sozinho = tripulacao === 'so'
  const agoraCands = candidatos.filter(c => c.partida === agora)
  const melhorAgora = [...agoraCands].sort((a, b) => a.custo.total - b.custo.total)[0] || null
  const recomendadas = candidatos.filter(c => recomendada(c, tripulacao))
  const melhorRec = melhores(recomendadas, { tripulacao })[0] || null
  const porqueAgora = () => {
    if (!melhorAgora) return excluidasAgora.length ? `Agora: ${juntar([...new Set(excluidasAgora)])}.` : 'Agora não há alternativa possível.'
    const nrAgora = agoraCands.filter(c => !c.excluida)
    if (!nrAgora.length) return `Agora: ${juntar(melhorAgora.motivos)}.`
    const melhorNr = nrAgora.sort((a, b) => a.custo.total - b.custo.total)[0]
    return `Agora: ${juntar(melhorNr.motivos)}.`
  }

  let veredicto
  if (melhorRec && melhorRec.partida === agora) {
    veredicto = { tipo: 'segue', texto: 'Segue', porque: [`Parte agora pela rota ${nomeRota(melhorRec)}: ${frase(melhorRec, agora, fuso)}.`] }
  } else if (emMar && !sairAgora && abrigo && abrigo.candidato && recomendada(abrigo.candidato, tripulacao)) {
    const a = abrigo.candidato
    veredicto = {
      tipo: 'volta',
      texto: `Volta ou abriga-te em ${abrigo.destino.nome}`,
      porque: [porqueAgora(), `Até ${abrigo.destino.nome} são ${virgula(a.milhas)} MN: ${frase(a, agora, fuso)}.`]
    }
  } else if (melhorRec) {
    const quandoTxt = quando(melhorRec.partida, agora, fuso)
    const porque = []
    const agoraOk = agoraCands.find(c => recomendada(c, tripulacao))
    if (agoraOk) porque.push(`Partir agora também dá, mas custa mais: ${frase(agoraOk, agora, fuso)}.`)
    else porque.push(porqueAgora())
    porque.push(`Partindo ${quandoTxt}, pela rota ${nomeRota(melhorRec)}: ${frase(melhorRec, agora, fuso)}.`)
    veredicto = { tipo: 'espera', texto: `Espera até ${quandoTxt}`, porque }
  } else {
    const melhor = top[0]
    const porque = []
    if (melhor) porque.push(`${sairAgora ? 'A melhor para sair agora' : 'Nenhuma partida nas próximas 48 h passa nos limites; a melhor'} (${nomeRota(melhor)}, ${melhor.partida === agora ? 'agora' : quando(melhor.partida, agora, fuso)}): ${juntar(melhor.motivos)}.`)
    else porque.push(porqueAgora())
    if (sairAgora && melhor) porque.push('Se saíres mesmo assim, revê as precauções e os pontos de desistência.')
    else if (melhor && melhor.partida !== agora) porque.push(porqueAgora())
    veredicto = { tipo: 'nao-recomendado', texto: sozinho ? 'Não recomendado sozinho' : 'Não recomendado', porque: porque.slice(0, 2) }
  }
  veredicto.porque = veredicto.porque.slice(0, 2)
  return { top, veredicto }
}

module.exports = { PESOS, CONTRA, horasContraVento, custo, partidas, quando, hora, melhores, recomendada, decidir }
