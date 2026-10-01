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
const { appFalso, plugin, chamar, calcular, fetchFalso, caisDe, costa, H } = require('./ajuda')
const { horaLisboa } = require('../lib/plano')

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
  const porto = { resposta: (e) => ({ pedido: e.pedido, entregues: ['chat 111', ...(e.contactos || ['Mãe'])], contactos: e.contactos || ['Mãe'], chats: e.chats || ['222'], falhas: [] }) }
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

test('"Cheguei bem a X às HH:MM" na chegada, uma vez, aos contactos do plano (tipo chegada, sem GPX), com a hora a que saiu; nada se repete depois de um reinício', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  const chegadas = s.recebidos.filter(e => e.tipo === 'chegada')
  assert.equal(chegadas.length, 1)
  assert.match(chegadas[0].texto, /^Cheguei bem a Algés \(CNA\) às \d\d:\d\d\. Obrigado!$/)
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
  s.por(s.alt.rasto[2], 0) // parado: o atraso cresce
  const atrasos = () => s.recebidos.filter(e => e.tipo === 'atraso')
  const p90 = Date.parse(s.alt.chegada.p90)
  const minutos = [] // o minuto de cada envio
  const margens = [] // chegada prevista − p90 (min), em cada minuto
  for (let m = 1; m <= 120; m++) {
    const n = atrasos().length
    await s.ciclo()
    margens.push((Date.parse((await chamar(s.r.get['/plano-ativo'])).chegadaAgora) - p90) / MIN)
    if (atrasos().length > n) minutos.push(m)
  }
  assert.equal(minutos.length, 2, JSON.stringify(minutos))
  // o 1.º logo que a chegada prevista passa 30 min da mais tarde do plano (com 29 ainda não)
  assert.ok(margens[minutos[0] - 1] >= 30, `${margens[minutos[0] - 1]}`)
  assert.ok(margens[minutos[0] - 2] < 30, `${margens[minutos[0] - 2]}`)
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
  for (let m = 1; m <= 90 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await s.ciclo()
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


test('decisão 1 (Ivo): na 2.ª viagem o atraso chega a terra (o plano novo começa limpo: sem as enviadas nem o atraso do plano antigo) e o plano antigo vai para planos-fechados.json', async () => {
  const s = await preparar()
  await sair(s)
  await chegar(s)
  assert.equal(s.p.planoAtivo().estado, 'chegado')
  // a 2.ª viagem: o mesmo cálculo, já enviado aos contactos, ativado outra vez
  const a = await chamar(s.r.post['/ativar'], { body: { id: s.id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const novo = plano(s)
  assert.equal(novo.estado, 'a espera de sair')
  assert.deepEqual(novo.contactos.enviadas, [])
  assert.deepEqual(novo.contactos.fila, [])
  assert.equal(novo.atrasoEnviado ?? null, null)
  assert.deepEqual(novo.envio.contactos, ['Mãe'])
  const fechados = pa.lerFechados(s.app.getDataDirPath())
  assert.deepEqual(fechados.map(x => x.estado), ['chegado'])
  // sai e fica parado no rasto: o atraso segue para terra
  s.por(s.alt.rasto[2])
  await s.ciclo()
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  s.por(s.alt.rasto[2], 0)
  for (let m = 1; m <= 90 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await s.ciclo()
  assert.ok(s.recebidos.some(e => e.tipo === 'atraso'), 'o atraso da 2.ª viagem')
  s.p.stop()
})

test('decisão 3 (Ivo): o atraso só conta quando chega a terra: sem resposta do porto o GET fica com a hora de alarme do plano, e o que acaba por sair diz "em vez de" a hora do plano (a última entregue)', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null
  s.por(s.alt.rasto[2], 0)
  const atrasos = () => s.recebidos.filter(e => e.tipo === 'atraso')
  let g = null
  // 70 min sem o porto responder (cada tentativa acaba nos 30 s)
  for (let m = 1; m <= 70; m++) {
    await s.ciclo()
    s.agendados.at(-1)?.fn()
    if (m === 30) g = await chamar(s.r.get['/plano-ativo'])
  }
  assert.ok(atrasos().length >= 2, 'tentou')
  assert.equal(g.envio.alarme, g.envio.alarmePlano, 'nada chegou: a hora de alarme é a do plano')
  // o porto volta
  const quando = []
  s.porto.resposta = (e) => { quando.push(s.agora()); return { pedido: e.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] } }
  for (let m = 0; m < 3 && !quando.length; m++) await s.ciclo()
  assert.equal(quando.length, 1)
  const entregue = atrasos().at(-1)
  assert.ok(entregue.texto.endsWith(`(em vez de ${horaLisboa(Date.parse(g.envio.alarmePlano), quando[0])}).`), entregue.texto)
  g = await chamar(s.r.get['/plano-ativo'])
  assert.notEqual(g.envio.alarme, g.envio.alarmePlano)
  assert.ok(entregue.texto.includes(`Nova hora de alarme: ${horaLisboa(Date.parse(g.envio.alarme), quando[0])} `), entregue.texto)
  s.p.stop()
})

test('decisão 4: Ativar a mesma alternativa enquanto o porto responde a uma mensagem (durante a API de rumo): nada fica "a enviar" sem temporizador e a entrega fica registada', async () => {
  const s = await preparar()
  await sair(s)
  s.porto.resposta = () => null
  s.por(s.alt.rasto[2], 0)
  for (let m = 1; m <= 40 && !s.recebidos.some(e => e.tipo === 'atraso'); m++) await s.ciclo()
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
  assert.match(chegadas[0].texto, /^Cheguei bem a Algés \(CNA\) às \d\d:\d\d\. Obrigado!$/)
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
  assert.equal(m[0].texto, `Cheguei bem a ${nome} às ${horaLisboa(Date.parse(g.agora) - 30 * MIN, s.agora())}. Obrigado!`)
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
  s.por(s.alt.rasto[2], 0)
  let m = 0
  for (; m < 180 && !filaAtraso().length; m++) await s.ciclo()
  assert.equal(filaAtraso().length, 1, 'o atraso entrou na fila')
  // mais 20 min parado: à hora de sair, a chegada e a hora de alarme são as de agora
  for (let k = 0; k < 20; k++) await s.ciclo()
  for (const f of ouvintes) s.app.on('arlequin:plano', f)
  for (let k = 0; k < 3 && !s.recebidos.some(e => e.tipo === 'atraso'); k++) await s.ciclo()
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
  t.por(t.alt.rasto[2], 0)
  for (let k = 0; k < 180 && !fila().length; k++) await t.ciclo()
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
