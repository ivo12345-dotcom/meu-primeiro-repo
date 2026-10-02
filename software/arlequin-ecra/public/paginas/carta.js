// Carta: no Pi o OpenCPN ocupa os 58% da esquerda e esta página é o painel.
// Com ?demo mostra onde fica a carta, para testar no portátil.

import { mostradorVento } from '../lib/desenho.js'
import { percentagem } from '../lib/polar.js'
import { tile, ventoTexto, tileGasoleo, motorResumo, linhaAlvo, proximoWp, proa, marcaMag, velocidade, distancia, duracao, num, rumo, anguloBordo, ok, esc } from './comum.js'

export default {
  render (ctx) {
    const w = ventoTexto(ctx)
    const stw = ctx.v('navigation.speedThroughWater')
    const perc = ctx.polar ? percentagem(ctx.polar, stw, ctx.v('environment.wind.angleTrueWater'), ctx.v('environment.wind.speedTrue')) : null
    const m = motorResumo(ctx)
    const wp = proximoWp(ctx)
    const alvos = ctx.alvos.slice(0, 2)
    const pr = proa(ctx)
    const xteTxt = ok(wp.xte) ? `XTE ${distancia(Math.abs(wp.xte), 2)} MN ${wp.xte > 0 ? 'EB' : 'BB'}` : ''
    const painel = `<div class="col estica">
<div class="tile" style="flex-direction:row;align-items:center;justify-content:flex-start;gap:.8rem;">
  <div style="width:8rem;height:8rem;flex:none;">${mostradorVento(ctx.v('environment.wind.angleApparent'), ctx.v('environment.wind.angleTrueWater'))}</div>
  <div style="flex:1;"><div class="lab">Vento aparente</div><div class="vv">${w.aparente}</div><div class="azul">${w.real}</div></div>
</div>
<div class="g3">
  ${tile(`Proa${marcaMag(pr)}`, rumo(pr?.valor))}
  ${tile('COG · SOG', `${rumo(ctx.v('navigation.courseOverGroundTrue'))} · ${velocidade(ctx.v('navigation.speedOverGround'))}`)}
  ${tile('Fundo', `${num(ctx.v('environment.depth.belowTransducer'), 0)} m`)}
  ${tile('Vel. água', `${velocidade(stw)} nós`)}
  ${tile('Polar', `<span class="amarelo">${ok(perc) ? num(perc * 100, 0) + ' %' : '—'}</span>`)}
  ${tile('Abatim.', `<span class="amarelo">${anguloBordo(ctx.v('navigation.leewayAngle'))}</span>`)}
</div>
<div class="tile"><div class="linha"><span class="lab">${wp.ativo ? esc(wp.nome) : 'Sem rota ativa'}</span><span>${wp.ativo ? `${distancia(wp.dist)} MN · ${duracao(wp.ttg)}` : ''}</span></div><div class="lab">${xteTxt}</div></div>
<div class="tile"><div class="linha"><span class="lab">AIS</span><span class="lab">CPA · TCPA</span></div>${alvos.length ? alvos.map(linhaAlvo).join('') : '<div class="lab">sem alvos</div>'}</div>
<div class="tile"><div class="linha"><span class="lab">Motor</span>${m.estado}</div><div class="lab">${m.detalhe}</div></div>
${tileGasoleo(ctx)}
</div>`
    const cartaDemo = ctx.demo ? '<div class="carta-demo">Carta do OpenCPN<br>(no Pi, 58% do ecrã)</div>' : ''
    return cartaDemo + painel
  }
}
