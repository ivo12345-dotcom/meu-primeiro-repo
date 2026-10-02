// A cola entre o DOM e as páginas (public/lib/interacao.js), usada pelo app.js: Enter, o que se
// escreve nos campos e quando o render de 1 Hz pode refazer a página.
import test from 'node:test'
import assert from 'node:assert/strict'
import { podeRedesenhar, aoEnter, aoEscrever, PAUSA_TOQUE_MS } from '../public/lib/interacao.js'
import * as interacao from '../public/lib/interacao.js'

// ---------- revisão F3, Important 5: as listas que rolam já não voltam ao cimo a cada segundo ----------
// uma árvore falsa: os elementos com data-rolar (dataset.rolar) e o scrollTop de cada um (o browser corta o
// scrollTop ao máximo que o conteúdo deixa)
function arvore (listas) {
  const els = Object.entries(listas).map(([rolar, [scrollTop, maximo = 10000]]) => {
    const el = { dataset: { rolar }, _top: scrollTop, maximo }
    Object.defineProperty(el, 'scrollTop', { get () { return this._top }, set (v) { this._top = Math.max(0, Math.min(this.maximo, v)) } })
    return el
  })
  return { els, querySelectorAll: (sel) => (sel === '[data-rolar]' ? els : []) }
}

test('revisão F3, Important 5: o desenho de 1 Hz guarda o scrollTop de cada lista com data-rolar e repõe-no na lista nova com a mesma chave (só essas; as outras começam no cimo)', () => {
  const { guardarRolagem, reporRolagem } = interacao
  const antes = arvore({ 'resultado-dir': [640], 'resultado-esq': [0], 'pedir-destinos': [210] })
  const mapa = guardarRolagem(antes)
  assert.deepEqual(mapa, { 'resultado-dir': 640, 'resultado-esq': 0, 'pedir-destinos': 210 })
  // o innerHTML novo: as mesmas listas (no cimo) e uma nova
  const depois = arvore({ 'resultado-dir': [0], 'resultado-esq': [0], 'ais-alvos': [0] })
  const repostos = reporRolagem(depois, mapa)
  assert.deepEqual(depois.els.map(e => [e.dataset.rolar, e.scrollTop]), [['resultado-dir', 640], ['resultado-esq', 0], ['ais-alvos', 0]])
  // o que se repôs (para o app.js não tomar o scroll que isto causa por um dedo a rolar)
  assert.deepEqual([...repostos.entries()].map(([e, v]) => [e.dataset.rolar, v]), [['resultado-dir', 640]])
  // o conteúdo ficou mais curto: o browser corta, e o que conta é o que ficou
  const curta = arvore({ 'resultado-dir': [0, 300] })
  assert.deepEqual([...reporRolagem(curta, { 'resultado-dir': 640 }).values()], [300])
  // sem nada guardado, sem raiz ou com lixo: nada, nunca rebenta
  assert.deepEqual(guardarRolagem(null), {})
  assert.equal(reporRolagem(null, mapa).size, 0)
  assert.equal(reporRolagem(depois, null).size, 0)
})

test('revisão F3, Important 5: um scroll recente pausa o desenho como um dedo no ecrã (a inércia do toque continua a rolar depois do pointerup), mas com limite: 1,5 s depois do último scroll e nunca mais de 10 s seguidos', () => {
  const { PAUSA_ROLAR_MS, PAUSA_ROLAR_MAX_MS } = interacao
  assert.equal(PAUSA_ROLAR_MS, 1500)
  assert.equal(PAUSA_ROLAR_MAX_MS, 10000)
  assert.equal(podeRedesenhar({ roladoHaMs: 200, aRolarHaMs: 200 }), false)
  assert.equal(podeRedesenhar({ roladoHaMs: 1499, aRolarHaMs: 4000 }), false)
  assert.equal(podeRedesenhar({ roladoHaMs: 1500, aRolarHaMs: 4000 }), true)
  assert.equal(podeRedesenhar({ roladoHaMs: null }), true)
  // a rolar sem parar há mais de 10 s (ex.: um ecrã que não pára de mandar scroll): desenha na mesma
  assert.equal(podeRedesenhar({ roladoHaMs: 100, aRolarHaMs: 10000 }), true)
  // forçado (depois de um toque num botão, de mudar de página): sempre
  assert.equal(podeRedesenhar({ forcar: true, roladoHaMs: 100, aRolarHaMs: 100 }), true)
})

test('o render de 1 Hz não refaz a página enquanto se escreve num campo nem com o dedo no ecrã (o toque não se perde)', () => {
  assert.equal(podeRedesenhar({}), true)
  assert.equal(podeRedesenhar({ aEscrever: true }), false)
  assert.equal(podeRedesenhar({ premidoHaMs: 0 }), false)
  assert.equal(podeRedesenhar({ premidoHaMs: null }), true)
  // forçado (mudar de página, depois de uma ação, depois do Enter): refaz sempre
  assert.equal(podeRedesenhar({ forcar: true, aEscrever: true, premidoHaMs: 0 }), true)
})

test('o dedo no ecrã só pausa o render até 3 s (uma mão pousada ou gotas de água não congelam o Leme)', () => {
  assert.equal(PAUSA_TOQUE_MS, 3000)
  assert.equal(podeRedesenhar({ premidoHaMs: 2999 }), false)
  assert.equal(podeRedesenhar({ premidoHaMs: 3000 }), true)
  assert.equal(podeRedesenhar({ premidoHaMs: 60000 }), true)
  // a escrever num campo continua a pausar (o que se escreve está guardado, mas o foco não se perde)
  assert.equal(podeRedesenhar({ premidoHaMs: 60000, aEscrever: true }), false)
})

test('Enter num campo: a ação "enter" da página e depois um render forçado (o resultado aparece logo)', async () => {
  const ordem = []
  const pagina = { acao: async (nome, dados, ctx, alvo) => { await null; ordem.push(['acao', nome, dados, alvo.id]) } }
  const alvo = { id: 'rota-nome', dataset: { campo: 'rota-nome' } }
  await aoEnter(pagina, { c: 1 }, alvo, (forcar) => ordem.push(['render', forcar]))
  assert.deepEqual(ordem, [['acao', 'enter', { campo: 'rota-nome' }, 'rota-nome'], ['render', true]])
  // uma página sem ações: só o render
  const so = []
  await aoEnter({}, {}, alvo, (f) => so.push(f))
  assert.deepEqual(so, [true])
})

test('o que se escreve num campo com data-campo vai para a página (ação "campo"), sem render', () => {
  const vistos = []
  const pagina = { acao: (nome, dados) => vistos.push([nome, dados]) }
  aoEscrever(pagina, {}, { value: 'Baleal', dataset: { campo: 'rota-nome' } })
  aoEscrever(pagina, {}, { value: 'x', dataset: {} })
  assert.deepEqual(vistos, [['campo', { campo: 'rota-nome', valor: 'Baleal' }]])
})
