// Melhor rota a navegar (desenho 3b-2): o plano ativo no Leme. O plugin da rota segue a viagem
// (GET /plano-ativo, lido de 10 em 10 s); aqui só se mostra e se pede:
//   a faixa por cima do rumo: "próximo: rizar às 22:50 (daqui a 25 min) · +20 min sobre o plano",
//     "chegada ~amanhã 07:58 (plano 07:38)", "recursos: gasóleo à chegada ~34 L" (quando há aviso) e o que
//     falta ler — "recursos: sem leitura" (os dois), "recursos: gasóleo sem leitura" (a sonda perdida) ou
//     "recursos: bateria sem leitura" (recursos.gasoleoSemLeitura / bateriaSemLeitura, F9) —, "sem GPS:
//     acompanhamento parado", "barómetro: sem leitura"; antes de sair, "plano ativo · à espera de sair";
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
//     (a tentar outra vez)" (o parcial) e, em pausa, "em pausa: os atrasos não seguem para terra"; a hora de
//     alarme da faixa é a MAIS CEDO que algum contacto tem (envio.alarme, decisão n.º 14) e, com horas
//     diferentes, "Pai: alarme HH:MM · Mãe: alarme HH:MM" (envio.porContacto, I-01, F3b); com a viagem seguinte
//     aberta, o «cheguei bem» da viagem anterior que ainda não chegou a terra (fechoPorEntregar.doPlanoAnterior,
//     F9): "o «cheguei bem» da viagem anterior ainda não chegou a terra: liga-lhes (Pai)";
//   o que pede uma ação em relação a terra — o relógio do Pi desacertado, o «cheguei bem» por entregar com o plano
//     já fechado (K-12), a quem se desistiu de entregar (I-05) e o plano que terra tem sem ser o ativo (I-02) —
//     vai num mosaico à parte, "Contactos em terra" (terra.js), também no Pedir; o 404 do GET /plano-ativo traz
//     o envioEmTerra e o relógio (estado.semPlano);
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
import { alarmesPorContacto, horaPlugin } from './terra.js'

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
// O relógio do Pi desacertado e o que terra tem (o «cheguei bem» por entregar, outro plano, nenhum) já têm o mosaico
// "Contactos em terra" (terra.js, F3b item 1), a toda a hora e não só 60 min antes: o aviso do mesmo não se repete aqui.
const CAMINHO_RECURSOS = 'notifications.rota.recursos'
const JA_EM_TERRA = /ainda não chegou a terra|^Os contactos em terra têm /
function avisosAtivos (p) {
  const mosaicoRelogio = ok(p.relogioDesacertadoS) && p.relogioDesacertadoS !== 0
  const mosaicoTerra = !!(p.fechoPorEntregar || p.envioEmTerra)
  return (Array.isArray(p.avisos) ? p.avisos : [])
    .filter(a => a && GRAVIDADE[a.state] && typeof a.message === 'string' && a.message.trim() && a.caminho !== CAMINHO_RECURSOS)
    .filter(a => !(mosaicoRelogio && a.caminho === 'notifications.rota.relogio') && !(mosaicoTerra && a.caminho === 'notifications.rota.alarmeTerra' && JA_EM_TERRA.test(a.message)))
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
      e.semPlano = null
      e.planoAtivoLidoEm = t
      e.semLigacao = false
      acertar(e)
    })
    .catch(err => {
      if (e.lerDeNovo) return
      // 404: não há plano; outro erro (o plugin a reiniciar, a rede): fica o plano lido, com o aviso
      // (o corpo do 404 traz o que terra tem sem plano ativo e o relógio, F2: terra.js)
      if (err?.status === 404) { e.planoAtivo = null; e.semPlano = err.corpo && typeof err.corpo === 'object' ? err.corpo : {}; e.semLigacao = false; acertar(e) } else e.semLigacao = true
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

// Que recurso não tem leitura (F9, F2b Menor 3): o plugin diz qual — recursos.gasoleoSemLeitura (com a sonda do
// gasóleo perdida o gasóleo é desconhecido, nunca os litros pelo consumo) e recursos.bateriaSemLeitura —, e
// semLeitura continua a ser "os dois". Falha segura: o que o plugin não diz de um deles (um plugin de antes só
// trazia o semLeitura) não se inventa. → '' (tudo lido), 'sem leitura' (os dois), 'gasóleo sem leitura' ou
// 'bateria sem leitura'.
function recursosSemLeitura (r) {
  const gasoleo = r.gasoleoSemLeitura === true
  const bateria = r.bateriaSemLeitura === true
  if (r.semLeitura === true || (gasoleo && bateria)) return 'sem leitura'
  if (gasoleo) return 'gasóleo sem leitura'
  if (bateria) return 'bateria sem leitura'
  return ''
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
  // o que falta ler diz-se sempre, ao lado do aviso do que se leu: um aviso nunca esconde um recurso desconhecido
  const sem = recursosSemLeitura(r)
  if (sem) linhas.push(`<span class="lab">recursos: ${sem}</span>`)
  if (p.semGps) linhas.push('<span class="perigo">sem GPS: acompanhamento parado</span>')
  if (p.barometro?.semLeitura) linhas.push('<span class="lab">barómetro: sem leitura</span>')
  return [...linhas, ...linhasTerra(p, t)]
}

// Os contactos em terra (revisão final I2, I3), só com o plano enviado: a hora de alarme que eles têm, a
// mensagem que não chegou a alguém (o parcial), a que está por enviar e, em pausa, que os atrasos param.
// simples: sem as cores (dentro da caixa vermelha da pausa).
function linhasTerra (p, t, { pausa = false, simples = false } = {}) {
  const cor = (classe, x) => (simples ? x : `<span class="${classe}">${x}</span>`)
  const out = []
  // O «cheguei bem» (ou a «viagem terminada») da viagem ANTERIOR que ainda não chegou a terra, com a viagem seguinte
  // aberta (F9, F2b Menor 6: fechoPorEntregar.doPlanoAnterior): diz-se de quem é, mesmo que o plano novo ainda não
  // tenha ido a terra (sem envio). O deste plano, já fechado, é o do mosaico "Contactos em terra" (terra.js).
  const fecho = p.fechoPorEntregar
  if (fecho?.doPlanoAnterior === true && (fecho.tipo === 'chegada' || fecho.tipo === 'terminado')) {
    const quem = (Array.isArray(fecho.contactos) ? fecho.contactos : []).filter(n => typeof n === 'string' && n.trim()).map(n => esc(n.trim()))
    out.push(cor('atencao', `⚠ ${fecho.tipo === 'chegada' ? 'o «cheguei bem»' : 'a «viagem terminada»'} da viagem anterior ainda não chegou a terra: liga-lhes${quem.length ? ` (${quem.join(', ')})` : ''}`))
  }
  if (!p.envio?.contactos?.length) return out
  const alarme = Date.parse(p.envio.alarme)
  // a hora a que terra liga ao MRCC é a que o Ivo tem de saber sempre (F3b item 1): no tamanho da faixa, não a cinzento miúdo
  if (ok(alarme)) out.push(`contactos em terra: alarme <b>${horaLisboa(alarme, t)}</b>`)
  // com horas diferentes por contacto (I-01): a de cada um; a de cima é a mais cedo
  const porContacto = alarmesPorContacto(p.envio, t)
  if (porContacto) out.push(cor('lab', porContacto))
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
