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
//   um erro da leitura que não seja 404: "sem ligação ao plugin da rota: os dados podem estar velhos";
//   os contactos em terra (revisão final I2, I3): "contactos em terra: alarme HH:MM" na faixa e na caixa
//     da pausa, "mensagem para terra por enviar (sem rede)" (uma na fila que já falhou), "não chegou a X
//     (a tentar outra vez)" (o parcial) e, em pausa, "em pausa: os atrasos não seguem para terra";
//   o atraso retido (revisão final C1, decisão do Ivo de 02/10): "A hora de alarme em terra é HH:MM e não
//     foi adiada (barco parado / limite de 3 h). Se estás bem, carrega Estou bem." com o botão (POST
//     /plano-ativo/estou-bem: sai um atraso com a estimativa de agora).
// As horas ("daqui a X min", "amanhã") contam-se com a hora do plugin (o agora do GET, mais o tempo
// desde a leitura): no barco é o mesmo relógio; na viagem acelerada do dev, o simulado.
// Nunca mostra null, NaN nem undefined: o que falta fica de fora.

import { esc, horaLisboa, quandoAs, aNome } from '../../lib/rota-texto.js'
import { GRAVIDADE, COR_GRAVIDADE } from '../../lib/alarmes.js'
import { URL_ROTA, calcular, motivoAcao } from './pedir.js'
import { aberto, planoAberto, pausado, aEspera } from './aberto.js'

const LER_MS = 10000
const CONFIRMAR = "Terminar o plano? Os contactos em terra recebem 'viagem terminada, estou bem'"
const SEM_LIGACAO = 'sem ligação ao plugin da rota: os dados podem estar velhos'
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
const ok = (x) => typeof x === 'number' && Number.isFinite(x)
// o plano a que a pergunta do Terminar e as mensagens se referem
const chave = (p) => (p ? `${p.idCalculo ?? ''}|${p.indice ?? ''}|${p.ativadoEm ?? ''}` : null)
// Os avisos da rota ativos (auditoria I-24: com vários ao mesmo tempo só se via um, no chip da barra): o campo
// avisos do GET /plano-ativo, os mais graves primeiro; o dos recursos já tem a sua linha na faixa. Num mosaico
// próprio, na coluna da direita do Leme: na faixa, a 1024×600, empurravam o "Rumo a seguir" para fora do ecrã.
// A gravidade e a cor vêm do lib/alarmes.js (uma só fonte, revisão F3 Minor 15).
const CAMINHO_RECURSOS = 'notifications.rota.recursos'
function avisosAtivos (p) {
  return (Array.isArray(p.avisos) ? p.avisos : [])
    .filter(a => a && GRAVIDADE[a.state] && typeof a.message === 'string' && a.message.trim() && a.caminho !== CAMINHO_RECURSOS)
    .sort((a, b) => GRAVIDADE[b.state] - GRAVIDADE[a.state])
}

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

export { planoAberto, pausado }

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
  if (aEspera(p)) linhas.push('plano ativo · à espera de sair')
  else {
    const partes = []
    const hora = Date.parse(p.proximo?.hora)
    // um evento que já passou: "há X min" (auditoria M-39: dizia "daqui a 0 min"); no minuto certo, "agora"
    const falta = Math.round((hora - t) / 60000)
    const quando = falta > 0 ? `daqui a ${contagem(falta)}` : falta < 0 ? `há ${contagem(-falta)}` : 'agora'
    if (p.proximo?.texto && ok(hora)) partes.push(`próximo: ${esc(p.proximo.texto)} ${quandoAs(hora, t)} (${quando})`)
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
  return [...linhas, ...linhasTerra(p, t)]
}

// Os contactos em terra (revisão final I2, I3), só com o plano enviado: a hora de alarme que eles têm, a
// mensagem que não chegou a alguém (o parcial), a que está por enviar e, em pausa, que os atrasos param.
// simples: sem as cores (dentro da caixa vermelha da pausa).
function linhasTerra (p, t, { pausa = false, simples = false } = {}) {
  if (!p.envio?.contactos?.length) return []
  const cor = (classe, x) => (simples ? x : `<span class="${classe}">${x}</span>`)
  const out = []
  const alarme = Date.parse(p.envio.alarme)
  if (ok(alarme)) out.push(cor('lab', `contactos em terra: alarme ${horaLisboa(alarme, t)}`))
  const fila = Array.isArray(p.filaContactos) ? p.filaContactos : []
  const nomes = [...new Set(fila.filter(m => m.parcial).flatMap(m => (Array.isArray(m.contactos) ? m.contactos : [])))]
  if (nomes.length) out.push(cor('atencao', `não chegou a ${esc(nomes.join(', '))} (a tentar outra vez)`))
  if (fila.some(m => !m.parcial && m.tentativas >= 1)) out.push(cor('atencao', 'mensagem para terra por enviar (sem rede)'))
  if (pausa) out.push(cor('atencao', 'em pausa: os atrasos não seguem para terra'))
  return out
}

// O atraso que não seguiu para terra (revisão final C1): a hora de alarme que terra tem, o porquê e o botão.
function retido (p, t) {
  const r = p.atrasoRetido
  const alarme = Date.parse(r?.alarme)
  if (!r || !ok(alarme)) return ''
  const porque = r.motivo === 'limite' ? 'limite de 3 h' : 'barco parado'
  return `<div class="tile atencao plano-retido"><div class="v">A hora de alarme em terra é ${horaLisboa(alarme, t)} e não foi adiada (${porque}). Se estás bem, carrega Estou bem.</div>
<div class="acoes"><button class="acao go" data-acao="rota-estou-bem">Estou bem</button></div></div>`
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
  return `<div class="tile atencao plano-chegada"><div class="v">Chegaste ${esc(aNome(nome))}? Enviar 'cheguei bem ${esc(aNome(nome))}'</div>
<div class="acoes"><button class="acao go" data-acao="rota-chegada">Enviar</button></div></div>`
}

// O mosaico "Avisos da rota" (auditoria I-24): uma linha por aviso ativo, com a cor da gravidade; '' sem nenhum.
export function avisosRota (ctx) {
  const p = planoAberto(ctx)
  const lista = p && p.estado !== 'pausado' ? avisosAtivos(p) : []
  if (!lista.length) return ''
  return `<div class="tile avisos-rota"><div class="lab">Avisos da rota</div>${lista.map(a => `<div><span${COR_GRAVIDADE[a.state] ? ` class="${COR_GRAVIDADE[a.state]}"` : ''}>⚠ ${esc(a.message)}</span></div>`).join('')}</div>`
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
    const terra = linhasTerra(p, horaPlugin(ctx, p), { pausa: true, simples: true }).map(l => `<div>${l}</div>`).join('')
    return `<div class="tile caixa-erro plano-pausado">a rota ativa já não é a do plano: terminar o plano?${terra}${semLigacao}
<div class="acoes"><button class="acao stop" data-acao="rota-terminar">Terminar</button><button class="acao go" data-acao="rota-continuar">Continuar</button><button class="acao" data-acao="rota-recalcular">Recalcular</button></div></div>
${chegadaOutro(p)}${confirmacao(e, p)}${msg}`
  }
  return `<div class="tile plano-faixa">${linhasFaixa(ctx, p).map(l => `<div>${l}</div>`).join('')}${semLigacao}
<div class="acoes"><button class="acao" data-acao="rota-recalcular">Recalcular</button><button class="acao stop" data-acao="rota-terminar">Terminar</button></div></div>
${retido(p, horaPlugin(ctx, p))}${confirmacao(e, p)}${msg}`
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
  if (nome === 'rota-estou-bem') {
    const p = planoAberto(ctx)
    if (!p?.atrasoRetido) return true
    e.confirmarTerminar = null
    try {
      const r = await ctx.pedir(`${URL_ROTA}/plano-ativo/estou-bem`, { method: 'POST' })
      const alarme = Date.parse(r?.alarme)
      mensagem(ok(alarme) ? `Enviado aos contactos em terra: nova hora de alarme ${horaLisboa(alarme, horaPlugin(ctx, p))}.` : 'Enviado aos contactos em terra.', false, p)
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
      mensagem(r?.contactos ? `Enviado aos contactos em terra: 'cheguei bem ${aNome(outro.nome)}'.` : `Plano fechado: chegaste ${aNome(outro.nome)}.`, false, p)
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
