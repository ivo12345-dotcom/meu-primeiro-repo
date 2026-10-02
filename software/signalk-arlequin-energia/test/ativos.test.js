'use strict'
// lib/ativos.js (nota do SignalK 2.33, adenda 2): os alarmes ativos num ficheiro, para o arranque seguinte
// os voltar a publicar. Igual nos plugins dos sensores (J1939, gasóleo, energia, água).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarAtivos, VALIDADE } = require('../lib/ativos')

const ALARME = { state: 'alarm', method: ['visual', 'sound'], message: 'Motor a 96 °C — sobreaquecimento', apito: 'continuo' }
const NORMAL = { state: 'normal', method: [], message: 'Normal' }

function relogio (t0 = 1_727_600_000_000) {
  const r = { t: t0 }
  r.agora = () => r.t
  return r
}
const ficheiroNovo = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ativos-')), 'alarmes-ativos.json')

test('Adenda 2: os ativos gravam-se e o arranque seguinte repõe-nos (o mesmo caminho e o mesmo valor, e o estado da regra)', () => {
  const f = ficheiroNovo()
  const r = relogio()
  const a = criarAtivos(f, { agora: r.agora })
  a.registar([{ path: 'notifications.propulsion.main.overTemperature', value: ALARME }, { path: 'propulsion.main.revolutions', value: 40 }])
  a.gravar({ estado: { x: 1 } })
  r.t += 5 * 60 * 1000
  const b = criarAtivos(f, { agora: r.agora })
  assert.deepEqual(b.repor(), { ativos: { 'notifications.propulsion.main.overTemperature': ALARME }, estado: { x: 1 } })
  assert.deepEqual(b.lista(), { 'notifications.propulsion.main.overTemperature': ALARME })
})

test('Adenda 2: um normal tira-o do ficheiro; sem nenhum ativo, nada a repor', () => {
  const f = ficheiroNovo()
  const r = relogio()
  const a = criarAtivos(f, { agora: r.agora })
  a.registar([{ path: 'notifications.x.y', value: ALARME }])
  a.gravar()
  a.registar([{ path: 'notifications.x.y', value: NORMAL }])
  a.gravar()
  assert.deepEqual(criarAtivos(f, { agora: r.agora }).repor(), { ativos: {}, estado: null })
})

test('Adenda 2: um ficheiro com mais de 10 min (o Pi esteve desligado), do futuro ou estragado não repõe nada', () => {
  const f = ficheiroNovo()
  const r = relogio()
  const a = criarAtivos(f, { agora: r.agora })
  a.registar([{ path: 'notifications.x.y', value: ALARME }])
  a.gravar()
  r.t += VALIDADE + 1000
  assert.deepEqual(criarAtivos(f, { agora: r.agora }).repor(), { ativos: {}, estado: null })
  r.t -= VALIDADE + 2000 // o relógio andou para trás
  assert.deepEqual(criarAtivos(f, { agora: r.agora }).repor().ativos, {})
  fs.writeFileSync(f, '{ cortado')
  assert.deepEqual(criarAtivos(f, { agora: r.agora }).repor(), { ativos: {}, estado: null })
})

test('Adenda 2: grava quando os ativos mudam e, com algum ativo, de minuto a minuto (a hora do ficheiro fica recente)', () => {
  const f = ficheiroNovo()
  const r = relogio()
  const a = criarAtivos(f, { agora: r.agora })
  a.gravar()
  assert.equal(fs.existsSync(f), false, 'sem alarmes não escreve nada')
  a.registar([{ path: 'notifications.x.y', value: ALARME }])
  a.gravar()
  const em1 = JSON.parse(fs.readFileSync(f, 'utf8')).em
  r.t += 30 * 1000
  a.gravar()
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).em, em1, '30 s depois, sem mudanças: não reescreve')
  r.t += 31 * 1000
  a.gravar()
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).em, r.t, 'ao fim de 1 min reescreve')
  r.t += 1000
  a.gravar({ forcar: true })
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).em, r.t, 'o stop() força')
})

test('Adenda 2: sem conseguir gravar, diz porquê (não rebenta)', () => {
  const erros = []
  const a = criarAtivos(path.join(os.tmpdir(), 'nao-existe-pasta-arlequin', 'x', 'alarmes-ativos.json'), { erro: (e) => erros.push(e) })
  a.registar([{ path: 'notifications.x.y', value: ALARME }])
  assert.doesNotThrow(() => a.gravar())
  assert.match(erros[0], /não gravei os alarmes ativos/)
})
