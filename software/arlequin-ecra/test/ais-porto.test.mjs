// A AIS no ecrã com as formas do cpa.js da F6 e o "em porto" (contrato C12, F3b item 5):
//   - o plugin AIS publica navigation.arlequin.emPorto (a menos de 0,5 MN de um porto conhecido e com o nosso SOG
//     abaixo de 4 nós; true | false | null) e o ecrã passa-o a classificar(r, LIMITES_AIS, { aproxima: false, emPorto }):
//     um alvo parado (ou ainda sem velocidade) em porto fica "atenção" (amarelo, sem som) em vez de "perigo";
//   - um alvo com notifications.arlequin.ais.<mmsi> em alarm é "perigo" e nunca vai para o fim da lista (M-50),
//     mesmo sem o nosso SOG (o plugin alarma pela velocidade tirada do rasto, que o ecrã não tem);
//   - sem velocidade, o texto diz de quem é ("sem rumo do alvo", "sem o nosso rumo", "sem rumo de nenhum dos dois");
//   - tcpa Infinity (sem movimento relativo) é "—", nunca "Infinity" nem um perigo.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lerFonte } from './ajuda-fonte.mjs'
import { cpa, classificar, LIMITES_AIS } from '../public/lib/cpa.js'
import { alvosAis, leituraCpa, emPortoDe, EM_PORTO_VELHO_MS, semRumoTexto } from '../public/lib/ais.js'
import { linhaAlvo } from '../public/paginas/comum.js'
import ais from '../public/paginas/ais.js'
import carta from '../public/paginas/carta.js'

const NO = 1852 / 3600
const P = { latitude: 39.36, longitude: -9.40 }
// um ponto a `mn` milhas no rumo `g` (graus) de P
const desloc = (mn, g) => ({ latitude: P.latitude + mn / 60 * Math.cos(g * Math.PI / 180), longitude: P.longitude + mn / 60 * Math.sin(g * Math.PI / 180) / Math.cos(P.latitude * Math.PI / 180) })
const agora = Date.now()
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const proibido = /undefined|NaN|Infinity|null|\[object/

// os alvos do store têm { mmsi, name, position, cog, sog, em }
const alvo = (mmsi, name, mn, g, extra = {}) => ({ mmsi, name, position: desloc(mn, g), em: agora, ...extra })
const alarme = (mmsi, state = 'alarm') => ({ caminho: `notifications.arlequin.ais.${mmsi}`, id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', state, method: ['visual', 'sound'], apito: 'continuo', message: `X ${mmsi} em rota de colisão · CPA 0,1 MN`, status: { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true } })

// ---------- C12: o "em porto" ----------
test('C12: em porto um alvo parado, ou ainda sem velocidade, no nosso caminho é "atenção" (amarelo, sem som) e não "perigo"; um alvo em movimento é "perigo" sempre; fora do porto, como decidido (K-01)', () => {
  // nós a 3 nós para norte; o cais fica à frente, a 0,3 MN
  const eu = { position: P, cog: 0, sog: 3 * NO }
  const parado = alvo('1', 'FUNDEADO NO CAIS', 0.3, 0, { sog: 0 })
  const semVel = alvo('2', 'SEM VELOCIDADE', 0.3, 5)
  const aSair = alvo('3', 'FERRY A VIR', 0.3, 0, { sog: 8 * NO, cog: Math.PI })
  const lista = (emPorto) => Object.fromEntries(alvosAis({ vessels: [parado, semVel, aSair], eu, notificacoes: [], agora, emPorto }).map(a => [a.name, a.classe]))
  assert.deepEqual(lista(true), { 'FUNDEADO NO CAIS': 'atencao', 'SEM VELOCIDADE': 'atencao', 'FERRY A VIR': 'perigo' })
  // fora do porto (ou sem saber): o parado no caminho é perigo; o sem velocidade perto, atenção (sem histórico não se sabe se vem)
  for (const emPorto of [false, null, undefined]) assert.deepEqual(lista(emPorto), { 'FUNDEADO NO CAIS': 'perigo', 'SEM VELOCIDADE': 'atencao', 'FERRY A VIR': 'perigo' }, String(emPorto))
  // o mesmo cálculo do plugin: classificar(r, LIMITES_AIS, { aproxima: false, emPorto })
  const r = cpa(eu, parado)
  assert.equal(classificar(r, LIMITES_AIS, { aproxima: false, emPorto: true }), 'atencao')
  assert.equal(classificar(r, LIMITES_AIS, { aproxima: false, emPorto: false }), 'perigo')
  // e o app.js passa-lho
  assert.match(lerFonte('lib/ais.js'), /classificar\(r, LIMITES_AIS, \{ aproxima: false, emPorto \}\)/)
})

test('C12: o "em porto" do SignalK (navigation.arlequin.emPorto) só conta quando é true e recente (o plugin publica de 2 em 2 s); false, null, velho ou em falta é "fora do porto" (o lado do perigo)', () => {
  assert.equal(EM_PORTO_VELHO_MS, 30000)
  const dos = (valores, idades = {}) => emPortoDe({ v: (p) => valores[p], idade: (p) => idades[p] ?? (p in valores ? 0 : Infinity) })
  const P_ = 'navigation.arlequin.emPorto'
  assert.equal(dos({ [P_]: true }), true)
  assert.equal(dos({ [P_]: true }, { [P_]: 29000 }), true)
  assert.equal(dos({ [P_]: true }, { [P_]: 31000 }), false, 'o plugin parou: já não se sabe')
  for (const x of [false, null, undefined, 'true', 1, {}]) assert.equal(dos({ [P_]: x }), false, String(x))
  assert.equal(dos({}), false)
  // o app.js lê-o do store e entrega-o ao alvosAis e às páginas (ctx.emPorto)
  const app = lerFonte('app.js')
  assert.match(app, /emPortoDe\(/)
  assert.match(app, /alvosAis\(\{[\s\S]*?emPorto/)
  assert.match(app, /emPorto:\s*emPortoAgora/)
})

test('C12: a página AIS diz porque é que os parados aparecem a amarelo ("em porto: os alvos parados aparecem a amarelo e não apitam") só quando o ecrã está em porto', () => {
  const eu = { position: P, cog: 0, sog: 2 * NO }
  const vessels = [alvo('1', 'FUNDEADO', 0.2, 20, { sog: 0 })]
  const ctx = (emPorto) => ({ alvos: alvosAis({ vessels, eu, notificacoes: [], agora, emPorto }), estado: {}, notificacoes: [], emPorto })
  const em = ais.render(ctx(true))
  assert.equal((em.match(/Em porto: os alvos parados aparecem a amarelo e não apitam/g) || []).length, 1, 'uma linha só')
  assert.match(em, /<tr data-mmsi="1"[^>]*class="atencao /)
  assert.match(em, /atenção<\/td><\/tr>/)
  assert.doesNotMatch(ais.render(ctx(false)), /Em porto/)
  assert.doesNotMatch(ais.render({ ...ctx(undefined), emPorto: undefined }), /Em porto/)
  assert.doesNotMatch(em, proibido)
})

// ---------- M-50: o alarme do plugin AIS ----------
test('M-50: um alvo com o alarme do plugin ativo é "perigo" e fica à frente da lista — também sem o nosso SOG/COG (o plugin alarma pela velocidade do rasto, que o ecrã não tem), sem a nossa posição e sem a velocidade do alvo', () => {
  const longe = alvo('7', 'LONGE', 4, 90, { sog: 5 * NO, cog: Math.PI })
  const alarmado = alvo('9', 'ALARMADO', 6, 10) // nem SOG nem COG, o mais longe de todos
  const perto = alvo('8', 'PERTO', 0.4, 200, { sog: 0 })
  const notificacoes = [alarme('9')]
  // sem o nosso SOG/COG (o GPS não os dá): todos sem velocidade 'eu'; o alarmado é perigo e vem primeiro, antes do mais perto
  const semSog = alvosAis({ vessels: [longe, perto, alarmado], eu: { position: P }, notificacoes, agora })
  assert.ok(semSog.every(a => a.r.semVelocidade === 'eu' || a.r.semVelocidade === 'ambos'))
  assert.deepEqual(semSog.map(a => [a.name, a.classe]), [['ALARMADO', 'perigo'], ['PERTO', 'atencao'], ['LONGE', 'desconhecido']])
  // sem o alarme, o mesmo alvo vai para o fim da lista como "desconhecido" (é o que o M-50 evita)
  const semAlarme = alvosAis({ vessels: [longe, perto, alarmado], eu: { position: P }, notificacoes: [], agora })
  assert.equal(semAlarme.at(-1).name, 'ALARMADO')
  assert.equal(semAlarme.at(-1).classe, 'desconhecido')
  // sem a nossa posição (r nulo), o alarmado continua à frente
  const semPos = alvosAis({ vessels: [longe, perto, alarmado], eu: {}, notificacoes, agora })
  assert.equal(semPos[0].name, 'ALARMADO')
  assert.equal(semPos[0].classe, 'perigo')
  // um alarme que já limpou (normal) ou de outro alvo não conta
  assert.equal(alvosAis({ vessels: [alarmado], eu: { position: P }, notificacoes: [alarme('9', 'normal')], agora })[0].classe, 'desconhecido')
  assert.equal(alvosAis({ vessels: [alarmado], eu: { position: P }, notificacoes: [alarme('10')], agora })[0].classe, 'desconhecido')
  // com emPorto, o alarme do plugin manda (se o plugin alarma é porque se mexe)
  assert.equal(alvosAis({ vessels: [alarmado], eu: { position: P, sog: 0 }, notificacoes, agora, emPorto: true })[0].classe, 'perigo')
})

// ---------- a velocidade em falta, em texto ----------
test('sem velocidade o ecrã diz de quem é: "sem rumo do alvo", "sem o nosso rumo", "sem rumo de nenhum dos dois" — na Carta, na tabela da AIS e no detalhe', () => {
  assert.equal(semRumoTexto('alvo'), 'sem rumo do alvo')
  assert.equal(semRumoTexto('eu'), 'sem o nosso rumo')
  assert.equal(semRumoTexto('ambos'), 'sem rumo de nenhum dos dois')
  assert.equal(semRumoTexto('outro'), 'sem rumo')
  const eu = { position: P, cog: 0, sog: 5 * NO }
  const vessels = [alvo('1', 'SEM COG A 6 NOS', 0.4, 10, { sog: 6 * NO }), alvo('2', 'NORMAL', 1, 0, { sog: 10 * NO, cog: Math.PI })]
  const comEu = alvosAis({ vessels, eu, notificacoes: [], agora })
  const linha = (nome, alvos) => texto(linhaAlvo(alvos.find(a => a.name === nome)))
  assert.equal(linha('SEM COG A 6 NOS', comEu), 'SEM COG A 6 NOS 0,4 MN · sem rumo do alvo')
  const semEu = alvosAis({ vessels, eu: { position: P }, notificacoes: [], agora })
  assert.equal(linha('NORMAL', semEu), 'NORMAL 1,0 MN · sem o nosso rumo')
  const ambos = alvosAis({ vessels: [alvo('3', 'NADA', 0.3, 350)], eu: { position: P }, notificacoes: [], agora })
  assert.equal(ambos[0].r.semVelocidade, 'ambos')
  assert.equal(linha('NADA', ambos), 'NADA 0,3 MN · sem rumo de nenhum dos dois')
  // a tabela e o detalhe (o alvo escolhido)
  const html = ais.render({ alvos: comEu, estado: { sel: '1' }, notificacoes: [] })
  const celulas = /<tr data-mmsi="1"[^>]*>([\s\S]*?)<\/tr>/.exec(html)[1].replace(/\n/g, '')
  assert.match(celulas, /<td colspan="2" class="lab">sem rumo do alvo<\/td>/)
  assert.match(html, /CPA · TCPA<\/div><div class="v">sem rumo do alvo</)
  const h2 = ais.render({ alvos: semEu, estado: { sel: '2' }, notificacoes: [] })
  assert.match(h2, /<td colspan="2" class="lab">sem o nosso rumo<\/td>/)
  assert.match(h2, /CPA · TCPA<\/div><div class="v">sem o nosso rumo</)
  assert.match(h2, /Sem o nosso rumo \(COG\/SOG do GPS\): só a distância de cada alvo, sem CPA nem TCPA/)
  const h3 = ais.render({ alvos: ambos, estado: { sel: '3' }, notificacoes: [] })
  assert.match(h3, /<td colspan="2" class="lab">sem rumo de nenhum dos dois<\/td>/)
  assert.doesNotMatch(html + h2 + h3, proibido)
  assert.doesNotMatch(html + h2 + h3, /só distância/, 'a frase única de antes saiu')
})

// ---------- tcpa Infinity ----------
test('tcpa Infinity (lado a lado, ou os dois parados): "—" no TCPA, o CPA é a distância; nunca "Infinity" nem "perigo"; perto fica "atenção" só enquanto estiver a menos de 0,5 MN, longe "seguro"', () => {
  const eu = { position: P, cog: 0, sog: 5 * NO }
  const lado = alvo('1', 'LADO A LADO', 0.3, 90, { sog: 5 * NO, cog: 0 })
  const ladoLonge = alvo('2', 'LADO A LADO LONGE', 2, 90, { sog: 5 * NO, cog: 0 })
  const dois = [alvo('3', 'PARADO PERTO', 0.2, 45, { sog: 0 })]
  const r = cpa(eu, lado)
  assert.equal(r.tcpa, Infinity)
  assert.equal(leituraCpa(r).tipo, 'paralelo')
  const alvos = alvosAis({ vessels: [lado, ladoLonge], eu, notificacoes: [], agora })
  const c = Object.fromEntries(alvos.map(a => [a.name, a.classe]))
  assert.deepEqual(c, { 'LADO A LADO': 'atencao', 'LADO A LADO LONGE': 'seguro' })
  assert.equal(texto(linhaAlvo(alvos.find(a => a.name === 'LADO A LADO'))), 'LADO A LADO 0,3 MN · —')
  const html = ais.render({ alvos, estado: { sel: '1' }, notificacoes: [] })
  assert.match(/<tr data-mmsi="1"[^>]*>([\s\S]*?)<\/tr>/.exec(html)[1].replace(/<[^>]+>/g, '|').replace(/\n/g, '').replace(/\|+/g, '|'), /\|0,3 MN\|—\|/)
  assert.match(html, /CPA · TCPA<\/div><div class="v">0,30 MN · —</)
  assert.doesNotMatch(html, proibido)
  // os dois parados (a amarrar ao lado de um parado): atenção, nunca perigo, também em porto
  const parados = alvosAis({ vessels: dois, eu: { position: P, sog: 0 }, notificacoes: [], agora })
  assert.equal(parados[0].r.tcpa, Infinity)
  assert.equal(parados[0].classe, 'atencao')
  assert.equal(alvosAis({ vessels: dois, eu: { position: P, sog: 0 }, notificacoes: [], agora, emPorto: true })[0].classe, 'atencao')
  // a Carta mostra o mesmo
  const cartaHtml = carta.render({ v: () => undefined, idade: () => 0, alvos, notificacoes: [], polar: null, demo: false, estado: {} })
  assert.match(texto(cartaHtml), /LADO A LADO 0,3 MN · —/)
})
