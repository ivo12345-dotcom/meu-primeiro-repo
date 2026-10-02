// Diário de bordo (signalk-logbook): entradas de hoje, botões de um toque, notas,
// e o cartão da AI (o que o barco aprendeu, "Treinar agora", "Voltar atrás").

import { esc, dataLisboa, hmLisboa } from '../lib/rota-texto.js'
import { motivo } from '../lib/erros.js'

// [texto no diário, categoria, rótulo do botão (se for diferente do texto)]
const RAPIDAS = [
  ['Motor ligado', 'engine'], ['Motor desligado', 'engine'], ['Rizei', 'navigation'], ['Mudei de vela', 'navigation'],
  ['Fundeei', 'navigation'], ['Amarrei', 'navigation'], ['Avaria', 'maintenance'], ['Orcas avistadas', 'navigation', 'Orcas']
]

const URL_IA = '/plugins/signalk-arlequin-ia'
// o diário passa pelo plugin do ecrã (contrato C3): o signalk-logbook só aceita admin, e o token de admin fica
// só na configuração do plugin do ecrã (nunca no browser)
export const URL_DIARIO = '/plugins/arlequin-ecra/diario'
// Grava uma entrada (o ctx.logbook do app.js e os testes): POST { text, category }.
export const gravarNoDiario = (pedir, text, category = 'navigation') => pedir(URL_DIARIO, { method: 'POST', body: { text, category } })
// As categorias do signalk-logbook (auditoria I-32: em inglês no logbook)
const CATEGORIAS = { navigation: 'navegação', engine: 'motor', radio: 'rádio', maintenance: 'manutenção' }

// As entradas automáticas do signalk-logbook vêm em inglês (auditoria I-32): o ecrã traduz as conhecidas;
// as que o Ivo escreveu ficam tal e qual. A de hora a hora vem sem texto.
const GRAVIDADES = { alert: 'Alerta', warn: 'Aviso', alarm: 'Alarme', emergency: 'Emergência', normal: 'Normal', nominal: 'Normal' }
const FIXAS = {
  'Autopilot activated': 'Piloto ligado', 'Autopilot set to wind mode': 'Piloto no modo vento', 'Autopilot set to route mode': 'Piloto no modo rota',
  'Autopilot deactivated': 'Piloto desligado', Anchored: 'Fundeado', Stopped: 'Parado', Sailing: 'À vela', Motoring: 'A motor',
  'Motor stopped, sailing': 'Motor desligado, à vela', 'Anchor up, motoring': 'Âncora a bordo, a motor', 'Sails down, motoring': 'Velas em baixo, a motor',
  'Watch schedule stopped': 'Fim dos quartos'
}
const PADROES = [
  [/^Motor stopped, sailing with (.+)$/, (m) => `Motor desligado, à vela com ${m[1]}`],
  [/^Sailing with (.+)$/, (m) => `À vela com ${m[1]}`],
  [/^Heading changed to (\d+)°$/, (m) => `Proa mudou para ${m[1]}°`],
  [/^Tack \(Heading (\d+)°\)$/, (m) => `Virámos por davante (proa ${m[1]}°)`],
  [/^Gybe \(Heading (\d+)°\)$/, (m) => `Cambámos (proa ${m[1]}°)`],
  [/^Crew changed to (.*)$/, (m) => `Tripulação: ${m[1]}`],
  [/^(.+) joined the crew$/, (m) => `${m[1]} entrou na tripulação`],
  [/^(.+) left the crew$/, (m) => `${m[1]} saiu da tripulação`],
  [/^(.+) took over as skipper$/, (m) => `${m[1]} passou a skipper`],
  [/^(.+) on watch$/, (m) => `${m[1]} de quarto`],
  [/^Changed ship's time to (.+)$/, (m) => `Hora de bordo mudada para ${m[1]}`],
  [/^Started (.+) engine$/, (m) => `Motor ${m[1]} ligado`],
  [/^Stopped (.+) engine$/, (m) => `Motor ${m[1]} desligado`],
  [/^Sails set: (.+)$/, (m) => `Velas: ${m[1]}`],
  [/^(Alert|Warn|Alarm|Emergency|Normal|Nominal): (.+) \([\w.]+\)$/, (m) => `${GRAVIDADES[m[1].toLowerCase()]}: ${m[2]}`],
  [/^(Alert|Warn|Alarm|Emergency|Normal|Nominal) notification: (.+)$/, (m) => `${GRAVIDADES[m[1].toLowerCase()]}: ${m[2]}`],
  [/^Cleared after (.+?): (.+?)(?: — peaked (\w+))?(?:, (\d+) transitions)?$/, (m) => `Resolvido ao fim de ${m[1]}: ${m[2]}${m[3] ? ` (chegou a ${(GRAVIDADES[m[3]] || m[3]).toLowerCase()})` : ''}${m[4] ? `, ${m[4]} mudanças` : ''}`]
]
export function textoDaEntrada (x) {
  const t = typeof x?.text === 'string' ? x.text : ''
  if (x?.origin !== 'auto') return t
  if (!t) return 'Registo de hora a hora'
  if (FIXAS[t]) return FIXAS[t]
  for (const [re, f] of PADROES) { const m = re.exec(t); if (m) return f(m) }
  return t
}

// os 4 modelos da AI (signalk-arlequin-ia/lib/modelos.js, NOMES; auditoria M-48: faltava a direção do vento)
const MODELOS_IA = [['velocidade', 'Velocidade'], ['ventoForca', 'Vento'], ['ventoDirecao', 'Direção do vento'], ['consumo', 'Consumo']]

const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
// o dia de Lisboa (o plugin do ecrã junta os dois dias UTC do logbook que lhe tocam)
const hoje = (ctx) => dataLisboa(agora(ctx))
// "12,5"; sem número "—" (auditoria M-42: um modelo sem horas dava "NaN")
const virgula = (x) => (typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x * 10) / 10).replace('.', ',') : '—')
// a hora de Lisboa (auditoria I-31)
const hora = (iso) => hmLisboa(iso)

function buscar (ctx, forcar = false) {
  if (ctx.estado.aBuscar || (!forcar && Date.now() - (ctx.estado.em || 0) < 20000)) return
  ctx.estado.aBuscar = true
  ctx.pedir(`${URL_DIARIO}/${hoje(ctx)}`)
    .then(r => { ctx.estado.entradas = Array.isArray(r?.entradas) ? r.entradas : []; ctx.estado.erro = null })
    .catch(err => { ctx.estado.entradas = []; ctx.estado.erro = motivo(err, 'o diário') })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.em = Date.now(); ctx.refrescar() })
}

function buscarIa (ctx, forcar = false) {
  const e = ctx.estado
  if (e.iaABuscar || (!forcar && Date.now() - (e.iaEm || 0) < 60000)) return
  e.iaABuscar = true
  ctx.pedir(`${URL_IA}/ia`)
    .then(r => { e.ia = r })
    .catch(err => { e.ia = { erro: err?.status ? motivo(err, 'a AI') : 'a AI não responde (o plugin signalk-arlequin-ia está ligado?)' } })
    .finally(() => { e.iaABuscar = false; e.iaEm = Date.now(); ctx.refrescar() })
}

function cartaoIa (ia) {
  if (!ia) return '<div class="tile lab">AI: a ler…</div>'
  if (ia.erro) return `<div class="tile lab">AI: ${esc(ia.erro)}</div>`
  const linhas = MODELOS_IA.map(([nome, rotulo]) => {
    const m = ia.modelos?.[nome]
    // frases fixas em pt-PT (auditoria I-32): o erro técnico do plugin ("unexpected end of file"…) fica no plugin
    const texto = m?.erro ? `${esc(m.versao)} · não consegui ler o modelo`
      : m?.versao ? `${esc(m.versao)} · ${virgula(m.horas)} h · ${esc(m.frases?.[0] || '')}` : 'a aprender'
    // o plugin diz se há uma versão anterior que tenha estado em uso (só essas servem para voltar)
    const voltar = m?.podeVoltar ? `<button class="acao" data-acao="ia-voltar" data-modelo="${nome}">Voltar atrás</button>` : ''
    return `<tr><td>${rotulo}</td><td>${texto}</td><td>${voltar}</td></tr>`
  }).join('')
  const t = ia.ultimoTreino
  const ultimo = ia.emTreino ? 'a treinar…'
    : !t ? 'ainda não treinou'
      : t.erro ? `último treino falhou às ${hora(t.em)} (o motivo está no estado do plugin da AI)`
        : !Array.isArray(t.resultados) ? `último treino ${hora(t.em)}`
          : `último treino ${hora(t.em)}: ${t.resultados.filter(r => r?.aceite).length} de ${t.resultados.length} modelos melhoraram`
  const p = ia.previsao
  const ultima = p?.okEm ? `última ${hora(p.okEm)}` : ''
  const previsao = p?.erro ? `previsão: falhou ao atualizar${ultima ? ' · ' + ultima : ''}`
    : ultima ? `previsão: ${ultima}` : 'previsão: ainda nenhuma'
  return `<div class="tile"><div class="lab">AI · o que o barco aprendeu</div><table>${linhas}</table>
<div class="lab">${previsao}</div>
<div class="linha"><span class="lab">${ultimo}</span><button class="acao go" data-acao="ia-treinar">Treinar agora</button></div></div>`
}

export default {
  aoEntrar (ctx) { buscar(ctx, true); buscarIa(ctx, true) },
  render (ctx) {
    buscar(ctx)
    buscarIa(ctx)
    const e = ctx.estado
    const lista = (e.entradas || []).slice().reverse().map(x => {
      return `<tr><td style="width:4.5rem;">${hora(x.datetime)}</td><td>${esc(textoDaEntrada(x))}</td><td class="lab">${esc(CATEGORIAS[x.category] || x.category || '')}</td></tr>`
    }).join('')
    const vazio = e.erro
      ? `<div class="perigo">${esc(e.erro)}</div>`
      : '<div class="lab">Ainda não há entradas hoje.</div>'
    return `<div class="col" style="flex:1.4;">
<div class="tile" style="flex:1;overflow:auto;"><div class="lab">Diário de hoje · ${hoje(ctx)}</div>${lista ? `<table class="grande">${lista}</table>` : vazio}</div>
<div class="tile" style="display:flex;gap:.4rem;"><input type="text" id="nota" data-campo="nota" value="${esc(e.nota || '')}" placeholder="Escreve uma nota e carrega em Gravar"><button class="acao go" data-acao="nota">Gravar</button></div>
${e.msg ? `<div class="tile ${e.msgErro ? 'perigo' : 'ok'}">${esc(e.msg)}</div>` : ''}
${cartaoIa(e.ia)}
</div>
<div class="col estica">
<div class="tile" style="flex:0 0 auto;"><div class="lab">Um toque</div></div>
${RAPIDAS.map(([t, c, rotulo]) => `<button class="acao" data-acao="rapida" data-texto="${t}" data-cat="${c}">${rotulo || t}</button>`).join('')}
</div>`
  },
  async acao (nome, dados, ctx, input) {
    // o que se escreve na nota fica no estado (auditoria M-43: o desenho seguinte apagava-o)
    if (nome === 'campo') { if (dados.campo === 'nota') ctx.estado.nota = String(dados.valor ?? ''); return }
    if (nome === 'ia-treinar' || nome === 'ia-voltar') {
      const e = ctx.estado
      try {
        if (nome === 'ia-treinar') {
          await ctx.pedir(`${URL_IA}/treinar`, { method: 'POST' })
          e.msg = 'A treinar a AI… (pode demorar uns minutos)'
        } else {
          const r = await ctx.pedir(`${URL_IA}/voltar`, { method: 'POST', body: { modelo: dados.modelo } })
          e.msg = `${MODELOS_IA.find(([n]) => n === dados.modelo)?.[1] || dados.modelo} voltou à ${r.versao}`
        }
        e.msgErro = false
      } catch (err) { e.msg = `AI: ${motivo(err, 'a AI')}`; e.msgErro = true }
      buscarIa(ctx, true)
      return
    }
    let texto = null
    let cat = 'navigation'
    if (nome === 'rapida') { texto = dados.texto; cat = dados.cat }
    if (nome === 'nota' || nome === 'enter') {
      const el = input || globalThis.document?.getElementById?.('nota')
      texto = String(ctx.estado.nota ?? el?.value ?? '').trim()
      ctx.estado.nota = ''
      if (el) el.value = ''
      el?.blur?.()
    }
    if (!texto) return
    try {
      await ctx.logbook(texto, cat)
      ctx.estado.msg = `Gravado: ${texto}`
      ctx.estado.msgErro = false
    } catch (err) {
      ctx.estado.msg = `Não gravou: ${motivo(err, 'o diário')}`
      ctx.estado.msgErro = true
    }
    buscar(ctx, true)
  }
}
