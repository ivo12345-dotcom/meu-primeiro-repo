'use strict'
// O plano de navegação para deixar em terra (desenho 3b-1, "Plano pelo Telegram"): o texto, com a
// hora de alarme, e o GPX da alternativa escolhida.
//
// montarPlano({ resultado, indice, barco, telefones, agora, fuso }) → { texto, gpx, nomeFicheiro }
//   resultado: o do lib/calculo.js; indice: a alternativa (0–2); barco: { nome, modelo, corCasco,
//   mmsi, indicativo } e telefones: { ivo, emergencia } da configuração do plugin (os campos vazios
//   ficam de fora); agora (ms): a hora do envio ("hoje" para as horas).
//
// Horas de Lisboa: "HH:MM" hoje, "qua 30/09 HH:MM" nos outros dias (quem lê o plano pode lê-lo no
// dia seguinte: o dia escreve-se sempre que não é o do envio, e o envio leva a data).
// Na noite em que acaba a hora de verão, a hora das 01:00 às 02:00 acontece duas vezes: as horas
// dessa hora levam " (hora de verão)" ou " (hora de inverno)".
// Hora de alarme = a chegada mais tarde (chegada.p90) + 2 h. Sem p90 não há hora de alarme: o plano
// não se monta (erro com status 422 e o motivo SEM_ALARME).
// "Até … ainda volta a X": o último ponto de desistência em que voltar à partida tem vento a favor ou
// de través e sem aviso vermelho, com as exceções: os pontos antes dele em que a volta é uma fuga
// junto à costa (com o aviso vermelho) ou não há fuga, em texto simples ("exceto junto ao Cabo Raso
// às 19:16 (fuga junto à costa com vento do mar)"), tirados dos pontos e não do texto do resumo (os
// diagnósticos do gerador de rotas não vão para os contactos em terra). Os pontos
// de desistência só se calculam para a 1.ª alternativa: nas outras, a frase fica de fora. Nunca
// escreve null, NaN nem undefined: o que falta fica de fora ou como "—".

const { gpxRota } = require('./gpx')
const { slug } = require('./slug')

const H = 3600000
const MIN = 60000
const FUSO = 'Europe/Lisbon'
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// o número do MRCC Lisboa (24 h): o único sítio onde está escrito
const MRCC = '+351 214 401 919'
const EMERGENCIA_PADRAO = `${MRCC} (MRCC Lisboa, 24 h) ou 112`
const SEM_ALARME = 'sem hora de chegada mais tarde: não há hora de alarme, o plano não foi enviado'
const SEM = '—'

function partes (t, fuso) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]))
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  // o desvio da hora local para o UTC (min)
  const desvio = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / MIN) * MIN) / MIN)
  return { ano: p.year, mes: p.month, dia: p.day, hm: `${p.hour}:${p.minute}`, semana: DIAS[dia], data: `${p.year}-${p.month}-${p.day}`, desvio }
}
const valido = (t) => typeof t === 'number' && Number.isFinite(t)
const ms = (x) => (typeof x === 'string' ? Date.parse(x) : x)

// " (hora de verão)" / " (hora de inverno)" se a hora local de t também acontece noutro instante (a
// hora repetida no fim da hora de verão); '' nas outras.
function horaRepetida (t, fuso) {
  const d = partes(t, fuso).desvio
  for (const t3 of [t - 3 * H, t + 3 * H]) {
    const d2 = partes(t3, fuso).desvio
    if (d2 !== d && partes(t + (d - d2) * MIN, fuso).desvio === d2) return d > d2 ? ' (hora de verão)' : ' (hora de inverno)'
  }
  return ''
}

// "21:05" (hoje) ou "qua 30/09 09:30"; "—" sem hora.
function horaLisboa (t, agora, fuso = FUSO) {
  t = ms(t)
  if (!valido(t)) return SEM
  const a = partes(t, fuso)
  const hm = `${a.hm}${horaRepetida(t, fuso)}`
  if (valido(agora) && partes(agora, fuso).data === a.data) return hm
  return `${a.semana} ${a.dia}/${a.mes} ${hm}`
}
// "às 17:09" (hoje) ou "qua 30/09 às 17:09".
function asHoras (t, agora, fuso = FUSO) {
  const a = partes(t, fuso)
  const hm = `${a.hm}${horaRepetida(t, fuso)}`
  return partes(agora, fuso).data === a.data ? `às ${hm}` : `${a.semana} ${a.dia}/${a.mes} às ${hm}`
}
// "até às 17:09" (hoje) ou "até qua 30/09 às 17:09".
const ateAs = (t, agora, fuso = FUSO) => `até ${asHoras(t, agora, fuso)}`

function horaAlarme (alt) {
  const p90 = Date.parse(alt?.chegada?.p90)
  return Number.isFinite(p90) ? p90 + 2 * H : null
}

const virgula4 = (x) => Math.abs(x).toFixed(4).replace('.', ',')
const posicaoTexto = (p) => (Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? `${virgula4(p.lat)} ${p.lat >= 0 ? 'N' : 'S'} ${virgula4(p.lon)} ${p.lon >= 0 ? 'E' : 'W'}` : null)
const texto = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null)

// Uma "vela e motor" com menos de 0,1 h de vela (horas.vela, o cenário provável) vai toda a motor.
const semVela = (alt) => Number.isFinite(alt.horas?.vela) && alt.horas.vela < 0.1

// "a 5 MN da costa, via Canal da Berlenga, só motor" · "direta (salto curto), vela e motor" ·
// "a 5 MN da costa, a motor (sem vento para vela)"
function rotaTexto (alt) {
  const partes = []
  if (alt.direto) partes.push('direta (salto curto)')
  else if (Number.isFinite(alt.afastamento)) partes.push(`a ${String(alt.afastamento).replace('.', ',')} MN da costa`)
  if (alt.canal) partes.push(`via ${alt.canal}`)
  if (alt.propulsao === 'motor') partes.push('só motor')
  else if (alt.propulsao === 'vela') partes.push(semVela(alt) ? 'a motor (sem vento para vela)' : 'vela e motor')
  return partes.join(', ') || SEM
}

// O último ponto de desistência com volta à partida limpa e com vento a favor ou de través.
function ultimaVolta (desistencia) {
  const bons = (desistencia || []).filter(p => p.voltar && !p.voltar.avisoVermelho && (p.voltar.vento === 'a favor' || p.voltar.vento === 'de través') && Number.isFinite(Date.parse(p.t)) && texto(p.voltar.nome))
  return bons.at(-1) || null
}

// As exceções da frase "até … ainda volta": os pontos antes de volta em que voltar não é uma fuga
// limpa. Só o sítio, a hora e o porquê em texto simples. '' sem exceções.
const AVISO_SEM_VENTO = /^fuga junto à costa sem vento previsto/
function excecoes (desistencia, volta, agora, fuso) {
  const antes = (desistencia || []).slice(0, desistencia.indexOf(volta))
  const lista = antes.filter(p => !p.voltar || p.voltar.avisoVermelho).flatMap(p => {
    const t = Date.parse(p.t)
    if (!Number.isFinite(t)) return []
    const nome = p.tipo === 'cabo' && texto(p.nome)
    const onde = nome ? `junto ${/^(Ponta|Nazaré)/.test(nome) ? 'à' : 'ao'} ${nome} ${asHoras(t, agora, fuso)}` : asHoras(t, agora, fuso)
    const porque = !p.voltar ? 'sem fuga possível' : AVISO_SEM_VENTO.test(p.voltar.avisoVermelho) ? 'fuga junto à costa sem vento previsto' : 'fuga junto à costa com vento do mar'
    return [`${onde} (${porque})`]
  })
  if (!lista.length) return ''
  return `, exceto ${lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista.at(-1)}` : lista[0]}`
}

function montarPlano ({ resultado, indice = 0, barco = {}, telefones = {}, agora = Date.now(), fuso = FUSO }) {
  const r = resultado || {}
  const alt = r.alternativas?.[indice]
  if (!alt) throw new Error('alternativa desconhecida')
  const hl = (t) => horaLisboa(t, agora, fuso)
  const nomeBarco = texto(barco.nome) || 'ARLEQUIN'
  const ficha = [nomeBarco, texto(barco.modelo), texto(barco.corCasco) && `casco ${texto(barco.corCasco)}`, texto(barco.mmsi) && `MMSI ${texto(barco.mmsi)}`, texto(barco.indicativo) && `indicativo ${texto(barco.indicativo)}`].filter(Boolean)
  const origemMar = r.partida?.emMar ? posicaoTexto(r.partida) : null
  const origem = origemMar || texto(r.partida?.nome)
  const destino = texto(r.destino?.nome)
  const partida = Date.parse(alt.partida)
  const alarme = horaAlarme(alt)
  // a hora de alarme é o centro do plano: sem ela, não vai
  if (alarme == null) throw Object.assign(new Error(SEM_ALARME), { status: 422 })
  const de = origemMar ? `da posição ${origemMar}` : origem ? `de ${origem}` : null

  const linhas = [
    `PLANO DE NAVEGAÇÃO · ${nomeBarco}`,
    `Enviado ${horaLisboa(agora, NaN, fuso)} (horas de Lisboa)`,
    '',
    `Barco: ${ficha.join(', ')}`,
    `Partida: ${hl(partida)}${de ? ` ${de}` : ''}`,
    `Destino: ${destino || SEM}`,
    `Rota: ${rotaTexto(alt)}`,
    `Chegada provável: ${hl(alt.chegada?.p50)} (o mais tarde: ${hl(alt.chegada?.p90)})`,
    `Tripulação: ${r.tripulacao === 'acompanhado' ? '2 ou mais' : 'só eu'}`
  ]
  // os abrigos pelo caminho (os da desistência, sem a partida e o destino)
  const fora = new Set([texto(r.partida?.nome), destino].filter(Boolean))
  const abrigos = [...new Set((r.desistencia || []).map(p => texto(p.abrigo?.nome)).filter(n => n && !fora.has(n)))]
  if (abrigos.length) linhas.push(`Abrigos pelo caminho: ${abrigos.join(', ')}`)
  const volta = indice === 0 ? ultimaVolta(r.desistencia) : null
  if (volta) {
    const frase = ateAs(Date.parse(volta.t), agora, fuso)
    linhas.push(`${frase[0].toUpperCase()}${frase.slice(1)} ainda volta a ${texto(volta.voltar.nome)}${excecoes(r.desistencia, volta, agora, fuso)}.`)
  }

  const ivo = texto(telefones.ivo)
  const emergencia = texto(telefones.emergencia) || EMERGENCIA_PADRAO
  const ligarEmergencia = emergencia === EMERGENCIA_PADRAO ? `liga ao MRCC Lisboa ${MRCC} (ou 112)` : `liga para ${emergencia}`
  linhas.push(
    '',
    `Hora de alarme: ${hl(alarme)}`,
    `Se não houver notícias até ${hl(alarme)}, liga ao Ivo${ivo ? ` (${ivo})` : ''}. Se não atender, ${ligarEmergencia} e diz: veleiro ${nomeBarco}, de ${origem || SEM} para ${destino || SEM}, saída ${hl(partida)}.`,
    '',
    'A rota vai em anexo (GPX).'
  )

  const titulo = `${nomeBarco}: ${origem || SEM} → ${destino || SEM}`
  const gpx = gpxRota({
    titulo,
    nomeRota: `${titulo} (${rotaTexto(alt)})`,
    descricao: `${ficha.join(', ')}. Partida ${hl(partida)}, chegada provável ${hl(alt.chegada?.p50)} (horas de Lisboa).`,
    autor: nomeBarco,
    pontos: alt.pontosRota || [],
    quando: agora
  })
  const p = valido(partida) ? partes(partida, fuso) : null
  const nomeFicheiro = `${[slug(nomeBarco, 30) || 'arlequin', slug(texto(r.partida?.nome) && !origemMar ? r.partida.nome : 'posicao', 30), slug(destino, 30) || 'destino'].join('-')}${p ? `-${p.ano}${p.mes}${p.dia}-${p.hm.replace(':', '')}` : ''}.gpx`
  return { texto: linhas.join('\n'), gpx, nomeFicheiro }
}

module.exports = { MRCC, EMERGENCIA_PADRAO, SEM_ALARME, horaLisboa, horaAlarme, rotaTexto, montarPlano }
