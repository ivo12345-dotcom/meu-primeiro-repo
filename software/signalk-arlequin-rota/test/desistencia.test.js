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
  assert.equal(r.pontos.filter(p => p.tipo === 'cabo').length, 1)
  // a 3 MN a linha contorna o Raso aos bocados (3 voltas > 30°): conta como um cabo só
  // (vento de terra em cada ponto: a regra dos 3 MN verifica-se ponto a ponto, e nenhuma direção
  // única é de terra de Algés a Peniche, com a costa a rodar 90° no Raso)
  const L3 = costa.linha(3)
  const deTerra = (lat, lon) => rotas.rumoParaTerra(costa, L3, c.projetar(L3, { lat, lon }).s)
  const a3 = rotas.gerarRota(costa, { partida: dest('alges'), destino: dest('peniche'), afastamento: 3, twd: deTerra })
  assert.equal(a3.excluida, false, a3.motivo)
  assert.deepEqual(D.cabosDaRota(a3.pontos).map(k => k.nome), ['Cabo Raso'])
  assert.equal(D.cabos(c.prepararLinha(a3.pontos.slice(3, -2)), 0, 20, { juntarCaboMn: 0 }).filter(k => k.nome === 'Cabo Raso').length > 1, true)
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
  // (e o Cabo Raso, onde com vento de sueste a volta é junto à costa com vento do mar, não se esconde)
  const caboS = s.pontos.find(p => p.tipo === 'cabo')
  assert.match(caboS.voltar.avisoVermelho, /^fuga junto à costa com vento do mar/)
  assert.equal(s.resumo, `voltar a Algés (CNA) é sempre contra o vento; atenção: junto ao Cabo Raso às ${caboS.hora} a fuga é junto à costa com vento do mar`)
  // vento de oeste que roda para sueste às 3 h de viagem: o resumo é o último ponto antes de rodar
  const rodaW = await D.pontosDesistencia({ costa, rota: alt, linhaTempo, partida: dest('alges'), eta, twd: (la, lo, tt) => (tt < t0 + 3 * H ? 270 : 118) })
  // (no Cabo Raso a volta é a rota direta a menos de 3 MN da costa, e com vento de oeste — do
  // mar — o rotas.js recusa-a. Decisão do Ivo de 30/09, "Mostrar sempre": aparece na mesma, com o
  // aviso vermelho, mas não conta como volta boa para o resumo)
  const caboW = rodaW.pontos.find(p => p.tipo === 'cabo')
  assert.ok(Date.parse(caboW.t) < t0 + 3 * H)
  assert.match(caboW.voltar.avisoVermelho, /^fuga junto à costa com vento do mar \(a sotavento\) — só em último recurso: a rota direta passa a \d+,\d MN de uma costa a sotavento$/)
  assert.equal(caboW.semVolta, null)
  const antes = rodaW.pontos.filter(p => Date.parse(p.t) < t0 + 3 * H && p.voltar && !p.voltar.avisoVermelho).at(-1)
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
  assert.equal(boa.milhas, direta.milhas)
  assert.equal(boa.avisoVermelho, null)
  assert.ok(horas.length > 0 && horas.every(t => t >= T), 'a hora estimada de passagem a partir da hora do ponto')
  // vento do mar (decisão do Ivo de 30/09, "Mostrar sempre"): a mesma direta junto à costa, nunca
  // escondida, com o aviso vermelho e o porquê do rotas.js
  const mar = D.rotaAte(costa, p, viana, { twd: () => 270, horaPartida: T })
  assert.equal(mar.milhas, direta.milhas)
  assert.equal(mar.avisoVermelho, 'fuga junto à costa com vento do mar (a sotavento) — só em último recurso: a rota direta passa a 1,3 MN de uma costa a sotavento')
  // sem vento previsto também não se esconde, mas o aviso diz que não há vento (não "vento do mar")
  const semVento = D.rotaAte(costa, p, viana, { twd: () => null, horaPartida: T })
  assert.equal(semVento.milhas, direta.milhas)
  assert.match(semVento.avisoVermelho, /^fuga junto à costa sem vento previsto — só em último recurso: /)
})

test('rotaAte: as exclusões duras continuam (terra, zonas): sem fuga, com o motivo', () => {
  // dentro do Cachopo do Norte (zona a evitar da barra do Tejo): nem com vento de terra
  const p = { lat: 38.657, lon: -9.353 }
  assert.deepEqual(D.rotaAte(costa, p, dest('cascais'), { twd: () => 0 }), { semFuga: 'a posição está dentro de uma zona a evitar (Cachopo do Norte (barra do Tejo))' })
  // o troço reto de recurso (a rota do rotas.js é absurda aqui, colada à marina) também segue a
  // regra do vento: com vento do mar (sul, na baía de Cascais) fica com o aviso vermelho
  const q = { lat: 38.70, lon: -9.40 }
  assert.ok([5, 8].every(af => { const r = rotas.gerarRota(costa, { partida: q, destino: dest('cascais'), afastamento: af, twd: 0 }); return r.excluida && !r.porVento }))
  const terra = D.rotaAte(costa, q, dest('cascais'), { twd: () => 0 })
  assert.equal(terra.avisoVermelho, null)
  const mar = D.rotaAte(costa, q, dest('cascais'), { twd: () => 180 })
  assert.equal(mar.milhas, terra.milhas)
  assert.match(mar.avisoVermelho, /^fuga junto à costa com vento do mar \(a sotavento\) — só em último recurso: a rota direta passa a \d+,\d MN de uma costa a sotavento$/)
})

// A linha do tempo inventada de uma rota: a 5 nós, um ponto por minuto.
function linhaA5nos (pontos, t0) {
  const out = []
  let t = t0
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]; const b = pontos[i]
    const n = Math.max(1, Math.round(c.distanciaMn(a, b) / 5 * 60))
    for (let k = 0; k < n; k++) { out.push({ t, lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }); t += 60000 }
  }
  return out
}
const eta4nos = (pontos, tt) => { let mn = 0; for (let i = 1; i < pontos.length; i++) mn += c.distanciaMn(pontos[i - 1], pontos[i]); return tt + mn / 4 * H }
const AVISO_COSTA = /^fuga junto à costa com vento do mar \(a sotavento\) — só em último recurso: /

test('Cascais → Peniche com vento de oeste: no Cabo Raso a fuga aparece junto à costa com o aviso vermelho, e o resumo diz o buraco', async () => {
  const alt = rotas.gerarRota(costa, { partida: dest('cascais'), destino: dest('peniche'), afastamento: 5 })
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const r = await D.pontosDesistencia({ costa, rota: alt, linhaTempo: linhaA5nos(alt.pontos, t0), partida: dest('cascais'), destino: dest('peniche'), eta: eta4nos, twd: () => 270 })
  const cabo = r.pontos.find(p => p.tipo === 'cabo')
  assert.equal(cabo.nome, 'Cabo Raso')
  // a volta a Cascais e o abrigo: nunca escondidos — a direta junto à costa, com o aviso vermelho
  assert.equal(cabo.voltar.id, 'cascais')
  assert.match(cabo.voltar.avisoVermelho, AVISO_COSTA)
  assert.ok(cabo.voltar.milhas > 0)
  assert.equal(cabo.semVolta, null)
  assert.match(cabo.abrigo.avisoVermelho, AVISO_COSTA)
  assert.equal(cabo.semAbrigo, null)
  // nos outros pontos a fuga é pela linha dos 5 MN, sem aviso
  for (const p of r.pontos.filter(x => x !== cabo)) {
    assert.equal(p.voltar.avisoVermelho, null, p.hora)
    assert.equal(p.abrigo.avisoVermelho, null, p.hora)
  }
  // o resumo não salta o Cabo Raso em silêncio
  const ult = r.pontos.filter(p => !p.voltar.avisoVermelho && ['a favor', 'de través'].includes(p.voltar.vento)).at(-1)
  assert.ok(Date.parse(ult.t) > Date.parse(cabo.t))
  assert.equal(r.resumo, `até às ${ult.hora} ainda voltas a Cascais com vento ${ult.voltar.vento}, exceto junto ao Cabo Raso às ${cabo.hora}, onde a fuga é junto à costa com vento do mar`)
})

test('no mar (sem porto de partida) com só uma fuga junto à costa: o abrigo aparece com o aviso vermelho, nunca "Sem abrigo conhecido"', async () => {
  // ao largo da barra de Cascais, a caminho de Peniche, vento de oeste: o 1.º ponto é o Cabo Raso,
  // de onde Cascais e Oeiras só se alcançam pela direta junto à costa
  const alt = rotas.gerarRota(costa, { partida: { lat: 38.65, lon: -9.45 }, destino: dest('peniche'), afastamento: 5 })
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const r = await D.pontosDesistencia({ costa, rota: alt, linhaTempo: linhaA5nos(alt.pontos, t0), partida: null, destino: dest('peniche'), eta: eta4nos, twd: () => 270 })
  const p0 = r.pontos[0]
  assert.equal(p0.nome, 'Cabo Raso')
  assert.equal(p0.abrigo.id, 'cascais')
  assert.match(p0.abrigo.avisoVermelho, AVISO_COSTA)
  assert.equal(p0.voltar, null)
  assert.equal(p0.semVolta, null) // no mar não há partida para onde voltar: não é um buraco
  assert.doesNotMatch(r.resumo, /Sem abrigo/)
  const ult = r.pontos.filter(p => p.abrigo?.id === 'cascais' && !p.abrigo.avisoVermelho && ['a favor', 'de través'].includes(p.abrigo.vento)).at(-1)
  assert.equal(r.resumo, `até às ${ult.hora} ainda voltas a Cascais com vento ${ult.abrigo.vento}, exceto junto ao Cabo Raso às ${p0.hora}, onde a fuga é junto à costa com vento do mar`)
})

test('a fuga pela linha dos 5 MN vem antes da fuga junto à costa: um abrigo mais longe mas sem aviso ganha ao mais perto com aviso', async () => {
  // ao largo de Viana (a 1,3 MN da costa a leste), vento de oeste: Viana só pela direta junto à costa, Leixões pela linha
  const rota = { pontos: [{ lat: 41.615 - 5 / 60, lon: -8.935 }, { lat: 41.615, lon: -8.935 }, { lat: 41.615 + 4 / 60, lon: -8.935 }] }
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const r = await D.pontosDesistencia({ costa, rota, linhaTempo: linhaA5nos(rota.pontos, t0), partida: null, eta: eta4nos, twd: () => 270 })
  assert.equal(r.pontos.length, 1)
  assert.equal(r.pontos[0].abrigo.id, 'leixoes')
  assert.equal(r.pontos[0].abrigo.avisoVermelho, null)
})

test('sem fuga possível (exclusão dura): o ponto diz porquê e o resumo também', async () => {
  // uma rota inventada que passa (aos 5 MN) dentro do Cachopo do Norte, na barra do Tejo
  const z = { lat: 38.657, lon: -9.353 }
  const oeste = (p, mn) => ({ lat: p.lat, lon: p.lon - mn / 60 / Math.cos(p.lat * Math.PI / 180) })
  const rota = { pontos: [{ lat: z.lat - 5 / 60, lon: z.lon }, z, oeste(z, 5), oeste(z, 10), { lat: z.lat + 4 / 60, lon: oeste(z, 13).lon }] }
  const t0 = Date.UTC(2026, 8, 30, 5, 30)
  const r = await D.pontosDesistencia({ costa, rota, linhaTempo: linhaA5nos(rota.pontos, t0), partida: dest('cascais'), eta: eta4nos, twd: () => 0 })
  const noCachopo = r.pontos[0]
  assert.equal(noCachopo.milhas, 5)
  const SEM = 'sem fuga possível daqui: a posição está dentro de uma zona a evitar (Cachopo do Norte (barra do Tejo))'
  assert.equal(noCachopo.voltar, null)
  assert.equal(noCachopo.semVolta, SEM)
  assert.equal(noCachopo.abrigo, null)
  assert.equal(noCachopo.semAbrigo, SEM)
  const ult = r.pontos.filter(p => p.voltar && !p.voltar.avisoVermelho && ['a favor', 'de través'].includes(p.voltar.vento)).at(-1)
  assert.ok(ult, JSON.stringify(r.pontos.map(p => p.voltar)))
  assert.equal(r.resumo, `até às ${ult.hora} ainda voltas a Cascais com vento ${ult.voltar.vento}, exceto às ${noCachopo.hora} (5 MN feitas), onde não há fuga possível: a posição está dentro de uma zona a evitar (Cachopo do Norte (barra do Tejo))`)
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
