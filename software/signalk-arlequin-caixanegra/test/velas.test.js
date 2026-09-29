'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const velas = require('../lib/velas')

const H = 3600000

test('mudar guarda as velas e o vento dessa altura; valores inválidos dão erro claro', () => {
  let e = velas.novoEstadoVelas()
  e = velas.mudar(e, { grandeRizos: 1 }, 1000, 6)
  assert.equal(e.grandeRizos, 1)
  assert.equal(e.genoaPct, 100)
  assert.equal(e.twsNaMudanca, 6)
  e = velas.mudar(e, { genoaPct: 70 }, 2000, 7)
  assert.equal(e.grandeRizos, 1)
  assert.equal(e.genoaPct, 70)
  assert.throws(() => velas.mudar(e, { grandeRizos: 3 }, 0, 6), /0, 1, 2 rizos ou -1/)
  assert.throws(() => velas.mudar(e, { genoaPct: 80 }, 0, 6), /100, 70, 50 ou 0/)
  assert.throws(() => velas.mudar(e, { grandeRizos: NaN }, 0, 6), /rizos/)
})

test('lembrete: vento mudou mais de 40% e passou 1 h; depois só de hora a hora', () => {
  let e = velas.mudar(velas.novoEstadoVelas(), { grandeRizos: 0 }, 0, 5)
  assert.equal(velas.precisaLembrete(e, 0.5 * H, 8), false, 'ainda não passou 1 h')
  assert.equal(velas.precisaLembrete(e, 1.1 * H, 6.5), false, 'só 30% de diferença')
  assert.equal(velas.precisaLembrete(e, 1.1 * H, 8), true)
  e = { ...e, lembradoEm: 1.1 * H }
  assert.equal(velas.precisaLembrete(e, 1.5 * H, 8), false)
  assert.equal(velas.precisaLembrete(e, 2.2 * H, 8), true)
})

test('sem vento conhecido não há lembrete', () => {
  const nunca = velas.novoEstadoVelas()
  assert.equal(velas.precisaLembrete(nunca, 10 * H, 8), false)
  const e = velas.mudar(nunca, { grandeRizos: 1 }, 0, undefined)
  assert.equal(velas.precisaLembrete(e, 10 * H, 8), false)
  const e2 = velas.mudar(nunca, { grandeRizos: 1 }, 0, 5)
  assert.equal(velas.precisaLembrete(e2, 10 * H, undefined), false)
})
