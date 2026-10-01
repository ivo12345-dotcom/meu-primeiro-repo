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
    'Até qua 30/09 às 17:09 ainda volta a Peniche.',
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
  assert.ok(linhas.includes('Até qua 30/09 às 06:29 ainda volta a Algés (CNA).'), p.texto)
  assert.match(p.texto, /liga ao Ivo \(\+351 912 345 678\)\. Se não atender/)
  assert.match(p.texto, /diz: veleiro ARLEQUIN, de Algés \(CNA\) para Peniche, saída 15:32\.$/m)
  assert.doesNotMatch(p.texto, proibido)
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

test('acompanhado, telefone de emergência mudado na configuração e partida no mar', () => {
  const r = { ...FIX.fuga, tripulacao: 'acompanhado', partida: { nome: 'Posição atual', lat: 38.65, lon: -9.4, emMar: true } }
  const p = montar(r, 0, { telefones: { ivo: '', emergencia: '112' } })
  assert.match(p.texto, /^Tripulação: 2 ou mais$/m)
  assert.match(p.texto, /^Partida: 15:32 da posição 38,6500 N 9,4000 W$/m)
  assert.match(p.texto, /Se não atender, liga para 112 e diz: veleiro ARLEQUIN, de 38,6500 N 9,4000 W para Peniche/)
  assert.doesNotMatch(p.texto, proibido)
})

test('nunca null, NaN nem undefined: campos em falta ficam de fora ou com "—"', () => {
  const alt = { ...FIX.canal.alternativas[0], chegada: { p10: null, p50: null, p90: null }, afastamento: null, propulsao: null, pontosRota: [] }
  const r = { ...FIX.canal, alternativas: [alt], desistencia: [], partida: {}, destino: {} }
  const p = montar(r, 0, { barco: { nome: '', modelo: null }, telefones: {} })
  assert.doesNotMatch(p.texto, proibido)
  assert.doesNotMatch(p.gpx, proibido)
  assert.match(p.texto, /Hora de alarme: —/)
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

test('configuração do plugin da rota: o barco e os telefones, com os valores por defeito', () => {
  const p = criar({ getDataDirPath: () => '.', setPluginStatus () {}, error () {} })
  const s = p.schema.properties
  assert.deepEqual(Object.fromEntries(Object.entries(s.barco.properties).map(([k, v]) => [k, v.default])), BARCO)
  assert.deepEqual(Object.fromEntries(Object.entries(s.telefones.properties).map(([k, v]) => [k, v.default])), TELEFONES)
})
