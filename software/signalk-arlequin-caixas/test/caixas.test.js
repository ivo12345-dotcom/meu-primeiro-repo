'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas, VELHO, ESPERA, PRESO } = require('../lib/caixas')
const bat = (caixa, sim = false) => ({ tipo: 'batimento', caixa, ms: 1, fw: '0.1.0', sim, rssi: -58, perdidos: 0 })

test('as duas caixas a falar; a 2 cala-se sem aviso daqui; a 1 cala-se com um aviso só', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(anotarBatimento(e, bat(1), 1000), bat(2), 1000)
  let r = avaliarCaixas(e, 2000)
  assert.equal(r.caixas[1].estado, 'a-receber')
  assert.equal(r.caixas[2].estado, 'a-receber')
  assert.deepEqual(r.notificacoes, [])
  e = anotarBatimento(r.estado, bat(1), 7000)
  r = avaliarCaixas(e, 7000)
  assert.equal(r.caixas[2].estado, 'sem-ligacao')
  assert.match(r.caixas[2].motivo, /caixa do motor não dá sinal/)
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, 7000 + VELHO + 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.match(r.caixas[1].motivo, /não fala há 5 s/)
  assert.match(r.caixas[2].motivo, /sem a caixa dos instrumentos/)
  assert.equal(r.notificacoes.length, 1)
  assert.deepEqual({ ...r.notificacoes[0], message: '' }, { id: 'caixa1', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: '' })
  assert.deepEqual(avaliarCaixas(r.estado, 20000).notificacoes, [])
  r = avaliarCaixas(anotarBatimento(r.estado, bat(1), 21000), 21000)
  assert.deepEqual(r.notificacoes, [{ id: 'caixa1', state: 'normal', method: [], message: 'Normal' }])
})

test('nunca falou: só avisa ao fim de 30 s, e diz porque a porta não abre', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: false, nome: 'COM7', motivo: 'File not found' }, 0)
  let r = avaliarCaixas(e, ESPERA - 1)
  assert.equal(r.caixas[1].estado, 'sem-ligacao')
  assert.deepEqual(r.notificacoes, [])
  r = avaliarCaixas(r.estado, ESPERA + 1)
  assert.match(r.notificacoes[0].message, /a porta COM7 não abre: File not found/)
})

test('a fingir: vem do batimento da caixa 1', () => {
  const e = anotarBatimento(novoEstadoCaixas(0), bat(1, true), 100)
  assert.equal(avaliarCaixas(e, 200).sim, true)
  assert.equal(avaliarCaixas(anotarBatimento(novoEstadoCaixas(0), bat(1, false), 100), 200).sim, false)
})

// Revisão final das caixas (23/11/2026): quando uma caixa deixa de fingir (ou recomeça), o que mandou a
// fingir ainda vale uns segundos no portátil (o último vento, a última atitude, a janela do log). Sem
// isto, saía como medição verdadeira durante esse tempo.
test('a fingir: fica marcado 7 s depois do último batimento a dizer que fingia', () => {
  assert.equal(PRESO, VELHO + 2000)
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(e, bat(1, true), 1000)
  e = anotarBatimento(e, bat(1, false), 2000) // deixou de fingir, ou recomeçou
  assert.equal(avaliarCaixas(e, 2100).sim, true, 'o que mandou a fingir ainda está fresco')
  e = anotarBatimento(e, bat(1, false), 7000)
  assert.equal(avaliarCaixas(e, 1000 + PRESO).sim, true)
  e = anotarBatimento(e, bat(1, false), 8000)
  assert.equal(avaliarCaixas(e, 1000 + PRESO + 1).sim, false, 'passado esse tempo, o que sai já é medição')
  // o mesmo com a caixa do motor, mesmo que ela se cale logo a seguir
  e = anotarBatimento(anotarBatimento(e, bat(1, false), 20000), bat(2, true), 20000)
  e = anotarBatimento(e, bat(1, false), 26500)
  assert.equal(avaliarCaixas(e, 26500).sim, true)
  e = anotarBatimento(e, bat(1, false), 27500)
  assert.equal(avaliarCaixas(e, 27500).sim, false)
})

// Revisão final (22/11/2026): a caixa do motor a fingir, com a dos instrumentos verdadeira, deixava
// sair as rotações sem a marca de simulado.
test('a fingir: basta uma das duas caixas dizer que finge; a do motor só enquanto der sinal', () => {
  let e = anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)
  e = anotarBatimento(anotarBatimento(e, bat(1, false), 1000), bat(2, true), 1000)
  assert.equal(avaliarCaixas(e, 1500).sim, true, 'a caixa do motor a fingir chega para marcar tudo')
  e = anotarBatimento(e, bat(1, false), 9000) // a caixa do motor calou-se há 8 s: o que dizia já não conta
  assert.equal(avaliarCaixas(e, 9100).sim, false)
  e = anotarBatimento(anotarBatimento(e, bat(2, false), 10000), bat(1, true), 10000)
  assert.equal(avaliarCaixas(e, 10100).sim, true)
  e = anotarBatimento(e, bat(1, false), 18000)
  assert.equal(avaliarCaixas(e, 18100).sim, false)
})

// --- O sensor de movimento, que a caixa 1 diz no batimento dela (programa das caixas de 23/11) -------
const batS = (sensor) => ({ ...bat(1), sensor, arranque: 1, rsts: 0 })
const aberta = () => anotarPorta(novoEstadoCaixas(0), { aberta: true, nome: 'COM7' }, 0)

test('sensor: o estado por palavras; null quando a caixa não o diz ou deixou de falar', () => {
  let e = aberta()
  assert.equal(avaliarCaixas(e, 100).sensor, null) // ainda sem batimento
  for (const [codigo, texto] of [[0, 'a-medir'], [1, 'a-arrancar'], [2, 'calado'], [3, 'nao-volta'], [4, 'a-fingir']]) {
    e = anotarBatimento(e, batS(codigo), 1000)
    assert.equal(avaliarCaixas(e, 1000).sensor, texto)
  }
  e = anotarBatimento(e, bat(1), 2000) // uma caixa que nada diz do sensor: a caixa a fingir, um programa antigo
  assert.equal(avaliarCaixas(e, 2000).sensor, null)
  e = anotarBatimento(e, batS(0), 3000)
  assert.equal(avaliarCaixas(e, 3000).sensor, 'a-medir')
  assert.equal(avaliarCaixas(e, 3000 + VELHO + 1).sensor, null) // a caixa calou-se: já não se sabe
})

test('sensor: calado ou a arrancar só dá aviso ao fim de 20 s seguidos sem medir; um aviso só; apaga-se ao medir', () => {
  let r = avaliarCaixas(anotarBatimento(aberta(), batS(0), 1000), 1000)
  assert.deepEqual(r.notificacoes, [])
  // cala-se, tenta arrancar, cala-se outra vez: enquanto não passarem 20 s sem medir, nada
  let t = 2000
  for (const codigo of [2, 1, 2, 1, 2]) {
    r = avaliarCaixas(anotarBatimento(r.estado, batS(codigo), t), t)
    assert.deepEqual(r.notificacoes, [], `aos ${t} ms`)
    t += 4000
  }
  r = avaliarCaixas(anotarBatimento(r.estado, batS(1), 22500), 22500) // 20,5 s sem medir
  assert.equal(r.notificacoes.length, 1)
  assert.deepEqual({ ...r.notificacoes[0], message: '' }, { id: 'sensor', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: '' })
  assert.match(r.notificacoes[0].message, /sensor de movimento não responde/)
  assert.deepEqual(avaliarCaixas(anotarBatimento(r.estado, batS(3), 23000), 23000).notificacoes, [])
  r = avaliarCaixas(anotarBatimento(r.estado, batS(0), 24000), 24000)
  assert.deepEqual(r.notificacoes, [{ id: 'sensor', state: 'normal', method: [], message: 'Normal' }])
})

test('sensor: "não volta" avisa logo; a fingir e sem os campos novos nunca avisam, e apagam um aviso aceso', () => {
  let r = avaliarCaixas(anotarBatimento(aberta(), batS(3), 1000), 1000)
  assert.equal(r.notificacoes.length, 1)
  assert.equal(r.notificacoes[0].state, 'warn')
  r = avaliarCaixas(anotarBatimento(r.estado, batS(4), 2000), 2000) // ligaram o gerador de bancada
  assert.deepEqual(r.notificacoes.map(n => [n.id, n.state]), [['sensor', 'normal']])
  r = avaliarCaixas(anotarBatimento(r.estado, batS(3), 3000), 3000)
  assert.equal(r.notificacoes[0].state, 'warn')
  r = avaliarCaixas(anotarBatimento(r.estado, bat(1), 4000), 4000) // deixou de dizer: não se sabe, não se avisa
  assert.deepEqual(r.notificacoes.map(n => [n.id, n.state]), [['sensor', 'normal']])
  assert.deepEqual(avaliarCaixas(anotarBatimento(aberta(), bat(1), 1000), 60000 - VELHO).notificacoes.filter(n => n.id === 'sensor'), [])
})

test('sensor: com a caixa calada o aviso do sensor fica como estava; quem avisa é o da caixa', () => {
  let r = avaliarCaixas(anotarBatimento(aberta(), batS(3), 1000), 1000)
  assert.deepEqual(r.notificacoes.map(n => n.id), ['sensor'])
  r = avaliarCaixas(r.estado, 1000 + VELHO + 1)
  assert.deepEqual(r.notificacoes.map(n => n.id), ['caixa1'])
  assert.equal(r.sensor, null)
  r = avaliarCaixas(anotarBatimento(r.estado, batS(0), 9000), 9000)
  assert.deepEqual(r.notificacoes.map(n => [n.id, n.state]).sort(), [['caixa1', 'normal'], ['sensor', 'normal']])
})
