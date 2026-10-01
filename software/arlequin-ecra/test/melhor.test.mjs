// A página "Melhor rota" com estados (desenho 3b-1): Pedir, A calcular, Resultado, Mapa, Leme, erro e
// sem GPS, desenhados sem browser a partir de resultados gravados, de dia e de noite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import melhor from '../public/paginas/melhor.js'
import { lerPolar } from '../public/lib/polar.js'

const require = createRequire(import.meta.url)
const DESTINOS = require('../../signalk-arlequin-rota/dados/destinos.json')
const ler = (nome) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/resultado-${nome}.json.gz`, import.meta.url))))
const CANAL = ler('canal') // Peniche → Nazaré pelo Canal da Berlenga ("Espera")
const DIRETA = ler('direta') // Cascais → Algés, rota direta
const FUGA = ler('fuga') // Algés → Peniche, "sair agora": "Não recomendado sozinho", fugas com aviso vermelho
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const ROTA = '/plugins/signalk-arlequin-rota'
const polar = lerPolar(readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8'))
const PENICHE = { latitude: 39.3537, longitude: -9.3794 }
const proibido = /null|NaN|undefined|\[object/

// O contexto da página: valores do SignalK, o pedir falso (respostas por "MÉTODO url"), e o resto.
function contexto ({ valores = {}, respostas = {}, estado = {}, noite = false, semGps = false } = {}) {
  const v = { 'navigation.position': PENICHE, ...valores }
  const pedidos = []
  const agendados = []
  const guardados = {}
  const ctx = {
    v: (p) => (semGps && p === 'navigation.position' ? undefined : v[p]),
    idade: (p) => (p in v && !(semGps && p === 'navigation.position') ? 0 : Infinity),
    polar,
    estado,
    noite,
    agora: AGORA,
    pedidos,
    agendados,
    guardados,
    agendar: (f, ms) => agendados.push({ f, ms }),
    guardado: (k, def) => guardados[k] ?? def,
    guardar: (k, x) => { guardados[k] = JSON.parse(JSON.stringify(x)) },
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
const limpo = (html, nome) => assert.doesNotMatch(html, proibido, `${nome}: ${html.match(/.{60}(null|NaN|undefined).{20}/)?.[0]}`)
const semEspacos = (s) => s.replace(/\s+/g, ' ')
// o resultado pronto, como o estado da página depois de "A calcular"
const comResultado = (r, extra = {}) => ({ vista: 'resultado', resultado: r, idCalculo: 'calc-1', selecionada: 0, ultimoPedido: { destino: r.destino.id, tripulacao: r.tripulacao, sairAgora: false }, ...extra })

test('Pedir: os portos do mais perto para o mais longe, só eu / 2 ou mais, Calcular; de dia e de noite sem null/NaN', async () => {
  for (const noite of [false, true]) {
    const ctx = contexto({ respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } }, noite })
    melhor.aoEntrar(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    const html = melhor.render(ctx)
    limpo(html, 'pedir')
    const nomes = [...html.matchAll(/data-acao="rota-destino" data-id="([^"]+)"/g)].map(m => m[1])
    // estamos em Peniche: fica no topo da lista, "estás aqui", mas desativado (não é destino)
    assert.ok(!nomes.includes('peniche'), nomes.join())
    assert.match(semEspacos(html), /<tr class="desativado"[^>]*><td>Peniche<\/td><td class="lab">estás aqui<\/td><\/tr>/)
    assert.ok(html.indexOf('>Peniche<') < html.indexOf('data-id="nazare"'))
    assert.equal(nomes[0], 'nazare')
    assert.ok(nomes.indexOf('cascais') < nomes.indexOf('olhao'))
    assert.match(html, /Só eu/)
    assert.match(html, /2 ou mais/)
    assert.match(html, /data-acao="rota-calcular"/)
    assert.match(html, /\+ acrescentar/)
    assert.match(html, /\d+ MN/)
    assert.doesNotMatch(html, /rota-ativa/) // sem rota ativa no OpenCPN
  }
})

test('Pedir: com uma rota ativa no OpenCPN, ela vem no topo; e "Novo cálculo" a partir do Leme', async () => {
  const valores = { 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 1, 'navigation.course.nextPoint': { name: 'WP3' }, 'navigation.headingTrue': 1 }
  const ctx = contexto({ valores, respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } } })
  const leme = melhor.render(ctx)
  assert.match(leme, /Rumo a seguir/)
  assert.match(leme, /data-acao="rota-novo"[^>]*>Novo cálculo</)
  await melhor.acao('rota-novo', {}, ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const html = melhor.render(ctx)
  const ids = [...html.matchAll(/data-acao="rota-destino" data-id="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids[0], 'rota-ativa')
  assert.match(html, /Rota ativa no OpenCPN/)
  limpo(html, 'pedir com rota ativa')
})

test('Pedir: o porto onde estás não é destino (mesmo que tenha ficado escolhido): o Calcular fica desativado', async () => {
  const ctx = contexto({ respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } }, estado: { escolhido: 'peniche' } })
  melhor.aoEntrar(ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const html = melhor.render(ctx)
  assert.doesNotMatch(html, /data-acao="rota-destino" data-id="peniche"/)
  assert.match(html, /data-acao="rota-calcular" disabled/)
  await melhor.acao('rota-calcular', {}, ctx)
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 0)
})

test('sem GPS: "sem GPS: não dá para calcular" e o Calcular não pede nada; plugin desligado: caixa vermelha', async () => {
  const ctx = contexto({ semGps: true, respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } }, estado: { escolhido: 'nazare' } })
  melhor.aoEntrar(ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const html = melhor.render(ctx)
  assert.match(html, /sem GPS: não dá para calcular/)
  assert.match(html, /data-acao="rota-calcular" disabled/)
  await melhor.acao('rota-calcular', {}, ctx)
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 0)
  limpo(html, 'sem GPS')

  const desligado = contexto({ respostas: { [`GET ${ROTA}/destinos`]: new Error('Failed to fetch') } })
  melhor.aoEntrar(desligado)
  await new Promise(resolve => setTimeout(resolve, 0))
  const h2 = melhor.render(desligado)
  assert.match(h2, /class="tile caixa-erro"[^>]*>[^<]*o plugin da rota não responde/)
  const parado = contexto({ respostas: { [`GET ${ROTA}/destinos`]: erroHttp(503, 'o plugin da rota não está ligado') } })
  melhor.aoEntrar(parado)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(melhor.render(parado), /o plugin da rota não responde[^<]*\(o plugin da rota não está ligado\)/)
})

test('Calcular → A calcular (de 1 em 1 s, com o progresso) → Resultado', async () => {
  const respostas = {
    [`GET ${ROTA}/destinos`]: { destinos: DESTINOS },
    [`POST ${ROTA}/calcular`]: { id: 'calc-9' },
    [`GET ${ROTA}/resultado/calc-9`]: [
      { estado: 'a calcular', progresso: 0.42, texto: 'a simular a partida às 18:30 (3 de 17)' },
      { estado: 'pronto', progresso: 1, texto: 'pronto', resultado: CANAL }
    ]
  }
  const ctx = contexto({ respostas })
  await melhor.acao('rota-destino', { id: 'nazare' }, ctx)
  await melhor.acao('rota-tripulacao', { t: 'acompanhado' }, ctx)
  assert.match(melhor.render(ctx), /class="acao go" data-acao="rota-tripulacao" data-t="acompanhado"/)
  await melhor.acao('rota-calcular', {}, ctx)
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST').body, { destino: 'nazare', tripulacao: 'acompanhado', sairAgora: false })
  const aCalcular = melhor.render(ctx)
  assert.match(aCalcular, /A calcular/)
  assert.match(aCalcular, /a simular a partida às 18:30 \(3 de 17\)/)
  assert.match(aCalcular, /42%/)
  limpo(aCalcular, 'a calcular')
  assert.equal(ctx.agendados.length, 1)
  assert.equal(ctx.agendados[0].ms, 1000)
  await ctx.agendados[0].f()
  assert.equal(ctx.estado.vista, 'resultado')
  assert.match(melhor.render(ctx), /Espera até amanhã às 09:30/)
  assert.equal(ctx.agendados.length, 1, 'pronto: não pede mais')
})

test('um cálculo já a correr (409): segue esse; o cálculo com erro mostra o motivo do plugin', async () => {
  const ocupado = contexto({ estado: { escolhido: 'nazare' }, respostas: { [`POST ${ROTA}/calcular`]: Object.assign(erroHttp(409, 'já há um cálculo a correr'), { corpo: { id: 'calc-0' } }), [`GET ${ROTA}/resultado/calc-0`]: { estado: 'erro', erro: 'Sem previsão que cubra a rota: sem rede. Não calculo sem previsão.' } } })
  await melhor.acao('rota-calcular', {}, ocupado)
  assert.equal(ocupado.estado.vista, 'erro')
  const html = melhor.render(ocupado)
  assert.match(html, /class="tile caixa-erro"[^>]*>Sem previsão que cubra a rota: sem rede\. Não calculo sem previsão\./)
  // seguiu o cálculo de outro pedido (409): não se sabe o destino dele, só "Novo cálculo"
  assert.doesNotMatch(html, /data-acao="rota-repetir"/)
  assert.match(html, /data-acao="rota-novo"/)
  limpo(html, 'erro')
})

for (const [nome, r, espera] of [
  ['canal', CANAL, { cor: 'amarelo', texto: 'Espera até amanhã às 09:30', rota: '5 MN pelo Canal da Berlenga, só motor', vermelho: 'Canal da Berlenga: terra dos dois lados; só com ondas &lt; 3 m — por confirmar na carta' }],
  ['direta', DIRETA, { cor: 'amarelo', texto: 'Espera até amanhã às 09:30', rota: 'direta (salto curto)', vermelho: null }],
  ['fuga', FUGA, { cor: 'laranja', texto: 'Não recomendado sozinho', rota: '5 MN, só motor', vermelho: 'Fuga às 19:16 (Cabo Raso) para Cascais e Algés (CNA)' }]
]) {
  test(`Resultado (${nome}): faixa, 3 cartões, linha do tempo, avisos vermelhos, precauções, desistência e botões — de dia e de noite`, () => {
    for (const noite of [false, true]) {
      const ctx = contexto({ estado: comResultado(r), noite })
      const html = melhor.render(ctx)
      limpo(html, `resultado ${nome}`)
      assert.match(html, new RegExp(`class="faixa ${espera.cor}"`))
      assert.ok(html.includes(espera.texto), espera.texto)
      for (const p of r.veredicto.porque) assert.ok(semEspacos(html).includes(semEspacos(p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))), p)
      assert.equal((html.match(/data-acao="rota-escolher"/g) || []).length, r.alternativas.length)
      assert.match(html, /class="tile cartao sel/)
      assert.ok(html.includes(espera.rota), espera.rota)
      assert.match(html, /recomendada|não recomendada/)
      assert.match(html, /previsão das 15:00 \(há 32 min\)/)
      assert.match(html, /Linha do tempo/)
      assert.ok(html.includes(r.alternativas[0].eventos.at(-1).texto))
      assert.match(html, /Avisos vermelhos/)
      if (espera.vermelho) assert.ok(html.includes(espera.vermelho), espera.vermelho)
      assert.match(html, /Precauções/)
      for (const pc of r.alternativas[0].precaucoes) assert.ok(html.includes(`data-acao="rota-precaucao" data-id="${pc.id}"`), pc.id)
      assert.match(html, /Pontos de desistência/)
      assert.ok(html.includes(r.desistenciaResumo.replace(/</g, '&lt;')), 'resumo da desistência')
      for (const b of ['rota-mapa', 'rota-plano', 'rota-ativar', 'rota-sair-agora', 'rota-novo']) assert.match(html, new RegExp(`data-acao="${b}"`), b)
      assert.match(html, /Ativar esta rota/)
      assert.match(html, /Sair agora mesmo assim/)
    }
  })
}

test('Resultado: os números do cartão (partida, chegada com a margem, milhas, horas, máximos, gasóleo, bateria)', () => {
  const ctx = contexto({ estado: comResultado(FUGA, { selecionada: 1 }) })
  const html = semEspacos(melhor.render(ctx))
  const a = FUGA.alternativas[1]
  // partida 15:32, chegada provável 07:24 (amanhã), entre 06:42 e 07:59
  assert.match(html, /15:32 → amanhã 07:24/)
  assert.match(html, /chegada \(cedo–tarde\): amanhã 06:42–07:59/)
  assert.equal(a.milhas, 63.58)
  assert.match(html, /63,6 MN/)
  assert.match(html, /vela [\d,]+ h · motor [\d,]+ h · noite [\d,]+ h · leme [\d,]+ h/)
  assert.match(html, /vento [\d,]+ · rajada [\d,]+ nós · ondas [\d,]+ m/)
  assert.match(html, /gasóleo [\d,]+ L \(pior [\d,]+ L\)/)
  assert.match(html, /bateria mín\. [\d,]+%/)
  // os avisos da rota que não são vermelhos ficam no cartão (ex.: o salto curto da rota direta)
  assert.match(melhor.render(contexto({ estado: comResultado(DIRETA) })), /<div class="lab atencao">salto curto entre portos vizinhos: rota direta junto à costa<\/div>/)
  // a 2.ª não tem os pontos de desistência (calculados para a 1.ª)
  assert.match(html, /calculados para a 1\.ª alternativa/)
  // tocar num cartão muda a selecionada
  return melhor.acao('rota-escolher', { i: '2' }, ctx).then(() => assert.equal(ctx.estado.selecionada, 2))
})

test('precauções: as caixas marcam-se e ficam guardadas por cálculo', async () => {
  const ctx = contexto({ estado: comResultado(CANAL) })
  await melhor.acao('rota-precaucao', { id: 'vhf' }, ctx)
  assert.match(melhor.render(ctx), /data-acao="rota-precaucao" data-id="vhf"[^>]*>☑/)
  assert.match(melhor.render(ctx), /data-acao="rota-precaucao" data-id="telemovel"[^>]*>☐/)
  assert.deepEqual(ctx.guardados['arlequin.precaucoes'], { 'calc-1': { vhf: true } })
  await melhor.acao('rota-precaucao', { id: 'vhf' }, ctx)
  assert.match(melhor.render(ctx), /data-acao="rota-precaucao" data-id="vhf"[^>]*>☐/)
  // outro ecrã (estado novo) lê as marcas guardadas para o mesmo cálculo
  const ctx2 = contexto({ estado: comResultado(CANAL) })
  ctx2.guardados['arlequin.precaucoes'] = { 'calc-1': { barra: true } }
  assert.match(melhor.render(ctx2), /data-acao="rota-precaucao" data-id="barra"[^>]*>☑/)
})

test('Enviar plano: POST e depois GET até "enviado" → "enviado ✓ a 2 contactos" e a precaução do plano marcada; "falhou" com o motivo', async () => {
  const respostas = {
    [`POST ${ROTA}/plano-telegram`]: { pedido: 'p-1' },
    [`GET ${ROTA}/plano-telegram/p-1`]: [{ estado: 'a enviar', entregues: [], falhas: [] }, { estado: 'enviado', entregues: ['chat 111', 'Mãe'], falhas: [] }]
  }
  const ctx = contexto({ estado: comResultado(FUGA, { selecionada: 0 }), respostas })
  await melhor.acao('rota-plano', {}, ctx)
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST').body, { id: 'calc-1', alternativa: 0 })
  assert.match(melhor.render(ctx), /a enviar o plano/)
  await ctx.agendados.shift().f()
  const html = melhor.render(ctx)
  assert.match(html, /enviado ✓ a 2 contactos/)
  assert.match(html, /data-acao="rota-precaucao" data-id="plano"[^>]*>☑/)
  assert.match(html, /data-acao="rota-precaucao" data-id="plano-hora"[^>]*>☑/)

  const falha = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/plano-telegram`]: { pedido: 'p-2' }, [`GET ${ROTA}/plano-telegram/p-2`]: { estado: 'falhou', entregues: [], falhas: [], motivo: 'o plugin porto não respondeu (está ligado? tem o token?)' } } })
  await melhor.acao('rota-plano', {}, falha)
  const h = melhor.render(falha)
  assert.match(h, /não foi possível enviar: o plugin porto não respondeu \(está ligado\? tem o token\?\)/)
  assert.match(h, /data-acao="rota-precaucao" data-id="plano"[^>]*>☐/)
  assert.match(h, /data-acao="rota-ativar"/, 'o resultado continua utilizável')
  const semPlugin = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/plano-telegram`]: erroHttp(503, 'o servidor não tem eventos: não dá para enviar o plano ao plugin porto') } })
  await melhor.acao('rota-plano', {}, semPlugin)
  assert.match(melhor.render(semPlugin), /não foi possível enviar: o servidor não tem eventos/)
})

test('Ativar esta rota: POST /ativar com a selecionada → a página passa ao Leme', async () => {
  const ctx = contexto({ estado: comResultado(DIRETA, { selecionada: 2 }), respostas: { [`POST ${ROTA}/ativar`]: { ok: true, rota: 'r1', href: '/resources/routes/r1', alternativa: DIRETA.alternativas[2].id, nota: null } } })
  await melhor.acao('rota-ativar', {}, ctx)
  assert.deepEqual(ctx.pedidos[0], { url: `${ROTA}/ativar`, method: 'POST', body: { id: 'calc-1', alternativa: 2 } })
  const html = melhor.render(ctx)
  assert.match(html, /Rota ativada/)
  assert.match(html, /data-acao="rota-novo"/)
  limpo(html, 'leme depois de ativar')
  const falha = contexto({ estado: comResultado(DIRETA), respostas: { [`POST ${ROTA}/ativar`]: erroHttp(502, 'não ativei a rota: /x respondeu 500') } })
  await melhor.acao('rota-ativar', {}, falha)
  assert.match(melhor.render(falha), /não ativei a rota: \/x respondeu 500/)
})

test('Sair agora mesmo assim: recalcula com sairAgora: true', async () => {
  const ctx = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-2' }, [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', resultado: FUGA } } })
  await melhor.acao('rota-sair-agora', {}, ctx)
  assert.deepEqual(ctx.pedidos[0].body, { destino: 'nazare', tripulacao: 'so', sairAgora: true })
  assert.equal(ctx.estado.vista, 'resultado')
  assert.match(melhor.render(ctx), /Não recomendado sozinho/)
})

test('Mapa: o SVG do mini-mapa; tocar num cartão muda a selecionada; de noite com a classe; sem mapa o botão fica desativado', async () => {
  const ctx = contexto({ estado: comResultado(CANAL) })
  await melhor.acao('rota-mapa', {}, ctx)
  let html = melhor.render(ctx)
  assert.match(html, /<svg class="mapa"/)
  assert.match(html, /<g class="alt sel" data-i="0"/)
  assert.equal((html.match(/data-acao="rota-escolher"/g) || []).length, 3)
  await melhor.acao('rota-escolher', { i: '1' }, ctx)
  html = melhor.render(ctx)
  assert.match(html, /<g class="alt sel" data-i="1"/)
  assert.match(html, /data-acao="rota-voltar"/)
  limpo(html, 'mapa')
  ctx.noite = true
  assert.match(melhor.render(ctx), /<svg class="mapa noite"/)
  // resultado de uma versão antiga, sem mapa
  const { mapa: _, ...antigo } = CANAL
  const h = melhor.render(contexto({ estado: comResultado(antigo) }))
  assert.match(h, /data-acao="rota-mapa" disabled/)
  assert.match(h, /sem o mapa/)
})

test('+ acrescentar: aqui ou por coordenadas, com o POST /destinos; o novo fica escolhido', async () => {
  const novo = { id: 'meu-baleal', nome: 'Baleal', largo: [39.37, -9.34], aproximacao: [[39.37, -9.34], [39.37, -9.34]], meu: true }
  const ctx = contexto({ respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS }, [`POST ${ROTA}/destinos`]: { ok: true, destino: novo } } })
  melhor.aoEntrar(ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  await melhor.acao('rota-acrescentar', {}, ctx)
  let html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-acr-aqui"/)
  assert.match(html, /data-acao="rota-acr-coord"/)
  await melhor.acao('rota-acr-coord', {}, ctx)
  html = melhor.render(ctx)
  assert.match(html, /id="rota-lat"/)
  assert.match(html, /id="rota-lon"/)
  await melhor.acao('rota-acr-gravar', { 'rota-nome': 'Baleal', 'rota-lat': '39,37', 'rota-lon': '9,34 W' }, ctx)
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST').body, { nome: 'Baleal', lat: 39.37, lon: -9.34, conhecido: false })
  assert.equal(ctx.estado.escolhido, 'meu-baleal')
  html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-destino" data-id="meu-baleal"/)
  // aqui: a posição atual
  await melhor.acao('rota-acr-aqui', {}, ctx)
  await melhor.acao('rota-acr-gravar', { 'rota-nome': 'Fundeadouro' }, ctx)
  assert.deepEqual(ctx.pedidos.filter(p => p.method === 'POST')[1].body, { nome: 'Fundeadouro', posicaoAtual: true, conhecido: false })
  // coordenadas inválidas: a explicação, sem pedir
  await melhor.acao('rota-acr-coord', {}, ctx)
  await melhor.acao('rota-acr-gravar', { 'rota-nome': 'X', 'rota-lat': 'abc', 'rota-lon': '' }, ctx)
  assert.match(melhor.render(ctx), /coordenadas inválidas/)
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 2)
})

test('rota ativa sem o rumo calculado (o SignalK só manda navigation.course.activeRoute): Leme à espera; "Novo cálculo" põe-na no topo do Pedir', async () => {
  const valores = { 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche (Amanhã às 08:00, 5 MN, só motor)', pointIndex: 1, pointTotal: 57 } }
  const ctx = contexto({ valores, respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } } })
  const leme = melhor.render(ctx)
  assert.match(leme, /Rota ativa/)
  assert.match(leme, /Arlequin → Peniche \(Amanhã às 08:00, 5 MN, só motor\)/)
  assert.match(leme, /data-acao="rota-novo"/)
  limpo(leme, 'leme sem rumo')
  await melhor.acao('rota-novo', {}, ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const html = melhor.render(ctx)
  const ids = [...html.matchAll(/data-acao="rota-destino" data-id="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids[0], 'rota-ativa')
  assert.match(html, /Arlequin → Peniche \(Amanhã/)
})

// ---------- revisão das Tasks 5–7 ----------
const ROTA_ATIVA = { 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 1, 'navigation.course.nextPoint': { name: 'WP3' }, 'navigation.headingTrue': 1 }
const CALCULO_PERDIDO = 'este cálculo já não existe no plugin (reiniciado?): calcula outra vez'

test('+ acrescentar: o que se escreve fica no estado (um re-render não o apaga) e o Gravar usa-o; o valor escapa-se', async () => {
  const novo = { id: 'meu-baleal', nome: 'Baleal', largo: [39.37, -9.34], aproximacao: [[39.37, -9.34], [39.37, -9.34]], meu: true }
  const ctx = contexto({ respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS }, [`POST ${ROTA}/destinos`]: { ok: true, destino: novo } } })
  await melhor.acao('rota-acrescentar', {}, ctx)
  await melhor.acao('rota-acr-coord', {}, ctx)
  let html = melhor.render(ctx)
  for (const id of ['rota-nome', 'rota-lat', 'rota-lon']) assert.match(html, new RegExp(`id="${id}" data-campo="${id}"`), id)
  await melhor.acao('campo', { campo: 'rota-nome', valor: 'Baleal "norte"' }, ctx)
  await melhor.acao('campo', { campo: 'rota-lat', valor: '39,37' }, ctx)
  await melhor.acao('campo', { campo: 'rota-lon', valor: '9,34 W' }, ctx)
  // tocar no "conheço este sítio" re-renderiza: o texto continua lá
  await melhor.acao('rota-acr-conhecido', {}, ctx)
  html = melhor.render(ctx)
  assert.match(html, /id="rota-nome" data-campo="rota-nome" value="Baleal &quot;norte&quot;"/)
  assert.match(html, /id="rota-lat" data-campo="rota-lat" value="39,37"/)
  assert.match(html, /id="rota-lon" data-campo="rota-lon" value="9,34 W"/)
  assert.match(html, /☑ conheço este sítio/)
  // o Gravar sem nada nos dados (o ecrã já re-renderizou) usa o estado
  await melhor.acao('rota-acr-gravar', {}, ctx)
  assert.deepEqual(ctx.pedidos.find(p => p.method === 'POST').body, { nome: 'Baleal "norte"', lat: 39.37, lon: -9.34, conhecido: true })
  // gravado: o formulário seguinte começa vazio
  await melhor.acao('rota-acrescentar', {}, ctx)
  await melhor.acao('rota-acr-aqui', {}, ctx)
  assert.match(melhor.render(ctx), /id="rota-nome" data-campo="rota-nome" value=""/)
  // o Cancelar também limpa
  await melhor.acao('campo', { campo: 'rota-nome', valor: 'x' }, ctx)
  await melhor.acao('rota-acr-cancelar', {}, ctx)
  await melhor.acao('rota-acrescentar', {}, ctx)
  await melhor.acao('rota-acr-aqui', {}, ctx)
  assert.match(melhor.render(ctx), /value=""/)
})

test('"Novo cálculo" por engano com uma rota ativa: o Pedir tem "Voltar ao leme"; voltar à página também repõe o Leme', async () => {
  const ctx = contexto({ valores: ROTA_ATIVA, respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } } })
  await melhor.acao('rota-novo', {}, ctx)
  let html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-voltar-leme"[^>]*>Voltar ao leme</)
  await melhor.acao('rota-voltar-leme', {}, ctx)
  assert.match(melhor.render(ctx), /Rumo a seguir/)
  // sair da página e voltar (aoEntrar) com o Pedir aberto: o Leme volta
  await melhor.acao('rota-novo', {}, ctx)
  assert.doesNotMatch(melhor.render(ctx), /Rumo a seguir/)
  melhor.aoEntrar(ctx)
  assert.match(melhor.render(ctx), /Rumo a seguir/)
  // sem rota ativa não há "Voltar ao leme"
  html = melhor.render(contexto({ respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS } } }))
  assert.doesNotMatch(html, /rota-voltar-leme/)
})

test('Mapa: o erro do Ativar aparece no Mapa (caixa vermelha com o motivo)', async () => {
  const ctx = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/ativar`]: erroHttp(502, 'não ativei a rota: /x respondeu 500') } })
  await melhor.acao('rota-mapa', {}, ctx)
  await melhor.acao('rota-ativar', {}, ctx)
  const html = melhor.render(ctx)
  assert.match(html, /<svg class="mapa"/, 'continua no Mapa')
  assert.match(html, /class="tile caixa-erro"[^>]*>não ativei a rota: \/x respondeu 500/)
})

test('"Rota ativada": sai quando o SignalK confirma a rota (a partir daí manda a rota ativa) e, quando ela acaba, o ecrã volta ao resultado; sem confirmação em 2 min, explica', async () => {
  const valores = {}
  const ctx = contexto({ estado: comResultado(DIRETA), respostas: { [`POST ${ROTA}/ativar`]: { ok: true, rota: 'r1', href: '/resources/routes/r1', alternativa: 'x', nota: null } } })
  const v0 = ctx.v
  ctx.v = (p) => (p in valores ? valores[p] : v0(p)) // o SignalK a mudar durante o teste
  await melhor.acao('rota-ativar', {}, ctx)
  assert.match(melhor.render(ctx), /Rota ativada/)
  valores['navigation.course.activeRoute'] = { href: '/resources/routes/r1', name: 'Arlequin → Algés' }
  assert.match(melhor.render(ctx), /Rota ativa/)
  assert.equal(ctx.estado.ativada, false)
  delete valores['navigation.course.activeRoute']
  const html = melhor.render(ctx)
  assert.doesNotMatch(html, /Rota ativ/)
  assert.match(html, /data-acao="rota-ativar"/, 'o resultado outra vez')
  // ativada mas o SignalK nunca a mostra
  const sem = contexto({ estado: comResultado(DIRETA), respostas: { [`POST ${ROTA}/ativar`]: { ok: true, rota: 'r1', href: '/resources/routes/r1', alternativa: 'x', nota: null } } })
  await melhor.acao('rota-ativar', {}, sem)
  sem.agora += 60000
  assert.match(melhor.render(sem), /Rota ativada/)
  sem.agora += 61000
  const h2 = melhor.render(sem)
  assert.doesNotMatch(h2, /Rota ativada/)
  assert.match(h2, /ativei a rota, mas o SignalK não a mostra como ativa/)
})

test('erros em pt-PT, nunca o código HTTP cru: 404 do resultado = o cálculo já não existe; sem corpo = a explicação do código', async () => {
  const perdido = contexto({ estado: { escolhido: 'nazare' }, respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-7' }, [`GET ${ROTA}/resultado/calc-7`]: erroHttp(404, 'cálculo desconhecido') } })
  await melhor.acao('rota-calcular', {}, perdido)
  assert.equal(perdido.estado.erro, CALCULO_PERDIDO)
  assert.match(melhor.render(perdido), /data-acao="rota-repetir"/, 'o pedido é conhecido: dá para tentar outra vez')
  for (const [status, msg, espera] of [
    [500, '500', 'o plugin da rota deu um erro (HTTP 500)'],
    [401, '401', 'o SignalK recusou o pedido (sem sessão iniciada neste ecrã?): entra no SignalK e tenta outra vez'],
    [404, '404', 'o plugin da rota não responde'],
    [404, 'cálculo desconhecido', CALCULO_PERDIDO],
    [404, 'alternativa desconhecida', 'alternativa desconhecida'],
    [502, 'não ativei a rota: /x respondeu 500', 'não ativei a rota: /x respondeu 500']
  ]) {
    const a = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/ativar`]: erroHttp(status, msg), [`POST ${ROTA}/plano-telegram`]: erroHttp(status, msg) } })
    await melhor.acao('rota-ativar', {}, a)
    assert.equal(a.estado.msg, espera, `ativar ${status} ${msg}`)
    await melhor.acao('rota-plano', {}, a)
    assert.equal(a.estado.plano.motivo, espera, `plano ${status} ${msg}`)
  }
  const g = contexto({ respostas: { [`POST ${ROTA}/destinos`]: erroHttp(500, '500') } })
  await melhor.acao('rota-acrescentar', {}, g)
  await melhor.acao('rota-acr-aqui', {}, g)
  await melhor.acao('rota-acr-gravar', { 'rota-nome': 'X' }, g)
  assert.equal(g.estado.msgDestino, 'o plugin da rota deu um erro (HTTP 500)')
  const d = contexto({ respostas: { [`GET ${ROTA}/destinos`]: erroHttp(500, '500') } })
  melhor.aoEntrar(d)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(melhor.render(d), /o plugin da rota deu um erro \(HTTP 500\)/)
  // o envio do plano que o plugin já não conhece (reiniciado)
  const pl = contexto({ estado: comResultado(CANAL), respostas: { [`POST ${ROTA}/plano-telegram`]: { pedido: 'p-9', avisos: [] }, [`GET ${ROTA}/plano-telegram/p-9`]: erroHttp(404, 'pedido desconhecido') } })
  await melhor.acao('rota-plano', {}, pl)
  assert.equal(pl.estado.plano.motivo, 'este envio já não existe no plugin da rota (reiniciado?): confirma com os contactos se receberam')
})

test('toques duplos: o "Enviar plano" e o "Calcular" só pedem uma vez', async () => {
  const respostas = { [`POST ${ROTA}/plano-telegram`]: { pedido: 'p-1', avisos: [] }, [`GET ${ROTA}/plano-telegram/p-1`]: { estado: 'a enviar', entregues: [], falhas: [], avisos: [] } }
  const ctx = contexto({ estado: comResultado(FUGA), respostas })
  await Promise.all([melhor.acao('rota-plano', {}, ctx), melhor.acao('rota-plano', {}, ctx)])
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 1)
  await melhor.acao('rota-plano', {}, ctx) // ainda "a enviar"
  assert.equal(ctx.pedidos.filter(p => p.method === 'POST').length, 1)
  const c = contexto({ estado: { escolhido: 'nazare' }, respostas: { [`POST ${ROTA}/calcular`]: { id: 'calc-9' }, [`GET ${ROTA}/resultado/calc-9`]: { estado: 'a calcular', progresso: 0.1, texto: 'a começar' } } })
  await Promise.all([melhor.acao('rota-calcular', {}, c), melhor.acao('rota-calcular', {}, c)])
  assert.equal(c.pedidos.filter(p => p.method === 'POST').length, 1)
  assert.equal(c.agendados.length, 1, 'uma só cadeia de seguimento')
  await melhor.acao('rota-calcular', {}, c) // já a calcular
  assert.equal(c.pedidos.filter(p => p.method === 'POST').length, 1)
})

test('A calcular tem "Cancelar": deixa de seguir e volta ao Pedir, a dizer que o plugin continua a calcular', async () => {
  const ctx = contexto({ estado: { escolhido: 'nazare' }, respostas: { [`GET ${ROTA}/destinos`]: { destinos: DESTINOS }, [`POST ${ROTA}/calcular`]: { id: 'calc-9' }, [`GET ${ROTA}/resultado/calc-9`]: { estado: 'a calcular', progresso: 0.3, texto: 'a simular' } } })
  await melhor.acao('rota-calcular', {}, ctx)
  const html = melhor.render(ctx)
  assert.match(html, /data-acao="rota-cancelar"[^>]*>Cancelar</)
  assert.match(html, /o plugin continua a calcular/)
  await melhor.acao('rota-cancelar', {}, ctx)
  const pedidos = ctx.pedidos.length
  await ctx.agendados.shift().f() // o seguimento que estava marcado já não pede
  assert.equal(ctx.pedidos.length, pedidos)
  const pedir = melhor.render(ctx)
  assert.match(pedir, /Para onde\?/)
  assert.match(pedir, /o plugin da rota continua a calcular/)
})

test('Enter nos campos grava (o app.js re-renderiza depois: lib/interacao.js)', async () => {
  const novo = { id: 'meu-x', nome: 'X', largo: [39.37, -9.34], aproximacao: [[39.37, -9.34], [39.37, -9.34]], meu: true }
  const ctx = contexto({ respostas: { [`POST ${ROTA}/destinos`]: { ok: true, destino: novo } } })
  await melhor.acao('rota-acrescentar', {}, ctx)
  await melhor.acao('rota-acr-aqui', {}, ctx)
  await melhor.acao('campo', { campo: 'rota-nome', valor: 'X' }, ctx)
  await melhor.acao('enter', {}, ctx)
  assert.equal(ctx.estado.escolhido, 'meu-x')
})

test('precauções: o guardado estragado não rebenta (fica vazio) e só ficam os 10 cálculos mais recentes', async () => {
  for (const lixo of ['x', [1, 2], 7, null, { 'calc-0': 'lixo', 'calc-y': [1], 'calc-z': { vhf: true } }]) {
    const ctx = contexto({ estado: comResultado(CANAL) })
    ctx.guardados['arlequin.precaucoes'] = lixo
    assert.doesNotThrow(() => melhor.render(ctx))
    await melhor.acao('rota-precaucao', { id: 'vhf' }, ctx)
    const g = ctx.guardados['arlequin.precaucoes']
    assert.deepEqual(g['calc-1'], { vhf: true }, JSON.stringify(lixo))
    for (const v of Object.values(g)) assert.ok(v && typeof v === 'object' && !Array.isArray(v))
  }
  const ctx = contexto({ estado: comResultado(CANAL) })
  for (let k = 0; k < 12; k++) {
    ctx.estado.idCalculo = `c${k}`
    await melhor.acao('rota-precaucao', { id: 'vhf' }, ctx)
  }
  assert.deepEqual(Object.keys(ctx.guardados['arlequin.precaucoes']), ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'])
  // marcar de novo um antigo passa-o para o fim
  ctx.estado.idCalculo = 'c3'
  await melhor.acao('rota-precaucao', { id: 'barra' }, ctx)
  assert.equal(Object.keys(ctx.guardados['arlequin.precaucoes']).at(-1), 'c3')
})

test('Leme: o nome do próximo ponto escapa-se (pode vir de um destino escrito à mão)', () => {
  const ctx = contexto({ valores: { ...ROTA_ATIVA, 'navigation.course.nextPoint': { name: '<b>Praia & "Ursa"</b>' } } })
  const html = melhor.render(ctx)
  assert.ok(html.includes('&lt;b&gt;Praia &amp; &quot;Ursa&quot;&lt;/b&gt;'))
  assert.doesNotMatch(html, /<b>Praia/)
})

test('409: segue o cálculo que já corria, e o "Sair agora"/"Tentar outra vez" usam o destino desse cálculo (não o escolhido)', async () => {
  const ctx = contexto({
    estado: { escolhido: 'nazare' },
    respostas: {
      [`POST ${ROTA}/calcular`]: [Object.assign(erroHttp(409, 'já há um cálculo a correr'), { corpo: { id: 'calc-0' } }), { id: 'calc-2' }],
      [`GET ${ROTA}/resultado/calc-0`]: { estado: 'pronto', resultado: FUGA },
      [`GET ${ROTA}/resultado/calc-2`]: { estado: 'pronto', resultado: FUGA }
    }
  })
  await melhor.acao('rota-calcular', {}, ctx)
  assert.equal(ctx.estado.vista, 'resultado')
  assert.deepEqual(ctx.estado.ultimoPedido, { destino: FUGA.destino.id, tripulacao: FUGA.tripulacao, sairAgora: FUGA.sairAgora })
  await melhor.acao('rota-sair-agora', {}, ctx)
  assert.deepEqual(ctx.pedidos.filter(p => p.method === 'POST')[1].body, { destino: FUGA.destino.id, tripulacao: FUGA.tripulacao, sairAgora: true })
  // o seguido acaba em erro: não há "Tentar outra vez" (não se sabe o destino dele)
  const e = contexto({ estado: comResultado(CANAL, { escolhido: 'nazare' }), respostas: { [`POST ${ROTA}/calcular`]: Object.assign(erroHttp(409, 'já há um cálculo a correr'), { corpo: { id: 'calc-0' } }), [`GET ${ROTA}/resultado/calc-0`]: { estado: 'erro', erro: 'sem rede' } } })
  await melhor.acao('rota-calcular', {}, e)
  const html = melhor.render(e)
  assert.match(html, /sem rede/)
  assert.doesNotMatch(html, /rota-repetir/)
})

test('o aviso do plugin da rota (sem o telefone do Ivo) aparece com o estado do plano', async () => {
  const AVISO = 'o teu telefone não está na configuração: o plano diz só "liga ao Ivo"'
  const ctx = contexto({ estado: comResultado(FUGA), respostas: { [`POST ${ROTA}/plano-telegram`]: { pedido: 'p-1', avisos: [AVISO] }, [`GET ${ROTA}/plano-telegram/p-1`]: { estado: 'enviado', entregues: ['Mãe'], falhas: [], avisos: [AVISO] } } })
  await melhor.acao('rota-plano', {}, ctx)
  const html = melhor.render(ctx)
  assert.match(html, /enviado ✓ a 1 contacto/)
  assert.ok(html.includes(AVISO.replace(/"/g, '&quot;')), html)
})
