'use strict'
// A viagem acelerada do dev (desenho 3b-2, validação ao vivo): o barco segue o rasto provável do plano,
// com um atraso forçado a meio (parado), uma queda do barómetro e o gasóleo a descer mais do que o
// plano conta. Só as contas (sem SignalK).
const test = require('node:test')
const assert = require('node:assert/strict')
const { posicaoNoRasto, criarCenario, verificarDev, limpar, FALSOS, ventoAparente, instrumentosNoRasto, alvoAis, deltaAlvo } = require('../viagem-acelerada')

const MIN = 60000
const H = 3600000
const T0 = Date.parse('2026-10-01T16:00:00Z')
const iso = (t) => new Date(t).toISOString()
// 1 h para norte a 6 nós (0,1° de latitude), de 10 em 10 min
const RASTO = Array.from({ length: 7 }, (_, i) => ({ lat: 38.7 + i * 0.1 / 6, lon: -9.5, t: iso(T0 + i * 10 * MIN), motor: true, noite: false }))

test('posicaoNoRasto: interpolada na hora do plano, com o SOG e o rumo do troço; antes do início no 1.º ponto e depois do fim no último, parado', () => {
  const p = posicaoNoRasto(RASTO, T0 + 15 * MIN)
  assert.ok(Math.abs(p.lat - (38.7 + 0.025)) < 1e-9)
  assert.equal(p.lon, -9.5)
  assert.ok(Math.abs(p.sogNos - 6) < 0.05, p.sogNos)
  assert.ok(Math.abs(p.cog) < 1e-6)
  assert.deepEqual(posicaoNoRasto(RASTO, T0 - H), { lat: 38.7, lon: -9.5, sogNos: 0, cog: 0, fim: false })
  const f = posicaoNoRasto(RASTO, T0 + 2 * H)
  assert.equal(f.lat, RASTO.at(-1).lat)
  assert.equal(f.sogNos, 0)
  assert.equal(f.fim, true)
})

test('o cenário: parado durante o atraso forçado (a hora do plano não anda), a pressão cai e o gasóleo desce só a andar', () => {
  const c = criarCenario({ t0: T0, duracaoMs: 10 * H, atrasoEm: 0.3, atrasoMin: 60, baroEm: 0.5, baroQueda: 4, baroHoras: 2, pressao: 1015, gasoleo: 70, consumo: 2.5 })
  // antes do atraso (3 h): a hora do plano é a simulada
  let e = c(T0 + 2 * H)
  assert.equal(e.tPlano, T0 + 2 * H)
  assert.equal(e.parado, false)
  assert.equal(e.pressaoHpa, 1015)
  assert.ok(Math.abs(e.gasoleoL - (70 - 2 * 2.5)) < 1e-9)
  // no atraso: parado, a hora do plano fica nas 3 h
  e = c(T0 + 3.5 * H)
  assert.equal(e.parado, true)
  assert.equal(e.tPlano, T0 + 3 * H)
  assert.ok(Math.abs(e.gasoleoL - (70 - 3 * 2.5)) < 1e-9, 'parado não gasta')
  // depois: 60 min atrás do plano
  e = c(T0 + 5 * H)
  assert.equal(e.tPlano, T0 + 4 * H)
  // o barómetro: começa a cair às 5 h, 4 hPa em 2 h
  assert.equal(c(T0 + 6 * H).pressaoHpa, 1013)
  assert.equal(c(T0 + 8 * H).pressaoHpa, 1011)
  assert.equal(c(T0 + 9 * H).pressaoHpa, 1011)
})

// as configurações como o SignalK as devolve (GET /plugins/<id>/config)
const ROTA_DEV = { enabled: true, configuration: { modoTeste: true, horaSimulada: true, cicloSegundos: 1 } }
const PORTO_DEV = { enabled: true, configuration: { telegramToken: 'DEV-TELEGRAM-FALSO', telegramBase: 'http://localhost:8081', chatIds: ['111'], contactosPlano: [{ nome: 'Teste em terra', chatId: '222' }] } }

test('10: só corre num SignalK de dev: a rota com modoTeste e horaSimulada, e o porto ligado ao Telegram falso só com os contactos falsos', () => {
  assert.deepEqual(verificarDev({ rota: ROTA_DEV, porto: PORTO_DEV }), [])
  assert.ok(FALSOS.has('222'))
  const motivos = (rota, porto) => verificarDev({ rota, porto }).join(' | ')
  // sem a configuração (a segurança do SignalK ligada: 401) ou sem o modo de teste: recusa
  assert.match(motivos(null, PORTO_DEV), /não consegui ler a configuração do plugin da rota/)
  assert.match(motivos({ configuration: { horaSimulada: true, cicloSegundos: 1 } }, PORTO_DEV), /modoTeste/)
  assert.match(motivos({ configuration: { modoTeste: true, cicloSegundos: 1 } }, PORTO_DEV), /horaSimulada/)
  // o porto com o Telegram verdadeiro, ou um contacto verdadeiro: recusa
  assert.match(motivos(ROTA_DEV, { configuration: { ...PORTO_DEV.configuration, telegramBase: 'https://api.telegram.org' } }), /Telegram falso/)
  assert.match(motivos(ROTA_DEV, { configuration: { ...PORTO_DEV.configuration, contactosPlano: [{ nome: 'Mãe', chatId: '123456789' }] } }), /contactos do plano verdadeiros: Mãe/)
  assert.match(motivos(ROTA_DEV, null), /não consegui ler a configuração do plugin porto/)
  // o porto desligado (sem Telegram nenhum) serve
  assert.deepEqual(verificarDev({ rota: ROTA_DEV, porto: { enabled: false, configuration: { telegramBase: 'https://api.telegram.org', contactosPlano: [{ nome: 'Mãe', chatId: '1' }] } } }), [])
})

// Auditoria M-72 (B-M10): com o ciclo de 60 s e --fator 60 as amostras ficam a 60 min umas das outras e as
// janelas "seguidos" nunca contam: a viagem precisa do cicloSegundos 1 e tem de o confirmar.
test('M-72: a viagem acelerada recusa sem o cicloSegundos 1 (o testar-rota não precisa dele)', () => {
  const { verificarDev: guarda } = require('../guarda-dev')
  const semCiclo = { configuration: { modoTeste: true, horaSimulada: true } }
  assert.match(verificarDev({ rota: semCiclo, porto: PORTO_DEV }).join(' | '), /cicloSegundos/)
  assert.match(verificarDev({ rota: { configuration: { ...semCiclo.configuration, cicloSegundos: 60 } }, porto: PORTO_DEV }).join(' | '), /cicloSegundos/)
  assert.deepEqual(verificarDev({ rota: ROTA_DEV, porto: PORTO_DEV }), [])
  assert.deepEqual(guarda({ rota: { configuration: { modoTeste: true } }, porto: PORTO_DEV }, { viagem: false }), [])
})

// Auditoria I-35 (contrato C9): o que a viagem injeta (posição, hora, SoC, gasóleo falsos) tem de ficar
// "simulado" na caixa negra (o simulado nunca treina a AI).
test('I-35: os deltas da viagem levam a marca de fonte do simulador e a caixa negra marca-os simulados', () => {
  const { deltaViagem } = require('../viagem-acelerada')
  const est = require('../../signalk-arlequin-caixanegra/lib/estado')
  const d = deltaViagem(T0, [{ path: 'navigation.position', value: { latitude: 38.69, longitude: -9.23 } }])
  assert.equal(d.context, 'vessels.self')
  assert.equal(d.updates[0].$source, 'arlequin-simulador.viagem-acelerada')
  assert.equal(d.updates[0].timestamp, iso(T0))
  const e = est.novoEstado()
  est.aplicar(e, d, 'vessels.urn:mrn:signalk:uuid:arlequin', 1000)
  assert.equal(est.simuladoRecente(e, 1000), true)
})

test('10: limpar (Ctrl-C ou erro a meio): termina o plano, desativa a rota e repõe a hora (o navigation.datetime de agora)', async () => {
  const pedidos = []
  const enviados = []
  const json = async (url, o = {}) => { pedidos.push(`${o.method || 'GET'} ${url}`); return { status: 200, corpo: {} } }
  await limpar({ base: 'http://localhost:3000', json, enviar: (t, valores) => { enviados.push(valores); return true }, agora: () => T0, log: () => {} })
  assert.deepEqual(pedidos, [
    'POST http://localhost:3000/plugins/signalk-arlequin-rota/plano-ativo/terminar',
    'DELETE http://localhost:3000/signalk/v2/api/vessels/self/navigation/course'
  ])
  assert.deepEqual(enviados, [[{ path: 'navigation.datetime', value: iso(T0) }]])
  // um passo que falha não impede os outros
  const p2 = []
  await limpar({ base: 'http://localhost:3000', json: async (url, o = {}) => { p2.push(o.method); throw new Error('sem rede') }, enviar: () => false, agora: () => T0, log: () => {} })
  assert.deepEqual(p2, ['POST', 'DELETE'])
})

test('05/10 (demonstração ao vivo): o vento aparente a partir do real e do andamento — 10 nós de norte com o barco a 5 nós para norte dá 15 nós de proa; para sul, 5 nós de popa; de leste com o barco para norte, vem de estibordo à frente do través', () => {
  let a = ventoAparente({ twdGraus: 0, twsNos: 10, sogNos: 5, cogRad: 0 })
  assert.ok(Math.abs(a.nos - 15) < 1e-9 && Math.abs(a.anguloRad) < 1e-9, JSON.stringify(a))
  a = ventoAparente({ twdGraus: 0, twsNos: 10, sogNos: 5, cogRad: Math.PI })
  assert.ok(Math.abs(a.nos - 5) < 1e-9 && Math.abs(Math.abs(a.anguloRad) - Math.PI) < 1e-9, JSON.stringify(a))
  a = ventoAparente({ twdGraus: 90, twsNos: 10, sogNos: 5, cogRad: 0 })
  assert.ok(a.anguloRad > 0 && a.anguloRad < Math.PI / 2, JSON.stringify(a))
  assert.ok(Math.abs(a.nos - Math.hypot(10, 5)) < 1e-9)
})

test('05/10: os instrumentos ao longo do rasto — a motor as rotações e a ligação "a-receber", à vela 0 rpm e o adorno para sotavento; de noite o solar a 0; parado, SOG 0 e motor desligado', () => {
  const NO = 1852 / 3600
  const rasto = [{ lat: 38.7, lon: -9.5, t: iso(T0), motor: true, noite: false, tws: 12, twd: 20 }, { lat: 38.8, lon: -9.5, t: iso(T0 + H), motor: false, noite: true, tws: 14, twd: 30 }]
  const v = (lista, path) => lista.find(x => x.path === path)?.value
  const m = instrumentosNoRasto({ rasto, tPlano: T0 + 10 * MIN, pos: { sogNos: 5, cog: 0 }, parado: false })
  assert.equal(v(m, 'propulsion.main.ligacao'), 'a-receber')
  assert.ok(Math.abs(v(m, 'propulsion.main.revolutions') - 35) < 1e-9)
  assert.ok(v(m, 'electrical.solar.mppt1.panelPower') > 0)
  assert.ok(Math.abs(v(m, 'environment.wind.speedTrue') - 12 * NO) < 1e-9)
  assert.equal(v(m, 'navigation.attitude').roll, 0, 'a motor não adorna')
  const s = instrumentosNoRasto({ rasto, tPlano: T0 + 90 * MIN, pos: { sogNos: 5, cog: 0 }, parado: false })
  assert.equal(v(s, 'propulsion.main.revolutions'), 0)
  assert.equal(v(s, 'electrical.solar.mppt1.panelPower'), 0)
  assert.ok(v(s, 'navigation.attitude').roll < 0, 'vento de estibordo (30° com a proa a 0): adorna para bombordo')
  const p = instrumentosNoRasto({ rasto, tPlano: T0 + 10 * MIN, pos: { sogNos: 5, cog: 0 }, parado: true })
  assert.equal(v(p, 'navigation.speedThroughWater'), 0)
  assert.equal(v(p, 'propulsion.main.revolutions'), 0, 'parado: o motor não trabalha')
  for (const x of m) assert.ok(x.path && x.value !== undefined, JSON.stringify(x))
})

test('05/10: o pesqueiro AIS existe de 1 h antes a 1 h depois do meio da viagem e, no meio, está 0,25 MN à nossa frente; o delta leva a fonte simulada e o contexto do navio', () => {
  const dur = 10 * H
  assert.equal(alvoAis({ rasto: RASTO, tPlano: T0 + 2 * H, t0: T0, duracaoMs: dur }), null)
  const a = alvoAis({ rasto: RASTO, tPlano: T0 + 5 * H, t0: T0, duracaoMs: dur })
  assert.ok(a && a.mmsi && a.nome && a.sog > 0)
  const nos = posicaoNoRasto(RASTO, T0 + 5 * H)
  const dLat = (a.position.lat - nos.lat) * 111320
  assert.ok(Math.abs(dLat - 0.25 * 1852) < 5, `${dLat} m à frente (rumo norte)`)
  assert.ok(Math.abs(a.position.lon - nos.lon) < 1e-6)
  const d = deltaAlvo(T0, a)
  assert.equal(d.context, 'vessels.urn:mrn:imo:mmsi:263000002')
  assert.match(d.updates[0].$source, /^arlequin-simulador\./)
  assert.ok(d.updates[0].values.some(x => x.path === 'navigation.position'))
})
