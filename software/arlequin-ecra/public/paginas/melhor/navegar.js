// Melhor rota a navegar (desenho 3b-2): o plano ativo no Leme. O plugin da rota segue a viagem
// (GET /plano-ativo, lido de 10 em 10 s); aqui só se mostra e se pede:
//   a faixa por cima do rumo: "próximo: rizar às 22:50 (daqui a 25 min) · +20 min sobre o plano",
//     "chegada ~amanhã 07:58 (plano 07:38)", "recursos: gasóleo à chegada ~34 L" (quando há aviso) ou
//     "recursos: sem leitura", "sem GPS: acompanhamento parado", "barómetro: sem leitura"; antes de
//     sair, "plano ativo · à espera de sair";
//   Recalcular (um cálculo novo de onde estás para o mesmo destino e tripulação: o Resultado da 3b-1,
//     onde Ativar substitui o plano) e Terminar (com confirmação);
//   a rota mudada (pausado): "a rota ativa já não é a do plano: terminar o plano?" com Terminar e
//     Continuar (o plugin volta a ativar a rota do plano).
// Nunca mostra null, NaN nem undefined: o que falta fica de fora.

import { esc, horaLisboa, quandoAs } from '../../lib/rota-texto.js'
import { URL_ROTA, calcular, motivoAcao } from './pedir.js'

const LER_MS = 10000
const ABERTOS = new Set(['a espera de sair', 'a navegar', 'pausado'])
const CONFIRMAR = "Terminar o plano? Os contactos em terra recebem 'viagem terminada, estou bem'"
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
const ok = (x) => typeof x === 'number' && Number.isFinite(x)

// O plano ativo do plugin (null sem plano: 404); de 10 em 10 s, ou já (forcar).
export function buscarPlanoAtivo (ctx, forcar = false) {
  const e = ctx.estado
  const t = agora(ctx)
  if (e.aLerPlano || (!forcar && e.planoAtivoEm != null && t - e.planoAtivoEm < LER_MS)) return
  e.aLerPlano = true
  e.planoAtivoEm = t
  return ctx.pedir(`${URL_ROTA}/plano-ativo`)
    .then(r => { e.planoAtivo = r && typeof r === 'object' ? r : null })
    .catch(err => { if (err?.status === 404) e.planoAtivo = null })
    .finally(() => { e.aLerPlano = false; ctx.refrescar() })
}

export const planoAberto = (ctx) => (ABERTOS.has(ctx.estado.planoAtivo?.estado) ? ctx.estado.planoAtivo : null)
export const pausado = (ctx) => planoAberto(ctx)?.estado === 'pausado'

// "25 min", "1 h 35 min", "2 h"
function contagem (min) {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}
function atrasoTexto (a) {
  if (!ok(a)) return ''
  if (a === 0) return 'no horário do plano'
  return `${a > 0 ? '+' : '−'}${Math.abs(a)} min sobre o plano`
}

function linhasFaixa (ctx, p) {
  const t = agora(ctx)
  const linhas = []
  if (p.estado === 'a espera de sair') linhas.push('plano ativo · à espera de sair')
  else {
    const partes = []
    const hora = Date.parse(p.proximo?.hora)
    if (p.proximo?.texto && ok(hora)) partes.push(`próximo: ${esc(p.proximo.texto)} ${quandoAs(hora, t)} (daqui a ${contagem((hora - t) / 60000)})`)
    const a = atrasoTexto(p.atrasoMin)
    if (a) partes.push(a)
    if (partes.length) linhas.push(partes.join(' · '))
  }
  const ch = Date.parse(p.chegadaAgora)
  if (ok(ch)) {
    const plano = Date.parse(p.chegadaPlano)
    linhas.push(`chegada ~${horaLisboa(ch, t)}${ok(plano) && plano !== ch ? ` (plano ${horaLisboa(plano, ch)})` : ''}${p.chegadaNoite === true ? ' · de noite' : ''}`)
  }
  const r = p.recursos || {}
  if (r.aviso) linhas.push(`<span class="atencao">recursos: ${esc(String(r.aviso).replace(/^Recursos:\s*/, ''))}</span>`)
  else if (r.semLeitura) linhas.push('<span class="lab">recursos: sem leitura</span>')
  if (p.semGps) linhas.push('<span class="perigo">sem GPS: acompanhamento parado</span>')
  if (p.barometro?.semLeitura) linhas.push('<span class="lab">barómetro: sem leitura</span>')
  return linhas
}

function confirmacao (e) {
  if (!e.confirmarTerminar) return ''
  return `<div class="tile atencao plano-confirmar"><div class="v">${esc(CONFIRMAR)}</div>
<div class="acoes"><button class="acao stop" data-acao="rota-terminar-sim">Sim, terminar</button><button class="acao" data-acao="rota-terminar-nao">Não</button></div></div>`
}

// O que o Leme mostra do plano: '' sem plano aberto.
export function render (ctx) {
  const e = ctx.estado
  const p = planoAberto(ctx)
  const msg = e.msgPlano ? `<div class="tile ${e.msgPlanoErro ? 'perigo' : ''}">${esc(e.msgPlano)}</div>` : ''
  if (!p) return msg
  if (p.estado === 'pausado') {
    return `<div class="tile caixa-erro plano-pausado">a rota ativa já não é a do plano: terminar o plano?
<div class="acoes"><button class="acao stop" data-acao="rota-terminar">Terminar</button><button class="acao go" data-acao="rota-continuar">Continuar</button></div></div>
${confirmacao(e)}${msg}`
  }
  return `<div class="tile plano-faixa">${linhasFaixa(ctx, p).map(l => `<div>${l}</div>`).join('')}
<div class="acoes"><button class="acao" data-acao="rota-recalcular">Recalcular</button><button class="acao stop" data-acao="rota-terminar">Terminar</button></div></div>
${confirmacao(e)}${msg}`
}

// As ações do plano ativo: true se a tratou.
export async function acao (nome, dados, ctx) {
  const e = ctx.estado
  if (nome === 'rota-terminar') { e.confirmarTerminar = true; e.msgPlano = null; return true }
  if (nome === 'rota-terminar-nao') { e.confirmarTerminar = false; return true }
  if (nome === 'rota-terminar-sim') {
    e.confirmarTerminar = false
    try {
      const r = await ctx.pedir(`${URL_ROTA}/plano-ativo/terminar`, { method: 'POST' })
      e.msgPlano = r?.contactos ? "Plano terminado: os contactos em terra recebem 'viagem terminada, estou bem'." : 'Plano terminado.'
      e.msgPlanoErro = false
    } catch (err) { e.msgPlano = motivoAcao(err); e.msgPlanoErro = true }
    await buscarPlanoAtivo(ctx, true)
    return true
  }
  if (nome === 'rota-continuar') {
    try {
      await ctx.pedir(`${URL_ROTA}/plano-ativo/continuar`, { method: 'POST' })
      e.msgPlano = null
    } catch (err) { e.msgPlano = motivoAcao(err); e.msgPlanoErro = true }
    await buscarPlanoAtivo(ctx, true)
    return true
  }
  if (nome === 'rota-recalcular') {
    const p = planoAberto(ctx)
    if (!p) return true
    const d = p.destino || {}
    const destino = d.id ? d.id : ok(d.lat) && ok(d.lon) ? { lat: d.lat, lon: d.lon, nome: d.nome || 'Destino' } : null
    if (!destino) { e.msgPlano = 'não sei o destino deste plano: faz um novo cálculo'; e.msgPlanoErro = true; return true }
    // sai do Leme (como "Novo cálculo"): o Resultado, onde Ativar substitui o plano
    Object.assign(e, { novo: true, ativada: false, erro: null, msg: null, plano: null })
    await calcular(ctx, { destino, tripulacao: p.tripulacao === 'acompanhado' ? 'acompanhado' : 'so', sairAgora: false })
    return true
  }
  return false
}
