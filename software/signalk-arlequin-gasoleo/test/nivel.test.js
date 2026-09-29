'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { litrosDaRazao, novoEstado, passo, LIMITES } = require('../lib/nivel')

const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const GRAU = Math.PI / 180

// Tabela de teste: razão 0,10 (vazio) → 0,70 (cheio), não linear.
const TABELA = [{ razao: 0.10, litros: 0 }, { razao: 0.30, litros: 40 }, { razao: 0.50, litros: 120 }, { razao: 0.70, litros: 200 }]
// Inversa, para gerar amostras com um nível conhecido.
function razaoDe (litros) {
  for (let i = 1; i < TABELA.length; i++) {
    const a = TABELA[i - 1]
    const b = TABELA[i]
    if (litros <= b.litros) return a.razao + (b.razao - a.razao) * (litros - a.litros) / (b.litros - a.litros)
  }
  return 0.7
}

// duracao em ms; um passo por segundo.
function correr (duracao, f, estado = novoEstado(), t0 = 0) {
  let e = estado
  const notif = []
  const abast = []
  let ultimo = null
  for (let s = 0; s < duracao / S; s++) {
    const t = t0 + s * S
    const r = passo(e, { t, ...f(t) }, TABELA)
    e = r.estado
    notif.push(...r.notificacoes.map(n => ({ ...n, t })))
    if (r.abastecimento) abast.push(r.abastecimento)
    ultimo = r
  }
  return { e, notif, abast, ultimo }
}

// Amostra: nível L, alimentação V, adorno, consumo L/h, motor
const amostra = (L, { v = 12.6, roll = 0, lh = 0, motor = false, ruido = 0 } = {}) =>
  ({ sonda: razaoDe(L) * v * (1 + ruido), alimentacao: v, roll, fuelRate: lh / 3600 / 1000, motorLigado: motor })

test('tabela: interpolação e fora dos limites', () => {
  assert.ok(Math.abs(litrosDaRazao(TABELA, 0.40) - 80) < 1e-9)
  assert.equal(litrosDaRazao(TABELA, 0.05), 0)
  assert.equal(litrosDaRazao(TABELA, 0.90), 200)
  assert.equal(litrosDaRazao([{ razao: 0.1, litros: 0 }], 0.4), null)
  // sonda ao contrário (razão desce com o nível)
  const inv = [{ razao: 0.8, litros: 0 }, { razao: 0.2, litros: 200 }]
  assert.ok(Math.abs(litrosDaRazao(inv, 0.5) - 100) < 1e-9)
})

test('a tensão das baterias não muda o nível (razão)', () => {
  const a = correr(4 * MIN, () => amostra(120, { v: 12.5 }))
  const b = correr(4 * MIN, () => amostra(120, { v: 14.2 }))
  assert.ok(Math.abs(a.e.litros - 120) < 0.5)
  assert.ok(Math.abs(b.e.litros - 120) < 0.5)
})

test('sem tabela: não inventa litros, mas dá a razão mediana para calibrar', () => {
  let e = novoEstado()
  for (let s = 0; s < 200; s++) e = passo(e, { t: s * S, ...amostra(100) }, []).estado
  assert.equal(e.litros, null)
  assert.ok(Math.abs(e.razaoMediana - razaoDe(100)) < 1e-9)
})

test('balanço: amostras com adorno > 5° não entram; a mediana ignora picos', () => {
  const r = correr(5 * MIN, (t) => {
    const s = Math.floor(t / S)
    if (s % 3 === 0) return amostra(60, { roll: 15 * GRAU }) // adornado: ignorar
    return amostra(s % 10 === 1 ? 180 : 100) // picos de 180 L de vez em quando
  })
  assert.ok(Math.abs(r.e.litros - 100) < 1, `litros ${r.e.litros}`)
})

test('fusão: a motor desce suave com o consumo', () => {
  // Nível real a descer 2 L/h durante 2 h; a boia com muito ruído.
  const r = correr(2 * H, (t) => {
    const real = 120 - 2 * t / H
    return amostra(real, { lh: 2, motor: true, ruido: (Math.sin(t / 7000) * 0.15) })
  })
  assert.ok(Math.abs(r.e.litros - 116) < 1.5, `litros ${r.e.litros}`)
})

test('abastecimento: salta logo e dá o evento com os litros', () => {
  const antes = correr(5 * MIN, () => amostra(40))
  const r = correr(5 * MIN, () => amostra(125), antes.e, 5 * MIN)
  assert.equal(r.abast.length, 1)
  assert.ok(Math.abs(r.abast[0].antes - 40) < 1)
  assert.ok(Math.abs(r.abast[0].depois - 125) < 1)
  assert.ok(Math.abs(r.e.litros - 125) < 1)
})

test('reserva: aviso a 40 L, limpa acima de 45 L', () => {
  const r1 = correr(4 * MIN, () => amostra(39))
  assert.deepEqual(r1.notif.filter(n => n.id === 'reserva').map(n => n.state), ['warn'])
  assert.deepEqual(r1.notif.find(n => n.id === 'reserva').method, ['visual', 'sound'])
  const r2 = correr(4 * MIN, () => amostra(43), r1.e, 4 * MIN)
  assert.deepEqual(r2.notif.filter(n => n.id === 'reserva'), [])
  const r3 = correr(4 * MIN, () => amostra(50), r2.e, 8 * MIN)
  assert.deepEqual(r3.notif.filter(n => n.id === 'reserva').map(n => n.state), ['normal'])
})

test('fuga: 6 L em 10 h com o motor parado → alarme', () => {
  const r = correr(10 * H, (t) => amostra(150 - 6 * t / (10 * H)))
  const f = r.notif.filter(n => n.id === 'fuga')
  assert.deepEqual(f.map(n => n.state), ['alarm'])
  assert.match(f[0].message, /fuga/i)
})

test('sem fuga: dilatação de ~1,7 L e ruído não disparam', () => {
  const r = correr(12 * H, (t) => amostra(150 - 1.7 * Math.sin(Math.PI * t / (12 * H)), { ruido: Math.sin(t / 5000) * 0.02 }))
  assert.deepEqual(r.notif.filter(n => n.id === 'fuga'), [])
})

test('fuga: gastar a motor não conta', () => {
  const r = correr(3 * H, (t) => amostra(150 - 2 * t / H, { lh: 2, motor: true }))
  assert.deepEqual(r.notif.filter(n => n.id === 'fuga'), [])
})

test('limites aprovados', () => {
  assert.equal(LIMITES.reserva, 40)
  assert.equal(LIMITES.fugaLitros, 5)
  assert.equal(LIMITES.fugaJanela, 12 * H)
})

// Uma saída a motor: parado 5 min, motor N horas a gastar realLh (o J1939 diz esperadoLh), parado 5 min.
function saida ({ horas, realLh, esperadoLh, inicio = 150 }) {
  const t1 = 5 * MIN
  const t2 = t1 + horas * H
  return correr(t2 + 5 * MIN, (t) => {
    if (t < t1) return amostra(inicio)
    if (t < t2) return amostra(inicio - realLh * (t - t1) / H, { lh: esperadoLh, motor: true, roll: 0.3 }) // no mar: sonda não conta
    return amostra(inicio - realLh * horas)
  })
}

test('consumo anormal: gastou muito mais do que o esperado → aviso de possível fuga', () => {
  const r = saida({ horas: 3, realLh: 3.5, esperadoLh: 2 }) // 10,5 L em vez de 6 L
  const n = r.notif.filter(x => x.id === 'consumoAnormal')
  assert.deepEqual(n.map(x => x.state), ['warn'])
  assert.match(n[0].message, /10,5 L em vez de ~6,0 L/)
  assert.match(n[0].message, /fuga/)
  assert.ok(Math.abs(r.e.ultimaSessao.fatorSugerido - 1.75) < 0.05)
})

test('consumo normal (ou ligeiramente acima): sem aviso, e dá o fator para calibrar', () => {
  const r = saida({ horas: 3, realLh: 2.2, esperadoLh: 2 }) // 6,6 L em vez de 6 L
  assert.deepEqual(r.notif.filter(x => x.id === 'consumoAnormal'), [])
  assert.ok(Math.abs(r.e.ultimaSessao.medido - 6.6) < 0.3)
  assert.ok(Math.abs(r.e.ultimaSessao.fatorSugerido - 1.1) < 0.05)
})

test('saída curta (< 1 L esperado): não compara', () => {
  const r = saida({ horas: 0.2, realLh: 6, esperadoLh: 2 })
  assert.deepEqual(r.notif.filter(x => x.id === 'consumoAnormal'), [])
})
