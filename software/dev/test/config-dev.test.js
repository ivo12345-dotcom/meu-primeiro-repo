'use strict'
// A configuração do SignalK do dev está no git (config/plugin-config-data/*.json), mas o servidor reescreve-a
// ao gravar no Admin UI e com o savePluginOptions (calibração do gasóleo e da bomba): um token verdadeiro
// posto para testar (o do bot do Telegram, um de admin para o logbook) ou um contacto verdadeiro acabava
// num commit (auditoria M-71). Este teste falha antes disso: corre-o (npm test) antes de cada commit.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PASTA = path.join(__dirname, '..', 'config', 'plugin-config-data')
const TOKEN_FALSO = 'DEV-TELEGRAM-FALSO'
const CHATS_FALSOS = new Set(['111', '222'])

// Segredos com a forma dos verdadeiros: um token de bot do Telegram ("123456789:AA…") e um JWT (os tokens
// do SignalK). → [onde: o que é]
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

const configs = () => fs.readdirSync(PASTA).filter(n => n.endsWith('.json')).map(n => ({ nome: n, json: JSON.parse(fs.readFileSync(path.join(PASTA, n), 'utf8')) }))

test('M-71: o detetor apanha um token do Telegram e um JWT postos à experiência', () => {
  assert.equal(segredos({ telegramToken: '7123456789:AAHf3kq9Zx-1234567890abcdefghijklmnop' }).length, 1)
  assert.equal(segredos({ x: [{ token: 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImVjcmEifQ.c2lnbmF0dXJlLWZhbHNh' }] }).length, 1)
  assert.deepEqual(segredos({ telegramToken: TOKEN_FALSO, token: '' }), [])
})

test('M-71: a configuração do dev no git não tem segredos nem contactos verdadeiros', () => {
  const todos = configs()
  assert.ok(todos.length >= 10, 'devia ler os plugin-config-data do dev')
  for (const { nome, json } of todos) {
    assert.deepEqual(segredos(json, nome), [])
    const c = json.configuration || {}
    if ('token' in c) assert.equal(c.token, '', `${nome}: o token fica vazio no dev`)
  }
  const porto = todos.find(x => x.nome === 'signalk-arlequin-porto.json').json.configuration
  assert.equal(porto.telegramToken, TOKEN_FALSO)
  assert.equal(new URL(porto.telegramBase).hostname, 'localhost')
  assert.ok((porto.chatIds || []).every(id => CHATS_FALSOS.has(String(id))), JSON.stringify(porto.chatIds))
  assert.ok((porto.contactosPlano || []).every(x => CHATS_FALSOS.has(String(x.chatId))), JSON.stringify(porto.contactosPlano))
})
