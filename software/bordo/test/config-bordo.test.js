'use strict'
// A configuração do SignalK de bordo está no git, mas o servidor reescreve-a ao gravar no Admin UI e o
// preparar muda-lhe o modo. Este teste diz se o que vai para o git é o modo de bordo, sem segredos e sem
// nada do simulador: corre-o (npm test) antes de cada commit.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const CONFIG = path.join(__dirname, '..', 'config')
const PASTA = path.join(CONFIG, 'plugin-config-data')
const TOKEN_FALSO = 'DEV-TELEGRAM-FALSO'
const CHATS_FALSOS = new Set(['111', '222'])

// Segredos com a forma dos verdadeiros: um token de bot do Telegram ("123456789:AA…") e um JWT (os tokens
// do SignalK). → [onde: o que é]   (a mesma função do software/dev/test/config-dev.test.js)
function segredos (valor, onde = '') {
  if (typeof valor === 'string') {
    const r = []
    if (/\d{8,10}:[\w-]{30,}/.test(valor)) r.push(`${onde}: parece um token do Telegram`)
    if (/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/.test(valor)) r.push(`${onde}: parece um JWT (token do SignalK)`)
    return r
  }
  if (valor && typeof valor === 'object') return Object.entries(valor).flatMap(([k, v]) => segredos(v, onde ? `${onde}.${k}` : k))
  return []
}

const json = (...partes) => JSON.parse(fs.readFileSync(path.join(...partes), 'utf8'))
const plugin = (id) => json(PASTA, `${id}.json`)
const configs = () => fs.readdirSync(PASTA).filter(n => n.endsWith('.json')).map(n => ({ nome: n, json: json(PASTA, n) }))

test('a configuração de bordo no git não tem segredos nem contactos verdadeiros', () => {
  assert.equal(segredos({ telegramToken: '7123456789:AAHf3kq9Zx-1234567890abcdefghijklmnop' }).length, 1, 'o detetor funciona')
  const todos = configs()
  assert.ok(todos.length >= 14, `só ${todos.length} ficheiros`)
  for (const { nome, json: j } of todos) {
    assert.deepEqual(segredos(j, nome), [])
    if ('token' in (j.configuration || {})) assert.equal(j.configuration.token, '', `${nome}: o token fica vazio`)
  }
  assert.deepEqual(segredos(json(CONFIG, 'settings.json'), 'settings.json'), [])
  const porto = plugin('signalk-arlequin-porto').configuration
  assert.equal(porto.telegramToken, TOKEN_FALSO)
  assert.equal(new URL(porto.telegramBase).hostname, 'localhost')
  assert.ok((porto.chatIds || []).every(id => CHATS_FALSOS.has(String(id))), JSON.stringify(porto.chatIds))
  assert.ok((porto.contactosPlano || []).every(x => CHATS_FALSOS.has(String(x.chatId))), JSON.stringify(porto.contactosPlano))
})

test('os plugins de bordo: os do dev sem o simulador, mais as caixas e as contas do vento real e da proa verdadeira', () => {
  const bordo = json(CONFIG, 'package.json').dependencies
  const dev = json(CONFIG, '..', '..', 'dev', 'config', 'package.json').dependencies
  assert.equal('arlequin-simulador' in bordo, false)
  const esperado = { ...dev, 'signalk-arlequin-caixas': 'file:../../signalk-arlequin-caixas', 'signalk-derived-data': '1.47.0' }
  delete esperado['arlequin-simulador']
  assert.deepEqual(bordo, esperado)
  assert.equal(fs.existsSync(path.join(PASTA, 'arlequin-simulador.json')), false)
})

test('o estado no git é o de bordo: a caixa verdadeira, os dados na pasta de casa, sem GPS a fingir', () => {
  const caixas = plugin('signalk-arlequin-caixas')
  assert.equal(caixas.enabled, true)
  assert.equal(caixas.configuration.porta, 'auto')
  assert.equal(caixas.configuration.ensaio, false)
  for (const id of ['signalk-arlequin-caixanegra', 'signalk-arlequin-ia', 'signalk-arlequin-rota']) {
    assert.equal(plugin(id).enabled, true, id)
    assert.equal(plugin(id).configuration.pasta, '~/arlequin-dados', id)
  }
  const s = json(CONFIG, 'settings.json')
  assert.deepEqual(s.pipedProviders, [
    { id: 'b330', enabled: false, pipeElements: [{ type: 'providers/simple', options: { logging: false, type: 'NMEA0183', subOptions: { type: 'serial', device: '', baudrate: 38400, validateChecksum: true } } }] },
    { id: 'b330-a-fingir', enabled: false, pipeElements: [{ type: 'providers/simple', options: { logging: false, type: 'NMEA0183', subOptions: { type: 'tcp', host: 'localhost', port: 8766, validateChecksum: true } } }] }
  ])
  assert.equal(s.vessel.name, 'Arlequin')
})

test('as caixas arrancam com os valores por omissão do próprio plugin', () => {
  const esquema = require('../../signalk-arlequin-caixas')({}).schema.properties
  const omissao = Object.fromEntries(Object.entries(esquema).map(([k, v]) => [k, v.default]))
  assert.deepEqual(plugin('signalk-arlequin-caixas').configuration, omissao)
})

test('o motor lê pela caixa; a rota sem modo de teste; a caixa negra com os limites do dev', () => {
  const motor = plugin('signalk-arlequin-j1939')
  assert.equal(motor.enabled, true)
  assert.deepEqual(motor.configuration, { fonte: 'caixa', interface: 'can1', estimarConsumo: true, fatorConsumo: 1, mapaAlarmes: [] })
  const rota = plugin('signalk-arlequin-rota').configuration
  assert.notEqual(rota.modoTeste, true)
  assert.equal(rota.porta, 3000)
  const cn = plugin('signalk-arlequin-caixanegra').configuration
  assert.deepEqual([cn.limiteAviso, cn.limiteParar], [80, 95])
})

test('ligado o que conta agora; desligado o que fica para depois', () => {
  const ligados = ['signalk-arlequin-caixas', 'signalk-arlequin-j1939', 'signalk-arlequin-caixanegra', 'signalk-arlequin-ia', 'signalk-arlequin-rota',
    'arlequin-ecra', 'signalk-arlequin-ais', 'signalk-logbook', 'course-provider', 'resources-provider', 'derived-data']
  const paraDepois = ['signalk-arlequin-energia', 'signalk-arlequin-gasoleo', 'signalk-arlequin-agua', 'signalk-arlequin-porto']
  for (const id of ligados) assert.equal(plugin(id).enabled, true, `${id} devia estar ligado`)
  for (const id of paraDepois) assert.equal(plugin(id).enabled, false, `${id} devia estar desligado`)
  assert.deepEqual(configs().map(c => c.nome.replace(/\.json$/, '')).sort(), [...ligados, ...paraDepois].sort())
})
