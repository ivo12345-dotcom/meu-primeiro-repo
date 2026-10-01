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
// Hora de alarme = a chegada mais tarde (chegada.p90) + 2 h.
// "Até … ainda volta a X": o último ponto de desistência em que voltar à partida tem vento a favor ou
// de través e sem aviso vermelho. Os pontos de desistência só se calculam para a 1.ª alternativa:
// nas outras, a frase fica de fora. Nunca escreve null, NaN nem undefined: o que falta fica de fora
// ou como "—".

const { gpxRota } = require('./gpx')

const H = 3600000
const FUSO = 'Europe/Lisbon'
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const EMERGENCIA_PADRAO = '+351 214 401 919 (MRCC Lisboa, 24 h) ou 112'
const SEM = '—'

function partes (t, fuso) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]))
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { ano: p.year, mes: p.month, dia: p.day, hm: `${p.hour}:${p.minute}`, semana: DIAS[dia], data: `${p.year}-${p.month}-${p.day}` }
}
const valido = (t) => typeof t === 'number' && Number.isFinite(t)
const ms = (x) => (typeof x === 'string' ? Date.parse(x) : x)

// "21:05" (hoje) ou "qua 30/09 09:30"; "—" sem hora.
function horaLisboa (t, agora, fuso = FUSO) {
  t = ms(t)
  if (!valido(t)) return SEM
  const a = partes(t, fuso)
  if (valido(agora) && partes(agora, fuso).data === a.data) return a.hm
  return `${a.semana} ${a.dia}/${a.mes} ${a.hm}`
}
// "até às 17:09" (hoje) ou "até qua 30/09 às 17:09".
function ateAs (t, agora, fuso = FUSO) {
  const a = partes(t, fuso)
  return partes(agora, fuso).data === a.data ? `até às ${a.hm}` : `até ${a.semana} ${a.dia}/${a.mes} às ${a.hm}`
}

function horaAlarme (alt) {
  const p90 = Date.parse(alt?.chegada?.p90)
  return Number.isFinite(p90) ? p90 + 2 * H : null
}

const virgula4 = (x) => Math.abs(x).toFixed(4).replace('.', ',')
const posicaoTexto = (p) => (Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? `${virgula4(p.lat)} ${p.lat >= 0 ? 'N' : 'S'} ${virgula4(p.lon)} ${p.lon >= 0 ? 'E' : 'W'}` : null)
const texto = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null)

// "a 5 MN da costa, via Canal da Berlenga, só motor" · "direta (salto curto), vela e motor"
function rotaTexto (alt) {
  const partes = []
  if (alt.direto) partes.push('direta (salto curto)')
  else if (Number.isFinite(alt.afastamento)) partes.push(`a ${String(alt.afastamento).replace('.', ',')} MN da costa`)
  if (alt.canal) partes.push(`via ${alt.canal}`)
  if (alt.propulsao === 'motor') partes.push('só motor')
  else if (alt.propulsao === 'vela') partes.push('vela e motor')
  return partes.join(', ') || SEM
}

// O último ponto de desistência com volta à partida limpa e com vento a favor ou de través.
function ultimaVolta (desistencia) {
  const bons = (desistencia || []).filter(p => p.voltar && !p.voltar.avisoVermelho && (p.voltar.vento === 'a favor' || p.voltar.vento === 'de través') && Number.isFinite(Date.parse(p.t)) && texto(p.voltar.nome))
  return bons.at(-1) || null
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

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
    linhas.push(`${frase[0].toUpperCase()}${frase.slice(1)} ainda volta a ${texto(volta.voltar.nome)}.`)
  }

  const ivo = texto(telefones.ivo)
  const emergencia = texto(telefones.emergencia) || EMERGENCIA_PADRAO
  const ligarEmergencia = emergencia === EMERGENCIA_PADRAO ? 'liga ao MRCC Lisboa +351 214 401 919 (ou 112)' : `liga para ${emergencia}`
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
  const nomeFicheiro = `${[slug(nomeBarco) || 'arlequin', slug(texto(r.partida?.nome) && !origemMar ? r.partida.nome : 'posicao'), slug(destino) || 'destino'].join('-')}${p ? `-${p.ano}${p.mes}${p.dia}-${p.hm.replace(':', '')}` : ''}.gpx`
  return { texto: linhas.join('\n'), gpx, nomeFicheiro }
}

module.exports = { EMERGENCIA_PADRAO, horaLisboa, horaAlarme, rotaTexto, montarPlano }
