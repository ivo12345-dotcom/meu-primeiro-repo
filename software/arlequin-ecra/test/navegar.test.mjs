// O Leme a navegar (desenho 3b-2): a faixa do plano ativo (próximo evento, atraso, chegada agora e a do
// plano, recursos, "à espera de sair", "sem GPS"), Recalcular, Terminar com confirmação e a caixa da
// rota mudada (Terminar / Continuar); o GET /plano-ativo de 10 em 10 s; o apito curto do lib/alarmes.js.
// Sem browser, como o melhor.test.mjs, de dia e de noite, sem null/NaN/undefined.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import melhor from '../public/paginas/melhor.js'
import { deveTocar, paginaDoAlarme, chipAlarme } from '../public/lib/alarmes.js'
import { buscarPlanoAtivo } from '../public/paginas/melhor/navegar.js'
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
  pausadoDe: null,
  ativadoEm: iso(AGORA - 4 * 3600000),
  chegadaOutro: null,
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
  // contrato C1 (auditoria I-07): sem o campo apito, um alarm é curto (o contínuo é só o 'continuo' ou a emergência)
  assert.equal(deveTocar(n('alarm')), 'curto')
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
  // decisão 6 (Ivo): a navegar, só a partida imediata (sairAgora: true; o plugin mantém o "Volta ou abriga-te")
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST'), { url: `${ROTA}/calcular`, method: 'POST', body: { destino: 'peniche', tripulacao: 'so', sairAgora: true } })
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
  assert.deepEqual(av.pedidos.find(p => p.method === 'POST').body, { destino: { lat: 38.5, lon: -9.1, nome: 'Baía' }, tripulacao: 'acompanhado', sairAgora: true })
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

// o plano novo (Recalcular → Ativar): outro cálculo, outra hora de ativação
const NOVO = { ...PLANO, estado: 'a espera de sair', idCalculo: 'calc-2', ativadoEm: iso(AGORA + MIN), saida: null, atrasoMin: null }
const ATIVADA = { ok: true, rota: 'r2', href: '/resources/routes/r2', via: 'api interna', alternativa: 'x', nota: null, planoAtivo: { estado: 'a espera de sair' } }

test('9 (a sequência da revisão): Terminar → Recalcular → Ativar → o Leme do plano novo não mostra a pergunta do Terminar, e o "Sim" já não termina nada', async () => {
  const ctx = await leme(PLANO, {
    respostas: {
      [`GET ${ROTA}/plano-ativo`]: [PLANO, NOVO],
      [`POST ${ROTA}/calcular`]: { id: 'calc-2' },
      [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', progresso: 1, texto: 'pronto', resultado: DIRETA },
      [`POST ${ROTA}/ativar`]: ATIVADA,
      [`POST ${ROTA}/plano-ativo/terminar`]: { ok: true, estado: 'terminado', contactos: true }
    }
  })
  await melhor.acao('rota-terminar', {}, ctx)
  assert.match(melhor.render(ctx), /rota-terminar-sim/)
  await melhor.acao('rota-recalcular', {}, ctx)
  await esperar()
  melhor.render(ctx)
  await melhor.acao('rota-ativar', {}, ctx)
  await esperar()
  for (const noite of [false, true]) {
    ctx.noite = noite
    const html = melhor.render(ctx)
    assert.match(texto(html), /plano ativo · à espera de sair/, 'o Leme do plano novo')
    assert.doesNotMatch(html, /rota-terminar-sim|Terminar o plano\?/)
  }
  await melhor.acao('rota-terminar-sim', {}, ctx)
  assert.deepEqual(ctx.pedidos.filter(p => p.url.endsWith('/terminar')), [], 'nada terminou')
})

test('9: a pergunta do Terminar sai quando o plano fecha (chegou) e não volta com o plano seguinte; a mensagem "Plano terminado" não fica por baixo da faixa do plano seguinte', async () => {
  const ctx = await leme(PLANO, { respostas: { [`GET ${ROTA}/plano-ativo`]: [PLANO, { ...PLANO, estado: 'chegado' }, NOVO] } })
  await melhor.acao('rota-terminar', {}, ctx)
  ctx.agora = AGORA + 10000
  melhor.render(ctx)
  await esperar()
  ctx.agora = AGORA + 20000
  melhor.render(ctx)
  await esperar()
  assert.doesNotMatch(melhor.render(ctx), /rota-terminar-sim|Terminar o plano\?/)
  // Terminar → "Plano terminado" → o plano seguinte
  const t = await leme(PLANO, { respostas: { [`GET ${ROTA}/plano-ativo`]: [PLANO, { ...PLANO, estado: 'terminado' }, NOVO], [`POST ${ROTA}/plano-ativo/terminar`]: { ok: true, estado: 'terminado', contactos: true } } })
  await melhor.acao('rota-terminar', {}, t)
  await melhor.acao('rota-terminar-sim', {}, t)
  assert.match(texto(melhor.render(t)), /Plano terminado/)
  t.agora = AGORA + 10000
  melhor.render(t)
  await esperar()
  const html = melhor.render(t)
  assert.match(texto(html), /plano ativo · à espera de sair/)
  assert.doesNotMatch(texto(html), /Plano terminado/)
})

test('9: um GET forçado (depois de Terminar, Continuar ou Ativar) com uma leitura a meio não se perde: a resposta pedida antes não conta e lê-se outra vez', async () => {
  let soltar = null
  const respostas = [new Promise(resolve => { soltar = resolve }), Promise.resolve(structuredClone(NOVO))]
  const pedidos = []
  const ctx = contexto()
  ctx.pedir = async (url, o = {}) => { pedidos.push(`${o.method || 'GET'} ${url}`); return respostas.shift() }
  const primeiro = buscarPlanoAtivo(ctx)
  const forcado = buscarPlanoAtivo(ctx, true)
  assert.ok(forcado, 'o forçado espera pela leitura em curso')
  soltar(structuredClone(PLANO)) // a resposta velha (pedida antes do POST)
  await primeiro
  await forcado
  assert.equal(pedidos.length, 2)
  assert.equal(ctx.estado.planoAtivo.idCalculo, 'calc-2')
})

test('9: um erro que não é 404 (o plugin a reiniciar, a rede) avisa "sem ligação ao plugin da rota: os dados podem estar velhos" (de dia e de noite); a leitura seguinte boa tira o aviso', async () => {
  const ctx = await leme(PLANO, { respostas: { [`GET ${ROTA}/plano-ativo`]: [PLANO, erroHttp(503, 'o plugin da rota não está ligado'), PLANO] } })
  ctx.agora = AGORA + 10000
  melhor.render(ctx)
  await esperar()
  for (const noite of [false, true]) {
    ctx.noite = noite
    const html = melhor.render(ctx)
    limpo(html, 'sem ligação')
    assert.match(texto(html), /sem ligação ao plugin da rota: os dados podem estar velhos/)
  }
  // pausado também
  ctx.estado.planoAtivo = { ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' }
  assert.match(texto(melhor.render(ctx)), /sem ligação ao plugin da rota/)
  ctx.agora = AGORA + 20000
  melhor.render(ctx)
  await esperar()
  assert.doesNotMatch(texto(melhor.render(ctx)), /sem ligação ao plugin da rota/)
})

test('decisão 6 (Ivo): o Recalcular pede só a partida imediata a navegar ou em pausa no mar; à espera de sair, todas as partidas (sairAgora: false)', async () => {
  const casos = [[{ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' }, true], [{ ...PLANO, estado: 'a espera de sair', saida: null }, false], [{ ...PLANO, estado: 'pausado', pausadoDe: 'a espera de sair' }, false]]
  for (const [plano, sairAgora] of casos) {
    const ctx = await leme(plano, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-9' } } })
    assert.match(melhor.render(ctx), /data-acao="rota-recalcular"/, `${plano.estado} ${plano.pausadoDe}`)
    await melhor.acao('rota-recalcular', {}, ctx)
    assert.equal(ctx.pedidos.find(p => p.method === 'POST').body.sairAgora, sairAgora, `${plano.estado} ${plano.pausadoDe}`)
  }
})

test('decisão 5 (Ivo): em pausa, parado noutro porto (chegadaOutro) → "Chegaste a Cascais? Enviar \'cheguei bem a Cascais\'" com o botão; só envia com o toque (POST /plano-ativo/chegada { destino })', async () => {
  const p = { ...PLANO, estado: 'pausado', pausadoDe: 'a navegar', chegadaOutro: { id: 'cascais', nome: 'Cascais' } }
  for (const noite of [false, true]) {
    const ctx = await leme(p, { noite, respostas: { [`POST ${ROTA}/plano-ativo/chegada`]: { ok: true, estado: 'chegado', contactos: true } } })
    const html = melhor.render(ctx)
    limpo(html, 'chegada a outro porto')
    assert.match(texto(html), /Chegaste a Cascais\? Enviar 'cheguei bem a Cascais'/)
    assert.match(html, /data-acao="rota-chegada"/)
    assert.deepEqual(ctx.pedidos.filter(x => x.method === 'POST'), [], 'nada sem o toque')
    await melhor.acao('rota-chegada', {}, ctx)
    assert.deepEqual(ctx.pedidos.filter(x => x.method === 'POST').map(x => [x.url, x.body]), [[`${ROTA}/plano-ativo/chegada`, { destino: 'cascais' }]])
    assert.match(texto(melhor.render(ctx)), /Enviado aos contactos em terra: 'cheguei bem a Cascais'/)
  }
  // sem a sugestão, nada
  assert.doesNotMatch(melhor.render(await leme({ ...p, chegadaOutro: null })), /rota-chegada|Chegaste a/)
  // o nome do porto passa pelo esc
  assert.match(melhor.render(await leme({ ...p, chegadaOutro: { id: 'x', nome: '<b>A&B</b>' } })), /&lt;b&gt;A&amp;B&lt;\/b&gt;/)
})

test('9: a mensagem do alarme na barra de cima passa pelo esc (texto do plugin: eventos, nomes dos destinos do Ivo)', () => {
  // (revisão F3, Important 4: o id é o do servidor, um UUID; um id que não o é cala-se pelo caminho)
  const html = chipAlarme({ caminho: 'notifications.rota.lembrete.e3', id: '11111111-1111-4111-8111-1111111111e3', state: 'alert', method: ['visual', 'sound'], message: 'Às 22:50: chegada de noite a <b>A&B</b> "x"' })
  assert.match(html, /chegada de noite a &lt;b&gt;A&amp;B&lt;\/b&gt; &quot;x&quot;/)
  assert.match(html, /data-caminho="notifications\.rota\.lembrete\.e3"/)
  assert.match(html, /data-acao="silenciar" data-id="11111111-1111-4111-8111-1111111111e3"/)
  assert.match(chipAlarme({ caminho: 'notifications.rota.lembrete.e3', id: 'n1', state: 'alert', method: ['visual', 'sound'], message: 'x' }), /data-acao="silenciar" data-caminho="notifications\.rota\.lembrete\.e3">/)
  assert.doesNotMatch(chipAlarme({ caminho: 'x', state: 'warn', message: 'm', method: ['visual'] }), /silenciar/)
  assert.equal(chipAlarme(null), '')
})

test('Tarefa 8.2: com o plano ativo, o Leme fica limpo: sem "A rota ótima (isócronas, GRIB)…" nem "Novo cálculo" (só o Recalcular da faixa); de dia e de noite', async () => {
  for (const plano of [PLANO, { ...PLANO, estado: 'a espera de sair', saida: null, atrasoMin: null }]) {
    for (const noite of [false, true]) {
      const html = melhor.render(await leme(plano, { noite }))
      limpo(html, 'leme limpo')
      assert.match(html, /Rumo a seguir/)
      assert.doesNotMatch(texto(html), /isócronas|GRIB/)
      assert.doesNotMatch(html, /data-acao="rota-novo"/)
      assert.equal((html.match(/data-acao="rota-recalcular"/g) || []).length, 1)
    }
  }
  // a navegar mas ainda sem o rumo do SignalK (a rota acabou de se ativar): também sem o "Novo cálculo"
  const html = melhor.render(await leme(PLANO, { valores: { 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche' } } }))
  assert.doesNotMatch(html, /data-acao="rota-novo"/)
  assert.match(html, /data-acao="rota-recalcular"/)
})

test('Tarefa 8.2: rota ativa sem plano (ativada à mão no OpenCPN): fica o "Novo cálculo"; auditoria M-40: sem a frase velha "A rota ótima… calcula-se no OpenCPN" (a página calcula a rota)', async () => {
  const html = melhor.render(await leme(undefined))
  assert.match(html, /Rumo a seguir/)
  assert.match(html, /data-acao="rota-novo"[^>]*>Novo cálculo</)
  assert.doesNotMatch(html, /rota-recalcular/)
  assert.doesNotMatch(texto(html), /A rota ótima|isócronas|GRIB|EV-100/)
})

test('auditoria M-39: um próximo evento que já passou diz "há X min", nunca "daqui a 0 min"', async () => {
  const t = texto(melhor.render(await leme({ ...PLANO, proximo: { texto: 'rizar', hora: iso(AGORA - 15 * MIN) } })))
  assert.match(t, /próximo: rizar às 15:17 \(há 15 min\)/)
  assert.doesNotMatch(t, /daqui a 0 min/)
  // no minuto certo, "daqui a 0 min" não; "agora"
  assert.match(texto(melhor.render(await leme({ ...PLANO, proximo: { texto: 'rizar', hora: iso(AGORA + 20e3) } }))), /próximo: rizar às 15:32 \(agora\)/)
})

test('Tarefa 8.2: pausado sem rota ativa: o texto por baixo do título diz "a rota do plano já não está ativa", não a espera pelo rumo; sem "Novo cálculo"', async () => {
  for (const noite of [false, true]) {
    const html = melhor.render(await leme({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' }, { valores: {}, noite }))
    limpo(html, 'pausado sem rota')
    const t = texto(html)
    assert.match(t, /a rota do plano já não está ativa/)
    assert.doesNotMatch(t, /À espera do rumo/)
    assert.doesNotMatch(html, /data-acao="rota-novo"/)
    assert.match(html, /data-acao="rota-continuar"/)
  }
})

// ---------- auditoria I-24: os avisos da rota ativos ao mesmo tempo, todos à vista no Leme ----------
test('auditoria I-24: o Leme mostra uma linha por aviso ativo da rota (o campo avisos do GET /plano-ativo), com a cor da gravidade e escapada; o dos recursos só uma vez; no mosaico "Avisos da rota" da coluna da direita (o rumo nunca sai do ecrã)', async () => {
  // com muitos avisos na faixa, o "Rumo a seguir" saía por baixo do ecrã a 1024×600 (visto no browser)
  const comAvisos = melhor.render(await leme({ ...PLANO, avisos: [{ caminho: 'notifications.rota.recalcula', state: 'warn', message: 'Recalcula a rota: atraso de 40 min' }] }))
  const faixa = comAvisos.slice(comAvisos.indexOf('plano-faixa'), comAvisos.indexOf('Rumo a seguir'))
  assert.doesNotMatch(faixa, /Recalcula a rota: atraso/, 'fora da faixa')
  assert.ok(comAvisos.indexOf('Rumo a seguir') < comAvisos.indexOf('<div class="tile avisos-rota">'), 'na coluna da direita')
  assert.match(comAvisos, /<div class="tile avisos-rota"><div class="lab">Avisos da rota<\/div>/)
  // à espera do rumo (sem rota ativa no SignalK): numa só coluna, por baixo da faixa
  const semRumo = melhor.render(await leme({ ...PLANO, avisos: [{ caminho: 'notifications.rota.recalcula', state: 'warn', message: 'Recalcula a rota: atraso de 40 min' }] }, { valores: { 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche' } } }))
  assert.match(semRumo, /avisos-rota[\s\S]*Recalcula a rota: atraso de 40 min/)
  const avisos = [
    { caminho: 'notifications.rota.lembrete.e3', state: 'alert', message: 'Às 15:57: rizar' },
    { caminho: 'notifications.rota.recalcula', state: 'warn', message: 'Recalcula a rota: atraso de 40 min' },
    { caminho: 'notifications.rota.recursos', state: 'warn', message: 'Recursos: gasóleo à chegada ~34 L' },
    { caminho: 'notifications.rota.previsao', state: 'alarm', message: 'Previsão com 14 h: confia nos instrumentos e no barómetro' },
    { caminho: 'notifications.rota.barometro', state: 'warn', message: 'Barómetro: caiu 3,4 hPa em 3 h — o tempo pode piorar antes do previsto' },
    { caminho: 'notifications.rota.alarmeTerra', state: 'alert', message: 'Os contactos em terra ligam ao MRCC às 09:38 <b>' },
    { caminho: 'notifications.rota.comer', state: 'normal', message: 'Normal' }
  ]
  for (const noite of [false, true]) {
    const html = melhor.render(await leme({ ...PLANO, avisos }, { noite }))
    limpo(html, 'avisos')
    assert.match(html, /<span class="atencao">⚠ Recalcula a rota: atraso de 40 min<\/span>/)
    assert.match(html, /<span class="perigo">⚠ Previsão com 14 h: confia nos instrumentos e no barómetro<\/span>/)
    assert.match(html, /<span class="atencao">⚠ Barómetro: caiu 3,4 hPa em 3 h/)
    assert.match(html, /<span>⚠ Às 15:57: rizar<\/span>/)
    assert.match(html, /⚠ Os contactos em terra ligam ao MRCC às 09:38 &lt;b&gt;/)
    assert.equal((texto(html).match(/gasóleo à chegada ~34 L/g) || []).length, 1, 'o dos recursos só na linha dos recursos')
    assert.doesNotMatch(texto(html), /Normal/)
    // os mais graves primeiro
    assert.ok(html.indexOf('Previsão com 14 h') < html.indexOf('Recalcula a rota') && html.indexOf('Recalcula a rota') < html.indexOf('Às 15:57: rizar'))
  }
  // sem avisos (ou com lixo), nada
  for (const lixo of [[], null, 'x', [null, { state: 'warn' }, { caminho: 'x', state: 'warn', message: 7 }]]) assert.doesNotMatch(melhor.render(await leme({ ...PLANO, avisos: lixo })), /⚠ /)
})

// ---------- auditoria I-25 (e C-M7): o caminho de volta ao Leme é sempre um toque ----------
test('auditoria I-25: depois de Recalcular no mar, o A calcular, o Resultado e o Mapa têm "Voltar ao leme" (um toque volta ao rumo, sem ativar nada)', async () => {
  const ctx = await leme(PLANO, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-2' }, [`GET ${ROTA}/resultado/calc-2`]: [{ estado: 'a calcular', progresso: 0.3, texto: 'a simular' }, { estado: 'pronto', progresso: 1, texto: 'pronto', resultado: DIRETA }] } })
  ctx.agendar = (f) => { ctx.proximo = f }
  await melhor.acao('rota-recalcular', {}, ctx)
  assert.match(melhor.render(ctx), /A calcular a melhor rota/)
  assert.match(melhor.render(ctx), /data-acao="rota-voltar-leme"[^>]*>Voltar ao leme</, 'no A calcular')
  await ctx.proximo()
  let html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-ativar"/, 'o Resultado')
  assert.match(html, /data-acao="rota-voltar-leme"[^>]*>Voltar ao leme</, 'no Resultado')
  await melhor.acao('rota-mapa', {}, ctx)
  html = melhor.render(ctx)
  assert.match(html, /<svg class="mapa"/)
  assert.match(html, /data-acao="rota-voltar-leme"[^>]*>Voltar ao leme</, 'no Mapa')
  await melhor.acao('rota-voltar-leme', {}, ctx)
  html = melhor.render(ctx)
  assert.match(html, /Rumo a seguir/)
  assert.match(texto(html), /próximo: rizar/)
  assert.equal(ctx.pedidos.filter(p => p.url.endsWith('/ativar')).length, 0, 'não ativou nada')
})

test('revisão F3, Important 2: no Resultado e no Mapa de um Recalcular no mar os botões (Ativar esta rota, Voltar ao leme, Mapa, Enviar plano, Sair agora) ficam numa faixa fixa, fora da parte que rola; o conteúdo comprido rola por cima deles', async () => {
  const { ancestrais, dentroDeRolar } = await import('./ajuda-html.mjs')
  const fixture = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/resultado-${n}.json.gz`, import.meta.url))))
  for (const nome of ['fuga', 'direta', 'canal']) {
    const resultado = fixture(nome)
    for (const noite of [false, true]) {
      const ctx = await leme(PLANO, { noite })
      Object.assign(ctx.estado, { vista: 'resultado', resultado, idCalculo: 'calc-2', selecionada: 0, novo: true, ultimoPedido: { destino: 'peniche', tripulacao: 'so', sairAgora: false } })
      const html = melhor.render(ctx)
      limpo(html, `resultado ${nome}`)
      for (const acao of ['rota-ativar', 'rota-voltar-leme', 'rota-mapa', 'rota-plano', 'rota-sair-agora', 'rota-novo']) {
        const cadeia = ancestrais(html, `data-acao="${acao}"`)
        assert.ok(cadeia, `${nome}: o botão ${acao}`)
        assert.ok(!dentroDeRolar(cadeia), `${nome}: ${acao} fora da parte que rola (${cadeia.map(a => a.classe).join(' > ')})`)
      }
      // a faixa e os cartões rolam na parte de cima da coluna da esquerda
      for (const pedaco of ['class="faixa ', 'data-acao="rota-escolher"']) assert.ok(ancestrais(html, pedaco).some(a => a.rolar === 'resultado-esq'), `${nome}: ${pedaco} na parte que rola`)
      // os avisos vermelhos no cimo da coluna da direita (com os botões fixos, por baixo dos cartões deixavam de se ver)
      assert.ok(ancestrais(html, 'Avisos vermelhos').some(a => a.rolar === 'resultado-dir'), `${nome}: os avisos vermelhos na coluna da direita`)
      assert.ok(html.indexOf('Avisos vermelhos') < html.indexOf('Linha do tempo'), `${nome}: os avisos vermelhos antes da linha do tempo`)
      // o Mapa: o Voltar ao resultado, o Ativar e o Voltar ao leme fixos; os cartões rolam
      ctx.estado.vista = 'mapa'
      const mapa = melhor.render(ctx)
      for (const acao of ['rota-voltar', 'rota-ativar', 'rota-voltar-leme']) assert.ok(!dentroDeRolar(ancestrais(mapa, `data-acao="${acao}"`)), `mapa ${nome}: ${acao} fixo`)
      assert.ok(dentroDeRolar(ancestrais(mapa, 'data-acao="rota-escolher"')), `mapa ${nome}: os cartões rolam`)
    }
  }
})

test('auditoria I-25: sair da página e voltar com o plano aberto repõe o Leme (também do Resultado e do Mapa); sem plano nem rota ativa não há "Voltar ao leme"', async () => {
  const ctx = await leme(PLANO, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-2' }, [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', resultado: DIRETA } } })
  await melhor.acao('rota-recalcular', {}, ctx)
  await esperar()
  assert.match(melhor.render(ctx), /data-acao="rota-ativar"/)
  melhor.aoEntrar(ctx)
  assert.match(melhor.render(ctx), /Rumo a seguir/)
  // sem plano e sem rota ativa: o Resultado sem o botão
  const sem = contexto({ valores: {}, estado: { vista: 'resultado', resultado: DIRETA, idCalculo: 'calc-1', selecionada: 0 } })
  assert.doesNotMatch(melhor.render(sem), /rota-voltar-leme/)
})

test('auditoria C-M7: com o plano aberto mas sem rota ativa no SignalK (antes de o plugin o pausar), a página mostra o Leme com a faixa e o Terminar, não o Pedir', async () => {
  for (const noite of [false, true]) {
    const html = melhor.render(await leme(PLANO, { valores: {}, noite }))
    limpo(html, 'plano sem rota')
    assert.doesNotMatch(html, /Para onde\?/)
    assert.match(texto(html), /próximo: rizar/)
    assert.match(html, /data-acao="rota-terminar"/)
  }
})

test('auditoria I-25: em pausa sem rota ativa → Recalcular → Novo cálculo → o Pedir tem "Voltar ao leme"', async () => {
  const ctx = await leme({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' }, { valores: {}, respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-2' }, [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', resultado: DIRETA } } })
  await melhor.acao('rota-recalcular', {}, ctx)
  await esperar()
  await melhor.acao('rota-novo', {}, ctx)
  const html = melhor.render(ctx)
  assert.match(html, /Para onde\?/)
  assert.match(html, /data-acao="rota-voltar-leme"/)
  await melhor.acao('rota-voltar-leme', {}, ctx)
  assert.match(texto(melhor.render(ctx)), /a rota ativa já não é a do plano/)
})

// ---------- auditoria M-19 e M-35 ----------
test('auditoria M-19: "Chegaste à Nazaré? Enviar \'cheguei bem à Nazaré\'" (os nomes femininos levam o artigo); "a Cascais" fica', async () => {
  const { aNome, emNome } = await import('../public/lib/rota-texto.js')
  for (const [nome, a, em] of [['Nazaré', 'à Nazaré', 'na Nazaré'], ['Figueira da Foz', 'à Figueira da Foz', 'na Figueira da Foz'], ['Ericeira', 'à Ericeira', 'na Ericeira'], ['Berlenga', 'à Berlenga', 'na Berlenga'], ['Póvoa de Varzim', 'à Póvoa de Varzim', 'na Póvoa de Varzim'], ['Praia da Ursa', 'à Praia da Ursa', 'na Praia da Ursa'], ['Cascais', 'a Cascais', 'em Cascais'], ['Peniche', 'a Peniche', 'em Peniche'], ['Algés (CNA)', 'a Algés (CNA)', 'em Algés (CNA)'], ['Viana do Castelo', 'a Viana do Castelo', 'em Viana do Castelo']]) {
    assert.equal(aNome(nome), a, nome)
    assert.equal(emNome(nome), em, nome)
  }
  const p = { ...PLANO, estado: 'pausado', pausadoDe: 'a navegar', chegadaOutro: { id: 'nazare', nome: 'Nazaré' } }
  const ctx = await leme(p, { respostas: { [`POST ${ROTA}/plano-ativo/chegada`]: { ok: true, estado: 'chegado', contactos: true } } })
  assert.match(texto(melhor.render(ctx)), /Chegaste à Nazaré\? Enviar 'cheguei bem à Nazaré'/)
  await melhor.acao('rota-chegada', {}, ctx)
  assert.match(texto(melhor.render(ctx)), /Enviado aos contactos em terra: 'cheguei bem à Nazaré'/)
})

test('auditoria M-35: o estado "à espera de sair" com o acento (o do plugin novo) e o antigo "a espera de sair" contam os dois como plano aberto', async () => {
  for (const estado of ['à espera de sair', 'a espera de sair']) {
    const ctx = await leme({ ...PLANO, estado, saida: null, atrasoMin: null }, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-9' } } })
    const html = melhor.render(ctx)
    assert.match(texto(html), /plano ativo · à espera de sair/, estado)
    assert.match(html, /data-acao="rota-terminar"/, estado)
    await melhor.acao('rota-recalcular', {}, ctx)
    assert.equal(ctx.pedidos.find(x => x.method === 'POST').body.sairAgora, false, `${estado}: todas as partidas`)
  }
  // em pausa a partir do "à espera de sair": no porto, todas as partidas
  const ctx = await leme({ ...PLANO, estado: 'pausado', pausadoDe: 'à espera de sair' }, { respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-9' } } })
  await melhor.acao('rota-recalcular', {}, ctx)
  assert.equal(ctx.pedidos.find(x => x.method === 'POST').body.sairAgora, false)
})

// ---------- revisão final (C1, I2, I3) ----------
const ALARME = '2026-09-30T08:38:00.000Z' // 09:38 em Lisboa, amanhã

test('revisão final C1 (decisão do Ivo de 02/10): com um atraso retido (atrasoRetido), "A hora de alarme em terra é HH:MM e não foi adiada (barco parado / limite de 3 h). Se estás bem, carrega Estou bem." com o botão; de dia e de noite', async () => {
  for (const noite of [false, true]) {
    for (const [motivo, porque] of [['parado', 'barco parado'], ['limite', 'limite de 3 h']]) {
      const ctx = await leme({ ...PLANO, atrasoRetido: { motivo, alarme: ALARME } }, { noite })
      const html = melhor.render(ctx)
      limpo(html, `retido ${motivo}`)
      assert.ok(texto(html).includes(`A hora de alarme em terra é amanhã 09:38 e não foi adiada (${porque}). Se estás bem, carrega Estou bem.`), texto(html))
      assert.match(html, /data-acao="rota-estou-bem"[^>]*>Estou bem</)
    }
  }
  // sem nada retido: nem o texto nem o botão
  const ctx = await leme(PLANO)
  assert.doesNotMatch(melhor.render(ctx), /rota-estou-bem|não foi adiada/)
})

test('revisão final C1: o "Estou bem" faz o POST /plano-ativo/estou-bem, diz a nova hora de alarme e lê o plano outra vez; o erro aparece', async () => {
  const ctx = await leme({ ...PLANO, atrasoRetido: { motivo: 'parado', alarme: ALARME } }, {
    respostas: {
      [`POST ${ROTA}/plano-ativo/estou-bem`]: { ok: true, chegada: '2026-09-30T08:10:00.000Z', alarme: '2026-09-30T10:10:00.000Z' },
      [`GET ${ROTA}/plano-ativo`]: [{ ...PLANO, atrasoRetido: { motivo: 'parado', alarme: ALARME } }, PLANO]
    }
  })
  melhor.render(ctx)
  await melhor.acao('rota-estou-bem', {}, ctx)
  assert.ok(ctx.pedidos.some(p => p.method === 'POST' && p.url === `${ROTA}/plano-ativo/estou-bem`))
  assert.equal(ctx.pedidos.at(-1).url, `${ROTA}/plano-ativo`)
  const html = melhor.render(ctx)
  assert.ok(texto(html).includes('Enviado aos contactos em terra: nova hora de alarme amanhã 11:10.'), texto(html))
  assert.doesNotMatch(html, /rota-estou-bem/)
  // o 409 (já não há nada retido): o motivo do plugin
  const c2 = await leme({ ...PLANO, atrasoRetido: { motivo: 'limite', alarme: ALARME } }, { respostas: { [`POST ${ROTA}/plano-ativo/estou-bem`]: erroHttp(409, 'não há nenhum atraso por enviar') } })
  await melhor.acao('rota-estou-bem', {}, c2)
  assert.match(melhor.render(c2), /não há nenhum atraso por enviar/)
})

test('revisão final I2: a faixa e a caixa da pausa dizem "contactos em terra: alarme HH:MM"; uma mensagem por enviar (tentativas ≥ 1) "mensagem para terra por enviar (sem rede)"; em pausa "em pausa: os atrasos não seguem para terra"; de dia e de noite', async () => {
  const fila = [{ tipo: 'atraso', criada: PLANO.ativadoEm, tentativas: 2, proxima: PLANO.ativadoEm, estado: 'fila', erro: 'o plugin porto não respondeu', contactos: ['Mãe'], parcial: false }]
  for (const noite of [false, true]) {
    let ctx = await leme({ ...PLANO, filaContactos: fila }, { noite })
    let t = texto(melhor.render(ctx))
    limpo(melhor.render(ctx), 'faixa')
    assert.ok(t.includes('contactos em terra: alarme amanhã 09:38'), t)
    assert.ok(t.includes('mensagem para terra por enviar (sem rede)'), t)
    assert.ok(!t.includes('em pausa'), t)
    ctx = await leme({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' }, { noite })
    t = texto(melhor.render(ctx))
    limpo(melhor.render(ctx), 'pausa')
    assert.ok(t.includes('contactos em terra: alarme amanhã 09:38'), t)
    assert.ok(t.includes('em pausa: os atrasos não seguem para terra'), t)
    assert.ok(!t.includes('por enviar'), 'nada na fila')
  }
  // a 1.ª tentativa ainda a sair (tentativas 0) não é "sem rede"; sem o plano enviado, nenhuma destas linhas
  let ctx = await leme({ ...PLANO, filaContactos: [{ ...fila[0], tentativas: 0 }] })
  assert.ok(!texto(melhor.render(ctx)).includes('por enviar'))
  ctx = await leme({ ...PLANO, envio: null, estado: 'pausado', pausadoDe: 'a navegar' })
  assert.doesNotMatch(texto(melhor.render(ctx)), /contactos em terra|atrasos não seguem/)
})

test('revisão final I3: a mensagem que não chegou a um contacto (o parcial na fila) → "não chegou a Pai (a tentar outra vez)"', async () => {
  const fila = [{ tipo: 'atraso', criada: PLANO.ativadoEm, tentativas: 1, proxima: PLANO.ativadoEm, estado: 'fila', erro: 'Pai: bloqueou o bot', contactos: ['Pai'], parcial: true }]
  for (const noite of [false, true]) {
    const ctx = await leme({ ...PLANO, filaContactos: fila, enviadas: [{ tipo: 'atraso', enviadaEm: PLANO.ativadoEm, contactos: ['Mãe'], falhas: [{ nome: 'Pai', erro: 'bloqueou o bot' }] }] }, { noite })
    const html = melhor.render(ctx)
    limpo(html, 'parcial')
    const t = texto(html)
    assert.ok(t.includes('não chegou a Pai (a tentar outra vez)'), t)
    assert.ok(!t.includes('sem rede'), 'chegou aos outros: não é falta de rede')
  }
})

// ---------- F9 item 3: o que o plugin da rota diz de novo no GET /plano-ativo (F2b Menor 3 e Menor 6) ----------
// As formas REAIS que o plugin devolve, gravadas a correr os testes do próprio plugin (software/signalk-arlequin-rota/
// test/contactos-plugin.test.js, "F2b Menor 3" e "F2b Menor 6": o mesmo código, não escritas à mão):
//   recursos com tudo lido; com a sonda do gasóleo perdida (o gasóleo desconhecido, a bateria lida);
//   fechoPorEntregar quando se ativa a viagem seguinte com o «cheguei bem» da anterior por entregar (doPlanoAnterior: true).
const REC_LIDOS = { gasoleoChegadaL: 120, bateriaChegadaPct: 100, semLeitura: false, gasoleoSemLeitura: false, bateriaSemLeitura: false, aviso: null }
const REC_GASOLEO_SEM_LEITURA = { gasoleoChegadaL: null, bateriaChegadaPct: 100, semLeitura: false, gasoleoSemLeitura: true, bateriaSemLeitura: false, aviso: null }
const FECHO_DA_VIAGEM_ANTERIOR = { tipo: 'chegada', contactos: ['Mãe'], tentativas: 2, erro: 'o plugin porto está desligado: liga-o em Plugin Config', doPlanoAnterior: true }

test('F9 (item 3, F2b Menor 3): a faixa diz qual dos recursos não tem leitura — "recursos: gasóleo sem leitura" (a sonda do gasóleo perdida) ou "recursos: bateria sem leitura"; os dois, o "recursos: sem leitura" de sempre; um aviso dos recursos nunca esconde o que falta ler; com tudo lido, nada; de dia e de noite, sem null/NaN', async () => {
  const faixa = async (recursos, noite) => {
    const html = melhor.render(await leme({ ...PLANO, recursos }, { noite }))
    limpo(html, JSON.stringify(recursos))
    return texto(html)
  }
  for (const noite of [false, true]) {
    // a forma real com a sonda perdida: só o gasóleo
    let t = await faixa(REC_GASOLEO_SEM_LEITURA, noite)
    assert.match(t, /recursos: gasóleo sem leitura/)
    assert.doesNotMatch(t, /recursos: sem leitura|bateria sem leitura/)
    // a bateria sem leitura (a mesma forma, com os papéis trocados)
    t = await faixa({ ...REC_GASOLEO_SEM_LEITURA, gasoleoChegadaL: 80, bateriaChegadaPct: null, gasoleoSemLeitura: false, bateriaSemLeitura: true }, noite)
    assert.match(t, /recursos: bateria sem leitura/)
    assert.doesNotMatch(t, /gasóleo sem leitura|recursos: sem leitura/)
    // os dois: o de sempre (um só texto, sem repetir qual)
    t = await faixa({ gasoleoChegadaL: null, bateriaChegadaPct: null, semLeitura: true, gasoleoSemLeitura: true, bateriaSemLeitura: true, aviso: null }, noite)
    assert.match(t, /recursos: sem leitura/)
    assert.doesNotMatch(t, /gasóleo sem leitura|bateria sem leitura/)
    // um aviso dos recursos (a bateria a 40 %) com o gasóleo sem leitura: as duas linhas
    t = await faixa({ gasoleoChegadaL: null, bateriaChegadaPct: 40, semLeitura: false, gasoleoSemLeitura: true, bateriaSemLeitura: false, aviso: 'Recursos: bateria à chegada ~40%' }, noite)
    assert.match(t, /recursos: bateria à chegada ~40%/)
    assert.match(t, /recursos: gasóleo sem leitura/)
    // tudo lido (a forma real): nada
    assert.doesNotMatch(await faixa(REC_LIDOS, noite), /sem leitura/)
  }
  // um plugin de antes (só o semLeitura dos dois): fica o texto de sempre
  assert.match(await faixa({ gasoleoChegadaL: null, bateriaChegadaPct: null, semLeitura: true, aviso: null }), /recursos: sem leitura/)
  assert.doesNotMatch(await faixa({ gasoleoChegadaL: 80, bateriaChegadaPct: 90, semLeitura: false, aviso: null }), /sem leitura/)
})

test('F9 (item 3, F2b Menor 6): com a viagem seguinte aberta e o «cheguei bem» da viagem ANTERIOR por entregar (fechoPorEntregar.doPlanoAnterior), o Leme di-lo — "o «cheguei bem» da viagem anterior ainda não chegou a terra: liga-lhes (Mãe)" — no mosaico "Contactos em terra", uma só vez no ecrã (não na faixa), também em pausa, mesmo sem o plano novo ter ido a terra; o deste plano (doPlanoAnterior false) e um plugin de antes não dizem "anterior"', async () => {
  const frase = 'o «cheguei bem» da viagem anterior ainda não chegou a terra: liga-lhes (Mãe)'
  for (const noite of [false, true]) {
    // a viagem 2 acabada de ativar: o plano novo ainda não foi a terra (envio null) e já navega, ou à espera de sair
    for (const estado of ['a navegar', 'à espera de sair']) {
      const html = melhor.render(await leme({ ...PLANO, estado, envio: null, fechoPorEntregar: FECHO_DA_VIAGEM_ANTERIOR }, { noite }))
      limpo(html, `anterior ${estado}`)
      const t = texto(html)
      assert.ok(t.includes(frase), t)
      assert.match(html, /class="[^"]*avisos-terra/, 'no mosaico "Contactos em terra"')
      assert.equal(t.split('da viagem anterior').length - 1, 1, 'uma só vez no ecrã (o mosaico, não a faixa)')
      assert.doesNotMatch(t, /liga-o em Plugin Config|o plugin porto/, 'o erro técnico não vai para o ecrã')
    }
    // com o plano novo já entregue a terra (envio): a linha fica, ao lado das de terra
    const t1 = texto(melhor.render(await leme({ ...PLANO, fechoPorEntregar: FECHO_DA_VIAGEM_ANTERIOR }, { noite })))
    assert.ok(t1.includes(frase) && t1.includes('contactos em terra: alarme'), t1)
    // em pausa, o mosaico fica (uma só vez)
    const pausa = melhor.render(await leme({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar', fechoPorEntregar: FECHO_DA_VIAGEM_ANTERIOR }, { noite }))
    limpo(pausa, 'anterior em pausa')
    assert.equal(texto(pausa).split(frase).length - 1, 1, texto(pausa))
  }
  // a «viagem terminada» da viagem anterior
  assert.ok(texto(melhor.render(await leme({ ...PLANO, fechoPorEntregar: { ...FECHO_DA_VIAGEM_ANTERIOR, tipo: 'terminado' } }))).includes('a «viagem terminada» da viagem anterior ainda não chegou a terra: liga-lhes (Mãe)'))
  // vários contactos
  assert.ok(texto(melhor.render(await leme({ ...PLANO, fechoPorEntregar: { ...FECHO_DA_VIAGEM_ANTERIOR, contactos: ['Pai', 'Mãe'] } }))).includes('da viagem anterior ainda não chegou a terra: liga-lhes (Pai, Mãe)'))
  // o deste plano (false), um plugin de antes (sem o campo) e sem fecho por entregar: nunca "anterior"
  for (const f of [{ ...FECHO_DA_VIAGEM_ANTERIOR, doPlanoAnterior: false }, { tipo: 'chegada', contactos: ['Mãe'], tentativas: 1, erro: null }, null]) {
    assert.doesNotMatch(texto(melhor.render(await leme({ ...PLANO, fechoPorEntregar: f }))), /da viagem anterior/)
  }
  // os nomes passam pelo esc
  const html = melhor.render(await leme({ ...PLANO, fechoPorEntregar: { ...FECHO_DA_VIAGEM_ANTERIOR, contactos: ['<i>Mãe</i>'] } }))
  assert.match(html, /da viagem anterior ainda não chegou a terra: liga-lhes \(&lt;i&gt;Mãe&lt;\/i&gt;\)/)
  assert.doesNotMatch(html, /<i>Mãe<\/i>/)
})
