// Melhor rota, estado Pedir (desenho 3b-1): a lista de destinos (a rota ativa do OpenCPN no topo,
// depois os portos do mais perto para o mais longe), "+ acrescentar" (aqui ou por coordenadas),
// só eu / 2 ou mais, e Calcular. Também o arranque do cálculo e o seguimento (A calcular), que o
// Resultado usa para "Sair agora mesmo assim". Com uma rota ativa (depois de "Novo cálculo"), o
// "Voltar ao leme". O que se escreve no "+ acrescentar" fica no estado (e.form): um render não o apaga.

import { esc, num } from '../../lib/rota-texto.js'
import { proximoWp } from '../comum.js'
import { SEM_AUTORIZACAO } from '../../lib/erros.js'
import { planoAberto } from './aberto.js'

export const URL_ROTA = '/plugins/signalk-arlequin-rota'
export const PLUGIN_DESLIGADO = 'o plugin da rota não responde'
export const CALCULO_PERDIDO = 'este cálculo já não existe no plugin (reiniciado?): calcula outra vez'
export { SEM_AUTORIZACAO } // o mesmo em todas as páginas (lib/erros.js)
export const CANCELADO = 'Deixei de seguir o cálculo: o plugin da rota continua a calcular até ao fim (um novo Calcular segue esse).'
const GPS_VELHO_MS = 10000

const agendar = (ctx, f, ms) => (ctx.agendar || setTimeout)(f, ms)

// A posição do GPS { lat, lon } se for recente, senão null.
export function posicaoGps (ctx) {
  const p = ctx.v('navigation.position')
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
  if (!(ctx.idade('navigation.position') < GPS_VELHO_MS)) return null
  return { lat: p.latitude, lon: p.longitude }
}

// A rota ativa no SignalK (a do OpenCPN ou a ativada aqui): o rumo calculado (calcValues) ou só a
// navigation.course.activeRoute (sem um fornecedor de cálculos de rumo, o SignalK não manda o
// rumo). → { nome, detalhe } ou null
export function rotaAtiva (ctx) {
  const wp = proximoWp(ctx)
  const ar = ctx.v('navigation.course.activeRoute')
  if (!wp.ativo && !ar?.href) return null
  return { nome: ar?.name || 'Rota ativa no OpenCPN', detalhe: wp.ativo ? `próximo ponto: ${wp.nome}` : 'rota ativa no OpenCPN' }
}

// "Voltar ao leme" (auditoria I-25): no Pedir, no A calcular, no Resultado e no Mapa, sempre que há um plano
// aberto ou uma rota ativa — ao leme e sozinho, voltar ao rumo é um toque (sem ativar nada).
export const botaoVoltarLeme = (ctx) => (rotaAtiva(ctx) || planoAberto(ctx) ? '<button class="acao" data-acao="rota-voltar-leme">Voltar ao leme</button>' : '')

// O erro de um pedido ao plugin da rota em pt-PT, nunca o código HTTP cru: o motivo do plugin quando
// o há ({ erro } na resposta); sem resposta, "não responde"; sem explicação, o que o código quer dizer.
//   se404: o texto para um 404 (ex.: o /resultado de um cálculo que o plugin já não tem);
//   desligado503: um 503 diz "o plugin da rota não responde (motivo)" (os pedidos de leitura).
const explicado = (m) => typeof m === 'string' && m.trim() !== '' && !/^\d{3}$/.test(m.trim())
export function motivoPlugin (err, { se404 = null, desligado503 = true } = {}) {
  const s = err?.status
  const msg = err?.message
  if (!s) return PLUGIN_DESLIGADO
  if (s === 404) {
    if (se404) return se404
    if (msg === 'cálculo desconhecido') return CALCULO_PERDIDO
    return explicado(msg) ? msg : PLUGIN_DESLIGADO
  }
  if (s === 503 && desligado503) return explicado(msg) ? `${PLUGIN_DESLIGADO} (${msg})` : PLUGIN_DESLIGADO
  if (explicado(msg)) return msg
  if (s === 401 || s === 403) return SEM_AUTORIZACAO
  return `o plugin da rota deu um erro (HTTP ${s})`
}
// o mesmo para as ações (Ativar, Enviar plano, Gravar): um 503 traz o motivo tal e qual
export const motivoAcao = (err, o = {}) => motivoPlugin(err, { desligado503: false, ...o })

// Distância em MN (plano local; chega para ordenar e mostrar).
function milhas (a, b) {
  const k = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180)
  return Math.hypot((b.lat - a.lat) * 60, (b.lon - a.lon) * 60 * k)
}
const onde = (d) => {
  const p = Array.isArray(d.aproximacao) && d.aproximacao.length ? d.aproximacao.at(-1) : d.largo
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { lat: p[0], lon: p[1] } : null
}

export function buscarDestinos (ctx, forcar = false) {
  const e = ctx.estado
  if (e.aBuscarDestinos || (!forcar && e.destinosEm && Date.now() - e.destinosEm < 60000)) return
  e.aBuscarDestinos = true
  return ctx.pedir(`${URL_ROTA}/destinos`)
    .then(r => { e.destinos = Array.isArray(r?.destinos) ? r.destinos : []; e.destinosErro = null })
    .catch(err => { e.destinosErro = motivoPlugin(err) })
    .finally(() => { e.aBuscarDestinos = false; e.destinosEm = Date.now(); ctx.refrescar() })
}

// Pede o cálculo e segue-o. pedido: { destino, tripulacao, sairAgora }. Um toque duplo (ou um
// Calcular com um cálculo já a ser seguido) não pede outra vez.
export async function calcular (ctx, pedido) {
  const e = ctx.estado
  if (e.aPedirCalculo || e.vista === 'a-calcular') return
  e.aPedirCalculo = true
  e.ultimoPedido = pedido
  e.erro = null
  e.msg = null
  let id
  try {
    id = (await ctx.pedir(`${URL_ROTA}/calcular`, { method: 'POST', body: pedido })).id
  } catch (err) {
    // já há um a correr: segue esse. O destino dele não é o pedido: o "Sair agora" e o "Tentar outra
    // vez" usam o do resultado dele (seguir), nunca o pedido nem um resultado anterior
    if (err.status === 409 && err.corpo?.id) {
      id = err.corpo.id
      e.ultimoPedido = null
      e.resultado = null
    } else { e.vista = 'erro'; e.erro = motivoPlugin(err); return }
  } finally { e.aPedirCalculo = false }
  e.calculo = { id, progresso: 0, texto: 'a começar', destino: e.ultimoPedido?.destino ?? null }
  e.vista = 'a-calcular'
  return seguir(ctx)
}

// Um pedido do resultado; enquanto "a calcular", outro daqui a 1 s.
export function seguir (ctx) {
  const e = ctx.estado
  const id = e.calculo?.id
  if (!id) return
  return ctx.pedir(`${URL_ROTA}/resultado/${encodeURIComponent(id)}`)
    .then(r => {
      if (e.calculo?.id !== id || e.vista !== 'a-calcular') return // outro cálculo ou o Ivo saiu
      if (r.estado === 'a calcular') {
        e.calculo = { ...e.calculo, progresso: r.progresso, texto: r.texto }
        agendar(ctx, () => seguir(ctx), 1000)
      } else if (r.estado === 'pronto' && r.resultado) {
        e.resultado = r.resultado
        // um cálculo seguido por um 409: o pedido é o do resultado
        if (!e.ultimoPedido && r.resultado.destino?.id) e.ultimoPedido = { destino: r.resultado.destino.id, tripulacao: r.resultado.tripulacao || 'so', sairAgora: !!r.resultado.sairAgora }
        e.idCalculo = id
        // o plano que os contactos em terra têm (revisão final I1)
        e.envioEmTerra = r.envioEmTerra && typeof r.envioEmTerra === 'object' ? r.envioEmTerra : null
        e.selecionada = 0
        e.plano = null
        e.vista = 'resultado'
      } else {
        e.vista = 'erro'
        e.erro = r.erro || 'o cálculo falhou sem explicação'
      }
    })
    .catch(err => {
      if (e.calculo?.id !== id) return
      e.vista = 'erro'
      e.erro = motivoPlugin(err, { se404: CALCULO_PERDIDO })
    })
    .finally(() => ctx.refrescar())
}

// "39,37", "39.37 N", "9,34 W" → graus (W e S negativos); null se não for um número.
export function lerCoordenada (texto, max) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*([NSEWO])?\s*$/i.exec(String(texto ?? ''))
  if (!m) return null
  let v = Number(m[1].replace(',', '.'))
  if (/[SWO]/i.test(m[2] || '')) v = -Math.abs(v)
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null
}

// o valor de um campo: o dos dados (testes), o do estado (o que se escreveu), ou o do DOM
const campo = (e, dados, id) => dados?.[id] ?? e.form?.[id] ?? globalThis.document?.getElementById?.(id)?.value ?? ''
const entrada = (e, id, placeholder) => `<input type="text" id="${id}" data-campo="${id}" value="${esc(e.form?.[id] ?? '')}" placeholder="${placeholder}">`

function listaDestinos (ctx) {
  const e = ctx.estado
  const pos = posicaoGps(ctx)
  const itens = []
  const ativa = rotaAtiva(ctx)
  if (ativa) itens.push({ id: 'rota-ativa', nome: ativa.nome, detalhe: ativa.detalhe })
  const portos = (e.destinos || []).map(d => {
    const p = onde(d)
    return { id: d.id, nome: d.nome, meu: !!d.meu, mn: pos && p ? milhas(pos, p) : null }
  })
  if (pos) portos.sort((a, b) => (a.mn ?? Infinity) - (b.mn ?? Infinity))
  // o porto onde estás (a menos de 0,5 MN) fica na lista, "estás aqui", mas não é destino
  for (const d of portos) itens.push({ id: d.id, nome: d.nome, detalhe: d.mn == null ? '' : d.mn < 0.5 ? 'estás aqui' : `${num(d.mn, d.mn < 10 ? 1 : 0)} MN`, meu: d.meu, aqui: d.mn != null && d.mn < 0.5 })
  return itens
}
const linhaDestino = (e, d) => {
  const celulas = `<td>${esc(d.nome)}${d.meu ? ' <span class="lab">(meu)</span>' : ''}</td><td class="lab">${esc(d.detalhe)}</td>`
  if (d.aqui) return `<tr class="desativado">${celulas}</tr>`
  return `<tr class="${e.escolhido === d.id ? 'sel' : ''}" data-acao="rota-destino" data-id="${esc(d.id)}">${celulas}</tr>`
}

function acrescentarHtml (e) {
  if (!e.acrescentar) return '<button class="acao" data-acao="rota-acrescentar">+ acrescentar</button>'
  const msg = e.msgDestino ? `<div class="perigo">${esc(e.msgDestino)}</div>` : ''
  const conhecido = `<button class="acao${e.acrConhecido ? ' go' : ''}" data-acao="rota-acr-conhecido">${e.acrConhecido ? '☑' : '☐'} conheço este sítio</button>`
  if (e.acrescentar === 'menu') {
    return `<div class="tile"><div class="lab">Acrescentar um destino</div><div class="acoes">
<button class="acao" data-acao="rota-acr-aqui">Aqui (posição atual)</button><button class="acao" data-acao="rota-acr-coord">Por coordenadas</button><button class="acao" data-acao="rota-acr-cancelar">Cancelar</button></div></div>`
  }
  const coords = e.acrescentar === 'coordenadas'
    ? `<div class="linha">${entrada(e, 'rota-lat', 'latitude, ex.: 39,37')}${entrada(e, 'rota-lon', 'longitude, ex.: 9,34 W')}</div>`
    : '<div class="lab">Fica com a posição atual do GPS.</div>'
  return `<div class="tile"><div class="lab">${e.acrescentar === 'coordenadas' ? 'Destino por coordenadas' : 'Destino aqui'}</div>
${entrada(e, 'rota-nome', 'nome (1 a 40 letras)')}${coords}${msg}
<div class="acoes">${conhecido}<button class="acao go" data-acao="rota-acr-gravar">Gravar</button><button class="acao" data-acao="rota-acr-cancelar">Cancelar</button></div></div>`
}

export default {
  render (ctx) {
    buscarDestinos(ctx)
    const e = ctx.estado
    const pos = posicaoGps(ctx)
    const trip = e.tripulacao || 'so'
    const lista = listaDestinos(ctx)
    const linhas = lista.map(d => linhaDestino(e, d)).join('')
    const vazio = e.destinosErro ? '' : e.destinos ? '<div class="lab">Sem destinos.</div>' : '<div class="lab">A ler os destinos…</div>'
    const erro = e.destinosErro ? `<div class="tile caixa-erro">${esc(e.destinosErro)}</div>` : ''
    const semGps = pos ? '' : '<div class="tile caixa-erro">sem GPS: não dá para calcular</div>'
    const escolhido = lista.find(d => d.id === e.escolhido && !d.aqui)
    const podeCalcular = pos && escolhido
    // "Novo cálculo" com uma rota ativa ou um plano aberto: o caminho de volta ao rumo
    const voltarLeme = botaoVoltarLeme(ctx)
    return `<div class="col" style="flex:1.4;">
${erro}
<div class="tile rolar" data-rolar="pedir-destinos" style="flex:1;"><div class="lab">Para onde?</div>${linhas ? `<table class="grande">${linhas}</table>` : vazio}</div>
${acrescentarHtml(e)}
</div>
<div class="col" style="flex:1;">
${semGps}
<div class="tile"><div class="lab">Tripulação</div><div class="acoes">
<button class="acao${trip === 'so' ? ' go' : ''}" data-acao="rota-tripulacao" data-t="so">Só eu</button>
<button class="acao${trip === 'acompanhado' ? ' go' : ''}" data-acao="rota-tripulacao" data-t="acompanhado">2 ou mais</button></div></div>
<div class="tile"><div class="lab">Destino</div><div class="v">${escolhido ? esc(escolhido.nome) : '—'}</div></div>
${e.msg ? `<div class="tile ${e.msgErro ? 'perigo' : ''}">${esc(e.msg)}</div>` : ''}
<button class="acao go grande" data-acao="rota-calcular"${podeCalcular ? '' : ' disabled'}>Calcular</button>
${voltarLeme}
<div class="tile lab">Calcula as 3 melhores alternativas (partidas nas próximas 48 h, 3/5/8 MN da costa, vela ou motor) com a previsão, a maré e a AI do barco.</div>
</div>`
  },

  async acao (nome, dados, ctx) {
    const e = ctx.estado
    if (nome === 'rota-destino') { e.escolhido = dados.id; e.msg = null; return }
    if (nome === 'campo') { e.form = { ...e.form, [dados.campo]: String(dados.valor ?? '') }; return }
    if (nome === 'rota-voltar-leme') { e.novo = false; return }
    if (nome === 'rota-tripulacao') { e.tripulacao = dados.t === 'acompanhado' ? 'acompanhado' : 'so'; return }
    if (nome === 'rota-calcular') {
      if (!posicaoGps(ctx)) { e.msg = 'sem GPS: não dá para calcular'; e.msgErro = true; return }
      if (!e.escolhido || listaDestinos(ctx).some(d => d.id === e.escolhido && d.aqui)) { e.msg = 'Escolhe o destino.'; e.msgErro = true; return }
      return calcular(ctx, { destino: e.escolhido, tripulacao: e.tripulacao || 'so', sairAgora: false })
    }
    if (nome === 'rota-acrescentar') { e.acrescentar = 'menu'; e.msgDestino = null; return }
    if (nome === 'rota-acr-aqui') { e.acrescentar = 'aqui'; e.msgDestino = null; return }
    if (nome === 'rota-acr-coord') { e.acrescentar = 'coordenadas'; e.msgDestino = null; return }
    if (nome === 'rota-acr-cancelar') { e.acrescentar = null; e.msgDestino = null; e.form = {}; e.acrConhecido = false; return }
    if (nome === 'rota-acr-conhecido') { e.acrConhecido = !e.acrConhecido; return }
    if (nome === 'rota-acr-gravar' || (nome === 'enter' && e.acrescentar && e.acrescentar !== 'menu')) {
      const nomeDestino = String(campo(e, dados, 'rota-nome')).trim()
      if (!nomeDestino || nomeDestino.length > 40) { e.msgDestino = 'o nome tem de ter 1 a 40 letras'; return }
      const corpo = { nome: nomeDestino }
      if (e.acrescentar === 'coordenadas') {
        const lat = lerCoordenada(campo(e, dados, 'rota-lat'), 90)
        const lon = lerCoordenada(campo(e, dados, 'rota-lon'), 180)
        if (lat == null || lon == null) { e.msgDestino = 'coordenadas inválidas: escreve, por exemplo, 39,37 e 9,34 W'; return }
        corpo.lat = lat; corpo.lon = lon
      } else corpo.posicaoAtual = true
      corpo.conhecido = !!e.acrConhecido
      try {
        const r = await ctx.pedir(`${URL_ROTA}/destinos`, { method: 'POST', body: corpo })
        e.destinos = [...(e.destinos || []).filter(d => d.id !== r.destino.id), r.destino]
        e.escolhido = r.destino.id
        e.acrescentar = null
        e.msgDestino = null
        e.acrConhecido = false
        e.form = {}
      } catch (err) { e.msgDestino = motivoAcao(err) }
    }
  }
}
