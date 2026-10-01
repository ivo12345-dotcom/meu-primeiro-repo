'use strict'
// O plano ativo no plugin (desenho 3b-2): o POST /ativar cria ou substitui o plano-ativo.json; o
// envio do plano (POST /plano-telegram) fica no plano ativo, antes ou depois de Ativar; ao arrancar,
// o plugin lê o plano gravado.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pa = require('../lib/plano-ativo')
const planoTexto = require('../lib/plano')
const { appFalso, plugin, chamar, calcular, costa } = require('./ajuda')

const lerPlano = (app) => pa.ler(app.getDataDirPath()).plano

test('POST /ativar cria o plano ativo (gravado em plano-ativo.json) com o href da rota ativada, a aproximação do destino e "a espera de sair"; ativar outra substitui-o', async () => {
  const app = appFalso()
  const { p, r, agora } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const { id, resultado } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  assert.equal(lerPlano(app), null)
  const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  assert.deepEqual(a.planoAtivo, { estado: 'a espera de sair' })
  const plano = lerPlano(app)
  assert.equal(plano.idCalculo, id)
  assert.equal(plano.indice, 0)
  assert.equal(plano.href, a.href)
  assert.equal(plano.estado, 'a espera de sair')
  assert.equal(plano.ativadoEm, new Date(agora()).toISOString())
  assert.equal(plano.alternativa.id, resultado.alternativas[0].id)
  assert.deepEqual(plano.alternativa.rasto, resultado.alternativas[0].rasto)
  assert.deepEqual(plano.destino.aproximacao, costa.destinos.find(d => d.id === 'alges').aproximacao)
  assert.equal(plano.envio, null)
  assert.deepEqual(fs.readdirSync(app.getDataDirPath()).filter(n => n.startsWith('plano-ativo')), ['plano-ativo.json'])
  // outra alternativa: substitui
  const b = await chamar(r.post['/ativar'], { body: { id, alternativa: 1 } })
  assert.equal(b.code, 200, b.erro)
  assert.equal(lerPlano(app).indice, 1)
  assert.equal(lerPlano(app).href, b.href)
  // a ativação que falha não mexe no plano
  app.activateRoute = async () => { throw new Error('sem posição') }
  assert.equal((await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })).code, 502)
  assert.equal(lerPlano(app).indice, 1)
  p.stop()
})

test('o envio do plano fica no plano ativo: enviado antes de Ativar (a quem, os contactos em terra, e a hora de alarme) e enviado depois de Ativar; só o chat do Ivo não conta', async () => {
  const app = appFalso()
  app.on('arlequin:plano', () => {})
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const { id, resultado } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  const alarme = new Date(planoTexto.horaAlarme(resultado.alternativas[0])).toISOString()
  // enviado antes (e outro envio só para o chat do Ivo, mais recente, não apaga os contactos)
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  app.emit('arlequin:plano-enviado', { pedido: x.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], falhas: [] })
  const y = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  app.emit('arlequin:plano-enviado', { pedido: y.pedido, entregues: ['chat 111'], contactos: [], falhas: [] })
  await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  const e = lerPlano(app).envio
  assert.deepEqual(e.contactos, ['Mãe'])
  assert.equal(e.alarme, alarme)
  assert.equal(e.pedido, x.pedido)
  assert.match(e.enviadoEm, /^\d{4}-\d\d-\d\dT/)
  // ativar outra alternativa com este plano enviado: o plano novo segue para os mesmos contactos
  // (Recalcular → Ativar, test/contactos-plugin.test.js)
  await chamar(r.post['/ativar'], { body: { id, alternativa: 1 } })
  assert.deepEqual(lerPlano(app).envio.contactos, ['Mãe'])
  assert.equal(lerPlano(app).envio.substitui, true)
  // enviado pelo Ivo depois de Ativar: fica no plano ativo quando o porto responde
  const z = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 1 } })
  app.emit('arlequin:plano-enviado', { pedido: z.pedido, entregues: ['chat 111', 'Tio'], contactos: ['Tio'], falhas: [] })
  assert.deepEqual(lerPlano(app).envio.contactos, ['Tio'])
  assert.equal(lerPlano(app).envio.alarme, new Date(planoTexto.horaAlarme(resultado.alternativas[1])).toISOString())
  p.stop()
})

test('ao arrancar, o plugin lê o plano ativo gravado (e um ficheiro estragado só dá o erro no registo)', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const { id } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  p.stop()
  const q = plugin(app)
  q.p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(q.p.planoAtivo().idCalculo, id)
  q.p.stop()
  fs.writeFileSync(path.join(app.getDataDirPath(), pa.FICHEIRO), '{')
  const s = plugin(app)
  s.p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(s.p.planoAtivo(), null)
  assert.match(app.erros.at(-1), /^plano-ativo\.json ilegível/)
  s.p.stop()
})

test('ativarRota: a descrição para o OpenCPN usa o semVela como o ecrã e o plano ("a motor (sem vento para vela)")', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const { id } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  // o resultado guardado no plugin (o GET devolve o mesmo objeto): uma "vela e motor" sem vela
  const guardado = (await chamar(r.get['/resultado/:id'], { params: { id } })).resultado
  Object.assign(guardado.alternativas[0], { propulsao: 'vela', semVela: true })
  const a = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.match(app.recursos.get(`routes/${a.rota}`).description, /, a motor \(sem vento para vela\), partida /)
  Object.assign(guardado.alternativas[0], { semVela: false })
  const b = await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.match(app.recursos.get(`routes/${b.rota}`).description, /, vela e motor, partida /)
  p.stop()
})

test('8: o envio guarda os chats (chatId) dos contactos em terra entregues, a par dos nomes (o porto escolhe por eles)', async () => {
  const app = appFalso()
  app.on('arlequin:plano', () => {})
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const { id } = await calcular(r, { destino: 'alges', tripulacao: 'so' })
  const x = await chamar(r.post['/plano-telegram'], { body: { id, alternativa: 0 } })
  app.emit('arlequin:plano-enviado', { pedido: x.pedido, entregues: ['chat 111', 'Mãe'], contactos: ['Mãe'], chats: ['222'], falhas: [] })
  await chamar(r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.deepEqual(lerPlano(app).envio.contactos, ['Mãe'])
  assert.deepEqual(lerPlano(app).envio.chats, ['222'])
  p.stop()
})

test('M8: uma só escrita atómica (a do lib/previsao.js, com o fsync da pasta onde o sistema deixa): os destinos do Ivo também a usam', async () => {
  const app = appFalso()
  const { p, r } = plugin(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  const abertos = []
  const orig = fs.openSync
  fs.openSync = (f, ...x) => { abertos.push(path.resolve(String(f))); return orig(f, ...x) }
  let d
  try { d = await chamar(r.post['/destinos'], { body: { nome: 'Fundeadouro', lat: 38.4512, lon: -8.95, conhecido: false } }) } finally { fs.openSync = orig }
  assert.equal(d.code, 201, d.erro)
  assert.ok(abertos.includes(path.resolve(app.getDataDirPath())), JSON.stringify(abertos))
  p.stop()
})
