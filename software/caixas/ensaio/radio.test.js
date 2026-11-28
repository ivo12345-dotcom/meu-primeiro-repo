'use strict'
// Guardas sobre o programa do rádio das placas, lidas do código (sem placa nenhuma).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.join(__dirname, '..')
const fontes = ['comum/src', 'caixa1', 'caixa2'].flatMap(pasta =>
  fs.readdirSync(path.join(RAIZ, pasta)).filter(n => /\.(h|ino)$/.test(n)).map(n => `${pasta}/${n}`))
// o código sem os comentários de fim de linha (onde a função pode vir escrita por extenso)
const codigo = (nome) => fs.readFileSync(path.join(RAIZ, nome), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

// Visto na caixa 2 a 28/11/2026: pedir ao chip que desfaça o rádio das placas (esp_now_deinit) sem ele
// alguma vez ter sido aberto fá-lo ir buscar o que não existe, e a placa recomeça sem parar, calada.
// Por isso só há um sítio que o desfaz, o aqRadioDesliga, que primeiro vê se está aberto.
test('o rádio das placas só se desfaz num sítio, e só depois de ver que está aberto', () => {
  const quem = fontes.filter(nome => codigo(nome).includes('esp_now_deinit'))
  assert.deepEqual(quem, ['comum/src/arlequin_radio.h'], 'esp_now_deinit chamado fora do aqRadioDesliga')
  const radio = codigo('comum/src/arlequin_radio.h')
  assert.equal(radio.split('esp_now_deinit').length - 1, 1, 'esp_now_deinit chamado mais de uma vez')
  const desliga = /inline void aqRadioDesliga\(\) \{([\s\S]*?)\n\}/.exec(radio)
  assert.ok(desliga, 'falta o aqRadioDesliga')
  const corpo = desliga[1]
  assert.ok(corpo.indexOf('if (!aqRadioAberto) return;') >= 0, 'o aqRadioDesliga não vê se o rádio está aberto')
  assert.ok(corpo.indexOf('if (!aqRadioAberto) return;') < corpo.indexOf('esp_now_deinit'), 'desfaz antes de ver se está aberto')
  // e o rádio só fica dado por aberto depois de o chip dizer que abriu
  const liga = /inline bool aqRadioLiga\([^)]*\) \{([\s\S]*?)\n\}/.exec(radio)
  assert.ok(liga, 'falta o aqRadioLiga')
  assert.ok(liga[1].indexOf('if (esp_now_init() != ESP_OK) return false;') < liga[1].indexOf('aqRadioAberto = true;'))
  assert.ok(liga[1].indexOf('aqRadioAberto = true;') > 0)
})
