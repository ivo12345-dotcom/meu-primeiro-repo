import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpa, classificar } from '../../arlequin-ecra/public/lib/cpa.js'

const require = createRequire(import.meta.url)
const { avaliarAlvos } = require('../lib/vigia.js')

const NO = 1852 / 3600
const rad = (g) => g * Math.PI / 180
const EU = { position: { latitude: 39.36, longitude: -9.40 }, cog: 0, sog: 5 * NO }
const T = 1_000_000
const calc = { cpa, classificar }

// Alvo a d MN a norte, a vir para sul (colisão) ou a ir para norte.
function alvo (mmsi, dMn, rumoG, extra = {}) {
  return { mmsi, nome: 'NORDIC STAR', position: { latitude: 39.36 + dMn * 1852 / 111320, longitude: -9.40 }, cog: rad(rumoG), sog: 7 * NO, em: T, ...extra }
}

test('rota de colisão: alarme com som e mensagem', () => {
  const r = avaliarAlvos({}, EU, [alvo('1', 2, 180)], T, calc)
  assert.deepEqual(r.ativos, { 1: true })
  assert.equal(r.notificacoes[0].state, 'alarm')
  assert.deepEqual(r.notificacoes[0].method, ['visual', 'sound'])
  assert.equal(r.notificacoes[0].message, 'NORDIC STAR em rota de colisão · CPA 0,0 MN')
})

test('não repete o alarme enquanto continua em perigo', () => {
  const r1 = avaliarAlvos({}, EU, [alvo('1', 2, 180)], T, calc)
  const r2 = avaliarAlvos(r1.ativos, EU, [alvo('1', 1.9, 180)], T, calc)
  assert.deepEqual(r2.notificacoes, [])
})

test('limpa quando o alvo passa (TCPA negativo)', () => {
  const r = avaliarAlvos({ 1: true }, EU, [alvo('1', -0.5, 180)], T, calc)
  assert.deepEqual(r.notificacoes.map(n => n.state), ['normal'])
  assert.deepEqual(r.ativos, {})
})

test('alvo seguro não gera nada; alvo velho é ignorado e o alarme limpa', () => {
  assert.deepEqual(avaliarAlvos({}, EU, [alvo('2', 2, 0)], T, calc).notificacoes, [])
  const r = avaliarAlvos({ 1: true }, EU, [alvo('1', 2, 180, { em: T - 11 * 60 * 1000 })], T, calc)
  assert.deepEqual(r.notificacoes, [{ mmsi: '1', state: 'normal', method: [], message: 'Alvo perdido' }])
})
