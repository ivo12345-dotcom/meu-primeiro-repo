'use strict'
// Os contactos em terra e o REST do plano ativo no plugin (desenho 3b-2): "cheguei bem" uma vez, o
// atraso com a nova hora de alarme, "viagem terminada", a fila sem o porto, o reinício sem repetir,
// Recalcular → Ativar com o plano enviado (o plano novo segue com "Este plano substitui o anterior"),
// e GET /plano-ativo, POST /plano-ativo/terminar e /continuar.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const pa = require('../lib/plano-ativo')
const prev = require('../lib/previsao')
const { appFalso, plugin, chamar, calcular, fetchFalso, H } = require('./ajuda')

const MIN = 60000
const NO = 1852 / 3600

// Cascais → Algés (a melhor sai amanhã às 09:30), o plano enviado à Mãe e ativado. O porto falso
// responde a cada 'arlequin:plano' (resposta: a função que decide o que responde; null não responde).
async function preparar ({ enviar = true, alternativa = 0 } = {}) {
  const app = appFalso()
  const agendados = []
  const pl = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {}, agendar: (fn, ms) => { agendados.push({ fn, ms }); return agendados.length }, cancelar: () => {} })
  pl.p.start({ pasta: path.join(app.dir, 'dados') })
  const recebidos = []
  const porto = { resposta: (e) => ({ pedido: e.pedido, entregues: ['chat 111', ...(e.contactos || ['Mãe'])], contactos: e.contactos || ['Mãe'], falhas: [] }) }
  app.on('arlequin:plano', (e) => { recebidos.push(e); const r = porto.resposta(e); if (r) app.emit('arlequin:plano-enviado', r) })
  const { id, resultado } = await calcular(pl.r, { destino: 'alges', tripulacao: 'so' })
  if (enviar) await chamar(pl.r.post['/plano-telegram'], { body: { id, alternativa } })
  const a = await chamar(pl.r.post['/ativar'], { body: { id, alternativa } })
  assert.equal(a.code, 200, a.erro)
  const alt = resultado.alternativas[alternativa]
  const t0 = Date.parse(alt.partida)
  const pontos = [...alt.rasto.filter((_, i) => i % 5 === 0), alt.rasto.at(-1)].map(p => ({ lat: p.lat, lon: p.lon }))
  prev.guardarArquivo(path.join(app.dir, 'dados', 'previsoes'), await prev.obterPrevisao({ pontos, agora: t0, fetch: fetchFalso() }))
  recebidos.length = 0
  const por = (p, sogNos = 4.3) => { app.self['navigation.position'] = { latitude: p.lat, longitude: p.lon }; app.self['navigation.speedOverGround'] = sogNos * NO }
  const ciclo = async (ms = MIN) => { pl.avancar(ms); await pl.p.cicloNavegar() }
  return { app, ...pl, id, resultado, alt, t0, recebidos, porto, agendados, por, ciclo }
}
// sai e anda pelo rasto até ao minuto m (ao ritmo do plano)
async function sair (s) {
  s.acertar(s.t0)
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
}
const plano = (s) => pa.ler(s.app.getDataDirPath()).plano

test('GET /plano-ativo: 404 sem plano; com ele, o estado, o destino, o atraso, o próximo evento, a chegada agora e a do plano, os recursos e a fila dos contactos', async () => {
  const app = appFalso()
  const { p, r } = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {} })
  p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal((await chamar(r.get['/plano-ativo'])).code, 404)
  p.stop()
  const s = await preparar()
  let g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.code, 200)
  assert.equal(g.estado, 'a espera de sair')
  assert.deepEqual(g.destino, { id: 'alges', nome: 'Algés (CNA)' })
  assert.equal(g.tripulacao, 'so')
  assert.equal(g.chegadaPlano, s.alt.chegada.p50)
  assert.deepEqual(g.filaContactos, [])
  assert.deepEqual(g.envio.contactos, ['Mãe'])
  await sair(s)
  for (let m = 1; m <= 5; m++) { s.por(s.alt.rasto[2]); await s.ciclo() }
  g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.estado, 'a navegar')
  assert.ok(Number.isInteger(g.atrasoMin) && g.atrasoMin > 0, g.atrasoMin)
  assert.equal(g.chegadaAgora, new Date(Date.parse(s.alt.chegada.p50) + Math.round(s.p.acompanhamento().atrasoMin) * MIN).toISOString())
  assert.equal(typeof g.proximo.texto, 'string')
  assert.match(g.proximo.hora, /^\d{4}-/)
  assert.equal(g.recursos.semLeitura, false)
  assert.ok(Number.isFinite(g.recursos.gasoleoChegadaL))
  assert.ok(Number.isFinite(g.recursos.bateriaChegadaPct))
  assert.equal(g.semGps, false)
  assert.equal(g.barometro.semLeitura, true)
  s.p.stop()
})

test('"Cheguei bem a X às HH:MM" na chegada, uma vez, aos contactos do plano (tipo chegada, sem GPX), com a hora a que saiu; nada se repete depois de um reinício', async () => {
  const s = await preparar()
  await sair(s)
  const cais = s.alt.pontosRota.at(-1)
  s.por(cais, 0)
  for (let m = 0; m <= 5; m++) await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  const chegadas = s.recebidos.filter(e => e.tipo === 'chegada')
  assert.equal(chegadas.length, 1)
  assert.match(chegadas[0].texto, /^Cheguei bem a Algés \(CNA\) às \d\d:\d\d\. Obrigado!$/)
  assert.deepEqual(chegadas[0].contactos, ['Mãe'])
  assert.equal(chegadas[0].destinatarios, 'contactos-do-plano')
  assert.equal(chegadas[0].gpx, undefined)
  assert.deepEqual(plano(s).contactos.fila, [])
  const enviada = plano(s).contactos.enviadas.find(m => m.tipo === 'chegada')
  assert.equal(enviada.enviadaEm, new Date(s.agora()).toISOString())
  assert.deepEqual(enviada.contactos, ['Mãe'])
  // todos os avisos a normal
  assert.deepEqual(Object.entries(s.app.self).filter(([k, v]) => k.startsWith('notifications.rota.') && v.state !== 'normal'), [])
  for (let m = 0; m < 10; m++) await s.ciclo()
  s.p.stop()
  const q = plugin(s.app, { agendarCiclo: () => 1, pararCiclo: () => {} })
  q.acertar(s.agora())
  q.p.start({ pasta: path.join(s.app.dir, 'dados') })
  for (let m = 0; m < 5; m++) { q.avancar(MIN); await q.p.cicloNavegar() }
  assert.equal(s.recebidos.filter(e => e.tipo === 'chegada').length, 1)
  q.p.stop()
})

test('atraso: quando a chegada prevista passa da "mais tarde" do plano, "Ainda a navegar…" com a nova hora de alarme; depois, no máximo 1× por hora e só com mais 15 min', async () => {
  const s = await preparar()
  await sair(s)
  s.por(s.alt.rasto[2], 0) // parado: o atraso cresce
  const atrasos = () => s.recebidos.filter(e => e.tipo === 'atraso')
  const minutos = [] // o minuto de cada envio
  for (let m = 1; m <= 90; m++) { const n = atrasos().length; await s.ciclo(); if (atrasos().length > n) minutos.push(m) }
  assert.equal(minutos.length, 2, JSON.stringify(minutos))
  assert.ok(minutos[0] <= 5, 'logo que passa da mais tarde do plano')
  assert.equal(minutos[1] - minutos[0], 60, 'no máximo 1× por hora (o escorregamento já passa dos 15 min)')
  assert.match(atrasos()[0].texto, /^Ainda a navegar, tudo bem\. Nova chegada prevista ~\d\d:\d\d\. Nova hora de alarme: \d\d:\d\d \(em vez de \d\d:\d\d\)\.$/)
  assert.deepEqual(atrasos()[0].contactos, ['Mãe'])
  // a nova hora de alarme do 2.º é "em vez de" a do 1.º
  const alarme1 = atrasos()[0].texto.match(/Nova hora de alarme: (\d\d:\d\d)/)[1]
  assert.match(atrasos()[1].texto, new RegExp(`\\(em vez de ${alarme1}\\)`))
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.notEqual(g.envio.alarme, g.envio.alarmePlano)
  s.p.stop()
})

test('sem plano enviado (ou só ao chat do Ivo) nada segue para terra', async () => {
  const s = await preparar({ enviar: false })
  await sair(s)
  s.por(s.alt.rasto[2], 0)
  for (let m = 1; m <= 40; m++) await s.ciclo()
  assert.deepEqual(s.recebidos, [])
  s.p.stop()
})

test('fila sem rede: o porto sem responder (30 s) ou desligado, a mensagem fica na fila e volta a tentar de 2 em 2 min; descarta o atraso depois de "terminada"', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null // o porto não responde
  s.por(s.alt.rasto[2], 0)
  for (let m = 1; m <= 30; m++) await s.ciclo()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 1)
  // os 30 s do porto (o temporizador injetado)
  s.agendados.at(-1).fn()
  let f = (await chamar(s.r.get['/plano-ativo'])).filaContactos
  assert.equal(f.length, 1)
  assert.equal(f[0].tipo, 'atraso')
  assert.equal(f[0].erro, 'o plugin porto não respondeu (está ligado? tem o token?)')
  await s.ciclo()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 1, 'ainda não passaram 2 min')
  await s.ciclo()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 2, 'nova tentativa')
  s.agendados.at(-1).fn()
  // Terminar: o atraso que estava na fila deixa de interessar; o porto desligado (sem ouvintes)
  s.app.removeAllListeners('arlequin:plano')
  const t = await chamar(s.r.post['/plano-ativo/terminar'])
  assert.equal(t.code, 200)
  f = (await chamar(s.r.get['/plano-ativo'])).filaContactos
  assert.deepEqual(f.map(x => x.tipo), ['terminado'])
  assert.match(f[0].erro, /porto está desligado/)
  s.p.stop()
})

test('POST /plano-ativo/terminar: "Viagem terminada / mudança de planos: estou bem, em <posição> às HH:MM" aos contactos; o plano fecha e os avisos voltam a normal; sem plano aberto, 409', async () => {
  const s = await preparar()
  await sair(s)
  await s.ciclo(13 * H)
  assert.equal(s.app.self['notifications.rota.previsao'].state, 'alarm')
  const t = await chamar(s.r.post['/plano-ativo/terminar'])
  assert.deepEqual(t, { code: 200, ok: true, estado: 'terminado', contactos: true })
  assert.equal(plano(s).estado, 'terminado')
  const m = s.recebidos.filter(e => e.tipo === 'terminado')
  assert.equal(m.length, 1)
  assert.match(m[0].texto, /^Viagem terminada \/ mudança de planos: estou bem, em \d+°\d+,\d' N \d+°\d+,\d' W às \d\d:\d\d\.$/)
  assert.equal(s.app.self['notifications.rota.previsao'].state, 'normal')
  assert.equal((await chamar(s.r.post['/plano-ativo/terminar'])).code, 409)
  // depois de "terminada", nenhum atraso
  const antes = s.recebidos.length
  for (let m = 0; m < 10; m++) await s.ciclo(H)
  assert.equal(s.recebidos.length, antes)
  s.p.stop()
})

test('POST /plano-ativo/continuar: só "pausado" (409 nos outros); volta a ativar a rota do plano no ponto seguinte e retoma o estado', async () => {
  const s = await preparar()
  await sair(s)
  assert.equal((await chamar(s.r.post['/plano-ativo/continuar'])).code, 409)
  const href = s.app.rotaAtiva
  s.app.rotaAtiva = '/resources/routes/outra'
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).estado, 'pausado')
  const n = s.app.ativacoes.length
  const c = await chamar(s.r.post['/plano-ativo/continuar'])
  assert.deepEqual(c, { code: 200, ok: true, estado: 'a navegar' })
  assert.equal(s.app.ativacoes.length, n + 1)
  assert.equal(s.app.ativacoes.at(-1).href, href)
  assert.ok(s.app.ativacoes.at(-1).pointIndex >= 1)
  assert.equal(s.app.rotaAtiva, href)
  assert.equal(plano(s).estado, 'a navegar')
  // a API de rumo a falhar: 502 e continua pausado
  s.app.rotaAtiva = null
  await s.ciclo()
  s.app.activateRoute = async () => { throw new Error('a rota já não existe') }
  const e = await chamar(s.r.post['/plano-ativo/continuar'])
  assert.equal(e.code, 502)
  assert.equal(e.erro, 'não ativei a rota: a rota já não existe')
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  // a rota mudada nunca manda nada sozinha para terra
  assert.deepEqual(s.recebidos.filter(e => e.tipo !== 'atraso'), [])
  s.p.stop()
})

test('Recalcular → Ativar com o plano enviado: o plano novo (texto + GPX) segue aos mesmos contactos com "Este plano substitui o anterior" e a nova hora de alarme; um cálculo antigo (422) não ativa e o plano antigo fica', async () => {
  const s = await preparar()
  await sair(s)
  const antigo = s.p.planoAtivo()
  const n = s.app.ativacoes.length
  const b = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(b.code, 200, b.erro)
  assert.equal(s.app.ativacoes.length, n + 1)
  const planos = s.recebidos.filter(e => e.tipo === 'plano')
  assert.equal(planos.length, 1)
  assert.match(planos[0].texto, /^PLANO DE NAVEGAÇÃO · ARLEQUIN\nEnviado [^\n]+\nEste plano substitui o anterior\.\n/)
  assert.match(planos[0].texto, /Hora de alarme: /)
  assert.match(planos[0].gpx, /^<\?xml/)
  assert.match(planos[0].nomeFicheiro, /\.gpx$/)
  assert.deepEqual(planos[0].contactos, ['Mãe'])
  const novo = plano(s)
  assert.equal(novo.indice, 1)
  assert.deepEqual(novo.envio.contactos, ['Mãe'])
  assert.notEqual(novo.envio.alarme, antigo.envio.alarme)
  assert.equal(novo.contactos.enviadas.at(-1).tipo, 'plano')
  // a mesma alternativa outra vez: não se reenvia
  await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(s.recebidos.filter(e => e.tipo === 'plano').length, 1)
  // um cálculo antigo: a partida da 2.ª (14:30) foi há mais de 1 h
  s.acertar(Date.parse(s.resultado.alternativas[1].partida) + 2 * H)
  const k = s.app.ativacoes.length
  const x = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })
  assert.equal(x.code, 422)
  assert.match(x.erro, /^este cálculo é antigo: /)
  assert.equal(plano(s).indice, 1)
  assert.equal(s.app.ativacoes.length, k, 'nada se ativou')
  assert.equal(s.recebidos.filter(e => e.tipo === 'plano').length, 1)
  s.p.stop()
})

test('sem o plano enviado, ativar outra alternativa não manda nada', async () => {
  const s = await preparar({ enviar: false })
  await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.deepEqual(s.recebidos, [])
  assert.equal(plano(s).indice, 1)
  s.p.stop()
})

