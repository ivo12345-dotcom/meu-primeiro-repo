// A ajuda dos testes que leem o código do ecrã (test/ajuda-fonte.mjs): o corte de uma função dá o mesmo com fins
// de linha LF ou CRLF (no Windows o git entrega os ficheiros com CRLF) e nunca lê o ficheiro todo em vez do pedaço
// (revisão F3, Minor 13: os cortes em "\n}\n" do ciclo.test e do som.test não achavam o fim com CRLF, o slice ia até
// ao fim do ficheiro e os dois testes passavam sem verificar a função).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { semCR, lerFonte, corte, funcao } from './ajuda-fonte.mjs'

// o que o app.js tem de ter à letra (o ficheiro de verdade, não uma amostra)
const FUNCOES = ['function ciclo', 'function render (', 'function janela', 'function registarDados', 'function tocar', 'function bip', 'function contexto ()']

test('revisão F3 (Minor 13): o corte de uma função do app.js é o mesmo com LF e com CRLF, é só essa função, e rebenta (nunca devolve o ficheiro todo) se não achar o princípio ou o fim', () => {
  const lf = lerFonte('app.js')
  assert.ok(!lf.includes('\r'), 'lerFonte devolve sem \\r, seja qual for o ficheiro no disco')
  const crlf = lf.replace(/\n/g, '\r\n')
  assert.ok(crlf.includes('\r\n}\r\n') && !crlf.includes('\n}\n'), 'a cópia com CRLF não tem o "\\n}\\n" que o corte antigo procurava')
  for (const assinatura of FUNCOES) {
    const f = funcao(lf, assinatura)
    assert.equal(funcao(crlf, assinatura), f, `${assinatura}: LF e CRLF dão o mesmo`)
    assert.ok(f.startsWith(assinatura) && f.endsWith('\n}'), `${assinatura}: da assinatura ao } que a fecha`)
    assert.ok(!/\n(export )?(async )?function /.test(f), `${assinatura}: só uma função (não passa para a seguinte)`)
    assert.ok(f.length < lf.length / 4, `${assinatura}: ${f.length} letras de ${lf.length}: não é o ficheiro todo`)
  }
  // o corte antigo, com CRLF, não achava o fim (indexOf -1) e o slice(início, -1) ia até ao fim do ficheiro
  assert.equal(crlf.indexOf('\n}\n', crlf.indexOf('function ciclo')), -1)
  // sem princípio ou sem fim, rebenta com o nome do corte
  assert.throws(() => funcao(lf, 'function nãoExiste'), /corte "a função function nãoExiste": não achei o princípio/)
  assert.throws(() => corte(lf, 'function ciclo', '§ não existe §'), /não achei o fim/)
  assert.throws(() => funcao('function x () {\n  return 1', 'function x'), /não achei o fim/)
  assert.equal(corte('ab\r\ncd\r\nef', 'b\ncd', 'ef'), 'b\ncd\n', 'os marcadores com LF acham-se num fonte com CRLF')
})

test('revisão F3 (Minor 13): os testes que cortam o app.js leem-no pela ajuda (sem depender dos \\r) e conferem que o corte achou a função — nenhum com o corte antigo em "\\n}\\n" cru', () => {
  for (const ficheiro of ['ciclo.test.mjs', 'som.test.mjs', 'barra.test.mjs', 'paginas.test.mjs']) {
    const texto = semCR(readFileSync(new URL(`./${ficheiro}`, import.meta.url), 'utf8'))
    assert.ok(!/indexOf\('\\n\}\\n'/.test(texto), `${ficheiro}: o corte em "\\n}\\n" cru (use funcao() de ajuda-fonte.mjs)`)
    assert.match(texto, /ajuda-fonte\.mjs/, `${ficheiro}: lê o app.js pela ajuda`)
  }
})
