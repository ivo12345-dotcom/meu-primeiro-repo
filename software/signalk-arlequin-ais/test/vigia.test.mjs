import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpa, classificar, PARADO } from '../../arlequin-ecra/public/lib/cpa.js'

const require = createRequire(import.meta.url)
const { avaliarAlvos } = require('../lib/vigia.js')

const NO = 1852 / 3600
const rad = (g) => g * Math.PI / 180
const EU = { position: { latitude: 39.36, longitude: -9.40 }, cog: 0, sog: 5 * NO }
const T = 1_000_000
const calc = { cpa, classificar, PARADO }

// Alvo a d MN a norte, a vir para sul (colisão) ou a ir para norte.
function alvo (mmsi, dMn, rumoG, extra = {}) {
  return { mmsi, nome: 'NORDIC STAR', position: { latitude: 39.36 + dMn * 1852 / 111320, longitude: -9.40 }, cog: rad(rumoG), sog: 7 * NO, em: T, ...extra }
}
// Ponto a d MN na marcação b (graus) a partir do nosso barco.
function ponto (dMn, bGraus) {
  const d = dMn * 1852
  return { latitude: 39.36 + d * Math.cos(rad(bGraus)) / 111320, longitude: -9.40 + d * Math.sin(rad(bGraus)) / (111320 * Math.cos(rad(39.36))) }
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

// Contrato C1 (decisão n.º 2): a colisão AIS é perigo imediato → apito contínuo.
test('C1: o alarme de colisão leva apito contínuo', () => {
  const r = avaliarAlvos({}, EU, [alvo('1', 2, 180)], T, calc)
  assert.equal(r.notificacoes[0].apito, 'continuo')
})

// Auditoria K-01: sem COG o alarme não pode desaparecer.
test('K-01: navio fundeado sem COG à nossa proa (SOG 0): alarme', () => {
  const r = avaliarAlvos({}, EU, [alvo('1', 1, 0, { cog: undefined, sog: 0 })], T, calc)
  assert.deepEqual(r.notificacoes.map(n => n.state), ['alarm'])
})

test('K-01: nós parados sem COG e um navio a vir direito a nós: alarme', () => {
  const eu = { position: EU.position, sog: 0 }
  const r = avaliarAlvos({}, eu, [alvo('1', 2, 180)], T, calc)
  assert.deepEqual(r.notificacoes.map(n => n.state), ['alarm'])
})

test('K-01: alvo sem SOG nem COG a aproximar-se a menos de 0,5 MN: alarme pela distância, e diz que não tem rumo', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  let mem
  let ativos = {}
  const todas = []
  // 0,45 MN a norte, a vir para sul a ~12 nós (60 m em cada 10 s); sem SOG nem COG no AIS
  for (let i = 0; i <= 3; i++) {
    const a = { mmsi: '9', nome: 'SEM RUMO', position: ponto(0.45 - i * 60 / 1852, 0), em: T + i * 10000 }
    const r = avaliarAlvos(ativos, eu, [a], T + i * 10000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    todas.push(...r.notificacoes)
  }
  assert.deepEqual(todas.map(n => n.state), ['alarm'])
  assert.match(todas[0].message, /^SEM RUMO a 0,4 MN e a aproximar-se · alvo sem rumo$/)
  assert.equal(todas[0].apito, 'continuo')
})

test('K-01: alvo sem SOG nem COG parado a 0,3 MN, ou a afastar-se: nenhum alarme', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  let mem
  let ativos = {}
  const todas = []
  for (let i = 0; i <= 10; i++) {
    const a = { mmsi: '9', nome: 'PARADO', position: ponto(0.3, 40), em: T + i * 10000 }
    const b = { mmsi: '8', nome: 'AFASTA', position: ponto(0.2 + i * 60 / 1852, 200), em: T + i * 10000 }
    const r = avaliarAlvos(ativos, eu, [a, b], T + i * 10000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    todas.push(...r.notificacoes)
  }
  assert.deepEqual(todas, [])
})

test('K-01: o alarme pela distância limpa quando o alvo sem rumo deixa de se aproximar (passou e afasta-se)', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  let mem
  let ativos = {}
  const estados = []
  // vem de 0,45 MN até 0,1 MN a 60 m por 10 s e depois volta para trás
  const ds = []
  for (let d = 0.45; d > 0.1; d -= 60 / 1852) ds.push(d)
  for (let i = 1; i <= 6; i++) ds.push(ds.at(-1) + 60 / 1852)
  ds.forEach((d, i) => {
    const a = { mmsi: '9', nome: 'SEM RUMO', position: ponto(d, 0), em: T + i * 10000 }
    const r = avaliarAlvos(ativos, eu, [a], T + i * 10000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    estados.push(...r.notificacoes.map(n => n.state))
  })
  assert.deepEqual(estados, ['alarm', 'normal'])
})

// Auditoria I-09 (decisão n.º 3): dois barcos parados não são colisão.
test('I-09: dois barcos amarrados a 300 m (SOG 0 nos dois): nenhum alarme', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  const pesqueiro = { mmsi: '5', nome: 'PESQUEIRO', position: ponto(300 / 1852, 30), cog: rad(110), sog: 0, em: T }
  assert.deepEqual(avaliarAlvos({}, eu, [pesqueiro], T, calc).notificacoes, [])
})

test('I-09: alarme ativo e os dois param (velocidade relativa nula): limpa', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  const r = avaliarAlvos({ 1: true }, eu, [alvo('1', 0.2, 180, { sog: 0 })], T, calc)
  assert.deepEqual(r.notificacoes.map(n => n.state), ['normal'])
})

test('decisão n.º 3: amarrado (SOG < 0,5 nó há 5 min), um salto do GPS não acorda os alvos parados; um alvo que se mexe dá sempre alarme', () => {
  const parado = { position: EU.position, cog: 0, sog: 0.1 * NO }
  const vizinho = { mmsi: '5', nome: 'VIZINHO', position: ponto(0.05, 0), cog: rad(90), sog: 0.2 * NO } // a ~90 m a norte, parado
  let mem
  let ativos = {}
  for (let s = 0; s <= 5 * 60; s += 2) {
    const r = avaliarAlvos(ativos, parado, [{ ...vizinho, em: T + s * 1000 }], T + s * 1000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    assert.deepEqual(r.notificacoes, [])
  }
  assert.equal(mem.amarrado, true)
  // o GPS salta para 0,8 nó a apontar ao vizinho (CPA 0, TCPA ~3,6 min): calado, está amarrado
  const salto = { position: EU.position, cog: 0, sog: 0.8 * NO }
  const t1 = T + 302 * 1000
  const r1 = avaliarAlvos(ativos, salto, [{ ...vizinho, em: t1 }], t1, calc, mem)
  assert.deepEqual(r1.notificacoes, [])
  // sem estar amarrado (memória nova), o mesmo salto dava alarme: a regra é só para amarrados
  assert.deepEqual(avaliarAlvos({}, salto, [{ ...vizinho, em: t1 }], t1, calc).notificacoes.map(n => n.state), ['alarm'])
  // amarrado, um navio a 7 nós em rota de colisão: alarme (nunca se cala um alvo que se mexe)
  const r2 = avaliarAlvos(r1.ativos, parado, [{ ...vizinho, em: t1 }, alvo('1', 1, 180, { em: t1 })], t1, calc, r1.memoria)
  assert.deepEqual(r2.notificacoes.map(n => `${n.mmsi}:${n.state}`), ['1:alarm'])
})

test('decisão n.º 3: deixa de estar amarrado ao fim de 1 min a andar (≥ 0,5 nó); rodar no fundeadouro não conta', () => {
  let mem
  const passo = (s, sog) => { mem = avaliarAlvos({}, { position: EU.position, cog: 0, sog: sog * NO }, [], T + s * 1000, calc, mem).memoria }
  for (let s = 0; s <= 300; s += 2) passo(s, 0)
  assert.equal(mem.amarrado, true)
  for (let s = 302; s <= 330; s += 2) passo(s, 0.9) // 30 s a rodar à âncora
  for (let s = 332; s <= 340; s += 2) passo(s, 0.1)
  assert.equal(mem.amarrado, true)
  for (let s = 342; s <= 404; s += 2) passo(s, 3) // larga
  assert.equal(mem.amarrado, false)
})

// Auditoria M-70: a histerese de 0,6 MN do alarme.
test('histerese: o alarme ativo só limpa com o CPA acima de 0,6 MN (e não nasce entre 0,5 e 0,6)', () => {
  const lado = (mn) => ({ mmsi: '1', nome: 'NORDIC STAR', position: ponto(Math.hypot(2, mn), Math.atan2(mn, 2) * 180 / Math.PI), cog: rad(180), sog: 7 * NO, em: T })
  assert.deepEqual(avaliarAlvos({}, EU, [lado(0.55)], T, calc).notificacoes, [])
  assert.deepEqual(avaliarAlvos({ 1: true }, EU, [lado(0.55)], T, calc).notificacoes, [])
  assert.deepEqual(avaliarAlvos({ 1: true }, EU, [lado(0.65)], T, calc).notificacoes.map(n => n.state), ['normal'])
})
