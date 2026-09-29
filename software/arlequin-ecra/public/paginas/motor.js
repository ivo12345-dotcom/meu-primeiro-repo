// Motor e energia: rotação, temperatura, óleo, alternador, horas, alarmes,
// gasóleo; baterias, painéis e as últimas cargas pelo motor.

import { barra } from '../lib/desenho.js'
import { celsius } from '../lib/formato.js'
import { tile, tileGasoleo, num, ok } from './comum.js'

function buscarSessoes (ctx) {
  if (ctx.estado.aBuscar || Date.now() - (ctx.estado.sessoesEm || 0) < 30000) return
  ctx.estado.aBuscar = true
  ctx.pedir('/plugins/signalk-arlequin-energia/sessoes?n=4')
    .then(r => { ctx.estado.sessoes = r.sessoes })
    .catch(() => { ctx.estado.sessoes = null })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.sessoesEm = Date.now() })
}

const hm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default {
  aoEntrar (ctx) { ctx.estado.sessoesEm = 0; buscarSessoes(ctx) },
  render (ctx) {
    buscarSessoes(ctx)
    const rpm = ctx.v('propulsion.main.revolutions')
    const ligado = ok(rpm) && rpm > 5
    const temp = ctx.v('propulsion.main.temperature')
    const oleo = ctx.v('propulsion.main.oilPressure')
    const alt = ctx.v('propulsion.main.alternatorVoltage')
    const horas = ctx.v('propulsion.main.runTime')
    const taxa = ctx.v('propulsion.main.fuel.rate')
    const soc = ctx.v('electrical.batteries.servico.capacity.stateOfCharge')
    const i = ctx.v('electrical.batteries.servico.current')
    const vs = ctx.v('electrical.batteries.servico.voltage')
    const vm = ctx.v('electrical.batteries.motor.voltage')
    const pv1 = ctx.v('electrical.solar.mppt1.panelPower')
    const pv2 = ctx.v('electrical.solar.mppt2.panelPower')
    const alarmes = ctx.notificacoes.filter(n => n.state !== 'normal' && /propulsion|energia|electrical/.test(n.caminho))
    const corSoc = !ok(soc) ? 'var(--linha)' : soc < 0.5 ? 'var(--bb)' : soc < 0.55 ? 'var(--amarelo)' : 'var(--verde)'
    const sess = ctx.estado.sessoes
    const tempC = ok(temp) ? celsius(temp) : null
    return `<div class="col estica">
<div class="tile"><div class="linha"><span class="lab">Volvo Penta D1-20B</span><span class="${ligado ? 'amarelo' : 'ok'}">${ligado ? 'a trabalhar' : 'desligado'}</span></div>
  <div class="vvv">${ok(rpm) ? num(rpm * 60, 0) : '—'} <span style="font-size:1.4rem;">rpm</span></div></div>
<div class="g2">
  ${tile('Temperatura', `<span class="${tempC > 95 ? 'perigo' : ''}">${ok(tempC) ? num(tempC, 0) + ' °C' : '—'}</span>`, '', 'vv')}
  ${tile('Pressão do óleo', ligado ? `${ok(oleo) ? num(oleo / 1e5, 1) + ' bar' : '—'}` : '—', '', 'vv')}
  ${tile('Alternador', ligado && ok(alt) ? `${num(alt, 1)} V` : '—', '', 'vv')}
  ${tile('Horas de motor', ok(horas) ? `${num(horas / 3600, 1)} h` : '—', '', 'vv')}
</div>
<div class="tile"><div class="linha"><span class="lab">Consumo</span><span>${ligado && ok(taxa) ? num(taxa * 3600 * 1000, 1) + ' L/h' : '—'}</span></div></div>
${tileGasoleo(ctx, true)}
<div class="tile"><div class="lab">Alarmes do motor e da energia</div>${alarmes.length ? alarmes.map(n => `<div class="${n.state === 'warn' ? 'atencao' : 'perigo'}">${n.message}</div>`).join('') : '<div class="ok">sem alarmes</div>'}</div>
</div>
<div class="col estica">
<div class="tile"><div class="linha"><span class="lab">Serviço · 440 Ah AGM</span><span class="vv">${ok(soc) ? num(Math.floor(soc * 100 + 1e-9), 0) + ' %' : '—'}</span></div>${barra(soc, corSoc)}
  <div class="linha" style="margin-top:.3rem;"><span>${ok(i) ? (i >= 0 ? `<span class="ok">a carregar ${num(i, 1)} A</span>` : `a gastar ${num(-i, 1)} A`) : '—'}</span><span>${ok(vs) ? num(vs, 2) + ' V' : '—'}</span></div></div>
<div class="g2">
  ${tile('Painéis (2 × 305 W)', ok(pv1) || ok(pv2) ? `${num((pv1 || 0) + (pv2 || 0), 0)} W` : '—', `<div class="lab">BB ${num(pv1, 0)} W · EB ${num(pv2, 0)} W</div>`, 'vv')}
  ${tile('Bateria do motor', `<span class="${ok(vm) && vm < 12.2 && !ligado ? 'perigo' : ''}">${ok(vm) ? num(vm, 1) + ' V' : '—'}</span>`, '', 'vv')}
</div>
<div class="tile" style="flex:1;"><div class="lab">Últimas cargas pelo motor</div>
${sess === undefined ? '<div class="lab">a carregar…</div>' : sess === null ? '<div class="lab">plugin de energia não responde</div>' : sess.length === 0 ? '<div class="lab">ainda nenhuma</div>'
  : sess.map(s => `<div class="linha"><span>${hm(s.inicio)}</span><span>${Math.floor(s.duracaoMin / 60)} h ${String(s.duracaoMin % 60).padStart(2, '0')} · +${num(s.ah, 1)} Ah · ${Math.round(s.socInicial * 100)}→${Math.round(s.socFinal * 100)}%</span></div>`).join('')}
</div>
</div>`
  }
}
