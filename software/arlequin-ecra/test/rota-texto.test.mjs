// Funções puras dos cartões, das horas e dos avisos da página "Melhor rota" (desenho 3b-1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import * as t from '../public/lib/rota-texto.js'

const ler = (nome) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/resultado-${nome}.json.gz`, import.meta.url))))
const CANAL = ler('canal') // Peniche → Nazaré, 29/09, pelo Canal da Berlenga
const DIRETA = ler('direta') // Cascais → Algés, rota direta (salto curto)
const FUGA = ler('fuga') // Algés → Peniche, "sair agora": fugas com aviso vermelho
const AGORA = Date.parse('2026-09-29T14:32:00Z') // 15:32 em Lisboa

test('hora de Lisboa: HH:MM hoje, "amanhã HH:MM", e "sex 02/10 HH:MM" nos outros dias; "—" sem hora', () => {
  assert.equal(t.horaLisboa('2026-09-29T20:05:00Z', AGORA), '21:05')
  assert.equal(t.horaLisboa('2026-09-30T05:30:00Z', AGORA), 'amanhã 06:30')
  assert.equal(t.horaLisboa('2026-10-02T22:10:00Z', AGORA), 'sex 02/10 23:10')
  assert.equal(t.horaLisboa('2026-09-29T23:30:00Z', AGORA), 'amanhã 00:30') // já é dia 30 em Lisboa
  assert.equal(t.horaLisboa(Date.parse('2026-09-29T15:00:00Z'), AGORA), '16:00')
  for (const x of [null, undefined, 'lixo', NaN]) assert.equal(t.horaLisboa(x, AGORA), '—')
})

test('margem cedo–tarde da chegada (p10–p90), com o dia uma vez; igual → uma hora só', () => {
  assert.equal(t.margem({ p10: '2026-09-30T06:10:00Z', p50: '2026-09-30T06:30:00Z', p90: '2026-09-30T07:40:00Z' }, AGORA), 'amanhã 07:10–08:40')
  assert.equal(t.margem({ p10: '2026-09-29T18:00:00Z', p90: '2026-09-29T18:00:00Z' }, AGORA), '19:00')
  assert.equal(t.margem({ p10: '2026-09-29T22:30:00Z', p90: '2026-09-30T00:10:00Z' }, AGORA), '23:30–amanhã 01:10')
  assert.equal(t.margem({ p10: null, p90: '2026-09-29T18:00:00Z' }, AGORA), '—–19:00')
  assert.equal(t.margem(null, AGORA), '—')
})

test('números com vírgula e "—" para o que falta', () => {
  assert.equal(t.num(6.25, 1), '6,3')
  assert.equal(t.num(2, 1), '2,0')
  assert.equal(t.num(17.4, 0), '17')
  assert.equal(t.num(-0.04, 1), '0,0')
  for (const x of [null, undefined, NaN, 'x']) assert.equal(t.num(x, 1), '—')
})

test('o nome da rota: afastamento, "direta (salto curto)", pelo canal; e o da alternativa', () => {
  assert.equal(t.rotaCurta({ afastamento: 5, propulsao: 'motor' }), '5 MN, só motor')
  assert.equal(t.rotaCurta({ afastamento: null, direto: true, propulsao: 'vela' }), 'direta (salto curto), vela e motor')
  assert.equal(t.rotaCurta({ afastamento: 5, canal: 'Canal da Berlenga', propulsao: 'motor' }), '5 MN pelo Canal da Berlenga, só motor')
  assert.equal(t.rotaCurta({}), '—')
  assert.equal(t.nomeAlternativa(CANAL.alternativas[0]), 'Amanhã às 09:30, 5 MN pelo Canal da Berlenga, só motor')
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela' }), '8 MN, vela e motor')
  assert.match(t.nomeAlternativa(DIRETA.alternativas[0]), /direta \(salto curto\)/)
  assert.doesNotMatch(t.nomeAlternativa({ afastamento: null, direto: true }), /null/)
})

test('"vela e motor" com menos de 0,1 h de vela chama-se "a motor (sem vento para vela)" (no nome do plugin e no da rota)', () => {
  // Peniche → Nazaré: a 2.ª vai toda a motor (0,02 h de vela)
  assert.equal(CANAL.alternativas[1].horas.vela, 0.02)
  assert.equal(t.nomeAlternativa(CANAL.alternativas[1]), 'Amanhã às 09:30, 5 MN pelo Canal da Berlenga, a motor (sem vento para vela)')
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela', horas: { vela: 0.09 } }), '8 MN, a motor (sem vento para vela)')
  assert.equal(t.rotaCurta({ afastamento: 8, propulsao: 'vela', horas: { vela: 0 } }), '8 MN, a motor (sem vento para vela)')
  // com vela a sério, ou sem o número: "vela e motor"
  assert.equal(t.nomeAlternativa(FUGA.alternativas[1]), 'Agora, 5 MN, vela e motor')
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela', horas: { vela: 0.1 } }), '8 MN, vela e motor')
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela', horas: { vela: null } }), '8 MN, vela e motor')
  // a "só motor" fica "só motor"
  assert.equal(t.nomeAlternativa(CANAL.alternativas[0]), 'Amanhã às 09:30, 5 MN pelo Canal da Berlenga, só motor')
  // o campo semVela do plugin (horas em bruto) manda: 0,097 h arredonda a 0,1 mas vai sem vela (revisão final, 9)
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela', horas: { vela: 0.1 }, semVela: true }), '8 MN, a motor (sem vento para vela)')
  assert.equal(t.rotaCurta({ afastamento: 8, propulsao: 'vela', horas: { vela: 0.1 }, semVela: true }), '8 MN, a motor (sem vento para vela)')
  assert.equal(t.nomeAlternativa({ afastamento: 8, propulsao: 'vela', horas: { vela: 0.04 }, semVela: false }), '8 MN, vela e motor')
  assert.equal(t.rotaCurta({ afastamento: 8, propulsao: 'motor', horas: { vela: 0 }, semVela: true }), '8 MN, só motor')
})

test('a cor do veredicto por tipo: segue verde, espera amarelo, não recomendado laranja, volta vermelho', () => {
  assert.equal(t.corVeredicto('segue'), 'verde')
  assert.equal(t.corVeredicto('espera'), 'amarelo')
  assert.equal(t.corVeredicto('nao-recomendado'), 'laranja')
  assert.equal(t.corVeredicto('volta'), 'vermelho')
  assert.equal(t.corVeredicto('outro'), 'cinzento')
})

test('avisos vermelhos de uma alternativa: as fugas junto à costa da desistência (só a 1.ª), o gasóleo, sem repetir', () => {
  const l = t.avisosVermelhos(FUGA, 0, AGORA)
  assert.ok(l.includes('gasóleo inicial desconhecido: confirma o depósito (assumi 100 L)'), JSON.stringify(l))
  assert.ok(!l.some(x => /^Sem nível do gasóleo/.test(x)), 'o geral do gasóleo não se repete')
  const fugas = l.filter(x => /^Fuga /.test(x))
  assert.ok(fugas.length >= 1, JSON.stringify(l))
  // a mesma fuga para o abrigo e para a volta junta-se numa linha
  assert.match(fugas[0], /^Fuga às 19:16 \(Cabo Raso\) para Cascais e Algés \(CNA\): fuga junto à costa com vento do mar \(a sotavento\)/)
  assert.equal(new Set(l).size, l.length)
  // noutro dia: "Fuga amanhã às 10:33 (5 MN feitas) para Peniche"
  const canal = t.avisosVermelhos(CANAL, 0, AGORA).filter(x => /^Fuga /.test(x))
  assert.match(canal[0], /^Fuga amanhã às 10:33 \(5 MN feitas\) para Peniche: /)
  // as fugas são da 1.ª alternativa: as outras não as repetem
  assert.ok(!t.avisosVermelhos(FUGA, 1, AGORA).some(x => /^Fuga /.test(x)))
})

test('avisos vermelhos: o canal por confirmar (com a nota), a previsão aproximada ou velha e a bateria assumida', () => {
  const l = t.avisosVermelhos(CANAL, 0)
  assert.ok(l.includes('Canal da Berlenga: terra dos dois lados; só com ondas < 3 m — por confirmar na carta'), JSON.stringify(l))
  // auditoria I-28: a forma real do plugin — previsao.aviso é um código ('aviso' com mais de 6 h, 'grande' com
  // mais de 12 h; rota/lib/previsao.js) e a frase vem nos avisos gerais (rota/lib/calculo.js)
  const r = {
    ...CANAL,
    previsao: { ...CANAL.previsao, aviso: 'aviso' },
    avisos: ['Previsão guardada há 9 h (sem rede)', 'Sem estado da bateria: assumi 80%', 'Sem dados do mar: a corrente de maré na barra do Tejo fica a 0'],
    alternativas: [{ ...CANAL.alternativas[0], avisosRota: ['previsão de rajadas aproximada em parte da rota (de um ponto de previsão mais longe)'] }]
  }
  const m = t.avisosVermelhos(r, 0)
  assert.ok(m.includes('Previsão guardada há 9 h (sem rede)'))
  assert.ok(!m.includes('aviso'), 'o código não se mostra')
  const velha = t.avisosVermelhos({ ...r, previsao: { ...CANAL.previsao, aviso: 'grande' }, avisos: ['Previsão velha: a mais recente guardada tem 14 h (sem rede)'] }, 0)
  assert.ok(velha.includes('Previsão velha: a mais recente guardada tem 14 h (sem rede)'))
  assert.ok(!velha.includes('grande'), 'nunca "⚠ grande"')
  assert.ok(m.includes('Sem estado da bateria: assumi 80%'))
  assert.ok(m.includes('previsão de rajadas aproximada em parte da rota (de um ponto de previsão mais longe)'))
  assert.ok(!m.includes('Sem dados do mar: a corrente de maré na barra do Tejo fica a 0'))
  assert.deepEqual(t.avisosGerais(r), ['Sem dados do mar: a corrente de maré na barra do Tejo fica a 0'])
  assert.deepEqual(t.avisosVermelhos({}, 0), [])
})

test('a idade da previsão e a linha "previsão das HH:MM (há X min), AI · N alternativas"', () => {
  assert.equal(t.idade(Date.parse('2026-09-29T14:00:00Z'), AGORA), 'há 32 min')
  assert.equal(t.idade(Date.parse('2026-09-29T09:02:00Z'), AGORA), 'há 5 h 30')
  assert.equal(t.idade(null, AGORA), '')
  assert.equal(t.linhaPrevisao(CANAL, AGORA), 'previsão das 15:00 (há 32 min), AI: a aprender · 114 alternativas avaliadas')
  const comAi = { ...CANAL, ia: { versoes: { velocidade: 'v0003', ventoForca: 'v0001', consumo: null }, nota: 'AI v0003' } }
  assert.match(t.linhaPrevisao(comAi, AGORA), /, AI v0003 · /)
  assert.equal(t.linhaPrevisao({}, AGORA), '')
})

test('esc: texto seguro para HTML', () => {
  assert.equal(t.esc('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;')
  assert.equal(t.esc(null), '')
})

test('"amanhã" nos dias da mudança de hora (dias de 23 h e de 25 h): o dia seguinte é o do calendário de Lisboa', () => {
  // sáb 28/03/2026 23:30 (WET) → dom 29/03 11:00 (WEST): o domingo tem 23 h
  assert.equal(t.horaLisboa('2026-03-29T10:00:00Z', Date.parse('2026-03-28T23:30:00Z')), 'amanhã 11:00')
  // dom 25/10/2026 00:30 (WEST) → seg 26/10 09:00 (WET): o domingo tem 25 h
  assert.equal(t.horaLisboa('2026-10-26T09:00:00Z', Date.parse('2026-10-24T23:30:00Z')), 'amanhã 09:00')
  assert.equal(t.quandoAs('2026-10-26T09:00:00Z', Date.parse('2026-10-24T23:30:00Z')), 'amanhã às 09:00')
  // e dois dias depois já não é amanhã
  assert.equal(t.horaLisboa('2026-10-27T09:00:00Z', Date.parse('2026-10-24T23:30:00Z')), 'ter 27/10 09:00')
  // fim do mês e do ano
  assert.equal(t.horaLisboa('2026-11-01T09:00:00Z', Date.parse('2026-10-31T12:00:00Z')), 'amanhã 09:00')
  assert.equal(t.horaLisboa('2027-01-01T09:00:00Z', Date.parse('2026-12-31T12:00:00Z')), 'amanhã 09:00')
})
