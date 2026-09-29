// Motor e energia: rotação, temperatura, óleo, alternador, horas, alarmes,
// gasóleo; baterias, painéis e as últimas cargas pelo motor.

import { barra } from '../lib/desenho.js'
import { celsius } from '../lib/formato.js'
import { tile, tileGasoleo, num, ok } from './comum.js'
import { litrosPorMilha } from '../lib/consumo-milha.js'

function buscarSessoes (ctx) {
  if (ctx.estado.aBuscar || Date.now() - (ctx.estado.sessoesEm || 0) < 30000) return
  ctx.estado.aBuscar = true
  ctx.pedir('/plugins/signalk-arlequin-energia/sessoes?n=4')
    .then(r => { ctx.estado.sessoes = r.sessoes })
    .catch(() => { ctx.estado.sessoes = null })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.sessoesEm = Date.now() })
}

// Curva de consumo aprendida no barco (plugin J1939), de 30 em 30 s.
function buscarCurva (ctx) {
  if (ctx.estado.aBuscarCurva || Date.now() - (ctx.estado.curvaEm || 0) < 30000) return
  ctx.estado.aBuscarCurva = true
  ctx.pedir('/plugins/signalk-arlequin-j1939/consumo')
    .then(r => { ctx.estado.curva = r })
    .catch(() => { ctx.estado.curva = null })
    .finally(() => { ctx.estado.aBuscarCurva = false; ctx.estado.curvaEm = Date.now() })
}

// Estado do gasóleo (calibração), de 30 em 30 s.
function buscarGasoleo (ctx) {
  if (ctx.estado.aBuscarGas || Date.now() - (ctx.estado.gasEm || 0) < 30000) return
  ctx.estado.aBuscarGas = true
  ctx.pedir('/plugins/signalk-arlequin-gasoleo/estado')
    .then(r => { ctx.estado.gas = r })
    .catch(() => { ctx.estado.gas = null })
    .finally(() => { ctx.estado.aBuscarGas = false; ctx.estado.gasEm = Date.now() })
}

// Teclado numérico no ecrã (o Pi não tem teclado; dá para usar com luvas).
function teclado (t) {
  const titulo = t.modo === 'abasteci' ? 'Quantos litros meteste?' : 'Quantos litros tem o depósito agora?'
  const teclas = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫']
  return `<div class="teclado"><div class="tile teclado-caixa">
<div class="lab" style="font-size:1.2rem;">${titulo}</div>
<div class="vvv" style="margin:.4rem 0;">${t.valor || '0'} L</div>
<div class="teclas">${teclas.map(k => `<button class="acao" data-acao="tecla" data-t="${k}">${k}</button>`).join('')}</div>
<div class="acoes" style="margin-top:.5rem;"><button class="acao go" data-acao="teclado-ok">OK</button><button class="acao stop" data-acao="teclado-cancelar">Cancelar</button></div>
</div></div>`
}

const hm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default {
  aoEntrar (ctx) { ctx.estado.sessoesEm = 0; ctx.estado.curvaEm = 0; ctx.estado.gasEm = 0; buscarSessoes(ctx); buscarCurva(ctx); buscarGasoleo(ctx) },
  render (ctx) {
    buscarSessoes(ctx)
    buscarCurva(ctx)
    buscarGasoleo(ctx)
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
    const alarmes = ctx.notificacoes.filter(n => n.state !== 'normal' && /propulsion|energia|electrical|tanks/.test(n.caminho))
    const corSoc = !ok(soc) ? 'var(--linha)' : soc < 0.5 ? 'var(--bb)' : soc < 0.55 ? 'var(--amarelo)' : 'var(--verde)'
    const sess = ctx.estado.sessoes
    const tempC = ok(temp) ? celsius(temp) : null
    const g = ctx.estado.gas
    const gasInfo = g === undefined ? 'Sonda do gasóleo: a ligar…'
      : g === null ? 'Sonda do gasóleo: plugin não responde'
        : (g.tabela?.length || 0) < 2 ? `Sonda do gasóleo: falta calibrar (${g.tabela?.length || 0} pontos)`
          : `Sonda do gasóleo: ${g.tabela.length} pontos de calibração${g.ultimaSessao ? ` · última saída: ${num(g.ultimaSessao.medido, 1)} L medidos / ${num(g.ultimaSessao.esperado, 1)} L esperados` : ''}`
    // Litros por milha ao vivo: consumo ÷ velocidade (na água, senão no fundo).
    const vel = ctx.v('navigation.speedThroughWater') ?? ctx.v('navigation.speedOverGround')
    const lmn = litrosPorMilha(ligado && ok(taxa) ? taxa * 3600 * 1000 : null, vel)
    const c = ctx.estado.curva
    const regimes = !c || !c.faixas?.length
      ? 'Por regime: a aprender (1 min estável em cada faixa de 200 rpm)'
      : 'Por regime: ' + c.faixas.map(f => `${f.de} rpm ${num(f.lmn, 2)}${c.melhor?.de === f.de ? ' ★' : ''}`).join(' · ') + ' L/MN'
    return `<div class="col estica">
<div class="tile"><div class="linha"><span class="lab">Volvo Penta D1-20B</span><span class="${ligado ? 'amarelo' : 'ok'}">${ligado ? 'a trabalhar' : 'desligado'}</span></div>
  <div class="vvv">${ok(rpm) ? num(rpm * 60, 0) : '—'} <span style="font-size:1.4rem;">rpm</span></div></div>
<div class="g2">
  ${tile('Temperatura', `<span class="${tempC > 95 ? 'perigo' : ''}">${ok(tempC) ? num(tempC, 0) + ' °C' : '—'}</span>`, '', 'vv')}
  ${tile('Pressão do óleo', ligado ? `${ok(oleo) ? num(oleo / 1e5, 1) + ' bar' : '—'}` : '—', '', 'vv')}
  ${tile('Alternador', ligado && ok(alt) ? `${num(alt, 1)} V` : '—', '', 'vv')}
  ${tile('Horas de motor', ok(horas) ? `${num(horas / 3600, 1)} h` : '—', '', 'vv')}
</div>
<div class="tile"><div class="linha"><span class="lab">Consumo</span><span class="v">${ligado && ok(taxa) ? `${num(taxa * 3600 * 1000, 1)} L/h · ${ok(lmn) ? num(lmn, 2) + ' L/MN' : '— L/MN'}` : '—'}</span></div>
  <div class="lab">${regimes}</div></div>
${tileGasoleo(ctx, true)}
<div class="tile" style="flex:0 0 auto;"><div class="linha"><span class="lab">${gasInfo}</span>
  <span class="acoes"><button class="btn" style="padding:.4rem .9rem;" data-acao="abrir-teclado" data-modo="abasteci">Abasteci</button><button class="btn" style="padding:.4rem .9rem;" data-acao="abrir-teclado" data-modo="calibrar">Calibrar</button></span></div>
  ${ctx.estado.msgGas ? `<div class="${ctx.estado.msgGasErro ? 'perigo' : 'ok'}">${ctx.estado.msgGas}</div>` : ''}</div>
<div class="tile"><div class="lab">Alarmes do motor, da energia e do gasóleo</div>${alarmes.length ? alarmes.map(n => `<div class="${n.state === 'warn' ? 'atencao' : 'perigo'}">${n.message}</div>`).join('') : '<div class="ok">sem alarmes</div>'}</div>
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
</div>${ctx.estado.teclado ? teclado(ctx.estado.teclado) : ''}`
  },
  async acao (nome, dados, ctx) {
    const e = ctx.estado
    if (nome === 'abrir-teclado') e.teclado = { modo: dados.modo, valor: '' }
    if (nome === 'teclado-cancelar') e.teclado = null
    if (nome === 'tecla' && e.teclado) {
      const v = e.teclado.valor
      if (dados.t === '⌫') e.teclado.valor = v.slice(0, -1)
      else if (dados.t === ',') { if (!v.includes(',')) e.teclado.valor = (v || '0') + ',' }
      else if (v.length < 5) e.teclado.valor = v + dados.t
    }
    if (nome === 'teclado-ok' && e.teclado) {
      const { modo, valor } = e.teclado
      e.teclado = null
      const rota = modo === 'abasteci' ? 'abastecimento' : 'calibrar'
      try {
        const r = await ctx.pedir(`/plugins/signalk-arlequin-gasoleo/${rota}`, { method: 'POST', body: { litros: valor } })
        e.msgGas = modo === 'abasteci' ? `Abastecimento registado: ${Math.round(r.antes)} → ${Math.round(r.depois)} L` : `Calibrado: ${valor} L`
        e.msgGasErro = false
        e.gasEm = 0
      } catch (err) {
        e.msgGas = err.status === 409 ? 'Ainda a medir: espera 3 min com o barco direito' : `Não gravou: ${err.message}`
        e.msgGasErro = true
      }
    }
  }
}
