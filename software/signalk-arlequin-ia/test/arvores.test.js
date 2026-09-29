'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { preverArvores } = require('../lib/arvores')

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'velocidade.json.gz'))))

test('dá exatamente o mesmo que o LightGBM em Python (60 casos, com valores em falta)', () => {
  assert.equal(fixture.casos.length, 60)
  assert.ok(fixture.casos.some(c => Object.values(c.x).includes(null)), 'há casos com valores em falta')
  for (const c of fixture.casos) {
    for (const q of ['p10', 'p50', 'p90']) {
      assert.ok(Math.abs(preverArvores(fixture.modelo.quantis[q], c.x) - c[q]) < 1e-9, `${q}: ${JSON.stringify(c.x)}`)
    }
  }
})

test('árvore de uma só folha e regras de valores em falta', () => {
  const dump = {
    feature_names: ['a'],
    tree_info: [
      { tree_structure: { leaf_value: 1 } },
      { tree_structure: { split_feature: 0, threshold: 5, missing_type: 'NaN', default_left: false, left_child: { leaf_value: 10 }, right_child: { leaf_value: 20 } } },
      { tree_structure: { split_feature: 0, threshold: -1, missing_type: 'None', default_left: true, left_child: { leaf_value: 100 }, right_child: { leaf_value: 200 } } },
      { tree_structure: { split_feature: 0, threshold: 5, missing_type: 'Zero', default_left: false, left_child: { leaf_value: 1000 }, right_child: { leaf_value: 2000 } } }
    ]
  }
  assert.equal(preverArvores(dump, { a: 3 }), 1 + 10 + 200 + 1000)
  assert.equal(preverArvores(dump, { a: null }), 1 + 20 + 200 + 2000) // NaN: à direita; None: NaN vira 0 (> -1); Zero: 0 é falta → à direita
  assert.equal(preverArvores(dump, {}), 1 + 20 + 200 + 2000)
})
