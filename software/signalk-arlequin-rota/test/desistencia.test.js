'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../lib/costa')
const rotas = require('../lib/rotas')
const D = require('../lib/desistencia')

const H = 3600000
const costa = c.carregarCosta()
const dest = (id) => costa.destinos.find(x => x.id === id)

test('vento na perna: < 60° contra, 60–120° de través, > 120° a favor', () => {
  assert.equal(D.ventoNaPerna(0, 10).texto, 'contra')
  assert.equal(D.ventoNaPerna(0, 90).texto, 'de través')
  assert.equal(D.ventoNaPerna(0, 120).texto, 'de través')
  assert.equal(D.ventoNaPerna(0, 180).texto, 'a favor')
  assert.equal(D.ventoNaPerna(350, 200).texto, 'a favor')
  assert.equal(D.ventoNaPerna(null, 200).texto, null)
})

test('cabos: um L inventado roda 90° num ponto; uma reta não tem cabos', () => {
  const L = c.prepararLinha([[39.3, -9.5], [39.1, -9.5], [39.1, -9.2]])
  const k = D.cabos(L, 0, L.total)
  assert.equal(k.length, 1)
  assert.ok(Math.abs(k[0].lat - 39.1) < 0.01 && Math.abs(k[0].lon + 9.5) < 0.02)
  assert.ok(k[0].rodaGraus > 80)
  const reta = c.prepararLinha([[39.3, -9.5], [39.0, -9.5]])
  assert.deepEqual(D.cabos(reta, 0, reta.total), [])
  // marcos de 5 em 5 MN pela geometria
  const m = D.marcos([{ lat: 39, lon: -9.5 }, { lat: 39 + 23 / 60, lon: -9.5 }], 5)
  assert.deepEqual(m.map(x => x.milhas), [5, 10, 15, 20])
})

test('Algés → Peniche a 5 MN: marcos, o Cabo Raso, o abrigo mais perto, voltar e o resumo', () => {
  const alt = rotas.gerarRota(costa, { partida: dest('alges'), destino: dest('peniche'), afastamento: 5 })
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  // linha do tempo inventada: a rota a 5 nós, um ponto por minuto
  const linhaTempo = []
  let t = t0
  for (let i = 1; i < alt.pontos.length; i++) {
    const a = alt.pontos[i - 1]; const b = alt.pontos[i]
    const n = Math.max(1, Math.round(c.distanciaMn(a, b) / 5 * 60))
    for (let k = 0; k < n; k++) { linhaTempo.push({ t, lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }); t += 60000 }
  }
  const eta = (pontos, tt) => { let mn = 0; for (let i = 1; i < pontos.length; i++) mn += c.distanciaMn(pontos[i - 1], pontos[i]); return tt + mn / 4 * H }
  // vento de norte o dia todo: voltar para sul é a favor
  const r = D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), destino: dest('peniche'), eta, twd: () => 0 })
  const marcos = r.pontos.filter(p => p.tipo === 'marco')
  assert.deepEqual(marcos.map(p => p.milhas), [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60])
  const cabo = r.pontos.find(p => p.tipo === 'cabo')
  assert.equal(cabo.nome, 'Cabo Raso')
  // por ordem de hora
  for (let i = 1; i < r.pontos.length; i++) assert.ok(r.pontos[i].t >= r.pontos[i - 1].t)
  // o 1.º marco (5 MN, no rio): um dos portos da barra (as aproximações de Algés, Oeiras e
  // Cascais começam todas no Largo de Cascais, por isso pelo mar o mais perto é Cascais); o último, Peniche
  assert.ok(['alges', 'oeiras', 'cascais'].includes(marcos[0].abrigo.id), marcos[0].abrigo.id)
  assert.equal(marcos.at(-1).abrigo.id, 'peniche')
  assert.equal(marcos.at(-1).abrigo.vento, 'contra') // de 5 MN de Peniche até lá: para norte, vento de norte
  // voltar a Algés com vento de norte: a favor, com a hora de chegada a 4 nós
  const ult = marcos.at(-1)
  assert.equal(ult.voltar.id, 'alges')
  assert.equal(ult.voltar.vento, 'a favor')
  assert.ok(Math.abs(Date.parse(ult.voltar.chegada) - (Date.parse(ult.t) + ult.voltar.milhas / 4 * H)) < 1000)
  assert.ok(ult.voltar.milhas > 50 && ult.voltar.milhas < 70, `${ult.voltar.milhas}`)
  assert.equal(r.resumo, `até às ${r.pontos.at(-1).hora} ainda voltas a Algés (CNA) com vento a favor`)
  // vento de sueste: voltar é contra o vento desde o início (de qualquer ponto, o cais de Algés fica entre 069° e 167°)
  const s = D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), eta, twd: () => 118 })
  assert.equal(s.resumo, 'voltar a Algés (CNA) é sempre contra o vento')
  // vento de oeste que roda para sueste às 3 h de viagem: o resumo é o último ponto antes de rodar
  const rodaW = D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), eta, twd: (la, lo, tt) => (tt < t0 + 3 * H ? 270 : 118) })
  const antes = rodaW.pontos.filter(p => Date.parse(p.t) < t0 + 3 * H).at(-1)
  assert.equal(rodaW.resumo, `até às ${antes.hora} ainda voltas a Algés (CNA) com vento ${antes.voltar.vento}`)
  assert.equal(antes.voltar.vento, 'a favor')
})
