'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const d = require('../lib/decisao')

const H = 3600000
const AGORA = Date.UTC(2026, 8, 29, 14, 32) // 15:32 em Lisboa

test('custo: a fórmula do desenho (os dois exemplos de 29/09 do desenho geral)', () => {
  // partir agora por fora: 14,3 h, 10,4 h de noite, 14,3 h ao leme, rajada 27, ondas 2,6
  const agora = d.custo({ resumo: { duracaoH: 14.3, horasNoite: 10.4, rajadaMax: 27, ondasMax: 2.6 }, esperaH: 0, tripulacao: 'so', lemeEq: 14.3, contraVentoH: 0 })
  assert.ok(Math.abs(agora.total - 48.9) < 1e-9, `${agora.total}`)
  assert.deepEqual(Object.keys(agora.partes), ['horas', 'espera', 'noite', 'leme', 'rajada', 'ondas', 'contraVento'])
  // amanhã às 08:00 a motor: 12,2 h, espera 16,4 h, ~0,93 h de noite, 6,1 h equivalentes
  const depois = d.custo({ resumo: { duracaoH: 12.2, horasNoite: 1.4 / 1.5, rajadaMax: 15, ondasMax: 1.2 }, esperaH: 16.4, tripulacao: 'so', lemeEq: 6.1, contraVentoH: 0 })
  assert.ok(Math.abs(depois.total - 23.8) < 1e-9, `${depois.total}`)
  // acompanhado: as horas ao leme não contam; contra o vento conta metade
  const acomp = d.custo({ resumo: { duracaoH: 10, horasNoite: 0, rajadaMax: 10, ondasMax: 1 }, tripulacao: 'acompanhado', lemeEq: 10, contraVentoH: 4 })
  assert.equal(acomp.total, 12)
  // sem ondas previstas (NaN/-Infinity no resumo) não soma nada
  assert.equal(d.custo({ resumo: { duracaoH: 1, horasNoite: 0, rajadaMax: 0, ondasMax: -Infinity } }).total, 1)
})

test('horas contra o vento: vento de 7 nós ou mais a ≤ 50° da proa', () => {
  const p = (proa, twd, tws = 12) => ({ proa, twd, tws })
  const pontos = [...Array(60).fill(p(0, 45)), ...Array(60).fill(p(0, 90)), ...Array(30).fill(p(10, 0, 5)), ...Array(30).fill(p(350, 30))]
  assert.equal(d.horasContraVento(pontos), 1.5)
  // M-05: o vento desconhecido (força ou direção sem previsão) conta como contra (o pior caso), nunca como nada
  assert.equal(d.horasContraVento([...Array(30).fill(p(0, null)), ...Array(30).fill(p(0, 45, null)), ...Array(60).fill(p(0, 180))]), 1)
})

test('M-05: com a previsão incompleta o custo não fica mais baixo — a rajada e as ondas desconhecidas contam como os limites a solo (30 nós, 3 m)', () => {
  const resumo = { duracaoH: 10, horasNoite: 0, rajadaMax: -Infinity, ondasMax: -Infinity }
  const sem = d.custo({ resumo, tripulacao: 'acompanhado', semDados: ['rajada', 'ondas'] })
  assert.equal(sem.partes.rajada, 0.5 * (30 - 20))
  assert.equal(sem.partes.ondas, 2 * (3 - 2))
  // a parte conhecida maior que o pior caso assumido fica a conhecida
  const maior = d.custo({ resumo: { ...resumo, rajadaMax: 34, ondasMax: 3.5 }, tripulacao: 'acompanhado', semDados: new Set(['rajada', 'ondas']) })
  assert.equal(maior.partes.rajada, 0.5 * 14)
  assert.equal(maior.partes.ondas, 2 * 1.5)
  // a conhecida mais baixa sobe para o pior caso
  const menor = d.custo({ resumo: { ...resumo, rajadaMax: 18, ondasMax: 1 }, tripulacao: 'acompanhado', semDados: ['rajada', 'ondas'] })
  assert.equal(menor.partes.rajada, 5)
  assert.equal(menor.partes.ondas, 2)
  // sem nada desconhecido, como sempre
  assert.equal(d.custo({ resumo: { ...resumo, rajadaMax: 18, ondasMax: 1 }, tripulacao: 'acompanhado' }).total, 10)
  // uma passagem com a previsão incompleta nunca é mais barata do que a mesma com a previsão completa e calma
  assert.ok(sem.total > d.custo({ resumo: { ...resumo, rajadaMax: 15, ondasMax: 1 }, tripulacao: 'acompanhado' }).total)
})

test('partidas: agora, +3, +6 … +48 h arredondadas à meia hora, antes do fim da previsão; sair agora só agora', () => {
  const l = d.partidas(AGORA)
  assert.equal(l.length, 17)
  assert.equal(l[0], AGORA)
  assert.equal(new Date(l[1]).toISOString(), '2026-09-29T17:30:00.000Z')
  assert.equal(new Date(l[16]).toISOString(), '2026-10-01T14:30:00.000Z')
  assert.deepEqual(d.partidas(AGORA, { sairAgora: true }), [AGORA])
  assert.equal(d.partidas(AGORA, { fim: AGORA + 10 * H }).length, 4)
  assert.equal(d.quando(AGORA + H, AGORA), 'às 16:32')
  assert.equal(d.quando(Date.UTC(2026, 8, 30, 7), AGORA), 'amanhã às 08:00')
  assert.equal(d.quando(Date.UTC(2026, 9, 1, 7), AGORA), 'dia 1 às 08:00')
})

test('I-18: "amanhã" é o dia seguinte no calendário de Lisboa, também à volta da mudança de hora (dias de 23 h e de 25 h)', () => {
  // primavera de 2027: a hora muda no domingo 28/03 (01:00 UTC). Agora: sábado 27/03 às 23:30 de Lisboa
  const sab = Date.UTC(2027, 2, 27, 23, 30)
  assert.equal(d.quando(Date.UTC(2027, 2, 29, 7), sab), 'dia 29 às 08:00') // segunda: depois de amanhã (era "amanhã")
  assert.equal(d.quando(Date.UTC(2027, 2, 28, 9), sab), 'amanhã às 10:00') // domingo: amanhã (era "dia 28")
  assert.equal(d.quando(Date.UTC(2027, 2, 27, 23, 45), sab), 'às 23:45')
  // outono de 2026: a hora muda no domingo 25/10 (01:00 UTC). Agora: domingo 25/10 às 00:30 de Lisboa
  const dom = Date.UTC(2026, 9, 24, 23, 30)
  assert.equal(d.quando(Date.UTC(2026, 9, 26, 8), dom), 'amanhã às 08:00') // segunda (era "dia 26")
  assert.equal(d.quando(Date.UTC(2026, 9, 25, 22), dom), 'às 22:00') // ainda domingo
  assert.equal(d.quando(Date.UTC(2026, 9, 27, 8), dom), 'dia 27 às 08:00')
  // fim do mês e do ano
  assert.equal(d.quando(Date.UTC(2027, 0, 1, 9), Date.UTC(2026, 11, 31, 20)), 'amanhã às 09:00')
  assert.equal(d.quando(Date.UTC(2026, 9, 1, 9), Date.UTC(2026, 8, 30, 20)), 'amanhã às 10:00')
})

// Candidato inventado.
let n = 0
function cand ({ partida = AGORA, custo = 20, excluida = false, naoRecomendada = false, motivos = [], afastamento = 5, propulsao = 'vela', chegada = partida + 12 * H, noite = false } = {}) {
  return {
    id: `c${n++}`, partida, esperaH: (partida - AGORA) / H, afastamento, propulsao, milhas: 60, excluida, naoRecomendada, motivos,
    custo: { total: custo }, chegadaNoite: noite,
    resumos: { provavel: { chegada: new Date(chegada).toISOString(), ventoMax: 15, ondasMax: 2 } }
  }
}

test('veredicto "Segue": a melhor recomendada parte agora', () => {
  const r = d.decidir({ candidatos: [cand({ custo: 30 }), cand({ partida: AGORA + 3 * H, custo: 31 }), cand({ custo: 20, afastamento: 8 })], agora: AGORA, tripulacao: 'so' })
  assert.equal(r.veredicto.tipo, 'segue')
  assert.equal(r.veredicto.texto, 'Segue')
  assert.equal(r.veredicto.porque.length, 1)
  assert.match(r.veredicto.porque[0], /^Parte agora pela rota a 8 MN: chegas amanhã às 03:32 \(de dia\), vento até 15 nós, ondas até 2,0 m\.$/)
  assert.deepEqual(r.top.map(c => c.custo.total), [20, 30, 31])
})

test('veredicto "Espera até às HH:MM": a melhor recomendada parte mais tarde; as não recomendadas ficam atrás (sozinho)', () => {
  const agoraNr = cand({ custo: 10, naoRecomendada: true, motivos: ['rajadas até 34 nós no pior caso (limite 30 sozinho)', '16,5 h equivalentes ao leme (limite 8 h sozinho)'] })
  const amanha = cand({ partida: Date.UTC(2026, 8, 30, 7), custo: 24 })
  const excl = cand({ custo: 1, excluida: true, motivos: ['a rota passa a 4,2 MN da costa (mínimo 5 MN)'] })
  const r = d.decidir({ candidatos: [agoraNr, amanha, excl], agora: AGORA, tripulacao: 'so' })
  assert.equal(r.veredicto.tipo, 'espera')
  assert.equal(r.veredicto.texto, 'Espera até amanhã às 08:00')
  assert.equal(r.veredicto.porque[0], 'Agora: rajadas até 34 nós no pior caso (limite 30 sozinho) e 16,5 h equivalentes ao leme (limite 8 h sozinho).')
  assert.match(r.veredicto.porque[1], /^Partindo amanhã às 08:00, pela rota a 5 MN: /)
  assert.deepEqual(r.top.map(c => c.id), [amanha.id, agoraNr.id]) // a excluída nunca aparece
  // mesmo dia: "Espera até às 18:30"
  const logo = d.decidir({ candidatos: [agoraNr, cand({ partida: Date.UTC(2026, 8, 29, 17, 30), custo: 30 })], agora: AGORA, tripulacao: 'so' })
  assert.equal(logo.veredicto.texto, 'Espera até às 18:30')
  // acompanhado: a "não recomendada" também conta (revisão final, I4 — o lib/seguranca.js só a marca
  // com os limites de acompanhado); ver o teste I4 abaixo
})

test('veredicto "Não recomendado sozinho": nenhuma recomendada; com "sair agora" mostra a de menor custo', () => {
  const a = cand({ custo: 40, naoRecomendada: true, motivos: ['14,5 h equivalentes ao leme (limite 8 h sozinho)'] })
  const b = cand({ partida: AGORA + 15 * H, custo: 39, naoRecomendada: true, motivos: ['15,4 h equivalentes ao leme (limite 8 h sozinho)'] })
  const r = d.decidir({ candidatos: [a, b], agora: AGORA, tripulacao: 'so' })
  assert.equal(r.veredicto.tipo, 'nao-recomendado')
  assert.equal(r.veredicto.texto, 'Não recomendado sozinho')
  assert.equal(r.veredicto.porque.length, 2)
  assert.match(r.veredicto.porque[0], /^Nenhuma partida nas próximas 48 h passa nos limites; a melhor \(a 5 MN, amanhã às 06:32\): 15,4 h equivalentes/)
  assert.equal(r.veredicto.porque[1], 'Agora: 14,5 h equivalentes ao leme (limite 8 h sozinho).')
  // "Sair agora mesmo assim": só a de agora (quem chama já só simulou agora), com as não recomendadas
  const s = d.decidir({ candidatos: [a, cand({ custo: 45, naoRecomendada: true, motivos: ['x'] }), cand({ custo: 42 })], agora: AGORA, tripulacao: 'so', sairAgora: true })
  // só pelo custo, mas a recomendada do veredicto "segue" (42) é a 1.ª: os cartões, a desistência e o
  // plano são os da 1.ª (revisão final, 1)
  assert.deepEqual(s.top.map(c => c.custo.total), [42, 40, 45])
  assert.equal(s.veredicto.tipo, 'segue') // a melhor recomendada (42) parte agora
  const s2 = d.decidir({ candidatos: [a], agora: AGORA, tripulacao: 'so', sairAgora: true })
  assert.equal(s2.veredicto.tipo, 'nao-recomendado')
  assert.equal(s2.top.length, 1)
  assert.match(s2.veredicto.porque[1], /pontos de desistência/)
  // tudo excluído (acompanhado): "Não recomendado" com o motivo
  const e = d.decidir({ candidatos: [], agora: AGORA, tripulacao: 'acompanhado', excluidasAgora: ['não há passagem a 5 MN entre A e B'] })
  assert.equal(e.veredicto.texto, 'Não recomendado')
  assert.equal(e.veredicto.porque[0], 'Agora: não há passagem a 5 MN entre A e B.')
})

test('K-06 (decisão do Ivo n.º 1): "Sair agora" com uma exclusão levantada (gasóleo, bateria, previsão) nunca é "Segue": faixa "Não recomendado…" e "Se saíres/continuares mesmo assim…"', () => {
  const GAS = 'chegas com 22 L de gasóleo no pior caso (mínimo 40 L)'
  const levantada = (o = {}) => Object.assign(cand({ custo: 20, ...o }), { excluidaSemSairAgora: true, avisosVermelhos: [GAS] })
  for (const [tripulacao, texto] of [['so', 'Não recomendado sozinho'], ['acompanhado', 'Não recomendado']]) {
    const r = d.decidir({ candidatos: [levantada({ naoRecomendada: true, motivos: [GAS] })], agora: AGORA, tripulacao, sairAgora: true })
    assert.equal(r.veredicto.tipo, 'nao-recomendado', tripulacao)
    assert.equal(r.veredicto.texto, texto)
    assert.deepEqual(r.veredicto.porque, [`A melhor para sair agora (a 5 MN, agora): ${GAS}.`, 'Se saíres mesmo assim, revê as precauções e os pontos de desistência.'])
    assert.equal(r.top.length, 1) // continua a poder ativar-se: é a 1.ª mostrada
  }
  // a marca chega para não a recomendar (mesmo sem o naoRecomendada)
  assert.equal(d.recomendada(levantada()), false)
  assert.equal(d.decidir({ candidatos: [levantada({ motivos: [GAS] })], agora: AGORA, tripulacao: 'so', sairAgora: true }).veredicto.tipo, 'nao-recomendado')
  // no mar (o Recalcular), sem abrigo recomendado: "Se continuares mesmo assim"
  const mar = d.decidir({ candidatos: [levantada({ naoRecomendada: true, motivos: [GAS] })], agora: AGORA, tripulacao: 'so', sairAgora: true, emMar: true })
  assert.equal(mar.veredicto.tipo, 'nao-recomendado')
  assert.equal(mar.veredicto.porque.at(-1), 'Se continuares mesmo assim, revê as precauções e os pontos de desistência.')
  // uma recomendada (sem nada levantado) continua a ganhar: "Segue" é dela
  const boa = cand({ custo: 30 })
  const s = d.decidir({ candidatos: [levantada({ naoRecomendada: true, motivos: [GAS] }), boa], agora: AGORA, tripulacao: 'so', sairAgora: true })
  assert.equal(s.veredicto.tipo, 'segue')
  assert.equal(s.top[0].id, boa.id)
})

test('M-19: "Volta ou abriga-te na Nazaré" e "Até à Nazaré são …" (as preposições com os nomes femininos)', () => {
  const continuar = cand({ custo: 30, naoRecomendada: true, motivos: ['rajadas até 33 nós no pior caso (limite 30 sozinho)'] })
  const abrigo = { destino: { nome: 'Nazaré' }, candidato: { ...cand({ custo: 5, chegada: AGORA + 2 * H }), milhas: 8.2 } }
  const r = d.decidir({ candidatos: [continuar], agora: AGORA, tripulacao: 'so', emMar: true, abrigo })
  assert.equal(r.veredicto.texto, 'Volta ou abriga-te na Nazaré')
  assert.match(r.veredicto.porque[1], /^Até à Nazaré são 8,2 MN: /)
  // sem artigo, como sempre
  const p = d.decidir({ candidatos: [continuar], agora: AGORA, tripulacao: 'so', emMar: true, abrigo: { ...abrigo, destino: { nome: 'Peniche' } } })
  assert.equal(p.veredicto.texto, 'Volta ou abriga-te em Peniche')
  assert.match(p.veredicto.porque[1], /^Até Peniche são 8,2 MN: /)
})

test('veredicto "Volta ou abriga-te em X": só no mar, continuar não é recomendado e o abrigo é', () => {
  const continuar = cand({ custo: 30, naoRecomendada: true, motivos: ['rajadas até 33 nós no pior caso (limite 30 sozinho)'] })
  const tarde = cand({ partida: AGORA + 6 * H, custo: 35 })
  const abrigo = { destino: { nome: 'Cascais' }, candidato: { ...cand({ custo: 5, chegada: AGORA + 2 * H }), milhas: 8.2 } }
  const r = d.decidir({ candidatos: [continuar, tarde], agora: AGORA, tripulacao: 'so', emMar: true, abrigo })
  assert.equal(r.veredicto.tipo, 'volta')
  assert.equal(r.veredicto.texto, 'Volta ou abriga-te em Cascais')
  assert.equal(r.veredicto.porque[0], 'Agora: rajadas até 33 nós no pior caso (limite 30 sozinho).')
  assert.match(r.veredicto.porque[1], /^Até Cascais são 8,2 MN: chegas às 17:32/)
  // no porto não há "volta": espera
  assert.equal(d.decidir({ candidatos: [continuar, tarde], agora: AGORA, tripulacao: 'so', emMar: false, abrigo }).veredicto.tipo, 'espera')
  // o abrigo também não recomendado: não é "volta"
  const mau = { destino: { nome: 'Cascais' }, candidato: { ...abrigo.candidato, naoRecomendada: true } }
  assert.equal(d.decidir({ candidatos: [continuar, tarde], agora: AGORA, tripulacao: 'so', emMar: true, abrigo: mau }).veredicto.tipo, 'espera')
  // continuar é recomendado: segue
  assert.equal(d.decidir({ candidatos: [cand({ custo: 30 })], agora: AGORA, tripulacao: 'so', emMar: true, abrigo }).veredicto.tipo, 'segue')
  // decisão 6 (Ivo): no mar, o Recalcular pede "sair agora" (só a partida imediata) e o "Volta ou abriga-te" fica
  const agora = d.decidir({ candidatos: [continuar], agora: AGORA, tripulacao: 'so', sairAgora: true, emMar: true, abrigo })
  assert.equal(agora.veredicto.tipo, 'volta')
  assert.equal(agora.veredicto.texto, 'Volta ou abriga-te em Cascais')
  assert.equal(agora.veredicto.porque[0], 'Agora: rajadas até 33 nós no pior caso (limite 30 sozinho).')
  // re-revisão M-1: no mar, o "Sair agora mesmo assim" (sairAgora) fica com o abrigo E com a frase das precauções
  assert.match(agora.veredicto.porque[1], /^Até Cascais são 8,2 MN: /)
  // revisão final M2: no mar o Ivo já saiu — "Se continuares mesmo assim"
  assert.equal(agora.veredicto.porque[2], 'Se continuares mesmo assim, revê as precauções e os pontos de desistência.')
  // no mar sem abrigo recomendado ("Não recomendado"), a mesma frase; no porto, "Se saíres"
  const semAbrigo = d.decidir({ candidatos: [continuar], agora: AGORA, tripulacao: 'so', sairAgora: true, emMar: true, abrigo: null })
  assert.equal(semAbrigo.veredicto.tipo, 'nao-recomendado')
  assert.equal(semAbrigo.veredicto.porque.at(-1), 'Se continuares mesmo assim, revê as precauções e os pontos de desistência.')
  assert.equal(d.decidir({ candidatos: [continuar], agora: AGORA, tripulacao: 'so', sairAgora: true, emMar: false }).veredicto.porque.at(-1), 'Se saíres mesmo assim, revê as precauções e os pontos de desistência.')
  assert.equal(r.veredicto.porque.length, 2, 'sem sairAgora, sem a frase')
  assert.equal(d.decidir({ candidatos: [cand({ custo: 30 })], agora: AGORA, tripulacao: 'so', sairAgora: true, emMar: true, abrigo }).veredicto.tipo, 'segue')
})

test('I-15: no mar, com a partida de agora recomendada e uma mais tarde mais barata, nunca "Volta ou abriga-te" (nem "Agora: ."): espera, e partir agora também dá', () => {
  const agoraRec = cand({ custo: 30 })
  const depois = cand({ partida: AGORA + 3 * H, custo: 25 })
  const abrigo = { destino: { nome: 'Cascais' }, candidato: { ...cand({ custo: 5, chegada: AGORA + 2 * H }), milhas: 8.2 } }
  for (const sairAgora of [false, true]) {
    const cands = sairAgora ? [agoraRec] : [agoraRec, depois]
    const r = d.decidir({ candidatos: cands, agora: AGORA, tripulacao: 'so', emMar: true, abrigo, sairAgora })
    assert.notEqual(r.veredicto.tipo, 'volta', JSON.stringify(r.veredicto))
    assert.doesNotMatch(JSON.stringify(r.veredicto), /Agora: \./)
    if (!sairAgora) {
      assert.equal(r.veredicto.tipo, 'espera')
      assert.equal(r.veredicto.texto, 'Espera até às 18:32')
      assert.match(r.veredicto.porque[0], /^Partir agora também dá, mas custa mais: chegas /)
    } else assert.equal(r.veredicto.tipo, 'segue')
  }
  // com a de agora não recomendada, o "Volta" de sempre
  const agoraNr = cand({ custo: 30, naoRecomendada: true, motivos: ['rajadas até 33 nós no pior caso (limite 30 sozinho)'] })
  assert.equal(d.decidir({ candidatos: [agoraNr, depois], agora: AGORA, tripulacao: 'so', emMar: true, abrigo }).veredicto.tipo, 'volta')
  // uma de agora não recomendada e sem motivos (não devia haver): a frase genérica, nunca "Agora: ."
  const semMotivos = Object.assign(cand({ custo: 10 }), { excluidaSemSairAgora: true })
  assert.equal(d.decidir({ candidatos: [semMotivos, depois], agora: AGORA, tripulacao: 'so' }).veredicto.porque[0], 'Agora não há alternativa recomendada.')
})

test('M-01: sem vento previsto no provável (o máximo é -Infinity) a frase diz "sem previsão de vento", nunca "vento até -Infinity nós"', () => {
  const c = cand({ custo: 10 })
  c.resumos.provavel.ventoMax = -Infinity
  c.resumos.provavel.ondasMax = -Infinity
  const r = d.decidir({ candidatos: [c], agora: AGORA, tripulacao: 'acompanhado' })
  assert.equal(r.veredicto.porque[0], 'Parte agora pela rota a 5 MN: chegas amanhã às 03:32 (de dia), sem previsão de vento.')
  const s = d.decidir({ candidatos: [{ ...c, naoRecomendada: true, motivos: ['x'] }], agora: AGORA, tripulacao: 'so', sairAgora: true })
  assert.doesNotMatch(JSON.stringify(s.veredicto), /Infinity|NaN|undefined|null/)
})

test('a rota direta (afastamento null) e a variante por um canal no texto do veredicto: nunca "a null MN"', () => {
  const direta = { ...cand({ custo: 10 }), afastamento: null, direto: true }
  const r = d.decidir({ candidatos: [direta], agora: AGORA, tripulacao: 'so' })
  assert.match(r.veredicto.porque[0], /^Parte agora pela rota direta: /)
  const canal = { ...cand({ custo: 10, propulsao: 'motor' }), canal: 'Canal da Berlenga' }
  const k = d.decidir({ candidatos: [canal], agora: AGORA, tripulacao: 'so' })
  assert.match(k.veredicto.porque[0], /^Parte agora pela rota a 5 MN pelo Canal da Berlenga a motor: /)
  // "não recomendado" e "espera" também
  const nr = d.decidir({ candidatos: [{ ...direta, naoRecomendada: true, motivos: ['x'] }], agora: AGORA, tripulacao: 'so' })
  // M-17: uma só resposta (aceitava "às 15:32" ou "agora"; a partida de agora diz sempre "agora")
  assert.equal(nr.veredicto.porque[0], 'Nenhuma partida nas próximas 48 h passa nos limites; a melhor (direta, agora): x.')
  const es = d.decidir({ candidatos: [{ ...direta, partida: AGORA + 3 * H }], agora: AGORA, tripulacao: 'so' })
  assert.match(es.veredicto.porque[1], /pela rota direta: /)
  for (const x of [r, k, nr, es]) assert.doesNotMatch(JSON.stringify(x.veredicto), /null/)
})

test('I1: a frase não contradiz a chegada de noite — o provável chega de dia mas outro cenário de noite: "(pode ser de noite)"', () => {
  const c = cand({ noite: true })
  c.chegadaNoiteProvavel = false
  const r = d.decidir({ candidatos: [c], agora: AGORA, tripulacao: 'acompanhado' })
  assert.match(r.veredicto.porque[0], /^Parte agora pela rota a 5 MN: chegas amanhã às 03:32 \(pode ser de noite\), /)
  // o provável de noite: "(de noite)"; nenhum: "(de dia)"
  const c2 = cand({ noite: true }); c2.chegadaNoiteProvavel = true
  assert.match(d.decidir({ candidatos: [c2], agora: AGORA, tripulacao: 'acompanhado' }).veredicto.porque[0], /\(de noite\)/)
  assert.match(d.decidir({ candidatos: [cand()], agora: AGORA, tripulacao: 'acompanhado' }).veredicto.porque[0], /\(de dia\)/)
})

test('I4: com "acompanhado", uma "não recomendada" (acima dos limites de acompanhado, lib/seguranca.js) já não segue; nenhuma passa → "Não recomendado"', () => {
  const agoraNr = cand({ custo: 10, naoRecomendada: true, motivos: ['vento médio até 31 nós no pior caso (limite 28 acompanhado)'] })
  const amanha = cand({ partida: Date.UTC(2026, 8, 30, 7), custo: 24 })
  const r = d.decidir({ candidatos: [agoraNr, amanha], agora: AGORA, tripulacao: 'acompanhado' })
  assert.equal(r.veredicto.tipo, 'espera')
  assert.equal(r.veredicto.porque[0], 'Agora: vento médio até 31 nós no pior caso (limite 28 acompanhado).')
  assert.deepEqual(r.top.map(c => c.id), [amanha.id, agoraNr.id])
  const so = d.decidir({ candidatos: [agoraNr], agora: AGORA, tripulacao: 'acompanhado' })
  assert.equal(so.veredicto.tipo, 'nao-recomendado')
  assert.equal(so.veredicto.texto, 'Não recomendado')
  assert.equal(d.recomendada(agoraNr, 'acompanhado'), false)
})

test('sem alternativas repetidas: "vela e motor" sem vela (< 0,1 h) e "só motor" com a mesma partida e a mesma geometria contam como uma só (fica a "só motor"; a vaga passa à seguinte)', () => {
  const comVela = (o, horasVela) => { const x = cand(o); x.canal = o.canal ?? null; x.direto = !!o.direto; x.resumos.provavel.horasVela = horasVela; return x }
  // Peniche → Nazaré: com 7 nós a "vela e motor" vai toda a motor (0,04 h de vela)
  const velaSem = comVela({ custo: 10, propulsao: 'vela', canal: 'Canal da Berlenga' }, 0.04)
  const motor = comVela({ custo: 10, propulsao: 'motor', canal: 'Canal da Berlenga' }, 0)
  const outra = comVela({ custo: 12, propulsao: 'motor', afastamento: 8 }, 0)
  const tarde = comVela({ custo: 13, propulsao: 'motor', partida: AGORA + 3 * H, canal: 'Canal da Berlenga' }, 0)
  const top = d.melhores([velaSem, motor, outra, tarde], { tripulacao: 'so' })
  assert.deepEqual(top.map(c => c.id), [motor.id, outra.id, tarde.id])
  // as 3 são distintas (partida, geometria, propulsão)
  assert.equal(new Set(top.map(c => `${c.partida}|${c.afastamento}|${c.canal}|${c.direto}|${c.propulsao}`)).size, 3)
  // com vela a sério (≥ 0,1 h) não são a mesma: as duas ficam
  const velaCom = comVela({ custo: 9, propulsao: 'vela', canal: 'Canal da Berlenga' }, 0.1)
  assert.deepEqual(d.melhores([velaCom, motor, outra], { tripulacao: 'so' }).map(c => c.id), [velaCom.id, motor.id, outra.id])
  // outra partida ou outra geometria: não é repetida
  const velaOutraGeo = comVela({ custo: 9, propulsao: 'vela', afastamento: 8 }, 0)
  assert.deepEqual(d.melhores([velaOutraGeo, motor], { tripulacao: 'so' }).map(c => c.id), [velaOutraGeo.id, motor.id])
  // o veredicto usa as mesmas 3
  assert.deepEqual(d.decidir({ candidatos: [velaSem, motor, outra, tarde], agora: AGORA, tripulacao: 'so' }).top.map(c => c.id), [motor.id, outra.id, tarde.id])
})

test('sem repetidas, mas só quando a "só motor" não é pior: outra recomendação ou mais avisos/motivos e ficam as duas (revisão final, 1)', () => {
  const comVela = (o, horasVela, extra = {}) => { const x = cand(o); x.canal = null; x.direto = false; x.resumos.provavel.horasVela = horasVela; return Object.assign(x, extra) }
  // a sonda da revisão: a "vela e motor" recomendada (0,05 h de vela) e o par "só motor" não recomendado (leme)
  const vela = comVela({ custo: 10, propulsao: 'vela' }, 0.05)
  const motor = comVela({ custo: 11, propulsao: 'motor', naoRecomendada: true, motivos: ['9 h equivalentes ao leme (limite 8 h sozinho)'] }, 0)
  const tarde = comVela({ custo: 20, propulsao: 'motor', partida: AGORA + 6 * H }, 0)
  const r = d.decidir({ candidatos: [vela, motor, tarde], agora: AGORA, tripulacao: 'so' })
  assert.deepEqual(r.top.map(c => c.id), [vela.id, tarde.id, motor.id])
  assert.equal(r.veredicto.tipo, 'segue')
  assert.match(r.veredicto.porque[0], /^Parte agora pela rota a 5 MN:/)
  // "Sair agora": o veredicto "segue" é o da 1.ª mostrada (não a "só motor" não recomendada)
  const s = d.decidir({ candidatos: [vela, motor], agora: AGORA, tripulacao: 'so', sairAgora: true })
  assert.equal(s.veredicto.tipo, 'segue')
  assert.deepEqual(s.top.map(c => c.id), [vela.id, motor.id])
  // a "só motor" com um aviso vermelho que a "vela e motor" não tem: ficam as duas
  const v2 = comVela({ custo: 10, propulsao: 'vela' }, 0, { avisosVermelhos: [] })
  const m2 = comVela({ custo: 9, propulsao: 'motor' }, 0, { avisosVermelhos: ['a previsão acaba antes da chegada (22:00)'] })
  assert.deepEqual(d.melhores([v2, m2], { tripulacao: 'so' }).map(c => c.id), [m2.id, v2.id])
  // os avisos da "só motor" contidos nos da "vela e motor": é a mesma passagem, fica a "só motor"
  const v3 = comVela({ custo: 10, propulsao: 'vela' }, 0, { avisosVermelhos: ['a', 'b'] })
  const m3 = comVela({ custo: 9, propulsao: 'motor' }, 0, { avisosVermelhos: ['a'] })
  assert.deepEqual(d.melhores([v3, m3], { tripulacao: 'so' }).map(c => c.id), [m3.id])
  // as duas não recomendadas, a "só motor" com um motivo a mais: ficam as duas
  const v4 = comVela({ custo: 10, propulsao: 'vela', naoRecomendada: true, motivos: ['m1'] }, 0)
  const m4 = comVela({ custo: 9, propulsao: 'motor', naoRecomendada: true, motivos: ['m1', 'm2'] }, 0)
  assert.deepEqual(d.melhores([v4, m4], { tripulacao: 'so' }).map(c => c.id), [m4.id, v4.id])
  // a "só motor" chega de noite e a "vela e motor" não: ficam as duas
  const v5 = comVela({ custo: 10, propulsao: 'vela' }, 0)
  const m5 = comVela({ custo: 9, propulsao: 'motor', noite: true }, 0)
  assert.deepEqual(d.melhores([v5, m5], { tripulacao: 'so' }).map(c => c.id), [m5.id, v5.id])
})

test('o veredicto fala sempre da 1.ª alternativa mostrada (top[0]): 400 casos ao acaso, com e sem "Sair agora" (revisão final, 1)', () => {
  let s = 12345
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const escolha = (l) => l[Math.floor(rnd() * l.length)]
  for (let k = 0; k < 400; k++) {
    const sairAgora = rnd() < 0.3
    const lista = []
    const n = 1 + Math.floor(rnd() * 8)
    for (let j = 0; j < n; j++) {
      const partida = sairAgora ? AGORA : AGORA + escolha([0, 0, 3, 6]) * H
      const x = cand({ partida, custo: Math.round(rnd() * 20), propulsao: escolha(['vela', 'motor']), afastamento: escolha([5, 8]), naoRecomendada: rnd() < 0.4, motivos: rnd() < 0.5 ? ['m1'] : [], excluida: rnd() < 0.1 })
      x.resumos.provavel.horasVela = escolha([0, 0.05, 0.5])
      x.avisosVermelhos = rnd() < 0.3 ? ['a'] : []
      lista.push(x)
    }
    const r = d.decidir({ candidatos: lista, agora: AGORA, tripulacao: 'so', sairAgora })
    const caso = JSON.stringify({ k, sairAgora, top: r.top.map(c => c.id), v: r.veredicto })
    if (r.veredicto.tipo === 'segue') {
      assert.ok(d.recomendada(r.top[0]) && r.top[0].partida === AGORA, caso)
    }
    if (r.veredicto.tipo === 'espera') {
      assert.ok(d.recomendada(r.top[0]), caso)
      assert.equal(r.veredicto.texto, `Espera até ${d.quando(r.top[0].partida, AGORA)}`, caso)
    }
    // a melhor recomendada (quando há) é a 1.ª
    if (lista.some(c => d.recomendada(c))) assert.ok(d.recomendada(r.top[0]), caso)
  }
})

test('M-20: o horizonte das partidas no texto é o do cálculo (horasPartidas; por omissão o da previsão, 48 h), nunca "48 h" escrito à mão', () => {
  const nr = { ...cand({ custo: 10 }), afastamento: null, direto: true, naoRecomendada: true, motivos: ['x'] }
  assert.equal(d.decidir({ candidatos: [nr], agora: AGORA, tripulacao: 'so' }).veredicto.porque[0], 'Nenhuma partida nas próximas 48 h passa nos limites; a melhor (direta, agora): x.')
  assert.equal(d.decidir({ candidatos: [nr], agora: AGORA, tripulacao: 'so', horasPartidas: 24 }).veredicto.porque[0], 'Nenhuma partida nas próximas 24 h passa nos limites; a melhor (direta, agora): x.')
})
