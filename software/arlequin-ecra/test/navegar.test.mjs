// O Leme a navegar (desenho 3b-2): a faixa do plano ativo (próximo evento, atraso, chegada agora e a do
// plano, recursos, "à espera de sair", "sem GPS"), Recalcular, Terminar com confirmação e a caixa da
// rota mudada (Terminar / Continuar); o GET /plano-ativo de 10 em 10 s; o apito curto do lib/alarmes.js.
// Sem browser, como o melhor.test.mjs, de dia e de noite, sem null/NaN/undefined.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import melhor from '../public/paginas/melhor.js'
import { deveTocar, paginaDoAlarme } from '../public/lib/alarmes.js'
import { lerPolar } from '../public/lib/polar.js'

const AGORA = Date.parse('2026-09-29T14:32:00Z') // 15:32 em Lisboa
const MIN = 60000
const iso = (t) => new Date(t).toISOString()
const ROTA = '/plugins/signalk-arlequin-rota'
const polar = lerPolar(readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8'))
const DIRETA = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/resultado-direta.json.gz', import.meta.url))))
const proibido = /null|NaN|undefined|\[object/
const limpo = (html, nome) => assert.doesNotMatch(html, proibido, `${nome}: ${html.match(/.{60}(null|NaN|undefined).{20}/)?.[0]}`)
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ROTA_ATIVA = { 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 1, 'navigation.course.nextPoint': { name: 'WP3' }, 'navigation.headingTrue': 1, 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche' } }

// o GET /plano-ativo a navegar (Algés → Peniche)
const PLANO = {
  estado: 'a navegar',
  destino: { id: 'peniche', nome: 'Peniche', lat: 39.3522, lon: -9.376 },
  tripulacao: 'so',
  idCalculo: 'calc-1',
  indice: 0,
  alternativa: { id: 'x', nome: 'Agora, 5 MN, só motor' },
  partida: iso(AGORA - 3 * 3600000),
  saida: iso(AGORA - 3 * 3600000 + 20 * MIN),
  chegou: null,
  atrasoMin: 20,
  proximo: { texto: 'rizar', hora: iso(AGORA + 25 * MIN) },
  chegadaAgora: '2026-09-30T06:58:00.000Z',
  chegadaPlano: '2026-09-30T06:38:00.000Z',
  chegadaNoite: true,
  recursos: { gasoleoChegadaL: 34, bateriaChegadaPct: 70, semLeitura: false, aviso: 'Recursos: gasóleo à chegada ~34 L' },
  semGps: false,
  barometro: { semLeitura: false, quedaHpa: 1.2 },
  previsaoIdadeH: 2,
  avisos: [],
  envio: { contactos: ['Mãe'], alarme: '2026-09-30T08:38:00.000Z', alarmePlano: '2026-09-30T08:38:00.000Z' },
  filaContactos: [],
  enviadas: []
}

function contexto ({ valores = ROTA_ATIVA, respostas = {}, estado = {}, noite = false } = {}) {
  const pedidos = []
  const ctx = {
    v: (p) => ({ 'navigation.position': { latitude: 38.9, longitude: -9.6 }, ...valores })[p],
    idade: () => 0,
    polar,
    estado,
    noite,
    agora: AGORA,
    pedidos,
    agendar: () => {},
    guardado: (k, def) => def,
    guardar: () => {},
    refrescar: () => {},
    pedir: async (url, o = {}) => {
      const chave = `${o.method || 'GET'} ${url}`
      pedidos.push({ url, method: o.method || 'GET', body: o.body })
      let r = respostas[chave]
      if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0]
      if (typeof r === 'function') r = r(o.body)
      if (r instanceof Error) throw r
      if (r === undefined) throw Object.assign(new Error('404'), { status: 404 })
      return structuredClone(r)
    }
  }
  return ctx
}
const erroHttp = (status, msg) => Object.assign(new Error(msg), { status })
const esperar = () => new Promise(resolve => setTimeout(resolve, 0))
// o Leme depois do GET /plano-ativo
async function leme (plano, extra = {}) {
  const ctx = contexto({ ...extra, respostas: { [`GET ${ROTA}/plano-ativo`]: plano, ...(extra.respostas || {}) } })
  melhor.render(ctx)
  await esperar()
  return ctx
}

test('alarmes: apito "curto" pedido pelo plugin (a previsão com mais de 12 h é alarm) dá o apito curto, não o contínuo; sem sound ou silenciado, nada', () => {
  const n = (state, extra = {}) => ({ caminho: 'notifications.rota.previsao', state, method: ['visual', 'sound'], ...extra })
  assert.equal(deveTocar(n('alarm')), 'continuo')
  assert.equal(deveTocar(n('alarm', { apito: 'curto' })), 'curto')
  assert.equal(deveTocar(n('warn', { apito: 'curto' })), 'curto')
  assert.equal(deveTocar(n('alarm', { apito: 'curto', method: ['visual'] })), null)
  assert.equal(deveTocar(n('alarm', { apito: 'curto', status: { silenced: true } })), null)
  assert.equal(deveTocar(n('normal', { apito: 'curto' })), null)
  // os avisos da rota levam ao Leme (página Melhor rota)
  assert.equal(paginaDoAlarme('notifications.rota.recalcula'), 'melhor')
  assert.equal(paginaDoAlarme('notifications.rota.lembrete.e3'), 'melhor')
})

test('a faixa: próximo evento com a hora e a contagem, o atraso sobre o plano, a chegada agora contra a do plano e os recursos; de dia e de noite sem null/NaN', async () => {
  for (const noite of [false, true]) {
    const ctx = await leme(PLANO, { noite })
    const html = melhor.render(ctx)
    limpo(html, `faixa ${noite ? 'noite' : 'dia'}`)
    const t = texto(html)
    assert.match(t, /próximo: rizar às 15:57 \(daqui a 25 min\) · \+20 min sobre o plano/)
    assert.match(t, /chegada ~amanhã 07:58 \(plano 07:38\) · de noite/)
    assert.match(t, /recursos: gasóleo à chegada ~34 L/)
    assert.match(html, /data-acao="rota-recalcular"[^>]*>Recalcular</)
    assert.match(html, /data-acao="rota-terminar"[^>]*>Terminar</)
    // por cima do rumo
    assert.ok(html.indexOf('próximo:') < html.indexOf('Rumo a seguir'))
    assert.doesNotMatch(t, /sem GPS|sem leitura|à espera de sair/)
  }
})

test('a faixa: adiantado, sem atraso, mais de 1 h até ao próximo, sem recursos a avisar e sem próximo evento', async () => {
  const p = { ...PLANO, atrasoMin: -12, proximo: { texto: 'pôr do sol', hora: iso(AGORA + 95 * MIN) }, recursos: { gasoleoChegadaL: 80, bateriaChegadaPct: 90, semLeitura: false, aviso: null } }
  let t = texto(melhor.render(await leme(p)))
  assert.match(t, /próximo: pôr do sol às 17:07 \(daqui a 1 h 35 min\) · −12 min sobre o plano/)
  assert.doesNotMatch(t, /recursos:/)
  t = texto(melhor.render(await leme({ ...PLANO, atrasoMin: 0, proximo: null })))
  assert.match(t, /no horário do plano/)
  assert.doesNotMatch(t, /próximo:/)
  limpo(melhor.render(await leme({ ...PLANO, atrasoMin: null, proximo: null, chegadaNoite: null })), 'sem atraso')
})

test('a faixa: "plano ativo · à espera de sair"; "sem GPS: acompanhamento parado"; "recursos: sem leitura"; "barómetro: sem leitura"', async () => {
  let t = texto(melhor.render(await leme({ ...PLANO, estado: 'a espera de sair', saida: null, atrasoMin: null })))
  assert.match(t, /plano ativo · à espera de sair/)
  assert.doesNotMatch(t, /sobre o plano/)
  const sem = { ...PLANO, semGps: true, recursos: { gasoleoChegadaL: null, bateriaChegadaPct: null, semLeitura: true, aviso: null }, barometro: { semLeitura: true, quedaHpa: null } }
  for (const noite of [false, true]) {
    const html = melhor.render(await leme(sem, { noite }))
    limpo(html, 'sem leituras')
    t = texto(html)
    assert.match(t, /sem GPS: acompanhamento parado/)
    assert.match(t, /recursos: sem leitura/)
    assert.match(t, /barómetro: sem leitura/)
  }
})

test('sem plano ativo (404) ou com o plano fechado (chegado, terminado): o Leme sem faixa nem botões do plano', async () => {
  for (const plano of [undefined, { ...PLANO, estado: 'chegado', chegou: iso(AGORA) }, { ...PLANO, estado: 'terminado' }]) {
    const html = melhor.render(await leme(plano))
    assert.match(html, /Rumo a seguir/)
    assert.doesNotMatch(html, /rota-recalcular|rota-terminar|próximo:/)
    limpo(html, 'sem plano')
  }
})

test('GET /plano-ativo de 10 em 10 s (o render é de 1 em 1 s)', async () => {
  const ctx = await leme(PLANO)
  const gets = () => ctx.pedidos.filter(p => p.url === `${ROTA}/plano-ativo`).length
  assert.equal(gets(), 1)
  for (let s = 1; s < 10; s++) { ctx.agora = AGORA + s * 1000; melhor.render(ctx) }
  assert.equal(gets(), 1)
  ctx.agora = AGORA + 10000
  melhor.render(ctx)
  assert.equal(gets(), 2)
  await esperar()
  // ao entrar na página, logo
  melhor.aoEntrar(ctx)
  assert.equal(gets(), 3)
})

test('Terminar com confirmação: "Terminar o plano? Os contactos em terra recebem \'viagem terminada, estou bem\'"; Não volta atrás; Sim faz o POST e lê o plano outra vez', async () => {
  const ctx = await leme(PLANO, { respostas: { [`POST ${ROTA}/plano-ativo/terminar`]: { ok: true, estado: 'terminado', contactos: true } } })
  await melhor.acao('rota-terminar', {}, ctx)
  let html = melhor.render(ctx)
  assert.match(texto(html), /Terminar o plano\? Os contactos em terra recebem 'viagem terminada, estou bem'/)
  assert.match(html, /data-acao="rota-terminar-sim"/)
  assert.match(html, /data-acao="rota-terminar-nao"/)
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 0, 'nada antes de confirmar')
  await melhor.acao('rota-terminar-nao', {}, ctx)
  assert.doesNotMatch(melhor.render(ctx), /rota-terminar-sim/)
  await melhor.acao('rota-terminar', {}, ctx)
  await melhor.acao('rota-terminar-sim', {}, ctx)
  assert.deepEqual(ctx.pedidos.filter(p => p.method === 'POST').map(p => p.url), [`${ROTA}/plano-ativo/terminar`])
  html = melhor.render(ctx)
  assert.match(texto(html), /Plano terminado: os contactos em terra recebem 'viagem terminada, estou bem'/)
  assert.equal(ctx.pedidos.filter(p => p.url === `${ROTA}/plano-ativo`).length, 2, 'lê o plano outra vez')
  limpo(html, 'terminado')
  // o erro do plugin aparece
  const falha = await leme(PLANO, { respostas: { [`POST ${ROTA}/plano-ativo/terminar`]: erroHttp(409, 'não há um plano ativo aberto') } })
  await melhor.acao('rota-terminar', {}, falha)
  await melhor.acao('rota-terminar-sim', {}, falha)
  assert.match(melhor.render(falha), /não há um plano ativo aberto/)
})

test('Recalcular: um cálculo novo de onde estás para o mesmo destino e tripulação → A calcular → Resultado, onde Ativar substitui o plano (o 422 de um cálculo antigo aparece e o plano fica)', async () => {
  const ctx = await leme(PLANO, {
    respostas: {
      [`POST ${ROTA}/calcular`]: { id: 'calc-2' },
      [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', progresso: 1, texto: 'pronto', resultado: DIRETA },
      [`POST ${ROTA}/ativar`]: erroHttp(422, 'este cálculo é antigo: a partida já foi (09:30) — calcula outra vez antes de enviar o plano')
    }
  })
  await melhor.acao('rota-recalcular', {}, ctx)
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST'), { url: `${ROTA}/calcular`, method: 'POST', body: { destino: 'peniche', tripulacao: 'so', sairAgora: false } })
  await esperar()
  let html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-ativar"/, 'o Resultado')
  await melhor.acao('rota-ativar', {}, ctx)
  html = melhor.render(ctx)
  assert.match(html, /este cálculo é antigo: a partida já foi/)
  assert.match(html, /data-acao="rota-ativar"/, 'fica no Resultado')
  // um destino avulso (sem id): pelas coordenadas do cais
  const av = await leme({ ...PLANO, destino: { id: null, nome: 'Baía', lat: 38.5, lon: -9.1 }, tripulacao: 'acompanhado' }, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-3' } } })
  await melhor.acao('rota-recalcular', {}, av)
  assert.deepEqual(av.pedidos.find(p => p.method === 'POST').body, { destino: { lat: 38.5, lon: -9.1, nome: 'Baía' }, tripulacao: 'acompanhado', sairAgora: false })
})

test('rota mudada (pausado): a caixa "a rota ativa já não é a do plano: terminar o plano?" com Terminar e Continuar, mesmo sem rota ativa; Continuar faz o POST', async () => {
  const pausado = { ...PLANO, estado: 'pausado' }
  for (const valores of [ROTA_ATIVA, {}]) {
    for (const noite of [false, true]) {
      const ctx = await leme(pausado, { valores, noite, respostas: { [`POST ${ROTA}/plano-ativo/continuar`]: { ok: true, estado: 'a navegar' } } })
      const html = melhor.render(ctx)
      limpo(html, 'pausado')
      assert.match(texto(html), /a rota ativa já não é a do plano: terminar o plano\?/)
      assert.match(html, /data-acao="rota-terminar"[^>]*>Terminar</)
      assert.match(html, /data-acao="rota-continuar"[^>]*>Continuar</)
      assert.doesNotMatch(texto(html), /próximo:/)
      await melhor.acao('rota-continuar', {}, ctx)
      assert.deepEqual(ctx.pedidos.filter(p => p.method === 'POST').map(p => p.url), [`${ROTA}/plano-ativo/continuar`])
    }
  }
})

test('a hora da faixa é a do plugin (agora do GET /plano-ativo, mais o tempo desde a leitura): "daqui a" e "amanhã" contam-se com ela', async () => {
  // o plugin 6 h à frente do ecrã (a viagem acelerada do dev; no barco é o mesmo relógio)
  const doPlugin = AGORA + 6 * 3600000
  const p = { ...PLANO, agora: iso(doPlugin), proximo: { texto: 'rizar', hora: iso(doPlugin + 25 * MIN) } }
  const ctx = await leme(p)
  ctx.agora = AGORA + 5 * MIN // 5 min depois da leitura
  const t = texto(melhor.render(ctx))
  assert.match(t, /próximo: rizar às 21:57 \(daqui a 20 min\)/)
})
