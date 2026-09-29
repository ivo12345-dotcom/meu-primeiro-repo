import test from 'node:test'
import assert from 'node:assert/strict'
import { criarBarometro, registarPressao, tendencia } from '../public/lib/barometro.js'
import { novaViagem, acumular } from '../public/lib/viagem.js'
import { maisGrave, deveTocar, paginaDoAlarme, bipDeLigacao } from '../public/lib/alarmes.js'

const H = 3600 * 1000
const NO = 1852 / 3600

test('barómetro: a descer 2,4 hPa em 3 h', () => {
  let b = criarBarometro()
  for (let m = 0; m <= 180; m += 10) b = registarPressao(b, 101600 - m * (240 / 180), m * 60000)
  const t = tendencia(b, 180 * 60000)
  assert.equal(t.sentido, 'desce')
  assert.ok(Math.abs(t.hpa3h + 2.4) < 0.01)
})

test('barómetro: menos de 1 h de histórico → sem tendência; ±0,5 hPa = estável', () => {
  let b = registarPressao(criarBarometro(), 101600, 0)
  b = registarPressao(b, 101600, 30 * 60000)
  assert.equal(tendencia(b, 30 * 60000), null)
  let c = criarBarometro()
  for (let m = 0; m <= 180; m += 10) c = registarPressao(c, 101600 + m * 0.1, m * 60000)
  assert.equal(tendencia(c, 180 * 60000).sentido, 'estavel')
})

test('barómetro guarda só 6 h', () => {
  let b = criarBarometro()
  for (let m = 0; m <= 600; m += 10) b = registarPressao(b, 101600, m * 60000)
  assert.ok(b.amostras[0].t >= (600 - 360) * 60000)
})

test('viagem: distância, tempos à vela e a motor, gasóleo, vento máximo', () => {
  let v = novaViagem(0)
  // 1 h à vela a 5 nós, depois 1 h a motor a 6 nós a gastar 1 L/h
  for (let s = 1; s <= 3600; s++) v = acumular(v, { t: s * 1000, sog: 5 * NO, motor: false, fuelRate: 0, ventoReal: 14 * NO, pressao: 101600 })
  for (let s = 3601; s <= 7200; s++) v = acumular(v, { t: s * 1000, sog: 6 * NO, motor: true, fuelRate: 1 / 3600 / 1000, ventoReal: 9 * NO, pressao: 101400 })
  assert.ok(Math.abs(v.distancia / 1852 - 11) < 0.01)
  assert.ok(Math.abs(v.tempoVela - 3600) < 2)
  assert.ok(Math.abs(v.tempoMotor - 3600) < 2)
  assert.ok(Math.abs(v.gasoleoL - 1) < 0.01)
  assert.ok(Math.abs(v.ventoMax - 14 * NO) < 1e-9)
  assert.equal(v.pressaoInicial, 101600)
  assert.equal(v.pressaoFinal, 101400)
})

test('viagem: buraco de dados > 60 s não conta', () => {
  let v = novaViagem(0)
  v = acumular(v, { t: 1000, sog: 5 * NO, motor: false })
  v = acumular(v, { t: 1000 + H, sog: 5 * NO, motor: false })
  assert.equal(v.distancia, 0)
})

const n = (id, state, extra = {}) => ({ caminho: `notifications.${id}`, id: id + '-uuid', state, method: ['visual', 'sound'], message: id, status: { silenced: false, acknowledged: false }, ...extra })

test('o alarme mais grave vai para a barra', () => {
  const lista = [n('arlequin.energia.ligarMotor', 'warn'), n('arlequin.ais.263000001', 'alarm'), n('x', 'normal')]
  assert.equal(maisGrave(lista).caminho, 'notifications.arlequin.ais.263000001')
  assert.equal(maisGrave([n('x', 'normal')]), null)
  assert.equal(maisGrave([n('a', 'warn'), n('b', 'emergency')]).caminho, 'notifications.b')
})

test('toca só com sound e sem silenciar/reconhecer', () => {
  assert.equal(deveTocar(n('a', 'alarm')), 'continuo')
  assert.equal(deveTocar(n('a', 'warn')), 'curto')
  assert.equal(deveTocar(n('a', 'warn', { method: ['visual'] })), null)
  assert.equal(deveTocar(n('a', 'alarm', { status: { silenced: true } })), null)
  assert.equal(deveTocar(n('a', 'alarm', { status: { acknowledged: true } })), null)
  assert.equal(deveTocar(n('a', 'normal')), null)
})

test('cada alarme leva à sua página', () => {
  assert.equal(paginaDoAlarme('notifications.arlequin.ais.263000001'), 'ais')
  assert.equal(paginaDoAlarme('notifications.arlequin.energia.ligarMotor'), 'motor')
  assert.equal(paginaDoAlarme('notifications.propulsion.main.overTemperature'), 'motor')
  assert.equal(paginaDoAlarme('notifications.navigation.anchor'), 'carta')
})

test('bip curto só quando a ligação cai', () => {
  assert.equal(bipDeLigacao(true, false), true)
  assert.equal(bipDeLigacao(false, false), false) // tentativas falhadas de religar
  assert.equal(bipDeLigacao(null, false), false) // arranque sem servidor
  assert.equal(bipDeLigacao(false, true), false) // religou
})
