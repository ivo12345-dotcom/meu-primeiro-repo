'use strict'
// Os avisos da viagem e as precauções de cada alternativa. Só dados: o ecrã (Parte 3b)
// mostra-os e faz soar os avisos 30 min antes (antecedenciaMin).
//
// avisosDaPassagem, a partir dos eventos e da linha do tempo de uma passagem (lib/passagem.js):
//   rizar / largar rizo                      (eventos 'vela')
//   chuva ou visibilidade < 5 km → radar     (linha do tempo, um aviso por episódio)
//   pôr do sol → luzes, arnês, comer         (eventos 'noite')
//   frente / rotação do vento > 45° em 1 h   (eventos 'tempo' e linha do tempo, com vento ≥ 6 nós;
//                                             nenhuma rotação a ±1 h de uma frente)
//   cambar / virar                           (linha do tempo: a proa à vela muda > 40° num minuto;
//                                             as manobras a menos de 2 h umas das outras juntam-se)
//   chegada de noite                         (o último ponto)
//   gasóleo / bateria a caminho da reserva   (a linha do tempo passa a reserva antes do destino)
//   só eu: come e bebe de 3 em 3 h           (desenho geral, "Avisos")
//
// precaucoes: a tabela "Precauções" do desenho geral (2026-09-29), por alternativa.

// A visibilidade abaixo da qual se liga o radar: 5 km (decisão do Ivo n.º 10, auditoria I-17), a
// MESMA nos três sítios — os avisos e as precauções daqui, o evento da linha do tempo
// (lib/passagem.js) e os lembretes a navegar (lib/acompanhamento.js, VIS_LEMBRETE_M).
const VISIBILIDADE_RADAR_M = 5000
// A chuva que conta para o radar e para o "Chuva e visibilidade" do evento (mm/h)
const CHUVA_RADAR_MM_H = 0.5

const { sitio } = require('./costa')

const PADRAO = Object.freeze({
  fuso: 'Europe/Lisbon',
  antecedenciaMin: 30,
  visibilidadeRadar: VISIBILIDADE_RADAR_M, // m
  chuvaRadar: CHUVA_RADAR_MM_H, // mm/h
  rotacaoVento: 45, // graus em 1 h
  frenteRotacaoH: 1, // nenhuma rotação a ±1 h de uma passagem da frente (M-07)
  ventoMinRotacao: 6, // nós
  // viragem/cambadela a bordo: a proa à vela muda > 40° num minuto da linha do tempo simulada (as
  // cambadelas do motor da passagem mudam 50°, popa a 180 ± 25, e as viragens 90°: 40 apanha as duas
  // com margem). É de propósito diferente dos 45° dos lembretes a navegar (lib/acompanhamento.js,
  // VIRAGEM_GRAUS): esses medem o rumo da ROTA num ponto (a geometria, sem os bordos), não a proa do
  // barco a cada minuto (decisão do Ivo n.º 11, auditoria M-18)
  viragemGraus: 40,
  juntarManobrasH: 2,
  reservaGasoleoL: 40,
  reservaBateriaPct: 50,
  comerCadaH: 3,
  rajadaBarra: 20,
  popaTwa: 120
})

const H = 3600000
const MIN = 60000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d }
const virgula = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',')
const rumo3 = (x) => String(Math.round(norm(x)) % 360).padStart(3, '0')

// passagem: { pontos, eventos, resumo }; destino: { nome, conhecido }; tripulacao; gasoleoInicial (L).
// → [{ t (ISO), hora, tipo, texto, antecedenciaMin }] por ordem.
function avisosDaPassagem ({ passagem, destino = null, tripulacao = 'so', opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const hm = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: o.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const { pontos, eventos } = passagem
  const out = []
  const add = (t, tipo, texto) => out.push({ t: new Date(t).toISOString(), hora: hm(t), tipo, texto, antecedenciaMin: o.antecedenciaMin })

  for (const e of eventos) {
    if (e.tipo === 'vela') add(e.t, e.texto.startsWith('Rizar') ? 'rizar' : 'largar-rizo', e.texto)
    else if (e.tipo === 'noite' && /^Pôr do sol|^Partida de noite/.test(e.texto)) add(e.t, 'por-do-sol', `${e.texto.startsWith('Pôr') ? `Pôr do sol às ${hm(e.t)}` : `Partida de noite (${hm(e.t)})`}: luzes de navegação, arnês e linha de vida, come antes de escurecer`)
    else if (e.tipo === 'tempo' && e.texto.startsWith('Passagem da frente')) add(e.t, 'frente', `${e.texto}: prende a retranca, motor pronto`)
  }

  // chuva ou visibilidade (um aviso por episódio)
  let emChuva = false
  for (const p of pontos) {
    const ruim = (p.vis != null && p.vis < o.visibilidadeRadar) || (p.chuva != null && p.chuva >= o.chuvaRadar)
    if (ruim && !emChuva) {
      const partes = []
      if (p.chuva != null && p.chuva >= o.chuvaRadar) partes.push(`chuva (${virgula(p.chuva)} mm/h)`)
      if (p.vis != null && p.vis < o.visibilidadeRadar) partes.push(`visibilidade ${virgula(p.vis / 1000)} km`)
      add(p.t, 'chuva', `${partes.join(' e ').replace(/^./, x => x.toUpperCase())}: radar ligado e luzes`)
    }
    emChuva = ruim
  }

  // rotação do vento > 45° numa hora (fora das frentes já anunciadas, a mais de 3 h umas das outras):
  // nenhuma a ±1 h de uma "Passagem da frente", que já diz "roda para" (M-07; como os lembretes a navegar)
  const frentes = eventos.filter(e => e.tipo === 'tempo' && String(e.texto || '').startsWith('Passagem da frente')).map(e => e.t)
  let ultimaRotacao = -Infinity
  for (let i = 60; i < pontos.length; i++) {
    const a = pontos[i - 60]; const b = pontos[i]
    if (a.twd == null || b.twd == null || a.tws < o.ventoMinRotacao || b.tws < o.ventoMinRotacao) continue
    const r = dif(b.twd, a.twd)
    if (Math.abs(r) > o.rotacaoVento && b.t - ultimaRotacao > 3 * H && !frentes.some(tf => Math.abs(tf - a.t) <= o.frenteRotacaoH * H)) {
      ultimaRotacao = b.t
      add(a.t, 'rotacao', `O vento roda de ${rumo3(a.twd)}° para ${rumo3(b.twd)}° (${Math.round(Math.abs(r))}° em 1 h): prepara a manobra, prende a retranca`)
    }
  }

  // manobras: viragens e cambadelas à vela
  const manobras = []
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]; const b = pontos[i]
    if (a.motor || b.motor) continue
    if (Math.abs(dif(b.proa, a.proa)) > o.viragemGraus) {
      const popa = b.twd != null && Math.abs(dif(b.twd, b.proa)) > 90
      manobras.push({ t: b.t, tipo: popa ? 'cambar' : 'virar' })
    }
  }
  const grupos = []
  for (const m of manobras) {
    const g = grupos.at(-1)
    if (g && g.tipo === m.tipo && m.t - g.fim <= o.juntarManobrasH * H) { g.fim = m.t; g.n++ } else grupos.push({ tipo: m.tipo, ini: m.t, fim: m.t, n: 1 })
  }
  for (const g of grupos) {
    const nome = g.tipo === 'cambar' ? (g.n === 1 ? 'Cambar' : `${g.n} cambadelas`) : (g.n === 1 ? 'Virar de bordo' : `${g.n} viragens`)
    add(g.ini, g.tipo, g.n === 1 ? `${nome}${g.tipo === 'cambar' ? ': retenida na retranca, cambadela controlada' : ''}` : `${nome} entre as ${hm(g.ini)} e as ${hm(g.fim)}${g.tipo === 'cambar' ? ': retenida na retranca' : ''}`)
  }

  // chegada de noite
  const ult = pontos.at(-1)
  if (ult && ult.noite && passagem.resumo?.chegou) {
    const nome = destino?.nome || 'destino'
    // "à Nazaré", "ao destino" (auditoria M-19)
    add(ult.t + MIN, 'chegada-noite', `Chegada de noite ${sitio.a(nome)}${destino && destino.conhecido !== true ? ', um porto que não conheces' : ''}: entrada devagar, luzes e radar, confirma as luzes da barra`)
  }

  // gasóleo e bateria a caminho da reserva
  const pGas = pontos.find(p => p.gasoleo != null && p.gasoleo < o.reservaGasoleoL)
  if (pGas && pGas !== ult) add(pGas.t, 'gasoleo', `O gasóleo passa a reserva (${o.reservaGasoleoL} L) antes do destino: poupa o motor`)
  const pBat = pontos.find(p => p.soc != null && p.soc * 100 < o.reservaBateriaPct)
  if (pBat && pBat !== ult) add(pBat.t, 'bateria', `A bateria passa os ${o.reservaBateriaPct}% antes do destino: desliga o que não precisas ou liga o motor`)

  // só eu: come e bebe de 3 em 3 h
  if (tripulacao === 'so' && pontos.length) {
    for (let t = pontos[0].t + o.comerCadaH * H; t < ult.t; t += o.comerCadaH * H) add(t, 'comer', 'Come e bebe (3 h ao leme)')
  }
  return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
}

// A lista de verificação de uma alternativa (não bloqueia nada).
// → [{ id, texto, sempre: bool, porque? }]
// desistenciaResumo: o resumo dos pontos de desistência (só da 1.ª alternativa, para a qual foram
// calculados); desistenciaDaPrimeira: true nas outras (o texto diz para qual foram calculados).
function precaucoes ({ passagem, tripulacao = 'so', sairAgora = false, desistenciaResumo = null, desistenciaDaPrimeira = false, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const pontos = passagem?.pontos || []
  const eventos = passagem?.eventos || []
  const out = [
    { id: 'vhf', texto: 'VHF ligado no canal 16', sempre: true },
    { id: 'telemovel', texto: 'Telemóvel carregado', sempre: true },
    { id: 'plano', texto: 'Plano deixado a alguém em terra', sempre: true },
    { id: 'barra', texto: 'Estado da barra (Capitania)', sempre: true }
  ]
  const temNoite = pontos.some(p => p.noite)
  if (temNoite || tripulacao === 'so') out.push({ id: 'arnes', texto: 'Arnês e linha de vida montada', sempre: false, porque: temNoite && tripulacao === 'so' ? 'de noite e sozinho' : temNoite ? 'de noite' : 'sozinho' })
  if (pontos.some(p => !p.motor && p.twd != null && Math.abs(dif(p.twd, p.proa)) > o.popaTwa)) out.push({ id: 'retenida', texto: 'Retenida na retranca', sempre: false, porque: 'vento de popa (TWA > 120°)' })
  if (pontos.some(p => (p.vis != null && p.vis < o.visibilidadeRadar) || (p.chuva != null && p.chuva >= o.chuvaRadar))) out.push({ id: 'radar', texto: 'Radar ligado e luzes', sempre: false, porque: 'chuva ou pouca visibilidade' })
  // "antes da barra": até ao barco chegar à linha de costa (o primeiro ponto 'Linha de …'), ou a 1.ª hora
  let iBarra = pontos.findIndex(p => typeof p.wp === 'string' && p.wp.startsWith('Linha de'))
  if (iBarra < 0) iBarra = Math.min(pontos.length, 60)
  const antesDaBarra = pontos.slice(0, iBarra + 1)
  const rajadaSaida = antesDaBarra.reduce((m, p) => (Number.isFinite(p.rajada) ? Math.max(m, p.rajada) : m), 0)
  if (rajadaSaida > o.rajadaBarra) out.push({ id: 'rizo-saida', texto: 'Rizo feito à saída', sempre: false, porque: `rajadas de ${Math.round(rajadaSaida)} nós antes da barra` })
  // a rajada sem previsão antes da barra é desconhecida, nunca calma (M-06): a precaução fica
  else if (antesDaBarra.some(p => !Number.isFinite(p.rajada))) out.push({ id: 'rizo-saida', texto: 'Rizo feito à saída', sempre: false, porque: 'sem previsão de rajadas antes da barra' })
  const frente = eventos.some(e => e.tipo === 'tempo' && e.texto.startsWith('Passagem da frente'))
  let cai = false
  for (let i = 60; i < pontos.length && !cai; i++) if (pontos[i - 60].tws > 12 && pontos[i].tws < 0.6 * pontos[i - 60].tws) cai = true
  let roda = false
  for (let i = 60; i < pontos.length && !roda; i++) {
    const a = pontos[i - 60]; const b = pontos[i]
    if (a.twd != null && b.twd != null && a.tws >= o.ventoMinRotacao && b.tws >= o.ventoMinRotacao && Math.abs(dif(b.twd, a.twd)) > o.rotacaoVento) roda = true
  }
  if (frente || cai || roda) out.push({ id: 'retranca-motor', texto: 'Prender a retranca, motor pronto', sempre: false, porque: frente ? 'passagem da frente' : roda ? 'o vento roda mais de 45°' : 'o vento cai' })
  if (sairAgora) {
    // "Sair agora mesmo assim": as precauções do nível acima + os pontos de desistência
    if (!out.some(x => x.id === 'arnes')) out.push({ id: 'arnes', texto: 'Arnês e linha de vida montada', sempre: false, porque: 'sair contra a recomendação' })
    if (!out.some(x => x.id === 'rizo-saida')) out.push({ id: 'rizo-saida', texto: 'Rizo feito à saída', sempre: false, porque: 'sair contra a recomendação' })
    if (!out.some(x => x.id === 'retranca-motor')) out.push({ id: 'retranca-motor', texto: 'Prender a retranca, motor pronto', sempre: false, porque: 'sair contra a recomendação' })
    const desist = desistenciaResumo ? `: ${desistenciaResumo}` : desistenciaDaPrimeira ? ' (calculados para a 1.ª alternativa)' : ''
    out.push({ id: 'desistencia', texto: `Pontos de desistência revistos${desist}`, sempre: false, porque: 'sair contra a recomendação' })
    out.push({ id: 'plano-hora', texto: 'Plano com a hora de chegada e de alarme deixado em terra', sempre: false, porque: 'sair contra a recomendação' })
  }
  return out
}

module.exports = { PADRAO, VISIBILIDADE_RADAR_M, CHUVA_RADAR_MM_H, avisosDaPassagem, precaucoes }
