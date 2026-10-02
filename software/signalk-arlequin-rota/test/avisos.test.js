'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { avisosDaPassagem, precaucoes } = require('../lib/avisos')
const { simularPassagem, noitePeloSol } = require('../lib/passagem')

const H = 3600000
const MIN = 60000
const T0 = Date.UTC(2026, 8, 29, 15) // 16:00 em Lisboa

// Linha do tempo à mão: n minutos com o que se pedir, e mudanças por minuto.
function linha (n, ponto = {}, mudancas = {}) {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * MIN, motor: false, tws: 12, rajada: 15, twd: 270, proa: 0, ondas: 1.5, chuva: 0, vis: 20000, noite: false, gasoleo: 100, soc: 0.9, wp: 'Linha de 5 MN', ...ponto, ...(mudancas[i] || {}) }))
}

test('avisos: rizar, pôr do sol, chuva/visibilidade (radar), rotação do vento, manobras, chegada de noite, reservas, comer', () => {
  const n = 10 * 60
  const m = {}
  for (let i = 120; i < 150; i++) m[i] = { vis: 3000, chuva: 1.2 } // um episódio de chuva
  for (let i = 300; i < n; i++) m[i] = { twd: 0, proa: 0 } // o vento roda de 270 para 0 às 5 h
  for (let i = 360; i < n; i++) m[i] = { ...m[i], noite: true }
  m[200] = { proa: 280 }; m[201] = { proa: 0 } // dois bordos seguidos (vento de 270°)
  for (let i = 500; i < n; i++) m[i] = { ...(m[i] || {}), gasoleo: 38, soc: 0.45 }
  const pontos = linha(n, {}, m)
  const eventos = [
    { t: T0, texto: 'Partida de Algés (16:00)', tipo: 'partida' },
    { t: T0 + 30 * MIN, texto: 'Rizar: 1 rizo (vento 17 nós, rajadas 22)', tipo: 'vela' },
    { t: T0 + 6 * H, texto: 'Pôr do sol (22:00): ecrã em modo noite, luzes de navegação', tipo: 'noite' },
    { t: T0 + 7 * H, texto: 'Largar rizo: 0 rizos (vento 12 nós, rajadas 15)', tipo: 'vela' },
    { t: T0 + 10 * H, texto: 'Chegada a Peniche (02:00)', tipo: 'chegada' }
  ]
  const a = avisosDaPassagem({ passagem: { pontos, eventos, resumo: { chegou: true } }, destino: { nome: 'Figueira da Foz', conhecido: false }, tripulacao: 'so' })
  const tipos = a.map(x => x.tipo)
  assert.deepEqual([...new Set(tipos)].sort(), ['bateria', 'chegada-noite', 'chuva', 'comer', 'gasoleo', 'largar-rizo', 'por-do-sol', 'rizar', 'rotacao', 'virar'].sort())
  const por = (t) => a.find(x => x.tipo === t)
  assert.equal(por('rizar').texto, 'Rizar: 1 rizo (vento 17 nós, rajadas 22)')
  assert.equal(por('rizar').hora, '16:30')
  assert.equal(por('rizar').antecedenciaMin, 30)
  assert.equal(por('por-do-sol').texto, 'Pôr do sol às 22:00: luzes de navegação, arnês e linha de vida, come antes de escurecer')
  assert.equal(por('chuva').texto, 'Chuva (1,2 mm/h) e visibilidade 3,0 km: radar ligado e luzes')
  assert.equal(a.filter(x => x.tipo === 'chuva').length, 1)
  assert.match(por('rotacao').texto, /^O vento roda de 270° para 000° \(90° em 1 h\)/)
  assert.equal(por('virar').texto, '2 viragens entre as 19:20 e as 19:21')
  assert.match(por('chegada-noite').texto, /^Chegada de noite a Figueira da Foz, um porto que não conheces/)
  assert.equal(por('gasoleo').hora, '00:20')
  assert.equal(a.filter(x => x.tipo === 'comer').length, 3) // às 3, 6 e 9 h
  // por ordem de hora
  for (let i = 1; i < a.length; i++) assert.ok(Date.parse(a[i].t) >= Date.parse(a[i - 1].t))
  // acompanhado: sem "come e bebe"; de dia: sem chegada de noite
  const b = avisosDaPassagem({ passagem: { pontos: linha(120), eventos: [], resumo: { chegou: true } }, tripulacao: 'acompanhado' })
  assert.deepEqual(b, [])
})

test('M-03: chegada de noite a um destino sem o campo "conhecido": "um porto que não conheces"', () => {
  const pontos = linha(60, { noite: true })
  for (const destino of [{ nome: 'Peniche' }, { nome: 'Peniche', conhecido: false }]) {
    const a = avisosDaPassagem({ passagem: { pontos, eventos: [], resumo: { chegou: true } }, destino, tripulacao: 'acompanhado' })
    assert.match(a.find(x => x.tipo === 'chegada-noite').texto, /^Chegada de noite a Peniche, um porto que não conheces:/)
  }
  const conhecido = avisosDaPassagem({ passagem: { pontos, eventos: [], resumo: { chegou: true } }, destino: { nome: 'Peniche', conhecido: true }, tripulacao: 'acompanhado' })
  assert.match(conhecido.find(x => x.tipo === 'chegada-noite').texto, /^Chegada de noite a Peniche: /)
})

test('avisos a partir do motor da passagem: cambadelas em popa e a frente', () => {
  const rota = [{ nome: 'A', lat: 39, lon: -9.5 }, { nome: 'B', lat: 39 + 12 / 60, lon: -9.5 }]
  let k = 0
  const tempo = () => (k++ < 90
    ? { tws: 14, rajada: 16, twd: 180, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 1, periodo: 8, ondasDir: 180, corrente: 0, correnteDir: 0 }
    : { tws: 5, rajada: 7, twd: 300, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 2, periodo: 8, ondasDir: 300, corrente: 0, correnteDir: 0 })
  const noite = noitePeloSol([T0 - 10 * H], [T0 + 10 * H])
  const p = simularPassagem({ rota, partida: T0, tempo, velocidadeVela: () => 6, consumo: () => 1.5, noite })
  const a = avisosDaPassagem({ passagem: p, tripulacao: 'acompanhado' })
  assert.ok(a.some(x => x.tipo === 'cambar'), JSON.stringify(a))
  assert.ok(a.some(x => x.tipo === 'frente' && /prende a retranca, motor pronto$/.test(x.texto)))
  const pr = precaucoes({ passagem: p, tripulacao: 'acompanhado' })
  assert.deepEqual(pr.map(x => x.id), ['vhf', 'telemovel', 'plano', 'barra', 'retenida', 'retranca-motor'])
})

test('precauções: as de sempre e as condicionais da tabela; "sair agora" reforça e junta a desistência', () => {
  const sempre = ['vhf', 'telemovel', 'plano', 'barra']
  const calmo = { pontos: linha(120, { tws: 10, rajada: 12, twd: 270, proa: 0 }), eventos: [] }
  assert.deepEqual(precaucoes({ passagem: calmo, tripulacao: 'acompanhado' }).map(x => x.id), sempre)
  // só eu: arnês
  const so = precaucoes({ passagem: calmo, tripulacao: 'so' })
  assert.deepEqual(so.map(x => x.id), [...sempre, 'arnes'])
  assert.equal(so.at(-1).porque, 'sozinho')
  // noite, popa, chuva, rajadas antes da barra, vento a cair
  const m = {}
  for (let i = 0; i < 30; i++) m[i] = { rajada: 24, wp: 'Largo de Algés (CNA)' }
  for (let i = 60; i < 120; i++) m[i] = { noite: true, vis: 2000 }
  for (let i = 100; i < 200; i++) m[i] = { ...(m[i] || {}), tws: 5, twd: 270 }
  const dura = { pontos: linha(200, { tws: 15, twd: 180, proa: 0 }, m), eventos: [] }
  const d = precaucoes({ passagem: dura, tripulacao: 'acompanhado' })
  assert.deepEqual(d.map(x => x.id), [...sempre, 'arnes', 'retenida', 'radar', 'rizo-saida', 'retranca-motor'])
  assert.equal(d.find(x => x.id === 'arnes').porque, 'de noite')
  assert.equal(d.find(x => x.id === 'rizo-saida').porque, 'rajadas de 24 nós antes da barra')
  assert.equal(d.find(x => x.id === 'retranca-motor').porque, 'o vento cai')
  // as rajadas depois da barra não pedem rizo à saída
  const depois = { pontos: linha(200, {}, { 150: { rajada: 25 } }), eventos: [] }
  depois.pontos[0].wp = 'Largo de Algés (CNA)'
  assert.ok(!precaucoes({ passagem: depois, tripulacao: 'acompanhado' }).some(x => x.id === 'rizo-saida'))
  // sair agora mesmo assim
  const s = precaucoes({ passagem: calmo, tripulacao: 'so', sairAgora: true, desistenciaResumo: 'até às 20:10 ainda voltas a Algés (CNA) com vento a favor' })
  assert.deepEqual(s.map(x => x.id), [...sempre, 'arnes', 'rizo-saida', 'retranca-motor', 'desistencia', 'plano-hora'])
  assert.equal(s.find(x => x.id === 'desistencia').texto, 'Pontos de desistência revistos: até às 20:10 ainda voltas a Algés (CNA) com vento a favor')
})
