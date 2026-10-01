// Melhor rota, estado Leme (com uma rota ativa): o rumo a seguir ao leme, em grande, e contra o
// vento os dois bordos ótimos da polar e quando virar. "Novo cálculo" volta ao estado Pedir.
// (Era a página melhor.js antes da 3b-1.) A navegar (3b-2), o plano ativo por cima do rumo
// (melhor/navegar.js: a faixa, Recalcular, Terminar, a caixa da rota mudada); com o plano ativo o Leme
// fica limpo (Tarefa 8.2): sem o "Novo cálculo" nem o texto do OpenCPN, só o Recalcular. Pausado sem
// rota ativa: "a rota do plano já não está ativa" (não a espera pelo rumo).

import { angulosOtimos } from '../../lib/polar.js'
import { correcaoLeme, bordejo } from '../../lib/rumo.js'
import { barraXte } from '../../lib/desenho.js'
import { proximoWp, velocidade, distancia, duracao, rumo, num, graus, ok } from '../comum.js'
import { esc } from '../../lib/rota-texto.js'
import * as navegar from './navegar.js'

const NOVO = '<button class="acao" data-acao="rota-novo">Novo cálculo</button>'

export default {
  render (ctx) {
    const wp = proximoWp(ctx)
    const proa = ctx.v('navigation.headingTrue')
    const twd = ctx.v('environment.wind.directionTrue')
    const tws = ctx.v('environment.wind.speedTrue')
    const plano = navegar.render(ctx)
    // com o plano ativo (Tarefa 8.2), só o Recalcular da faixa: sem o "Novo cálculo" nem o texto do OpenCPN
    const comPlano = !!navegar.planoAberto(ctx)
    if (!wp.ativo) {
      // acabou de se ativar, ou o SignalK ainda não mandou o rumo ao próximo ponto; em pausa sem rota
      // ativa, a rota do plano já não está ativa (não se espera rumo nenhum)
      const nome = ctx.v('navigation.course.activeRoute')?.name
      const titulo = ctx.estado?.ativada ? 'Rota ativada' : nome ? 'Rota ativa' : 'Sem rota ativa'
      const explica = navegar.pausado(ctx) && !nome
        ? 'a rota do plano já não está ativa: Continuar volta a ativá-la.'
        : 'À espera do rumo do SignalK (o OpenCPN mostra a rota ativa). Aqui aparece o rumo a seguir ao leme.'
      return `<div class="col" style="flex:1;">${plano}<div class="tile centro" style="flex:1;"><div class="vv">${titulo}</div>
${nome ? `<div class="v" style="margin-top:.4rem;">${esc(nome)}</div>` : ''}
<div style="font-size:1.3rem;max-width:40rem;margin:.6rem 0;">${explica}</div>
${ctx.estado?.msgAtivar ? `<div class="lab" style="max-width:40rem;">${esc(ctx.estado.msgAtivar)}</div>` : ''}
${comPlano ? '' : `<div class="acoes">${NOVO}</div>`}</div></div>`
    }
    let alvo = wp.rumoWp
    let bordos = ''
    if (ctx.polar && ok(twd) && ok(tws) && ok(wp.rumoWp)) {
      const ang = angulosOtimos(ctx.polar, tws)
      const b = bordejo({ rumoWp: wp.rumoWp, direcaoVento: twd, anguloBolina: ang.bolina, proa })
      if (b.contraVento) {
        const atual = b.bordoAtual === 'BB' ? b.amuraBB : b.amuraEB
        const outro = b.bordoAtual === 'BB' ? b.amuraEB : b.amuraBB
        alvo = b.virar ? outro : atual
        bordos = `<div class="tile ${b.virar ? 'perigo' : ''}" style="font-size:1.3rem;">
<div class="lab">WP contra o vento · bolina ótima ${num(graus(ang.bolina), 0)}° do vento real</div>
<div class="linha"><span>Amurado a EB: <b>${rumo(b.amuraEB)}</b></span><span>Amurado a BB: <b>${rumo(b.amuraBB)}</b></span></div>
<div class="vv" style="margin-top:.3rem;">${b.virar ? 'VIRA AGORA — chegaste à layline' : `Continua amurado a ${b.bordoAtual}; vira na layline`}</div></div>`
      }
    }
    const c = correcaoLeme(alvo, proa)
    const grande = !c ? '—'
      : c.lado === null ? '<span class="ok">✓ no rumo</span>'
        : c.lado === 'BB' ? `<span class="bb-txt">◀ ${c.graus}° BB</span>` : `<span class="eb-txt">${c.graus}° EB ▶</span>`
    return `<div class="col" style="flex:1.3;">
${plano}
<div class="tile centro" style="flex:1;">
  <div class="lab" style="font-size:1.2rem;">Rumo a seguir</div>
  <div class="vvv" style="font-size:6rem;">${rumo(alvo)}</div>
  <div class="vvv" style="font-size:4.6rem;margin-top:.4rem;">${grande}</div>
  <div style="font-size:1.3rem;margin-top:.5rem;">proa atual ${rumo(proa)}</div>
</div>
${bordos}
</div>
<div class="col estica">
<div class="tile"><div class="lab">${esc(wp.nome)}</div><div class="vv">${distancia(wp.dist)} MN · ${duracao(wp.ttg)}</div><div class="lab">rumo direto ${rumo(wp.rumoWp)}</div></div>
<div class="tile"><div class="lab">XTE ${ok(wp.xte) ? `${distancia(Math.abs(wp.xte), 2)} MN ${wp.xte > 0 ? 'EB' : 'BB'}` : '—'}</div>${barraXte(wp.xte)}</div>
<div class="tile"><div class="lab">VMG ao WP</div><div class="vv">${velocidade(wp.vmg)} nós</div></div>
<div class="tile"><div class="lab">Vento real</div><div class="vv">${velocidade(tws)} nós de ${rumo(twd)}</div></div>
${comPlano ? '' : `<div class="tile lab">A rota ótima (isócronas, GRIB) calcula-se no OpenCPN. Com o EV-100, este rumo passa a ir para o piloto.</div>
<div class="tile" style="flex:0 0 auto;">${NOVO}</div>`}
</div>`
  }
}
