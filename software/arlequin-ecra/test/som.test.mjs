// O som do ecrã (public/lib/som.js): o AudioContext nasce logo no arranque e, enquanto o browser o
// tiver suspenso (sem o --autoplay-policy=no-user-gesture-required, até ao 1.º toque), tenta-se
// retomá-lo a cada ciclo. O aviso "sem som" só aparece com o som parado, vermelho e grande.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lerFonte, funcao, corte } from './ajuda-fonte.mjs'
import { criarAudio, retomar, comSom, chipSemSom } from '../public/lib/som.js'

// um AudioContext falso: começa suspenso (o browser sem o toque) ou a tocar (com o autoplay)
function contextoFalso ({ estado = 'suspended', deixa = true } = {}) {
  return class {
    constructor () { this.state = estado; this.retomas = 0 }
    resume () { this.retomas++; if (deixa) this.state = 'running'; return Promise.resolve() }
  }
}

test('auditoria K-03: o AudioContext cria-se logo no arranque (sem esperar pelo 1.º toque); sem AudioContext, null', () => {
  const a = criarAudio(contextoFalso({ estado: 'running' }))
  assert.equal(a.state, 'running')
  assert.equal(comSom(a), true)
  assert.equal(criarAudio(undefined), null)
  assert.equal(criarAudio(class { constructor () { throw new Error('sem som') } }), null)
})

test('auditoria K-03: suspenso (o browser ainda não deixa), retoma-se a cada ciclo até tocar; nunca rebenta', async () => {
  const Ctx = contextoFalso({ estado: 'suspended', deixa: false })
  const a = criarAudio(Ctx)
  assert.equal(comSom(a), false)
  retomar(a)
  retomar(a)
  assert.equal(a.retomas, 2, 'tenta outra vez a cada ciclo')
  a.state = 'running'
  retomar(a)
  assert.equal(a.retomas, 2, 'a tocar: não mexe')
  // um resume que rejeita ou lança não rebenta o ciclo
  assert.doesNotThrow(() => retomar({ state: 'suspended', resume: () => Promise.reject(new Error('não')) }))
  assert.doesNotThrow(() => retomar({ state: 'suspended', resume: () => { throw new Error('não') } }))
  assert.doesNotThrow(() => retomar(null))
  await new Promise(resolve => setTimeout(resolve, 0)) // a rejeição foi apanhada (sem unhandledRejection)
})

test('auditoria K-03: o app.js cria o som no arranque, tenta retomá-lo a cada ciclo e a cada toque, e a barra usa o chipSemSom', () => {
  // o app.js é do browser (não se importa no node): confere-se o que ele chama (revisão F3, Minor 13: pela ajuda,
  // sem depender dos fins de linha, e cada pedaço tem de se achar — antes, com CRLF, o corte da função ia até ao
  // fim do ficheiro e o teste passava mesmo que o ciclo deixasse de retomar o som)
  const app = lerFonte('app.js')
  assert.match(app, /audio:\s*criarAudio\(\)/, 'no arranque, não no 1.º toque')
  const ciclo = funcao(app, 'function ciclo')
  assert.match(ciclo, /retomar\(app\.audio\)/, 'a cada ciclo')
  const toque = corte(app, "addEventListener('pointerdown'", '}, { capture: true })', 'o ouvinte do pointerdown')
  assert.match(toque, /retomar\(app\.audio\)/, 'a cada toque')
  assert.match(app, /somHtml:\s*chipSemSom\(app\.audio\)/)
  assert.doesNotMatch(app, /toque para ligar o som/, 'o chip cinzento antigo saiu')
})

test('auditoria K-03: o aviso "sem som" só com o som parado, vermelho e grande; a tocar, nada', () => {
  const parado = chipSemSom({ state: 'suspended' })
  assert.match(parado, /class="chip sem-som"/)
  assert.match(parado, /SEM SOM/)
  assert.match(chipSemSom(null), /class="chip sem-som"/)
  assert.equal(chipSemSom({ state: 'running' }), '')
  const css = readFileSync(new URL('../public/estilo.css', import.meta.url), 'utf8')
  const i = css.indexOf('.chip.sem-som {')
  assert.ok(i > 0, 'a regra .chip.sem-som')
  const regra = css.slice(i, css.indexOf('}', i))
  assert.match(regra, /background:\s*var\(--perigo-fundo\)/)
  assert.match(regra, /font-size:\s*1\.\d+rem/)
  assert.match(regra, /font-weight:\s*bold/)
})
