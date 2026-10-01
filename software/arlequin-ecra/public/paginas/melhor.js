// Melhor rota (desenho 3b-1): a página escolhe o estado e chama o módulo de cada um.
//   Leme        — há uma rota ativa (ou acabou de se ativar): o rumo a seguir (melhor/leme.js)
//   Pedir       — sem rota ativa, ou depois de "Novo cálculo" (melhor/pedir.js)
//   A calcular  — o progresso de GET /resultado/:id, de 1 em 1 s (melhor/resultado.js)
//   Resultado   — veredicto, cartões, avisos, precauções, desistência e botões (melhor/resultado.js)
//   Mapa        — o mini-mapa (melhor/mapa.js)
//   Erro        — caixa vermelha com o motivo, em pt-PT
// O estado fica em ctx.estado (vista, resultado, selecionada, …); as marcas das precauções também
// no armazenamento do ecrã (ctx.guardar), por id de cálculo.
// "Rota ativada" (e.ativada) só até o SignalK mostrar a rota ativa (daí em diante manda a rota ativa,
// e quando ela acaba o ecrã volta ao que estava); sem confirmação em 2 min, sai e explica.
// A navegar (desenho 3b-2, melhor/navegar.js): o plano ativo do plugin (GET /plano-ativo de 10 em 10 s)
// dá a faixa, Recalcular e Terminar no Leme; com o plano pausado (a rota ativa já não é a do plano) o
// Leme mostra a caixa com Terminar, Continuar e Recalcular, mesmo sem rota ativa.

import leme from './melhor/leme.js'
import pedir, { buscarDestinos, rotaAtiva } from './melhor/pedir.js'
import * as resultado from './melhor/resultado.js'
import * as mapa from './melhor/mapa.js'
import * as navegar from './melhor/navegar.js'

const PRAZO_ATIVADA_MS = 120000
const SEM_CONFIRMACAO = 'ativei a rota, mas o SignalK não a mostra como ativa: vê no OpenCPN se ela lá está'
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())

function reverAtivada (ctx) {
  const e = ctx.estado
  if (!e.ativada) return
  if (rotaAtiva(ctx)) { e.ativada = false; return }
  if (agora(ctx) - (e.ativadaEm ?? agora(ctx)) > PRAZO_ATIVADA_MS) {
    e.ativada = false
    e.msg = SEM_CONFIRMACAO
    e.msgErro = true
  }
}

export function vista (ctx) {
  const e = ctx.estado
  if (e.ativada || ((rotaAtiva(ctx) || navegar.pausado(ctx)) && !e.novo)) return 'leme'
  const v = e.vista || 'pedir'
  if ((v === 'resultado' || v === 'mapa') && !e.resultado) return 'pedir'
  return v
}

export default {
  aoEntrar (ctx) {
    const e = ctx.estado
    reverAtivada(ctx)
    // voltar à página com o Pedir aberto (um "Novo cálculo" por engano) repõe o Leme
    if (e.novo && (!e.vista || e.vista === 'pedir')) e.novo = false
    navegar.buscarPlanoAtivo(ctx, true)
    if (vista(ctx) === 'pedir') buscarDestinos(ctx, true)
  },
  render (ctx) {
    navegar.buscarPlanoAtivo(ctx)
    reverAtivada(ctx)
    switch (vista(ctx)) {
      case 'leme': return leme.render(ctx)
      case 'a-calcular': return resultado.renderACalcular(ctx)
      case 'resultado': return resultado.render(ctx)
      case 'mapa': return mapa.render(ctx)
      case 'erro': return resultado.renderErro(ctx)
      default: return pedir.render(ctx)
    }
  },
  async acao (nome, dados, ctx, input) {
    const e = ctx.estado
    if (nome === 'rota-novo') {
      // volta a Pedir, mesmo com uma rota ativa (que fica no topo da lista)
      Object.assign(e, { novo: true, ativada: false, vista: 'pedir', erro: null, msg: null, plano: null, calculo: null })
      return buscarDestinos(ctx, true)
    }
    if (await navegar.acao(nome, dados, ctx)) return
    // Ativar muda o plano: a pergunta do Terminar do plano antigo sai
    if (nome === 'rota-ativar') e.confirmarTerminar = null
    if (await resultado.acao(nome, dados, ctx)) {
      // Ativar cria ou substitui o plano ativo: lê-o já
      if (nome === 'rota-ativar' && e.ativada) await navegar.buscarPlanoAtivo(ctx, true)
      return
    }
    return pedir.acao(nome, dados, ctx, input)
  }
}
