'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstado, passo, distancia, LIMITES, ALARMES, APITO, ACAO } = require('../lib/regras')

const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const PENICHE = { latitude: 39.3530, longitude: -9.3780 }
const aNorte = (m) => ({ latitude: PENICHE.latitude + m / 111320, longitude: PENICHE.longitude })

// por omissão em Peniche (um porto conhecido: juntoAPorto, calculado pelo plugin com lib/lugares.js)
function correr (passos, e = novoEstado()) {
  const notif = []
  const acoes = []
  for (const [t, l] of passos) {
    const r = passo(e, { posicao: PENICHE, sog: 0, motorLigado: false, juntoAPorto: true, ...l }, t)
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

// ---------- auditoria I-20 (decisão n.º 24 do dono): o ponto de amarração ----------
const NO = 1852 / 3600
const amarrado = () => correr(minutos(0, 31, {})).e // o ponto gravado em Peniche
// de segundo a segundo, a afastar-se para norte a `nos` nós desde o ponto
const aAndar = (t0, nos, segundos, l = {}) => Array.from({ length: segundos }, (_, s) => [t0 + (s + 1) * S, { posicao: aNorte(nos * NO * (s + 1)), sog: nos * NO, ...l }])

test('auditoria I-20: calmaria no mar (longe de um porto ou fundeadouro conhecido): 30 min parado não grava o ponto e, ao seguir à vela, não há deriva (sonda p3, caso 1)', () => {
  const r = correr([
    ...minutos(0, 60, { sog: 0.2 * NO, juntoAPorto: false }),
    ...aAndar(60 * MIN, 4, 180, { juntoAPorto: false })
  ])
  assert.equal(r.e.amarracao.ponto, null)
  assert.deepEqual(r.notif.filter(n => n.id === 'deriva'), [])
})

test('auditoria I-20: junto a um porto conhecido grava com 30 min parado; sem saber se está junto a um (juntoAPorto em falta) não grava', () => {
  assert.ok(amarrado().amarracao.ponto)
  assert.equal(correr(minutos(0, 60, { juntoAPorto: undefined })).e.amarracao.ponto, null)
})

// ---------- Adenda 2 do dono (02/10), "Largar": a motor e a andar o ponto apaga-se sozinho; sem motor (ou
// sem leitura do motor) o "saiu do lugar" nunca se apaga sozinho, só com "Larguei" (ecrã) ou /largar
// (Telegram: lib/regras.js não os vê, é o plugin que apaga o ponto); armado, nunca sozinho, nem a motor ----------
const deriva = (r) => r.notif.filter(n => n.id === 'deriva').map(n => `${(n.t - 31 * MIN) / S} s: ${n.state}`)

test('Adenda 2 (Largar): sair sem leitura das rotações (à vela, ou com o CAN solto): o "saiu do lugar" sai aos 30 m (a 3 nós aos 20 s, a 5 nós aos 12 s) e fica — nunca um "Resolvido" automático pela velocidade', () => {
  const vela = correr(aAndar(31 * MIN, 3, 600), amarrado())
  assert.deepEqual(deriva(vela), ['20 s: alarm'])
  assert.ok(vela.e.amarracao.ponto, 'o ponto fica até ao "Larguei"')
  const canSolto = correr(aAndar(31 * MIN, 5, 600, { motorLigado: false }), amarrado())
  assert.deepEqual(deriva(canSolto), ['12 s: alarm'])
  assert.ok(canSolto.e.amarracao.ponto)
})

test('Adenda 2 (Largar): a âncora a garrar depressa com o Ivo a bordo (desarmado, sem motor, 3 nós durante 10 min): o alarme fica, sem "Resolvido"', () => {
  const r = correr(aAndar(31 * MIN, 3, 600, { armado: false, motorLigado: false }), amarrado())
  assert.deepEqual(deriva(r), ['20 s: alarm'])
  assert.equal(r.e.ativos.deriva.state, 'alarm')
  assert.match(r.e.ativos.deriva.message, /^O barco saiu do lugar: está a 31 m do ponto de amarração$/)
})

test('Adenda 2 (Largar): a motor e a andar, desarmado: o ponto apaga-se logo, sem alarme', () => {
  const r = correr([[31 * MIN + S, { posicao: aNorte(5), sog: 1.5 * NO, motorLigado: true }]], amarrado())
  assert.equal(r.e.amarracao.ponto, null)
  assert.deepEqual(r.notif.filter(n => n.id === 'deriva'), [])
  // e a sair da marina a motor (4 nós, 10 min): nunca um alarme
  const saida = correr(aAndar(31 * MIN, 4, 600, { motorLigado: true }), amarrado())
  assert.equal(saida.e.amarracao.ponto, null)
  assert.deepEqual(deriva(saida), [])
})

test('Adenda 2 (Largar): a motor e a andar com o alarme de intrusão ARMADO (ninguém a bordo: roubo): o ponto fica e o alarme sai aos 30 m', () => {
  const r = correr(aAndar(31 * MIN, 4, 600, { motorLigado: true, armado: true }), amarrado())
  assert.ok(r.e.amarracao.ponto, 'armado: o ponto nunca se apaga sozinho')
  // a 4 nós (2,06 m/s) passa os 30 m aos 15 s
  assert.deepEqual(deriva(r), ['15 s: alarm'])
  // e armado sem motor também
  const vela = correr(aAndar(31 * MIN, 3, 600, { armado: true }), amarrado())
  assert.ok(vela.e.amarracao.ponto)
  assert.deepEqual(deriva(vela), ['20 s: alarm'])
})

test('Adenda 2 / contrato C10: o alarme "saiu do lugar" leva acao: "largar" (o botão "Larguei" do ecrã); o normal não', () => {
  const r = correr([...aAndar(31 * MIN, 3, 30), [31 * MIN + 40 * S, { posicao: PENICHE }]], amarrado())
  const ns = r.notif.filter(n => n.id === 'deriva')
  assert.deepEqual(ns.map(n => n.state), ['alarm', 'normal'])
  assert.equal(ns[0].acao, 'largar')
  assert.equal(ns[0].apito, 'curto')
  assert.equal(ns[1].acao, undefined)
  // só a deriva tem uma ação
  const outros = correr([[0, { agua: true, fumo: true, liquidoGasoleo: true, armado: true, movimento: true }]])
  assert.ok(outros.notif.every(n => n.acao === undefined), JSON.stringify(outros.notif))
  assert.deepEqual(ACAO, { deriva: 'largar' })
})

test('Adenda 2 (Largar): sem o ponto (o "Larguei"), o alarme "saiu do lugar" limpa mesmo sem posição do GPS', () => {
  const e = correr(aAndar(31 * MIN, 3, 30), amarrado()).e
  assert.equal(e.ativos.deriva.state, 'alarm')
  const largado = { ...e, amarracao: { ...e.amarracao, ponto: null } }
  const r = passo(largado, { posicao: undefined, sog: undefined }, 32 * MIN)
  assert.deepEqual(r.notificacoes.map(n => `${n.id}:${n.state}`), ['deriva:normal'])
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

test('auditoria I-07 (decisão n.º 2, contrato C1): apito contínuo para o perigo imediato (fumo, água no porão e bomba, fuga de gasóleo); curto para a intrusão e a deriva; o normal sem apito', () => {
  const r = correr([
    [0, { agua: true, fumo: true, liquidoGasoleo: true, bomba: true, armado: true, movimento: true }],
    [3 * MIN + S, { agua: true, fumo: true, liquidoGasoleo: true, bomba: true, armado: true }],
    ...minutos(4, 34, { agua: true, fumo: true, liquidoGasoleo: true, bomba: true, armado: true }),
    [35 * MIN, { posicao: aNorte(40), agua: false, fumo: false, liquidoGasoleo: false, bomba: false, armado: false }]
  ])
  const apito = (id, state) => r.notif.filter(n => n.id === id && n.state === state).map(n => n.apito)
  assert.deepEqual(apito('aguaPorao', 'alarm'), ['continuo'])
  assert.deepEqual(apito('fumo', 'emergency'), ['continuo'])
  assert.deepEqual(apito('fugaGasoleo', 'alarm'), ['continuo'])
  assert.deepEqual(apito('bombaPorao', 'alarm'), ['continuo'])
  assert.deepEqual(apito('intrusao', 'alarm'), ['curto'])
  assert.deepEqual(apito('deriva', 'alarm'), ['curto'])
  for (const id of ['aguaPorao', 'fumo', 'fugaGasoleo', 'intrusao']) assert.deepEqual(apito(id, 'normal'), [undefined], id)
  // todos os alarmes deste plugin têm o seu apito
  assert.deepEqual(Object.keys(APITO).sort(), [...ALARMES].sort())
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
