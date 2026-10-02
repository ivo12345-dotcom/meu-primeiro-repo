// Instrumentos: vento grande com VMG, polar, desempenho, proa, fundo, adorno,
// abatimento, barómetro com tendência, corrente e cabine.

import { mostradorVento, polarSvg } from '../lib/desenho.js'
import { percentagem, velocidadeAlvo } from '../lib/polar.js'
import { ventoTexto, proa, marcaMag, velocidade, num, rumo, anguloBordo, graus, nos, ok } from './comum.js'
import { hpa, celsius } from '../lib/formato.js'

export default {
  render (ctx) {
    const w = ventoTexto(ctx)
    const twa = ctx.v('environment.wind.angleTrueWater')
    const tws = ctx.v('environment.wind.speedTrue')
    const stw = ctx.v('navigation.speedThroughWater')
    const alvo = ctx.polar && ok(twa) && ok(tws) ? velocidadeAlvo(ctx.polar, twa, tws) : null
    const perc = ctx.polar ? percentagem(ctx.polar, stw, twa, tws) : null
    const vmg = ok(stw) && ok(twa) ? stw * Math.cos(twa) : null
    const roll = ctx.v('navigation.attitude')?.roll
    const cur = ctx.v('environment.current')
    const p = ctx.v('environment.outside.pressure')
    const t = ctx.baro
    const tend = !t ? 'a medir (3 h)' : `${t.sentido === 'sobe' ? '▲' : t.sentido === 'desce' ? '▼' : '▬'} ${num(Math.abs(t.hpa3h), 1)} hPa/3 h`
    const tIn = ctx.v('environment.inside.temperature')
    const hIn = ctx.v('environment.inside.relativeHumidity')
    const pr = proa(ctx)
    return `<div class="tile centro" style="flex:1.15;">
  <div style="width:min(30rem,90%);aspect-ratio:1;">${mostradorVento(ctx.v('environment.wind.angleApparent'), twa)}</div>
  <div class="vv">${w.aparente}</div><div class="lab">aparente</div>
  <div class="azul" style="font-size:1.2rem;margin-top:.3rem;">${w.real} · TWA ${ok(twa) ? num(Math.abs(graus(twa)), 0) + '°' : '—'}</div>
  <div style="font-size:1.2rem;margin-top:.2rem;">${ok(vmg) && vmg < 0 ? `VMG a favor do vento ${velocidade(-vmg)} nós` : `VMG ao vento ${velocidade(vmg)} nós`}</div>
</div>
<div class="tile" style="flex:1;display:flex;flex-direction:column;">
  <div class="lab">Polar do Arlequin · vento real ${velocidade(tws, 0)} nós (estimada)</div>
  <div style="flex:1;min-height:0;">${polarSvg(ctx.polar, ok(tws) ? nos(tws) : 10, { twa, v: ok(alvo) ? nos(alvo) : null }, { twa, v: ok(stw) ? nos(stw) : null })}</div>
  <div class="lab"><span class="amarelo">●</span> alvo ${velocidade(alvo)} nós · ○ real ${velocidade(stw)} nós</div>
</div>
<div class="col estica" style="flex:1;">
  <div class="tile"><div class="lab">Desempenho</div><div class="vvv amarelo">${ok(perc) ? num(perc * 100, 0) + ' %' : '—'}</div><div class="lab">da polar · alvo ${velocidade(alvo)} nós</div></div>
  <div class="tile"><div class="lab">Proa${marcaMag(pr)} · fundo</div><div class="vv">${rumo(pr?.valor)} · ${num(ctx.v('environment.depth.belowTransducer'), 0)} m</div>
    <div class="lab">adorno ${ok(roll) ? anguloBordo(roll) : '—'} · abatimento ${anguloBordo(ctx.v('navigation.leewayAngle'))}</div></div>
  <div class="tile"><div class="lab">Barómetro · corrente</div><div class="vv" style="font-size:1.6rem;">${p ? num(hpa(p), 0) : '—'} hPa</div><div>${tend}</div>
    <div class="azul">corrente ${ok(cur?.drift) ? velocidade(cur.drift) + ' nós → ' + rumo(cur.setTrue) : '—'}</div>
    <div class="lab">cabine ${ok(tIn) ? num(celsius(tIn), 0) + ' °C' : '—'} · ${ok(hIn) ? num(hIn * 100, 0) + ' %' : '—'}</div></div>
</div>`
  }
}
