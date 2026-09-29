import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpa } from '../../arlequin-ecra/public/lib/cpa.js'

const require = createRequire(import.meta.url)
const { criarNavegacao, avancarNav } = require('../lib/navegacao.js')

const T0 = new Date(2026, 8, 29, 14, 0).getTime()

function correr (segundos, opcoes) {
  let e = criarNavegacao(opcoes, T0)
  const hist = []
  for (let s = 0; s < segundos; s++) {
    const r = avancarNav(e, 1000)
    e = r.estado
    hist.push(r)
  }
  return { e, hist }
}

const valor = (r, path) => r.deltas[0].updates[0].values.find(v => v.path === path).value

test('o NORDIC STAR passa a menos de 0,5 MN por volta dos 12 min', () => {
  const { hist } = correr(20 * 60)
  let minimo = Infinity
  let quando = 0
  hist.forEach((r, s) => {
    const nordic = r.deltas.find(d => d.context?.endsWith('263000001')).updates[0].values
    const pos = nordic.find(v => v.path === 'navigation.position').value
    const d = cpa({ position: valor(r, 'navigation.position'), cog: 0, sog: 0 }, { position: pos, cog: 0, sog: 0 }).distancia
    if (d < minimo) { minimo = d; quando = s }
  })
  assert.ok(minimo < 0.5 * 1852, `mínimo ${minimo} m`)
  assert.ok(quando > 9 * 60 && quando < 15 * 60, `aos ${quando} s`)
})

test('ciclo vela/motor: 20 min à vela, 5 min a motor', () => {
  const { hist } = correr(26 * 60)
  assert.equal(hist[10 * 60].motor, false)
  assert.equal(hist[21 * 60].motor, true)
  assert.ok(valor(hist[24 * 60], 'propulsion.main.temperature') > 330)
  assert.equal(valor(hist[10 * 60], 'propulsion.main.oilPressure'), 0)
})

test('contra o vento bordeja: a proa troca de bordo e avança para o WP', () => {
  // Vento de 020° e WP3→WP4 a ~050°: a perna final obriga a bordejar à vela.
  const { hist } = correr(4 * 3600, { cicloVelaS: 1e9 })
  const proas = hist.map(r => Math.round(valor(r, 'navigation.headingTrue') * 180 / Math.PI))
  const mudancas = proas.filter((p, i) => i > 0 && Math.abs(p - proas[i - 1]) > 60).length
  assert.ok(mudancas >= 2, `viragens ${mudancas}`)
  const d0 = valor(hist[0], 'navigation.course.calcValues.distance')
  assert.ok(hist.some(r => valor(r, 'navigation.course.nextPoint').name !== 'WP1 Sul Carvoeiro'), 'devia passar do WP1')
  assert.ok(d0 > 0)
})

test('vento aparente coerente: à bolina o aparente é maior que o real', () => {
  const { hist } = correr(3600, { cicloVelaS: 1e9 })
  const r = hist.find(x => Math.abs(valor(x, 'environment.wind.angleTrueWater')) < 60 * Math.PI / 180 && valor(x, 'navigation.speedThroughWater') > 1)
  assert.ok(r, 'devia haver um momento à bolina')
  assert.ok(valor(r, 'environment.wind.speedApparent') > valor(r, 'environment.wind.speedTrue'))
  assert.ok(Math.abs(valor(r, 'environment.wind.angleApparent')) < Math.abs(valor(r, 'environment.wind.angleTrueWater')))
})

test('gasóleo só desce com o motor', () => {
  const { hist } = correr(26 * 60)
  const n0 = valor(hist[0], 'tanks.fuel.0.currentLevel')
  const n19 = valor(hist[19 * 60], 'tanks.fuel.0.currentLevel')
  const n25 = valor(hist[25 * 60], 'tanks.fuel.0.currentLevel')
  assert.equal(n0, n19)
  assert.ok(n25 < n19)
})

test('o NORDIC STAR só aparece uma vez (por omissão)', () => {
  const { hist } = correr(70 * 60)
  const nasceu = new Set(hist.map(r => r.estado.alvos[0].nasceu))
  assert.equal(nasceu.size, 1)
  const { hist: h2 } = correr(70 * 60, { colisaoRepeteMin: 30 })
  assert.equal(new Set(h2.map(r => r.estado.alvos[0].nasceu)).size, 3)
})
