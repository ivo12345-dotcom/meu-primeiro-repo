'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const m = require('../lib/modelos')

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'velocidade.json.gz'))))

function pastaComModelo () {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ia-mod-'))
  fs.mkdirSync(path.join(p, 'velocidade'))
  fs.writeFileSync(path.join(p, 'velocidade', 'v0001.json.gz'), zlib.gzipSync(JSON.stringify({ ...fixture.modelo, nativo: { p50: 'texto do Python' } })))
  fs.writeFileSync(path.join(p, 'velocidade', 'v0002.json.gz'), zlib.gzipSync(JSON.stringify(fixture.modelo)))
  fs.writeFileSync(path.join(p, 'velocidade', 'atual'), 'v0001\n')
  return p
}

test('carrega o modelo em uso de cada tipo (sem o texto nativo); os outros ficam null', () => {
  const p = pastaComModelo()
  const ms = m.carregarModelos(p)
  assert.deepEqual(Object.keys(ms), m.NOMES)
  assert.equal(ms.velocidade.versao, 'v0001')
  assert.equal(ms.velocidade.nativo, undefined)
  assert.equal(ms.consumo, null)
  assert.deepEqual(m.versoes(p, 'velocidade'), ['v0001', 'v0002'])
  assert.equal(m.versaoAtual(p, 'consumo'), null)
})

test('quantis sempre por ordem', () => {
  const mod = m.carregarModelos(pastaComModelo()).velocidade
  for (const c of fixture.casos) {
    const q = m.preverQuantis(mod, c.x)
    assert.ok(q.p10 <= q.p50 && q.p50 <= q.p90)
  }
})

test('velocidade: sem dados na célula manda a polar; com 2 h manda a AI; sempre entre 40% e 120% da polar', () => {
  const mod = { quantis: { p10: fixa(3), p50: fixa(4), p90: fixa(9) }, celulas: { '12|60': 1, '14|60': 2 } }
  assert.deepEqual(m.preverVelocidade(mod, { tws: 8, twaAbs: 90 }, 6), { peso: 0, p10: 6, p50: 6, p90: 6 })
  const meio = m.preverVelocidade(mod, { tws: 12.5, twaAbs: 61 }, 6)
  assert.equal(meio.peso, 0.5)
  assert.equal(meio.p50, 5)
  const cheio = m.preverVelocidade(mod, { tws: 14, twaAbs: 60 }, 6)
  assert.equal(cheio.peso, 1)
  assert.equal(cheio.p10, 3)
  assert.equal(cheio.p50, 4)
  assert.ok(Math.abs(cheio.p90 - 7.2) < 1e-9) // 9 limitado a 120% de 6
  assert.deepEqual(m.preverVelocidade(null, { tws: 14, twaAbs: 60 }, 6), { p10: 6, p50: 6, p90: 6, peso: 0 })
})

test('vento: razão entre 0,5 e 1,5 e direção até ±40°; sem modelo fica a previsão', () => {
  const forca = { quantis: { p10: fixa(0.2), p50: fixa(1.2), p90: fixa(3) } }
  const dir = { quantis: { p50: fixa(-70) } }
  assert.deepEqual(m.preverVento(forca, dir, {}, 10, 20), { tws: { p10: 5, p50: 12, p90: 15 }, twd: 340 })
  assert.deepEqual(m.preverVento(null, null, {}, 10, 20), { tws: { p10: 10, p50: 10, p90: 10 }, twd: 20 })
})

test('consumo: entre 50% e 200% da Volvo; sem modelo fica a Volvo', () => {
  const mod = { quantis: { p10: fixa(0.1), p50: fixa(1.4), p90: fixa(9) } }
  assert.deepEqual(m.preverConsumo(mod, {}, 1.3), { p10: 0.65, p50: 1.4, p90: 2.6 })
  assert.deepEqual(m.preverConsumo(null, {}, 1.3), { p10: 1.3, p50: 1.3, p90: 1.3 })
})

function fixa (v) { return { feature_names: [], tree_info: [{ tree_structure: { leaf_value: v } }] } }
