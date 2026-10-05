// Melhor rota, estados A calcular, Resultado e Erro (desenho 3b-1).
//   A calcular: o progresso, e "Cancelar" (deixa de seguir; o plugin continua a calcular).
//   Resultado: a faixa do veredicto (cor do tipo) com as frases de porquê, a linha da previsão,
//   os 3 cartões (a recomendada destacada), os avisos vermelhos (sempre visíveis: no cimo da coluna da
//   direita), a linha do tempo, as precauções com caixas (guardadas por cálculo), os pontos de desistência,
//   e os botões Mapa / Enviar plano / Ativar esta rota / Sair agora mesmo assim / Novo cálculo, fixos por
//   baixo da parte que rola (revisão F3, Important 2). O "Sair agora mesmo
//   assim" sai depois de um pedido já com sairAgora (revisão final M2: repetia o mesmo cálculo). Com os
//   contactos em terra a ter o plano de outra alternativa ou de outro cálculo (envioEmTerra do GET
//   /resultado, revisão final I1): "os contactos em terra têm o plano da N.ª alternativa (alarme HH:MM): ao
//   Ativar, segue o novo".
//   Nunca mostra null, NaN nem undefined: o que falta é "—".

import { esc, num, horaLisboa, margem, nomeAlternativa, corVeredicto, avisosVermelhos, avisosGerais, linhaPrevisao } from '../../lib/rota-texto.js'
import { barra } from '../../lib/desenho.js'
import { URL_ROTA, calcular, motivoAcao, CANCELADO, botaoVoltarLeme } from './pedir.js'

const CHAVE_MARCAS = 'arlequin.precaucoes'
const MAX_CALCULOS_MARCAS = 10
const PLANO_PERDIDO = 'este envio já não existe no plugin da rota (reiniciado?): confirma com os contactos se receberam'
const SO_O_TEU_CHAT = 'enviado só para o teu chat — nenhum contacto em terra recebeu (junta contactos do plano na configuração)'
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
const agendar = (ctx, f, ms) => (ctx.agendar || setTimeout)(f, ms)

// ---------- marcas das precauções (por id de cálculo; no ecrã e no localStorage) ----------
// O guardado pode vir estragado (outro valor, outra versão): só ficam os cálculos com um objeto.
function todasMarcas (ctx) {
  const e = ctx.estado
  if (!e.marcas) {
    const g = typeof ctx.guardado === 'function' ? ctx.guardado(CHAVE_MARCAS, {}) : null
    e.marcas = eObjeto(g) ? Object.fromEntries(Object.entries(g).filter(([, v]) => eObjeto(v))) : {}
  }
  return e.marcas
}
export function marcas (ctx) {
  const m = todasMarcas(ctx)
  return m[ctx.estado.idCalculo] || {}
}
function marcar (ctx, id, valor) {
  const m = todasMarcas(ctx)
  const k = ctx.estado.idCalculo
  const atual = { ...(m[k] || {}) }
  if (valor) atual[id] = true
  else delete atual[id]
  delete m[k]
  m[k] = atual // o mais recente no fim
  for (const velho of Object.keys(m).slice(0, Math.max(0, Object.keys(m).length - MAX_CALCULOS_MARCAS))) delete m[velho]
  if (typeof ctx.guardar === 'function') ctx.guardar(CHAVE_MARCAS, m)
}

// ---------- pedaços ----------
const h = (n, d = 1) => `${num(n, d)} h`
// o máximo do provável e, se arredondado for diferente, o do pessimista (auditoria M-38: o veredicto e os
// limites são os do pessimista; "rajada 31 (pior 34) nós")
const comPior = (provavel, pior, d = 0) => (num(pior, d) !== '—' && num(pior, d) !== num(provavel, d) ? `${num(provavel, d)} (pior ${num(pior, d)})` : num(provavel, d))

function cartao (ctx, alt, i, sel) {
  const ag = agora(ctx)
  const recomendada = !alt.naoRecomendada && !alt.excluida
  const etiqueta = recomendada ? (i === 0 ? '<span class="ok">recomendada</span>' : '<span class="ok">alternativa</span>') : '<span class="perigo">não recomendada</span>'
  const motivos = alt.motivos?.length ? `<div class="lab perigo">${alt.motivos.map(esc).join('; ')}</div>` : ''
  // os avisos da rota que não vão para os vermelhos (a previsão e o canal vão): o salto curto, a rota ativa…
  const avisosRota = (alt.avisosRota || []).filter(a => !/previs/i.test(a) && !(alt.canal && /por confirmar/.test(a))).map(a => `<div class="lab atencao">${esc(a)}</div>`).join('')
  const H = alt.horas || {}; const M = alt.maximos || {}; const P = alt.maximosPessimista || {}; const G = alt.gasoleoL || {}
  return `<div class="tile cartao${sel ? ' sel' : ''}${i === 0 ? ' primeira' : ''}" data-acao="rota-escolher" data-i="${i}">
<div class="linha"><span class="lab">${i + 1}.ª · ${etiqueta}</span><span class="lab">${num(alt.milhas, 1)} MN</span></div>
<div class="nome-alt">${esc(nomeAlternativa(alt))}</div>
<div class="v">${horaLisboa(alt.partida, ag)} → ${horaLisboa(alt.chegada?.p50, ag)}</div>
<div class="lab">chegada (cedo–tarde): ${margem(alt.chegada, ag)}${alt.chegadaNoite ? ' · <span class="atencao">de noite</span>' : ''}</div>
<div>vela ${h(H.vela)} · motor ${h(H.motor)} · noite ${h(H.noite)} · leme ${h(H.leme)}</div>
<div>vento ${comPior(M.vento, P.vento)} · rajada ${comPior(M.rajada, P.rajada)} nós · ondas ${comPior(M.ondas, P.ondas, 1)} m</div>
<div>gasóleo ${num(G.p50, 0)} L (pior ${num(G.p90, 0)} L) · ${alt.bateriaMin == null ? 'bateria desconhecida' : `bateria mín. ${num(alt.bateriaMin, 0)}%`}</div>
${motivos}${avisosRota}</div>`
}

function linhaTempo (ctx, alt) {
  const ag = agora(ctx)
  const itens = [...(alt.eventos || []).map(x => ({ ...x, aviso: false })), ...(alt.avisos || []).map(x => ({ ...x, aviso: true }))]
    .filter(x => x && x.texto)
    .sort((a, b) => (Date.parse(a.t) || 0) - (Date.parse(b.t) || 0))
  if (!itens.length) return '<div class="lab">—</div>'
  return `<table>${itens.map(x => `<tr${x.aviso ? ' class="atencao"' : ''}><td class="hora-col">${horaLisboa(x.t, ag)}</td><td>${x.aviso ? '⚠ ' : ''}${esc(x.texto)}</td></tr>`).join('')}</table>`
}

function precaucoes (ctx, alt) {
  const m = marcas(ctx)
  const lista = alt.precaucoes || []
  if (!lista.length) return '<div class="lab">—</div>'
  return lista.map(p => `<button class="caixa${m[p.id] ? ' marcada' : ''}" data-acao="rota-precaucao" data-id="${esc(p.id)}">${m[p.id] ? '☑' : '☐'} ${esc(p.texto)}${p.porque ? ` <span class="lab">(${esc(p.porque)})</span>` : ''}</button>`).join('')
}

function fuga (f) {
  if (!f) return '—'
  return `${esc(f.nome)} ${num(f.milhas, 1)} MN, vento ${esc(f.vento || '—')}${f.avisoVermelho ? ' <span class="perigo">⚠</span>' : ''}`
}

function desistencia (ctx, r, i) {
  if (i !== 0) return '<div class="lab">Os pontos de desistência foram calculados para a 1.ª alternativa (a recomendada): escolhe-a para os ver.</div>'
  const ag = agora(ctx)
  const linhas = (r.desistencia || []).map(p => `<tr><td class="hora-col">${horaLisboa(p.t, ag)}</td><td>${p.abrigo ? fuga(p.abrigo) : `<span class="perigo">${esc(p.semAbrigo || 'sem abrigo')}</span>`}</td><td>${p.voltar ? `voltar: ${fuga(p.voltar)}` : p.semVolta ? `<span class="perigo">${esc(p.semVolta)}</span>` : ''}</td></tr>`).join('')
  return `<div>${esc(r.desistenciaResumo || '—')}</div>${linhas ? `<table><tr><th>hora</th><th>abrigo</th><th>volta</th></tr>${linhas}</table>` : ''}`
}

// Os contactos em terra que receberam o plano (o porto separa-os do chat do Ivo; um porto antigo
// não os manda: nenhum).
const contactosEmTerra = (p) => (Array.isArray(p?.contactos) ? p.contactos : [])

// O estado do envio do plano, com os avisos do plugin da rota (ex.: sem o telefone do Ivo) e de que
// alternativa é (o Ivo pode escolher outro cartão a meio do envio).
function estadoPlano (e) {
  const p = e.plano
  if (!p) return ''
  const avisos = (Array.isArray(p.avisos) ? p.avisos : []).map(a => `<div class="lab atencao">⚠ ${esc(a)}</div>`).join('')
  const qual = Number.isInteger(p.indice) ? ` (plano da ${p.indice + 1}.ª alternativa)` : ''
  if (p.estado === 'a enviar') return `<div class="tile">a enviar o plano pelo Telegram…${qual}${avisos}</div>`
  if (p.estado === 'enviado') {
    const n = contactosEmTerra(p).length
    const falhas = p.falhas?.length ? `<div class="lab perigo">não chegou a: ${p.falhas.map(f => `${esc(f.nome)} (${esc(f.erro)})`).join('; ')}</div>` : ''
    // só ao chat do Ivo: ninguém em terra tem a hora de alarme
    if (!n) return `<div class="tile atencao">${SO_O_TEU_CHAT}${qual}${falhas}${avisos}</div>`
    return `<div class="tile ok">enviado ✓ a ${n} ${n === 1 ? 'contacto' : 'contactos'} em terra${qual}${falhas}${avisos}</div>`
  }
  return `<div class="tile perigo">não foi possível enviar: ${esc(p.motivo || p.erro || 'sem explicação')}${qual}${avisos}</div>`
}

// Os contactos em terra têm o plano de outra alternativa ou de outro cálculo (revisão final I1): ao Ativar
// esta, o plano novo segue para eles ("Este plano substitui o anterior").
function terraTemOutro (ctx, i) {
  const e = ctx.estado
  const u = e.envioEmTerra
  if (!u || !Array.isArray(u.contactos) || !u.contactos.length) return ''
  const mesmoCalculo = u.idCalculo === e.idCalculo
  if (mesmoCalculo && u.indice === i) return ''
  // o plano desta alternativa acabado de enviar neste ecrã: já o têm
  if (e.plano?.estado === 'enviado' && e.plano.indice === i && contactosEmTerra(e.plano).length) return ''
  const qual = mesmoCalculo && Number.isInteger(u.indice) ? `da ${u.indice + 1}.ª alternativa` : 'de um cálculo anterior'
  return `<div class="tile atencao">os contactos em terra têm o plano ${qual} (alarme ${horaLisboa(u.alarme, agora(ctx))}): ao Ativar, segue o novo</div>`
}

// ---------- o plano pelo Telegram ----------
function seguirPlano (ctx) {
  const e = ctx.estado
  const pedido = e.plano?.pedido
  if (!pedido) return
  return ctx.pedir(`${URL_ROTA}/plano-telegram/${encodeURIComponent(pedido)}`)
    .then(r => {
      if (e.plano?.pedido !== pedido) return
      e.plano = { ...e.plano, ...r }
      if (r.estado === 'a enviar') return agendar(ctx, () => seguirPlano(ctx), 1000)
      if (r.estado === 'enviado' && contactosEmTerra(r).length) {
        // o plano deixado em terra (com a hora de alarme): as precauções da alternativa enviada ficam
        // marcadas; só com pelo menos um contacto em terra (o chat do Ivo não conta)
        const alt = e.resultado?.alternativas?.[Number.isInteger(e.plano.indice) ? e.plano.indice : e.selecionada]
        for (const id of ['plano', 'plano-hora']) if (alt?.precaucoes?.some(p => p.id === id)) marcar(ctx, id, true)
      }
    })
    .catch(err => { if (e.plano?.pedido === pedido) e.plano = { ...e.plano, estado: 'falhou', motivo: motivoAcao(err, { se404: PLANO_PERDIDO }) } })
    .finally(() => ctx.refrescar())
}

export function renderACalcular (ctx) {
  const c = ctx.estado.calculo || {}
  const f = Number.isFinite(c.progresso) ? c.progresso : 0
  return `<div class="tile centro" style="flex:1;">
<div class="vv">A calcular a melhor rota…</div>
<div style="width:min(40rem,90%);margin:1rem 0;">${barra(f, 'var(--azul)')}</div>
<div class="v">${Math.round(f * 100)}%</div>
<div style="font-size:1.2rem;margin-top:.4rem;">${esc(c.texto || 'a começar')}</div>
<div class="lab" style="margin-top:.8rem;">Demora uns segundos: o plugin simula as partidas das próximas 48 h.</div>
<div class="acoes" style="margin-top:.8rem;"><button class="acao" data-acao="rota-cancelar">Cancelar</button>${botaoVoltarLeme(ctx)}</div>
<div class="lab">O Cancelar só deixa de seguir: o plugin continua a calcular até ao fim.</div>
</div>`
}

export function renderErro (ctx) {
  const e = ctx.estado
  return `<div class="col" style="flex:1;justify-content:center;align-items:center;">
<div class="tile caixa-erro" style="max-width:48rem;">${esc(e.erro || 'o cálculo falhou sem explicação')}</div>
<div class="acoes">${e.ultimoPedido ? '<button class="acao go" data-acao="rota-repetir">Tentar outra vez</button>' : ''}<button class="acao" data-acao="rota-novo">Novo cálculo</button></div>
</div>`
}

export function botoes (ctx) {
  const r = ctx.estado.resultado
  const semMapa = !r?.mapa
  const aEnviar = ctx.estado.plano?.estado === 'a enviar'
  return `<div class="acoes">
<button class="acao" data-acao="rota-mapa"${semMapa ? ' disabled title="Este resultado vem sem o mapa"' : ''}>Mapa</button>
<button class="acao" data-acao="rota-plano"${aEnviar ? ' disabled' : ''}>Enviar plano</button>
<button class="acao go" data-acao="rota-ativar">Ativar esta rota</button>
${ctx.estado.ultimoPedido?.sairAgora === true ? '' : '<button class="acao stop" data-acao="rota-sair-agora">Sair agora mesmo assim</button>\n'}<button class="acao" data-acao="rota-novo">Novo cálculo</button>${botaoVoltarLeme(ctx)}
</div>${semMapa ? '<div class="lab">Este resultado vem sem o mapa (de uma versão antiga do plugin da rota): faz um novo cálculo para o ver.</div>' : ''}`
}

export function render (ctx) {
  const e = ctx.estado
  const r = e.resultado || {}
  const alts = r.alternativas || []
  const i = alts[e.selecionada] ? e.selecionada : 0
  const alt = alts[i] || {}
  const v = r.veredicto || {}
  const ag = agora(ctx)
  const vermelhos = avisosVermelhos(r, i, ag)
  const gerais = avisosGerais(r)
  const prev = linhaPrevisao(r, ag)
  // A coluna da esquerda: em cima a parte que rola (faixa, cartões); em baixo, fixos, o estado do plano, a
  // resposta da última ação e os botões (revisão F3, Important 2: a 1024×600 o "Ativar esta rota" e o "Voltar ao
  // leme" ficavam por baixo da dobra, e voltar ao rumo tem de ser um toque). Os avisos vermelhos passaram para o
  // cimo da coluna da direita: por baixo dos cartões, com os botões fixos, deixavam de se ver sem rolar.
  return `<div class="col" style="flex:1.6;">
<div class="col rolar" data-rolar="resultado-esq">
<div class="faixa ${corVeredicto(v.tipo)}"><div class="vv">${esc(v.texto || '—')}</div>${(v.porque || []).map(p => `<div>${esc(p)}</div>`).join('')}</div>
${prev || gerais.length ? `<div class="lab">${esc(prev)}${gerais.map(g => ` · <span class="atencao">${esc(g)}</span>`).join('')}</div>` : ''}
${alts.length ? `<div class="g3">${alts.map((a, k) => cartao(ctx, a, k, k === i)).join('')}</div>` : '<div class="tile caixa-erro">Nenhuma alternativa passa: ver o porquê acima.</div>'}
${terraTemOutro(ctx, i)}
</div>
<div class="fixos">
${estadoPlano(e)}
${e.msg ? `<div class="tile ${e.msgErro ? 'perigo' : ''}">${esc(e.msg)}</div>` : ''}
${botoes(ctx)}
</div>
</div>
<div class="col rolar" style="flex:1;" data-rolar="resultado-dir">
<div class="tile vermelhos"><div class="lab">Avisos vermelhos</div>${vermelhos.length ? vermelhos.map(x => `<div class="perigo">⚠ ${esc(x)}</div>`).join('') : '<div class="lab">nenhum</div>'}</div>
<div class="tile"><div class="lab">Linha do tempo · ${esc(nomeAlternativa(alt))}</div>${linhaTempo(ctx, alt)}</div>
<div class="tile"><div class="lab">Precauções</div><div class="caixas">${precaucoes(ctx, alt)}</div></div>
<div class="tile"><div class="lab">Pontos de desistência</div>${desistencia(ctx, r, i)}</div>
</div>`
}

export async function acao (nome, dados, ctx) {
  const e = ctx.estado
  if (nome === 'rota-escolher') {
    const i = Number(dados.i)
    if (Number.isInteger(i) && e.resultado?.alternativas?.[i]) {
      e.selecionada = i
      // a meio do envio o plano continua a seguir-se (diz de que alternativa é); acabado, limpa-se
      if (e.plano?.estado !== 'a enviar') e.plano = null
    }
    return true
  }
  if (nome === 'rota-precaucao') { marcar(ctx, dados.id, !marcas(ctx)[dados.id]); return true }
  if (nome === 'rota-mapa') { if (e.resultado?.mapa) e.vista = 'mapa'; return true }
  if (nome === 'rota-voltar') { e.vista = 'resultado'; return true }
  if (nome === 'rota-cancelar') {
    // deixa de seguir (o seguir() vê que já não há cálculo); o plugin continua a calcular
    e.calculo = null
    e.vista = 'pedir'
    e.msg = CANCELADO
    e.msgErro = false
    return true
  }
  if (nome === 'rota-plano') {
    // um toque duplo não envia o plano duas vezes aos contactos
    if (e.plano?.estado === 'a enviar') return true
    const indice = e.selecionada || 0
    e.plano = { estado: 'a enviar', indice }
    try {
      const r = await ctx.pedir(`${URL_ROTA}/plano-telegram`, { method: 'POST', body: { id: e.idCalculo, alternativa: indice } })
      e.plano = { pedido: r.pedido, estado: 'a enviar', indice, avisos: Array.isArray(r.avisos) ? r.avisos : [] }
    } catch (err) { e.plano = { estado: 'falhou', indice, motivo: motivoAcao(err) }; return true }
    await seguirPlano(ctx)
    return true
  }
  if (nome === 'rota-ativar') {
    e.msg = null
    try {
      const r = await ctx.pedir(`${URL_ROTA}/ativar`, { method: 'POST', body: { id: e.idCalculo, alternativa: e.selecionada || 0 } })
      e.ativada = true
      e.ativadaEm = agora(ctx)
      e.novo = false
      e.msgAtivar = r?.nota || null
    } catch (err) { e.msg = motivoAcao(err); e.msgErro = true }
    return true
  }
  if (nome === 'rota-sair-agora' || nome === 'rota-repetir') {
    const base = e.ultimoPedido || (e.resultado?.destino?.id ? { destino: e.resultado.destino.id, tripulacao: e.resultado.tripulacao || 'so' } : null)
    if (!base) { e.msg = 'Não sei o destino deste cálculo: faz um novo cálculo.'; e.msgErro = true; return true }
    await calcular(ctx, { destino: base.destino, tripulacao: base.tripulacao, sairAgora: nome === 'rota-sair-agora' ? true : !!base.sairAgora })
    return true
  }
  return false
}
