'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const plano = require('../lib/plano')
const gpx = require('../lib/gpx')
const criar = require('..')

// Resultados reais (29/09, previsão gravada), aparados: Peniche → Nazaré pelo Canal da Berlenga,
// Cascais → Algés pela rota direta, Algés → Peniche "sair agora" (fugas com aviso vermelho).
const FIX = require('./fixtures/resultado-3b1.json')
const AGORA = Date.parse('2026-09-29T14:40:00Z') // 15:40 em Lisboa
const BARCO = { nome: 'ARLEQUIN', modelo: 'Jeanneau Melody 34', corCasco: '', mmsi: '', indicativo: '' }
const TELEFONES = { ivo: '', emergencia: '+351 214 401 919 (MRCC Lisboa, 24 h) ou 112' }
const montar = (r, indice = 0, o = {}) => plano.montarPlano({ resultado: r, indice, barco: BARCO, telefones: TELEFONES, agora: AGORA, ...o })
const proibido = /null|NaN|undefined|\[object/

// Verificação mínima de XML bem formado: etiquetas equilibradas, atributos entre aspas, & só em entidades.
function xmlBemFormado (xml) {
  const semDecl = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const pilha = []
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g
  let m
  while ((m = re.exec(semDecl))) {
    if (m[6]) throw new Error(`"<" solto em ${m.index}`)
    if (m[5] != null) { if (/&(?!(amp|lt|gt|quot|apos);)/.test(m[5])) throw new Error(`& solto: ${m[5]}`); continue }
    if (/&(?!(amp|lt|gt|quot|apos);)/.test(m[3])) throw new Error(`& solto num atributo: ${m[3]}`)
    if (m[4]) continue
    if (m[1]) { const a = pilha.pop(); if (a !== m[2]) throw new Error(`</${m[2]}> fecha <${a}>`) } else pilha.push(m[2])
  }
  if (pilha.length) throw new Error(`por fechar: ${pilha.join(', ')}`)
  return true
}

test('hora de alarme = chegada mais tarde (p90) + 2 h', () => {
  const alt = FIX.fuga.alternativas[1]
  assert.equal(plano.horaAlarme(alt), Date.parse(alt.chegada.p90) + 2 * 3600000)
  assert.equal(new Date(plano.horaAlarme(alt)).toISOString(), '2026-09-30T08:59:00.000Z')
  assert.equal(plano.horaAlarme({ chegada: {} }), null)
})

test('horas de Lisboa: HH:MM hoje, com o dia da semana e a data nos outros dias', () => {
  assert.equal(plano.horaLisboa(Date.parse('2026-09-29T20:05:00Z'), AGORA), '21:05')
  assert.equal(plano.horaLisboa(Date.parse('2026-09-30T08:30:00Z'), AGORA), 'qua 30/09 09:30')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-02T22:10:00Z'), AGORA), 'sex 02/10 23:10')
  // 23:30 UTC de 29/09 já é dia 30 em Lisboa
  assert.equal(plano.horaLisboa(Date.parse('2026-09-29T23:30:00Z'), AGORA), 'qua 30/09 00:30')
  assert.equal(plano.horaLisboa(NaN, AGORA), '—')
})

test('o texto do plano (Peniche → Nazaré pelo Canal da Berlenga), exatamente', () => {
  const p = montar(FIX.canal, 0)
  assert.equal(p.texto, [
    'PLANO DE NAVEGAÇÃO · ARLEQUIN',
    'Enviado ter 29/09 15:40 (horas de Lisboa)',
    '',
    'Barco: ARLEQUIN, Jeanneau Melody 34',
    'Partida: qua 30/09 09:30 de Peniche',
    'Destino: Nazaré',
    'Rota: a 5 MN da costa, via Canal da Berlenga, só motor',
    'Chegada provável: qua 30/09 18:21 (o mais tarde: qua 30/09 18:21)',
    'Tripulação: só eu',
    'Até qua 30/09 às 17:09 ainda volta a Peniche, exceto qua 30/09 às 10:33 (fuga junto à costa com vento do mar), qua 30/09 às 13:10 (fuga junto à costa com vento do mar) e qua 30/09 às 14:34 (sem fuga possível).',
    '',
    'Hora de alarme: qua 30/09 20:21',
    'Se não houver notícias até qua 30/09 20:21, liga ao Ivo. Se não atender, liga ao MRCC Lisboa +351 214 401 919 (ou 112) e diz: veleiro ARLEQUIN, de Peniche para Nazaré, saída qua 30/09 09:30.',
    '',
    'A rota vai em anexo (GPX).'
  ].join('\n'))
  assert.equal(p.nomeFicheiro, 'arlequin-peniche-nazare-20260930-0930.gpx')
})

test('com os dados do barco e o telefone do Ivo; abrigos pelo caminho e "até às" da desistência', () => {
  const barco = { ...BARCO, corCasco: 'branco', mmsi: '263000000', indicativo: 'CSX1234' }
  const p = montar(FIX.fuga, 0, { barco, telefones: { ...TELEFONES, ivo: '+351 912 345 678' } })
  const linhas = p.texto.split('\n')
  assert.ok(linhas.includes('Barco: ARLEQUIN, Jeanneau Melody 34, casco branco, MMSI 263000000, indicativo CSX1234'))
  assert.ok(linhas.includes('Partida: 15:32 de Algés (CNA)'), p.texto)
  assert.ok(linhas.includes('Rota: a 5 MN da costa, só motor'))
  assert.ok(linhas.includes('Abrigos pelo caminho: Oeiras, Cascais'), p.texto)
  // as exceções da desistência vão com a frase (no dia do envio, só a hora)
  assert.ok(linhas.includes('Até qua 30/09 às 06:29 ainda volta a Algés (CNA), exceto junto ao Cabo Raso às 19:16 (fuga junto à costa com vento do mar).'), p.texto)
  assert.match(p.texto, /liga ao Ivo \(\+351 912 345 678\)\. Se não atender/)
  assert.match(p.texto, /diz: veleiro ARLEQUIN, de Algés \(CNA\) para Peniche, saída 15:32\.$/m)
  assert.doesNotMatch(p.texto, proibido)
})

test('as exceções do "até às" vêm dos pontos da desistência, não do texto do resumo: nunca os diagnósticos internos', () => {
  const ponto = (t, hora, extra) => ({ t, hora, tipo: 'marco', nome: null, lat: 38.7, lon: -9.4, milhas: 5, abrigo: null, voltar: null, semAbrigo: null, semVolta: null, ...extra })
  const volta = (o = {}) => ({ id: 'alges', nome: 'Algés (CNA)', milhas: 9, vento: 'a favor', avisoVermelho: null, ...o })
  const desistencia = [
    ponto('2026-09-29T15:00:00Z', '16:00', { voltar: volta({ avisoVermelho: 'fuga junto à costa sem vento previsto — só em último recurso: não há vento previsto' }) }),
    ponto('2026-09-29T15:30:00Z', '16:30', { semVolta: 'sem fuga possível daqui: rota absurda: 42,6 MN para 9,0 MN em linha reta; rota absurda: 51,5 MN para 9,0 MN em linha reta' }),
    ponto('2026-09-29T16:00:00Z', '17:00', { tipo: 'cabo', nome: 'Nazaré', voltar: volta({ avisoVermelho: 'fuga junto à costa com vento do mar (a sotavento) — só em último recurso: 0,8 MN de terra' }) }),
    ponto('2026-09-29T16:30:00Z', '17:30', { tipo: 'cabo', nome: 'Cabo Raso', voltar: volta({ avisoVermelho: 'fuga junto à costa com vento do mar (a sotavento) — só em último recurso: 0,8 MN de terra' }) }),
    ponto('2026-09-29T17:00:00Z', '18:00', { voltar: volta({ vento: 'de través' }) }),
    // depois do último "volta": não conta
    ponto('2026-09-29T17:30:00Z', '18:30', { semVolta: 'sem fuga possível daqui: rota absurda' })
  ]
  // o resumo pode dizer outra coisa (ou nada): as exceções saem dos pontos
  const r = { ...FIX.fuga, desistencia, desistenciaResumo: 'um texto qualquer' }
  const p = montar(r, 0)
  assert.ok(p.texto.split('\n').includes('Até às 18:00 ainda volta a Algés (CNA), exceto às 16:00 (fuga junto à costa sem vento previsto), às 16:30 (sem fuga possível), junto à Nazaré às 17:00 (fuga junto à costa com vento do mar) e junto ao Cabo Raso às 17:30 (fuga junto à costa com vento do mar).'), p.texto)
  assert.doesNotMatch(p.texto, /rota absurda|sotavento|último recurso|MN de terra/)
  // sem exceções: só a frase
  const q = montar({ ...FIX.fuga, desistencia: [desistencia[4]], desistenciaResumo: null }, 0)
  assert.ok(q.texto.split('\n').includes('Até às 18:00 ainda volta a Algés (CNA).'), q.texto)
})

test('a rota direta escreve-se "direta (salto curto)"; uma alternativa que não é a 1.ª não leva o "até às" (a desistência é da 1.ª)', () => {
  const p = montar(FIX.direta, 1)
  assert.ok(p.texto.includes('\nRota: direta (salto curto), só motor\n'), p.texto)
  assert.doesNotMatch(p.texto, /ainda volta/)
  assert.doesNotMatch(p.texto, proibido)
  const q = montar(FIX.fuga, 2)
  assert.ok(q.texto.includes('\nRota: a 8 MN da costa, vela e motor\n'))
  assert.match(q.texto, /Chegada provável: qua 30\/09 08:36 \(o mais tarde: qua 30\/09 08:58\)/)
  assert.match(q.texto, /Hora de alarme: qua 30\/09 10:58/)
})

test('"vela e motor" com menos de 0,1 h de vela: a rota diz "a motor (sem vento para vela)"', () => {
  const comVela = (vela) => ({ ...FIX.canal.alternativas[1], horas: { vela } })
  assert.equal(plano.rotaTexto(comVela(0.04)), 'a 5 MN da costa, via Canal da Berlenga, a motor (sem vento para vela)')
  assert.equal(plano.rotaTexto(comVela(0.1)), 'a 5 MN da costa, via Canal da Berlenga, vela e motor')
  assert.equal(plano.rotaTexto(comVela(undefined)), 'a 5 MN da costa, via Canal da Berlenga, vela e motor')
  assert.equal(plano.rotaTexto({ ...FIX.canal.alternativas[0], horas: { vela: 0 } }), 'a 5 MN da costa, via Canal da Berlenga, só motor')
  const p = montar({ ...FIX.canal, alternativas: [comVela(0.02)] }, 0)
  assert.match(p.texto, /^Rota: a 5 MN da costa, via Canal da Berlenga, a motor \(sem vento para vela\)$/m)
  assert.match(p.gpx, /a motor \(sem vento para vela\)/)
})

test('acompanhado, telefone de emergência mudado na configuração e partida no mar', () => {
  const r = { ...FIX.fuga, tripulacao: 'acompanhado', partida: { nome: 'Posição atual', lat: 38.65, lon: -9.4, emMar: true } }
  const p = montar(r, 0, { telefones: { ivo: '', emergencia: '112' } })
  assert.match(p.texto, /^Tripulação: 2 ou mais$/m)
  assert.match(p.texto, /^Partida: 15:32 da posição 38,6500 N 9,4000 W$/m)
  assert.match(p.texto, /Se não atender, liga para 112 e diz: veleiro ARLEQUIN, de 38,6500 N 9,4000 W para Peniche/)
  assert.doesNotMatch(p.texto, proibido)
})

test('nunca null, NaN nem undefined: campos em falta ficam de fora ou com "—"', () => {
  const alt = { ...FIX.canal.alternativas[0], partida: null, chegada: { p10: null, p50: null, p90: FIX.canal.alternativas[0].chegada.p90 }, afastamento: null, propulsao: null, pontosRota: [] }
  const r = { ...FIX.canal, alternativas: [alt], desistencia: [], desistenciaResumo: null, partida: {}, destino: {} }
  const p = montar(r, 0, { barco: { nome: '', modelo: null }, telefones: {} })
  assert.doesNotMatch(p.texto, proibido)
  assert.doesNotMatch(p.gpx, proibido)
  assert.match(p.texto, /^Partida: —$/m)
  assert.match(p.texto, /^Chegada provável: — \(o mais tarde: qua 30\/09 18:21\)$/m)
  assert.match(p.texto, /^Hora de alarme: qua 30\/09 20:21$/m)
})

test('sem a chegada mais tarde (p90) não há hora de alarme: o plano não se monta (erro 422 com o motivo)', () => {
  const alt = { ...FIX.canal.alternativas[0], chegada: { ...FIX.canal.alternativas[0].chegada, p90: null } }
  const r = { ...FIX.canal, alternativas: [alt] }
  assert.equal(plano.SEM_ALARME, 'sem hora de chegada mais tarde: não há hora de alarme, o plano não foi enviado')
  assert.throws(() => montar(r, 0), (e) => e.status === 422 && e.message === plano.SEM_ALARME)
})

test('o número do MRCC está numa só constante: o telefone de emergência por defeito e a frase do plano usam-na', () => {
  assert.equal(plano.MRCC, '+351 214 401 919')
  assert.equal(plano.EMERGENCIA_PADRAO, `${plano.MRCC} (MRCC Lisboa, 24 h) ou 112`)
  assert.ok(montar(FIX.canal, 0).texto.includes(`liga ao MRCC Lisboa ${plano.MRCC} (ou 112)`))
})

test('mudança de hora: as horas da hora repetida (fim do horário de verão) dizem se são de verão ou de inverno', () => {
  const ag = Date.parse('2026-10-24T12:00:00Z')
  // 25/10/2026: às 02:00 de verão (01:00Z) volta-se à 01:00; das 01:00 às 02:00 acontece duas vezes
  assert.equal(plano.horaLisboa(Date.parse('2026-10-25T00:30:00Z'), ag), 'dom 25/10 01:30 (hora de verão)')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-25T01:30:00Z'), ag), 'dom 25/10 01:30 (hora de inverno)')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-25T00:00:00Z'), ag), 'dom 25/10 01:00 (hora de verão)')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-25T01:59:00Z'), ag), 'dom 25/10 01:59 (hora de inverno)')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-24T23:59:00Z'), ag), 'dom 25/10 00:59')
  assert.equal(plano.horaLisboa(Date.parse('2026-10-25T02:00:00Z'), ag), 'dom 25/10 02:00')
  // no início do horário de verão não há hora repetida (salta-se da 01:00 para as 02:00)
  assert.equal(plano.horaLisboa(Date.parse('2026-03-29T00:30:00Z'), ag), 'dom 29/03 00:30')
  assert.equal(plano.horaLisboa(Date.parse('2026-03-29T01:30:00Z'), ag), 'dom 29/03 02:30')
  // no plano: a hora de alarme na hora repetida
  const alt = { ...FIX.canal.alternativas[0], chegada: { p10: '2026-10-24T22:00:00Z', p50: '2026-10-24T23:00:00Z', p90: '2026-10-24T23:30:00Z' } }
  const p = plano.montarPlano({ resultado: { ...FIX.canal, alternativas: [alt] }, indice: 0, barco: BARCO, telefones: TELEFONES, agora: ag })
  assert.match(p.texto, /^Hora de alarme: dom 25\/10 01:30 \(hora de inverno\)$/m)
  assert.match(p.texto, /^Se não houver notícias até dom 25\/10 01:30 \(hora de inverno\), liga ao Ivo/m)
})

test('GPX 1.1 com um <rte> e os pontos da alternativa, o nome do barco e a data; nomes escapados para XML', () => {
  const alt = FIX.canal.alternativas[0]
  const p = montar(FIX.canal, 0)
  assert.ok(xmlBemFormado(p.gpx))
  assert.match(p.gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" creator="[^"]+" xmlns="http:\/\/www.topografix.com\/GPX\/1\/1">/)
  assert.equal((p.gpx.match(/<rte>/g) || []).length, 1)
  const pts = [...p.gpx.matchAll(/<rtept lat="([-\d.]+)" lon="([-\d.]+)"><name>([^<]*)<\/name><\/rtept>/g)]
  assert.equal(pts.length, alt.pontosRota.length)
  pts.forEach((m, i) => { assert.equal(Number(m[1]), alt.pontosRota[i].lat); assert.equal(Number(m[2]), alt.pontosRota[i].lon) })
  assert.equal(pts[0][3], alt.pontosRota[0].nome)
  assert.equal(pts[1][3], alt.pontosRota[1].nome || 'WP1')
  assert.match(p.gpx, /<metadata><name>ARLEQUIN: Peniche → Nazaré<\/name>/)
  assert.match(p.gpx, /<time>2026-09-29T14:40:00.000Z<\/time>/)
  // escapar
  const x = gpx.gpxRota({ titulo: 'A & B <"x">', descricao: "d'a", pontos: [{ lat: 1, lon: 2, nome: 'P&Q' }], quando: AGORA })
  assert.ok(xmlBemFormado(x))
  assert.match(x, /<name>A &amp; B &lt;&quot;x&quot;&gt;<\/name>/)
  assert.match(x, /<name>P&amp;Q<\/name>/)
  assert.match(x, /<desc>d&apos;a<\/desc>/)
  assert.throws(() => xmlBemFormado('<a><b></a>'))
})

test('GPX: os caracteres que o XML 1.0 não aceita (controlo, U+FFFE/U+FFFF, metades de surrogate) tiram-se; o tab e a mudança de linha ficam', () => {
  const x = gpx.gpxRota({ titulo: 'A\u0001B\u001fC\tD', descricao: 'x\u0000y\nz', autor: 'Ze\u0008', pontos: [{ lat: 1, lon: 2, nome: 'P' + String.fromCharCode(0xfffe) + 'Q\uD800R\u{1F600}' }], quando: AGORA })
  assert.ok(xmlBemFormado(x))
  assert.doesNotMatch(x, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u{FFFE}\u{FFFF}]|\uD800/u)
  assert.match(x, /<metadata><name>ABC\tD<\/name><desc>xy\nz<\/desc><author><name>Ze<\/name><\/author>/)
  assert.ok(x.includes('<name>PQR\u{1F600}</name>'))
  assert.equal(gpx.esc('a\u0007<b>'), 'a&lt;b&gt;')
})

test('slug: um só ajudante (sem acentos, minúsculas, hífenes) para os ids dos destinos, das alternativas e o nome do GPX', () => {
  const { slug } = require('../lib/slug')
  assert.equal(slug('Algés (CNA)'), 'alges-cna')
  assert.equal(slug('Canal da Berlenga'), 'canal-da-berlenga')
  assert.equal(slug('  --Nazaré!! '), 'nazare')
  assert.equal(slug(null), '')
  assert.equal(slug('a'.repeat(50), 30), 'a'.repeat(30))
  assert.equal(slug('a'.repeat(50)).length, 50)
})

test('configuração do plugin da rota: o barco e os telefones, com os valores por defeito', () => {
  const p = criar({ getDataDirPath: () => '.', setPluginStatus () {}, error () {} })
  const s = p.schema.properties
  assert.deepEqual(Object.fromEntries(Object.entries(s.barco.properties).map(([k, v]) => [k, v.default])), BARCO)
  assert.deepEqual(Object.fromEntries(Object.entries(s.telefones.properties).map(([k, v]) => [k, v.default])), TELEFONES)
  assert.equal(s.telefones.properties.emergencia.default, plano.EMERGENCIA_PADRAO)
})
