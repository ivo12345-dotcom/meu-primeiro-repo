// A cola entre o DOM e as páginas (public/lib/interacao.js), usada pelo app.js: Enter, o que se
// escreve nos campos e quando o render de 1 Hz pode refazer a página.
import test from 'node:test'
import assert from 'node:assert/strict'
import { podeRedesenhar, aoEnter, aoEscrever } from '../public/lib/interacao.js'

test('o render de 1 Hz não refaz a página enquanto se escreve num campo nem com o dedo no ecrã (o toque não se perde)', () => {
  assert.equal(podeRedesenhar({}), true)
  assert.equal(podeRedesenhar({ aEscrever: true }), false)
  assert.equal(podeRedesenhar({ premido: true }), false)
  // forçado (mudar de página, depois de uma ação, depois do Enter): refaz sempre
  assert.equal(podeRedesenhar({ forcar: true, aEscrever: true, premido: true }), true)
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
