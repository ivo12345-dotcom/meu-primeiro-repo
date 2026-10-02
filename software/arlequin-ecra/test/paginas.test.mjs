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
import diario, { gravarNoDiario } from '../public/paginas/diario.js'
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
  // auditoria K-11/I-32: sem resposta (sem código) não se mostra o erro técnico; com o motivo do plugin, o motivo
  const falha = { ...contexto(st, {}), pedir: async () => { throw new Error('Failed to fetch') } }
  await velas.acao('grande', { valor: '1' }, falha)
  assert.equal(falha.estado.msg, 'Velas não gravadas: a caixa negra não responde')
  const parada = { ...contexto(st, {}), pedir: async () => { throw Object.assign(new Error('a caixa negra não está a gravar (disco cheio)'), { status: 503 }) } }
  await velas.acao('grande', { valor: '1' }, parada)
  assert.equal(parada.estado.msg, 'Velas não gravadas: a caixa negra não está a gravar (disco cheio)')
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
      velocidade: { versao: 'v0003', versoes: ['v0001', 'v0003'], podeVoltar: true, horas: 12.5, frases: ['a 60° com 12 nós andas 5,6 nós (a polar dizia 6,2)'] },
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
  assert.doesNotMatch(htmlComErro, /data-modelo="consumo"/)
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

test('Diário: "Voltar atrás" só quando o plugin diz podeVoltar', () => {
  const store = criarStore()
  const modelo = (podeVoltar) => ({ versao: 'v0002', versoes: ['v0001', 'v0002'], podeVoltar, horas: 6, frases: [] })
  const html = (podeVoltar) => diario.render(contexto(store, { ia: { modelos: { velocidade: modelo(podeVoltar) } }, iaEm: Date.now() }))
  assert.doesNotMatch(html(false), /data-acao="ia-voltar"/) // a v0001 nunca esteve em uso
  assert.match(html(true), /data-acao="ia-voltar" data-modelo="velocidade"/)
})

test('Diário: o cartão da AI mostra o estado do arquivo da previsão', () => {
  const store = criarStore()
  const okEm = new Date(2026, 8, 30, 9, 5).getTime()
  const html = (previsao) => diario.render(contexto(store, { ia: { modelos: {}, previsao }, iaEm: Date.now() }))
  assert.match(html({ okEm, tentativaEm: null, erro: null }), /previsão: última 09:05/)
  assert.match(html({ okEm, tentativaEm: okEm, erro: 'fetch failed' }), /previsão: sem rede \(fetch failed\) · última 09:05/)
  assert.match(html({ okEm: null, tentativaEm: okEm, erro: '<b>' }), /previsão: sem rede \(&lt;b&gt;\)/)
  assert.match(html({ okEm: null, tentativaEm: null, erro: null }), /previsão: ainda nenhuma/)
})

test('Diário: cartão da AI mostra mensagem do plugin quando rejeita com HTTP status', async () => {
  const estado = {}
  const ctx = {
    ...contexto(store, estado),
    pedir: async (url) => {
      if (url.includes('/ia')) {
        const err = new Error('a AI não está ligada')
        err.status = 503
        throw err
      }
      return new Promise(() => {}) // never resolves for logbook
    },
    refrescar: () => {}
  }
  diario.aoEntrar(ctx)
  await new Promise(r => setTimeout(r, 10))
  const html = diario.render(ctx)
  assert.match(html, /AI: a AI não está ligada/)
})

// ---------- auditoria K-04: o texto que vem de fora (rádio AIS, plugins, OpenCPN) passa sempre pelo esc ----------
const MAU = '<i id=x>"&'
const semCru = (html, nome) => {
  assert.ok(!html.includes('<!--'), `${nome}: um comentário HTML cru`)
  assert.ok(!html.includes('<i id=x>'), `${nome}: <i id=x> cru`)
}

test('auditoria K-04: um navio chamado "<!--" não esconde os alvos seguintes (AIS e Carta, com os blocos Motor e Gasóleo)', () => {
  const alvo = (mmsi, name, distancia, classe) => ({ mmsi, name, tipo: MAU, sog: 6, cog: 1, r: { cpa: 100, tcpa: 300, distancia, marcacao: 0.5 }, classe })
  const ctx = { ...contexto(store), alvos: [alvo('111', '<!--', 900, 'perigo'), alvo('222', 'PERIGO REAL', 1200, 'perigo')] }
  const a = ais.render(ctx)
  semCru(a, 'AIS')
  assert.match(a, /&lt;!--/)
  assert.match(a, /PERIGO REAL/)
  const c = carta.render(ctx)
  semCru(c, 'Carta')
  assert.match(c, /PERIGO REAL/)
  assert.ok(c.indexOf('PERIGO REAL') < c.indexOf('Motor') && c.indexOf('Motor') < c.indexOf('Gasóleo'), 'os blocos Motor e Gasóleo continuam depois')
  // o detalhe do alvo (nome, MMSI, tipo) e o id da notificação também
  const sel = { ...ctx, estado: { sel: '111' }, notificacoes: [{ caminho: 'notifications.arlequin.ais.111', id: '<b>', state: 'alarm', method: ['visual', 'sound'], status: {} }] }
  const d = ais.render(sel)
  semCru(d, 'AIS detalhe')
  assert.doesNotMatch(d, /data-id="<b>"/)
})

test('auditoria K-04: Motor, Viagem, Carta, Velas e Diário escapam as mensagens dos plugins, os nomes dos depósitos e do WP e os erros', async () => {
  const st = storeSimulado(1)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'navigation.course.nextPoint', value: { name: MAU } },
    { path: 'navigation.course.calcValues.distance', value: 1852 },
    { path: 'tanks.freshWater.0.name', value: MAU }, { path: 'tanks.freshWater.0.currentVolume', value: 0.04 }, { path: 'tanks.freshWater.0.currentLevel', value: 0.5 },
    { path: 'notifications.propulsion.main.overTemperature', value: { state: 'alarm', method: ['visual', 'sound'], message: `Motor ${MAU}` } }
  ] }] })
  const motorCtx = { ...contexto(st, { msgGas: MAU, msgGasErro: true, msgAgua: MAU, bombaCalib: 0, calibAberta: true, calib: { ativa: true, total: 5, pontos: [], pendente: null, razaoAtual: null }, msgCalib: MAU, agua: { tanques: [{ id: 0, nome: MAU }] } }) }
  semCru(motor.render(motorCtx), 'Motor')
  semCru(viagem.render(contexto(st)), 'Viagem')
  semCru(carta.render(contexto(st)), 'Carta')
  semCru(velas.render(contexto(st, { msg: MAU, msgErro: true })), 'Velas')
  const ia = { modelos: { velocidade: { versao: MAU, versoes: [], podeVoltar: false, horas: 1, frases: [MAU] } } }
  semCru(diario.render(contexto(st, { ia, iaEm: Date.now(), msg: MAU, msgErro: true })), 'Diário')
})

// ---------- auditoria K-11: a conta "read/write" do ecrã; os erros à vista e em pt-PT; o diário pelo plugin do ecrã ----------
const SEM_SESSAO = 'o SignalK recusou o pedido (sem sessão iniciada neste ecrã?): entra no SignalK e tenta outra vez'
const recusa = () => Object.assign(new Error(SEM_SESSAO), { status: 401 }) // como o pedir do signalk.js
const esperar = () => new Promise(resolve => setTimeout(resolve, 0))

test('auditoria K-11: com um 401, o Motor diz que o SignalK recusou (nunca "não responde" nem "401"), também no Abasteci, na calibração e no Enchi', async () => {
  const st = storeSimulado(1)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [{ path: 'tanks.freshWater.0.name', value: 'Cozinha (BB)' }, { path: 'tanks.freshWater.0.currentVolume', value: 0.04 }, { path: 'tanks.freshWater.0.currentLevel', value: 0.5 }] }] })
  const estado = {}
  const ctx = { ...contexto(st, estado), pedir: async () => { throw recusa() } }
  motor.aoEntrar(ctx)
  motor.render(ctx) // pede a água
  await esperar()
  let html = motor.render(ctx)
  assert.ok(html.includes(`Sonda do gasóleo: ${SEM_SESSAO}`), 'o estado do gasóleo')
  assert.ok(html.includes(`Últimas cargas pelo motor</div>\n<div class="lab">${SEM_SESSAO}`), 'as sessões de carga')
  assert.ok(html.includes(`Por regime: ${SEM_SESSAO}`), 'a curva do J1939')
  assert.doesNotMatch(html, /não responde|>401</)
  await motor.acao('abrir-teclado', { modo: 'abasteci' }, ctx)
  await motor.acao('tecla', { t: '8' }, ctx)
  await motor.acao('teclado-ok', {}, ctx)
  assert.equal(estado.msgGas, `Não gravou: ${SEM_SESSAO}`)
  await motor.acao('calib-abrir', {}, ctx)
  await motor.acao('calib-iniciar', {}, ctx)
  assert.equal(estado.msgCalib, SEM_SESSAO)
  // o "Enchi" que falha aparece no mosaico da água (antes só dentro da calibração da bomba)
  estado.calibAberta = false
  estado.msgAgua = null
  await motor.acao('agua-calib', { id: '0' }, ctx)
  await motor.acao('bomba-cancelar', {}, ctx)
  html = motor.render(ctx)
  assert.ok(html.includes(SEM_SESSAO), 'o erro da água à vista')
})

test('auditoria K-11: com um 401, a Velas e o Diário dizem que o SignalK recusou (nunca "o signalk-logbook está ligado?")', async () => {
  const v = { ...contexto(store, {}), pedir: async () => { throw recusa() }, logbook: async () => { throw recusa() } }
  await velas.acao('grande', { valor: '1' }, v)
  assert.equal(v.estado.msg, `Velas não gravadas: ${SEM_SESSAO}`)
  await velas.acao('comecar', {}, v)
  assert.equal(v.estado.msg, `Diário não gravou: ${SEM_SESSAO}`)
  const d = { ...contexto(store, {}), pedir: async () => { throw recusa() }, logbook: async () => { throw recusa() } }
  diario.aoEntrar(d)
  await esperar()
  const html = diario.render(d)
  assert.ok(html.includes(SEM_SESSAO), 'a leitura do diário')
  assert.ok(html.includes(`AI: ${SEM_SESSAO}`), 'o cartão da AI')
  await diario.acao('rapida', { texto: 'Rizei', cat: 'navigation' }, d)
  assert.equal(d.estado.msg, `Não gravou: ${SEM_SESSAO}`)
  assert.doesNotMatch(diario.render(d), /signalk-logbook está/)
})

test('contrato C3: o Diário lê o dia de Lisboa pelo plugin do ecrã (GET /plugins/arlequin-ecra/diario/AAAA-MM-DD) e grava por ele (POST { text, category })', async () => {
  const pedidos = []
  const entradas = [{ datetime: '2026-07-14T23:30:00.000Z', text: 'Largámos', category: 'navigation', origin: 'manual', author: 'ecra' }]
  const ctx = { ...contexto(store, {}), agora: Date.parse('2026-07-14T23:40:00Z'), pedir: async (url, o = {}) => { pedidos.push([o.method || 'GET', url, o.body]); return url.includes('/arlequin-ecra/diario/') ? { dia: '2026-07-15', entradas } : new Promise(() => {}) } }
  diario.aoEntrar(ctx)
  await esperar()
  // 23:40 UTC do dia 14 = 00:40 do dia 15 em Lisboa (verão)
  assert.ok(pedidos.some(([m, u]) => m === 'GET' && u === '/plugins/arlequin-ecra/diario/2026-07-15'), JSON.stringify(pedidos))
  assert.match(diario.render(ctx), /Largámos/)
  const enviados = []
  await gravarNoDiario(async (url, o) => { enviados.push([url, o]); return { ok: true } }, 'Rizei', 'navigation')
  assert.deepEqual(enviados, [['/plugins/arlequin-ecra/diario', { method: 'POST', body: { text: 'Rizei', category: 'navigation' } }]])
})

// ---------- auditoria I-10: confirmações dentro da página (o confirm() do browser parava o ciclo e o apito) ----------
test('auditoria I-10: nenhuma página nem o app.js usa o confirm()/alert()/prompt() do browser', async () => {
  const { readdirSync } = await import('node:fs')
  const pasta = new URL('../public/', import.meta.url)
  const ficheiros = ['app.js', ...readdirSync(new URL('paginas/', pasta)).filter(f => f.endsWith('.js')).map(f => `paginas/${f}`), ...readdirSync(new URL('paginas/melhor/', pasta)).map(f => `paginas/melhor/${f}`)]
  for (const f of ficheiros) {
    const linhas = readFileSync(new URL(f, pasta), 'utf8').split('\n').filter(l => /\b(confirm|alert|prompt)\s*\(/.test(l))
    assert.deepEqual(linhas, [], f)
  }
})

test('auditoria I-10: "Enchi" pergunta na própria página e só grava com o "Sim"', async () => {
  const st = storeSimulado(1)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [{ path: 'tanks.freshWater.0.name', value: 'Cozinha (BB)' }, { path: 'tanks.freshWater.0.currentVolume', value: 0.04 }, { path: 'tanks.freshWater.0.currentLevel', value: 0.5 }] }] })
  const pedidos = []
  const ctx = { ...contexto(st, {}), pedir: async (url, o = {}) => { if (o.method === 'POST') pedidos.push([url, o.body]); return { ok: true, tanques: [] } } }
  await motor.acao('agua-encher', { id: '0' }, ctx)
  assert.deepEqual(pedidos, [], 'nada sem confirmar')
  let html = motor.render(ctx)
  assert.match(html, /Encheste o depósito Cozinha \(BB\)\?/)
  assert.match(html, /data-acao="agua-encher-sim"/)
  await motor.acao('agua-encher-nao', {}, ctx)
  assert.doesNotMatch(motor.render(ctx), /agua-encher-sim/)
  await motor.acao('agua-encher', { id: '0' }, ctx)
  await motor.acao('agua-encher-sim', {}, ctx)
  assert.deepEqual(pedidos, [['/plugins/signalk-arlequin-agua/encher', { id: 0 }]])
  html = motor.render(ctx)
  assert.doesNotMatch(html, /agua-encher-sim/)
})

test('auditoria I-10: "Cancelar" a calibração do gasóleo pergunta na própria página e só cancela com o "Sim"', async () => {
  const pedidos = []
  const estado = { calibAberta: true, calib: { ativa: true, total: 5, pontos: [], pendente: null, razaoAtual: 0.2 } }
  const ctx = { ...contexto(store, estado), pedir: async (url, o = {}) => { if (o.method === 'POST') pedidos.push(url); return estado.calib } }
  await motor.acao('calib-cancelar', {}, ctx)
  assert.deepEqual(pedidos, [])
  assert.match(motor.render(ctx), /Cancelar a calibração\? Fica a tabela antiga\./)
  await motor.acao('calib-cancelar-nao', {}, ctx)
  assert.equal(estado.calibAberta, true)
  await motor.acao('calib-cancelar', {}, ctx)
  await motor.acao('calib-cancelar-sim', {}, ctx)
  assert.deepEqual(pedidos, ['/plugins/signalk-arlequin-gasoleo/calibracao/cancelar'])
  assert.equal(estado.calibAberta, false)
})

test('auditoria I-10: "Nova viagem" pergunta na própria página e só apaga o resumo com o "Sim"', async () => {
  let novas = 0
  const ctx = { ...contexto(store, {}), novaViagem: () => { novas++ } }
  await viagem.acao('nova', {}, ctx)
  assert.equal(novas, 0)
  assert.match(viagem.render(ctx), /Começar uma viagem nova\? O resumo atual é apagado\./)
  await viagem.acao('nova-nao', {}, ctx)
  assert.doesNotMatch(viagem.render(ctx), /nova-sim/)
  await viagem.acao('nova', {}, ctx)
  await viagem.acao('nova-sim', {}, ctx)
  assert.equal(novas, 1)
  assert.doesNotMatch(viagem.render(ctx), /nova-sim/)
})

// ---------- auditoria I-11: a proa verdadeira, ou a magnética + a declinação (as bússolas do barco são magnéticas) ----------
test('auditoria I-11: sem headingTrue, a proa é a magnética + a declinação, com "(mag.)" à vista (Carta, Instr., Leme e Recolher velas); sem a declinação, "—"', async () => {
  const GRAU = Math.PI / 180
  // proa magnética 100°, declinação 2° W (−2°): verdadeira 098°; o rumo ao WP 090°, vento real de 270°
  const base = { 'navigation.position': { latitude: 39.35, longitude: -9.38 }, 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 90 * GRAU, 'environment.wind.directionTrue': 270 * GRAU, 'environment.wind.speedTrue': 5 }
  const com = (extra) => {
    const valores = { ...base, ...extra }
    return { ...contexto(store, {}), v: (p) => valores[p], alvos: [], notificacoes: [] }
  }
  const mag = com({ 'navigation.headingMagnetic': 100 * GRAU, 'navigation.magneticVariation': -2 * GRAU })
  assert.match(carta.render(mag), /Proa \(mag\.\)<\/div><div class="v">098°/)
  assert.match(instr.render(mag), /Proa \(mag\.\) · fundo<\/div><div class="vv">098°/)
  const leme = melhor.render({ ...mag, estado: {}, pedir: () => new Promise(() => {}) })
  assert.match(leme, /◀ 8° BB/, 'a correção ao leme (098° → 090°)')
  assert.match(leme, /proa atual 098° \(mag\.\)/)
  const estado = { passo: 1 }
  const v = velas.render({ ...mag, estado })
  assert.match(v, /proa 098° \(mag\.\)/)
  // com a verdadeira, ela manda (sem "(mag.)")
  const verdadeira = com({ 'navigation.headingTrue': 95 * GRAU, 'navigation.headingMagnetic': 100 * GRAU, 'navigation.magneticVariation': -2 * GRAU })
  assert.match(carta.render(verdadeira), /Proa<\/div><div class="v">095°/)
  // sem a declinação não se inventa: "—"
  const semDecl = com({ 'navigation.headingMagnetic': 100 * GRAU })
  assert.match(carta.render(semDecl), /Proa<\/div><div class="v">—/)
  assert.match(melhor.render({ ...semDecl, estado: {}, pedir: () => new Promise(() => {}) }), /proa atual —/)
  // o "Estou aproado" do Recolher velas grava no diário a proa que se mostra
  const gravados = []
  await velas.acao('aproado', {}, { ...mag, estado: { passo: 1 }, logbook: async (t) => { gravados.push(t) } })
  assert.deepEqual(gravados, ['Aproado ao vento (098° (mag.))'])
})

// ---------- auditoria I-23: rotação desconhecida não é "desligado" ----------
test('auditoria I-23: o motor tem três estados — a trabalhar, desligado e "sem leitura do motor" (cinzento) quando as rotações são desconhecidas', async () => {
  const { motorLigado, motorResumo } = await import('../public/paginas/comum.js')
  assert.equal(motorLigado(30), true)
  assert.equal(motorLigado(0), false)
  assert.equal(motorLigado(5), false)
  for (const x of [null, undefined, NaN, 'x']) assert.equal(motorLigado(x), null, String(x))
  const com = (rpm) => ({ ...contexto(store, {}), v: (p) => (p === 'propulsion.main.revolutions' ? rpm : undefined) })
  assert.match(motorResumo(com(null)).estado, /<span class="lab">sem leitura do motor<\/span>/)
  assert.match(motorResumo(com(0)).estado, /<span class="ok">desligado<\/span>/)
  assert.match(motorResumo(com(30)).estado, /a trabalhar · 1800 rpm/)
  const m = motor.render(com(null))
  assert.match(m, /Volvo Penta D1-20B<\/span><span class="lab">sem leitura do motor<\/span>/)
  assert.doesNotMatch(m, /class="ok">desligado/)
  assert.match(carta.render(com(null)), /sem leitura do motor/)
})

test('auditoria I-23: no resumo da viagem, sem leitura do motor não conta nem para a vela nem para o motor (fica à parte, à vista)', async () => {
  const { novaViagem, acumular } = await import('../public/lib/viagem.js')
  const NO = 1852 / 3600
  let v = novaViagem(0)
  for (let s = 1; s <= 5400; s++) v = acumular(v, { t: s * 1000, sog: 5 * NO, motor: null, fuelRate: 1 / 3600 / 1000 })
  assert.equal(v.tempoVela, 0)
  assert.equal(v.tempoMotor, 0)
  assert.equal(v.gasoleoL, 0)
  assert.ok(Math.abs(v.tempoSemLeitura - 5399) < 2)
  assert.ok(v.distancia > 13000, 'a distância conta')
  const html = viagem.render({ ...contexto(store, {}), viagem: { ...v, ultimo: 5400e3 } })
  assert.match(html, /À vela<\/div><div class="vv">0 min<\/div><div class="lab">\+ 1 h 30 sem leitura do motor<\/div>/)
  // o app.js manda os três estados (antes: rpm em falta = 0 = desligado = vela)
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.match(app, /motor:\s*motorLigado\(v\('propulsion\.main\.revolutions'\)\)/)
})

test('Diário: cartão da AI mostra mensagem genérica para erro sem status', async () => {
  const estado = {}
  const ctx = {
    ...contexto(store, estado),
    pedir: async (url) => {
      if (url.includes('/ia')) {
        throw new Error('a AI não está ligada')
      }
      return new Promise(() => {}) // never resolves for logbook
    },
    refrescar: () => {}
  }
  diario.aoEntrar(ctx)
  await new Promise(r => setTimeout(r, 10))
  const html = diario.render(ctx)
  assert.match(html, /AI: a AI não responde \(o plugin signalk-arlequin-ia está ligado\?\)/)
})
