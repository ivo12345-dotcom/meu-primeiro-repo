'use strict'
// Os plugins dos sensores guardam os alarmes ativos com o mesmo módulo (nota do SignalK 2.33, adenda 2 da
// auditoria): uma cópia em cada pacote (cada plugin instala-se sozinho no Pi). As cópias e os testes delas
// têm de ser iguais: uma correção numa tem de ir para as outras.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SOFTWARE = path.join(__dirname, '..', '..')
const PACOTES = ['signalk-arlequin-j1939', 'signalk-arlequin-gasoleo', 'signalk-arlequin-energia', 'signalk-arlequin-agua']
const ler = (pacote, f) => fs.readFileSync(path.join(SOFTWARE, pacote, f), 'utf8').replace(/\r\n/g, '\n')

for (const f of ['lib/ativos.js', 'test/ativos.test.js']) {
  test(`${f} é igual nos quatro plugins dos sensores (${PACOTES.join(', ')})`, () => {
    const [primeiro, ...outros] = PACOTES
    for (const p of outros) assert.equal(ler(p, f), ler(primeiro, f), `${p}/${f} difere de ${primeiro}/${f}`)
  })
}
