import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpa, classificar, PARADO, LIMITES_PORTO } from '../../arlequin-ecra/public/lib/cpa.js'

const require = createRequire(import.meta.url)
const { avaliarAlvos, LIMPA_APOS } = require('../lib/vigia.js')

const NO = 1852 / 3600
const rad = (g) => g * Math.PI / 180
const EU = { position: { latitude: 39.36, longitude: -9.40 }, cog: 0, sog: 5 * NO }
const T = 1_000_000
const calc = { cpa, classificar, PARADO, LIMITES_PORTO }

// Alvo a d MN a norte, a vir para sul (colisão) ou a ir para norte.
function alvo (mmsi, dMn, rumoG, extra = {}) {
  return { mmsi, nome: 'NORDIC STAR', position: { latitude: 39.36 + dMn * 1852 / 111320, longitude: -9.40 }, cog: rad(rumoG), sog: 7 * NO, em: T, ...extra }
}
// Ponto a d MN na marcação b (graus) a partir do nosso barco.
function ponto (dMn, bGraus) {
  const d = dMn * 1852
  return { latitude: 39.36 + d * Math.cos(rad(bGraus)) / 111320, longitude: -9.40 + d * Math.sin(rad(bGraus)) / (111320 * Math.cos(rad(39.36))) }
}

// Um cenário de 2 em 2 s: eu(s) → { x, y, ...o que o GPS diz }, alvos(s) → [{ mmsi, nome, x, y, em?, ...o que o AIS diz }]
// (x para leste, y para norte, em metros a partir da origem). Acaba no embate (menos de 30 m).
// → { ev: [{ s, d, mmsi, state, message, apito }], embate (s ou null), emPorto: [por passo], mem }
function simular ({ dur, passo = 2, eu, alvos, portos = [], origem = { latitude: 39.0, longitude: -9.6 }, t0 = T }) {
  const pt = (x, y) => ({ latitude: origem.latitude + y / 111320, longitude: origem.longitude + x / (111320 * Math.cos(rad(origem.latitude))) })
  let mem
  let ativos = {}
  const ev = []
  const emPorto = []
  for (let s = 0; s <= dur; s += passo) {
    const t = t0 + s * 1000
    const { x, y, ...gps } = eu(s)
    const lista = alvos(s)
    const r = avaliarAlvos(ativos, { position: pt(x, y), ...gps }, lista.map(({ x: ax, y: ay, em, ...ais }) => ({ ...ais, position: pt(ax, ay), em: em ?? t })), t, calc, mem, { portos })
    ativos = r.ativos
    mem = r.memoria
    emPorto.push(r.emPorto)
    for (const n of r.notificacoes) {
      const a = lista.find(z => z.mmsi === n.mmsi)
      ev.push({ s, d: a ? Math.hypot(a.x - x, a.y - y) : null, mmsi: n.mmsi, state: n.state, message: n.message, apito: n.apito })
    }
    if (lista.some(a => Math.hypot(a.x - x, a.y - y) < 30)) return { ev, embate: s, emPorto, mem }
  }
  return { ev, embate: null, emPorto, mem }
}
const estados = (ev) => ev.map(e => `${e.mmsi}:${e.state}`)
const minutosDeAviso = (r) => (r.embate - r.ev.find(e => e.state === 'alarm').s) / 60

test('rota de colisão: alarme com som e mensagem', () => {
  const r = avaliarAlvos({}, EU, [alvo('1', 2, 180)], T, calc)
  assert.deepEqual(r.ativos, { 1: true })
  assert.equal(r.notificacoes[0].state, 'alarm')
  assert.deepEqual(r.notificacoes[0].method, ['visual', 'sound'])
  // revisão F6 (Menor 9): abaixo de 0,05 MN a distância diz-se em metros (antes "CPA 0,0 MN")
  assert.equal(r.notificacoes[0].message, 'NORDIC STAR em rota de colisão · CPA 0 m')
})

test('não repete o alarme enquanto continua em perigo', () => {
  const r1 = avaliarAlvos({}, EU, [alvo('1', 2, 180)], T, calc)
  const r2 = avaliarAlvos(r1.ativos, EU, [alvo('1', 1.9, 180)], T, calc)
  assert.deepEqual(r2.notificacoes, [])
})

// F6b (revisão F6, Importante 1): um alarme ativo só limpa com 30 s seguidos sem perigo (antes: na 1.ª
// avaliação; um dado a falhar numa leitura sim e noutra não dava alarme/normal de 2 em 2 s).
test('limpa quando o alvo passa (TCPA negativo), com 30 s seguidos já a afastar-se', () => {
  const r1 = avaliarAlvos({ 1: true }, EU, [alvo('1', -0.5, 180)], T, calc)
  assert.deepEqual(r1.notificacoes, [])
  assert.deepEqual(r1.ativos, { 1: true })
  const r2 = avaliarAlvos(r1.ativos, EU, [alvo('1', -0.5, 180, { em: T + LIMPA_APOS })], T + LIMPA_APOS, calc, r1.memoria)
  assert.deepEqual(r2.notificacoes.map(n => n.state), ['normal'])
  assert.deepEqual(r2.ativos, {})
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

// F6b (revisão F6, Importante 2): um alvo sem SOG nem COG que manda posições tem velocidade pelo rasto
// dele (2 posições ou mais em 30 s ou mais): o alarme sai do CPA/TCPA, confirmado na posição seguinte
// (antes: só pela regra da distância, a menos de 0,5 MN, com "a aproximar-se · alvo sem rumo").
test('K-01: alvo sem SOG nem COG a aproximar-se: a velocidade sai do rasto dele e dá o alarme, com apito contínuo', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  let mem
  let ativos = {}
  const todas = []
  // 0,45 MN a norte, a vir para sul a ~12 nós (60 m em cada 10 s); sem SOG nem COG no AIS
  for (let i = 0; i <= 5; i++) {
    const a = { mmsi: '9', nome: 'SEM RUMO', position: ponto(0.45 - i * 60 / 1852, 0), em: T + i * 10000 }
    const r = avaliarAlvos(ativos, eu, [a], T + i * 10000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    todas.push(...r.notificacoes.map(n => ({ ...n, i })))
  }
  assert.deepEqual(todas.map(n => `${n.state}@${n.i}`), ['alarm@4'], 'a estimativa aos 30 s (4 posições), confirmada na posição seguinte')
  assert.match(todas[0].message, /^SEM RUMO em rota de colisão · CPA \d+ m · rumo do alvo pelo rasto$/)
  assert.equal(todas[0].apito, 'continuo')
})

// A regra da distância (K-01) fica para quando ainda não há rasto: um alvo que só mandou uma posição
// (ex.: um classe B parado, de 3 em 3 min) e nós a ir para ele.
test('K-01: sem rasto do alvo (uma só posição), a regra da distância: menos de 0,5 MN e a aproximar-se de forma sustentada (30 s)', () => {
  const alvoFixo = { mmsi: '9', nome: 'SEM RUMO', position: ponto(0.45, 0), em: T }
  let mem
  let ativos = {}
  const todas = []
  for (let s = 0; s <= 40; s += 2) {
    const eu = { position: ponto(5 * NO * s / 1852, 0), cog: 0, sog: 5 * NO } // nós a 5 nós para norte
    const r = avaliarAlvos(ativos, eu, [alvoFixo], T + s * 1000, calc, mem)
    ativos = r.ativos
    mem = r.memoria
    todas.push(...r.notificacoes.map(n => ({ ...n, s })))
  }
  assert.deepEqual(todas.map(n => `${n.state}@${n.s}`), ['alarm@32'], '30 s de histórico e a confirmação 2 s depois')
  assert.equal(todas[0].message, 'SEM RUMO a 0,4 MN e a aproximar-se · alvo sem rumo')
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

// F6b: com o rasto, o alarme limpa quando o rasto mostra que o alvo já passou (TCPA negativo) e 30 s seguidos
// (antes: logo que a distância voltava a subir 25 m, com 6 posições a afastar-se).
test('K-01: o alarme de um alvo sem rumo limpa quando ele passa e se afasta', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  let mem
  let ativos = {}
  const estados = []
  // vem de 0,45 MN até 0,1 MN a 60 m por 10 s e depois volta para trás
  const ds = []
  for (let d = 0.45; d > 0.1; d -= 60 / 1852) ds.push(d)
  for (let i = 1; i <= 20; i++) ds.push(ds.at(-1) + 60 / 1852)
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

test('I-09: alarme ativo e os dois param (velocidade relativa nula): limpa (com 30 s seguidos parados)', () => {
  const eu = { position: EU.position, cog: 0, sog: 0 }
  const r1 = avaliarAlvos({ 1: true }, eu, [alvo('1', 0.2, 180, { sog: 0 })], T, calc)
  assert.deepEqual(r1.notificacoes, [])
  const r2 = avaliarAlvos(r1.ativos, eu, [alvo('1', 0.2, 180, { sog: 0, em: T + LIMPA_APOS })], T + LIMPA_APOS, calc, r1.memoria)
  assert.deepEqual(r2.notificacoes.map(n => n.state), ['normal'])
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

// Auditoria M-70: a histerese de 0,6 MN do alarme (F6b: e os 30 s seguidos acima dela para limpar).
test('histerese: o alarme ativo só limpa com o CPA acima de 0,6 MN (e não nasce entre 0,5 e 0,6)', () => {
  const lado = (mn, em = T) => ({ mmsi: '1', nome: 'NORDIC STAR', position: ponto(Math.hypot(2, mn), Math.atan2(mn, 2) * 180 / Math.PI), cog: rad(180), sog: 7 * NO, em })
  assert.deepEqual(avaliarAlvos({}, EU, [lado(0.55)], T, calc).notificacoes, [])
  assert.deepEqual(avaliarAlvos({ 1: true }, EU, [lado(0.55)], T, calc).notificacoes, [])
  const r1 = avaliarAlvos({ 1: true }, EU, [lado(0.65)], T, calc)
  assert.deepEqual(r1.notificacoes, [])
  assert.deepEqual(avaliarAlvos(r1.ativos, EU, [lado(0.65, T + LIMPA_APOS)], T + LIMPA_APOS, calc, r1.memoria).notificacoes.map(n => n.state), ['normal'])
})

// ---- F6b, revisão F6, Importante 1: o alarme não oscila quando um COG/SOG falha a meio ----

test('revisão F6 (Importante 1): o nosso COG vazio numa RMC sim e noutra não (GPS a 0,8 nó): um só alarme, sem "normal" pelo meio', () => {
  const r = simular({
    dur: 1500,
    eu: (s) => ({ x: 0, y: 0.8 * NO * s, sog: 0.8 * NO, cog: s % 4 === 0 ? 0 : null }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 4 * 1852 - 12 * NO * s, sog: 12 * NO, cog: Math.PI }]
  })
  assert.deepEqual(estados(r.ev), ['1:alarm'], 'antes: 240 alarmes e 239 "normal", de 2 em 2 s')
  assert.ok(r.embate !== null)
})

test('revisão F6 (Importante 1): o COG do alvo desaparece a 2,6 MN com o alarme de CPA ativo: o alarme continua até ao fim', () => {
  const r = simular({
    dur: 1500,
    eu: (s) => ({ x: 0, y: 0.8 * NO * s, sog: 0.8 * NO, cog: 0 }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 4 * 1852 - 12 * NO * s, sog: 12 * NO, cog: s < 400 ? Math.PI : undefined }]
  })
  assert.deepEqual(estados(r.ev), ['1:alarm'], 'antes: "normal" aos 400 s e o alarme outra vez só a 915 m')
  assert.equal(r.ev[0].s, 0)
})

test('revisão F6 (Importante 1): o alvo perde o SOG e o COG e deixa de mandar posições: o alarme fica até o alvo se perder (10 min)', () => {
  const r = simular({
    dur: 900,
    eu: () => ({ x: 0, y: 0, sog: 0, cog: 0 }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 2 * 1852 - 12 * NO * Math.min(s, 100), em: T + Math.min(s, 100) * 1000, ...(s < 100 ? { sog: 12 * NO, cog: Math.PI } : {}) }]
  })
  assert.deepEqual(r.ev.map(e => `${e.state}@${e.s}`), ['alarm@0', 'normal@702'])
  assert.equal(r.ev[1].message, 'Alvo perdido')
})

// ---- F6b, revisão F6, Importante 2: sem a velocidade de um barco, a do rasto ----

test('revisão F6 (Importante 2): nós parados com o GPS sem SOG nem COG e um navio a 12 nós de proa a 3 MN: alarme com quase 15 min (antes 2,4 min)', () => {
  const r = simular({
    dur: 1200,
    eu: () => ({ x: 0, y: 0 }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 3 * 1852 - 12 * NO * s, sog: 12 * NO, cog: Math.PI }]
  })
  assert.deepEqual(estados(r.ev), ['1:alarm'])
  assert.ok(minutosDeAviso(r) >= 14, `aviso ${minutosDeAviso(r).toFixed(1)} min`)
  assert.equal(r.ev[0].message, 'NAVIO em rota de colisão · CPA 0 m · o nosso rumo pelo rasto')
})

test('revisão F6 (Importante 2): nós a 5 nós sem o GPS dar SOG/COG e o navio a 12 nós de proa: alarme com 10 min (antes 1,7 min)', () => {
  const r = simular({
    dur: 1200,
    eu: (s) => ({ x: 0, y: 5 * NO * s }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 3 * 1852 - 12 * NO * s, sog: 12 * NO, cog: Math.PI }]
  })
  assert.deepEqual(estados(r.ev), ['1:alarm'])
  assert.ok(minutosDeAviso(r) >= 9.5, `aviso ${minutosDeAviso(r).toFixed(1)} min`)
})

test('revisão F6 (Importante 2): um navio a 12 nós sem SOG nem COG no AIS (posição de 10 em 10 s): alarme com mais de 14 min (antes 2,3 min)', () => {
  const r = simular({
    dur: 1200,
    eu: () => ({ x: 0, y: 0, sog: 0, cog: 0 }),
    alvos: (s) => [{ mmsi: '1', nome: 'NAVIO', x: 0, y: 3 * 1852 - 12 * NO * (s - s % 10), em: T + (s - s % 10) * 1000 }]
  })
  assert.deepEqual(estados(r.ev), ['1:alarm'])
  assert.ok(minutosDeAviso(r) >= 14, `aviso ${minutosDeAviso(r).toFixed(1)} min`)
  assert.equal(r.ev[0].message, 'NAVIO em rota de colisão · CPA 0 m · rumo do alvo pelo rasto')
})

test('revisão F6 (Menor 5): amarrados, um vizinho sem SOG nem COG a 150 m e o nosso GPS a saltar 60 m para ele durante 10 s: nenhum alarme', () => {
  const vizinho = () => [{ mmsi: '7', nome: 'VIZINHO', x: 0, y: 150 }]
  const salto = (s, de) => (s >= de && s < de + 10 ? 60 : 0)
  // o vizinho a mandar posição a cada passo, o salto aos 400 s (antes: alarme com apito contínuo aos 400 s)
  assert.deepEqual(simular({ dur: 600, eu: (s) => ({ x: 0, y: salto(s, 400), sog: 0.1 * NO, cog: 0 }), alvos: vizinho }).ev, [])
  // um classe B parado (posição de 3 em 3 min) e o salto logo aos 40 s: ainda sem rasto, a regra da distância não se engana
  assert.deepEqual(simular({ dur: 600, eu: (s) => ({ x: 0, y: salto(s, 40), sog: 0.1 * NO, cog: 0 }), alvos: (s) => [{ ...vizinho(s)[0], em: T + (s - s % 180) * 1000 }] }).ev, [])
  // e com o nosso GPS sem SOG nem COG (a nossa velocidade também pelo rasto)
  assert.deepEqual(simular({ dur: 600, eu: (s) => ({ x: 0, y: salto(s, 400) }), alvos: vizinho }).ev, [])
})

// ---- F6b, decisão do Ivo "AIS dentro de um porto" (contrato C12) ----

const PENICHE = { nome: 'Peniche', lat: 39.3522, lon: -9.376 } // o cais de destinos.json da rota
const emPeniche = { origem: { latitude: PENICHE.lat, longitude: PENICHE.lon }, portos: [PENICHE] }
const amarrados = () => [200, 400, 600, 800].map((y, i) => ({ mmsi: `9${i}`, nome: `AMARRADO${i}`, x: 40, y: -y, sog: 0, cog: rad(90) }))
const saida = (s) => ({ x: 0, y: s >= 600 ? -(s - 600) * 3 * NO : 0, sog: s >= 600 ? 3 * NO : 0, cog: Math.PI }) // 10 min amarrados, larga a 3 nós

test('C12: a sair da marina de Peniche a 3 nós, os barcos amarrados ao longo do canal não apitam (antes: 4 alarmes)', () => {
  const r = simular({ ...emPeniche, dur: 900, eu: saida, alvos: amarrados })
  assert.deepEqual(r.ev, [])
  assert.ok(r.emPorto.every(Boolean), 'em porto o tempo todo')
})

test('C12: na mesma saída, um ferry a andar no canal apita (um alvo em movimento apita sempre)', () => {
  const ferry = (s) => ({ mmsi: '80', nome: 'FERRY', x: 600 - 5 * NO * Math.max(0, s - 600), y: -400, sog: 5 * NO, cog: rad(270) })
  const r = simular({ ...emPeniche, dur: 900, eu: saida, alvos: (s) => [...amarrados(), ferry(s)] })
  assert.ok(r.ev.some(e => e.mmsi === '80' && e.state === 'alarm'), JSON.stringify(r.ev))
  assert.ok(r.ev.every(e => e.mmsi === '80'), 'só o ferry')
})

test('C12: no mar (longe dos portos), um navio fundeado no nosso caminho apita como antes (K-01)', () => {
  const r = simular({ ...emPeniche, origem: { latitude: 39.2, longitude: -9.7 }, dur: 900, eu: (s) => ({ x: 0, y: 5 * NO * s, sog: 5 * NO, cog: 0 }), alvos: () => [{ mmsi: '70', nome: 'FUNDEADO', x: 0, y: 1852, sog: 0 }] })
  assert.deepEqual(estados(r.ev), ['70:alarm'])
  assert.ok(r.emPorto.every(e => e === false))
})

test('C12: junto ao porto mas a 4 nós ou mais, um alvo parado no caminho apita; a 3 nós não (amarelo no ecrã)', () => {
  const fundeado = () => [{ mmsi: '71', nome: 'FUNDEADO', x: 0, y: 300, sog: 0 }]
  const devagar = simular({ ...emPeniche, dur: 120, eu: (s) => ({ x: 0, y: -400 + 3 * NO * s, sog: 3 * NO, cog: 0 }), alvos: fundeado })
  assert.deepEqual(devagar.ev, [])
  const depressa = simular({ ...emPeniche, dur: 120, eu: (s) => ({ x: 0, y: -400 + 5 * NO * s, sog: 5 * NO, cog: 0 }), alvos: fundeado })
  assert.deepEqual(estados(depressa.ev), ['71:alarm'])
  assert.ok(depressa.emPorto.every(e => e === false))
})

test('C12: o "em porto" só muda com a condição nova 30 s seguidos (o SOG a 3,9/4,1 nós não o faz oscilar)', () => {
  // 1 min a 3 nós no cais, 40 s a 3,9/4,1 nós, depois a 4,5 nós
  const sog = (s) => (s < 60 ? 3 : s < 100 ? (s % 4 ? 3.9 : 4.1) : 4.5)
  const r = simular({ ...emPeniche, dur: 160, eu: (s) => ({ x: 0, y: 0, sog: sog(s) * NO, cog: 0 }), alvos: () => [] })
  const em = (seg) => r.emPorto[seg / 2]
  assert.equal(em(0), true)
  assert.ok([60, 70, 80, 90, 98].every(x => em(x) === true), `a 3,9/4,1 nós continua em porto: ${JSON.stringify(r.emPorto)}`)
  assert.equal(em(126), true, 'a 4,5 nós desde os 100 s: ainda não passaram 30 s')
  assert.equal(em(132), false, 'a 4,5 nós há 30 s: já não está em porto')
})

test('C12: a mais de 0,5 MN do porto não está em porto, mesmo parado', () => {
  const r = simular({ ...emPeniche, dur: 10, eu: () => ({ x: 0, y: -0.6 * 1852, sog: 0, cog: 0 }), alvos: () => [] })
  assert.ok(r.emPorto.every(e => e === false))
  const dentro = simular({ ...emPeniche, dur: 10, eu: () => ({ x: 0, y: -0.4 * 1852, sog: 0, cog: 0 }), alvos: () => [] })
  assert.ok(dentro.emPorto.every(e => e === true))
})

// ---- F6b, revisão F6, Menores 7 e 9 ----

test('revisão F6 (Menor 7): fundeados, um barco a garrar a 0,45 nó (com COG) direito a nós: alarme a menos de 0,05 MN, com minutos de aviso', () => {
  const v = 0.45 * NO
  const r = simular({ dur: 1200, eu: () => ({ x: 0, y: 0, sog: 0, cog: 0 }), alvos: (s) => [{ mmsi: '11', nome: 'GARRA', x: 0, y: 150 - v * s, sog: v, cog: Math.PI }] })
  assert.deepEqual(estados(r.ev), ['11:alarm'], 'antes: nenhum alarme até ao embate')
  assert.ok(r.ev[0].d < 0.05 * 1852 && r.ev[0].d > 80, `a ${r.ev[0].d} m`)
  assert.ok(minutosDeAviso(r) >= 4, `aviso ${minutosDeAviso(r).toFixed(1)} min`)
  assert.match(r.ev[0].message, /^GARRA a \d+ m e a aproximar-se devagar$/)
})

test('revisão F6 (Menor 7): o mesmo barco a garrar também apita amarrados e em porto (mexe-se)', () => {
  const v = 0.45 * NO
  const r = simular({ ...emPeniche, dur: 1200, eu: () => ({ x: 0, y: 0, sog: 0, cog: 0 }), alvos: (s) => [{ mmsi: '11', nome: 'GARRA', x: 0, y: 150 - v * Math.max(0, s - 400), sog: s > 400 ? v : 0, cog: Math.PI }] })
  assert.ok(r.mem.amarrado && r.emPorto.at(-1))
  assert.deepEqual(estados(r.ev), ['11:alarm'])
})

test('revisão F6 (Menor 7): um vizinho parado a 60 m e nós a atracar devagar (0,3 nó) para o lado dele: nada (é o nosso movimento, não o dele)', () => {
  const r = simular({ dur: 300, eu: (s) => ({ x: 0, y: 0.3 * NO * s, sog: 0.3 * NO, cog: 0 }), alvos: () => [{ mmsi: '12', nome: 'VIZINHO', x: 10, y: 60, sog: 0 }] })
  assert.deepEqual(r.ev, [])
})

test('revisão F6 (Menor 9): abaixo de 0,05 MN as mensagens dizem os metros', () => {
  const r = avaliarAlvos({}, EU, [{ mmsi: '12', nome: 'PERTO', position: ponto(80 / 1852, 4), sog: 0, em: T }], T, calc)
  assert.match(r.notificacoes[0].message, /^PERTO em rota de colisão · CPA \d m$/)
  assert.doesNotMatch(r.notificacoes[0].message, /0,0 MN/)
})

// ---- F6b, revisão F6, Menor 8: as idades do SOG/COG ----

test('revisão F6 (Menor 8): o SOG/COG de um alvo mais velho do que a posição dele 30 s não conta (o AIS passou a "não disponível")', () => {
  // o alvo continua a mandar posições (parado a 0,2 MN à proa), mas o COG/SOG que ficaram na árvore são de há 40 s
  const a = { mmsi: '1', nome: 'X', position: ponto(0.2, 0), sog: 7 * NO, cog: Math.PI, sogEm: T - 40000, cogEm: T - 40000, em: T }
  const r = avaliarAlvos({}, { position: EU.position, sog: 0, cog: 0 }, [a], T, calc)
  assert.deepEqual(r.notificacoes, [], 'com o COG velho dava rota de colisão a 7 nós')
  const novo = avaliarAlvos({}, { position: EU.position, sog: 0, cog: 0 }, [{ ...a, sogEm: T - 5000, cogEm: T - 5000 }], T, calc)
  assert.deepEqual(novo.notificacoes.map(n => n.state), ['alarm'])
})

test('revisão F6 (Menor 8): o nosso SOG/COG sem mudar há mais de 30 s não conta (fica a velocidade do rasto)', () => {
  // o GPS deixou de mandar a velocidade há 40 s (posição a chegar): o SOG de 6 nós a norte que ficou na árvore não conta
  const eu = { position: EU.position, sog: 6 * NO, cog: 0, sogEm: T - 40000, cogEm: T - 40000 }
  const fundeado = { mmsi: '2', nome: 'F', position: ponto(0.3, 0), sog: 0, em: T }
  assert.deepEqual(avaliarAlvos({}, eu, [fundeado], T, calc).notificacoes, [])
  assert.deepEqual(avaliarAlvos({}, { ...eu, sogEm: T - 2000, cogEm: T - 2000 }, [fundeado], T, calc).notificacoes.map(n => n.state), ['alarm'])
})
