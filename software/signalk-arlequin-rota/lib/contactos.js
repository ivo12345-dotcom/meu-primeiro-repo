'use strict'
// Os contactos em terra a navegar (desenho 3b-2, "Contactos em terra"): só se o plano foi enviado e há
// contactos entregues; as mensagens seguem só para eles e para o chat do Ivo (o plugin porto).
//
// Mensagens (horas de Lisboa, como na 3b-1: lib/plano.js horaLisboa, com o dia quando não é hoje e o
// sufixo de verão/inverno na hora repetida):
//   chegada    "Cheguei bem a X qua 30/09 às HH:MM. Obrigado!" (uma vez)
//   atraso     "Ainda a navegar, tudo bem. Nova chegada prevista ~HH:MM. Nova hora de alarme: HH:MM
//              (em vez de HH:MM)." quando a chegada prevista agora passa 30 min ou mais da "mais tarde"
//              do plano (chegada.p90; decisão do Ivo de 01/10); a nova hora de alarme é a chegada
//              prevista + 2 h; depois, no máximo 1× por hora e só se a chegada voltar a escorregar mais
//              de 15 min (decidirAtraso); e só com as guardas da decisão do Ivo de 02/10 (retencaoAtraso); o "em vez
//              de" é a hora de alarme que tinha quem recebe: o parcial para quem falhou diz a dos contactos dele
//              (alarmeDosContactos), não a dos outros que já receberam o atraso (F2b Menor 9)
//   terminado  "Viagem terminada / mudança de planos: estou bem, em <graus e minutos> qua 30/09 às HH:MM."
//   plano      o plano novo (texto + GPX da 3b-1) com a linha "Este plano substitui o anterior."
//   aviso      só ao chat do Ivo (sem contactos): "Pai não recebeu o «cheguei bem» (ref. A5) e já passou a
//              hora de alarme (…): desisti de o entregar. Liga-lhe." (desistir, auditoria I-05)
//   (o "cheguei bem" e a "terminada" levam sempre o dia: decisão do Ivo n.º 16)
// A fila (gravada no plano ativo, em plano.contactos): { fila: [msg], enviadas: [msg], seq }
//   msg: { id, ref ("A3": a letra do plano e o número; vai no fim do texto, "ref. A3", a mesma em todas as
//   tentativas — perder um atraso é pior do que o contacto o receber duas vezes), tipo, texto, contactos (a quem: os nomes dos contactos entregues do plano quando entrou),
//   idCalculo/indice (o plano a que pertence: auditoria I-04),
//   chats (os chatId deles), gpx?, nomeFicheiro?, chegada?/alarme? (só no atraso, ms), anterior? (do
//   plano anterior), criada, tentativas, proxima, estado: 'fila' | 'a enviar', pedido, erro }; as
//   enviadas guardam a hora a que realmente saíram (enviadaEm) e a quem.
//   Uma de cada vez e por ordem; a que falha (sem resposta em 30 s, sem o porto, ou nenhum contacto em
//   terra a recebeu) volta a tentar daqui a 2 min. Sai da fila o que deixou de interessar: um atraso
//   mais antigo (há outro mais novo, um plano novo, "cheguei bem" ou "terminada"); e nenhum atraso entra
//   depois do "cheguei bem" ou da "terminada" do mesmo plano.
// herdar(fila): a fila de um plano novo (decisão do Ivo de 01/10): limpa, só com o "cheguei bem"/
//   "terminada" do plano antigo por enviar e o que está "a enviar" (anterior: true).
// atualizarAtraso(fila, id, { chegada, alarme, texto }): o atraso ainda na fila passa a ter a chegada mais
//   recente (decisão do Ivo de 01/10: o atraso só conta quando é entregue; a hora da tentativa fica).
// tirar(fila, id): sai da fila (só se ainda não saiu) o atraso que deixou de valer (o barco recuperou).
// As guardas do atraso automático (revisão final C1, decisão do Ivo de 02/10, "só a avançar + teto de 3 h"):
//   juntarMarca(marcas, { t, s, lat, lon }): as milhas feitas na rota e a posição, de 5 em 5 min (as
//     últimas 2 h; gravadas no plano ativo, para valer depois de um reinício); progressoNaHora(marcas,
//     { s, lat, lon }, agora): o progresso na rota na última hora (MN/h; cada troço conta no máximo o que o
//     barco andou de facto; com menos de 1 h de marcas, o ritmo das que há, a partir de 15 min; sem isso,
//     null: não se sabe); com janela 15 min, o ritmo de agora;
//   retencaoAtraso({ progressoMnH, ritmoAgoraMnH, distRotaMn, alarmeNovo, alarmePlano, estouBem }): null (o
//     atraso pode sair), 'parado' (menos de 1 MN de progresso na rota na última hora, ou parado agora —
//     menos de 1 nó na rota nos últimos 15 min: um barco que acabou de parar não diz "tudo bem" —, ou a mais
//     de 2 MN da rota: parado ou à deriva, nada sai e fica a hora de alarme que terra já tem) ou 'limite' (a nova hora de alarme
//     passava 3 h da do plano; depois de um "Estou bem", 3 h da hora de alarme da mensagem que o toque
//     libertou). Um atraso libertado pelo "Estou bem" (confirmado: true) passa as guardas.
// evento(msg, pedido): o que se emite em 'arlequin:plano' para o porto (aos contactos da mensagem: o
//   porto escolhe-os pelos chats); numa nova tentativa que o Ivo já recebeu (ivoRecebeu), com tentativa
//   (2, 3, …): o porto já não a manda ao chat do Ivo.

// as 2 h da hora de alarme são as do plano (auditoria M-20: um só número)
const { horaLisboa, diaEHora, ALARME_DEPOIS_MS } = require('./plano')
const c = require('./costa')

const MIN = 60000
const H = 3600000
const REPETIR_MS = 2 * MIN
const ATRASO_INTERVALO_MS = H
const ATRASO_ESCORREGA_MS = 15 * MIN
const ATRASO_MARGEM_MS = 30 * MIN // o 1.º atraso: a chegada prevista 30 min ou mais depois da p90
const FECHO = new Set(['chegada', 'terminado'])
// Do plano anterior só ficam (herdar) o "cheguei bem"/"terminada" e os avisos ao Ivo: terra ainda espera
// por eles. Um atraso ou um plano do plano anterior que estava "a enviar" e falhou já não interessa (o
// plano dele acabou; o novo tem os seus, e um plano antigo a chegar depois do novo enganava os contactos:
// auditoria K-13).
const HERDAM = new Set(['chegada', 'terminado', 'aviso'])
const doAnteriorSemInteresse = (m) => !!m.anterior && !HERDAM.has(m.tipo)
const MARCA_MS = 5 * MIN // as marcas { t, s } de 5 em 5 min
const MARCAS_MS = 2 * H // guardam-se as das últimas 2 h
const PROGRESSO_MIN_MS = 15 * MIN // com menos marcas do que isto não se sabe o progresso
const PROGRESSO_MN_H = 1 // ≥ 1 MN na rota na última hora (decisão do Ivo de 02/10)
const DIST_ROTA_MAX_MN = 2 // e a ≤ 2 MN da rota
const TETO_MS = 3 * H // a hora de alarme no máximo 3 h sobre a do plano sem um "Estou bem"
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
// sempre com o dia (auditoria I-05, decisão n.º 16): uma mensagem de fecho entregue dias depois (o contacto
// desbloqueou o bot, a rede voltou) nunca parece de agora
const quando = (t) => (valido(t) ? ` ${diaEHora(t)}` : '')

// "Cheguei bem à Nazaré", "a Peniche", "ao Porto" (auditoria M-19: a preposição do lib/costa.js)
const textoChegada = ({ destino, chegou }) => `Cheguei bem ${c.sitio.a(destino || 'Destino')}${quando(chegou)}. Obrigado!`
const textoAtraso = ({ chegada, alarme, alarmeAntes, agora }) =>
  `Ainda a navegar, tudo bem. Nova chegada prevista ~${horaLisboa(chegada, agora)}. Nova hora de alarme: ${horaLisboa(alarme, agora)} (em vez de ${horaLisboa(alarmeAntes, agora)}).`
// posicaoEm (auditoria M-22): a hora da posição quando não é de agora (sem GPS): "última posição conhecida"
function textoTerminado ({ posicao, posicaoEm = null, agora }) {
  const temPos = posicao && Number.isFinite(posicao.lat) && Number.isFinite(posicao.lon)
  if (temPos && valido(posicaoEm)) return `Viagem terminada / mudança de planos: estou bem,${quando(agora)} (última posição conhecida ${grausMinutos(posicao)}, ${diaEHora(posicaoEm)}).`
  const onde = temPos ? ` em ${grausMinutos(posicao)}` : ''
  return `Viagem terminada / mudança de planos: estou bem,${onde}${quando(agora)}.`
}
// a linha "Este plano substitui o anterior." logo a seguir à do envio (a 2.ª)
function textoSubstitui (texto) {
  const linhas = String(texto).split('\n')
  linhas.splice(2, 0, SUBSTITUI)
  return linhas.join('\n')
}

// O aviso ao Ivo (pelo Telegram, só ao chat dele) de uma mensagem para terra de que se desistiu (auditoria
// I-05, decisão n.º 16): a quem não chegou, o quê e a hora que passou — a de alarme que ESSE contacto tem
// (m.passou, posta pelo desistir; revisão da F2, F2b Importante 1: nunca a do plano novo nem a de outro
// contacto). Um plano novo que sai porque a hora de alarme DELE passou primeiro (porAlarmeDoPlano) di-lo, e
// diz também a antiga, que é a que o contacto ainda tem.
const O_QUE = Object.freeze({ chegada: ['o «cheguei bem»', 'o'], terminado: ['a «viagem terminada»', 'a'], atraso: ['o aviso de atraso', 'o'], plano: ['o plano novo', 'o'] })
function textoDesisti (m) {
  const nomes = (m.contactos || []).map(String)
  const um = nomes.length <= 1
  const quem = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0] || 'O contacto'
  const [oQue, pron] = O_QUE[m.tipo] ?? ['a mensagem', 'a']
  const recebeu = um ? 'recebeu' : 'receberam'
  const ligar = um ? 'Liga-lhe' : 'Liga-lhes'
  const passou = valido(m.passou) ? m.passou : m.desisteEm
  if (m.tipo === 'plano') {
    const ficou = um ? 'ficou' : 'ficaram'
    // (sem a marca — uma desistida de antes desta revisão — vale a regra antiga: a hora do plano novo)
    const proprio = m.porAlarmeDoPlano === true || (m.porAlarmeDoPlano == null && valido(m.alarme))
    if (proprio && valido(m.alarme)) return `${quem} não ${recebeu} ${oQue} (ref. ${m.ref}) antes da hora de alarme dele (${diaEHora(m.alarme)}): ${ficou} com o plano antigo${valido(m.antiga) ? ` (hora de alarme ${diaEHora(m.antiga)})` : ''}. ${ligar}.`
    return `${quem} não ${recebeu} ${oQue} (ref. ${m.ref}): ${ficou} com o plano antigo, cuja hora de alarme (${diaEHora(passou)}) já passou. ${ligar}.`
  }
  return `${quem} não ${recebeu} ${oQue} (ref. ${m.ref}) e já passou a hora de alarme (${diaEHora(passou)}): desisti de ${pron} entregar. ${ligar}.`
}

// ---------- o atraso ----------
// enviado: o último atraso enviado { ultimoEm, chegada, alarme } (ms) ou null.
// O 1.º só com a chegada prevista agora 30 min ou mais depois da "mais tarde" do plano (decisão do Ivo de
// 01/10: um plano só a motor tem p90 = p50, e 5 min de atraso não é motivo para ninguém se preocupar).
function decidirAtraso (enviado, { chegadaAgora, p90, alarmePlano, agora }) {
  if (!valido(chegadaAgora) || !valido(p90) || chegadaAgora <= p90) return null
  const novo = { chegada: chegadaAgora, alarme: chegadaAgora + ALARME_DEPOIS_MS }
  if (!enviado) return chegadaAgora - p90 >= ATRASO_MARGEM_MS ? { ...novo, alarmeAntes: alarmePlano } : null
  if (agora - enviado.ultimoEm < ATRASO_INTERVALO_MS) return null
  if (chegadaAgora - enviado.chegada <= ATRASO_ESCORREGA_MS) return null
  return { ...novo, alarmeAntes: enviado.alarme }
}

// ---------- as guardas do atraso automático (revisão final C1) ----------
// marca: { t, s, lat?, lon? } (as milhas na rota e a posição)
function juntarMarca (marcas0, { t, s, lat, lon }) {
  const marcas = Array.isArray(marcas0) ? marcas0.filter(m => valido(m?.t) && valido(m?.s)) : []
  if (!valido(t) || !valido(s)) return marcas
  const nova = { t, s, ...(valido(lat) && valido(lon) ? { lat, lon } : {}) }
  const ultima = marcas.at(-1)
  // um salto do relógio para trás recomeça
  if (ultima && t < ultima.t) return [nova]
  if (ultima && t - ultima.t < MARCA_MS) return marcas
  return [...marcas, nova].filter(m => m.t >= t - MARCAS_MS)
}
// O progresso na rota (MN/h) desde a marca de referência até agora (atual: { s, lat?, lon? }). Cada troço
// conta no máximo o que o barco andou de facto (a distância entre as posições): longe da rota, numa curva,
// a projeção salta para a frente sem o barco andar (um barco à deriva não avança na rota).
// janela: a última hora (o padrão) ou os últimos 15 min (a avançar agora).
function progressoNaHora (marcas, atual, agora, janela = H) {
  const a = typeof atual === 'number' ? { s: atual } : atual
  if (!Array.isArray(marcas) || !marcas.length || !valido(a?.s)) return null
  const antes = marcas.filter(m => m.t <= agora - janela)
  const ref = antes.length ? antes.at(-1) : marcas[0].t <= agora - PROGRESSO_MIN_MS ? marcas[0] : null
  if (!ref) return null
  const pontos = [...marcas.filter(m => m.t >= ref.t && m.t < agora), { ...a, t: agora }]
  let feito = 0
  for (let i = 1; i < pontos.length; i++) {
    const [p, q] = [pontos[i - 1], pontos[i]]
    const ds = q.s - p.s
    const comPos = valido(p.lat) && valido(p.lon) && valido(q.lat) && valido(q.lon)
    feito += comPos ? Math.min(ds, c.distanciaMn(p, q)) : ds
  }
  return feito * H / (agora - ref.t)
}
function retencaoAtraso ({ progressoMnH, ritmoAgoraMnH, distRotaMn, alarmeNovo, alarmePlano, estouBem }) {
  const avanca = (x) => valido(x) && x >= PROGRESSO_MN_H
  if (!avanca(progressoMnH) || !avanca(ritmoAgoraMnH) || !valido(distRotaMn) || distRotaMn > DIST_ROTA_MAX_MN) return 'parado'
  const base = valido(estouBem?.alarme) ? estouBem.alarme : alarmePlano
  if (valido(base) && valido(alarmeNovo) && alarmeNovo > base + TETO_MS) return 'limite'
  return null
}

// ---------- a hora de alarme de cada contacto em terra (auditoria I-01, decisão n.º 14) ----------
// terra: [{ chat, nome, alarme (ms) | null, fechado }] — para cada contacto do envio do plano, a hora de
// alarme que ele tem (a do plano ou do último atraso que LHE chegou: só conta o que foi entregue) e se já
// recebeu o "cheguei bem"/"terminada" deste plano. Com uma entrega parcial (o Pai bloqueou o bot) os
// contactos ficam com horas diferentes, e o aviso de 60 min tem de chegar antes da primeira chamada.
const msValida = (t) => (valido(t) ? t : typeof t === 'string' ? (Number.isFinite(Date.parse(t)) ? Date.parse(t) : null) : null)
const mesmoContacto = (a, chat, nome) => (a.chat != null && chat != null ? String(a.chat) === String(chat) : a.nome === nome)
// a partir do envio { contactos, chats, alarme }: todos com a hora de alarme do envio
function terraInicial (envio) {
  const nomes = Array.isArray(envio?.contactos) ? envio.contactos.map(String) : []
  const chats = Array.isArray(envio?.chats) ? envio.chats.map(String) : []
  return nomes.map((nome, i) => ({ chat: chats[i] ?? null, nome, alarme: msValida(envio.alarme), fechado: false }))
}
// os contactos que receberam uma mensagem ({ contactos, chats }, pela mesma ordem) passam a ter a hora de
// alarme dela (plano ou atraso) ou ficam fechados ("cheguei bem"/"terminada"); um que não estava junta-se
function terraEntregue (terra0, { contactos = [], chats = [] } = {}, { alarme = null, fechado = false } = {}) {
  const terra = (Array.isArray(terra0) ? terra0 : []).map(a => ({ ...a }))
  for (const [i, nome0] of contactos.entries()) {
    const nome = String(nome0)
    const chat = chats[i] != null ? String(chats[i]) : null
    let a = terra.find(x => mesmoContacto(x, chat, nome))
    if (!a) { a = { chat, nome, alarme: null, fechado: false }; terra.push(a) }
    if (fechado) a.fechado = true
    else if (valido(alarme)) { a.alarme = alarme; a.fechado = false }
  }
  return terra
}
const alarmesEmEspera = (terra) => (Array.isArray(terra) ? terra : []).filter(a => !a.fechado && valido(a.alarme)).map(a => a.alarme)
// a mais cedo que algum contacto (ainda à espera) tem: a do aviso de 60 min e a que o ecrã mostra
const alarmeMaisCedo = (terra) => { const l = alarmesEmEspera(terra); return l.length ? Math.min(...l) : NaN }
// a mais tarde: até ela terra ainda espera notícias
const alarmeMaisTarde = (terra) => { const l = alarmesEmEspera(terra); return l.length ? Math.max(...l) : NaN }
// A hora a partir da qual se desiste de entregar uma mensagem a CADA contacto dela (revisão da F2, F2b
// Importante 1, decisão n.º 16): a hora de alarme que esse contacto tem (terra), pelo chat (sem chat, pelo
// nome) → { desistePor: { chat|nome: ms }, desisteEm: a mais tarde delas (NaN sem nenhuma) }. Vai na mensagem
// (porNaFila) e o parcial fica só com as de quem falhou: a desistência de um contacto que nunca recebe dá-se
// no fim da hora DELE, nunca na mais tarde de todos, e um atraso novo entregue aos outros não a renova.
const chaveContacto = (chat, nome) => (chat != null ? String(chat) : String(nome))
function desistePorDe (terra, { contactos = [], chats = [] } = {}) {
  const desistePor = {}
  for (const [i, nome0] of contactos.entries()) {
    const nome = String(nome0)
    const chat = chats[i] != null ? String(chats[i]) : null
    const a = (Array.isArray(terra) ? terra : []).find(x => mesmoContacto(x, chat, nome))
    if (valido(a?.alarme)) desistePor[chaveContacto(chat, nome)] = a.alarme
  }
  const l = Object.values(desistePor)
  return { desistePor, desisteEm: l.length ? Math.max(...l) : NaN }
}
const desistePorValido = (x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, t]) => valido(t))) : {})
// A hora de alarme que tinham os contactos de uma mensagem ({ contactos, chats }), a de hoje em terra: a mais cedo
// delas (o "em vez de" do parcial de um atraso, F2b Menor 9: o texto diz a hora que ESSES contactos tinham, não a
// dos outros que já receberam o atraso; com horas diferentes, a do que liga primeiro) ou NaN sem nenhuma.
function alarmeDosContactos (terra, msg) {
  const horas = Object.values(desistePorDe(terra, msg).desistePor)
  return horas.length ? Math.min(...horas) : NaN
}

// ---------- a fila ----------
// letra: a letra das referências deste plano ("ref. A3"); o plano seguinte passa à seguinte (Z → A)
const novaFila = () => ({ fila: [], enviadas: [], seq: 0, letra: 'A', desistencias: [] })
const letraSeguinte = (l) => (typeof l === 'string' && /^[A-Y]$/.test(l) ? String.fromCharCode(l.charCodeAt(0) + 1) : 'A')

function porNaFila (c0, msg, agora) {
  const c = { ...novaFila(), ...c0 }
  // só o "cheguei bem"/"terminada" deste plano fecha (os herdados do plano anterior não)
  const fechado = [...c.enviadas, ...c.fila].some(m => FECHO.has(m.tipo) && !m.anterior)
  if (msg.tipo === 'atraso' && fechado) return c
  // o que deixou de interessar (só o que ainda não saiu: o que está "a enviar" fica). Um aviso ao Ivo não é
  // para terra: não tira nada (F2b Menor 1: tirava o atraso em espera, até o confirmado pelo "Estou bem")
  const tira = (m) => msg.tipo !== 'aviso' && m.estado === 'fila' && (m.tipo === 'atraso' || (msg.tipo === 'plano' && m.tipo === 'plano'))
  const seq = c.seq + 1
  const nova = {
    id: `m${seq}`,
    // a referência curta e estável (Tarefa 8.4): a mesma em todas as tentativas, para quem recebe ver
    // que é a mesma mensagem
    ref: `${c.letra || 'A'}${seq}`,
    tipo: msg.tipo,
    texto: msg.texto,
    contactos: [...(msg.contactos || [])],
    chats: [...(msg.chats || [])],
    ...(msg.gpx ? { gpx: msg.gpx, nomeFicheiro: msg.nomeFicheiro } : {}),
    // o atraso: a chegada e o alarme (ms), para o texto à hora de sair e para o registo na entrega
    ...(msg.tipo === 'atraso' && valido(msg.chegada) && valido(msg.alarme) ? { chegada: msg.chegada, alarme: msg.alarme } : {}),
    // o plano novo: a hora de alarme dele (ms), que cada contacto passa a ter quando lhe chega (I-01)
    ...(msg.tipo === 'plano' && valido(msg.alarme) ? { alarme: msg.alarme } : {}),
    // o plano a que pertence (auditoria I-04): um "cheguei bem" atrasado só fecha o envio do seu plano
    ...(msg.idCalculo != null ? { idCalculo: msg.idCalculo, indice: msg.indice } : {}),
    // a hora a partir da qual se desiste de a entregar a um contacto que nunca a recebe (auditoria I-05):
    // a hora de alarme que cada contacto dela tem (desistePor; F2b Importante 1) e a mais tarde delas
    ...(valido(msg.desisteEm) ? { desisteEm: msg.desisteEm } : {}),
    ...(Object.keys(desistePorValido(msg.desistePor)).length ? { desistePor: desistePorValido(msg.desistePor) } : {}),
    // o atraso libertado pelo "Estou bem" do Ivo (passa as guardas, também à hora de sair)
    ...(msg.tipo === 'atraso' && msg.confirmado === true ? { confirmado: true } : {}),
    criada: iso(agora),
    tentativas: 0,
    proxima: iso(agora),
    estado: 'fila',
    pedido: null,
    erro: null
  }
  return { ...c, seq, fila: [...c.fila.filter(m => !tira(m)), nova] }
}

// O plano novo (decisão do Ivo de 01/10): a fila limpa (sem as enviadas nem os atrasos do plano antigo);
// só segue o "cheguei bem"/"terminada" do plano antigo que ainda não saiu e o que está "a enviar" (à
// espera da resposta do porto), marcados do plano anterior (anterior: true).
function herdar (c0) {
  if (!c0) return novaFila()
  const c = { ...novaFila(), ...c0 }
  const fica = (m) => m.estado === 'a enviar' || HERDAM.has(m.tipo)
  return { fila: c.fila.filter(fica).map(m => ({ ...m, anterior: true })), enviadas: [], seq: c.seq, letra: letraSeguinte(c.letra), desistencias: [] }
}

// O atraso que ainda está na fila (não "a enviar") passa a ter a chegada e o alarme mais recentes; a
// hora da próxima tentativa fica.
function atualizarAtraso (c, id, { chegada, alarme, texto }) {
  return mudar(c, m => m.id === id && m.tipo === 'atraso' && m.estado === 'fila', m => ({ ...m, chegada, alarme, ...(texto != null ? { texto } : {}) }))
}

// Tira da fila uma mensagem que ainda não saiu (estado 'fila'): o atraso que deixou de valer.
const tirar = (c, id) => ({ ...c, fila: c.fila.filter(m => !(m.id === id && m.estado === 'fila')) })
// Tira da fila as que ainda não saíram e que `f` escolhe (auditoria K-02: os atrasos em pausa).
const tirarSe = (c, f) => ({ ...c, fila: c.fila.filter(m => !(m.estado === 'fila' && f(m))) })
// Um atraso automático: o "Ainda a navegar, tudo bem" deste plano que só pode sair com o barco a avançar
// (auditoria K-02); o do "Estou bem" (confirmado) e os do plano anterior não são.
const atrasoAutomatico = (m) => m?.tipo === 'atraso' && !m.anterior && !m.confirmado

// A próxima a enviar (auditoria K-13): uma de cada vez (nenhuma "a enviar") e só as que já estão na hora.
// As que guardam a ordem — as deste plano com menos de 3 tentativas — saem pela ordem da fila: a 1.ª
// delas que ainda não está na hora faz esperar as seguintes. As outras nunca prendem nenhuma, seja de
// que tipo for: as que já falharam 3 vezes (um contacto que bloqueou o bot ou saiu dos "Contactos do
// plano": a sonda S6 prendia os atrasos e o "cheguei bem" da viagem seguinte), as do plano anterior (vão
// para o fim da fila) e os avisos ao Ivo; saem quando nenhuma das que guardam a ordem está pronta (e
// assim nunca se perdem). (Revisão final M4: um 'plano' que falhou 3 vezes deixa passar o "cheguei bem".)
// saltar(m): as que não podem sair agora (auditoria K-02: um atraso sem GPS fica retido), nem prendem.
const TENTATIVAS_PRENDE = 3
const guardaOrdem = (m) => !(m.tentativas >= TENTATIVAS_PRENDE || m.anterior || m.tipo === 'aviso')
function proxima (c, agora, { saltar = () => false } = {}) {
  if (!c?.fila?.length || c.fila.some(m => m.estado === 'a enviar')) return null
  const pronta = (m) => Date.parse(m.proxima) <= agora
  const fila = c.fila.filter(m => !saltar(m))
  const primeira = fila.find(guardaOrdem)
  if (primeira && pronta(primeira)) return primeira
  return fila.find(m => !guardaOrdem(m) && pronta(m)) ?? null
}

const mudar = (c, f, fn) => ({ ...c, fila: c.fila.map(m => (f(m) ? fn(m) : m)) })
// texto: o da hora de sair (o atraso diz "em vez de" o último alarme entregue)
const marcarAEnviar = (c, id, pedido, agora, texto) => mudar(c, m => m.id === id, m => ({ ...m, estado: 'a enviar', pedido, tentativas: m.tentativas + 1, tentadaEm: iso(agora), ...(texto != null ? { texto } : {}) }))

function falhou (c, pedido, erro, agora) {
  const m0 = c.fila.find(m => m.pedido === pedido)
  if (!m0) return c
  if (doAnteriorSemInteresse(m0)) return { ...c, fila: c.fila.filter(m => m !== m0) }
  return mudar(c, m => m.pedido === pedido, m => ({ ...m, estado: 'fila', pedido: null, erro, proxima: iso(agora + REPETIR_MS) }))
}

// Desistir (auditoria I-05, decisão do Ivo n.º 16): de um contacto que nunca recebe uma mensagem desiste-se no
// fim da hora de alarme DELE — a que esse contacto tem (terra, a de agora; numa mensagem do plano anterior,
// ou sem terra, a guardada na mensagem: desistePor, e sem ela desisteEm para todos) — só quando a falha é do
// contacto (outro contacto ou o Ivo recebeu: bloqueou o bot, saiu dos "Contactos do plano"); sem ninguém a
// receber (sem rede, o porto desligado) nunca se desiste: chega quando a rede voltar. Com dois contactos de
// horas diferentes, sai cada um à sua hora: a mensagem fica na fila só para os outros (revisão da F2, F2b
// Importante 1: antes era a hora mais tarde de todos, renovada por cada atraso entregue aos outros, e o Pai
// nunca produzia a desistência nem o "liga-lhe"). Também sai, inteiro e com ou sem rede, o plano novo que
// passou a hora de alarme DELE sem chegar (um plano com o alarme já passado dava um falso alarme), e um aviso
// ao Ivo ao fim de 24 h. → { c (com as desistências registadas: alarme = a hora que passou), desistidas:
// [{ ...msg, contactos/chats: só os desistidos, passou (ms), porAlarmeDoPlano, antiga? }] } (quem chama avisa
// o Ivo, com textoDesisti).
const MAX_DESISTENCIAS = 10
function desistir (c0, agora, { terra = null } = {}) {
  const c = { ...novaFila(), ...c0 }
  const daContacto = (m) => m.parcial || m.ivoRecebeu
  const fila = []
  const desistidas = []
  const registo = []
  const regista = (m, g, passou) => {
    desistidas.push({ ...m, contactos: g.contactos, chats: g.chats, passou, porAlarmeDoPlano: g.porAlarmeDoPlano === true, ...(valido(g.antiga) ? { antiga: g.antiga } : {}) })
    registo.push({ ref: m.ref, tipo: m.tipo, contactos: [...g.contactos], chats: [...g.chats], em: iso(agora), alarme: valido(passou) ? iso(passou) : null, anterior: !!m.anterior })
  }
  for (const m of c.fila) {
    if (m.estado !== 'fila') { fila.push(m); continue }
    const tentada = m.tentativas >= 1
    // o aviso ao Ivo: ao fim das 24 h, com ou sem rede
    if (m.tipo === 'aviso') {
      if (tentada && valido(m.desisteEm) && agora >= m.desisteEm) regista(m, { contactos: [], chats: [] }, m.desisteEm)
      else fila.push(m)
      continue
    }
    const nomes = (m.contactos || []).map(String)
    const chats = (m.chats || []).map(String)
    const n = Math.max(nomes.length, chats.length)
    // a hora de alarme que o contacto i tem
    const horaDe = (i) => {
      const chat = chats[i] ?? null
      const nome = nomes[i] ?? `chat ${chat}`
      const atual = !m.anterior && Array.isArray(terra) ? terra.find(a => mesmoContacto(a, chat, nome))?.alarme : undefined
      if (valido(atual)) return atual
      const guardada = m.desistePor?.[chaveContacto(chat, nome)]
      return valido(guardada) ? guardada : valido(m.desisteEm) ? m.desisteEm : NaN
    }
    const grupos = new Map() // a hora que passou → { contactos, chats }
    const ficam = []
    for (let i = 0; i < n; i++) {
      const t = horaDe(i)
      if (tentada && daContacto(m) && valido(t) && agora >= t) {
        const g = grupos.get(t) || { contactos: [], chats: [] }
        g.contactos.push(nomes[i] ?? `chat ${chats[i]}`)
        if (chats[i] != null) g.chats.push(chats[i])
        grupos.set(t, g)
      } else ficam.push(i)
    }
    // (uma mensagem sem contactos: a hora da mensagem)
    if (!n && tentada && daContacto(m) && valido(m.desisteEm) && agora >= m.desisteEm) grupos.set(m.desisteEm, { contactos: [], chats: [] })
    // o plano novo com a hora de alarme dele já passada: os que ficavam saem também
    if (m.tipo === 'plano' && valido(m.alarme) && agora >= m.alarme && (ficam.length || (!n && !grupos.size))) {
      const horas = ficam.map(horaDe).filter(valido)
      grupos.set(m.alarme, { contactos: ficam.map(i => nomes[i] ?? `chat ${chats[i]}`), chats: ficam.map(i => chats[i]).filter(x => x != null), porAlarmeDoPlano: true, antiga: horas.length ? Math.max(...horas) : NaN })
      ficam.length = 0
    }
    if (!grupos.size) { fila.push(m); continue }
    for (const [passou, g] of grupos) regista(m, g, passou)
    if (ficam.length) {
      const desistePor = Object.fromEntries(ficam.map(i => [chaveContacto(chats[i] ?? null, nomes[i]), m.desistePor?.[chaveContacto(chats[i] ?? null, nomes[i])]]).filter(([, t]) => valido(t)))
      const horas = Object.values(desistePor)
      fila.push({ ...m, contactos: ficam.map(i => nomes[i] ?? `chat ${chats[i]}`), chats: ficam.map(i => chats[i]).filter(x => x != null), ...(Object.keys(desistePor).length ? { desistePor } : {}), ...(horas.length ? { desisteEm: Math.max(...horas) } : {}) })
    }
  }
  if (!desistidas.length) return { c: c0, desistidas }
  return { c: { ...c, fila, desistencias: [...(c.desistencias || []), ...registo].slice(-MAX_DESISTENCIAS) }, desistidas }
}

// A resposta do porto ({ entregues, contactos, chats, falhas }): enviada com pelo menos um contacto em
// terra. ivoRecebeu (revisão final M3): um entregue que não é contacto (o chat do Ivo) — só então as novas
// tentativas deixam de ir ao Ivo. Os chats pedidos que não a receberam (revisão final I3: o Pai bloqueou o
// bot, um erro do Telegram) voltam à fila numa mensagem igual, com a mesma ref, só para eles (parcial),
// daqui a 2 min, até entregar ou deixar de interessar (as regras do porNaFila).
// (auditoria M-25: uma resposta mal formada — não um objeto, falhas que não são objetos — não rebenta: corre
// dentro do emit do porto, com a fila a meio)
function resposta (c, pedido, r0 = {}, agora) {
  const r = r0 !== null && typeof r0 === 'object' && !Array.isArray(r0) ? r0 : {}
  const m = c.fila.find(x => x.pedido === pedido)
  if (!m) return c
  const contactos = Array.isArray(r.contactos) ? r.contactos.map(String) : []
  const chats = Array.isArray(r.chats) ? r.chats.map(String) : []
  const entregues = Array.isArray(r.entregues) ? r.entregues.map(String) : []
  const falhas = Array.isArray(r.falhas) ? r.falhas.filter(f => f !== null && typeof f === 'object' && !Array.isArray(f)) : []
  const ivo = m.ivoRecebeu || entregues.some(x => !contactos.includes(x))
  // o aviso ao Ivo (auditoria I-05): entregue quando o Ivo o recebe (não tem contactos)
  if (m.tipo === 'aviso') {
    if (!entregues.length) return falhou(c, pedido, falhas.length ? falhas.map(x => `${x.nome}: ${x.erro}`).join('; ') : 'o Ivo não o recebeu', agora)
    const { gpx: _g, nomeFicheiro: _n, estado: _e, pedido: _p, proxima: _x, ...resto } = m
    return { ...c, fila: c.fila.filter(x => x !== m), enviadas: [...c.enviadas, { ...resto, enviadaEm: iso(agora), contactos: [], chats: [], entregues, falhas }] }
  }
  if (!contactos.length) {
    const f = falhou(c, pedido, falhas.length ? falhas.map(x => `${x.nome}: ${x.erro}`).join('; ') : 'nenhum contacto em terra a recebeu', agora)
    return ivo ? mudar(f, x => x.id === m.id, x => ({ ...x, ivoRecebeu: true })) : f
  }
  const { gpx, nomeFicheiro, estado, pedido: _p, proxima: _x, ...resto } = m
  const enviada = { ...resto, enviadaEm: iso(agora), contactos, chats, entregues, falhas }
  let out = { ...c, fila: c.fila.filter(x => x !== m), enviadas: [...c.enviadas, enviada] }
  // os que falharam: a mesma mensagem, só para eles
  const pedidos = Array.isArray(m.chats) ? m.chats.map(String) : []
  const faltam = pedidos.map((id, i) => ({ id, nome: pedidos.length === (m.contactos || []).length ? m.contactos[i] : `chat ${id}` })).filter(x => !chats.includes(x.id))
  if (faltam.length && !doAnteriorSemInteresse(m)) {
    const seq = out.seq + 1
    // a hora de desistir de cada um que falhou é a dele (F2b Importante 1): o parcial fica só com essas
    const desistePor = Object.fromEntries(faltam.map(x => [chaveContacto(x.id, x.nome), m.desistePor?.[chaveContacto(x.id, x.nome)]]).filter(([, t]) => valido(t)))
    const horas = Object.values(desistePor)
    const nova = { ...m, id: `m${seq}`, contactos: faltam.map(x => x.nome), chats: faltam.map(x => x.id), parcial: true, ...(ivo ? { ivoRecebeu: true } : {}), estado: 'fila', pedido: null, erro: falhas.map(x => `${x.nome}: ${x.erro}`).join('; ') || null, proxima: iso(agora + REPETIR_MS), ...(Object.keys(desistePor).length ? { desistePor } : {}), ...(horas.length ? { desisteEm: Math.max(...horas) } : {}) }
    out = { ...out, seq, fila: [...out.fila, nova] }
  }
  return out
}

// Ao arrancar: a que estava "a enviar" já não tem resposta; volta à fila para tentar já.
function aoArrancar (c, agora) {
  if (!c) return novaFila()
  return mudar({ ...novaFila(), ...c }, m => m.estado === 'a enviar', m => ({ ...m, estado: 'fila', pedido: null, proxima: iso(agora) }))
}

// contactos: os nomes (para o porto dizer quem falhou); chats: os chatId (o porto escolhe por eles)
function evento (msg, pedido, contactos = msg.contactos || [], chats = msg.chats || []) {
  return {
    pedido,
    tipo: msg.tipo,
    texto: msg.ref ? `${msg.texto}\nref. ${msg.ref}` : msg.texto,
    ...(msg.tipo === 'plano' && msg.gpx ? { gpx: msg.gpx, nomeFicheiro: msg.nomeFicheiro } : {}),
    destinatarios: 'contactos-do-plano',
    contactos: [...contactos],
    chats: [...chats],
    // uma nova tentativa (re-revisão M-5): o porto já não a repete ao chat do Ivo — só se ele já a recebeu
    // (revisão final M3: sem resposta do porto, ou sem o porto, a 1.ª nunca chegou ao Telegram)
    ...(msg.tentativas > 1 && msg.ivoRecebeu ? { tentativa: msg.tentativas } : {})
  }
}

module.exports = { SUBSTITUI, REPETIR_MS, ATRASO_ESCORREGA_MS, ATRASO_MARGEM_MS, TETO_MS, PROGRESSO_MN_H, DIST_ROTA_MAX_MN, juntarMarca, progressoNaHora, retencaoAtraso, grausMinutos, textoChegada, textoAtraso, textoTerminado, textoSubstitui, textoDesisti, desistir, decidirAtraso, terraInicial, terraEntregue, alarmeMaisCedo, alarmeMaisTarde, desistePorDe, alarmeDosContactos, novaFila, porNaFila, herdar, atualizarAtraso, tirar, tirarSe, atrasoAutomatico, proxima, marcarAEnviar, falhou, resposta, aoArrancar, evento }
