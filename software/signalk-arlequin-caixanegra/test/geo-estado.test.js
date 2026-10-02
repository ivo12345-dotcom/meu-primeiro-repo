'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
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

test('uma só lista de portos: os 15 destinos da rota (o cais, último ponto da aproximação) e os extras da caixa negra (decisão n.º 25; auditoria I-33)', () => {
  const rota = JSON.parse(fs.readFileSync(geo.DESTINOS_DA_ROTA, 'utf8'))
  const daRota = geo.portosDaRota()
  assert.equal(daRota.length, rota.length)
  assert.equal(daRota.length, 15)
  for (const d of rota) {
    const p = daRota.find(x => x.nome === d.nome)
    assert.ok(p, `falta ${d.nome}`)
    assert.deepEqual([p.lat, p.lon], d.aproximacao.at(-1), `${d.nome}: o cais, como o plugin da rota`)
  }
  const nomes = geo.PORTOS.map(p => p.nome)
  for (const n of ['Viana do Castelo', 'Leixões', 'Figueira da Foz', 'Setúbal', 'Sines', 'Lagos', 'Portimão', 'Vilamoura', 'Olhão']) {
    assert.ok(nomes.includes(n), `a caixa negra tem de conhecer ${n}`)
  }
  assert.ok(nomes.includes('Ericeira'), 'a Ericeira não é destino da rota, mas fecha as saídas (extra da caixa negra)')
  assert.equal(nomes.length, 16)
  assert.equal(new Set(nomes).size, nomes.length, 'sem repetidos')
})

test('juntar os extras: um extra com o nome de um porto da rota fica de fora (vale o da rota); um sem coordenadas também', () => {
  const daRota = [{ nome: 'Peniche', lat: 39.3522, lon: -9.376 }]
  const extras = [{ nome: ' peniche ', lat: 39.353, lon: -9.377 }, { nome: 'Ericeira', lat: 38.963, lon: -9.418 }, { nome: 'Sem sítio' }, null]
  assert.deepEqual(geo.juntarPortos(daRota, extras), [{ nome: 'Peniche', lat: 39.3522, lon: -9.376 }, { nome: 'Ericeira', lat: 38.963, lon: -9.418 }])
})

test('destinos da rota: sem aproximação vale o largo; um destino sem sítio nenhum fica de fora; ficheiro em falta rebenta (quem chama avisa)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-geo-'))
  const f = path.join(dir, 'destinos.json')
  fs.writeFileSync(f, JSON.stringify([
    { nome: 'A', largo: [39, -9.5], aproximacao: [[39, -9.5], [39.1, -9.4]] },
    { nome: 'B', largo: [38, -9] },
    { nome: 'C' },
    { nome: 'D', largo: [37, 'x'], aproximacao: [] }
  ]))
  assert.deepEqual(geo.portosDaRota(f), [{ nome: 'A', lat: 39.1, lon: -9.4 }, { nome: 'B', lat: 38, lon: -9 }])
  assert.throws(() => geo.portosDaRota(path.join(dir, 'nao-existe.json')), /ENOENT/)
  fs.writeFileSync(f, '{"nao": "lista"}')
  assert.throws(() => geo.portosDaRota(f), /lista/)
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
