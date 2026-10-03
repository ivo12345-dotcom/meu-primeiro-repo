// Velas: o estado atual (grande e genoa), que só o Ivo sabe e fica gravado na
// caixa negra para a AI, e recolher velas sem piloto, passo a passo. Motor
// ligado → aproar ao vento (rumo alvo = direção do vento real) → recolher →
// terminar. Tudo no diário.

import { correcaoLeme, rumoAproar } from '../lib/rumo.js'
import { rumo, velocidade, esc, proa as proaDe, marcaMag, motorEstado } from './comum.js'
import { motivo } from '../lib/erros.js'

const PASSOS = ['Liga o motor', 'Aproa ao vento', 'Recolhe as velas', 'Terminado']

const URL_VELAS = '/plugins/signalk-arlequin-caixanegra/velas'
const GRANDE = [[0, 'Inteira'], [1, '1 rizo'], [2, '2 rizos'], [-1, 'Arriada']]
const GENOA = [[100, '100%'], [70, '70%'], [50, '50%'], [0, 'Enrolada']]

function estadoVelas (ctx) {
  const opcoes = (acao, lista, atual) => lista
    .map(([v, t]) => `<button class="acao${v === atual ? ' go' : ''}" data-acao="${acao}" data-valor="${v}">${t}</button>`)
    .join('')
  return `<div class="tile"><div class="lab">Grande</div><div class="acoes">${opcoes('grande', GRANDE, ctx.v('sails.grande.rizos'))}</div>
<div class="lab" style="margin-top:.4rem;">Genoa</div><div class="acoes">${opcoes('genoa', GENOA, ctx.v('sails.genoa.percentagem'))}</div></div>`
}

export default {
  render (ctx) {
    const e = ctx.estado
    const passo = e.passo ?? -1
    const estadoMotor = motorEstado(ctx) // null: sem leitura (auditoria I-23, contrato C11)
    const motor = estadoMotor === true
    const twd = ctx.v('environment.wind.directionTrue')
    const pr = proaDe(ctx)
    const proa = pr?.valor ?? null
    const alvo = rumoAproar(twd)
    const c = correcaoLeme(alvo, proa)
    const aproado = c && c.graus <= 10
    if (passo === 0 && motor) e.passo = 1 // o motor ligou: avança sozinho
    const p = e.passo ?? -1

    const lista = PASSOS.map((t, i) => `<div class="passo ${i < p ? 'feito' : ''} ${i === p ? 'atual' : ''}"><span class="n">${i < p ? '✓' : i + 1}</span><span>${t}${i === 0 && p === 0 ? (estadoMotor === null ? ' — sem leitura do motor' : ' — à espera das rotações') : ''}</span></div>`).join('')
    const guia = p === 0
      ? `<div class="tile centro" style="flex:1;"><div class="vvv">Liga o motor</div><div style="font-size:1.3rem;margin-top:.6rem;">${motor ? '<span class="ok">Motor ligado ✓</span>' : estadoMotor === null ? '<span class="lab">sem leitura do motor: confirma-o no painel do motor</span>' : 'à espera das rotações do motor…'}</div></div>`
      : p === 1
      ? `<div class="tile centro" style="flex:1;"><div class="lab" style="font-size:1.2rem;">Aproa ao vento: rumo</div><div class="vvv" style="font-size:6rem;">${rumo(alvo)}</div>
<div class="vvv" style="font-size:4.4rem;margin-top:.4rem;">${!c ? '—' : aproado ? '<span class="ok">✓ aproado</span>' : c.lado === 'BB' ? `◀ ${c.graus}° BB` : `${c.graus}° EB ▶`}</div>
<div style="font-size:1.2rem;margin-top:.4rem;">proa ${rumo(proa)}${marcaMag(pr)} · vento real ${velocidade(ctx.v('environment.wind.speedTrue'))} nós</div></div>`
      : p === 2
        ? '<div class="tile centro" style="flex:1;"><div class="vv">Mantém aproado e recolhe as velas.</div><div style="font-size:1.2rem;margin-top:.5rem;">Quando acabares, carrega em "Velas recolhidas".</div></div>'
        : p === 3
          ? '<div class="tile centro" style="flex:1;"><div class="vv ok">Velas recolhidas.</div><div class="lab">Ficou registado no diário.</div></div>'
          : `<div class="tile centro" style="flex:1;"><div class="vv">Recolher velas</div><div style="font-size:1.2rem;margin-top:.5rem;max-width:34rem;">Sem piloto: o ecrã guia-te. Liga o motor, aproa ao vento com o rumo indicado e recolhe. Cada passo fica no diário.</div>
${!motor ? '' : '<div class="ok" style="margin-top:.4rem;">Motor já está ligado.</div>'}</div>`
    const botoes = p === -1 || p === 3
      ? '<button class="acao go" data-acao="comecar">Começar</button>'
      : `${p === 1 ? `<button class="acao go" data-acao="aproado" ${aproado ? '' : 'style="opacity:.6"'}>Estou aproado</button>` : ''}${p === 2 ? '<button class="acao go" data-acao="recolhidas">Velas recolhidas</button>' : ''}<button class="acao stop" data-acao="cancelar">Cancelar</button>`
    return `<div class="col" style="flex:1.3;">${guia}</div>
<div class="col">${estadoVelas(ctx)}<div class="tile" style="flex:1;">${lista}</div>${e.msg ? `<div class="tile ${e.msgErro ? 'perigo' : 'lab'}">${esc(e.msg)}</div>` : ''}<div class="acoes">${botoes}</div></div>`
  },
  async acao (nome, dados, ctx) {
    const e = ctx.estado
    if (nome === 'grande' || nome === 'genoa') {
      const body = nome === 'grande' ? { grandeRizos: Number(dados.valor) } : { genoaPct: Number(dados.valor) }
      try { await ctx.pedir(URL_VELAS, { method: 'POST', body }); e.msg = null } catch (err) { e.msg = `Velas não gravadas: ${motivo(err, 'a caixa negra')}`; e.msgErro = true }
      return
    }
    const registar = async (t) => {
      try { await ctx.logbook(t, 'navigation'); e.msg = `Diário: ${t}`; e.msgErro = false } catch (err) { e.msg = `Diário não gravou: ${motivo(err, 'o diário')}`; e.msgErro = true }
    }
    if (nome === 'comecar') { e.passo = 0; await registar('Início de recolher velas') }
    if (nome === 'aproado') { const pr = proaDe(ctx); e.passo = 2; await registar(`Aproado ao vento (${rumo(pr?.valor)}${marcaMag(pr)})`) }
    if (nome === 'recolhidas') { e.passo = 3; await registar('Velas recolhidas') }
    if (nome === 'cancelar') { e.passo = -1; await registar('Recolher velas cancelado') }
  }
}
