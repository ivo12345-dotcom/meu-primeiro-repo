import test from 'node:test'
import assert from 'node:assert/strict'
import { diferenca, correcaoLeme, bordejo, rumoAproar } from '../public/lib/rumo.js'

const rad = (g) => g * Math.PI / 180
const deg = (r) => Math.round(r * 180 / Math.PI)

test('diferença angular com sinal, sempre entre -180 e 180', () => {
  assert.equal(deg(diferenca(rad(10), rad(350))), 20)
  assert.equal(deg(diferenca(rad(350), rad(10))), -20)
  assert.equal(deg(diferenca(rad(90), rad(90))), 0)
})

test('correção ao leme: para onde e quanto', () => {
  assert.deepEqual(correcaoLeme(rad(43), rad(35)), { graus: 8, lado: 'EB' })
  assert.deepEqual(correcaoLeme(rad(355), rad(10)), { graus: 15, lado: 'BB' })
  assert.deepEqual(correcaoLeme(rad(35), rad(35.4)), { graus: 0, lado: null })
  assert.equal(correcaoLeme(null, rad(10)), null)
})

test('WP contra o vento: dá os dois bordos ótimos', () => {
  // Vento de 000°, WP a 010°, bolina ótima 45°
  const r = bordejo({ rumoWp: rad(10), direcaoVento: rad(0), anguloBolina: rad(45) })
  assert.equal(r.contraVento, true)
  // Amurado a EB = vento a entrar por estibordo → rumo 315; amurado a BB → 045
  assert.equal(deg(r.amuraEB), 315)
  assert.equal(deg(r.amuraBB), 45)
})

test('WP largo: não há bordejo', () => {
  const r = bordejo({ rumoWp: rad(90), direcaoVento: rad(0), anguloBolina: rad(45) })
  assert.equal(r.contraVento, false)
})

test('layline: vira quando a marcação ao WP chega ao rumo do outro bordo', () => {
  // Amurado a EB (rumo 315); o outro bordo é 045. WP já a 045 → layline, virar.
  const r = bordejo({ rumoWp: rad(45), direcaoVento: rad(0), anguloBolina: rad(45), proa: rad(315) })
  assert.equal(r.virar, true)
  assert.equal(r.bordoAtual, 'EB')
  const r2 = bordejo({ rumoWp: rad(20), direcaoVento: rad(0), anguloBolina: rad(45), proa: rad(315) })
  assert.equal(r2.virar, false)
})

test('aproar ao vento = direção de onde vem o vento real', () => {
  assert.equal(deg(rumoAproar(rad(330))), 330)
  assert.equal(rumoAproar(null), null)
})
