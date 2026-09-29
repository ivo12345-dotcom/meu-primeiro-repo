// Desenha as 9 páginas com 13 minutos de dados do simulador (sem browser),
// para apanhar erros e confirmar o que cada página mostra.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { criarStore, aplicarDelta } from '../public/signalk.js'
import { cpa, classificar } from '../public/lib/cpa.js'
import { lerPolar } from '../public/lib/polar.js'
import { novaViagem } from '../public/lib/viagem.js'
import carta from '../public/paginas/carta.js'
import instr from '../public/paginas/instr.js'
import ais from '../public/paginas/ais.js'
import motor from '../public/paginas/motor.js'
import viagem from '../public/paginas/viagem.js'
import diario from '../public/paginas/diario.js'
import melhor from '../public/paginas/melhor.js'
import velas from '../public/paginas/velas.js'

const require = createRequire(import.meta.url)
const { criarNavegacao, avancarNav } = require('../../arlequin-simulador/lib/navegacao.js')
const polar = lerPolar(readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8'))

function storeSimulado (segundos) {
  const store = criarStore()
  store.selfContext = 'vessels.urn:mrn:signalk:uuid:arlequin'
  let e = criarNavegacao({}, Date.now() - segundos * 1000)
  for (let s = 0; s < segundos; s++) {
    const r = avancarNav(e, 1000)
    e = r.estado
    for (const d of r.deltas) aplicarDelta(store, d)
  }
  aplicarDelta(store, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'notifications.arlequin.ais.263000001', value: { id: '11111111-1111-4111-8111-111111111111', state: 'alarm', method: ['visual', 'sound'], message: 'NORDIC STAR: CPA 0,1 MN daqui a 2 min', status: { silenced: false } } },
    { path: 'electrical.batteries.servico.capacity.stateOfCharge', value: 0.62 }
  ] }] })
  return store
}

function contexto (store, estado = {}) {
  const v = (p) => store.self.get(p)?.value
  const eu = { position: v('navigation.position'), cog: v('navigation.courseOverGroundTrue'), sog: v('navigation.speedOverGround') }
  const alvos = [...store.vessels.values()].map(a => { const r = cpa(eu, a); return { ...a, r, classe: classificar(r) } })
  return {
    v,
    idade: () => 0,
    store,
    polar,
    baro: { sentido: 'desce', hpa3h: -2.4 },
    viagem: { ...novaViagem(Date.now() - 3600e3), ultimo: Date.now(), distancia: 9260, tempoVela: 3000, tempoMotor: 600, gasoleoL: 0.2, ventoMax: 8, pressaoInicial: 101600, pressaoFinal: 101520 },
    alvos,
    notificacoes: [...store.notificacoes.values()],
    estado,
    demo: true,
    pedir: () => new Promise(() => {}),
    logbook: async () => {},
    refrescar: () => {}
  }
}

const store = storeSimulado(13 * 60)
const PAGS = { carta, instr, ais, motor, viagem, diario, melhor, velas }

for (const [nome, pag] of Object.entries(PAGS)) {
  test(`página ${nome} desenha-se sem erros`, () => {
    const html = pag.render(contexto(store))
    assert.ok(html.length > 200, `${nome} vazia`)
    assert.ok(!/undefined|NaN/.test(html), `${nome} tem undefined/NaN: ${html.match(/.{40}(undefined|NaN).{20}/)?.[0]}`)
  })
}

test('Carta mostra o vento, o WP e o NORDIC STAR como perigo', () => {
  const html = carta.render(contexto(store))
  assert.match(html, /Vento aparente/)
  assert.match(html, /WP\d/)
  assert.match(html, /NORDIC STAR/)
})

test('AIS: o NORDIC STAR vem primeiro; tocar mostra o botão de silenciar', () => {
  const ctx = contexto(store)
  const primeiro = ctx.alvos.sort((a, b) => (a.classe === 'perigo' ? -1 : 0) - (b.classe === 'perigo' ? -1 : 0))[0]
  assert.equal(primeiro.name, 'NORDIC STAR')
  const estado = { sel: '263000001' }
  const html = ais.render(contexto(store, estado))
  assert.match(html, /Silenciar alarme/)
})

test('Melhor rota dá um rumo a seguir e a correção ao leme', () => {
  const html = melhor.render(contexto(store))
  assert.match(html, /Rumo a seguir/)
  assert.match(html, /\d{3}°/)
})

test('Recolher velas: começar → pede motor; com motor → aproar com rumo do vento', async () => {
  const estado = {}
  await velas.acao('comecar', {}, contexto(store, estado))
  assert.equal(estado.passo, 0)
  const st = storeSimulado(1)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [{ path: 'propulsion.main.revolutions', value: 30 }] }] })
  const html = velas.render(contexto(st, estado))
  assert.equal(estado.passo, 1)
  assert.match(html, /Aproa ao vento: rumo/)
  assert.match(html, /020°/) // vento real de 020° no início
})

test('Melhor rota contra o vento: mostra os dois bordos e o rumo do bordo', () => {
  const store = criarStore()
  let e = criarNavegacao({ cicloVelaS: 1e9 }, Date.now() - 6 * 3600e3)
  let achou = false
  for (let s = 0; s < 6 * 3600 && !achou; s++) {
    const r = avancarNav(e, 1000)
    e = r.estado
    for (const d of r.deltas) aplicarDelta(store, d)
    const twa = Math.abs(((store.self.get('navigation.course.calcValues.bearingTrue').value - store.self.get('environment.wind.directionTrue').value) * 180 / Math.PI + 540) % 360 - 180)
    achou = s > 60 && twa < 40
  }
  assert.ok(achou, 'a simulação devia chegar a uma perna contra o vento')
  const html = melhor.render(contexto(store))
  assert.match(html, /WP contra o vento/)
  assert.match(html, /Amurado a EB: <b>\d{3}°<\/b>/)
})

test('Motor: teclado do "Abasteci" manda os litros ao plugin do gasóleo', async () => {
  const estado = {}
  const pedidos = []
  const ctx = { ...contexto(store, estado), pedir: async (url, o) => { pedidos.push({ url, o }); return { antes: 40, depois: 125 } } }
  await motor.acao('abrir-teclado', { modo: 'abasteci' }, ctx)
  assert.match(motor.render(ctx), /Quantos litros meteste/)
  for (const t of ['8', '5', ',', '5', '⌫']) await motor.acao('tecla', { t }, ctx)
  assert.equal(estado.teclado.valor, '85,')
  await motor.acao('teclado-ok', {}, ctx)
  const p = pedidos.find(x => x.url.includes('abastecimento'))
  assert.deepEqual(p.o.body, { litros: '85,' })
  assert.equal(estado.teclado, null)
  assert.match(estado.msgGas, /40 → 125 L/)
})

test('Motor: calibração completa — abrir, +5 L, estado a estabilizar', async () => {
  const estado = {}
  const pedidos = []
  let resposta = { ativa: false, tabela: [], capacidadeL: 200 }
  const ctx = { ...contexto(store, estado), pedir: async (url, o) => { pedidos.push({ url, o }); return resposta } }
  await motor.acao('calib-abrir', {}, ctx)
  estado.calib = resposta
  assert.match(motor.render(ctx), /Começar \(depósito vazio\)/)
  resposta = { ativa: true, total: 0, pontos: [], pendente: { litros: 0 }, razaoAtual: 0.12 }
  await motor.acao('calib-iniciar', {}, ctx)
  assert.match(motor.render(ctx), /a estabilizar/)
  resposta = { ativa: true, total: 5, pontos: [{ litros: 0, razao: 0.12 }], pendente: { litros: 5 }, razaoAtual: 0.2 }
  await motor.acao('calib-mais', { l: '5' }, ctx)
  assert.deepEqual(pedidos.at(-1).o.body, { litros: '5' })
  assert.ok(pedidos.at(-1).url.endsWith('/calibracao/adicionar'))
  assert.match(motor.render(ctx), /No depósito: 5 L/)
})

test('Motor: água doce com os dois depósitos, dias que faltam e "Calibrar bomba"', async () => {
  const st = storeSimulado(1)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'tanks.freshWater.0.name', value: 'Cozinha (BB)' }, { path: 'tanks.freshWater.0.currentVolume', value: 0.045 }, { path: 'tanks.freshWater.0.currentLevel', value: 0.56 },
    { path: 'tanks.freshWater.1.name', value: 'WC (EB)' }, { path: 'tanks.freshWater.1.currentVolume', value: 0.012 }, { path: 'tanks.freshWater.1.currentLevel', value: 0.15 }
  ] }] })
  const estadoAgua = { tanques: [{ id: 0, nome: 'Cozinha (BB)', ritmo: { litrosDia: 9, dias: 5 } }, { id: 1, nome: 'WC (EB)', ritmo: null, pedaladasCalibracao: 4 }] }
  const estado = { agua: estadoAgua }
  const pedidos = []
  const ctx = { ...contexto(st, estado), pedir: async (url, o) => { pedidos.push(url); return url.endsWith('/estado') ? estadoAgua : { ok: true } } }
  let html = motor.render(ctx)
  assert.match(html, /Cozinha \(BB\)/)
  assert.match(html, /45 L/)
  assert.match(html, /~5,0 dias/)
  await motor.acao('agua-calib', { id: '1' }, ctx)
  motor.render(ctx) // pede o estado
  await new Promise(r => setTimeout(r, 10))
  html = motor.render(ctx)
  assert.match(html, /Calibrar a bomba: WC \(EB\)/)
  assert.match(html, /4 <span/)
  assert.ok(pedidos.some(u => u.endsWith('calibrar-bomba/iniciar')))
})

test('Velas: estado atual marcado e os toques mandam para a caixa negra', async () => {
  const st = storeSimulado(60)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'sails.grande.rizos', value: 1 },
    { path: 'sails.genoa.percentagem', value: 70 }
  ] }] })
  const html = velas.render(contexto(st, {}))
  assert.match(html, /class="acao go" data-acao="grande" data-valor="1"/)
  assert.match(html, /class="acao go" data-acao="genoa" data-valor="70"/)
  assert.match(html, /class="acao" data-acao="grande" data-valor="-1">Arriada/)
  const pedidos = []
  const ctx = { ...contexto(st, {}), pedir: async (url, op) => { pedidos.push({ url, ...op }); return { ok: true } } }
  await velas.acao('grande', { valor: '2' }, ctx)
  await velas.acao('genoa', { valor: '0' }, ctx)
  assert.deepEqual(pedidos, [
    { url: '/plugins/signalk-arlequin-caixanegra/velas', method: 'POST', body: { grandeRizos: 2 } },
    { url: '/plugins/signalk-arlequin-caixanegra/velas', method: 'POST', body: { genoaPct: 0 } }
  ])
  const falha = { ...contexto(st, {}), pedir: async () => { throw new Error('caixa negra desligada') } }
  await velas.acao('grande', { valor: '1' }, falha)
  assert.match(falha.estado.msg, /Velas não gravadas \(caixa negra desligada\)/)
})

test('Diário: botão "Orcas" de um toque grava "Orcas avistadas"', async () => {
  const html = diario.render(contexto(store, {}))
  assert.match(html, /data-acao="rapida" data-texto="Orcas avistadas" data-cat="navigation">Orcas</)
  const gravados = []
  const ctx = { ...contexto(store, {}), logbook: async (texto, cat) => { gravados.push([texto, cat]) } }
  await diario.acao('rapida', { texto: 'Orcas avistadas', cat: 'navigation' }, ctx)
  assert.deepEqual(gravados, [['Orcas avistadas', 'navigation']])
  assert.equal(ctx.estado.msg, 'Gravado: Orcas avistadas')
})

test('Diário: cartão da AI mostra os modelos em uso e manda treinar e voltar atrás', async () => {
  const ia = {
    emTreino: false,
    ultimoTreino: { em: '2026-09-29T20:00:00Z', resultados: [{ aceite: true }, { aceite: false }] },
    modelos: {
      velocidade: { versao: 'v0003', versoes: ['v0001', 'v0003'], horas: 12.5, frases: ['a 60° com 12 nós andas 5,6 nós (a polar dizia 6,2)'] },
      ventoForca: { versao: null, versoes: [] },
      consumo: { versao: 'v0001', versoes: ['v0001'], horas: 6, frases: [] }
    }
  }
  const estado = { ia, iaEm: Date.now() }
  const html = diario.render(contexto(store, estado))
  assert.match(html, /v0003 · 12,5 h · a 60° com 12 nós andas 5,6 nós/)
  assert.match(html, /Vento<\/td><td>a aprender/)
  assert.match(html, /data-acao="ia-voltar" data-modelo="velocidade"/)
  assert.doesNotMatch(html, /data-modelo="consumo"/)
  assert.match(html, /1 de 2 modelos melhoraram/)
  const iaComErro = { ...ia, modelos: { ...ia.modelos, consumo: { versao: 'v0002', versoes: ['v0001', 'v0002'], erro: 'ficheiro estragado' } } }
  const htmlComErro = diario.render(contexto(store, { ia: iaComErro, iaEm: Date.now() }))
  assert.match(htmlComErro, /v0002 · não consegui ler o modelo: ficheiro estragado/)
  assert.doesNotMatch(htmlComErro, /NaN/)
  const pedidos = []
  const ctx = { ...contexto(store, estado), pedir: async (url, op) => { pedidos.push({ url, ...op }); return { ok: true, versao: 'v0001' } } }
  await diario.acao('ia-treinar', {}, ctx)
  await diario.acao('ia-voltar', { modelo: 'velocidade' }, ctx)
  assert.deepEqual(pedidos.filter(p => p.method === 'POST'), [
    { url: '/plugins/signalk-arlequin-ia/treinar', method: 'POST' },
    { url: '/plugins/signalk-arlequin-ia/voltar', method: 'POST', body: { modelo: 'velocidade' } }
  ])
  assert.equal(ctx.estado.msg, 'Velocidade voltou à v0001')
  const semIa = diario.render(contexto(store, { ia: { erro: 'a AI não responde (o plugin signalk-arlequin-ia está ligado?)' }, iaEm: Date.now() }))
  assert.match(semIa, /AI: a AI não responde/)
})
