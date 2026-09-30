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

test('Algés → Peniche a 5 MN: marcos, o Cabo Raso, o abrigo mais perto, voltar e o resumo', async () => {
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
  const r = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), destino: dest('peniche'), eta, twd: () => 0 })
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
  const s = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), eta, twd: () => 118 })
  assert.equal(s.resumo, 'voltar a Algés (CNA) é sempre contra o vento')
  // vento de oeste que roda para sueste às 3 h de viagem: o resumo é o último ponto antes de rodar
  const rodaW = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), eta, twd: (la, lo, tt) => (tt < t0 + 3 * H ? 270 : 118) })
  // (no Cabo Raso a volta é a rota direta a menos de 3 MN da costa, e com vento de oeste — do
  // mar — o rotas.js recusa-a: esse ponto fica sem rota para voltar e não conta para o resumo)
  const caboW = rodaW.pontos.find(p => p.tipo === 'cabo')
  assert.ok(Date.parse(caboW.t) < t0 + 3 * H)
  assert.equal(caboW.voltar, null)
  const antes = rodaW.pontos.filter(p => Date.parse(p.t) < t0 + 3 * H && p.voltar).at(-1)
  assert.equal(rodaW.resumo, `até às ${antes.hora} ainda voltas a Algés (CNA) com vento ${antes.voltar.vento}`)
  assert.equal(antes.voltar.vento, 'a favor')
})

test('rotaAte com o vento previsto, a hora e o registo: a regra do vento de terra também nas rotas de desistência', () => {
  // ao largo de Viana, com a costa a 1,3 MN: a rota direta do rotas.js só com vento de terra
  const p = { lat: 41.615, lon: -8.935 }
  const viana = dest('viana')
  const T = Date.UTC(2026, 8, 30, 12)
  const direta = rotas.gerarRota(costa, { partida: p, destino: viana, afastamento: 5, twd: 90 })
  assert.ok(direta.direto && direta.costaMinMn < 3, JSON.stringify([direta.direto, direta.costaMinMn]))
  const horas = []
  const boa = D.rotaAte(costa, p, viana, { twd: (la, lo, t) => { horas.push(t); return 90 }, horaPartida: T })
  assert.ok(boa)
  assert.equal(boa.milhas, direta.milhas)
  assert.ok(horas.length > 0 && horas.every(t => t >= T), 'a hora estimada de passagem a partir da hora do ponto')
  // vento do mar: nem a direta, nem o troço reto sem regra (que a contornava)
  assert.equal(D.rotaAte(costa, p, viana, { twd: () => 270, horaPartida: T }), null)
})

test('pontosDesistencia passa o vento, a hora de cada ponto e o registo ao rotas.gerarRota', async () => {
  const alt = rotas.gerarRota(costa, { partida: dest('alges'), destino: dest('peniche'), afastamento: 5 })
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const linhaTempo = alt.pontos.map((q, i) => ({ t: t0 + i * 10 * 60000, lat: q.lat, lon: q.lon }))
  const orig = rotas.gerarRota
  const chamadas = []
  const log = () => {}
  const twd = () => 0
  rotas.gerarRota = (k, args) => { chamadas.push(args); return orig(k, args) }
  let r
  try {
    r = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), destino: dest('peniche'), eta: () => null, twd, log })
  } finally { rotas.gerarRota = orig }
  assert.ok(chamadas.length > 0)
  const horas = new Set(r.pontos.map(x => Date.parse(x.t)))
  for (const a of chamadas) {
    assert.equal(a.twd, twd)
    assert.ok(horas.has(a.horaPartida), `${a.horaPartida}`)
    assert.equal(a.log, log)
  }
})

test('pontosDesistencia cede o event loop em cada ponto (para o SignalK não parar)', async () => {
  const alt = rotas.gerarRota(costa, { partida: dest('alges'), destino: dest('peniche'), afastamento: 5 })
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const linhaTempo = alt.pontos.map((q, i) => ({ t: t0 + i * 10 * 60000, lat: q.lat, lon: q.lon }))
  let voltas = 0
  let acabou = false
  const contar = () => { voltas++; if (!acabou) setImmediate(contar) }
  setImmediate(contar)
  const r = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), destino: dest('peniche'), eta: () => null, twd: () => 0 })
  acabou = true
  assert.ok(r.pontos.length >= 10)
  assert.ok(voltas >= r.pontos.length, `${voltas} voltas do event loop para ${r.pontos.length} pontos`)
})
