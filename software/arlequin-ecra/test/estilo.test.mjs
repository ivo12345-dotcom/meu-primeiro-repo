import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../public/estilo.css', import.meta.url), 'utf8')
const regra = (seletor) => {
  const i = css.indexOf(`${seletor} {`)
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
}

test('de noite o botão escolhido (vela atual, .acao.go) distingue-se: contorno e letra vermelho vivo', () => {
  const noite = regra('body.noite .acao.go')
  assert.match(noite, /outline:\s*2px solid #ff5a3a/)
  assert.match(noite, /color:\s*#ff5a3a/)
  assert.match(regra('.acao.go'), /background:\s*#0f6e56/, 'de dia fica igual')
})

test('o mini-mapa tem as cores do mar e da terra de dia e de noite (tokens --mar e --terra)', () => {
  for (const bloco of [regra(':root'), regra('body.noite')]) {
    assert.match(bloco, /--mar:\s*#[0-9a-f]{3,6}/)
    assert.match(bloco, /--terra:\s*#[0-9a-f]{3,6}/)
  }
})

test('as caixas das precauções têm pelo menos 44 px de altura (para o dedo, ao leme)', () => {
  assert.match(regra('.caixa'), /min-height:\s*44px/)
})
