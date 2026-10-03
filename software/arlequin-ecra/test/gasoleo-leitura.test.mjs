// O gasóleo no ecrã (F3b, itens 6 e 7; revisão F6b, secção 8):
//   - sem a sonda e sem leitura do motor o plugin do gasóleo deixa de publicar o nível (a hora dele na árvore
//     envelhece): o ecrã olha para a idade de tanks.fuel.0.currentLevel e diz "sem leitura (último N L, há X min)"
//     em vez dos litros como atuais;
//   - POST /calibrar e /abastecimento com a sonda perdida dão 503 com o motivo em pt-PT: o ecrã mostra-o;
//   - CONSUMO_CRUZEIRO: 1,45 L/h (2100 rpm), como a rota e o simulador (antes 0,9 L/h).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gasoleo, corGasoleo, tileGasoleo, CONSUMO_CRUZEIRO, NIVEL_GASOLEO_VELHO_MS } from '../public/paginas/comum.js'
import motor from '../public/paginas/motor.js'
import carta from '../public/paginas/carta.js'

const require = createRequire(import.meta.url)
const { litrosHora, RPM_CRUZEIRO } = require('../../signalk-arlequin-rota/lib/base.js')
const { litrosHora: litrosHoraJ1939 } = require('../../signalk-arlequin-j1939/lib/consumo.js')

const NIVEL = 'tanks.fuel.0.currentLevel'
const MIN = 60000
const AGORA = Date.parse('2026-10-03T12:00:00Z')
// o depósito de 200 L com 100 L, e a idade do nível
function ctx ({ idade = 0, nivel = 0.5, cap = 0.2, taxa, sog, extra = {} } = {}) {
  const valores = { [NIVEL]: nivel, 'tanks.fuel.0.capacity': cap, 'tanks.fuel.0.currentVolume': nivel * cap, ...(taxa !== undefined ? { 'propulsion.main.fuel.rate': taxa } : {}), ...(sog !== undefined ? { 'navigation.speedOverGround': sog } : {}) }
  return {
    v: (p) => valores[p],
    idade: (p) => (p === NIVEL ? idade : 0),
    agora: AGORA,
    notificacoes: [],
    alvos: [],
    estado: { gas: undefined },
    polar: null,
    baro: null,
    demo: false,
    pedir: () => new Promise(() => {}),
    refrescar: () => {},
    ...extra
  }
}
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const proibido = /undefined|NaN|null|\[object/

// ---------- item 7: o consumo de cruzeiro ----------
test('item 7: o consumo de cruzeiro é 1,45 L/h — o da rota (a 2100 rpm) e o do simulador/J1939 —, não 0,9 L/h', () => {
  const lh = CONSUMO_CRUZEIRO * 3600 * 1000
  assert.ok(Math.abs(lh - 1.45) < 1e-9, `${lh} L/h`)
  // o mesmo que a rota planeia (lib/base.js: a rotação de cruzeiro e a curva da Volvo) e o simulador cruza (J1939)
  assert.ok(Math.abs(lh - litrosHora(RPM_CRUZEIRO)) < 1e-9, 'igual ao da rota')
  assert.ok(Math.abs(lh - litrosHoraJ1939(RPM_CRUZEIRO)) < 1e-9, 'igual ao do J1939/simulador')
  // com 100 L e sem consumo em direto, a autonomia conta com ele: 100 / 1,45 = 69 h a 5,5 nós = 379 MN
  assert.match(gasoleo(ctx()).html, /^100 L de 200 · ~69 h · ~379 MN$/)
  // com o consumo em direto, o dele (3 L/h): 33 h
  assert.match(gasoleo(ctx({ taxa: 3 / 3600 / 1000, sog: 6 * 1852 / 3600 })).html, /^100 L de 200 · ~33 h · ~200 MN$/)
})

// ---------- item 6: a idade do nível ----------
test('item 6: com o nível fresco (até 2 min) o gasóleo mostra os litros como atuais; passados os 2 min diz "sem leitura (último N L, há X min)" e deixa de contar a autonomia', () => {
  assert.equal(NIVEL_GASOLEO_VELHO_MS, 2 * MIN)
  for (const idade of [0, 1000, 60 * 1000, 2 * MIN]) {
    const g = gasoleo(ctx({ idade }))
    assert.equal(g.litros, 100, `${idade} ms`)
    assert.match(g.html, /^100 L de 200 · ~69 h · ~379 MN$/)
    assert.equal(g.velho, undefined)
  }
  const g = gasoleo(ctx({ idade: 2 * MIN + 1000 }))
  assert.equal(texto(g.html), 'sem leitura (último 100 L, há 2 min)')
  assert.equal(g.litros, null, 'os litros velhos não passam por atuais (a cor, a barra, a reserva)')
  assert.equal(g.nivel, null)
  assert.deepEqual(g.velho, { litros: 100, idadeMs: 2 * MIN + 1000 })
  assert.doesNotMatch(g.html, /MN|~\d+ h/)
  assert.doesNotMatch(g.html, proibido)
  assert.match(g.html, /^<span class="atencao sem-leitura">/)
  // as idades como o resto do ecrã as diz (rota-texto.js idade): minutos, horas e minutos, dias
  const dizer = (idade) => texto(gasoleo(ctx({ idade })).html)
  assert.equal(dizer(12 * MIN), 'sem leitura (último 100 L, há 12 min)')
  assert.equal(dizer(5.5 * 60 * MIN), 'sem leitura (último 100 L, há 5 h 30)')
  assert.equal(dizer(3 * 24 * 60 * MIN), 'sem leitura (último 100 L, há 3 dias)')
  // sem hora no valor (a idade é infinita): sem inventar quando foi
  assert.equal(dizer(Infinity), 'sem leitura (último 100 L)')
  // o último valor com decimais arredonda como os litros do resto do ecrã
  assert.equal(texto(gasoleo(ctx({ idade: 10 * MIN, nivel: 0.4125, cap: 0.2 })).html), 'sem leitura (último 83 L, há 10 min)')
  // sem o nível (nunca chegou) ou sem a capacidade, como antes
  assert.match(gasoleo(ctx({ nivel: null })).html, /sem dados do depósito/)
  assert.equal(gasoleo(ctx({ nivel: null })).velho, undefined)
  // um contexto sem idade (outras páginas, testes) conta como fresco
  const semIdade = { ...ctx(), idade: undefined }
  assert.equal(gasoleo(semIdade).litros, 100)
})

test('item 6: a barra e a cor do gasóleo — velho, cinzento e vazio (nunca o verde nem o vermelho da reserva dos litros antigos); fresco, como antes', () => {
  assert.equal(corGasoleo(gasoleo(ctx({ idade: 10 * MIN }))), 'var(--linha)')
  // um último valor na reserva (40 L) não fica vermelho "como atual": está velho
  assert.equal(corGasoleo(gasoleo(ctx({ idade: 10 * MIN, nivel: 0.2 }))), 'var(--linha)')
  assert.equal(corGasoleo(gasoleo(ctx({ nivel: 0.2 }))), 'var(--bb)')
  assert.equal(corGasoleo(gasoleo(ctx({ nivel: 0.5 }))), 'var(--verde)')
  const velho = tileGasoleo(ctx({ idade: 10 * MIN }))
  assert.match(velho, /width:0\.0%;background:var\(--linha\)/)
  assert.doesNotMatch(velho, /100 L de 200/)
  assert.match(texto(velho), /Gasóleo sem leitura \(último 100 L, há 10 min\)/)
  assert.match(tileGasoleo(ctx({ idade: 5 * 1000 })), /width:50\.0%;background:var\(--verde\)/)
})

test('item 6: a Carta e a página Motor dizem "sem leitura" e o último valor; a página Motor também no mosaico do gasóleo; nada de null/NaN', () => {
  const c = ctx({ idade: 7 * MIN })
  const hCarta = carta.render(c)
  assert.match(texto(hCarta), /Gasóleo sem leitura \(último 100 L, há 7 min\)/)
  assert.doesNotMatch(hCarta, /100 L de 200/)
  const hMotor = motor.render(c)
  assert.match(texto(hMotor), /Gasóleo sem leitura \(último 100 L, há 7 min\)/)
  assert.doesNotMatch(hMotor, /100 L de 200/)
  assert.doesNotMatch(hMotor, proibido)
  // fresco: os litros
  assert.match(texto(motor.render(ctx())), /Gasóleo 100 L de 200 · ~69 h · ~379 MN/)
})

// ---------- item 6: a sonda perdida no Abasteci e no Calibrar ----------
const SEM_SONDA = 'sem leitura da sonda do gasóleo (ADS1115, app I2C do OpenPlotter): não gravei nada; tenta outra vez quando a sonda voltar'
const erro503 = () => Object.assign(new Error(SEM_SONDA), { status: 503, corpo: { ok: false, erro: SEM_SONDA }, detalhe: `HTTP 503 ${JSON.stringify({ ok: false, erro: SEM_SONDA })}` })

for (const [modo, rota] of [['abasteci', 'abastecimento'], ['calibrar', 'calibrar']]) {
  test(`item 6: POST /${rota} com a sonda perdida (503 do plugin) — o ecrã mostra o motivo em pt-PT, em vermelho, e não grava nada (nem "Ainda a medir", nem "HTTP 503")`, async () => {
    const pedidos = []
    const c = ctx({ extra: { pedir: async (url, o = {}) => { pedidos.push([o.method || 'GET', url, o.body]); throw erro503() } } })
    c.estado.teclado = { modo, valor: '150' }
    await motor.acao('teclado-ok', {}, c)
    assert.deepEqual(pedidos, [['POST', `/plugins/signalk-arlequin-gasoleo/${rota}`, { litros: '150' }]])
    assert.equal(c.estado.msgGasErro, true)
    assert.equal(c.estado.msgGas, `Não gravou: ${SEM_SONDA}`)
    assert.equal(c.estado.teclado, null, 'o teclado fecha')
    const html = motor.render(c)
    assert.match(html, /<div class="perigo">Não gravou: sem leitura da sonda do gasóleo \(ADS1115, app I2C do OpenPlotter\): não gravei nada; tenta outra vez quando a sonda voltar<\/div>/)
    assert.doesNotMatch(texto(html), /Ainda a medir|HTTP 503|\b503\b|Abastecimento registado|Calibrado:/)
  })
}

test('item 6: o 409 (o nível ainda a medir) continua a dizer "Ainda a medir"; um 503 sem o motivo do plugin diz que o plugin não está ligado, nunca o código', async () => {
  const falha = (status, message = String(status)) => ctx({ extra: { pedir: async () => { throw Object.assign(new Error(message), { status }) } } })
  const c409 = falha(409, 'a sonda ainda está a mexer')
  c409.estado.teclado = { modo: 'calibrar', valor: '100' }
  await motor.acao('teclado-ok', {}, c409)
  assert.equal(c409.estado.msgGas, 'Ainda a medir: espera 3 min com o barco direito')
  const c503 = falha(503)
  c503.estado.teclado = { modo: 'abasteci', valor: '40' }
  await motor.acao('teclado-ok', {}, c503)
  assert.equal(c503.estado.msgGas, 'Não gravou: o plugin do gasóleo não está ligado')
})
