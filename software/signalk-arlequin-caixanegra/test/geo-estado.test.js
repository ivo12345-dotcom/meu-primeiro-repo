'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const geo = require('../lib/geo')
const est = require('../lib/estado')

const EU = 'vessels.urn:mrn:signalk:uuid:arlequin'

test('distância: 1 minuto de latitude ≈ 1 MN; Algés → Peniche ≈ 40 MN', () => {
  const d1 = geo.distanciaMn({ latitude: 39, longitude: -9.4 }, { latitude: 39 + 1 / 60, longitude: -9.4 })
  assert.ok(d1 > 0.999 && d1 < 1.002, `deu ${d1}`)
  const alges = geo.PORTOS.find(p => p.nome.startsWith('Algés'))
  const peniche = geo.PORTOS.find(p => p.nome === 'Peniche')
  const d = geo.distanciaMn(alges, peniche)
  assert.ok(d > 39 && d < 41, `deu ${d}`)
})

test('porto mais perto; sem posição dá null', () => {
  const p = geo.portoMaisPerto({ latitude: 39.35, longitude: -9.38 }, geo.PORTOS)
  assert.equal(p.nome, 'Peniche')
  assert.ok(p.mn < 0.5)
  assert.equal(geo.portoMaisPerto(undefined, geo.PORTOS), null)
  assert.equal(geo.portoMaisPerto({ latitude: NaN, longitude: 1 }, geo.PORTOS), null)
})

test('estado: guarda só o próprio barco, ignora notificações, envelhece aos 15 s', () => {
  const e = est.novoEstado()
  est.aplicar(e, { context: EU, updates: [{ $source: 'nmea0183.GP', values: [{ path: 'navigation.speedOverGround', value: 2.5 }, { path: 'notifications.x', value: { state: 'alarm' } }] }] }, EU, 1000)
  est.aplicar(e, { context: 'vessels.urn:mrn:imo:mmsi:263000001', updates: [{ $source: 'ais', values: [{ path: 'navigation.speedOverGround', value: 9 }] }] }, EU, 1000)
  est.aplicar(e, { updates: [{ $source: 'derived', values: [{ path: 'environment.wind.speedTrue', value: 6 }] }] }, EU, 1000)
  assert.equal(est.valor(e, 'navigation.speedOverGround', 1000), 2.5)
  assert.equal(est.valor(e, 'environment.wind.speedTrue', 1000), 6)
  assert.equal(est.valor(e, 'notifications.x', 1000), undefined)
  assert.equal(est.valor(e, 'navigation.speedOverGround', 16001), undefined)
  assert.equal(est.simuladoRecente(e, 1000), false)
})

test('estado: mensagens do simulador ficam marcadas durante 15 s', () => {
  const e = est.novoEstado()
  est.aplicar(e, { context: EU, updates: [{ $source: est.SIMULADOR, values: [{ path: 'navigation.headingTrue', value: 1 }] }] }, EU, 5000)
  assert.equal(est.simuladoRecente(e, 5000), true)
  assert.equal(est.simuladoRecente(e, 20000), true)
  assert.equal(est.simuladoRecente(e, 20001), false)
})
