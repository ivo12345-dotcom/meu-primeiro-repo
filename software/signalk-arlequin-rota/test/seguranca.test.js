'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const s = require('../lib/seguranca')
const c = require('../lib/costa')

// Costa inventada: terra a leste do meridiano 9° W. distância = (−9 − lon) × MN por grau.
const costaFalsa = { distanciaTerra: (p) => Math.max(0, (-9 - p.lon) * c.escalas(p.lat).kx) }
const aW = (mn, lat = 39) => -9 - mn / c.escalas(lat).kx // longitude a mn MN da costa

// Uma rota: saída e entrada perto de terra (costaLivre), a linha no afastamento dado.
function rota (afastamento, { desvio = null } = {}) {
  const pontos = [
    { lat: 38.9, lon: aW(0.5, 38.9), perna: null, costaLivre: true },
    { lat: 38.95, lon: aW(1.5, 38.95), perna: 'aproximacao', costaLivre: true },
    { lat: 39.0, lon: aW(afastamento), perna: 'ligacao', costaLivre: true },
    { lat: 39.2, lon: aW(desvio ?? afastamento, 39.2), perna: 'linha' },
    { lat: 39.4, lon: aW(afastamento, 39.4), perna: 'linha' },
    { lat: 39.45, lon: aW(1, 39.45), perna: 'ligacao', costaLivre: true },
    { lat: 39.46, lon: aW(0.2, 39.46), perna: 'aproximacao', costaLivre: true }
  ]
  return { afastamento, pontos, excluida: false, avisos: [] }
}

// Uma passagem inventada: n minutos iguais, com o que se pedir por cima.
function passagem ({ min = 300, ponto = {}, resumo = {} } = {}) {
  const pontos = Array.from({ length: min }, (_, i) => ({ t: i * 60000, motor: false, tws: 15, rajada: 18, ondas: 2, noite: false, ...ponto }))
  return { pontos, resumo: { ventoMax: 15, rajadaMax: 18, ondasMax: 2, gasoleoGasto: 5, socFinal: 0.9, ...resumo } }
}
const base = (o = {}) => ({ alternativa: rota(5), pessimista: passagem(), provavel: passagem(), destino: { nome: 'Peniche', conhecido: true }, tripulacao: 'so', sairAgora: false, gasoleoInicial: 100, costa: costaFalsa, ...o })

test('uma passagem boa não tem motivos', () => {
  const r = s.avaliar(base())
  assert.deepEqual(r.motivos, [])
  assert.equal(r.excluida, false)
  assert.equal(r.naoRecomendada, false)
  assert.ok(Math.abs(r.costaMinMn - 5) < 0.01)
  assert.equal(r.horasLemeEq, 5)
})

test('excluída sempre: rota impossível (rotas.js) e mais perto da costa do que o mínimo na linha (a geometria, não o rasto)', () => {
  const imp = s.avaliar(base({ alternativa: { afastamento: 5, excluida: true, motivo: 'não há passagem a 5 MN entre A e B', pontos: [] } }))
  assert.equal(imp.excluida, true)
  assert.deepEqual(imp.motivos, ['não há passagem a 5 MN entre A e B'])
  // a linha encosta a 4,2 MN num ponto: excluída
  const perto = s.avaliar(base({ alternativa: rota(5, { desvio: 4.2 }) }))
  assert.equal(perto.excluida, true)
  assert.equal(perto.motivos[0], 'a rota passa a 4,2 MN da costa (mínimo 5 MN)')
  // a 4,95 MN (tolerância de 0,1 MN) passa; as aproximações a 0,2 MN não contam
  assert.equal(s.avaliar(base({ alternativa: rota(5, { desvio: 4.95 }) })).excluida, false)
  // o mínimo é configurável
  assert.equal(s.avaliar(base({ opcoes: { afastamentoMinimo: 8 } })).excluida, true)
  // a rota de 3 MN (só com vento de terra, que o rotas.js já garante) tem o mínimo de 3
  assert.equal(s.avaliar(base({ alternativa: rota(3) })).excluida, false)
  assert.equal(s.avaliar(base({ alternativa: rota(3, { desvio: 2.5 }) })).motivos[0], 'a rota passa a 2,5 MN da costa (mínimo 3 MN)')
  // o rasto simulado não conta: um ponto da passagem a 1 MN da costa não muda nada
  assert.equal(s.avaliar(base({ pessimista: passagem({ ponto: { costa: 1 } }) })).excluida, false)
  // com a distância já medida (a mesma geometria em todas as partidas)
  assert.equal(s.avaliar(base({ costa: null, costaMinMn: 4.5 })).excluida, true)
})

test('gasóleo < 40 L ou bateria < 50% à chegada no pessimista: excluída, ou aviso vermelho em "sair agora"', () => {
  const gas = s.avaliar(base({ pessimista: passagem({ resumo: { gasoleoGasto: 65 } }) }))
  assert.equal(gas.excluida, true)
  assert.deepEqual(gas.motivos, ['chegas com 35 L de gasóleo no pior caso (mínimo 40 L)'])
  const bat = s.avaliar(base({ pessimista: passagem({ resumo: { socFinal: 0.45 } }) }))
  assert.deepEqual(bat.motivos, ['chegas com a bateria a 45% no pior caso (mínimo 50%)'])
  const agora = s.avaliar(base({ sairAgora: true, pessimista: passagem({ resumo: { gasoleoGasto: 65, socFinal: 0.45 } }) }))
  assert.equal(agora.excluida, false)
  assert.equal(agora.avisosVermelhos.length, 2)
  // no limite (40 L, 50%) ainda passa
  assert.equal(s.avaliar(base({ pessimista: passagem({ resumo: { gasoleoGasto: 60, socFinal: 0.5 } }) })).excluida, false)
})

test('"não recomendada sozinho": vento, rajadas e ondas do pessimista acima dos limites; acompanhado não conta', () => {
  const r = s.avaliar(base({ pessimista: passagem({ resumo: { ventoMax: 23, rajadaMax: 31, ondasMax: 3.2 } }) }))
  assert.equal(r.naoRecomendada, true)
  assert.equal(r.excluida, false)
  assert.deepEqual(r.motivos, [
    'vento médio até 23 nós no pior caso (limite 22 sozinho)',
    'rajadas até 31 nós no pior caso (limite 30 sozinho)',
    'ondas até 3,2 m no pior caso (limite 3 m sozinho)'
  ])
  // no limite exato não conta (é "mais de")
  assert.equal(s.avaliar(base({ pessimista: passagem({ resumo: { ventoMax: 22, rajadaMax: 30, ondasMax: 3 } }) })).naoRecomendada, false)
  // o provável não conta para os limites
  assert.equal(s.avaliar(base({ provavel: passagem({ resumo: { rajadaMax: 40 } }) })).naoRecomendada, false)
  const acomp = s.avaliar(base({ tripulacao: 'acompanhado', pessimista: passagem({ min: 900, resumo: { rajadaMax: 35 } }) }))
  assert.equal(acomp.naoRecomendada, false)
  assert.deepEqual(acomp.motivos, [])
})

test('horas equivalentes ao leme: mais de 8 h; o motor em calma (vento < 10, ondas < 1,5) conta metade', () => {
  assert.equal(s.avaliar(base({ pessimista: passagem({ min: 481 }) })).naoRecomendada, true)
  assert.equal(s.avaliar(base({ pessimista: passagem({ min: 480 }) })).naoRecomendada, false)
  const calma = passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: 1 } })
  assert.equal(s.horasLemeEquivalentes(calma.pontos), 7.5)
  assert.equal(s.avaliar(base({ pessimista: calma })).naoRecomendada, false)
  // com ondas de 1,5 m (ou sem ondas previstas) já não é calma
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: 1.5 } }).pontos), 15)
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: null } }).pontos), 15)
  // à vela com pouco vento não é "motor em calma"
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 60, ponto: { motor: false, tws: 6, ondas: 1 } }).pontos), 1)
  const r = s.avaliar(base({ pessimista: passagem({ min: 600 }) }))
  assert.deepEqual(r.motivos, ['10,0 h equivalentes ao leme (limite 8 h sozinho)'])
})

test('chegada de noite a um porto desconhecido (no pessimista ou no provável)', () => {
  const noite = (p) => { p.pontos.at(-1).noite = true; return p }
  const desconhecido = { nome: 'Figueira da Foz', conhecido: false }
  const r = s.avaliar(base({ destino: desconhecido, pessimista: noite(passagem()) }))
  assert.equal(r.naoRecomendada, true)
  assert.deepEqual(r.motivos, ['chegada de noite a Figueira da Foz, um porto que não conheces'])
  assert.equal(r.chegadaNoite, true)
  assert.equal(s.avaliar(base({ destino: desconhecido, provavel: noite(passagem()) })).naoRecomendada, true)
  assert.equal(s.avaliar(base({ destino: { nome: 'Peniche', conhecido: true }, pessimista: noite(passagem()) })).naoRecomendada, false)
  assert.equal(s.avaliar(base({ destino: desconhecido })).naoRecomendada, false)
})
