'use strict'
// Avaliador dos modelos LightGBM em JavaScript, a partir do dump_model() em
// JSON: soma as folhas de todas as árvores. Segue as regras do LightGBM para
// valores em falta (missing_type None/Zero/NaN e default_left), por isso dá
// exatamente o mesmo que o Python (há um teste contra casos do próprio LightGBM).

const ZERO = 1e-35

function vaiEsquerda (no, v) {
  if (no.decision_type !== undefined && no.decision_type !== '<=') throw new Error(`divisão não numérica (${no.decision_type}) não suportada`)
  if (v === null || v === undefined || Number.isNaN(v)) v = NaN
  if (Number.isNaN(v) && no.missing_type !== 'NaN') v = 0
  if ((no.missing_type === 'Zero' && Math.abs(v) <= ZERO) || (no.missing_type === 'NaN' && Number.isNaN(v))) return no.default_left
  return v <= no.threshold
}

// dump: o objeto de dump_model(); x: { nomeDaVariavel: número | null }.
function preverArvores (dump, x) {
  const nomes = dump.feature_names
  let soma = 0
  for (const t of dump.tree_info) {
    let no = t.tree_structure
    while (no.leaf_value === undefined) no = vaiEsquerda(no, x[nomes[no.split_feature]]) ? no.left_child : no.right_child
    soma += no.leaf_value
  }
  return soma
}

module.exports = { preverArvores }
