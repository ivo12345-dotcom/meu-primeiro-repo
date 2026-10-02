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
const { appFalso, plugin, chamar, calcular, fetchFalso, caisDe, costa, H, posNoRasto } = require('./ajuda')
const plano_ = require('../lib/plano')
const { horaLisboa, asHoras } = plano_

const MIN = 60000
const NO = 1852 / 3600

// Cascais → Algés (a melhor sai amanhã às 09:30), o plano enviado à Mãe e ativado. O porto falso
// responde a cada 'arlequin:plano' (resposta: a função que decide o que responde; null não responde).
async function preparar ({ enviar = true, alternativa = 0, contactos = [['Mãe', '222']] } = {}) {
  const app = appFalso()
  const agendados = []
  const pl = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {}, agendar: (fn, ms) => { agendados.push({ fn, ms }); return agendados.length }, cancelar: () => {} })
  pl.p.start({ pasta: path.join(app.dir, 'dados') })
  const recebidos = []
  const nomes = contactos.map(x => x[0]); const ids = contactos.map(x => x[1])
  const porto = { resposta: (e) => ({ pedido: e.pedido, entregues: ['chat 111', ...(e.contactos || nomes)], contactos: e.contactos || nomes, chats: e.chats || ids, falhas: [] }) }
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
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
}
const plano = (s) => pa.ler(s.app.getDataDirPath()).plano
// anda devagar pelo rasto, à fração f do ritmo do plano, a partir de agora e do ponto `desde` do rasto
// (revisão final C1: o atraso automático pede progresso real na rota; um barco parado não manda nada).
// → uma função que dá um ciclo (ms) com a posição do momento.
function devagar (s, f = 0.4, desde = s.alt.rasto[2]) {
  const t1 = s.agora()
  const p1 = Date.parse(desde.t)
  return async (ms = MIN) => {
    s.por(posNoRasto(s.alt.rasto, p1 + f * (s.agora() + ms - t1)), 4.2 * f)
    await s.ciclo(ms)
  }
}
// a rota mudada só pausa com ≥ 2 leituras seguidas e ≥ 2 min (Tarefa 8.3): 3 ciclos de minuto a minuto
async function pausar (s) { for (let m = 0; m < 3; m++) await s.ciclo() }
// segue o rasto até ao fim (um ponto por minuto: a chegada pede progresso na rota) e fica parado no
// cais do destino até chegar
async function chegar (s) {
  for (let k = 3; k < s.alt.rasto.length; k++) { s.por(s.alt.rasto[k]); await s.ciclo() }
  s.por(s.alt.pontosRota.at(-1), 0)
  for (let m = 0; m < 20 && s.p.planoAtivo().estado !== 'chegado'; m++) await s.ciclo()
}

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
  // o plano a que o ecrã liga o Terminar e as mensagens (9: nunca as de um plano antigo)
  assert.equal(g.ativadoEm, s.p.planoAtivo().ativadoEm)
  const cais = s.alt.pontosRota.at(-1)
  assert.deepEqual(g.destino, { id: 'alges', nome: 'Algés (CNA)', lat: cais.lat, lon: cais.lon })
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

test('"Cheguei bem a X qua 30/09 às HH:MM" na chegada (com o dia: decisão n.º 16), uma vez, aos contactos do plano (tipo chegada, sem GPX), com a hora a que saiu; nada se repete depois de um reinício', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  const chegadas = s.recebidos.filter(e => e.tipo === 'chegada')
  assert.equal(chegadas.length, 1)
  assert.equal(chegadas[0].texto, `Cheguei bem a Algés (CNA) ${plano_.diaEHora(Date.parse(s.p.planoAtivo().chegou))}. Obrigado!\nref. ${plano(s).contactos.enviadas.find(m => m.tipo === 'chegada').ref}`)
  assert.deepEqual(chegadas[0].contactos, ['Mãe'])
  assert.deepEqual(chegadas[0].chats, ['222'], 'o porto escolhe pelo chatId')
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

test('atraso: quando a chegada prevista passa 30 min ou mais da "mais tarde" do plano (decisão do Ivo), "Ainda a navegar…" com a nova hora de alarme; depois, no máximo 1× por hora e só com mais 15 min', async () => {
  const s = await preparar()
  await sair(s)
  // a andar devagar (40 % do ritmo do plano): o atraso cresce com progresso real na rota (revisão final
  // C1: parado não sai nenhum)
  const anda = devagar(s, 0.4)
  const atrasos = () => s.recebidos.filter(e => e.tipo === 'atraso')
  const p90 = Date.parse(s.alt.chegada.p90)
  const minutos = [] // o minuto de cada envio
  const margens = [] // chegada prevista − p90 (min), em cada minuto
  for (let m = 1; m <= 150; m++) {
    const n = atrasos().length
    await anda()
    margens.push((Date.parse((await chamar(s.r.get['/plano-ativo'])).chegadaAgora) - p90) / MIN)
    if (atrasos().length > n) minutos.push(m)
  }
  assert.equal(minutos.length, 2, JSON.stringify(minutos))
  // o 1.º logo que a chegada prevista passa 30 min da mais tarde do plano (com 29 ainda não)
  assert.ok(margens[minutos[0] - 1] >= 30, `${margens[minutos[0] - 1]}`)
  assert.ok(margens[minutos[0] - 2] < 30, `${margens[minutos[0] - 2]}`)
  assert.equal(minutos[1] - minutos[0], 60, 'no máximo 1× por hora (o escorregamento já passa dos 15 min)')
  assert.match(atrasos()[0].texto, /^Ainda a navegar, tudo bem\. Nova chegada prevista ~\d\d:\d\d\. Nova hora de alarme: \d\d:\d\d \(em vez de \d\d:\d\d\)\.\nref\. [A-Z]\d+$/)
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
  const anda = devagar(s, 0.4)
  for (let m = 1; m <= 120 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await anda()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 1)
  // os 30 s do porto (o temporizador injetado)
  s.agendados.at(-1).fn()
  let f = (await chamar(s.r.get['/plano-ativo'])).filaContactos
  assert.equal(f.length, 1)
  assert.equal(f[0].tipo, 'atraso')
  assert.equal(f[0].erro, 'o plugin porto não respondeu (está ligado? tem o token?)')
  await anda()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 1, 'ainda não passaram 2 min')
  await anda()
  assert.equal(s.recebidos.filter(e => e.tipo === 'atraso').length, 2, 'nova tentativa')
  // Tarefa 8.4: o reenvio leva a mesma referência ("ref. A1")
  const refs = s.recebidos.filter(e => e.tipo === 'atraso').map(e => e.texto.split('\n').at(-1))
  assert.match(refs[0], /^ref\. [A-Z]\d+$/)
  assert.equal(refs[1], refs[0])
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

test('POST /plano-ativo/terminar: "Viagem terminada / mudança de planos: estou bem, em <posição> qua 30/09 às HH:MM" (com o dia: decisão n.º 16) aos contactos; o plano fecha e os avisos voltam a normal; sem plano aberto, 409', async () => {
  const s = await preparar()
  await sair(s)
  await s.ciclo(13 * H)
  assert.equal(s.app.self['notifications.rota.previsao'].state, 'alarm')
  const t = await chamar(s.r.post['/plano-ativo/terminar'])
  assert.deepEqual(t, { code: 200, ok: true, estado: 'terminado', contactos: true })
  assert.equal(plano(s).estado, 'terminado')
  const m = s.recebidos.filter(e => e.tipo === 'terminado')
  assert.equal(m.length, 1)
  assert.match(m[0].texto, /^Viagem terminada \/ mudança de planos: estou bem, em \d+°\d+,\d' N \d+°\d+,\d' W /)
  assert.ok(m[0].texto.endsWith(` ${plano_.diaEHora(s.agora())}.\nref. ${plano(s).contactos.enviadas.at(-1).ref}`), m[0].texto)
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
  await pausar(s)
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
  await pausar(s)
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


test('decisão 1 (Ivo) e decisão n.º 13 (auditoria I-03): na 2.ª viagem com o mesmo cálculo o plano novo começa limpo, mas um envio já fechado (o "cheguei bem" entregue) nunca se reaproveita: sem o plano mandado outra vez nada segue para terra', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  assert.ok(s.recebidos.some(e => e.tipo === 'chegada'))
  // a 2.ª viagem: o mesmo cálculo (ainda dentro da hora da partida), ativado outra vez
  const a = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const novo = plano(s)
  assert.equal(novo.estado, 'a espera de sair')
  assert.deepEqual(novo.contactos.enviadas, [])
  assert.deepEqual(novo.contactos.fila, [])
  assert.equal(novo.atrasoEnviado ?? null, null)
  // a Mãe já recebeu o "cheguei bem" desse plano: o envio fechou-se e não volta a contar
  assert.equal(novo.envio, null)
  const fechados = pa.lerFechados(s.app.getDataDirPath())
  assert.deepEqual(fechados.map(x => x.estado), ['chegado'])
  // sai e anda devagar: nada segue para terra (a Mãe não recebeu plano nenhum para esta viagem)
  s.por(s.alt.rasto[2])
  await s.ciclo()
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  const anda = devagar(s, 0.4)
  for (let m = 1; m <= 120; m++) await anda()
  assert.deepEqual(s.recebidos.filter(e => e.tipo === 'atraso'), [], 'sem plano mandado, nenhum "tudo bem"')
  s.p.stop()
})

test('decisão n.º 13 (auditoria I-03): na 2.ª viagem com o mesmo cálculo, o plano mandado outra vez antes de sair (é desta viagem) fica no plano ativo e o atraso chega a terra', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.equal((await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })).code, 200)
  assert.equal(s.p.planoAtivo().envio, null)
  assert.equal((await chamar(s.r.post['/plano-telegram'], { body: { id: s.id, alternativa: 0 } })).code, 202)
  assert.deepEqual(s.p.planoAtivo().envio?.contactos, ['Mãe'])
  s.por(s.alt.rasto[2])
  await s.ciclo()
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  const anda = devagar(s, 0.4)
  for (let m = 1; m <= 150 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await anda()
  assert.ok(s.recebidos.some(e => e.tipo === 'atraso'), 'o atraso da 2.ª viagem')
  s.p.stop()
})

test('decisão n.º 13 (auditoria I-03): Ativar recusa (422) um cálculo antigo — a partida há mais de 1 h ou a hora de alarme já passada — também sem plano enviado; nada se ativa; a mesma alternativa do plano aberto continua (a meio da viagem)', async () => {
  const s = await preparar({ enviar: false })
  const k = s.app.ativacoes.length
  // a partida da 2.ª alternativa foi há 2 h
  s.acertar(Date.parse(s.resultado.alternativas[1].partida) + 2 * H)
  const x = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(x.code, 422)
  assert.match(x.erro, /^este cálculo é antigo: a partida já foi \(.+\) — calcula outra vez antes de ativar$/)
  assert.equal(s.app.ativacoes.length, k, 'nada se ativou')
  assert.equal(plano(s).indice, 0, 'o plano aberto fica')
  // a hora de alarme já passada
  s.acertar(plano_.horaAlarme(s.resultado.alternativas[2]) + MIN)
  const z = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 2 } })
  assert.equal(z.code, 422)
  assert.match(z.erro, /^este cálculo é antigo: /)
  // a alternativa do plano aberto, ativada outra vez (a rota apagada no OpenCPN): é o mesmo plano, continua
  const y = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })
  assert.equal(y.code, 200, y.erro)
  assert.equal(plano(s).indice, 0)
  s.p.stop()
})

test('decisão 3 (Ivo): o atraso só conta quando chega a terra: sem resposta do porto o GET fica com a hora de alarme do plano, e o que acaba por sair diz "em vez de" a hora do plano (a última entregue)', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null
  const anda = devagar(s, 0.4)
  const atrasos = () => s.recebidos.filter(e => e.tipo === 'atraso')
  let g = null
  // 100 min sem o porto responder (cada tentativa acaba nos 30 s)
  for (let m = 1; m <= 100; m++) {
    await anda()
    s.agendados.at(-1)?.fn()
    if (m === 60) g = await chamar(s.r.get['/plano-ativo'])
  }
  assert.ok(atrasos().length >= 2, 'tentou')
  assert.equal(g.envio.alarme, g.envio.alarmePlano, 'nada chegou: a hora de alarme é a do plano')
  // o porto volta
  const quando = []
  s.porto.resposta = (e) => { quando.push(s.agora()); return { pedido: e.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] } }
  for (let m = 0; m < 3 && !quando.length; m++) await anda()
  assert.equal(quando.length, 1)
  const entregue = atrasos().at(-1)
  assert.ok(entregue.texto.split('\n')[0].endsWith(`(em vez de ${horaLisboa(Date.parse(g.envio.alarmePlano), quando[0])}).`), entregue.texto)
  g = await chamar(s.r.get['/plano-ativo'])
  assert.notEqual(g.envio.alarme, g.envio.alarmePlano)
  assert.ok(entregue.texto.includes(`Nova hora de alarme: ${horaLisboa(Date.parse(g.envio.alarme), quando[0])} `), entregue.texto)
  s.p.stop()
})

test('decisão 4: Ativar a mesma alternativa enquanto o porto responde a uma mensagem (durante a API de rumo): nada fica "a enviar" sem temporizador e a entrega fica registada', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null
  const anda = devagar(s, 0.4)
  for (let m = 1; m <= 120 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await anda()
  const ev = s.recebidos.find(e => e.tipo === 'atraso')
  assert.equal(s.p.planoAtivo().contactos.fila[0].estado, 'a enviar')
  const ativar = s.app.activateRoute
  s.app.activateRoute = async (dest) => {
    s.app.emit('arlequin:plano-enviado', { pedido: ev.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] })
    return ativar(dest)
  }
  const a = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const pl = s.p.planoAtivo()
  assert.deepEqual(pl.contactos.fila.filter(m => m.estado === 'a enviar'), [])
  assert.equal(pl.contactos.enviadas.at(-1).tipo, 'atraso')
  assert.ok(pl.atrasoEnviado, 'o atraso entregue fica registado')
  assert.equal(pl.estado, 'a navegar')
  assert.equal(pl.href, a.href)
  s.p.stop()
})

test('decisão 5 (Ivo): a rota do plano desligada à chegada (pausado): o plano chega na mesma ao cais (a mesma regra) e manda "cheguei bem"', async () => {
  const s = await preparar()
  await sair(s)
  for (let k = 3; k < s.alt.rasto.length - 1; k++) { s.por(s.alt.rasto[k]); await s.ciclo() }
  // o Ivo limpa a rota no OpenCPN ao entrar no porto
  s.app.rotaAtiva = null
  s.por(s.alt.pontosRota.at(-1), 0)
  await pausar(s)
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  for (let m = 0; m < 6 && s.p.planoAtivo().estado !== 'chegado'; m++) await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  assert.equal(s.recebidos.filter(e => e.tipo === 'chegada').length, 1)
  s.p.stop()
})

test('re-revisão I-1 (sonda P1): a rota limpa a ~27 % da viagem, o Ivo segue à mão até Algés e fica 40 min parado no cais → "cheguei bem" (o afastamento real da partida conta como progresso em pausa)', async () => {
  const s = await preparar()
  await sair(s)
  const total = pa.comprimentoRota(s.p.planoAtivo())
  let k = 3
  for (; k < s.alt.rasto.length && !((s.p.acompanhamento()?.milhas ?? 0) >= 0.27 * total); k++) { s.por(s.alt.rasto[k]); await s.ciclo() }
  const milhas = s.p.acompanhamento().milhas
  assert.ok(milhas >= 0.27 * total && milhas < 0.5 * total, `${milhas} de ${total}`)
  // o Ivo limpa a rota no OpenCPN e segue o rasto à mão até ao fim
  s.app.rotaAtiva = null
  for (; k < s.alt.rasto.length; k++) { s.por(s.alt.rasto[k]); await s.ciclo() }
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  // o afastamento máximo fica gravado no plano (um reinício não o perde)
  assert.ok(plano(s).afastamentoMaxMn >= 0.9 * s.p.planoAtivo().afastamentoMaxMn && plano(s).afastamentoMaxMn > 1, `${plano(s).afastamentoMaxMn}`)
  s.por(s.alt.pontosRota.at(-1), 0)
  for (let m = 0; m < 40; m++) await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  assert.equal(plano(s).estado, 'chegado', 'gravado')
  const chegadas = s.recebidos.filter(e => e.tipo === 'chegada')
  assert.equal(chegadas.length, 1)
  assert.equal(chegadas[0].texto, `Cheguei bem a Algés (CNA) ${plano_.diaEHora(Date.parse(plano(s).chegou))}. Obrigado!\nref. ${plano(s).contactos.enviadas.find(m => m.tipo === 'chegada').ref}`)
  s.p.stop()
})

test('decisão 5 (Ivo): em pausa no mar, parado 30 min noutro porto da lista → GET chegadaOutro { id, nome }; nada segue até o Ivo carregar; POST /plano-ativo/chegada { destino } manda "Cheguei bem a X" e fecha o plano', async () => {
  const s = await preparar()
  await sair(s)
  s.app.rotaAtiva = null
  await pausar(s)
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  assert.equal((await chamar(s.r.post['/plano-ativo/chegada'], { body: { destino: 'cascais' } })).code, 409, 'sem sugestão ainda')
  s.por(caisDe('cascais'), 0)
  for (let m = 0; m < 30; m++) await s.ciclo()
  let g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.chegadaOutro, null, '29 min')
  assert.equal(g.pausadoDe, 'a navegar')
  await s.ciclo()
  g = await chamar(s.r.get['/plano-ativo'])
  const nome = costa.destinos.find(d => d.id === 'cascais').nome
  assert.deepEqual(g.chegadaOutro, { id: 'cascais', nome })
  assert.deepEqual(s.recebidos, [], 'só sugere')
  assert.equal((await chamar(s.r.post['/plano-ativo/chegada'], { body: { destino: 'nazare' } })).code, 409, 'só o porto sugerido')
  const c = await chamar(s.r.post['/plano-ativo/chegada'], { body: { destino: 'cascais' } })
  assert.deepEqual(c, { code: 200, ok: true, estado: 'chegado', contactos: true })
  const m = s.recebidos.filter(e => e.tipo === 'chegada')
  assert.equal(m.length, 1)
  assert.equal(m[0].texto, `Cheguei bem a ${nome} ${plano_.diaEHora(Date.parse(g.agora) - 30 * MIN)}. Obrigado!\nref. ${plano(s).contactos.enviadas.at(-1).ref}`)
  assert.equal(plano(s).estado, 'chegado')
  assert.deepEqual(plano(s).chegouA, { id: 'cascais', nome })
  assert.equal((await chamar(s.r.post['/plano-ativo/chegada'], { body: { destino: 'cascais' } })).code, 409, 'já fechado')
  s.p.stop()
})

test('M5: Continuar com um ciclo a meio (a rota do plano já voltou durante o pedido): 200, sem o falso 409', async () => {
  const s = await preparar()
  await sair(s)
  s.app.rotaAtiva = '/resources/routes/outra'
  await pausar(s)
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  const ativar = s.app.activateRoute
  s.app.activateRoute = async (dest) => { await ativar(dest); await s.p.cicloNavegar() }
  const c = await chamar(s.r.post['/plano-ativo/continuar'])
  assert.deepEqual(c, { code: 200, ok: true, estado: 'a navegar' })
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  s.p.stop()
})

test('9 (ecrã): o atraso do GET /plano-ativo arredonda para o lado do aviso (para cima), como a mensagem do recalcula', async () => {
  const s = await preparar()
  await sair(s)
  // parado entre dois pontos do rasto: um atraso com décimas (procura um com menos de meio minuto)
  const [r2, r3] = [s.alt.rasto[2], s.alt.rasto[3]]
  s.por({ lat: r2.lat + 0.37 * (r3.lat - r2.lat), lon: r2.lon + 0.37 * (r3.lon - r2.lon) }, 0)
  let a = null
  for (let m = 1; m <= 20 && a == null; m++) {
    await s.ciclo()
    const x = s.p.acompanhamento().atrasoMin
    if (x > 0 && x - Math.floor(x) > 0.05 && x - Math.floor(x) < 0.45) a = x
  }
  assert.ok(a != null, 'um atraso com menos de meio minuto')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).atrasoMin, Math.ceil(a))
  s.p.stop()
})

test('re-revisão M-2: um atraso na fila (o porto em baixo) faz-se com os valores de agora à hora de sair, e sai da fila se deixou de valer (o barco recuperou)', async () => {
  const s = await preparar()
  await sair(s)
  const ouvintes = s.app.listeners('arlequin:plano')
  s.app.removeAllListeners('arlequin:plano') // o porto desligado: a mensagem fica na fila
  const filaAtraso = () => (s.p.planoAtivo().contactos?.fila || []).filter(m => m.tipo === 'atraso')
  const anda = devagar(s, 0.4)
  let m = 0
  for (; m < 180 && !filaAtraso().length; m++) await anda()
  assert.equal(filaAtraso().length, 1, 'o atraso entrou na fila')
  // mais 20 min devagar: à hora de sair, a chegada e a hora de alarme são as de agora
  for (let k = 0; k < 20; k++) await anda()
  for (const f of ouvintes) s.app.on('arlequin:plano', f)
  // (num troço lento do rasto o atraso pode ficar retido como "parado" uns minutos: sai depois)
  for (let k = 0; k < 30 && !s.recebidos.some(e => e.tipo === 'atraso'); k++) await anda()
  const g = await chamar(s.r.get['/plano-ativo'])
  const enviado = s.recebidos.filter(e => e.tipo === 'atraso').at(-1)
  assert.ok(enviado, 'saiu quando o porto voltou')
  assert.ok(enviado.texto.includes(`Nova chegada prevista ~${horaLisboa(Date.parse(g.chegadaAgora), s.agora())}.`), `${enviado.texto} · ${g.chegadaAgora}`)
  s.p.stop()

  // outra vez, mas o barco recupera antes de o porto voltar: o atraso sai da fila e nada segue
  const t = await preparar()
  await sair(t)
  const ouv = t.app.listeners('arlequin:plano')
  t.app.removeAllListeners('arlequin:plano')
  const fila = () => (t.p.planoAtivo().contactos?.fila || []).filter(x => x.tipo === 'atraso')
  const andaT = devagar(t, 0.4)
  for (let k = 0; k < 180 && !fila().length; k++) await andaT()
  assert.equal(fila().length, 1)
  // apanha o plano: avança no rasto (2 pontos por minuto) até ao ponto da hora de agora e segue-o 15 min
  const indice = () => { let i = 0; while (i + 1 < t.alt.rasto.length && Date.parse(t.alt.rasto[i + 1].t) <= t.agora()) i++; return i }
  // a posição do plano 3 min à frente da hora de agora (entre dois pontos do rasto): um pouco adiantado
  const aHoras = () => {
    const tt = t.agora() + 3 * MIN
    let i = 0; while (i + 1 < t.alt.rasto.length && Date.parse(t.alt.rasto[i + 1].t) <= tt) i++
    const a = t.alt.rasto[i]; const b = t.alt.rasto[Math.min(i + 1, t.alt.rasto.length - 1)]
    const f = b === a ? 0 : (tt - Date.parse(a.t)) / (Date.parse(b.t) - Date.parse(a.t))
    return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) }
  }
  let ci = 2
  for (let k = 0; k < 200 && ci < indice(); k++) { ci = Math.min(ci + 2, indice()); t.por(t.alt.rasto[ci]); await t.ciclo() }
  for (let k = 0; k < 15; k++) { t.por(aHoras()); await t.ciclo() }
  const ch = (await chamar(t.r.get['/plano-ativo'])).chegadaAgora
  assert.ok(Date.parse(ch) <= Date.parse(t.alt.chegada.p90), `recuperou: ${ch} (p90 ${t.alt.chegada.p90})`)
  assert.deepEqual(fila(), [], 'o atraso deixou de valer: sai da fila')
  for (const f of ouv) t.app.on('arlequin:plano', f)
  for (let k = 0; k < 5; k++) { t.por(aHoras()); await t.ciclo() }
  assert.deepEqual(t.recebidos.filter(e => e.tipo === 'atraso'), [])
  t.p.stop()
})

test('re-revisão M-3: Recalcular → Ativar com o plano enviado: a hora de alarme do GET (envio.alarme) só passa à do plano novo quando o "Este plano substitui o anterior" chega a terra', async () => {
  const s = await preparar()
  await sair(s)
  const antes = (await chamar(s.r.get['/plano-ativo'])).envio.alarme
  s.porto.resposta = () => null // o porto não responde
  const b = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(b.code, 200, b.erro)
  const ev = s.recebidos.find(e => e.tipo === 'plano')
  assert.ok(ev, 'o plano novo saiu')
  let g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.envio.alarme, antes, 'ainda não chegou a terra: a hora de alarme é a do plano antigo')
  assert.equal(plano(s).envio.alarme, antes, 'e no plano gravado')
  // o porto responde: o plano novo chegou
  s.app.emit('arlequin:plano-enviado', { pedido: ev.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] })
  g = await chamar(s.r.get['/plano-ativo'])
  const novo = new Date(require('../lib/plano').horaAlarme(s.resultado.alternativas[1])).toISOString()
  assert.notEqual(novo, antes)
  assert.equal(g.envio.alarme, novo)
  assert.equal(plano(s).envio.alarme, novo)
  s.p.stop()
})

test('Tarefa 8.3 (reinício): a API de rumo sem a rota logo a seguir ao arranque (um null) não pausa o plano nem apaga os avisos ativos ("✓ Resolvido" a dobrar); só uma diferença que dura ≥ 2 ciclos e ≥ 2 min pausa', async () => {
  const s = await preparar()
  await sair(s)
  await s.ciclo(13 * H) // a previsão fica velha: alarm
  assert.equal(s.app.self['notifications.rota.previsao'].state, 'alarm')
  s.p.stop()
  // o servidor reinicia: a API de rumo ainda não repôs a rota no 1.º ciclo
  const href = s.app.rotaAtiva
  const q = plugin(s.app, { agendarCiclo: () => 1, pararCiclo: () => {} })
  q.acertar(s.agora())
  q.p.start({ pasta: path.join(s.app.dir, 'dados') })
  s.app.rotaAtiva = null
  const n = s.app.deltas.length
  const normais = () => s.app.deltas.slice(n).flatMap(d => d.updates.flatMap(u => u.values)).filter(v => v.path === 'notifications.rota.previsao' && v.value.state === 'normal')
  q.avancar(60000); await q.p.cicloNavegar()
  assert.equal(q.p.planoAtivo().estado, 'a navegar', 'um null logo a seguir ao arranque não pausa')
  s.app.rotaAtiva = href
  for (let m = 0; m < 3; m++) { q.avancar(60000); await q.p.cicloNavegar() }
  assert.equal(q.p.planoAtivo().estado, 'a navegar')
  assert.deepEqual(normais(), [], 'o aviso ativo não passou a normal')
  // uma rota mudada a sério (≥ 2 ciclos e ≥ 2 min seguidos): pausa
  s.app.rotaAtiva = '/resources/routes/outra'
  q.avancar(60000); await q.p.cicloNavegar()
  assert.equal(q.p.planoAtivo().estado, 'a navegar', '1.º ciclo')
  q.avancar(60000); await q.p.cicloNavegar()
  assert.equal(q.p.planoAtivo().estado, 'a navegar', '2 ciclos mas só 1 min')
  q.avancar(60000); await q.p.cicloNavegar()
  assert.equal(q.p.planoAtivo().estado, 'pausado', '2 min')
  q.p.stop()
})

// ---------- revisão final C1 (decisão do Ivo de 02/10, "só a avançar + teto de 3 h") ----------
const atrasosDe = (s) => s.recebidos.filter(e => e.tipo === 'atraso')

test('revisão final C1 (sonda A): o barco parado 8 h a meio da viagem → nenhum "Ainda a navegar, tudo bem"; a hora de alarme em terra fica a do plano e o GET diz atrasoRetido { motivo: "parado", alarme }', async () => {
  const s = await preparar()
  await sair(s)
  // ao ritmo do plano até meio da viagem
  const anda = devagar(s, 1)
  for (let m = 0; m < 80; m++) await anda()
  assert.equal((await chamar(s.r.get['/plano-ativo'])).atrasoRetido, null)
  const aqui = s.app.self['navigation.position']
  s.por({ lat: aqui.latitude, lon: aqui.longitude }, 0)
  for (let m = 0; m < 8 * 60; m++) await s.ciclo()
  assert.deepEqual(atrasosDe(s), [], '8 h parado: nenhuma mensagem')
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.ok(g.atrasoMin > 7 * 60, `${g.atrasoMin}`)
  assert.equal(g.envio.alarme, g.envio.alarmePlano, 'a hora de alarme em terra não andou')
  assert.deepEqual(g.atrasoRetido, { motivo: 'parado', alarme: g.envio.alarmePlano })
  assert.equal((plano(s).contactos?.fila || []).filter(m => m.tipo === 'atraso').length, 0)
  s.p.stop()
})

test('revisão final C1: à deriva 8 h (0,6 nó ao longo da rota e 0,6 nó para fora dela) → nenhuma mensagem para terra', async () => {
  const s = await preparar()
  await sair(s)
  const anda = devagar(s, 1)
  for (let m = 0; m < 80; m++) await anda()
  const p0 = s.app.self['navigation.position']
  // o rumo da rota ali (o troço do rasto à hora do plano) e a perpendicular
  const a = posNoRasto(s.alt.rasto, s.t0 + 100 * MIN); const b = posNoRasto(s.alt.rasto, s.t0 + 110 * MIN)
  const k = Math.cos(p0.latitude * Math.PI / 180)
  const [dx, dy] = [(b.lon - a.lon) * 60 * k, (b.lat - a.lat) * 60]
  const n = Math.hypot(dx, dy)
  const [ux, uy] = [dx / n, dy / n]
  for (let m = 1; m <= 8 * 60; m++) {
    const h = m / 60
    const x = 0.6 * h * ux + 0.6 * h * uy; const y = 0.6 * h * uy - 0.6 * h * ux
    s.por({ lat: p0.latitude + y / 60, lon: p0.longitude + x / (60 * k) }, 0.85)
    await s.ciclo()
  }
  assert.deepEqual(atrasosDe(s), [])
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.envio.alarme, g.envio.alarmePlano)
  assert.equal(g.atrasoRetido.motivo, 'parado')
  s.p.stop()
})

test('revisão final C1: o teto de 3 h — a andar devagar os atrasos saem até a hora de alarme passar 3 h da do plano; depois nada sai e o GET diz "limite"; o "Estou bem" (POST /plano-ativo/estou-bem) liberta um com a estimativa de agora e dá mais 3 h a partir daí', async () => {
  const s = await preparar()
  await sair(s)
  // sem nada retido, o "Estou bem" não faz nada
  assert.equal((await chamar(s.r.post['/plano-ativo/estou-bem'])).code, 409)
  const alarmePlano = Date.parse((await chamar(s.r.get['/plano-ativo'])).envio.alarmePlano)
  const anda = devagar(s, 0.3)
  let g = null
  for (let m = 0; m < 8 * 60; m++) {
    await anda()
    g = await chamar(s.r.get['/plano-ativo'])
    // (um troço lento do rasto pode reter um atraso como "parado" por uns minutos: segue até ao teto)
    if (g.atrasoRetido?.motivo === 'limite') break
  }
  assert.equal(g.atrasoRetido?.motivo, 'limite', JSON.stringify(g.atrasoRetido))
  const n = atrasosDe(s).length
  // (o rasto tem um troço lento numa curva: aí um atraso fica retido como "parado" e a hora de alarme salta mais)
  assert.ok(n >= 2, `${n} atrasos antes do teto`)
  // a última hora de alarme entregue fica dentro das 3 h
  const ultimoAlarme = Date.parse(g.envio.alarme)
  assert.ok(ultimoAlarme <= alarmePlano + 3 * H, `${g.envio.alarme}`)
  assert.equal(g.atrasoRetido.alarme, g.envio.alarme)
  // mais 1 h a andar devagar: nada sai
  for (let m = 0; m < 60; m++) await anda()
  assert.equal(atrasosDe(s).length, n)
  // o "Estou bem": sai um, com a estimativa de agora
  const e = await chamar(s.r.post['/plano-ativo/estou-bem'])
  assert.equal(e.code, 200, e.erro)
  assert.equal(atrasosDe(s).length, n + 1)
  g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.atrasoRetido, null)
  assert.ok(Date.parse(g.envio.alarme) > alarmePlano + 3 * H, 'a hora de alarme passou o teto com o toque')
  assert.ok(atrasosDe(s).at(-1).texto.includes(`Nova chegada prevista ~${horaLisboa(Date.parse(g.chegadaAgora), s.agora())}.`), atrasosDe(s).at(-1).texto)
  assert.equal(e.alarme, g.envio.alarme)
  // e o automático volta a sair (3 h a partir da hora de alarme libertada)
  for (let m = 0; m < 90; m++) await anda()
  assert.equal(atrasosDe(s).length, n + 2)
  s.p.stop()
})

test('revisão final C1: parado com o "Estou bem" do Ivo → sai uma mensagem; sem progresso, a seguinte não sai sem outro toque', async () => {
  const s = await preparar()
  await sair(s)
  const aqui = s.app.self['navigation.position']
  s.por({ lat: aqui.latitude, lon: aqui.longitude }, 0)
  let g = null
  for (let m = 0; m < 3 * 60; m++) {
    await s.ciclo()
    g = await chamar(s.r.get['/plano-ativo'])
    if (g.atrasoRetido) break
  }
  assert.equal(g.atrasoRetido?.motivo, 'parado')
  assert.deepEqual(atrasosDe(s), [])
  assert.equal((await chamar(s.r.post['/plano-ativo/estou-bem'])).code, 200)
  assert.equal(atrasosDe(s).length, 1)
  for (let m = 0; m < 2 * 60; m++) await s.ciclo()
  assert.equal(atrasosDe(s).length, 1, 'ainda parado: só com outro toque')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).atrasoRetido.motivo, 'parado')
  s.p.stop()
})

// ---------- revisão final I1: o plano entregue em terra é de outra alternativa ou de outro cálculo ----------
// Cascais → Algés, a 1.ª alternativa enviada à Mãe; nada ativado.
async function enviarSem ({ alternativa = 0 } = {}) {
  const app = appFalso()
  const pl = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {}, agendar: () => 1, cancelar: () => {} })
  pl.p.start({ pasta: path.join(app.dir, 'dados') })
  const recebidos = []
  app.on('arlequin:plano', (e) => { recebidos.push(e); app.emit('arlequin:plano-enviado', { pedido: e.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] }) })
  const { id, resultado } = await calcular(pl.r, { destino: 'alges', tripulacao: 'so' })
  await chamar(pl.r.post['/plano-telegram'], { body: { id, alternativa } })
  recebidos.length = 0
  return { app, ...pl, id, resultado, recebidos }
}

test('revisão final I1 (sonda B): enviado o plano da 1.ª alternativa e ativada a 2.ª → o plano novo segue à Mãe com "Este plano substitui o anterior"; o plano ativo fica com os contactos e a hora de alarme de terra', async () => {
  const s = await enviarSem()
  // o Resultado diz que os contactos em terra têm o plano da 1.ª
  const r = await chamar(s.r.get['/resultado/:id'], { params: { id: s.id } })
  assert.deepEqual({ ...r.envioEmTerra, alarme: undefined }, { idCalculo: s.id, indice: 0, contactos: ['Mãe'], alarme: undefined })
  assert.equal(r.envioEmTerra.alarme, new Date(require('../lib/plano').horaAlarme(s.resultado.alternativas[0])).toISOString())
  const a = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(a.code, 200, a.erro)
  const planos = s.recebidos.filter(e => e.tipo === 'plano')
  assert.equal(planos.length, 1)
  assert.ok(planos[0].texto.includes(`\n${require('../lib/contactos').SUBSTITUI}\n`), planos[0].texto)
  assert.deepEqual(planos[0].contactos, ['Mãe'])
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.deepEqual(g.envio.contactos, ['Mãe'])
  assert.equal(g.envio.alarme, new Date(require('../lib/plano').horaAlarme(s.resultado.alternativas[1])).toISOString(), 'entregue: a hora de alarme do plano novo')
  s.p.stop()
})

test('revisão final I1: o envio entregue fica em ultimo-envio.json: depois de reiniciar o plugin, um cálculo novo ativado sem enviar segue aos contactos com "Este plano substitui o anterior"', async () => {
  const s = await enviarSem()
  s.p.stop()
  const q = plugin(s.app, { agendarCiclo: () => 1, pararCiclo: () => {}, agendar: () => 1, cancelar: () => {} })
  q.acertar(s.agora())
  q.p.start({ pasta: path.join(s.app.dir, 'dados') })
  const { id } = await calcular(q.r, { destino: 'alges', tripulacao: 'so' })
  const r = await chamar(q.r.get['/resultado/:id'], { params: { id } })
  assert.equal(r.envioEmTerra.idCalculo, s.id)
  const a = await chamar(q.r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const planos = s.recebidos.filter(e => e.tipo === 'plano')
  assert.equal(planos.length, 1)
  assert.deepEqual(planos[0].contactos, ['Mãe'])
  assert.deepEqual(q.p.planoAtivo().envio.contactos, ['Mãe'])
  q.p.stop()
})

test('revisão final I1: depois do "cheguei bem" entregue, ou com a hora de alarme já passada, ativar outro plano não manda nada', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.ok(s.recebidos.some(e => e.tipo === 'chegada'))
  const n = s.recebidos.length
  const a = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 1 } })
  assert.equal(a.code, 200, a.erro)
  assert.equal(s.recebidos.length, n, 'a viagem acabou: terra já não tem hora de alarme')
  assert.equal(s.p.planoAtivo().envio, null)
  assert.equal((await chamar(s.r.get['/resultado/:id'], { params: { id: s.id } })).envioEmTerra, null)
  s.p.stop()
  // a hora de alarme do plano enviado já passou
  const t = await enviarSem()
  t.acertar(require('../lib/plano').horaAlarme(t.resultado.alternativas[0]) + MIN)
  const { id } = await calcular(t.r, { destino: 'alges', tripulacao: 'so' })
  assert.equal((await chamar(t.r.post['/ativar'], { body: { id, alternativa: 0 } })).code, 200)
  assert.deepEqual(t.recebidos.filter(e => e.tipo === 'plano'), [])
  t.p.stop()
})

test('revisão final I2: o aviso da hora de alarme em terra sai 60 min antes, também à espera de sair e em pausa, e volta a normal quando o plano fecha', async () => {
  const s = await preparar()
  const caminho = 'notifications.rota.alarmeTerra'
  const alarme = Date.parse((await chamar(s.r.get['/plano-ativo'])).envio.alarme)
  // à espera de sair (o Ivo desistiu e esqueceu-se do Terminar)
  s.acertar(alarme - 62 * MIN)
  await s.ciclo()
  assert.notEqual(s.app.self[caminho]?.state, 'alert')
  await s.ciclo(2 * MIN)
  assert.equal(s.p.planoAtivo().estado, 'a espera de sair')
  assert.equal(s.app.self[caminho].state, 'alert')
  assert.equal(s.app.self[caminho].apito, 'curto')
  assert.match(s.app.self[caminho].message, /^Os contactos em terra ligam ao MRCC (às|[a-z]{3} \d\d\/\d\d às) \d\d:\d\d: avisa-os ou Terminar$/)
  assert.ok((await chamar(s.r.get['/plano-ativo'])).avisos.some(a => a.caminho === caminho))
  // Terminar: normal
  await chamar(s.r.post['/plano-ativo/terminar'])
  assert.equal(s.app.self[caminho].state, 'normal')
  s.p.stop()
  // em pausa no mar (a rota do plano limpa)
  const t = await preparar()
  await sair(t)
  t.app.rotaAtiva = null
  await pausar(t)
  assert.equal(t.p.planoAtivo().estado, 'pausado')
  t.acertar(Date.parse((await chamar(t.r.get['/plano-ativo'])).envio.alarme) - 30 * MIN)
  await t.ciclo(0)
  assert.equal(t.app.self[caminho].state, 'alert')
  t.p.stop()
})

test('revisão final I3: a Mãe recebe o atraso e o Pai não (bloqueou o bot) → daqui a 2 min o mesmo atraso (a mesma ref) só para o Pai, sem ir outra vez ao Ivo; o GET mostra a falha e o que está por entregar', async () => {
  const s = await preparar({ contactos: [['Mãe', '222'], ['Pai', '333']] })
  assert.deepEqual(s.p.planoAtivo().envio.contactos, ['Mãe', 'Pai'])
  await sair(s)
  const normal = s.porto.resposta
  // o Pai falha
  s.porto.resposta = (e) => ({ pedido: e.pedido, entregues: [...(e.tentativa ? [] : ['chat 111']), 'Mãe'].filter(n => e.contactos.includes(n) || n === 'chat 111'), contactos: e.contactos.filter(n => n === 'Mãe'), chats: e.chats.filter(c => c === '222'), falhas: e.chats.includes('333') ? [{ nome: 'Pai', erro: 'bloqueou o bot' }] : [] })
  const anda = devagar(s, 0.4)
  for (let m = 0; m < 150 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await anda()
  const [a1] = s.recebidos.filter(e => e.tipo === 'atraso')
  assert.deepEqual(a1.chats, ['222', '333'])
  let g = await chamar(s.r.get['/plano-ativo'])
  assert.deepEqual(g.enviadas.at(-1).falhas, [{ nome: 'Pai', erro: 'bloqueou o bot' }])
  assert.deepEqual(g.filaContactos.map(m => ({ tipo: m.tipo, contactos: m.contactos, parcial: m.parcial })), [{ tipo: 'atraso', contactos: ['Pai'], parcial: true }])
  // o Pai desbloqueia; 2 min depois sai só para ele, com a mesma ref
  s.porto.resposta = normal
  await anda(); await anda()
  const atrasos = s.recebidos.filter(e => e.tipo === 'atraso')
  assert.equal(atrasos.length, 2)
  assert.deepEqual(atrasos[1].chats, ['333'])
  assert.equal(atrasos[1].texto, a1.texto)
  assert.equal(atrasos[1].tentativa, 2, 'o Ivo já a recebeu')
  g = await chamar(s.r.get['/plano-ativo'])
  assert.deepEqual(g.filaContactos, [])
  s.p.stop()
})

// ---------- auditoria K-02: um atraso na fila nunca sai parado, em pausa ou sem GPS ----------
// (as sondas S2 da auditoria B) o atraso entra na fila com o porto em baixo (sem rede ao largo); depois o
// barco fica sem GPS ou a rota é limpa (pausa), e a rede volta
async function atrasoNaFila (s) {
  const ouvintes = s.app.listeners('arlequin:plano')
  s.app.removeAllListeners('arlequin:plano')
  const fila = () => (s.p.planoAtivo().contactos?.fila || []).filter(m => m.tipo === 'atraso')
  const anda = devagar(s, 0.4)
  for (let k = 0; k < 240 && !fila().length; k++) await anda()
  assert.equal(fila().length, 1, 'o atraso entrou na fila')
  return { voltaARede: () => { for (const f of ouvintes) s.app.on('arlequin:plano', f) }, fila }
}

test('auditoria K-02 (sonda S2, sem GPS): um atraso na fila e o GPS perdido com o barco parado — quando a rede volta nada sai para terra; com o GPS de volta e o barco parado o atraso sai da fila; a hora de alarme em terra fica a do plano', async () => {
  const s = await preparar()
  await sair(s)
  const { voltaARede, fila } = await atrasoNaFila(s)
  // a antena do GPS perdida: a posição fica com a hora de agora (velha daqui a 2 min); o barco parado
  s.app.horas['navigation.position'] = new Date(s.agora()).toISOString()
  s.app.self['navigation.speedOverGround'] = 0
  for (let m = 0; m < 90; m++) await s.ciclo()
  assert.equal((await chamar(s.r.get['/plano-ativo'])).semGps, true)
  voltaARede()
  for (let k = 0; k < 5; k++) await s.ciclo()
  assert.deepEqual(atrasosDe(s), [], 'sem GPS nada segue para os contactos')
  // o GPS volta, com o barco parado no mesmo sítio: o atraso já não vale ("só a avançar")
  delete s.app.horas['navigation.position']
  for (let k = 0; k < 20; k++) await s.ciclo()
  assert.deepEqual(atrasosDe(s), [])
  assert.deepEqual(fila(), [])
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.envio.alarme, g.envio.alarmePlano, 'a hora de alarme em terra não andou')
  s.p.stop()
})

test('auditoria K-02 (sonda S2, em pausa): um atraso na fila e a rota do plano limpa com o barco parado — o atraso sai da fila e nada segue quando a rede volta', async () => {
  const s = await preparar()
  await sair(s)
  const { voltaARede, fila } = await atrasoNaFila(s)
  const aqui = s.app.self['navigation.position']
  s.por({ lat: aqui.latitude, lon: aqui.longitude }, 0)
  s.app.rotaAtiva = null
  await pausar(s)
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  assert.deepEqual(fila(), [], 'em pausa os atrasos não seguem para terra')
  for (let m = 0; m < 90; m++) await s.ciclo()
  voltaARede()
  for (let k = 0; k < 5; k++) await s.ciclo()
  assert.deepEqual(atrasosDe(s), [])
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.envio.alarme, g.envio.alarmePlano)
  s.p.stop()
})

test('auditoria K-02: o atraso libertado pelo "Estou bem" (confirmado) sai na mesma quando a rede volta, mesmo sem GPS', async () => {
  const s = await preparar()
  await sair(s)
  const aqui = s.app.self['navigation.position']
  s.por({ lat: aqui.latitude, lon: aqui.longitude }, 0)
  let g = null
  for (let m = 0; m < 3 * 60; m++) { await s.ciclo(); g = await chamar(s.r.get['/plano-ativo']); if (g.atrasoRetido) break }
  assert.equal(g.atrasoRetido?.motivo, 'parado')
  const ouvintes = s.app.listeners('arlequin:plano')
  s.app.removeAllListeners('arlequin:plano')
  assert.equal((await chamar(s.r.post['/plano-ativo/estou-bem'])).code, 200)
  s.app.horas['navigation.position'] = new Date(s.agora()).toISOString()
  for (let m = 0; m < 10; m++) await s.ciclo()
  for (const f of ouvintes) s.app.on('arlequin:plano', f)
  for (let k = 0; k < 3; k++) await s.ciclo()
  assert.equal(atrasosDe(s).length, 1, 'o toque do Ivo vale: o atraso confirmado sai')
  s.p.stop()
})

test('auditoria K-02: o parcial de um atraso (o Pai bloqueou o bot) não sai com o barco parado — ninguém recebe "tudo bem" de um barco parado; o Pai fica com a hora de alarme dele', async () => {
  const s = await preparar({ contactos: [['Mãe', '222'], ['Pai', '333']] })
  await sair(s)
  const normal = s.porto.resposta
  s.porto.resposta = (e) => ({ pedido: e.pedido, entregues: [...(e.tentativa ? [] : ['chat 111']), ...(e.chats.includes('222') ? ['Mãe'] : [])], contactos: e.chats.includes('222') ? ['Mãe'] : [], chats: e.chats.filter(c => c === '222'), falhas: e.chats.includes('333') ? [{ nome: 'Pai', erro: 'bloqueou o bot' }] : [] })
  const anda = devagar(s, 0.4)
  for (let m = 0; m < 150 && !atrasosDe(s).length; m++) await anda()
  assert.equal(atrasosDe(s).length, 1)
  // o barco para (sem governo); o parcial do Pai continua a falhar
  const aqui = s.app.self['navigation.position']
  s.por({ lat: aqui.latitude, lon: aqui.longitude }, 0)
  for (let m = 0; m < 40; m++) await s.ciclo()
  const doPai = () => atrasosDe(s).filter(e => e.chats.includes('333')).length
  const antes = doPai()
  // o Pai desbloqueia o bot: o barco continua parado, nada lhe chega
  s.porto.resposta = normal
  for (let m = 0; m < 10; m++) await s.ciclo()
  assert.equal(doPai(), antes, 'parado: o parcial "tudo bem" não sai')
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.deepEqual(g.filaContactos.filter(m => m.tipo === 'atraso'), [])
  s.p.stop()
})

test('auditoria K-13 (sonda S6): o "cheguei bem" da viagem 1 falha sempre para a Mãe (saiu dos contactos do porto) — não prende a viagem 2: os atrasos e o "cheguei bem" da viagem 2 chegam ao Pai', async () => {
  const s = await preparar()
  await sair(s)
  // a Mãe sai da configuração do porto: tudo para ela falha (o Ivo recebe)
  const config = { 222: null, 333: 'Pai' }
  s.porto.resposta = (e) => {
    if (!e.tipo) return { pedido: e.pedido, entregues: ['chat 111', 'Pai'], contactos: ['Pai'], chats: ['333'], falhas: [] }
    const ok = (e.chats || []).filter(c => config[c]); const mal = (e.chats || []).filter(c => !config[c])
    return { pedido: e.pedido, entregues: [...(e.tentativa ? [] : ['chat 111']), ...ok.map(c => config[c])], contactos: ok.map(c => config[c]), chats: ok, falhas: mal.map(() => ({ nome: 'Mãe', erro: 'já não está nos "Contactos do plano" do plugin porto' })) }
  }
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  for (let m = 0; m < 20; m++) await s.ciclo()
  assert.ok(s.p.planoAtivo().contactos.fila.some(m => m.tipo === 'chegada' && m.tentativas >= 3), 'a Mãe nunca o recebe')
  // a viagem 2 (outro dia): um cálculo novo, o plano enviado (só o Pai o recebe) e ativado
  s.acertar(s.agora() + 12 * H)
  s.por(s.alt.pontosRota.at(-1), 0)
  const { id, resultado } = await calcular(s.r, { destino: 'cascais', tripulacao: 'so' })
  await chamar(s.r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal((await chamar(s.r.post['/ativar'], { body: { id, alternativa: 0 } })).code, 200)
  assert.deepEqual(s.p.planoAtivo().envio.contactos, ['Pai'])
  const s2 = { ...s, alt: resultado.alternativas[0], t0: Date.parse(resultado.alternativas[0].partida) }
  s.acertar(Math.max(s.agora(), s2.t0))
  s.por(s2.alt.rasto[2]); await s.ciclo(20 * MIN); await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  const anda = devagar(s2, 0.3)
  for (let m = 0; m < 300 && !atrasosDe(s).some(e => e.chats.includes('333')); m++) await anda()
  assert.ok(atrasosDe(s).some(e => e.chats.includes('333')), 'o atraso da viagem 2 chegou ao Pai')
  await chegar(s2)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  for (let m = 0; m < 5; m++) await s.ciclo()
  assert.ok(s.recebidos.some(e => e.tipo === 'chegada' && e.chats.includes('333')), 'o "cheguei bem" da viagem 2 chegou ao Pai')
  s.p.stop()
})

// ---------- auditoria K-12: o "cheguei bem" por entregar com o plano já fechado ----------
const ALARME_TERRA = 'notifications.rota.alarmeTerra'

test('auditoria K-12 (sonda S1): chegada sem rede — com o plano fechado e o "cheguei bem" por entregar, o aviso alarmeTerra sai 60 min antes da hora de alarme (e fica depois dela), o GET diz fechoPorEntregar e mostra o aviso; quando o "cheguei bem" chega a terra, volta a normal', async () => {
  const s = await preparar()
  await sair(s)
  const ouvintes = s.app.listeners('arlequin:plano')
  s.app.removeAllListeners('arlequin:plano') // sem rede na marina (o porto não chega ao Telegram)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  let g = await chamar(s.r.get['/plano-ativo'])
  const alarme = Date.parse(g.envio.alarme)
  assert.equal(g.fechoPorEntregar.tipo, 'chegada')
  assert.deepEqual(g.fechoPorEntregar.contactos, ['Mãe'])
  s.acertar(alarme - 61 * MIN)
  await s.ciclo(0)
  assert.equal(s.app.self[ALARME_TERRA]?.state ?? 'normal', 'normal', '61 min antes')
  await s.ciclo(2 * MIN)
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert', '59 min antes')
  assert.equal(s.app.self[ALARME_TERRA].apito, 'curto')
  assert.equal(s.app.self[ALARME_TERRA].message, `O «cheguei bem» ainda não chegou a terra: os contactos ligam ao MRCC ${asHoras(alarme, s.agora())} — liga-lhes`)
  g = await chamar(s.r.get['/plano-ativo'])
  assert.ok(g.avisos.some(a => a.caminho === ALARME_TERRA && a.state === 'alert'), JSON.stringify(g.avisos))
  // passada a hora de alarme fica (terra pode já estar a ligar)
  s.acertar(alarme + 30 * MIN)
  await s.ciclo(0)
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  // a rede volta: o "cheguei bem" chega a terra e o aviso volta a normal
  for (const f of ouvintes) s.app.on('arlequin:plano', f)
  await s.ciclo(3 * MIN)
  assert.ok(s.recebidos.some(e => e.tipo === 'chegada'))
  await s.ciclo()
  assert.equal(s.app.self[ALARME_TERRA].state, 'normal')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).fechoPorEntregar, null)
  s.p.stop()
})

test('auditoria K-12: Terminar sem rede perto da hora de alarme — "A «viagem terminada» ainda não chegou a terra": o aviso fica até ela chegar', async () => {
  const s = await preparar()
  await sair(s)
  const alarme = Date.parse((await chamar(s.r.get['/plano-ativo'])).envio.alarme)
  s.app.removeAllListeners('arlequin:plano')
  s.acertar(alarme - 30 * MIN)
  assert.equal((await chamar(s.r.post['/plano-ativo/terminar'])).code, 200)
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  assert.equal(s.app.self[ALARME_TERRA].message, `A «viagem terminada» ainda não chegou a terra: os contactos ligam ao MRCC ${asHoras(alarme, s.agora())} — liga-lhes`)
  await s.ciclo()
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).fechoPorEntregar.tipo, 'terminado')
  s.p.stop()
})

// ---------- auditoria I-01 (decisão n.º 14): a hora de alarme de cada contacto ----------
// o Pai bloqueou o bot: os atrasos chegam à Mãe e não a ele
const paiBloqueado = (e) => ({ pedido: e.pedido, entregues: [...(e.tentativa ? [] : ['chat 111']), ...((e.chats || []).includes('222') ? ['Mãe'] : [])], contactos: (e.chats || []).includes('222') ? ['Mãe'] : [], chats: (e.chats || []).filter(c => c === '222'), falhas: (e.chats || []).includes('333') ? [{ nome: 'Pai', erro: 'bloqueou o bot' }] : [] })

test('auditoria I-01 (sonda S3b, decisão n.º 14): entrega parcial — os atrasos chegam à Mãe e não ao Pai: o GET e o aviso de terra contam pela hora de alarme mais cedo (a do Pai, a do plano); envio.porContacto diz a de cada um', async () => {
  const s = await preparar({ contactos: [['Mãe', '222'], ['Pai', '333']] })
  await sair(s)
  s.porto.resposta = paiBloqueado
  const anda = devagar(s, 0.3)
  const aMae = () => atrasosDe(s).filter(e => e.chats.includes('222')).length
  for (let m = 0; m < 400 && aMae() < 2; m++) await anda()
  assert.equal(aMae(), 2)
  const g = await chamar(s.r.get['/plano-ativo'])
  const pai = Date.parse(g.envio.alarmePlano)
  assert.equal(g.envio.alarme, g.envio.alarmePlano, 'a hora de alarme mais cedo que terra tem: a do Pai')
  const mae = g.envio.porContacto.find(x => x.nome === 'Mãe')
  assert.ok(Date.parse(mae.alarme) > pai + 30 * MIN, JSON.stringify(g.envio.porContacto))
  assert.deepEqual(g.envio.porContacto.find(x => x.nome === 'Pai'), { nome: 'Pai', alarme: g.envio.alarmePlano, fechado: false })
  // o aviso de terra 60 min antes da hora do Pai (antes saía 60 min antes da da Mãe, já depois de o Pai ligar)
  s.acertar(pai - 59 * MIN)
  await s.ciclo(0)
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  assert.equal(s.app.self[ALARME_TERRA].message, `Os contactos em terra ligam ao MRCC ${asHoras(pai, s.agora())}: avisa-os ou Terminar`)
  s.p.stop()
})

// ---------- auditoria I-02 (decisão n.º 15): o plano enviado e nunca ativado ----------
test('auditoria I-02 (sonda S9, decisão n.º 15): o plano entregue à Mãe e nunca ativado — 60 min antes da hora de alarme o aviso de terra "ativa-o ou avisa-os"; o GET /plano-ativo dá 404 com envioEmTerra; passada a hora de alarme, apaga-se', async () => {
  const s = await enviarSem()
  const alarme = plano_.horaAlarme(s.resultado.alternativas[0])
  let g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.code, 404)
  assert.deepEqual(g.envioEmTerra, { idCalculo: s.id, indice: 0, contactos: ['Mãe'], alarme: new Date(alarme).toISOString() })
  s.acertar(alarme - 62 * MIN)
  s.avancar(MIN); await s.p.cicloNavegar()
  assert.equal(s.app.self[ALARME_TERRA]?.state ?? 'normal', 'normal', '61 min antes ainda não')
  s.avancar(2 * MIN); await s.p.cicloNavegar()
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  assert.equal(s.app.self[ALARME_TERRA].apito, 'curto')
  assert.equal(s.app.self[ALARME_TERRA].message, `Os contactos em terra têm um plano com alarme ${asHoras(alarme, s.agora())} e não há plano ativo: ativa-o ou avisa-os`)
  // passada a hora de alarme, terra já não espera: o aviso apaga-se
  s.acertar(alarme + MIN); await s.p.cicloNavegar()
  assert.equal(s.app.self[ALARME_TERRA].state, 'normal')
  assert.equal((await chamar(s.r.get['/plano-ativo'])).envioEmTerra, null)
  s.p.stop()
})

test('auditoria I-02: com um plano ativo aberto que não é o que terra tem (o Ivo mandou outro plano pelo Telegram e não o ativou), o aviso conta pela hora de alarme mais cedo das duas e diz que é o plano de outra alternativa', async () => {
  const s = await preparar({ enviar: false })
  // ativado sem enviar; depois o Ivo manda o plano da 2.ª alternativa e não a ativa
  await chamar(s.r.post['/plano-telegram'], { body: { id: s.id, alternativa: 1 } })
  const alarme = plano_.horaAlarme(s.resultado.alternativas[1])
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.equal(g.code, 200)
  assert.equal(g.envio, null)
  assert.deepEqual(g.envioEmTerra, { idCalculo: s.id, indice: 1, contactos: ['Mãe'], alarme: new Date(alarme).toISOString() })
  s.acertar(alarme - 30 * MIN); await s.ciclo(0)
  assert.equal(s.app.self[ALARME_TERRA].state, 'alert')
  assert.equal(s.app.self[ALARME_TERRA].message, `Os contactos em terra têm o plano de outra alternativa, com alarme ${asHoras(alarme, s.agora())}: avisa-os`)
  s.p.stop()
})

// ---------- auditoria I-04: um "cheguei bem" atrasado só fecha o envio do seu plano ----------
test('auditoria I-04: o "cheguei bem" da viagem 1 entregue depois de o plano da viagem 2 ter sido mandado não fecha o envio da viagem 2: ao ativar outra alternativa, o plano novo segue com "Este plano substitui o anterior"', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null // o porto não responde (sem rede na marina)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  s.agendados.at(-1).fn() // passaram os 30 s: o "cheguei bem" volta à fila
  assert.equal(s.p.planoAtivo().contactos.fila[0].estado, 'fila')
  // a rede volta e o Ivo manda já o plano da viagem 2 (outro cálculo) pelo Telegram, antes de o "cheguei
  // bem" da viagem 1 voltar a tentar
  s.porto.resposta = (e) => ({ pedido: e.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] })
  const { id } = await calcular(s.r, { destino: 'cascais', tripulacao: 'so' })
  await chamar(s.r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  assert.equal((await chamar(s.r.get['/resultado/:id'], { params: { id } })).envioEmTerra.idCalculo, id)
  // o "cheguei bem" da viagem 1 chega agora a terra
  for (let m = 0; m < 3; m++) await s.ciclo()
  assert.ok(s.recebidos.some(e => e.tipo === 'chegada'))
  const r = await chamar(s.r.get['/resultado/:id'], { params: { id } })
  assert.equal(r.envioEmTerra?.idCalculo, id, 'o envio da viagem 2 continua a contar')
  // ativar outra alternativa da viagem 2: segue o plano novo, que substitui o que a Mãe tem
  const n = s.recebidos.filter(e => e.tipo === 'plano').length
  assert.equal((await chamar(s.r.post['/ativar'], { body: { id, alternativa: 1 } })).code, 200)
  assert.equal(s.recebidos.filter(e => e.tipo === 'plano').length, n + 1)
  assert.ok(s.recebidos.filter(e => e.tipo === 'plano').at(-1).texto.includes('Este plano substitui o anterior.'))
  assert.deepEqual(s.p.planoAtivo().envio.contactos, ['Mãe'])
  s.p.stop()
})

// ---------- auditoria I-05 (decisão n.º 16): o contacto que nunca recebe ----------
test('auditoria I-05 (sonda S3, decisão n.º 16): o Pai bloqueou o bot — o "cheguei bem" (com a data) chega à Mãe e o parcial do Pai repete-se até à hora de alarme dele; aí desiste, o Ivo recebe pelo Telegram "Pai não recebeu…: liga-lhe" e o GET diz desistencias; nada passa para o plano seguinte', async () => {
  const s = await preparar({ contactos: [['Mãe', '222'], ['Pai', '333']] })
  await sair(s)
  s.porto.resposta = paiBloqueado
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  const chegadas = () => s.recebidos.filter(e => e.tipo === 'chegada')
  assert.match(chegadas()[0].texto, /^Cheguei bem a Algés \(CNA\) [a-zá]{3} \d\d\/\d\d às \d\d:\d\d\. Obrigado!\nref\. [A-Z]\d+$/)
  const g0 = await chamar(s.r.get['/plano-ativo'])
  const alarmePai = Date.parse(g0.envio.porContacto.find(x => x.nome === 'Pai').alarme)
  // até à hora de alarme do Pai, o parcial repete-se de 2 em 2 min
  while (s.agora() < alarmePai - 3 * MIN) await s.ciclo(2 * MIN)
  const tentativas = chegadas().filter(e => e.chats.includes('333')).length
  assert.ok(tentativas >= 3, `${tentativas}`)
  assert.equal(s.recebidos.filter(e => e.tipo === 'aviso').length, 0)
  // passa a hora de alarme do Pai: desiste e avisa o Ivo (só o chat do Ivo)
  await s.ciclo(2 * MIN); await s.ciclo(2 * MIN)
  const avisos = s.recebidos.filter(e => e.tipo === 'aviso')
  assert.equal(avisos.length, 1)
  assert.deepEqual(avisos[0].chats, [])
  assert.deepEqual(avisos[0].contactos, [])
  assert.match(avisos[0].texto, /^Pai não recebeu o «cheguei bem» \(ref\. [A-Z]\d+\) e já passou a hora de alarme \([a-zá]{3} \d\d\/\d\d às \d\d:\d\d\): desisti de o entregar\. Liga-lhe\.\nref\. [A-Z]\d+$/)
  const g = await chamar(s.r.get['/plano-ativo'])
  assert.deepEqual(g.desistencias.map(d => ({ tipo: d.tipo, contactos: d.contactos })), [{ tipo: 'chegada', contactos: ['Pai'] }])
  assert.deepEqual(g.filaContactos, [])
  const n = chegadas().length
  for (let m = 0; m < 10; m++) await s.ciclo(2 * MIN)
  assert.equal(chegadas().length, n, 'já não se repete')
  // o plano seguinte não herda nada
  const { id } = await calcular(s.r, { destino: 'cascais', tripulacao: 'so' })
  assert.equal((await chamar(s.r.post['/ativar'], { body: { id, alternativa: 0 } })).code, 200)
  assert.deepEqual(s.p.planoAtivo().contactos.fila, [])
  s.p.stop()
})
