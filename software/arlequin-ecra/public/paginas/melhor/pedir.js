// Melhor rota, estado Pedir (desenho 3b-1): a lista de destinos (a rota ativa do OpenCPN no topo,
// depois os portos do mais perto para o mais longe), "+ acrescentar" (aqui ou por coordenadas),
// só eu / 2 ou mais, e Calcular. Também o arranque do cálculo e o seguimento (A calcular), que o
// Resultado usa para "Sair agora mesmo assim".

import { esc, num } from '../../lib/rota-texto.js'
import { proximoWp } from '../comum.js'

export const URL_ROTA = '/plugins/signalk-arlequin-rota'
export const PLUGIN_DESLIGADO = 'o plugin da rota não responde'
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

// O erro de um pedido ao plugin da rota em pt-PT: o motivo do plugin, ou "não responde".
export function motivoPlugin (err) {
  if (!err?.status || err.status === 404) return PLUGIN_DESLIGADO
  if (err.status === 503) return `${PLUGIN_DESLIGADO} (${err.message})`
  return err.message || PLUGIN_DESLIGADO
}

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

// Pede o cálculo e segue-o. pedido: { destino, tripulacao, sairAgora }.
export async function calcular (ctx, pedido) {
  const e = ctx.estado
  e.ultimoPedido = pedido
  e.erro = null
  e.msg = null
  let id
  try {
    id = (await ctx.pedir(`${URL_ROTA}/calcular`, { method: 'POST', body: pedido })).id
  } catch (err) {
    // já há um a correr: segue esse
    if (err.status === 409 && err.corpo?.id) id = err.corpo.id
    else { e.vista = 'erro'; e.erro = motivoPlugin(err); return }
  }
  e.calculo = { id, progresso: 0, texto: 'a começar', destino: pedido.destino }
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
        e.idCalculo = id
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
      e.erro = motivoPlugin(err)
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

const campo = (dados, id) => dados?.[id] ?? globalThis.document?.getElementById?.(id)?.value ?? ''

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
  for (const d of portos) itens.push({ id: d.id, nome: d.nome, detalhe: d.mn == null ? '' : d.mn < 0.5 ? 'estás aqui' : `${num(d.mn, d.mn < 10 ? 1 : 0)} MN`, meu: d.meu })
  return itens
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
    ? '<div class="linha"><input type="text" id="rota-lat" placeholder="latitude, ex.: 39,37"><input type="text" id="rota-lon" placeholder="longitude, ex.: 9,34 W"></div>'
    : '<div class="lab">Fica com a posição atual do GPS.</div>'
  return `<div class="tile"><div class="lab">${e.acrescentar === 'coordenadas' ? 'Destino por coordenadas' : 'Destino aqui'}</div>
<input type="text" id="rota-nome" placeholder="nome (1 a 40 letras)">${coords}${msg}
<div class="acoes">${conhecido}<button class="acao go" data-acao="rota-acr-gravar">Gravar</button><button class="acao" data-acao="rota-acr-cancelar">Cancelar</button></div></div>`
}

export default {
  render (ctx) {
    buscarDestinos(ctx)
    const e = ctx.estado
    const pos = posicaoGps(ctx)
    const trip = e.tripulacao || 'so'
    const lista = listaDestinos(ctx)
    const linhas = lista.map(d => `<tr class="${e.escolhido === d.id ? 'sel' : ''}" data-acao="rota-destino" data-id="${esc(d.id)}"><td>${esc(d.nome)}${d.meu ? ' <span class="lab">(meu)</span>' : ''}</td><td class="lab">${esc(d.detalhe)}</td></tr>`).join('')
    const vazio = e.destinosErro ? '' : e.destinos ? '<div class="lab">Sem destinos.</div>' : '<div class="lab">A ler os destinos…</div>'
    const erro = e.destinosErro ? `<div class="tile caixa-erro">${esc(e.destinosErro)}</div>` : ''
    const semGps = pos ? '' : '<div class="tile caixa-erro">sem GPS: não dá para calcular</div>'
    const escolhido = lista.find(d => d.id === e.escolhido)
    const podeCalcular = pos && escolhido
    return `<div class="col" style="flex:1.4;">
${erro}
<div class="tile rolar" style="flex:1;"><div class="lab">Para onde?</div>${linhas ? `<table class="grande">${linhas}</table>` : vazio}</div>
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
<div class="tile lab">Calcula as 3 melhores alternativas (partidas nas próximas 48 h, 3/5/8 MN da costa, vela ou motor) com a previsão, a maré e a AI do barco.</div>
</div>`
  },

  async acao (nome, dados, ctx) {
    const e = ctx.estado
    if (nome === 'rota-destino') { e.escolhido = dados.id; e.msg = null; return }
    if (nome === 'rota-tripulacao') { e.tripulacao = dados.t === 'acompanhado' ? 'acompanhado' : 'so'; return }
    if (nome === 'rota-calcular') {
      if (!posicaoGps(ctx)) { e.msg = 'sem GPS: não dá para calcular'; e.msgErro = true; return }
      if (!e.escolhido) { e.msg = 'Escolhe o destino.'; e.msgErro = true; return }
      return calcular(ctx, { destino: e.escolhido, tripulacao: e.tripulacao || 'so', sairAgora: false })
    }
    if (nome === 'rota-acrescentar') { e.acrescentar = 'menu'; e.msgDestino = null; return }
    if (nome === 'rota-acr-aqui') { e.acrescentar = 'aqui'; e.msgDestino = null; return }
    if (nome === 'rota-acr-coord') { e.acrescentar = 'coordenadas'; e.msgDestino = null; return }
    if (nome === 'rota-acr-cancelar') { e.acrescentar = null; e.msgDestino = null; return }
    if (nome === 'rota-acr-conhecido') { e.acrConhecido = !e.acrConhecido; return }
    if (nome === 'rota-acr-gravar' || (nome === 'enter' && e.acrescentar && e.acrescentar !== 'menu')) {
      const nomeDestino = String(campo(dados, 'rota-nome')).trim()
      if (!nomeDestino || nomeDestino.length > 40) { e.msgDestino = 'o nome tem de ter 1 a 40 letras'; return }
      const corpo = { nome: nomeDestino }
      if (e.acrescentar === 'coordenadas') {
        const lat = lerCoordenada(campo(dados, 'rota-lat'), 90)
        const lon = lerCoordenada(campo(dados, 'rota-lon'), 180)
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
      } catch (err) { e.msgDestino = err?.status ? err.message : PLUGIN_DESLIGADO }
    }
  }
}
