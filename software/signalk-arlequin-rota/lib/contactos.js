'use strict'
// Os contactos em terra a navegar (desenho 3b-2, "Contactos em terra"): só se o plano foi enviado e há
// contactos entregues; as mensagens seguem só para eles e para o chat do Ivo (o plugin porto).
//
// Mensagens (horas de Lisboa, como na 3b-1: lib/plano.js horaLisboa, com o dia quando não é hoje e o
// sufixo de verão/inverno na hora repetida):
//   chegada    "Cheguei bem a X às HH:MM. Obrigado!" (uma vez)
//   atraso     "Ainda a navegar, tudo bem. Nova chegada prevista ~HH:MM. Nova hora de alarme: HH:MM
//              (em vez de HH:MM)." quando a chegada prevista agora passa da "mais tarde" do plano
//              (chegada.p90); a nova hora de alarme é a chegada prevista + 2 h; depois, no máximo 1×
//              por hora e só se a chegada voltar a escorregar mais de 15 min (decidirAtraso)
//   terminado  "Viagem terminada / mudança de planos: estou bem, em <graus e minutos> às HH:MM."
//   plano      o plano novo (texto + GPX da 3b-1) com a linha "Este plano substitui o anterior."
// A fila (gravada no plano ativo, em plano.contactos): { fila: [msg], enviadas: [msg], seq }
//   msg: { id, tipo, texto, contactos (a quem: os contactos entregues do plano quando entrou), gpx?, nomeFicheiro?, criada, tentativas, proxima, estado: 'fila' | 'a enviar',
//   pedido, erro }; as enviadas guardam a hora a que realmente saíram (enviadaEm) e a quem.
//   Uma de cada vez e por ordem; a que falha (sem resposta em 30 s, sem o porto, ou nenhum contacto em
//   terra a recebeu) volta a tentar daqui a 2 min. Sai da fila o que deixou de interessar: um atraso
//   mais antigo (há outro mais novo, um plano novo, "cheguei bem" ou "terminada"); e nenhum atraso entra
//   depois de "cheguei bem" ou "terminada".
// evento(msg, pedido): o que se emite em 'arlequin:plano' para o porto (aos contactos da mensagem).

const { horaLisboa, asHoras } = require('./plano')

const MIN = 60000
const H = 3600000
const REPETIR_MS = 2 * MIN
const ATRASO_INTERVALO_MS = H
const ATRASO_ESCORREGA_MS = 15 * MIN
const ALARME_DEPOIS_MS = 2 * H
const FECHO = new Set(['chegada', 'terminado'])
const SUBSTITUI = 'Este plano substitui o anterior.'

const iso = (t) => new Date(t).toISOString()
const valido = (t) => typeof t === 'number' && Number.isFinite(t)

// ---------- textos ----------
function grausMinutos (p) {
  const um = (x, pos, neg) => {
    const a = Math.abs(x)
    let g = Math.floor(a)
    let m = Math.round((a - g) * 600) / 10
    if (m >= 60) { g += 1; m = 0 }
    return `${g}°${m.toFixed(1).replace('.', ',')}' ${x >= 0 ? pos : neg}`
  }
  return `${um(p.lat, 'N', 'S')} ${um(p.lon, 'E', 'W')}`
}
const quando = (t, agora) => (valido(t) ? ` ${asHoras(t, agora)}` : '')

const textoChegada = ({ destino, chegou, agora }) => `Cheguei bem a ${destino || 'destino'}${quando(chegou, agora)}. Obrigado!`
const textoAtraso = ({ chegada, alarme, alarmeAntes, agora }) =>
  `Ainda a navegar, tudo bem. Nova chegada prevista ~${horaLisboa(chegada, agora)}. Nova hora de alarme: ${horaLisboa(alarme, agora)} (em vez de ${horaLisboa(alarmeAntes, agora)}).`
function textoTerminado ({ posicao, agora }) {
  const onde = posicao && Number.isFinite(posicao.lat) && Number.isFinite(posicao.lon) ? ` em ${grausMinutos(posicao)}` : ''
  return `Viagem terminada / mudança de planos: estou bem,${onde}${quando(agora, agora)}.`
}
// a linha "Este plano substitui o anterior." logo a seguir à do envio (a 2.ª)
function textoSubstitui (texto) {
  const linhas = String(texto).split('\n')
  linhas.splice(2, 0, SUBSTITUI)
  return linhas.join('\n')
}

// ---------- o atraso ----------
// enviado: o último atraso enviado { ultimoEm, chegada, alarme } (ms) ou null.
function decidirAtraso (enviado, { chegadaAgora, p90, alarmePlano, agora }) {
  if (!valido(chegadaAgora) || !valido(p90) || chegadaAgora <= p90) return null
  const novo = { chegada: chegadaAgora, alarme: chegadaAgora + ALARME_DEPOIS_MS }
  if (!enviado) return { ...novo, alarmeAntes: alarmePlano }
  if (agora - enviado.ultimoEm < ATRASO_INTERVALO_MS) return null
  if (chegadaAgora - enviado.chegada <= ATRASO_ESCORREGA_MS) return null
  return { ...novo, alarmeAntes: enviado.alarme }
}

// ---------- a fila ----------
const novaFila = () => ({ fila: [], enviadas: [], seq: 0 })

function porNaFila (c0, msg, agora) {
  const c = { ...novaFila(), ...c0 }
  const fechado = [...c.enviadas, ...c.fila].some(m => FECHO.has(m.tipo))
  if (msg.tipo === 'atraso' && fechado) return c
  // o que deixou de interessar (só o que ainda não saiu: o que está "a enviar" fica)
  const tira = (m) => m.estado === 'fila' && (m.tipo === 'atraso' || (msg.tipo === 'plano' && m.tipo === 'plano'))
  const seq = c.seq + 1
  const nova = { id: `m${seq}`, tipo: msg.tipo, texto: msg.texto, contactos: [...(msg.contactos || [])], ...(msg.gpx ? { gpx: msg.gpx, nomeFicheiro: msg.nomeFicheiro } : {}), criada: iso(agora), tentativas: 0, proxima: iso(agora), estado: 'fila', pedido: null, erro: null }
  return { ...c, seq, fila: [...c.fila.filter(m => !tira(m)), nova] }
}

// A próxima a enviar: a primeira da fila, se já for a hora dela e nenhuma estiver "a enviar".
function proxima (c, agora) {
  if (!c?.fila?.length || c.fila.some(m => m.estado === 'a enviar')) return null
  const m = c.fila[0]
  return Date.parse(m.proxima) <= agora ? m : null
}

const mudar = (c, f, fn) => ({ ...c, fila: c.fila.map(m => (f(m) ? fn(m) : m)) })
const marcarAEnviar = (c, id, pedido, agora) => mudar(c, m => m.id === id, m => ({ ...m, estado: 'a enviar', pedido, tentativas: m.tentativas + 1, tentadaEm: iso(agora) }))

function falhou (c, pedido, erro, agora) {
  if (!c.fila.some(m => m.pedido === pedido)) return c
  return mudar(c, m => m.pedido === pedido, m => ({ ...m, estado: 'fila', pedido: null, erro, proxima: iso(agora + REPETIR_MS) }))
}

// A resposta do porto ({ entregues, contactos, falhas }): enviada com pelo menos um contacto em terra.
function resposta (c, pedido, r = {}, agora) {
  const m = c.fila.find(x => x.pedido === pedido)
  if (!m) return c
  const contactos = Array.isArray(r.contactos) ? r.contactos.map(String) : []
  const falhas = Array.isArray(r.falhas) ? r.falhas : []
  if (!contactos.length) return falhou(c, pedido, falhas.length ? falhas.map(f => `${f.nome}: ${f.erro}`).join('; ') : 'nenhum contacto em terra a recebeu', agora)
  const { gpx, nomeFicheiro, estado, pedido: _p, proxima: _x, ...resto } = m
  const enviada = { ...resto, enviadaEm: iso(agora), contactos, entregues: Array.isArray(r.entregues) ? r.entregues.map(String) : [], falhas }
  return { ...c, fila: c.fila.filter(x => x !== m), enviadas: [...c.enviadas, enviada] }
}

// Ao arrancar: a que estava "a enviar" já não tem resposta; volta à fila para tentar já.
function aoArrancar (c, agora) {
  if (!c) return novaFila()
  return mudar({ ...novaFila(), ...c }, m => m.estado === 'a enviar', m => ({ ...m, estado: 'fila', pedido: null, proxima: iso(agora) }))
}

function evento (msg, pedido, contactos = msg.contactos || []) {
  return {
    pedido,
    tipo: msg.tipo,
    texto: msg.texto,
    ...(msg.tipo === 'plano' && msg.gpx ? { gpx: msg.gpx, nomeFicheiro: msg.nomeFicheiro } : {}),
    destinatarios: 'contactos-do-plano',
    contactos: [...contactos]
  }
}

module.exports = { SUBSTITUI, REPETIR_MS, grausMinutos, textoChegada, textoAtraso, textoTerminado, textoSubstitui, decidirAtraso, novaFila, porNaFila, proxima, marcarAEnviar, falhou, resposta, aoArrancar, evento }
