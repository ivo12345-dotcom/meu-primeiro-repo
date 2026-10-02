// Motor e energia: rotação, temperatura, óleo, alternador, horas, alarmes,
// gasóleo; baterias, painéis e as últimas cargas pelo motor.

import { barra } from '../lib/desenho.js'
import { celsius } from '../lib/formato.js'
import { tile, tileGasoleo, num, ok, esc } from './comum.js'
import { litrosPorMilha } from '../lib/consumo-milha.js'
import { motivo } from '../lib/erros.js'

function buscarSessoes (ctx) {
  if (ctx.estado.aBuscar || Date.now() - (ctx.estado.sessoesEm || 0) < 30000) return
  ctx.estado.aBuscar = true
  ctx.pedir('/plugins/signalk-arlequin-energia/sessoes?n=4')
    .then(r => { ctx.estado.sessoes = r.sessoes; ctx.estado.sessoesErro = null })
    .catch(err => { ctx.estado.sessoes = null; ctx.estado.sessoesErro = motivo(err, 'o plugin da energia') })
    .finally(() => { ctx.estado.aBuscar = false; ctx.estado.sessoesEm = Date.now() })
}

// Curva de consumo aprendida no barco (plugin J1939), de 30 em 30 s.
function buscarCurva (ctx) {
  if (ctx.estado.aBuscarCurva || Date.now() - (ctx.estado.curvaEm || 0) < 30000) return
  ctx.estado.aBuscarCurva = true
  ctx.pedir('/plugins/signalk-arlequin-j1939/consumo')
    .then(r => { ctx.estado.curva = r; ctx.estado.curvaErro = null })
    .catch(err => { ctx.estado.curva = null; ctx.estado.curvaErro = motivo(err, 'o plugin do J1939') })
    .finally(() => { ctx.estado.aBuscarCurva = false; ctx.estado.curvaEm = Date.now() })
}

// Estado do gasóleo (calibração), de 30 em 30 s.
function buscarGasoleo (ctx) {
  if (ctx.estado.aBuscarGas || Date.now() - (ctx.estado.gasEm || 0) < 30000) return
  ctx.estado.aBuscarGas = true
  ctx.pedir('/plugins/signalk-arlequin-gasoleo/estado')
    .then(r => { ctx.estado.gas = r; ctx.estado.gasErro = null })
    .catch(err => { ctx.estado.gas = null; ctx.estado.gasErro = motivo(err, 'o plugin do gasóleo') })
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

// Calibração completa do depósito (vazio e +5 L de cada vez): estado de 2 em 2 s.
function buscarCalib (ctx) {
  if (ctx.estado.aBuscarCalib || Date.now() - (ctx.estado.calibEm || 0) < 2000) return
  ctx.estado.aBuscarCalib = true
  ctx.pedir('/plugins/signalk-arlequin-gasoleo/calibracao')
    .then(r => { ctx.estado.calib = r; ctx.estado.calibErro = null })
    .catch(err => { ctx.estado.calib = null; ctx.estado.calibErro = motivo(err, 'o plugin do gasóleo') })
    .finally(() => { ctx.estado.aBuscarCalib = false; ctx.estado.calibEm = Date.now() })
}

function painelCalib (c, msg, erro) {
  // números do plugin do gasóleo: "—" se não forem números (nunca rebenta nem passa texto cru)
  const nf = (x, d = 0) => num(x, d)
  if (!c) return erro ? `<div class="perigo">${esc(erro)}</div><div class="acoes" style="margin-top:.6rem;"><button class="acao" data-acao="calib-fechar">Fechar</button></div>` : '<div class="lab">A ligar ao plugin do gasóleo…</div>'
  if (!c.ativa) {
    return `<div class="vv">Calibração completa do depósito</div>
<div style="font-size:1.15rem;margin:.5rem 0;">Com o depósito <b>vazio e limpo</b>, o barco direito e o motor desligado. Depois deitas o gasóleo aos 5 L e carregas em "+5 L" de cada vez: o sistema espera que a leitura estabilize e grava.</div>
<div class="lab">Tabela atual: ${num(c.tabela?.length || 0, 0)} pontos · capacidade ${num(c.capacidadeL, 0)} L</div>
<div class="acoes" style="margin-top:.6rem;"><button class="acao go" data-acao="calib-iniciar">Começar (depósito vazio)</button><button class="acao" data-acao="calib-fechar">Fechar</button></div>`
  }
  const ultimos = (Array.isArray(c.pontos) ? c.pontos : []).slice(-6).reverse().map(p => `<div class="linha"><span>${nf(p.litros)} L</span><span class="lab">razão ${nf(p.razao, 4)}</span></div>`).join('')
  const pronto = !c.pendente
  return `<div class="linha"><span class="vv">No depósito: ${nf(c.total)} L</span><span class="${pronto ? 'ok' : 'atencao'}" style="font-size:1.3rem;">${pronto ? '✓ pronto: deita mais' : '⏳ a estabilizar…'}</span></div>
<div class="lab">${num((c.pontos || []).length, 0)} pontos gravados · razão agora ${nf(c.razaoAtual, 4)}</div>
${c.boiaParada ? `<div class="atencao">A boia não mexeu entre ${nf(c.boiaParada.de)} e ${nf(c.boiaParada.ate)} L: aí o medidor não vê diferença.</div>` : ''}
<div class="acoes" style="margin:.6rem 0;"><button class="acao go" data-acao="calib-mais" data-l="5" ${pronto ? '' : 'disabled style="opacity:.5"'}>+5 L</button><button class="acao go" data-acao="calib-mais" data-l="10" ${pronto ? '' : 'disabled style="opacity:.5"'}>+10 L</button><button class="acao" data-acao="calib-desfazer">Desfazer</button></div>
<div style="max-height:9rem;overflow:auto;">${ultimos}</div>
${msg ? `<div class="perigo">${esc(msg)}</div>` : ''}
<div class="acoes" style="margin-top:.6rem;"><button class="acao go" data-acao="calib-terminar" data-cheio="1">Terminar: está cheio</button><button class="acao" data-acao="calib-terminar" data-cheio="">Terminar (não está cheio)</button><button class="acao stop" data-acao="calib-cancelar">Cancelar</button></div>`
}

// Água doce: ritmo e calibração da bomba (plugin signalk-arlequin-agua).
function buscarAgua (ctx, intervalo = 10000) {
  if (ctx.estado.aBuscarAgua || Date.now() - (ctx.estado.aguaEm || 0) < intervalo) return
  ctx.estado.aBuscarAgua = true
  ctx.pedir('/plugins/signalk-arlequin-agua/estado')
    .then(r => { ctx.estado.agua = r; ctx.estado.aguaErro = null })
    .catch(err => { ctx.estado.agua = null; ctx.estado.aguaErro = motivo(err, 'o plugin da água') })
    .finally(() => { ctx.estado.aBuscarAgua = false; ctx.estado.aguaEm = Date.now() })
}

function tileAgua (ctx) {
  const tanques = [0, 1].map(id => ({
    id,
    nome: ctx.v(`tanks.freshWater.${id}.name`),
    litros: ctx.v(`tanks.freshWater.${id}.currentVolume`),
    frac: ctx.v(`tanks.freshWater.${id}.currentLevel`),
    ritmo: ctx.estado.agua?.tanques?.find(t => t.id === id)?.ritmo
  })).filter(t => t.nome)
  const erro = ctx.estado.msgAgua || ctx.estado.aguaErro
  const erroHtml = erro && !(ctx.estado.bombaCalib !== undefined && ctx.estado.bombaCalib !== null) ? `<div class="perigo">${esc(erro)}</div>` : ''
  if (!tanques.length) return `<div class="tile"><div class="lab">Água doce</div><div class="lab">sem dados das bombas</div>${erroHtml}</div>`
  return `<div class="tile" style="flex:0 0 auto;"><div class="lab">Água doce</div>${erroHtml}${tanques.map(t => `
<div class="linha" style="margin-top:.25rem;"><span>${esc(t.nome)}</span><span class="v">${num(t.litros * 1000, 0)} L${t.ritmo?.dias ? ` <span class="lab">· ~${num(t.ritmo.dias, 1)} dias</span>` : ''}</span></div>
${barra(t.frac, t.frac <= 0.2 ? 'var(--bb)' : 'var(--azul)')}
<div class="acoes" style="margin-top:.2rem;"><button class="btn" style="padding:.3rem .8rem;" data-acao="agua-encher" data-id="${t.id}">Enchi</button><button class="btn" style="padding:.3rem .8rem;" data-acao="agua-calib" data-id="${t.id}">Calibrar bomba</button></div>`).join('')}</div>`
}

function painelBomba (ctx) {
  const id = ctx.estado.bombaCalib
  const t = ctx.estado.agua?.tanques?.find(x => x.id === id)
  return `<div class="teclado"><div class="tile teclado-caixa">
<div class="vv">Calibrar a bomba: ${esc(t?.nome || '')}</div>
<div style="font-size:1.15rem;margin:.5rem 0;">Bombeia água para uma <b>jarra de 1 L</b> até encher e carrega em Terminar.</div>
<div class="vvv">${t?.pedaladasCalibracao ?? 0} <span style="font-size:1.4rem;">pedaladas</span></div>
${ctx.estado.msgAgua ? `<div class="perigo">${esc(ctx.estado.msgAgua)}</div>` : ''}
<div class="acoes" style="margin-top:.6rem;"><button class="acao go" data-acao="bomba-terminar">Terminar (1 L)</button><button class="acao stop" data-acao="bomba-cancelar">Cancelar</button></div>
</div></div>`
}

const hm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default {
  aoEntrar (ctx) { ctx.estado.sessoesEm = 0; ctx.estado.curvaEm = 0; ctx.estado.gasEm = 0; buscarSessoes(ctx); buscarCurva(ctx); buscarGasoleo(ctx) },
  render (ctx) {
    buscarSessoes(ctx)
    buscarCurva(ctx)
    buscarGasoleo(ctx)
    if (ctx.estado.calibAberta) buscarCalib(ctx)
    buscarAgua(ctx, ctx.estado.bombaCalib !== undefined && ctx.estado.bombaCalib !== null ? 1500 : 10000)
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
      : g === null ? `Sonda do gasóleo: ${ctx.estado.gasErro || 'o plugin do gasóleo não responde'}`
        : (g.tabela?.length || 0) < 2 ? `Sonda do gasóleo: falta calibrar (${g.tabela?.length || 0} pontos)`
          : `Sonda do gasóleo: ${g.tabela.length} pontos de calibração${g.ultimaSessao ? ` · última saída: ${num(g.ultimaSessao.medido, 1)} L medidos / ${num(g.ultimaSessao.esperado, 1)} L esperados` : ''}`
    // Litros por milha ao vivo: consumo ÷ velocidade (na água, senão no fundo).
    const vel = ctx.v('navigation.speedThroughWater') ?? ctx.v('navigation.speedOverGround')
    const lmn = litrosPorMilha(ligado && ok(taxa) ? taxa * 3600 * 1000 : null, vel)
    const c = ctx.estado.curva
    const regimes = c === null && ctx.estado.curvaErro ? `Por regime: ${ctx.estado.curvaErro}`
      : !c || !c.faixas?.length
      ? 'Por regime: a aprender (1 min estável em cada faixa de 200 rpm)'
      : 'Por regime: ' + c.faixas.map(f => `${num(f.de, 0)} rpm ${num(f.lmn, 2)}${c.melhor?.de === f.de ? ' ★' : ''}`).join(' · ') + ' L/MN'
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
  <div class="lab">${esc(regimes)}</div></div>
${tileGasoleo(ctx, true)}
<div class="tile" style="flex:0 0 auto;"><div class="linha"><span class="lab">${esc(gasInfo)}</span>
  <span class="acoes"><button class="btn" style="padding:.4rem .9rem;" data-acao="abrir-teclado" data-modo="abasteci">Abasteci</button><button class="btn" style="padding:.4rem .9rem;" data-acao="abrir-teclado" data-modo="calibrar">Calibrar</button><button class="btn" style="padding:.4rem .9rem;" data-acao="calib-abrir">Calibração completa</button></span></div>
  ${ctx.estado.msgGas ? `<div class="${ctx.estado.msgGasErro ? 'perigo' : 'ok'}">${esc(ctx.estado.msgGas)}</div>` : ''}</div>
<div class="tile"><div class="lab">Alarmes do motor, da energia e dos depósitos</div>${alarmes.length ? alarmes.map(n => `<div class="${n.state === 'warn' ? 'atencao' : 'perigo'}">${esc(n.message)}</div>`).join('') : '<div class="ok">sem alarmes</div>'}</div>
</div>
<div class="col estica">
<div class="tile"><div class="linha"><span class="lab">Serviço · 440 Ah AGM</span><span class="vv">${ok(soc) ? num(Math.floor(soc * 100 + 1e-9), 0) + ' %' : '—'}</span></div>${barra(soc, corSoc)}
  <div class="linha" style="margin-top:.3rem;"><span>${ok(i) ? (i >= 0 ? `<span class="ok">a carregar ${num(i, 1)} A</span>` : `a gastar ${num(-i, 1)} A`) : '—'}</span><span>${ok(vs) ? num(vs, 2) + ' V' : '—'}</span></div></div>
<div class="g2">
  ${tile('Painéis (2 × 305 W)', ok(pv1) || ok(pv2) ? `${num((pv1 || 0) + (pv2 || 0), 0)} W` : '—', `<div class="lab">BB ${num(pv1, 0)} W · EB ${num(pv2, 0)} W</div>`, 'vv')}
  ${tile('Bateria do motor', `<span class="${ok(vm) && vm < 12.2 && !ligado ? 'perigo' : ''}">${ok(vm) ? num(vm, 1) + ' V' : '—'}</span>`, '', 'vv')}
</div>
${tileAgua(ctx)}
<div class="tile" style="flex:1;"><div class="lab">Últimas cargas pelo motor</div>
${sess === undefined ? '<div class="lab">a carregar…</div>' : sess === null ? `<div class="lab">${esc(ctx.estado.sessoesErro || 'o plugin da energia não responde')}</div>` : sess.length === 0 ? '<div class="lab">ainda nenhuma</div>'
  : sess.map(s => `<div class="linha"><span>${hm(s.inicio)}</span><span>${Math.floor(s.duracaoMin / 60)} h ${String(s.duracaoMin % 60).padStart(2, '0')} · +${num(s.ah, 1)} Ah · ${Math.round(s.socInicial * 100)}→${Math.round(s.socFinal * 100)}%</span></div>`).join('')}
</div>
</div>${ctx.estado.teclado ? teclado(ctx.estado.teclado) : ''}${ctx.estado.bombaCalib !== undefined && ctx.estado.bombaCalib !== null ? painelBomba(ctx) : ''}${ctx.estado.calibAberta ? `<div class="teclado"><div class="tile teclado-caixa" style="width:min(44rem,94vw);">${painelCalib(ctx.estado.calib, ctx.estado.msgCalib, ctx.estado.calibErro)}</div></div>` : ''}`
  },
  async acao (nome, dados, ctx) {
    const e = ctx.estado
    const calib = async (rota, corpo = {}) => {
      try {
        e.calib = await ctx.pedir(`/plugins/signalk-arlequin-gasoleo/calibracao${rota}`, { method: 'POST', body: corpo })
        e.msgCalib = null
      } catch (err) { e.msgCalib = motivo(err, 'o plugin do gasóleo') }
      e.calibEm = 0
    }
    const aguaPost = async (rota, corpo) => {
      try { await ctx.pedir(`/plugins/signalk-arlequin-agua/${rota}`, { method: 'POST', body: corpo }); e.msgAgua = null; return true } catch (err) { e.msgAgua = motivo(err, 'o plugin da água'); return false } finally { e.aguaEm = 0 }
    }
    if (nome === 'agua-encher' && confirm('Encheste este depósito de água?')) await aguaPost('encher', { id: Number(dados.id) })
    if (nome === 'agua-calib') { e.bombaCalib = Number(dados.id); e.msgAgua = null; await aguaPost('calibrar-bomba/iniciar', { id: e.bombaCalib }) }
    if (nome === 'bomba-cancelar') { await aguaPost('calibrar-bomba/cancelar', { id: e.bombaCalib }); e.bombaCalib = null }
    if (nome === 'bomba-terminar' && await aguaPost('calibrar-bomba/terminar', { id: e.bombaCalib, litros: 1 })) e.bombaCalib = null
    if (nome === 'calib-abrir') { e.calibAberta = true; e.calibEm = 0; e.msgCalib = null }
    if (nome === 'calib-fechar') e.calibAberta = false
    if (nome === 'calib-iniciar') await calib('/iniciar')
    if (nome === 'calib-mais') await calib('/adicionar', { litros: dados.l })
    if (nome === 'calib-desfazer') await calib('/desfazer')
    if (nome === 'calib-cancelar' && confirm('Cancelar a calibração? Fica a tabela antiga.')) { await calib('/cancelar'); e.calibAberta = false }
    if (nome === 'calib-terminar') {
      await calib('/terminar', { cheio: !!dados.cheio })
      if (!e.msgCalib) { e.calibAberta = false; e.msgGas = 'Calibração guardada'; e.msgGasErro = false; e.gasEm = 0 }
    }
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
        e.msgGas = err.status === 409 ? 'Ainda a medir: espera 3 min com o barco direito' : `Não gravou: ${motivo(err, 'o plugin do gasóleo')}`
        e.msgGasErro = true
      }
    }
  }
}
