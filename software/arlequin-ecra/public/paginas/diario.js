// Diário de bordo (signalk-logbook): entradas de hoje, botões de um toque, notas.

const RAPIDAS = [
  ['Motor ligado', 'engine'], ['Motor desligado', 'engine'], ['Rizei', 'navigation'], ['Mudei de vela', 'navigation'],
  ['Fundeei', 'navigation'], ['Amarrei', 'navigation'], ['Avaria', 'maintenance']
]

const hoje = () => new Date().toISOString().slice(0, 10)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function buscar (ctx, forcar = false) {
  if (ctx.estado.aBuscar || (!forcar && Date.now() - (ctx.estado.em || 0) < 20000)) return
  ctx.estado.aBuscar = true
  ctx.pedir(`/plugins/signalk-logbook/logs/${hoje()}`)
    .then(r => { ctx.estado.entradas = Array.isArray(r) ? r : []; ctx.estado.erro = null })
    .catch(e => { ctx.estado.entradas = []; ctx.estado.erro = e.status === 404 ? 'vazio' : 'sem diário' })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.em = Date.now(); ctx.refrescar() })
}

export default {
  aoEntrar (ctx) { buscar(ctx, true) },
  render (ctx) {
    buscar(ctx)
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
</div>
<div class="col estica">
<div class="tile" style="flex:0 0 auto;"><div class="lab">Um toque</div></div>
${RAPIDAS.map(([t, c]) => `<button class="acao" data-acao="rapida" data-texto="${t}" data-cat="${c}">${t}</button>`).join('')}
</div>`
  },
  async acao (nome, dados, ctx, input) {
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
