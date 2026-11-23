'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { criarGerador, quaterniao, CENARIO } = require('../lib/gerador')
const { ler, soma } = require('../../../signalk-arlequin-caixas/lib/linhas')
const c = require('../../../signalk-arlequin-caixas/lib/contas')
const GRAU = Math.PI / 180
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} não é ${b}`)

test('o quaternião feito aqui dá de volta a proa, o adornamento e o caimento', () => {
  const r = c.atitude(quaterniao({ proa: 245, adorno: 12, caimento: -2 }), c.eixos('+y', '+z'))
  perto(r.heading, 245 * GRAU, 1e-6); perto(r.roll, 12 * GRAU, 1e-6); perto(r.pitch, -2 * GRAU, 1e-6)
})

test('10 s de caixa: todas as linhas se leem e as cadências batem certo', () => {
  const g = criarGerador()
  const linhas = []
  for (let ms = 100; ms <= 10000; ms += 100) linhas.push(...g.linhas(ms))
  const lidas = linhas.map(ler)
  assert.ok(lidas.every(Boolean), linhas[lidas.indexOf(null)])
  const de = (tipo) => lidas.filter(l => l.tipo === tipo)
  assert.equal(de('batimento').filter(b => b.caixa === 1).length, 10)
  assert.equal(de('batimento').filter(b => b.caixa === 2).length, 10)
  assert.ok(de('batimento').every(b => b.sim === true))
  assert.equal(de('log').length, 20)
  assert.equal(de('movimento').length, 100)
  assert.deepEqual(de('movimento').map(m => m.n), Array.from({ length: 100 }, (_, i) => i + 1))
  assert.ok(de('vento').length >= 10)
  assert.equal(de('motor').length, 0) // nos primeiros 60 s o motor está desligado
})

test('os valores são os do cenário', () => {
  const g = criarGerador()
  let log = c.novoLog(); let ultimo
  for (let ms = 100; ms <= 4000; ms += 100) for (const l of g.linhas(ms).map(ler)) { if (l.tipo === 'log') log = c.juntarLog(log, l); if (l.tipo === 'movimento') ultimo = l; if (l.tipo === 'vento') { assert.equal(l.angulo, CENARIO.ventoAngulo); perto(l.velocidade, CENARIO.ventoNos * c.NO, 0.01) } }
  perto(c.velocidadeNaAgua(c.hzLog(log)) / c.NO, 5.2, 0.1)
  const r = c.atitude(ultimo.q.map(v => v / 10000), c.eixos('+y', '+z'))
  perto(r.roll, 12 * GRAU, 0.01); perto(r.heading, 245 * GRAU, 4 * GRAU)
})

test('a motor: saem tramas que o plugin do motor lê', () => {
  const g = criarGerador()
  const linhas = []
  for (let ms = 100; ms <= 62000; ms += 100) linhas.push(...g.linhas(ms))
  const motor = linhas.map(ler).filter(l => l && l.tipo === 'motor')
  assert.ok(motor.length >= 5)
  assert.ok(motor.some(m => (m.id >>> 8 & 0x3FFFF) === 61444))
})

test('as linhas do motor levam a soma de tudo o que está antes do "*"', () => {
  const g = criarGerador()
  const motor = []
  for (let ms = 100; ms <= 62000; ms += 100) motor.push(...g.linhas(ms).filter(l => l.startsWith('(')))
  assert.ok(motor.length >= 5)
  for (const l of motor) {
    const m = /^(.*)\*([0-9A-F]{2})$/.exec(l)
    assert.ok(m, l)
    assert.equal(soma(m[1]), m[2], l)
  }
})

test('as opções: sem a caixa 2, sem vento e com lixo', () => {
  const tudo = (o, ate = 62000) => { const g = criarGerador(o); const l = []; for (let ms = 100; ms <= ate; ms += 100) l.push(...g.linhas(ms)); return l }
  const sem2 = tudo({ semCaixa2: true }).map(ler)
  assert.equal(sem2.filter(l => l && l.tipo === 'batimento' && l.caixa === 2).length, 0)
  assert.equal(sem2.filter(l => l && l.tipo === 'motor').length, 0)
  assert.equal(tudo({ semVento: true }, 10000).map(ler).filter(l => l && l.tipo === 'vento').length, 0)
  assert.ok(tudo({ lixo: true }, 10000).map(ler).filter(l => l === null).length >= 2)
})

test('o GPS a fingir: RMC e GGA com a soma certa', () => {
  const g = criarGerador()
  const frases = g.gps(1000)
  assert.equal(frases.length, 2)
  for (const f of frases) { const m = /^\$(.*)\*([0-9A-F]{2})$/.exec(f); assert.ok(m, f); assert.equal(soma(m[1]), m[2]) }
  assert.match(frases[0], /^\$GPRMC,\d{6}\.\d\d,A,3841\.\d+,N,00914\.\d+,W,5\.0,245\.0,\d{6},,,A\*/)
})

// --- para lá do plano: o que o plugin do motor e a caixa negra vão mesmo ver -----------------------

test('as tramas do motor leem-se no plugin do motor e dão as 2100 rotações do cenário', () => {
  const { lerLinha, descodificar } = require('../../../signalk-arlequin-j1939/lib/j1939')
  const { linhaMotor } = require('../../../signalk-arlequin-caixas/lib/linhas')
  const g = criarGerador()
  let rotacoes = null
  for (let ms = 100; ms <= 62000; ms += 100) {
    for (const l of g.linhas(ms).map(ler)) {
      if (!l || l.tipo !== 'motor') continue
      const t = lerLinha(linhaMotor(l, 1_727_600_000_000)) // como o plugin das caixas a passa ao do motor
      assert.ok(t, 'o plugin do motor não leu a trama')
      for (const v of descodificar(t.pgn, t.dados)) if (v.path === 'propulsion.main.revolutions') rotacoes = v.value * 60
    }
  }
  assert.equal(rotacoes, CENARIO.rpm)
})

test('o tempo anda sempre para a frente e uma pausa não despeja minutos de linhas de uma vez', () => {
  const g = criarGerador()
  assert.deepEqual(g.linhas(0), [])
  const antes = g.linhas(1000).length
  assert.ok(antes > 10)
  assert.deepEqual(g.linhas(1000), [], 'a mesma hora outra vez não repete linhas')
  assert.deepEqual(g.linhas(500), [], 'nem uma hora mais antiga')
  const depois = g.linhas(600000) // o programa esteve parado 10 minutos
  assert.ok(depois.length <= 8 * antes, `${depois.length} linhas depois da pausa`)
  assert.equal(depois.map(ler).filter(l => l && l.tipo === 'movimento').at(-1).n, 6000)
})

test('o GPS avança no rumo do cenário e a hora dele é a do início mais o tempo passado', () => {
  const g = criarGerador({ inicio: Date.UTC(2026, 10, 22, 23, 59, 58) })
  const rmc = (frases) => frases.findLast(f => f.startsWith('$GPRMC')).split(',')
  const a = rmc(g.gps(1000))
  const b = rmc(g.gps(3601000)) // uma hora depois: 5 milhas a 245°
  assert.equal(a[1], '235959.00')
  assert.equal(a[9], '221126')
  assert.equal(b[9], '231126')
  const graus = (campo) => Math.floor(Number(campo) / 100) + (Number(campo) % 100) / 60
  const sul = (graus(a[3]) - graus(b[3])) * 60 // milhas para sul
  const oeste = (graus(b[5]) - graus(a[5])) * 60 * Math.cos(38.66 * GRAU) // milhas para oeste
  perto(sul, 5 * Math.cos(65 * GRAU), 0.01)
  perto(oeste, 5 * Math.sin(65 * GRAU), 0.01)
})
