'use strict'
// A passagem simulada (lib/replay.js): um minuto da passagem em deltas SignalK.
const test = require('node:test')
const assert = require('node:assert/strict')
const { deltaDoPonto, pontoMaisPerto } = require('../lib/replay')

const ROTA = [
  { nome: 'Algés (partida)', lat: 38.6955, lon: -9.233 },
  { nome: 'Barra Norte', lat: 38.668, lon: -9.315 },
  { nome: 'Largo de Cascais', lat: 38.65, lon: -9.45 }
]
const PONTO = { t: 0, lat: 38.68, lon: -9.28, proa: 250, cog: 252, sog: 5, stw: 5.2, tws: 12, twd: 330, motor: false, soc: 0.9, gasoleo: 120, noite: false, wp: 'Barra Norte' }
const valor = (d, p) => d.updates[0].values.find(v => v.path === p)?.value

test('o ponto mais perto da hora pedida', () => {
  assert.equal(pontoMaisPerto([{ t: 0 }, { t: 60 }, { t: 120 }], 70).t, 60)
})

// Auditoria M-69 (E-M14): o replay dava −4,5 A também de noite (a rota conta 6 A à noite).
test('M-69: a corrente de serviço é −4,5 A de dia, −6 A de noite e +45 A a motor (como a rota)', () => {
  assert.equal(valor(deltaDoPonto(PONTO, ROTA), 'electrical.batteries.servico.current'), -4.5)
  assert.equal(valor(deltaDoPonto({ ...PONTO, noite: true }, ROTA), 'electrical.batteries.servico.current'), -6)
  assert.equal(valor(deltaDoPonto({ ...PONTO, motor: true, noite: true }, ROTA), 'electrical.batteries.servico.current'), 45)
})

// Auditoria M-69: o Math.max(1, findIndex) mostrava o WP seguinte quando o ponto ia para o 1.º, e um
// WP desconhecido passava por ser o 2.º.
test('M-69: o próximo WP é o do ponto, também o 1.º; com um WP desconhecido não se inventa rumo', () => {
  assert.equal(valor(deltaDoPonto(PONTO, ROTA), 'navigation.course.nextPoint').name, 'Barra Norte')
  const primeiro = deltaDoPonto({ ...PONTO, wp: 'Algés (partida)' }, ROTA)
  assert.equal(valor(primeiro, 'navigation.course.nextPoint').name, 'Algés (partida)')
  assert.equal(valor(primeiro, 'navigation.course.calcValues.crossTrackError'), 0)
  const desconhecido = deltaDoPonto({ ...PONTO, wp: 'Nenhures' }, ROTA)
  assert.equal(desconhecido.updates[0].values.some(v => v.path.startsWith('navigation.course.')), false)
  assert.ok(valor(desconhecido, 'navigation.position'))
})
