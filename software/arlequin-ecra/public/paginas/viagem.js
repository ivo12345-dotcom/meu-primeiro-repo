// Viagem: próximo WP, XTE, VMG e o resumo da viagem.

import { barraXte } from '../lib/desenho.js'
import { hpa } from '../lib/formato.js'
import { tile, proximoWp, velocidade, distancia, duracao, num, rumo, ok, esc } from './comum.js'

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export default {
  render (ctx) {
    const wp = proximoWp(ctx)
    const eta = ok(wp.ttg) ? new Date(Date.now() + wp.ttg * 1000) : null
    const v = ctx.viagem
    const tempo = (v.ultimo ?? v.inicio) - v.inicio
    const media = tempo > 60000 ? v.distancia / (tempo / 1000) : null
    const dp = ok(v.pressaoInicial) && ok(v.pressaoFinal) ? hpa(v.pressaoFinal - v.pressaoInicial) : null
    const inicio = new Date(v.inicio)
    const esquerda = wp.ativo
      ? `<div class="tile"><div class="lab">Próximo ponto</div><div class="vv">${esc(wp.nome)}</div></div>
<div class="grelha" style="grid-template-columns:1fr 1fr;flex:2;">
  ${tile('Distância', `${distancia(wp.dist)} MN`, '', 'vv')}
  ${tile('Rumo ao WP', rumo(wp.rumoWp), '', 'vv')}
  ${tile('Chegada', eta ? hm(eta) : '—', `<div class="lab">falta ${duracao(wp.ttg)}</div>`, 'vv')}
  ${tile('VMG ao WP', `${velocidade(wp.vmg)} nós`, '', 'vv')}
</div>
<div class="tile"><div class="lab">XTE ${ok(wp.xte) ? `${distancia(Math.abs(wp.xte), 2)} MN ${wp.xte > 0 ? '(estás a EB da rota)' : '(estás a BB da rota)'}` : '—'}</div>${barraXte(wp.xte)}</div>`
      : '<div class="tile centro" style="flex:1;"><div class="vv">Sem rota ativa</div><div class="lab">Ativa uma rota no OpenCPN.</div></div>'
    return `<div class="col">${esquerda}</div>
<div class="col">
<div class="tile"><div class="linha"><span class="lab">Resumo da viagem · desde ${inicio.getDate()}/${inicio.getMonth() + 1} ${hm(inicio)}</span>
  ${ctx.estado.confirmarNova ? '' : '<button class="btn" style="padding:.5rem 1rem;" data-acao="nova">Nova viagem</button>'}</div>
${ctx.estado.confirmarNova ? `<div class="plano-confirmar"><div class="v">Começar uma viagem nova? O resumo atual é apagado.</div>
<div class="acoes"><button class="acao stop" data-acao="nova-sim">Sim, começar outra</button><button class="acao" data-acao="nova-nao">Não</button></div></div>` : ''}</div>
<div class="grelha" style="grid-template-columns:1fr 1fr;">
  ${tile('Distância', `${distancia(v.distancia)} MN`, '', 'vv')}
  ${tile('Tempo', duracao(tempo / 1000), '', 'vv')}
  ${tile('Velocidade média', `${velocidade(media)} nós`, '', 'vv')}
  ${tile('Vento máximo', `${velocidade(v.ventoMax, 0)} nós`, '', 'vv')}
  ${tile('À vela', duracao(v.tempoVela), v.tempoSemLeitura >= 60 ? `<div class="lab">+ ${duracao(v.tempoSemLeitura)} sem leitura do motor</div>` : '', 'vv')}
  ${tile('A motor', duracao(v.tempoMotor), '', 'vv')}
  ${tile('Gasóleo gasto', `${num(v.gasoleoL, 1)} L`, '', 'vv')}
  ${tile('Pressão', ok(dp) ? `${dp > 0 ? '+' : ''}${num(dp, 1)} hPa` : '—', '', 'vv')}
</div>
</div>`
  },
  // a pergunta dentro da página (auditoria I-10: a caixa de confirmação do browser parava o ciclo e o apito)
  acao (nome, dados, ctx) {
    if (nome === 'nova') ctx.estado.confirmarNova = true
    if (nome === 'nova-nao') ctx.estado.confirmarNova = false
    if (nome === 'nova-sim') { ctx.estado.confirmarNova = false; ctx.novaViagem?.() }
  }
}
