// Melhor rota a navegar (desenho 3b-2): o plano ativo no Leme. O plugin da rota segue a viagem
// (GET /plano-ativo, lido de 10 em 10 s); aqui só se mostra e se pede:
//   a faixa por cima do rumo: "próximo: rizar às 22:50 (daqui a 25 min) · +20 min sobre o plano",
//     "chegada ~amanhã 07:58 (plano 07:38)", "recursos: gasóleo à chegada ~34 L" (quando há aviso) ou
//     "recursos: sem leitura", "sem GPS: acompanhamento parado", "barómetro: sem leitura"; antes de
//     sair, "plano ativo · à espera de sair";
//   Recalcular (um cálculo novo de onde estás para o mesmo destino e tripulação: o Resultado da 3b-1,
//     onde Ativar substitui o plano; a navegar ou em pausa no mar só a partida imediata, sairAgora:
//     true, e o plugin mantém o "Volta ou abriga-te em X" — decisão do Ivo de 01/10; à espera de sair,
//     todas as partidas) e Terminar (com confirmação);
//   a rota mudada (pausado): "a rota ativa já não é a do plano: terminar o plano?" com Terminar,
//     Continuar (o plugin volta a ativar a rota do plano) e Recalcular; parado noutro porto
//     (chegadaOutro, decisão do Ivo de 01/10): "Chegaste a X? Enviar 'cheguei bem a X'" com o botão
//     (POST /plano-ativo/chegada; só envia com o toque);
//   a pergunta do Terminar e as mensagens do plano ficam ligadas ao plano (idCalculo, indice,
//     ativadoEm): saem quando o plano muda ou fecha, nunca aparecem sobre o plano seguinte;
//   um erro da leitura que não seja 404: "sem ligação ao plugin da rota: os dados podem estar velhos".
// As horas ("daqui a X min", "amanhã") contam-se com a hora do plugin (o agora do GET, mais o tempo
// desde a leitura): no barco é o mesmo relógio; na viagem acelerada do dev, o simulado.
// Nunca mostra null, NaN nem undefined: o que falta fica de fora.

import { esc, horaLisboa, quandoAs } from '../../lib/rota-texto.js'
import { URL_ROTA, calcular, motivoAcao } from './pedir.js'

const LER_MS = 10000
const ABERTOS = new Set(['a espera de sair', 'a navegar', 'pausado'])
const CONFIRMAR = "Terminar o plano? Os contactos em terra recebem 'viagem terminada, estou bem'"
const SEM_LIGACAO = 'sem ligação ao plugin da rota: os dados podem estar velhos'
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
const ok = (x) => typeof x === 'number' && Number.isFinite(x)
// o plano a que a pergunta do Terminar e as mensagens se referem
const chave = (p) => (p ? `${p.idCalculo ?? ''}|${p.indice ?? ''}|${p.ativadoEm ?? ''}` : null)
const aberto = (p) => (ABERTOS.has(p?.estado) ? p : null)

// Com o plano lido: a pergunta e a mensagem de outro plano saem (o plano mudou ou fechou).
function acertar (e) {
  const p = aberto(e.planoAtivo)
  if (e.confirmarTerminar && e.confirmarTerminar !== chave(p)) e.confirmarTerminar = null
  if (e.msgPlano && p && e.msgPlanoDe !== chave(p)) { e.msgPlano = null; e.msgPlanoErro = false }
}

// O plano ativo do plugin (null sem plano: 404); de 10 em 10 s, ou já (forcar). Um forçado com uma
// leitura a meio (pedida antes do POST) espera por ela, não a conta e lê outra vez.
export function buscarPlanoAtivo (ctx, forcar = false) {
  const e = ctx.estado
  const t = agora(ctx)
  if (e.aLerPlano) {
    if (!forcar) return
    e.lerDeNovo = true
    return e.aLerPlano.then(() => buscarPlanoAtivo(ctx, true))
  }
  if (!forcar && e.planoAtivoEm != null && t - e.planoAtivoEm < LER_MS) return
  e.planoAtivoEm = t
  e.lerDeNovo = false
  const leitura = ctx.pedir(`${URL_ROTA}/plano-ativo`)
    .then(r => {
      if (e.lerDeNovo) return
      e.planoAtivo = r && typeof r === 'object' ? r : null
      e.planoAtivoLidoEm = t
      e.semLigacao = false
      acertar(e)
    })
    .catch(err => {
      if (e.lerDeNovo) return
      // 404: não há plano; outro erro (o plugin a reiniciar, a rede): fica o plano lido, com o aviso
      if (err?.status === 404) { e.planoAtivo = null; e.semLigacao = false; acertar(e) } else e.semLigacao = true
    })
    .finally(() => { e.aLerPlano = null; ctx.refrescar() })
  e.aLerPlano = leitura
  return leitura
}

export const planoAberto = (ctx) => aberto(ctx.estado.planoAtivo)
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

// a hora do plugin agora (sem ela, a do ecrã)
function horaPlugin (ctx, p) {
  const base = Date.parse(p.agora)
  const lido = ctx.estado.planoAtivoLidoEm
  return ok(base) && ok(lido) ? base + (agora(ctx) - lido) : agora(ctx)
}

function linhasFaixa (ctx, p) {
  const t = horaPlugin(ctx, p)
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

// a pergunta do Terminar: só a deste plano
function confirmacao (e, p) {
  if (!e.confirmarTerminar || e.confirmarTerminar !== chave(p)) return ''
  return `<div class="tile atencao plano-confirmar"><div class="v">${esc(CONFIRMAR)}</div>
<div class="acoes"><button class="acao stop" data-acao="rota-terminar-sim">Sim, terminar</button><button class="acao" data-acao="rota-terminar-nao">Não</button></div></div>`
}
// em pausa, parado noutro porto (decisão 5): a pergunta, e só envia com o toque
function chegadaOutro (p) {
  const nome = p.chegadaOutro?.nome
  if (!p.chegadaOutro?.id || !nome) return ''
  return `<div class="tile atencao plano-chegada"><div class="v">Chegaste a ${esc(nome)}? Enviar 'cheguei bem a ${esc(nome)}'</div>
<div class="acoes"><button class="acao go" data-acao="rota-chegada">Enviar</button></div></div>`
}

// O que o Leme mostra do plano: '' sem plano aberto.
export function render (ctx) {
  const e = ctx.estado
  const p = planoAberto(ctx)
  // a mensagem de um plano: com ele aberto, ou já sem plano aberto (o "Plano terminado"); nunca sobre outro
  const msg = e.msgPlano && (!p || e.msgPlanoDe === chave(p)) ? `<div class="tile ${e.msgPlanoErro ? 'perigo' : ''}">${esc(e.msgPlano)}</div>` : ''
  if (!p) return msg
  const semLigacao = e.semLigacao ? `<div class="perigo">${esc(SEM_LIGACAO)}</div>` : ''
  if (p.estado === 'pausado') {
    return `<div class="tile caixa-erro plano-pausado">a rota ativa já não é a do plano: terminar o plano?${semLigacao}
<div class="acoes"><button class="acao stop" data-acao="rota-terminar">Terminar</button><button class="acao go" data-acao="rota-continuar">Continuar</button><button class="acao" data-acao="rota-recalcular">Recalcular</button></div></div>
${chegadaOutro(p)}${confirmacao(e, p)}${msg}`
  }
  return `<div class="tile plano-faixa">${linhasFaixa(ctx, p).map(l => `<div>${l}</div>`).join('')}${semLigacao}
<div class="acoes"><button class="acao" data-acao="rota-recalcular">Recalcular</button><button class="acao stop" data-acao="rota-terminar">Terminar</button></div></div>
${confirmacao(e, p)}${msg}`
}

// As ações do plano ativo: true se a tratou.
export async function acao (nome, dados, ctx) {
  const e = ctx.estado
  const mensagem = (texto, erro, p) => { e.msgPlano = texto; e.msgPlanoErro = erro; e.msgPlanoDe = chave(p) }
  if (nome === 'rota-terminar') {
    const p = planoAberto(ctx)
    if (!p) return true
    e.confirmarTerminar = chave(p)
    e.msgPlano = null
    return true
  }
  if (nome === 'rota-terminar-nao') { e.confirmarTerminar = null; return true }
  if (nome === 'rota-terminar-sim') {
    const p = planoAberto(ctx)
    const pedida = e.confirmarTerminar
    e.confirmarTerminar = null
    // só o plano a que a pergunta se refere (um toque atrasado nunca termina o plano seguinte)
    if (!p || !pedida || pedida !== chave(p)) return true
    try {
      const r = await ctx.pedir(`${URL_ROTA}/plano-ativo/terminar`, { method: 'POST' })
      mensagem(r?.contactos ? "Plano terminado: os contactos em terra recebem 'viagem terminada, estou bem'." : 'Plano terminado.', false, p)
    } catch (err) { mensagem(motivoAcao(err), true, p) }
    await buscarPlanoAtivo(ctx, true)
    return true
  }
  if (nome === 'rota-continuar') {
    const p = planoAberto(ctx)
    e.confirmarTerminar = null
    try {
      await ctx.pedir(`${URL_ROTA}/plano-ativo/continuar`, { method: 'POST' })
      e.msgPlano = null
    } catch (err) { mensagem(motivoAcao(err), true, p) }
    await buscarPlanoAtivo(ctx, true)
    return true
  }
  if (nome === 'rota-chegada') {
    const p = planoAberto(ctx)
    const outro = p?.chegadaOutro
    if (!outro?.id) return true
    e.confirmarTerminar = null
    try {
      const r = await ctx.pedir(`${URL_ROTA}/plano-ativo/chegada`, { method: 'POST', body: { destino: outro.id } })
      mensagem(r?.contactos ? `Enviado aos contactos em terra: 'cheguei bem a ${outro.nome}'.` : `Plano fechado: chegaste a ${outro.nome}.`, false, p)
    } catch (err) { mensagem(motivoAcao(err), true, p) }
    await buscarPlanoAtivo(ctx, true)
    return true
  }
  if (nome === 'rota-recalcular') {
    const p = planoAberto(ctx)
    if (!p) return true
    e.confirmarTerminar = null
    const d = p.destino || {}
    const destino = d.id ? d.id : ok(d.lat) && ok(d.lon) ? { lat: d.lat, lon: d.lon, nome: d.nome || 'Destino' } : null
    if (!destino) { mensagem('não sei o destino deste plano: faz um novo cálculo', true, p); return true }
    // a navegar ou em pausa no mar (decisão do Ivo de 01/10): só a partida imediata, com o "Volta ou
    // abriga-te"; à espera de sair, todas as partidas
    const noMar = p.estado === 'a navegar' || (p.estado === 'pausado' && p.pausadoDe === 'a navegar')
    // sai do Leme (como "Novo cálculo"): o Resultado, onde Ativar substitui o plano
    Object.assign(e, { novo: true, ativada: false, erro: null, msg: null, plano: null })
    await calcular(ctx, { destino, tripulacao: p.tripulacao === 'acompanhado' ? 'acompanhado' : 'so', sairAgora: noMar })
    return true
  }
  return false
}
