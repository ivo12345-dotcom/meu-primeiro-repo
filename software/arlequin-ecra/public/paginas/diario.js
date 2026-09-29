// Diário de bordo (signalk-logbook): entradas de hoje, botões de um toque, notas,
// e o cartão da AI (o que o barco aprendeu, "Treinar agora", "Voltar atrás").

// [texto no diário, categoria, rótulo do botão (se for diferente do texto)]
const RAPIDAS = [
  ['Motor ligado', 'engine'], ['Motor desligado', 'engine'], ['Rizei', 'navigation'], ['Mudei de vela', 'navigation'],
  ['Fundeei', 'navigation'], ['Amarrei', 'navigation'], ['Avaria', 'maintenance'], ['Orcas avistadas', 'navigation', 'Orcas']
]

const URL_IA = '/plugins/signalk-arlequin-ia'
const MODELOS_IA = [['velocidade', 'Velocidade'], ['ventoForca', 'Vento'], ['consumo', 'Consumo']]

const hoje = () => new Date().toISOString().slice(0, 10)
const virgula = (x) => String(Math.round(x * 10) / 10).replace('.', ',')
const hora = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function buscar (ctx, forcar = false) {
  if (ctx.estado.aBuscar || (!forcar && Date.now() - (ctx.estado.em || 0) < 20000)) return
  ctx.estado.aBuscar = true
  ctx.pedir(`/plugins/signalk-logbook/logs/${hoje()}`)
    .then(r => { ctx.estado.entradas = Array.isArray(r) ? r : []; ctx.estado.erro = null })
    .catch(e => { ctx.estado.entradas = []; ctx.estado.erro = e.status === 404 ? 'vazio' : 'sem diário' })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.em = Date.now(); ctx.refrescar() })
}

function buscarIa (ctx, forcar = false) {
  const e = ctx.estado
  if (e.iaABuscar || (!forcar && Date.now() - (e.iaEm || 0) < 60000)) return
  e.iaABuscar = true
  ctx.pedir(`${URL_IA}/ia`)
    .then(r => { e.ia = r })
    .catch(() => { e.ia = { erro: 'a AI não responde (o plugin signalk-arlequin-ia está ligado?)' } })
    .finally(() => { e.iaABuscar = false; e.iaEm = Date.now(); ctx.refrescar() })
}

function cartaoIa (ia) {
  if (!ia) return '<div class="tile lab">AI: a ler…</div>'
  if (ia.erro) return `<div class="tile lab">AI: ${esc(ia.erro)}</div>`
  const linhas = MODELOS_IA.map(([nome, rotulo]) => {
    const m = ia.modelos?.[nome]
    const texto = m?.erro ? `${m.versao} · não consegui ler o modelo: ${esc(m.erro)}`
      : m?.versao ? `${m.versao} · ${virgula(m.horas)} h · ${esc(m.frases?.[0] || '')}` : 'a aprender'
    const voltar = !m?.erro && m?.versao && m.versoes?.length > 1 ? `<button class="acao" data-acao="ia-voltar" data-modelo="${nome}">Voltar atrás</button>` : ''
    return `<tr><td>${rotulo}</td><td>${texto}</td><td>${voltar}</td></tr>`
  }).join('')
  const t = ia.ultimoTreino
  const ultimo = ia.emTreino ? 'a treinar…'
    : !t ? 'ainda não treinou'
      : t.erro ? `último treino falhou: ${esc(t.erro)}`
        : `último treino ${hora(t.em)}: ${t.resultados.filter(r => r.aceite).length} de ${t.resultados.length} modelos melhoraram`
  return `<div class="tile"><div class="lab">AI · o que o barco aprendeu</div><table>${linhas}</table>
<div class="linha"><span class="lab">${ultimo}</span><button class="acao go" data-acao="ia-treinar">Treinar agora</button></div></div>`
}

export default {
  aoEntrar (ctx) { buscar(ctx, true); buscarIa(ctx, true) },
  render (ctx) {
    buscar(ctx)
    buscarIa(ctx)
    const e = ctx.estado
    const lista = (e.entradas || []).slice().reverse().map(x => {
      const d = new Date(x.datetime)
      return `<tr><td style="width:4.5rem;">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</td><td>${esc(x.text)}</td><td class="lab">${esc(x.category || '')}</td></tr>`
    }).join('')
    const vazio = e.erro === 'sem diário'
      ? '<div class="perigo">O diário não responde. O plugin signalk-logbook está instalado e ligado?</div>'
      : '<div class="lab">Ainda não há entradas hoje.</div>'
    return `<div class="col" style="flex:1.4;">
<div class="tile" style="flex:1;overflow:auto;"><div class="lab">Diário de hoje · ${hoje()}</div>${lista ? `<table class="grande">${lista}</table>` : vazio}</div>
<div class="tile" style="display:flex;gap:.4rem;"><input type="text" id="nota" data-campo="nota" placeholder="Escreve uma nota e carrega em Gravar"><button class="acao go" data-acao="nota">Gravar</button></div>
${e.msg ? `<div class="tile ${e.msgErro ? 'perigo' : 'ok'}">${esc(e.msg)}</div>` : ''}
${cartaoIa(e.ia)}
</div>
<div class="col estica">
<div class="tile" style="flex:0 0 auto;"><div class="lab">Um toque</div></div>
${RAPIDAS.map(([t, c, rotulo]) => `<button class="acao" data-acao="rapida" data-texto="${t}" data-cat="${c}">${rotulo || t}</button>`).join('')}
</div>`
  },
  async acao (nome, dados, ctx, input) {
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
      } catch (err) { e.msg = `AI: ${err.message}`; e.msgErro = true }
      buscarIa(ctx, true)
      return
    }
    let texto = null
    let cat = 'navigation'
    if (nome === 'rapida') { texto = dados.texto; cat = dados.cat }
    if (nome === 'nota' || nome === 'enter') {
      const el = input || document.getElementById('nota')
      texto = el?.value.trim()
      if (el) el.value = ''
      el?.blur()
    }
    if (!texto) return
    try {
      await ctx.logbook(texto, cat)
      ctx.estado.msg = `Gravado: ${texto}`
      ctx.estado.msgErro = false
    } catch (err) {
      ctx.estado.msg = `Não gravou (${err.message}). O signalk-logbook está ligado?`
      ctx.estado.msgErro = true
    }
    buscar(ctx, true)
  }
}
