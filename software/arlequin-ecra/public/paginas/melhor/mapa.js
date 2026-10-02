// Melhor rota, estado Mapa (desenho 3b-1): o mini-mapa (lib/mapa.js) com as 3 alternativas; tocar
// num cartão destaca essa. Botões "Voltar ao resultado" e "Ativar esta rota"; o erro do Ativar
// aparece aqui (caixa vermelha com o motivo).

import { desenharMapa } from '../../lib/mapa.js'
import { esc, num, horaLisboa, nomeAlternativa } from '../../lib/rota-texto.js'
import { botaoVoltarLeme } from './pedir.js'

export function render (ctx) {
  const e = ctx.estado
  const r = e.resultado || {}
  const alts = r.alternativas || []
  const i = alts[e.selecionada] ? e.selecionada : 0
  const ag = Number.isFinite(ctx.agora) ? ctx.agora : Date.now()
  const svg = desenharMapa({ mapa: r.mapa, alternativas: alts, selecionada: i, noite: !!ctx.noite, desistencia: r.desistencia, partida: r.partida?.nome, destino: r.destino?.nome, agora: ag })
  const cartoes = alts.map((a, k) => `<div class="tile cartao${k === i ? ' sel' : ''}" data-acao="rota-escolher" data-i="${k}">
<div class="nome-alt">${k + 1}. ${esc(nomeAlternativa(a))}</div>
<div class="lab">${horaLisboa(a.partida, ag)} → ${horaLisboa(a.chegada?.p50, ag)} · ${num(a.milhas, 1)} MN${a.naoRecomendada ? ' · <span class="perigo">não recomendada</span>' : ''}</div></div>`).join('')
  // os cartões e a legenda rolam; a resposta do Ativar e os botões ficam fixos por baixo (revisão F3, Important 2)
  return `<div class="tile mapa-caixa" style="flex:2.2;">${svg || '<div class="caixa-erro">Este resultado vem sem o mapa.</div>'}</div>
<div class="col" style="flex:1;">
<div class="col rolar" data-rolar="mapa-dir">
${cartoes}
<div class="tile lab">Azul: à vela · cinzento tracejado: a motor · mais escuro: de noite · ▲ avisos · ● pontos de desistência (da 1.ª) · tracejado vermelho: zonas a evitar</div>
</div>
<div class="fixos">
${e.msg ? `<div class="tile ${e.msgErro ? 'caixa-erro' : ''}">${esc(e.msg)}</div>` : ''}
<div class="acoes"><button class="acao go" data-acao="rota-voltar">Voltar ao resultado</button><button class="acao" data-acao="rota-ativar">Ativar esta rota</button>${botaoVoltarLeme(ctx)}</div>
</div>
</div>`
}
