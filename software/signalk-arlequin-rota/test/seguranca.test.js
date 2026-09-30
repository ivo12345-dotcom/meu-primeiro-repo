'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const s = require('../lib/seguranca')
const c = require('../lib/costa')

// Costa inventada: terra a leste do meridiano 9° W. distância = (−9 − lon) × MN por grau.
const costaFalsa = { distanciaTerra: (p) => Math.max(0, (-9 - p.lon) * c.escalas(p.lat).kx) }
const aW = (mn, lat = 39) => -9 - mn / c.escalas(lat).kx // longitude a mn MN da costa

// Uma rota: saída e entrada perto de terra (costaLivre), a linha no afastamento dado.
function rota (afastamento, { desvio = null } = {}) {
  const pontos = [
    { lat: 38.9, lon: aW(0.5, 38.9), perna: null, costaLivre: true },
    { lat: 38.95, lon: aW(1.5, 38.95), perna: 'aproximacao', costaLivre: true },
    { lat: 39.0, lon: aW(afastamento), perna: 'ligacao', costaLivre: true },
    { lat: 39.2, lon: aW(desvio ?? afastamento, 39.2), perna: 'linha' },
    { lat: 39.4, lon: aW(afastamento, 39.4), perna: 'linha' },
    { lat: 39.45, lon: aW(1, 39.45), perna: 'ligacao', costaLivre: true },
    { lat: 39.46, lon: aW(0.2, 39.46), perna: 'aproximacao', costaLivre: true }
  ]
  return { afastamento, pontos, excluida: false, avisos: [] }
}

// Uma passagem inventada: n minutos iguais, com o que se pedir por cima.
function passagem ({ min = 300, ponto = {}, resumo = {} } = {}) {
  const pontos = Array.from({ length: min }, (_, i) => ({ t: i * 60000, motor: false, tws: 15, rajada: 18, ondas: 2, noite: false, ...ponto }))
  return { pontos, resumo: { ventoMax: 15, rajadaMax: 18, ondasMax: 2, gasoleoGasto: 5, socFinal: 0.9, ...resumo } }
}
const base = (o = {}) => ({ alternativa: rota(5), pessimista: passagem(), provavel: passagem(), destino: { nome: 'Peniche', conhecido: true }, tripulacao: 'so', sairAgora: false, gasoleoInicial: 100, costa: costaFalsa, ...o })

test('uma passagem boa não tem motivos', () => {
  const r = s.avaliar(base())
  assert.deepEqual(r.motivos, [])
  assert.equal(r.excluida, false)
  assert.equal(r.naoRecomendada, false)
  assert.ok(Math.abs(r.costaMinMn - 5) < 0.01)
  assert.equal(r.horasLemeEq, 5)
})

test('excluída sempre: rota impossível (rotas.js) e mais perto da costa do que o mínimo na linha (a geometria, não o rasto)', () => {
  const imp = s.avaliar(base({ alternativa: { afastamento: 5, excluida: true, motivo: 'não há passagem a 5 MN entre A e B', pontos: [] } }))
  assert.equal(imp.excluida, true)
  assert.deepEqual(imp.motivos, ['não há passagem a 5 MN entre A e B'])
  // a linha encosta a 4,2 MN num ponto: excluída
  const perto = s.avaliar(base({ alternativa: rota(5, { desvio: 4.2 }) }))
  assert.equal(perto.excluida, true)
  assert.equal(perto.motivos[0], 'a rota passa a 4,2 MN da costa (mínimo 5 MN)')
  // a 4,95 MN (tolerância de 0,1 MN) passa; as aproximações a 0,2 MN não contam
  assert.equal(s.avaliar(base({ alternativa: rota(5, { desvio: 4.95 }) })).excluida, false)
  // o mínimo é configurável
  assert.equal(s.avaliar(base({ opcoes: { afastamentoMinimo: 8 } })).excluida, true)
  // a rota de 3 MN (só com vento de terra, que o rotas.js já garante) tem o mínimo de 3
  assert.equal(s.avaliar(base({ alternativa: rota(3) })).excluida, false)
  assert.equal(s.avaliar(base({ alternativa: rota(3, { desvio: 2.5 }) })).motivos[0], 'a rota passa a 2,5 MN da costa (mínimo 3 MN)')
  // o rasto simulado não conta: um ponto da passagem a 1 MN da costa não muda nada
  assert.equal(s.avaliar(base({ pessimista: passagem({ ponto: { costa: 1 } }) })).excluida, false)
  // com a distância já medida (a mesma geometria em todas as partidas)
  assert.equal(s.avaliar(base({ costa: null, costaMinMn: 4.5 })).excluida, true)
})

test('gasóleo < 40 L ou bateria < 50% à chegada no pessimista: excluída, ou aviso vermelho em "sair agora"', () => {
  const gas = s.avaliar(base({ pessimista: passagem({ resumo: { gasoleoGasto: 65 } }) }))
  assert.equal(gas.excluida, true)
  assert.deepEqual(gas.motivos, ['chegas com 35 L de gasóleo no pior caso (mínimo 40 L)'])
  const bat = s.avaliar(base({ pessimista: passagem({ resumo: { socFinal: 0.45 } }) }))
  assert.deepEqual(bat.motivos, ['chegas com a bateria a 45% no pior caso (mínimo 50%)'])
  const agora = s.avaliar(base({ sairAgora: true, pessimista: passagem({ resumo: { gasoleoGasto: 65, socFinal: 0.45 } }) }))
  assert.equal(agora.excluida, false)
  assert.equal(agora.avisosVermelhos.length, 2)
  // no limite (40 L, 50%) ainda passa
  assert.equal(s.avaliar(base({ pessimista: passagem({ resumo: { gasoleoGasto: 60, socFinal: 0.5 } }) })).excluida, false)
})

test('"não recomendada sozinho": vento, rajadas e ondas do pessimista acima dos limites; acompanhado não conta', () => {
  const r = s.avaliar(base({ pessimista: passagem({ resumo: { ventoMax: 23, rajadaMax: 31, ondasMax: 3.2 } }) }))
  assert.equal(r.naoRecomendada, true)
  assert.equal(r.excluida, false)
  assert.deepEqual(r.motivos, [
    'vento médio até 23 nós no pior caso (limite 22 sozinho)',
    'rajadas até 31 nós no pior caso (limite 30 sozinho)',
    'ondas até 3,2 m no pior caso (limite 3 m sozinho)'
  ])
  // no limite exato não conta (é "mais de")
  assert.equal(s.avaliar(base({ pessimista: passagem({ resumo: { ventoMax: 22, rajadaMax: 30, ondasMax: 3 } }) })).naoRecomendada, false)
  // o provável não conta para os limites
  assert.equal(s.avaliar(base({ provavel: passagem({ resumo: { rajadaMax: 40 } }) })).naoRecomendada, false)
  const acomp = s.avaliar(base({ tripulacao: 'acompanhado', pessimista: passagem({ min: 900, resumo: { rajadaMax: 35 } }) }))
  assert.equal(acomp.naoRecomendada, false)
  assert.deepEqual(acomp.motivos, [])
})

test('horas equivalentes ao leme: mais de 8 h; o motor em calma (vento < 10, ondas < 1,5) conta metade', () => {
  assert.equal(s.avaliar(base({ pessimista: passagem({ min: 481 }) })).naoRecomendada, true)
  assert.equal(s.avaliar(base({ pessimista: passagem({ min: 480 }) })).naoRecomendada, false)
  const calma = passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: 1 } })
  assert.equal(s.horasLemeEquivalentes(calma.pontos), 7.5)
  assert.equal(s.avaliar(base({ pessimista: calma })).naoRecomendada, false)
  // com ondas de 1,5 m (ou sem ondas previstas) já não é calma
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: 1.5 } }).pontos), 15)
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: 6, ondas: null } }).pontos), 15)
  // à vela com pouco vento não é "motor em calma"
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 60, ponto: { motor: false, tws: 6, ondas: 1 } }).pontos), 1)
  const r = s.avaliar(base({ pessimista: passagem({ min: 600 }) }))
  assert.deepEqual(r.motivos, ['10,0 h equivalentes ao leme (limite 8 h sozinho)'])
})

test('chegada de noite a um porto desconhecido (no pessimista ou no provável)', () => {
  const noite = (p) => { p.pontos.at(-1).noite = true; return p }
  const desconhecido = { nome: 'Figueira da Foz', conhecido: false }
  const r = s.avaliar(base({ destino: desconhecido, pessimista: noite(passagem()) }))
  assert.equal(r.naoRecomendada, true)
  assert.deepEqual(r.motivos, ['chegada de noite a Figueira da Foz, um porto que não conheces'])
  assert.equal(r.chegadaNoite, true)
  assert.equal(s.avaliar(base({ destino: desconhecido, provavel: noite(passagem()) })).naoRecomendada, true)
  assert.equal(s.avaliar(base({ destino: { nome: 'Peniche', conhecido: true }, pessimista: noite(passagem()) })).naoRecomendada, false)
  assert.equal(s.avaliar(base({ destino: desconhecido })).naoRecomendada, false)
})

test('rota direta (afastamento null, rotas.js): sem mínimo pelo afastamento, fica a distância real à costa; afastamento null sem direto usa o mínimo por omissão', () => {
  // salto curto junto à costa: todos os troços são aproximação ou ligação (costaLivre)
  const direta = {
    afastamento: null,
    direto: true,
    costaMinMn: 1.2,
    excluida: false,
    avisos: [],
    pontos: [
      { lat: 38.9, lon: aW(0.5, 38.9), perna: null, costaLivre: true },
      { lat: 39.0, lon: aW(1.2), perna: 'ligacao', costaLivre: true },
      { lat: 39.1, lon: aW(0.3, 39.1), perna: 'aproximacao', costaLivre: true }
    ]
  }
  const r = s.avaliar(base({ alternativa: direta }))
  assert.equal(r.excluida, false)
  assert.deepEqual(r.motivos, [])
  assert.equal(r.costaMinMn, 1.2)
  // o calculo passa a distância medida na linha (null numa rota direta): fica a do rotas.js
  assert.equal(s.avaliar(base({ alternativa: direta, costa: null, costaMinMn: null })).costaMinMn, 1.2)
  // nenhum texto fala de "null" ou "NaN"
  assert.ok(!JSON.stringify(r).match(/null MN|NaN/))
  // afastamento em falta sem ser direta: o mínimo por omissão (5 MN), nunca 0
  assert.equal(s.minimoCosta(null), 5)
  assert.equal(s.minimoCosta(undefined, { afastamentoMinimo: 8 }), 8)
  const semAf = { ...rota(4), afastamento: null }
  const x = s.avaliar(base({ alternativa: semAf }))
  assert.equal(x.excluida, true)
  assert.deepEqual(x.motivos, ['a rota passa a 4,0 MN da costa (mínimo 5 MN)'])
})

test('tolerância de 0,1 MN: as linhas pré-calculadas reais ficam até 0,055 MN por dentro de d, e uma alternativa normal de 5 ou 8 MN não é excluída', () => {
  const r = require('../lib/rotas')
  const real = c.carregarCosta()
  const D = (id) => real.destinos.find(d => d.id === id)
  assert.ok(s.PADRAO.toleranciaMn >= 0.1)
  let porDentro = 0
  for (const [a, b, d] of [['alges', 'peniche', 5], ['alges', 'peniche', 8], ['peniche', 'nazare', 5], ['viana', 'lagos', 5]]) {
    const alt = r.gerarRota(real, { partida: D(a), destino: D(b), afastamento: d, twd: 90 })
    assert.equal(alt.excluida, false, alt.motivo)
    const m = s.distanciaRotaCosta(real, alt.pontos).mn
    assert.ok(m > d - 0.06, `${a}→${b} ${d} MN: ${m}`)
    if (m < d) porDentro++
    // o mínimo por omissão (5 MN, desenho 3a) e também o mínimo = d (a 8 MN, "mais perto do que d")
    for (const opcoes of [{}, { afastamentoMinimo: d }]) {
      const v = s.avaliar(base({ alternativa: alt, costa: real, opcoes }))
      assert.equal(v.excluida, false, `${a}→${b} ${d} MN: ${v.motivos}`)
      assert.deepEqual(v.motivos, [])
    }
    // sem tolerância, as que ficam por dentro de d seriam excluídas (a tolerância é o que as salva)
    if (m < d) assert.equal(s.avaliar(base({ alternativa: alt, costa: real, opcoes: { afastamentoMinimo: d, toleranciaMn: 0 } })).excluida, true)
  }
  assert.ok(porDentro > 0) // o caso existe mesmo nos dados reais
  // no limite inventado: 0,055 MN por dentro passa
  assert.equal(s.avaliar(base({ alternativa: rota(5, { desvio: 4.945 }) })).excluida, false)
})

// Uma variante por um canal (rotas.js): linha, ligação ao canal, o canal, ligação de volta à linha.
function rotaCanal () {
  const pontos = [
    { lat: 38.9, lon: aW(0.5, 38.9), perna: null, costaLivre: true },
    { lat: 38.95, lon: aW(1.5, 38.95), perna: 'aproximacao', costaLivre: true },
    { lat: 39.0, lon: aW(5, 39.0), perna: 'ligacao', costaLivre: true },
    { lat: 39.1, lon: aW(5, 39.1), perna: 'linha' },
    { lat: 39.15, lon: aW(5, 39.15), perna: 'ligacao', costaLivre: true, nome: 'Canal da Berlenga' },
    { lat: 39.25, lon: aW(5, 39.25), perna: 'canal', costaLivre: true },
    { lat: 39.35, lon: aW(5, 39.35), perna: 'canal', costaLivre: true },
    { lat: 39.4, lon: aW(5, 39.4), perna: 'ligacao', costaLivre: true },
    { lat: 39.8, lon: aW(5, 39.8), perna: 'linha' },
    { lat: 39.85, lon: aW(1, 39.85), perna: 'ligacao', costaLivre: true },
    { lat: 39.86, lon: aW(0.2, 39.86), perna: 'aproximacao', costaLivre: true }
  ]
  return { afastamento: 5, pontos, excluida: false, avisos: [], canal: 'Canal da Berlenga', ondasMax: 3 }
}
// O rasto simulado ao longo da rota (10 pontos por troço), com as ondas dadas por ondasEm(lat).
function rasto (alt, ondasEm) {
  const pontos = []
  for (let i = 1; i < alt.pontos.length; i++) {
    const a = alt.pontos[i - 1]; const b = alt.pontos[i]
    for (let k = 0; k < 10; k++) {
      const lat = a.lat + (b.lat - a.lat) * k / 10; const lon = a.lon + (b.lon - a.lon) * k / 10
      pontos.push({ t: pontos.length * 60000, lat, lon, motor: false, tws: 15, rajada: 18, ondas: ondasEm(lat), periodo: 8, noite: false })
    }
  }
  return { pontos, resumo: { ventoMax: 15, rajadaMax: 18, ondasMax: Math.max(...pontos.map(p => p.ondas ?? -Infinity)), gasoleoGasto: 5, socFinal: 0.9 } }
}

test('canal com ondasMax (Canal da Berlenga, decisão do Ivo): excluída quando a onda máxima do pessimista nos troços do canal é ≥ ondasMax', () => {
  const alt = rotaCanal()
  // tudo a 2 m: passa (os troços do canal não contam para o mínimo à costa)
  const bom = s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, () => 2), tripulacao: 'acompanhado' }))
  assert.equal(bom.excluida, false)
  assert.deepEqual(bom.motivos, [])
  // 3 m no canal (≥ 3): excluída, também acompanhado
  const noCanal = (h) => (lat) => (lat >= 39.2 && lat <= 39.35 ? h : 2)
  const r = s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, noCanal(3)), tripulacao: 'acompanhado' }))
  assert.equal(r.excluida, true)
  assert.deepEqual(r.motivos, ['Canal da Berlenga: ondas até 3,0 m no pior caso (só com ondas abaixo de 3 m)'])
  assert.equal(s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, noCanal(2.9)) })).excluida, false)
  // as ligações ao canal também contam (a de entrada, perto de 39,12°)
  assert.equal(s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, (lat) => (lat > 39.11 && lat < 39.14 ? 3.2 : 2)) })).excluida, true)
  // ondas grandes longe do canal (a 39,6°, a mais de 10 MN dele) não são do canal: não exclui por isso
  const longe = s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, (lat) => (lat > 39.55 && lat < 39.7 ? 3.5 : 2)), tripulacao: 'acompanhado' }))
  assert.equal(longe.excluida, false)
  // sem ondas previstas no canal: desconhecido não é calmo → excluída
  const semOndas = s.avaliar(base({ alternativa: alt, pessimista: rasto(alt, noCanal(null)) }))
  assert.equal(semOndas.excluida, true)
  assert.deepEqual(semOndas.motivos, ['Canal da Berlenga: sem previsão de ondas no canal (desconhecido não conta como calmo; só com ondas abaixo de 3 m)'])
  // um rasto sem posições (não dá para isolar o canal): conta a onda máxima da rota toda
  const semPos = passagem({ min: 300 })
  semPos.pontos[10].ondas = 3.1
  assert.equal(s.avaliar(base({ alternativa: alt, pessimista: semPos })).excluida, true)
  // uma alternativa sem ondasMax não tem esta regra
  assert.equal(s.avaliar(base({ pessimista: rasto(rota(5), () => 3), tripulacao: 'acompanhado' })).excluida, false)
})

test('previsão sem dados (semDados de lib/previsao.js) de ondas, rajada ou vento: desconhecido não é calmo → excluída (aviso vermelho em "sair agora"); aproximado ou outros campos sem dados → só aviso', () => {
  const comPonto = (extra, qual = 'pessimista') => {
    const p = passagem()
    Object.assign(p.pontos[100], extra)
    return base({ [qual]: p, tripulacao: 'acompanhado' })
  }
  const ondas = s.avaliar(comPonto({ semDados: ['ondas'] }))
  assert.equal(ondas.excluida, true)
  assert.deepEqual(ondas.motivos, ['sem previsão de ondas em parte da rota: desconhecido não conta como calmo'])
  const vento = s.avaliar(comPonto({ semDados: ['tws', 'rajada', 'corrente'] }))
  assert.equal(vento.excluida, true)
  assert.deepEqual(vento.motivos, ['sem previsão de vento e rajadas em parte da rota: desconhecido não conta como calmo'])
  assert.deepEqual(vento.avisos, ['sem previsão de corrente em parte da rota'])
  // também no cenário provável (a mesma previsão)
  assert.equal(s.avaliar(comPonto({ semDados: ['rajada'] }, 'provavel')).excluida, true)
  // em "sair agora" não é excluída: passa a aviso vermelho (como o gasóleo e a bateria)
  const agora = s.avaliar({ ...comPonto({ semDados: ['ondas', 'tws'] }), sairAgora: true })
  assert.equal(agora.excluida, false)
  assert.deepEqual(agora.motivos, [])
  assert.deepEqual(agora.avisosVermelhos, ['sem previsão de vento e ondas em parte da rota: desconhecido não conta como calmo'])
  // outros campos sem dados: não exclui, fica um aviso
  const corrente = s.avaliar(comPonto({ semDados: ['corrente', 'correnteDir'] }))
  assert.equal(corrente.excluida, false)
  assert.deepEqual(corrente.motivos, [])
  assert.deepEqual(corrente.avisos, ['sem previsão de corrente e direção da corrente em parte da rota'])
  // aproximado (o ponto de previsão mais perto sem dado, veio do seguinte): só um aviso
  const aprox = s.avaliar(comPonto({ aproximado: ['ondas', 'tws'] }))
  assert.equal(aprox.excluida, false)
  assert.equal(aprox.naoRecomendada, false)
  assert.deepEqual(aprox.avisos, ['previsão de ondas e vento aproximada em parte da rota (de um ponto de previsão mais longe)'])
  // uma passagem com a previsão completa não tem avisos
  assert.deepEqual(s.avaliar(base()).avisos, [])
})

test('vento sem previsão (null) nunca é calma: o motor nessas horas conta inteiro ao leme', () => {
  // motor, ondas de 1 m, mas o vento é desconhecido: não é "motor em calma"
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: null, ondas: 1 } }).pontos), 15)
  assert.equal(s.horasLemeEquivalentes(passagem({ min: 900, ponto: { motor: true, tws: undefined, ondas: 1 } }).pontos), 15)
})

test('"Sair agora" com vento sem previsão em parte da rota (cenários + passagem + segurança): aviso vermelho, motor sem rizos, horas desconhecidas contam inteiras, sem NaN', () => {
  const { criarCenarios } = require('../lib/cenarios')
  const { simularPassagem } = require('../lib/passagem')
  const { carregarPolar } = require('../lib/base')
  const { criarEnergia } = require('../lib/energia')
  // 12 nós de través até 39,05°; daí para norte a previsão não tem vento nem rajada
  const tempoBruto = (lat) => (lat < 39.05
    ? { tws: 12, rajada: 15, twd: 270, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 1, periodo: 8, ondasDir: 270, corrente: 0, correnteDir: 0 }
    : { tws: null, rajada: null, twd: null, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 1, periodo: 8, ondasDir: 270, corrente: 0, correnteDir: 0, semDados: ['tws', 'rajada', 'twd'] })
  const k = criarCenarios({ tempoBruto, modelos: {}, polar: carregarPolar(), obtida: 0 })
  const alternativa = { afastamento: 5, excluida: false, avisos: [], pontos: [{ nome: 'A', lat: 39, lon: -9.5, costaLivre: true }, { nome: 'B', lat: 39 + 10 / 60, lon: -9.5, perna: 'linha' }] }
  const sim = {}
  for (const n of ['pessimista', 'provavel']) {
    sim[n] = simularPassagem({ rota: alternativa.pontos, partida: Date.UTC(2026, 8, 29, 12), tempo: k[n].tempo, velocidadeVela: k[n].velocidadeVela, consumo: k[n].consumo, noite: () => false, energia: criarEnergia({ socInicial: 0.9 }), opcoes: { motorNasAproximacoes: false } })
  }
  const pe = sim.pessimista
  assert.equal(pe.resumo.chegou, true)
  const desconhecidos = pe.pontos.filter(p => p.semDados)
  assert.ok(desconhecidos.length > 30)
  for (const p of desconhecidos) {
    assert.equal(p.tws, null) // nunca 0
    assert.equal(p.rajada, null)
    assert.equal(p.motor, true) // vento desconhecido: motor
    assert.equal(p.rizos, 0) // e os rizos ficam como estavam
  }
  // nada de NaN no resumo nem nos pontos; os máximos ignoram o desconhecido
  for (const [chave, v] of Object.entries(pe.resumo)) assert.ok(!Number.isNaN(v), chave)
  for (const p of pe.pontos) for (const [chave, v] of Object.entries(p)) assert.ok(!Number.isNaN(v), chave)
  assert.ok(Math.abs(pe.resumo.ventoMax - 13.2) < 1e-9)
  assert.ok(Math.abs(pe.resumo.rajadaMax - 16.5) < 1e-9)
  // os eventos não falam de "vento 0 nós" nem de "null"
  assert.ok(!pe.eventos.some(e => /vento 0 nós|null|NaN/.test(e.texto)), pe.eventos.map(e => e.texto).join(' | '))
  assert.ok(pe.eventos.some(e => /Motor ligado \(sem previsão de vento\)/.test(e.texto)))
  // a segurança: aviso vermelho em "sair agora"; todas as horas contam inteiras (nenhuma é calma)
  const r = s.avaliar({ alternativa, pessimista: pe, provavel: sim.provavel, destino: { nome: 'B', conhecido: true }, tripulacao: 'so', sairAgora: true, gasoleoInicial: 100, costaMinMn: 5 })
  assert.equal(r.excluida, false)
  assert.deepEqual(r.avisosVermelhos, ['sem previsão de vento e rajadas em parte da rota: desconhecido não conta como calmo'])
  assert.equal(r.horasLemeEq, pe.pontos.length / 60)
  assert.ok(!JSON.stringify(r).match(/null|NaN/))
})

test('alternativa não direta com a distância à costa desconhecida (null): excluída (falha para o lado seguro)', () => {
  // a distância dada já medida mas null
  const dada = s.avaliar(base({ costa: null, costaMinMn: null }))
  assert.equal(dada.excluida, true)
  assert.deepEqual(dada.motivos, ['distância à costa desconhecida'])
  assert.equal(dada.costaMinMn, null)
  // sem costa para medir e sem distância dada: excluída, não rebenta
  const semCosta = s.avaliar(base({ costa: null }))
  assert.equal(semCosta.excluida, true)
  assert.deepEqual(semCosta.motivos, ['distância à costa desconhecida'])
  // sem troços de linha para medir (todos costaLivre) sem ser direta: excluída
  const semLinha = rota(5)
  for (const p of semLinha.pontos) p.costaLivre = true
  assert.deepEqual(s.avaliar(base({ alternativa: semLinha })).motivos, ['distância à costa desconhecida'])
  // a direta (sem linha) não tem esta regra
  const direta = { ...semLinha, afastamento: null, direto: true, costaMinMn: 1.2 }
  assert.equal(s.avaliar(base({ alternativa: direta, costa: null, costaMinMn: null })).excluida, false)
})

test('gasóleo inicial ou bateria à chegada desconhecidos: aviso vermelho (não se salta a regra em silêncio)', () => {
  for (const sairAgora of [false, true]) {
    const semGasoleo = s.avaliar(base({ sairAgora, gasoleoInicial: undefined }))
    assert.equal(semGasoleo.excluida, false)
    assert.deepEqual(semGasoleo.avisosVermelhos, ['gasóleo inicial desconhecido: confirma o depósito'])
    assert.deepEqual(semGasoleo.motivos, [])
    const semBateria = s.avaliar(base({ sairAgora, pessimista: passagem({ resumo: { socFinal: null } }) }))
    assert.equal(semBateria.excluida, false)
    assert.deepEqual(semBateria.avisosVermelhos, ['bateria à chegada desconhecida'])
    // o gasto do pessimista não é número: o gasóleo à chegada também é desconhecido
    const semGasto = s.avaliar(base({ sairAgora, pessimista: passagem({ resumo: { gasoleoGasto: NaN } }) }))
    assert.deepEqual(semGasto.avisosVermelhos, ['gasóleo à chegada desconhecido'])
    assert.ok(!JSON.stringify(semGasto.avisosVermelhos).match(/NaN|null/))
  }
  assert.deepEqual(s.avaliar(base({ gasoleoInicial: null })).avisosVermelhos, ['gasóleo inicial desconhecido: confirma o depósito'])
  // com os dois conhecidos e bons, nenhum aviso vermelho
  assert.deepEqual(s.avaliar(base()).avisosVermelhos, [])
})

test('gasóleo e bateria à chegada arredondados para baixo: 39,6 L excluído nunca diz "40 L"', () => {
  const gas = s.avaliar(base({ gasoleoInicial: 100, pessimista: passagem({ resumo: { gasoleoGasto: 60.4 } }) }))
  assert.equal(gas.excluida, true)
  assert.deepEqual(gas.motivos, ['chegas com 39 L de gasóleo no pior caso (mínimo 40 L)'])
  const bat = s.avaliar(base({ pessimista: passagem({ resumo: { socFinal: 0.496 } }) }))
  assert.deepEqual(bat.motivos, ['chegas com a bateria a 49% no pior caso (mínimo 50%)'])
  // sem erros de vírgula flutuante (0,29 × 100 = 28,999…): 29%
  assert.deepEqual(s.avaliar(base({ pessimista: passagem({ resumo: { socFinal: 0.29 } }) })).motivos, ['chegas com a bateria a 29% no pior caso (mínimo 50%)'])
})
