'use strict'
// Os contactos em terra (desenho 3b-2, "Contactos em terra"): as 4 mensagens em horas de Lisboa, a
// regra do atraso (no máximo 1× por hora, só com mais de 15 min de escorregamento), a fila sem rede
// (gravada no plano ativo, nova tentativa de 2 em 2 min, descarte do que deixou de interessar).
const test = require('node:test')
const assert = require('node:assert/strict')
const ct = require('../lib/contactos')

const MIN = 60000
const H = 3600000
const T0 = Date.parse('2026-09-29T20:00:00Z') // 21:00 em Lisboa, ter 29/09
const iso = (t) => new Date(t).toISOString()

test('as mensagens: "cheguei bem", o atraso com a nova hora de alarme, "viagem terminada" com a posição em graus e minutos; horas de Lisboa com o dia quando não é hoje', () => {
  assert.equal(ct.textoChegada({ destino: 'Peniche', chegou: T0 + 10 * H, agora: T0 + 10 * H }), 'Cheguei bem a Peniche às 07:00. Obrigado!')
  assert.equal(ct.textoChegada({ destino: 'Peniche', chegou: T0 + 10 * H, agora: T0 }), 'Cheguei bem a Peniche qua 30/09 às 07:00. Obrigado!')
  assert.equal(ct.textoAtraso({ chegada: T0 + 2 * H, alarme: T0 + 4 * H, alarmeAntes: T0 + 3 * H, agora: T0 }), 'Ainda a navegar, tudo bem. Nova chegada prevista ~23:00. Nova hora de alarme: qua 30/09 01:00 (em vez de qua 30/09 00:00).')
  assert.equal(ct.textoAtraso({ chegada: T0 + H, alarme: T0 + 2.5 * H, alarmeAntes: T0 + 2 * H, agora: T0 }), 'Ainda a navegar, tudo bem. Nova chegada prevista ~22:00. Nova hora de alarme: 23:30 (em vez de 23:00).')
  assert.equal(ct.textoTerminado({ posicao: { lat: 38.6928, lon: -9.4159 }, agora: T0 }), "Viagem terminada / mudança de planos: estou bem, em 38°41,6' N 9°25,0' W às 21:00.")
  assert.equal(ct.textoTerminado({ posicao: null, agora: T0 }), 'Viagem terminada / mudança de planos: estou bem, às 21:00.')
  assert.equal(ct.grausMinutos({ lat: -0.5, lon: 0.25 }), "0°30,0' S 0°15,0' E")
  // nunca null, NaN nem undefined
  for (const t of [ct.textoChegada({ destino: null, chegou: NaN, agora: T0 }), ct.textoAtraso({ chegada: NaN, alarme: NaN, alarmeAntes: NaN, agora: T0 })]) assert.doesNotMatch(t, /null|NaN|undefined/)
  // o plano novo leva a linha "Este plano substitui o anterior." depois do envio
  const texto = 'PLANO DE NAVEGAÇÃO · ARLEQUIN\nEnviado 21:00 (horas de Lisboa)\n\nBarco: ARLEQUIN'
  assert.equal(ct.textoSubstitui(texto), 'PLANO DE NAVEGAÇÃO · ARLEQUIN\nEnviado 21:00 (horas de Lisboa)\nEste plano substitui o anterior.\n\nBarco: ARLEQUIN')
})

test('atraso: só quando a chegada prevista agora passa da "mais tarde" do plano (p90); a nova hora de alarme é a chegada prevista + 2 h, em vez da anterior', () => {
  const p90 = T0 + 6 * H
  const alarmePlano = p90 + 2 * H
  assert.equal(ct.decidirAtraso(null, { chegadaAgora: p90, p90, alarmePlano, agora: T0 }), null)
  const d = ct.decidirAtraso(null, { chegadaAgora: p90 + MIN, p90, alarmePlano, agora: T0 })
  assert.deepEqual(d, { chegada: p90 + MIN, alarme: p90 + MIN + 2 * H, alarmeAntes: alarmePlano })
})

test('atraso: depois do primeiro, no máximo 1× por hora e só se a chegada voltar a escorregar mais de 15 min', () => {
  const p90 = T0 + 6 * H
  const alarmePlano = p90 + 2 * H
  const enviado = { ultimoEm: T0, chegada: p90 + 10 * MIN, alarme: p90 + 10 * MIN + 2 * H }
  // 59 min depois, mesmo com 40 min de escorregamento: não
  assert.equal(ct.decidirAtraso(enviado, { chegadaAgora: p90 + 50 * MIN, p90, alarmePlano, agora: T0 + 59 * MIN }), null)
  // 1 h depois: com 15 min não, com 16 sim
  assert.equal(ct.decidirAtraso(enviado, { chegadaAgora: p90 + 25 * MIN, p90, alarmePlano, agora: T0 + H }), null)
  assert.deepEqual(ct.decidirAtraso(enviado, { chegadaAgora: p90 + 26 * MIN, p90, alarmePlano, agora: T0 + H }), { chegada: p90 + 26 * MIN, alarme: p90 + 26 * MIN + 2 * H, alarmeAntes: p90 + 10 * MIN + 2 * H })
  // a chegada a melhorar não manda nada
  assert.equal(ct.decidirAtraso(enviado, { chegadaAgora: p90 + 5 * MIN, p90, alarmePlano, agora: T0 + 3 * H }), null)
})

test('fila: guarda as mensagens por ordem; uma de cada vez; a que falha volta a tentar daqui a 2 min; a enviada fica com a hora a que saiu', () => {
  let c = ct.novaFila()
  c = ct.porNaFila(c, { tipo: 'atraso', texto: 'a1' }, T0)
  c = ct.porNaFila(c, { tipo: 'chegada', texto: 'cheguei' }, T0)
  // a chegada tira o atraso que ainda não saiu
  assert.deepEqual(c.fila.map(m => m.tipo), ['chegada'])
  const m = ct.proxima(c, T0)
  assert.equal(m.texto, 'cheguei')
  c = ct.marcarAEnviar(c, m.id, 'p1', T0)
  assert.equal(ct.proxima(c, T0), null, 'uma de cada vez')
  c = ct.resposta(c, 'p1', { contactos: [], entregues: ['chat 111'], falhas: [{ nome: 'Mãe', erro: 'sem ligação ao Telegram' }] }, T0 + 5000)
  assert.equal(c.fila[0].tentativas, 1)
  assert.equal(c.fila[0].proxima, iso(T0 + 5000 + 2 * MIN))
  assert.equal(c.fila[0].erro, 'Mãe: sem ligação ao Telegram')
  assert.equal(ct.proxima(c, T0 + 2 * MIN), null)
  const m2 = ct.proxima(c, T0 + 5000 + 2 * MIN)
  c = ct.marcarAEnviar(c, m2.id, 'p2', T0 + 3 * MIN)
  c = ct.resposta(c, 'p2', { contactos: ['Mãe'], entregues: ['chat 111', 'Mãe'], falhas: [] }, T0 + 3 * MIN + 2000)
  assert.deepEqual(c.fila, [])
  assert.deepEqual(c.enviadas.map(x => ({ tipo: x.tipo, enviadaEm: x.enviadaEm, contactos: x.contactos, tentativas: x.tentativas })), [{ tipo: 'chegada', enviadaEm: iso(T0 + 3 * MIN + 2000), contactos: ['Mãe'], tentativas: 2 }])
  // uma resposta de um pedido desconhecido não muda nada
  assert.deepEqual(ct.resposta(c, 'outro', { contactos: ['x'] }, T0), c)
})

test('fila: sem resposta (30 s) ou sem o porto conta como falha; um atraso mais novo tira o mais antigo; depois de "cheguei bem" ou "terminada", nenhum atraso entra', () => {
  let c = ct.novaFila()
  c = ct.porNaFila(c, { tipo: 'atraso', texto: 'a1' }, T0)
  c = ct.marcarAEnviar(c, ct.proxima(c, T0).id, 'p1', T0)
  c = ct.falhou(c, 'p1', 'o plugin porto não respondeu', T0 + 30000)
  assert.equal(c.fila[0].estado, 'fila')
  assert.equal(c.fila[0].erro, 'o plugin porto não respondeu')
  c = ct.porNaFila(c, { tipo: 'atraso', texto: 'a2' }, T0 + MIN)
  assert.deepEqual(c.fila.map(m => m.texto), ['a2'])
  c = ct.porNaFila(c, { tipo: 'terminado', texto: 't' }, T0 + 2 * MIN)
  c = ct.porNaFila(c, { tipo: 'atraso', texto: 'a3' }, T0 + 3 * MIN)
  assert.deepEqual(c.fila.map(m => m.texto), ['t'])
  // já enviado o "cheguei bem": o atraso não entra
  let d = ct.novaFila()
  d = ct.porNaFila(d, { tipo: 'chegada', texto: 'c' }, T0)
  d = ct.marcarAEnviar(d, ct.proxima(d, T0).id, 'p', T0)
  d = ct.resposta(d, 'p', { contactos: ['Mãe'] }, T0)
  d = ct.porNaFila(d, { tipo: 'atraso', texto: 'a' }, T0 + MIN)
  assert.deepEqual(d.fila, [])
  // um plano novo tira os atrasos do plano antigo
  let e = ct.porNaFila(ct.novaFila(), { tipo: 'atraso', texto: 'a' }, T0)
  e = ct.porNaFila(e, { tipo: 'plano', texto: 'p', gpx: '<gpx/>', nomeFicheiro: 'x.gpx' }, T0)
  assert.deepEqual(e.fila.map(m => m.tipo), ['plano'])
  assert.equal(e.fila[0].gpx, '<gpx/>')
  // cada mensagem leva a quem vai (os contactos entregues quando entrou na fila)
  assert.deepEqual(ct.porNaFila(ct.novaFila(), { tipo: 'chegada', texto: 'c', contactos: ['Mãe'] }, T0).fila[0].contactos, ['Mãe'])
})

test('reinício: uma mensagem que estava "a enviar" volta à fila para tentar já (a resposta já não chega)', () => {
  let c = ct.porNaFila(ct.novaFila(), { tipo: 'chegada', texto: 'c' }, T0)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p1', T0)
  const r = ct.aoArrancar(c, T0 + 10 * MIN)
  assert.equal(r.fila[0].estado, 'fila')
  assert.equal(r.fila[0].pedido, null)
  assert.equal(r.fila[0].proxima, iso(T0 + 10 * MIN))
  assert.deepEqual(ct.aoArrancar(undefined, T0), ct.novaFila())
})

test('o evento para o porto: tipo, texto, destinatários "contactos-do-plano" com a lista; o GPX só no tipo "plano"', () => {
  const ev = ct.evento({ tipo: 'atraso', texto: 'x', gpx: 'NÃO', nomeFicheiro: 'n.gpx', contactos: ['Mãe'] }, 'p1')
  assert.deepEqual(ev, { pedido: 'p1', tipo: 'atraso', texto: 'x', destinatarios: 'contactos-do-plano', contactos: ['Mãe'], chats: [] })
  assert.deepEqual(ct.evento({ tipo: 'plano', texto: 'y', gpx: '<gpx/>', nomeFicheiro: 'n.gpx' }, 'p2', ['Mãe', 'Tio'], ['222', '333']), { pedido: 'p2', tipo: 'plano', texto: 'y', gpx: '<gpx/>', nomeFicheiro: 'n.gpx', destinatarios: 'contactos-do-plano', contactos: ['Mãe', 'Tio'], chats: ['222', '333'] })
})

test('decisão 1 (Ivo): o plano novo começa com a fila limpa; só herda do plano antigo o "cheguei bem"/"terminada" por enviar e o que está "a enviar" (marcados do plano anterior), que não fecham o plano novo', () => {
  let c = ct.novaFila()
  c = ct.porNaFila(c, { tipo: 'plano', texto: 'p0' }, T0)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p0', T0)
  c = ct.resposta(c, 'p0', { contactos: ['Mãe'] }, T0)
  c = ct.porNaFila(c, { tipo: 'chegada', texto: 'cheguei' }, T0 + H)
  c = ct.porNaFila(c, { tipo: 'terminado', texto: 't' }, T0 + H)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p1', T0 + H) // a chegada "a enviar"
  const h = ct.herdar(c)
  assert.deepEqual(h.enviadas, [])
  assert.deepEqual(h.fila.map(m => [m.tipo, m.estado, m.anterior]), [['chegada', 'a enviar', true], ['terminado', 'fila', true]])
  assert.equal(h.seq, c.seq, 'os ids continuam (m<seq>)')
  // o atraso do plano novo entra (o "cheguei bem" herdado é do plano anterior)
  const d = ct.porNaFila(h, { tipo: 'atraso', texto: 'a' }, T0 + 2 * H)
  assert.deepEqual(d.fila.map(m => m.tipo), ['chegada', 'terminado', 'atraso'])
  // um atraso do plano antigo por enviar não passa; nem as enviadas
  let e = ct.porNaFila(ct.novaFila(), { tipo: 'atraso', texto: 'a' }, T0)
  assert.deepEqual(ct.herdar(e).fila, [])
  e = ct.marcarAEnviar(e, e.fila[0].id, 'pa', T0)
  assert.deepEqual(ct.herdar(e).fila.map(m => [m.tipo, m.anterior]), [['atraso', true]], 'o que está "a enviar" fica até à resposta')
  assert.deepEqual(ct.herdar(undefined), ct.novaFila())
})

test('decisão 3 (Ivo): o atraso na fila guarda a chegada e o alarme; atualizarAtraso só muda um que ainda não saiu (sem mexer na hora da tentativa); marcarAEnviar com o texto do momento', () => {
  let c = ct.porNaFila(ct.novaFila(), { tipo: 'atraso', texto: 'a1', chegada: T0 + H, alarme: T0 + 3 * H }, T0)
  assert.equal(c.fila[0].chegada, T0 + H)
  assert.equal(c.fila[0].alarme, T0 + 3 * H)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p1', T0)
  c = ct.falhou(c, 'p1', 'sem resposta', T0 + 30000)
  const proxima = c.fila[0].proxima
  c = ct.atualizarAtraso(c, c.fila[0].id, { chegada: T0 + 2 * H, alarme: T0 + 4 * H, texto: 'a2' })
  assert.deepEqual([c.fila[0].chegada, c.fila[0].alarme, c.fila[0].texto, c.fila[0].proxima, c.fila[0].tentativas], [T0 + 2 * H, T0 + 4 * H, 'a2', proxima, 1])
  // "a enviar" não muda
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p2', T0 + 3 * MIN, 'a2 às 21:03')
  assert.equal(c.fila[0].texto, 'a2 às 21:03')
  const x = ct.atualizarAtraso(c, c.fila[0].id, { chegada: T0 + 5 * H, alarme: T0 + 7 * H, texto: 'a3' })
  assert.equal(x.fila[0].chegada, T0 + 2 * H)
  // a enviada guarda a chegada, o alarme e os chats a quem chegou
  c = ct.resposta(c, 'p2', { contactos: ['Mãe'], chats: ['222'] }, T0 + 4 * MIN)
  assert.deepEqual([c.enviadas[0].chegada, c.enviadas[0].alarme, c.enviadas[0].chats], [T0 + 2 * H, T0 + 4 * H, ['222']])
})

test('8 (porto): o evento leva os chats (chatId) dos contactos a par dos nomes; o porto escolhe pelo chatId', () => {
  const ev = ct.evento({ tipo: 'chegada', texto: 'c', contactos: ['Mãe'], chats: ['222'] }, 'p1')
  assert.deepEqual(ev, { pedido: 'p1', tipo: 'chegada', texto: 'c', destinatarios: 'contactos-do-plano', contactos: ['Mãe'], chats: ['222'] })
  assert.deepEqual(ct.porNaFila(ct.novaFila(), { tipo: 'chegada', texto: 'c', contactos: ['Mãe'], chats: ['222'] }, T0).fila[0].chats, ['222'])
})

test('re-revisão M-5: o evento de uma nova tentativa diz a tentativa (o porto já não a repete ao Ivo); a 1.ª não leva o campo', () => {
  let c = ct.porNaFila(ct.novaFila(), { tipo: 'atraso', texto: 'a', contactos: ['Mãe'], chats: ['222'] }, T0)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p1', T0)
  assert.equal(ct.evento(c.fila[0], 'p1').tentativa, undefined)
  c = ct.falhou(c, 'p1', 'sem resposta', T0)
  c = ct.marcarAEnviar(c, c.fila[0].id, 'p2', T0 + 2 * MIN)
  assert.equal(ct.evento(c.fila[0], 'p2').tentativa, 2)
})
