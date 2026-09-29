'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstado, passo, distancia, LIMITES } = require('../lib/regras')

const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const PENICHE = { latitude: 39.3530, longitude: -9.3780 }
const aNorte = (m) => ({ latitude: PENICHE.latitude + m / 111320, longitude: PENICHE.longitude })

function correr (passos, e = novoEstado()) {
  const notif = []
  const acoes = []
  for (const [t, l] of passos) {
    const r = passo(e, { posicao: PENICHE, sog: 0, motorLigado: false, ...l }, t)
    e = r.estado
    notif.push(...r.notificacoes.map(n => ({ ...n, t })))
    acoes.push(...r.acoes.map(a => ({ ...a, t })))
  }
  return { e, notif, acoes }
}
const minutos = (de, ate, l, passoMin = 1) => { const r = []; for (let m = de; m <= ate; m += passoMin) r.push([m * MIN, typeof l === 'function' ? l(m) : l]); return r }
const ids = (ns) => ns.map(n => `${n.id}:${n.state}`)

test('limites aprovados', () => {
  assert.equal(LIMITES.raio, 30)
  assert.equal(LIMITES.arranquesHora, 4)
  assert.equal(LIMITES.bombaSeguida, 3 * MIN)
})

test('distância em metros', () => {
  assert.ok(Math.abs(distancia(PENICHE, aNorte(50)) - 50) < 0.5)
})

test('deriva: ponto gravado sozinho com 30 min parado; alarme a 31 m; limpa abaixo de 24 m', () => {
  const r = correr([
    ...minutos(0, 31, {}),
    ...minutos(32, 34, { posicao: aNorte(31) }),
    ...minutos(35, 36, { posicao: aNorte(26) }),
    ...minutos(37, 38, { posicao: aNorte(20) })
  ])
  assert.ok(r.e.amarracao.ponto)
  assert.deepEqual(ids(r.notif.filter(n => n.id === 'deriva')), ['deriva:alarm', 'deriva:normal'])
  assert.match(r.notif.find(n => n.id === 'deriva').message, /31 m/)
})

test('deriva: a andar a motor não grava ponto nem dá alarme', () => {
  const r = correr(minutos(0, 60, (m) => ({ posicao: aNorte(m * 100), sog: 2.5, motorLigado: true })))
  assert.equal(r.e.amarracao.ponto, null)
  assert.deepEqual(r.notif, [])
})

test('porão: sensor de água dá alarme logo', () => {
  const r = correr([[0, { agua: false }], [S, { agua: true }], [2 * S, { agua: false }]])
  assert.deepEqual(ids(r.notif.filter(n => n.id === 'aguaPorao')), ['aguaPorao:alarm', 'aguaPorao:normal'])
})

test('bomba de porão: 5 arranques numa hora → alarme; 3 por hora não', () => {
  const ciclos = (n, porHora) => { const p = []; for (let i = 0; i < n; i++) { const t0 = i * (H / porHora); p.push([t0, { bomba: true }], [t0 + 30 * S, { bomba: false }]) } return p }
  assert.deepEqual(ids(correr(ciclos(5, 5)).notif.filter(n => n.id === 'bombaPorao')), ['bombaPorao:alarm'])
  assert.deepEqual(correr(ciclos(6, 3)).notif.filter(n => n.id === 'bombaPorao'), [])
})

test('bomba de porão: mais de 3 min seguidos → alarme', () => {
  const r = correr([[0, { bomba: true }], [2 * MIN, { bomba: true }], [3 * MIN + S, { bomba: true }]])
  const n = r.notif.filter(x => x.id === 'bombaPorao')
  assert.deepEqual(ids(n), ['bombaPorao:alarm'])
  assert.match(n[0].message, /3 min/)
})

test('fumo é emergência; líquido debaixo do depósito é alarme', () => {
  const r = correr([[0, { fumo: true, liquidoGasoleo: true }]])
  assert.equal(r.notif.find(n => n.id === 'fumo').state, 'emergency')
  assert.equal(r.notif.find(n => n.id === 'fugaGasoleo').state, 'alarm')
})

test('intrusão: só armado; gaiuta ou movimento → alarme e pede fotografia', () => {
  const desarmado = correr([[0, { gaiuta: true, movimento: true }]])
  assert.deepEqual(desarmado.notif.filter(n => n.id === 'intrusao'), [])
  const armado = correr([[0, { armado: true }], [S, { armado: true, gaiuta: true }], [2 * S, { armado: true, gaiuta: false }]])
  assert.deepEqual(ids(armado.notif.filter(n => n.id === 'intrusao')), ['intrusao:alarm'])
  assert.ok(armado.acoes.some(a => a.tipo === 'foto'))
})

test('intrusão fica ativa até desarmar', () => {
  const r = correr([[0, { armado: true, movimento: true }], [MIN, { armado: true, movimento: false }], [2 * MIN, { armado: false }]])
  assert.deepEqual(ids(r.notif.filter(n => n.id === 'intrusao')), ['intrusao:alarm', 'intrusao:normal'])
})

test('lembrete de armar: desarmado e sem movimento há 12 h, uma vez em cada 12 h', () => {
  const passos = [[0, { movimento: true }]]
  for (let h = 1; h <= 25; h++) passos.push([h * H, { movimento: false }])
  const r = correr(passos)
  const lembretes = r.acoes.filter(a => a.tipo === 'lembrete')
  assert.deepEqual(lembretes.map(a => a.t / H), [12, 24])
})
