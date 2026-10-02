'use strict'
// Auditoria I-20 (decisão n.º 24 do dono): os portos e fundeadouros conhecidos, junto aos quais o ponto
// de amarração se grava sozinho (no mar nunca).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { lerDestinosDaRota, lugaresDaConfiguracao, lugarPerto, distanciaAoLugar, EXTRAS, RAIO_LUGAR_M, DESTINOS_DA_ROTA } = require('../lib/lugares')

const MN = 1852
const lugaresRota = () => lerDestinosDaRota().lugares
const todos = () => [...lugaresRota(), ...lugaresDaConfiguracao(EXTRAS)]

test('os destinos da rota (rota/dados/destinos.json, só se lê): os 15 portos', () => {
  assert.ok(fs.existsSync(DESTINOS_DA_ROTA), DESTINOS_DA_ROTA)
  const r = lerDestinosDaRota()
  assert.equal(r.erro, null)
  assert.equal(r.lugares.length, 15)
  assert.ok(r.lugares.every(l => l.nome && l.pontos.length >= 1))
  assert.ok(r.lugares.some(l => l.nome === 'Peniche'))
  assert.equal(RAIO_LUGAR_M, 1000)
})

test('junto ao porto: dentro da marina, na boca e no canal interior; no largo e no mar não', () => {
  const l = todos()
  assert.equal(lugarPerto({ latitude: 39.3522, longitude: -9.3760 }, l), 'Peniche', 'na marina de Peniche')
  assert.equal(lugarPerto({ latitude: 38.6930, longitude: -9.4160 }, l), 'Cascais', 'na marina de Cascais')
  assert.equal(lugarPerto({ latitude: 38.6950, longitude: -9.4120 }, l), 'Cascais', 'fundeado na baía de Cascais, à porta da marina')
  assert.equal(lugarPerto({ latitude: 38.6950, longitude: -9.2340 }, l), 'Algés (CNA)')
  // a Ria Formosa: entre a barra e a marina de Olhão são ~6 km de canal
  assert.equal(lugarPerto({ latitude: 36.995, longitude: -7.856 }, l), 'Olhão', 'no canal da Ria, a meio')
  // a 5 MN de Peniche, no largo das aproximações e ao largo de Cascais: mar
  assert.equal(lugarPerto({ latitude: 39.3530 + 5 * MN / 111320, longitude: -9.3780 }, l), null)
  for (const d of JSON.parse(fs.readFileSync(DESTINOS_DA_ROTA, 'utf8'))) {
    assert.equal(lugarPerto({ latitude: d.largo[0], longitude: d.largo[1] }, l), null, `o largo de ${d.nome} é mar`)
  }
  assert.equal(lugarPerto({ latitude: 38.62, longitude: -9.42 }, l), null, 'ao largo de Cascais')
})

test('a Ericeira (dos portos da caixa negra) vem nos lugares da configuração por omissão', () => {
  assert.deepEqual(EXTRAS.map(x => x.nome), ['Ericeira'])
  assert.equal(lugarPerto({ latitude: 38.9632, longitude: -9.4182 }, todos()), 'Ericeira')
})

test('um fundeadouro posto na configuração conta até 1 km; os lugares mal escritos ficam de fora', () => {
  const extra = lugaresDaConfiguracao([
    { nome: 'Bóia da Arrábida', latitude: 38.4600, longitude: -8.9800 },
    { nome: 'sem coordenadas' },
    { nome: 'fora do mundo', latitude: 123, longitude: 0 },
    null,
    { latitude: 38.0, longitude: -9.0 }
  ])
  assert.deepEqual(extra.map(x => x.nome), ['Bóia da Arrábida', 'lugar 38.00000, -9.00000'])
  assert.equal(lugarPerto({ latitude: 38.4600 + 900 / 111320, longitude: -8.9800 }, extra), 'Bóia da Arrábida')
  assert.equal(lugarPerto({ latitude: 38.4600 + 1100 / 111320, longitude: -8.9800 }, extra), null)
  assert.deepEqual(lugaresDaConfiguracao(undefined), [])
})

test('a distância a um porto é a distância ao troço mais perto (não só aos pontos)', () => {
  const canal = { nome: 'canal', pontos: [{ latitude: 38, longitude: -9 }, { latitude: 38 + 5000 / 111320, longitude: -9 }] }
  // a meio do canal, 300 m para o lado: a ~2,5 km dos dois pontos, a 300 m do troço
  const d = distanciaAoLugar({ latitude: 38 + 2500 / 111320, longitude: -9 + 300 / (111320 * Math.cos(38 * Math.PI / 180)) }, canal)
  assert.ok(Math.abs(d - 300) < 3, `${d} m`)
})

test('sem o ficheiro dos destinos da rota: diz porquê e fica só com os lugares da configuração', () => {
  const r = lerDestinosDaRota(path.join(os.tmpdir(), 'nao-existe', 'destinos.json'))
  assert.deepEqual(r.lugares, [])
  assert.match(r.erro, /destinos\.json/)
  const estragado = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-lugares-')), 'destinos.json')
  fs.writeFileSync(estragado, '{estragado')
  assert.deepEqual(lerDestinosDaRota(estragado).lugares, [])
})
