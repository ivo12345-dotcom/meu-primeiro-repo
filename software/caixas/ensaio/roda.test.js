'use strict'
// As contas do ensaio da roda do log por fora (ensaio/roda-por-fora.js), sem placa nenhuma.
const test = require('node:test')
const assert = require('node:assert/strict')
const { FASES, comandoDaFase, contas } = require('./roda')

test('as fases cobrem a roda devagar, a meio e depressa, e uma com a roda aberta muito tempo', () => {
  assert.ok(FASES.length >= 4)
  // devagar: a roda fica aberta muito mais do que os 4 ms em que a caixa recusa um segundo impulso
  assert.ok(FASES.some(f => f.hz <= 2), 'falta uma fase devagar')
  // os 26 por segundo dos outros ensaios do log
  assert.ok(FASES.some(f => f.hz === 26), 'falta a fase dos 26 por segundo')
  // depressa: a roda fica aberta menos de 4 ms
  assert.ok(FASES.some(f => (1000 / f.hz) * f.aberta / 100 < 4), 'falta uma fase com a roda aberta menos de 4 ms')
  assert.ok(FASES.some(f => f.aberta >= 40), 'falta uma fase com a roda aberta quase metade da volta')
  for (const f of FASES) {
    assert.ok(Number.isInteger(f.hz) && f.hz >= 1 && f.hz <= 100, `${f.hz} voltas por segundo`)
    assert.ok(Number.isInteger(f.aberta) && f.aberta >= 5 && f.aberta <= 60, `${f.aberta} % aberta`)
    // aberta tempo que chegue para o pino descer: mais de 2 ms (a descida leva cerca de 0,6 ms a passar o meio)
    assert.ok((1000 / f.hz) * f.aberta / 100 >= 2, `${f.nome}: aberta menos de 2 ms, o pino não chega a descer`)
    assert.deepEqual(comandoDaFase(f), [f.hz, f.aberta])
  }
})

test('passa só quando a caixa contou exatamente as voltas que a roda a fingir deu', () => {
  const r = contas({ voltas: 520, impulsos: 520, recusados: 0 })
  assert.equal(r.passa, true)
  assert.match(r.diagnostico, /520 voltas, 520 impulsos/)
  assert.equal(contas({ voltas: 520, impulsos: 521, recusados: 0 }).passa, false)
  assert.equal(contas({ voltas: 520, impulsos: 519, recusados: 0 }).passa, false)
})

test('poucas voltas não provam nada: não passa', () => {
  const r = contas({ voltas: 3, impulsos: 3, recusados: 0 })
  assert.equal(r.passa, false)
  assert.match(r.diagnostico, /poucas voltas/)
})

test('sem nada a chegar ao pino da roda, diz onde procurar', () => {
  const r = contas({ voltas: 520, impulsos: 0, recusados: 0 })
  assert.equal(r.passa, false)
  assert.match(r.diagnostico, /não chega nada/)
  assert.match(r.diagnostico, /D26/)
})

test('o dobro dos impulsos é a subida falsa de quando a roda abre: di-lo', () => {
  const r = contas({ voltas: 520, impulsos: 1040, recusados: 0 })
  assert.equal(r.passa, false)
  assert.match(r.diagnostico, /dobro/)
  // quase o dobro também (a subida falsa não aparece em todas as voltas)
  assert.match(contas({ voltas: 520, impulsos: 1000, recusados: 0 }).diagnostico, /a mais/)
})

test('impulsos a mais ou a menos dizem-se com a conta feita', () => {
  const mais = contas({ voltas: 400, impulsos: 430, recusados: 12 })
  assert.equal(mais.passa, false)
  assert.match(mais.diagnostico, /30 impulsos a mais/)
  const menos = contas({ voltas: 400, impulsos: 380, recusados: 0 })
  assert.equal(menos.passa, false)
  assert.match(menos.diagnostico, /faltam 20 impulsos/)
})

test('as subidas recusadas mostram-se, mas não entram no veredicto', () => {
  // depressa, a subida falsa cai a menos de 4 ms da verdadeira e é recusada: a contagem fica certa
  const r = contas({ voltas: 1200, impulsos: 1200, recusados: 1200 })
  assert.equal(r.passa, true)
  assert.equal(r.recusados, 1200)
  assert.match(r.diagnostico, /1200 subidas recusadas/)
})
