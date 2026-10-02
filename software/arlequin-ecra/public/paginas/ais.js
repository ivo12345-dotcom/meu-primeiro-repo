// AIS: todos os alvos por ordem de perigo, detalhe ao tocar e silenciar.

import { LIMITES_AIS } from '../lib/cpa.js'
import { acaoCalar } from '../lib/alarmes.js'
import { tipoAis } from '../lib/ais.js'
import { velocidade, distancia, duracao, rumo, num, tile, esc } from './comum.js'

const ESTADO = { perigo: 'PERIGO', atencao: 'atenção', seguro: 'seguro', afasta: 'afasta-se', desconhecido: '—' }

export default {
  render (ctx) {
    const sel = ctx.estado.sel
    const linhas = ctx.alvos.map(a => {
      const cls = a.classe === 'perigo' ? 'perigo' : a.classe === 'atencao' ? 'atencao' : ''
      const temCpa = a.r && a.r.tcpa >= 0
      return `<tr data-mmsi="${esc(a.mmsi)}" data-acao="sel" class="${cls} ${sel === a.mmsi ? 'sel' : ''}">
<td>${esc(a.name || a.mmsi)}</td><td>${esc(tipoAis(a.tipo))}</td><td>${a.r ? distancia(a.r.distancia) + ' MN' : '—'}</td><td>${a.r ? rumo(a.r.marcacao) : '—'}</td>
<td>${velocidade(a.sog)} / ${rumo(a.cog)}</td><td>${temCpa ? distancia(a.r.cpa) + ' MN' : '—'}</td><td>${temCpa ? duracao(a.r.tcpa) : '—'}</td><td>${ESTADO[a.classe]}</td></tr>`
    }).join('')
    const a = ctx.alvos.find(x => x.mmsi === sel)
    const n = a && ctx.notificacoes.find(x => x.caminho === `notifications.arlequin.ais.${a.mmsi}` && x.state !== 'normal')
    // as mesmas regras do botão da barra (auditoria I-08): silenciar onde o servidor deixa, senão reconhecer
    const calar = n ? acaoCalar(n) : null
    const detalhe = a
      ? `<div class="tile"><div class="linha"><span class="v">${esc(a.name || a.mmsi)}</span><span class="lab">MMSI ${esc(a.mmsi)} · ${esc(tipoAis(a.tipo) === '—' ? 'tipo desconhecido' : tipoAis(a.tipo))}</span></div>
<div class="g3" style="margin-top:.3rem;">${tile('Distância · marcação', `${a.r ? distancia(a.r.distancia) : '—'} MN · ${a.r ? rumo(a.r.marcacao) : '—'}`)}${tile('CPA · TCPA', a.r && a.r.tcpa >= 0 ? `${distancia(a.r.cpa, 2)} MN · ${duracao(a.r.tcpa)}` : a.r ? 'afasta-se' : '—')}${tile('SOG · COG', `${velocidade(a.sog)} nós · ${rumo(a.cog)}`)}</div>
<div class="acoes" style="margin-top:.4rem;">${calar ? `<button class="acao stop" data-acao="${calar}" data-id="${esc(n.id)}">${calar === 'reconhecer' ? 'Reconhecer alarme' : 'Silenciar alarme'}</button>` : ''}<button class="acao" data-acao="fechar">Fechar</button></div></div>`
      : ''
    return `<div class="col">
<div class="tile" style="flex:1;overflow:auto;"><table class="grande"><tr><th>Nome</th><th>Tipo</th><th>Dist.</th><th>Marc.</th><th>SOG/COG</th><th>CPA</th><th>TCPA</th><th>Estado</th></tr>${linhas || '<tr><td colspan="8" class="lab">Sem alvos AIS</td></tr>'}</table></div>
${detalhe}
<div class="g3">${tile('Alarme CPA', `&lt; ${num(LIMITES_AIS.cpa / 1852, 1)} MN`, '', 'vv')}${tile('Alarme TCPA', `&lt; ${LIMITES_AIS.tcpa / 60} min`, '', 'vv')}${tile('Alvos à vista', `${ctx.alvos.length} · ${ctx.alvos.filter(x => x.classe === 'perigo').length} em perigo`, '', 'vv')}</div>
</div>`
  },
  acao (nome, dados, ctx) {
    if (nome === 'sel') ctx.estado.sel = dados.mmsi
    if (nome === 'fechar') ctx.estado.sel = null
  }
}
