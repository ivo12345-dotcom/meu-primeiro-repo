'use strict'
// Pontos de calibração: acrescenta um ponto (razão, litros) e substitui o que
// estiver muito perto na razão (±0,005). Só aceita pontos coerentes: com a
// tabela ordenada pela razão, os litros têm de subir sempre (ou descer sempre,
// se a sonda for ao contrário). Um ponto incoerente quer dizer um engano
// (abastecimento registado antes de meter o gasóleo, ou litros mal escritos).

function arredondar (ponto) {
  return { razao: Math.round(ponto.razao * 10000) / 10000, litros: Math.round(ponto.litros * 10) / 10 }
}

function monotona (t) {
  if (t.length < 2) return true
  const sobe = t.every((p, i) => i === 0 || p.litros > t[i - 1].litros)
  const desce = t.every((p, i) => i === 0 || p.litros < t[i - 1].litros)
  return sobe || desce
}

// Devolve { tabela } ou { erro } sem mexer na tabela original.
function acrescentarPonto (tabela, ponto, tolerancia = 0.005) {
  const p = arredondar(ponto)
  const outros = (tabela || []).filter(x => Math.abs(x.razao - p.razao) > tolerancia)
  const nova = [...outros, p].sort((a, b) => a.razao - b.razao)
  if (!monotona(nova)) {
    return { erro: `${p.litros} L não bate certo com a calibração (razão ${p.razao}). A sonda já mudou? Espera 3 min com o barco direito depois de abastecer, e confirma os litros.` }
  }
  return { tabela: nova }
}

module.exports = { acrescentarPonto, monotona }
