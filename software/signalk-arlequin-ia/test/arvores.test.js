'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { preverArvores } = require('../lib/arvores')

const ler = (nome) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', `${nome}.json.gz`))))
const fixture = ler('velocidade')

test('dá exatamente o mesmo que o LightGBM em Python (60 casos, com valores em falta)', () => {
  assert.equal(fixture.casos.length, 60)
  assert.ok(fixture.casos.some(c => Object.values(c.x).includes(null)), 'há casos com valores em falta')
  for (const c of fixture.casos) {
    for (const q of ['p10', 'p50', 'p90']) {
      assert.ok(Math.abs(preverArvores(fixture.modelo.quantis[q], c.x) - c[q]) < 1e-9, `${q}: ${JSON.stringify(c.x)}`)
    }
  }
})

// Os outros modelos (python -m arlequin_ia.fixture … --modelo NOME): as variáveis do vento e do
// consumo, e os seus valores em falta, também dão o mesmo que o LightGBM (auditoria M-58).
const OUTROS = {
  ventoDirecao: ['latCel', 'lonCel', 'prevTws', 'prevTwd', 'horaDia', 'idadePrevH', 'tendPressao3h'],
  consumo: ['rpm', 'prevOndas', 'ondasAnguloRel']
}
for (const [nome, variaveis] of Object.entries(OUTROS)) {
  test(`${nome}: dá exatamente o mesmo que o LightGBM em Python (60 casos, com valores em falta; auditoria M-58)`, () => {
    const f = ler(nome)
    assert.equal(f.modelo.modelo, nome)
    assert.deepEqual(f.modelo.variaveis, variaveis, 'as variáveis do contrato (lib/modelos.js) são as do treino')
    assert.equal(f.casos.length, 60)
    assert.ok(f.casos.some(c => Object.values(c.x).includes(null)), 'há casos com valores em falta')
    const vistas = new Set()
    for (const q of ['p10', 'p50', 'p90']) {
      for (const t of f.modelo.quantis[q].tree_info) {
        const andar = (no) => { if (no.leaf_value === undefined) { vistas.add(f.modelo.quantis[q].feature_names[no.split_feature]); andar(no.left_child); andar(no.right_child) } }
        andar(t.tree_structure)
      }
    }
    assert.ok(vistas.size >= 2, `as árvores dividem por várias variáveis (${[...vistas]})`)
    for (const c of f.casos) {
      for (const q of ['p10', 'p50', 'p90']) {
        assert.ok(Math.abs(preverArvores(f.modelo.quantis[q], c.x) - c[q]) < 1e-9, `${q}: ${JSON.stringify(c.x)}`)
      }
    }
  })
}

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

test('divisão categórica (==) não suportada: falha em vez de avaliar mal', () => {
  const dump = {
    feature_names: ['a'],
    tree_info: [
      { tree_structure: { split_feature: 0, decision_type: '==', threshold: '1||2', default_left: false, left_child: { leaf_value: 10 }, right_child: { leaf_value: 20 } } }
    ]
  }
  assert.throws(() => preverArvores(dump, { a: 1 }), /não numérica/)
})
