'use strict'
// O acompanhamento (desenho 3b-2, "Acompanhamento"): as milhas feitas pela projeção sobre a rota (com
// a janela de passagem, sem saltos), o atraso contra o rasto provável (média de 10 min), os eventos
// de sítio deslizados e os de hora fixa não, a chegada prevista agora (e de noite, reavaliada) e os
// recursos à chegada.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const ac = require('../lib/acompanhamento')
const c = require('../lib/costa')
const { litrosHora } = require('../lib/base')

const MIN = 60000
const H = 3600000
const T0 = Date.parse('2026-09-29T14:00:00Z')
const iso = (t) => new Date(t).toISOString()
// Uma rota reta para norte (30 MN) e um rasto a 5 nós, de 10 em 10 min: 1 h motor, 2 h vela, motor até ao fim.
const A = { lat: 38.7, lon: -9.6 }
const norte = (p, mn) => c.deslocar(p, 0, mn)
const ROTA = [A, norte(A, 10), norte(A, 30)].map(p => ({ lat: p.lat, lon: p.lon }))
const RASTO = Array.from({ length: 37 }, (_, i) => { const p = norte(A, i * 5 / 6); return { lat: p.lat, lon: p.lon, t: iso(T0 + i * 10 * MIN), motor: i < 6 || i >= 18, noite: false } })
const plano = (extra = {}) => ({
  estado: 'a navegar',
  saida: iso(T0),
  tripulacao: 'so',
  alternativa: { pontosRota: ROTA, rasto: RASTO, eventos: [], chegada: { p10: iso(T0 + 6 * H), p50: iso(T0 + 6 * H), p90: iso(T0 + 6.5 * H) }, partida: iso(T0) },
  destino: { nome: 'Norte', cais: ROTA.at(-1) },
  ...extra
})

test('milhas feitas: a projeção da posição sobre a rota (o ponto mais perto) e a distância à rota', () => {
  const rota = ac.prepararRota(plano())
  const x = ac.projetar(rota, c.deslocar(norte(A, 12), 90, 0.3), null, T0 + 3 * H)
  assert.ok(Math.abs(x.s - 12) < 0.01, x.s)
  assert.ok(Math.abs(x.dist - 0.3) < 0.01, x.dist)
  // a tabela do rasto: as milhas do rasto provável ao longo da rota, a cada hora do plano
  assert.equal(rota.tabela.length, RASTO.length)
  assert.ok(Math.abs(rota.tabela[12].s - 10) < 0.01)
  assert.equal(rota.tabela[12].t, T0 + 2 * H)
})

test('janela de passagem: numa rota que volta atrás, a projeção não salta para a perna de volta; sem posição anterior, a rota toda', () => {
  // 5 MN para norte e de volta 0,2 MN ao lado
  const B = norte(A, 5)
  const volta = c.deslocar(B, 90, 0.2)
  const fim = c.deslocar(A, 90, 0.2)
  const rota = ac.prepararRota(plano({ alternativa: { ...plano().alternativa, pontosRota: [A, B, volta, fim] } }))
  // um barco na perna de ida (s = 2), um pouco para o lado da perna de volta
  const p = c.deslocar(norte(A, 2), 90, 0.12)
  const comJanela = ac.projetar(rota, p, { s: 2, t: T0 }, T0 + 2 * MIN)
  assert.ok(Math.abs(comJanela.s - 2) < 0.05, `com a janela: ${comJanela.s}`)
  const semJanela = ac.projetar(rota, p, null, T0 + 2 * MIN)
  assert.ok(semJanela.s > 7, `sem a janela salta para a volta: ${semJanela.s}`)
  // a janela cresce com o tempo (no máximo 15 nós): 1 h depois já chega à perna de volta
  const depois = ac.projetar(rota, c.deslocar(norte(A, 2), 90, 0.19), { s: 2, t: T0 }, T0 + H)
  assert.ok(depois.s > 7, depois.s)
})

test('atraso = agora − a hora a que o rasto provável passava nas mesmas milhas (positivo = atrasado); antes da partida do rasto, conta desde a partida', () => {
  const rota = ac.prepararRota(plano())
  // (a projeção no plano local tem erros de décimas de segundo: perto chega)
  const perto = (a, b, tol = 1000) => assert.ok(Math.abs(a - b) < tol, `${a} − ${b}`)
  perto(ac.horaNoPlano(rota.tabela, 10), T0 + 2 * H)
  assert.equal(ac.horaNoPlano(rota.tabela, 0), T0)
  perto(ac.horaNoPlano(rota.tabela, 10 + 5 / 12), T0 + 2 * H + 5 * MIN)
  assert.equal(ac.horaNoPlano(rota.tabela, 99), T0 + 6 * H)
  perto(ac.atrasoMin(rota.tabela, 10, T0 + 2.5 * H), 30, 0.02)
  perto(ac.atrasoMin(rota.tabela, 10, T0 + 1.5 * H), -30, 0.02)
})

test('média móvel de 10 min: o atraso não oscila (as amostras com mais de 10 min saem)', () => {
  let amostras = []
  for (let m = 0; m <= 20; m++) amostras = ac.juntarAmostra(amostras, { t: T0 + m * MIN, v: m < 15 ? 10 : 40 }, T0 + m * MIN)
  // às 14:20: de 14:10 a 14:20 (11 amostras): 5 a 10 e 6 a 40
  assert.equal(amostras.length, 11)
  assert.ok(Math.abs(ac.media(amostras) - (5 * 10 + 6 * 40) / 11) < 1e-9)
  assert.equal(ac.media([]), null)
})

test('acompanhar: atraso médio, milhas, hora do plano, chegada prevista agora = chegada provável + atraso', () => {
  let estado = ac.novoEstado()
  let r
  // o barco anda 30 min atrás do plano, a 5 nós
  for (let m = 0; m <= 60; m += 1) {
    const agora = T0 + 30 * MIN + m * MIN
    const pos = norte(A, (m / 60) * 5)
    ;({ estado, resultado: r } = ac.acompanhar(estado, { plano: plano(), posicao: pos, agora }))
  }
  assert.ok(Math.abs(r.atrasoMin - 30) < 0.5, r.atrasoMin)
  assert.ok(Math.abs(r.milhas - 5) < 0.05)
  assert.equal(r.chegadaAgora, iso(T0 + 6 * H + Math.round(r.atrasoMin) * MIN))
  assert.equal(r.chegadaPlano, iso(T0 + 6 * H))
  // à espera de sair: sem atraso nem chegada nova
  const e = ac.acompanhar(ac.novoEstado(), { plano: plano({ estado: 'a espera de sair', saida: null }), posicao: A, agora: T0 }).resultado
  assert.equal(e.atrasoMin, null)
  assert.equal(e.chegadaAgora, iso(T0 + 6 * H))
  // sem GPS: o atraso fica o da média que havia, e diz sem GPS
  const s = ac.acompanhar(estado, { plano: plano(), posicao: null, agora: T0 + 91 * MIN }).resultado
  assert.equal(s.semGps, true)
  assert.ok(Math.abs(s.atrasoMin - 30) < 0.5)
})

test('eventos: os de sítio (partida, wp, vela, motor, chegada) deslizam com o atraso; os de hora fixa (noite, tempo, outros) ficam na hora do plano', () => {
  const ev = (t, tipo, texto) => ({ t: iso(t), hora: '', tipo, texto })
  const eventos = [
    ev(T0, 'partida', 'Partida de A (15:00)'),
    ev(T0 + H, 'motor', 'Motor desligado, à vela (vento 12 nós de 020°)'),
    ev(T0 + 2 * H, 'vela', 'Rizar: 1 rizo (vento 17 nós, rajadas 22)'),
    ev(T0 + 2.5 * H, 'wp', 'Cabo Raso: 12,5 MN feitas'),
    ev(T0 + 3 * H, 'noite', 'Pôr do sol (19:24): ecrã em modo noite, luzes de navegação'),
    ev(T0 + 4 * H, 'tempo', 'Chuva e visibilidade 2,5 km: radar ligado'),
    ev(T0 + 5 * H, 'tempo', 'Passagem da frente: o vento cai de 15 para 6 nós e roda para 300°. Fica o mar (1,5 m)'),
    ev(T0 + 6 * H, 'chegada', 'Chegada a Norte (21:00)'),
    ev(T0 + 6 * H, 'info', 'outro')
  ]
  const d = ac.deslizarEventos(eventos, 20)
  assert.deepEqual(d.map(e => [e.tipo, e.sitio, (Date.parse(e.t) - Date.parse(e.tPlano)) / MIN]), [
    ['partida', true, 20], ['motor', true, 20], ['vela', true, 20], ['wp', true, 20],
    ['noite', false, 0], ['tempo', false, 0], ['tempo', false, 0], ['chegada', true, 20], ['info', false, 0]
  ])
  assert.deepEqual(d.map(e => e.id), ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'])
  // sem atraso (antes de sair), como no plano
  assert.ok(ac.deslizarEventos(eventos, null).every(e => e.t === e.tPlano))
  // os textos curtos (para a faixa)
  assert.deepEqual(d.map(e => e.curto), ['partida de A', 'motor desligado', 'rizar', 'Cabo Raso', 'pôr do sol', 'chuva e visibilidade', 'passagem da frente', 'chegada a Norte', 'outro'])
})

test('o próximo evento: o primeiro depois de agora (sem a partida), com a hora deslizada', () => {
  const eventos = [
    { t: iso(T0), tipo: 'partida', texto: 'Partida de A (15:00)' },
    { t: iso(T0 + 2 * H), tipo: 'vela', texto: 'Rizar: 1 rizo (vento 17 nós, rajadas 22)' },
    { t: iso(T0 + 3 * H), tipo: 'noite', texto: 'Pôr do sol (19:24): ecrã em modo noite, luzes de navegação' }
  ]
  const d = ac.deslizarEventos(eventos, 20)
  assert.deepEqual(ac.proximoEvento(d, T0 + 2 * H), { id: 'e1', texto: 'rizar', hora: iso(T0 + 2 * H + 20 * MIN), tipo: 'vela' })
  assert.equal(ac.proximoEvento(d, T0 + 2 * H + 25 * MIN).texto, 'pôr do sol')
  assert.equal(ac.proximoEvento(d, T0 + 4 * H), null)
})

const FUGA = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', '..', 'arlequin-ecra', 'test', 'fixtures', 'resultado-fuga.json.gz'))))

test('chegada de noite reavaliada com a chegada deslizada (Algés → Peniche: 07:22 de noite; +20 min já é de dia, nasce às 07:32)', () => {
  const alt = FUGA.alternativas[0]
  const cais = alt.pontosRota.at(-1)
  assert.equal(alt.chegadaNoite, true)
  assert.equal(ac.chegadaDeNoite(Date.parse(alt.chegada.p50), cais), true)
  assert.equal(ac.chegadaDeNoite(Date.parse(alt.chegada.p50) + 20 * MIN, cais), false)
  assert.equal(ac.chegadaDeNoite(Date.parse('2026-09-30T12:00:00Z'), cais), false)
})

test('recursos: gasóleo à chegada = medido − horas de motor que faltam × a curva da Volvo a 2100 rpm; bateria pelo lib/energia.js no troço que falta; sem leitura, null', () => {
  const p = plano()
  // a meio da 2.ª hora de vela (hora do plano T0 + 2,5 h): faltam 0,5 h de vela e 3 h de motor
  const r = ac.recursos({ plano: p, tPlano: T0 + 2.5 * H, gasoleoL: 50, socPct: 80, energia: { capacidadeAh: 200, consumoDiaA: 4.5, alternadorA: 45 } })
  assert.ok(Math.abs(r.horasMotorFaltam - 3) < 1e-9, r.horasMotorFaltam)
  assert.ok(Math.abs(r.gasoleoChegadaL - (50 - 3 * litrosHora(2100))) < 1e-9)
  // 160 Ah − 0,5 h × 4,5 A + 3 h × (45 − 4,5) A > 200 Ah → 100 %
  assert.equal(r.bateriaChegadaPct, 100)
  // desde o fim da 1.ª hora: 2 h de vela e 3 h de motor, sem alternador nem sol: 5 h × 4,5 A
  const v = ac.recursos({ plano: p, tPlano: T0 + 1 * H, gasoleoL: 50, socPct: 50, energia: { capacidadeAh: 200, consumoDiaA: 4.5, alternadorA: 0 } })
  assert.ok(Math.abs(v.horasMotorFaltam - 3) < 1e-9)
  assert.ok(Math.abs(v.bateriaChegadaPct - (100 - 5 * 4.5) / 2) < 1e-9, v.bateriaChegadaPct)
  // outro rpm, outro consumo
  assert.ok(Math.abs(ac.recursos({ plano: p, tPlano: T0 + 2.5 * H, gasoleoL: 50, socPct: 80, rpm: 2400 }).gasoleoChegadaL - (50 - 3 * 2)) < 1e-9)
  const s = ac.recursos({ plano: p, tPlano: T0 + 2.5 * H, gasoleoL: null, socPct: null })
  assert.equal(s.gasoleoChegadaL, null)
  assert.equal(s.bateriaChegadaPct, null)
  assert.ok(Math.abs(s.horasMotorFaltam - 3) < 1e-9)
})

test('o vento: média de 10 min do medido e do previsto (P50 naquele sítio e hora), o desvio em % e em nós', () => {
  let a = []
  for (let m = 0; m <= 12; m++) a = ac.juntarAmostra(a, { t: T0 + m * MIN, medido: m < 2 ? 30 : 13, previsto: 10 }, T0 + m * MIN)
  const v = ac.desvioVento(a)
  assert.equal(v.medido, 13)
  assert.equal(v.previsto, 10)
  assert.ok(Math.abs(v.desvioPct - 30) < 1e-9)
  assert.ok(Math.abs(v.desvioNos - 3) < 1e-9)
  assert.equal(ac.desvioVento([]), null)
  // amostras sem previsão (null) não contam
  assert.equal(ac.desvioVento([{ t: T0, medido: 10, previsto: null }]), null)
})

test('os eventos reais da 3a (Algés → Peniche: { t, hora, tipo, texto }): o pôr do sol fica, os pontos da rota e a chegada deslizam', () => {
  const d = ac.deslizarEventos(FUGA.alternativas[0].eventos, 15)
  assert.deepEqual(d.map(e => [e.tipo, e.curto, (Date.parse(e.t) - Date.parse(e.tPlano)) / MIN]), [
    ['partida', 'partida de Algés', 15],
    ['wp', 'Largo de Algés', 15],
    ['wp', 'Linha de 5 MN', 15],
    ['noite', 'pôr do sol', 0],
    ['wp', 'Largo de Peniche', 15],
    ['wp', 'Peniche', 15],
    ['chegada', 'chegada a Peniche', 15]
  ])
})

test('o mesmo minuto outra vez (o relógio parado, ou dois ciclos no mesmo minuto) não junta outra amostra à média', () => {
  let estado = ac.novoEstado()
  for (let k = 0; k < 5; k++) estado = ac.acompanhar(estado, { plano: plano(), posicao: norte(A, 1), agora: T0 + 30 * MIN }).estado
  assert.equal(estado.amostras.length, 1)
})

test('M6: o previsto P50 de 0 nós (calma): desvioPct null (nunca Infinity), o desvio em nós fica', () => {
  const v = ac.desvioVento([{ t: T0, medido: 12, previsto: 0 }])
  assert.equal(v.desvioPct, null)
  assert.equal(v.desvioNos, 12)
  assert.equal(v.previsto, 0)
})

// Tarefa 8.5: os lembretes que faltavam, gerados do plano ativo
// Uma rota com 3 pernas: 10 MN para norte, 10 MN para leste (viragem de 90° no "Cabo X") e 10 MN a 050°
// (40° no ponto sem nome: não conta, só > 45°); um ponto dentro do porto à chegada (não conta).
const B = norte(A, 10)
const C = c.deslocar(B, 90, 10)
const D = c.deslocar(C, 50, 10)
const E = c.deslocar(D, 180, 0.1)
const ROTA_V = [{ ...A, perna: null }, { ...B, nome: 'Cabo X', perna: 'linha' }, { ...C, nome: null, perna: 'linha' }, { ...D, nome: null, perna: 'porto' }, { ...E, nome: 'Cais', perna: 'porto' }]
  .map(p => ({ lat: p.lat, lon: p.lon, nome: p.nome ?? null, perna: p.perna }))
// o rasto a 5 nós ao longo da rota (de 10 em 10 min), com o twd e a visibilidade previstos
function rastoV ({ twd = () => 0, vis = () => 20000 } = {}) {
  const linha = c.prepararLinha(ROTA_V)
  const n = Math.floor(linha.total / (5 / 6))
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = T0 + i * 10 * MIN
    const p = c.posicao(linha, i * 5 / 6)
    return { lat: p.lat, lon: p.lon, t: iso(t), motor: false, noite: false, twd: twd(i, t), vis: vis(i, t) }
  })
}
const planoV = (rasto, eventos = []) => plano({ alternativa: { pontosRota: ROTA_V, rasto, eventos, chegada: { p10: iso(T0 + 6 * H), p50: iso(T0 + 6 * H), p90: iso(T0 + 6.5 * H) }, partida: iso(T0) } })

test('Tarefa 8.5: viragem — nos pontos da rota onde o rumo muda mais de 45°, um evento de sítio "virar/cambar no <nome do ponto>" à hora do plano nesse ponto (desliza com o atraso); 40° não, e dentro do porto não', () => {
  const x = ac.lembretesDoPlano(planoV(rastoV()))
  const vir = x.filter(e => e.tipo === 'viragem')
  assert.deepEqual(vir.map(e => e.texto), ['Virar/cambar no Cabo X'])
  // à hora em que o plano passa no Cabo X (10 MN a 5 nós: 2 h)
  assert.ok(Math.abs(Date.parse(vir[0].t) - (T0 + 2 * H)) <= 10 * MIN, vir[0].t)
  // é de sítio: desliza com o atraso, e aparece como o próximo evento
  const r = ac.acompanhar(ac.novoEstado(), { plano: planoV(rastoV()), posicao: A, agora: T0 + 30 * MIN })
  const ev = r.resultado.eventos.find(e => e.tipo === 'viragem')
  assert.equal(ev.sitio, true)
  assert.equal(ev.curto, 'virar/cambar no Cabo X')
})

test('Tarefa 8.5: rotação do vento — onde o twd do rasto roda mais de 45° em 1 h, um evento de hora fixa "rotação do vento de X° para Y°" (à hora em que começa a rodar, até onde para); 45° em 1 h não, 50° em 2 h não', () => {
  // o vento de 350° roda para 050° entre as 3 h e as 3 h 50 (60° em 50 min), passando pelo norte
  const twd = (i) => (i < 18 ? 350 : i <= 23 ? (350 + (i - 18) * 12) % 360 : 50)
  const x = ac.lembretesDoPlano(planoV(rastoV({ twd })))
  const ro = x.filter(e => e.tipo === 'vento')
  assert.equal(ro.length, 1, JSON.stringify(ro))
  assert.equal(ro[0].texto, 'Rotação do vento de 350° para 50°')
  // à hora em que começa a rodar (o último ponto ainda a 350°, o das 3 h)
  assert.equal(ro[0].t, iso(T0 + 3 * H))
  // 45° em 1 h não conta
  const lento = (i) => (i < 18 ? 0 : i <= 24 ? (i - 18) * 7.5 : 45)
  assert.deepEqual(ac.lembretesDoPlano(planoV(rastoV({ twd: lento }))).filter(e => e.tipo === 'vento'), [])
  // 50° mas em 2 h: não
  const devagar = (i) => (i < 12 ? 0 : i <= 24 ? (i - 12) * 50 / 12 : 50)
  assert.deepEqual(ac.lembretesDoPlano(planoV(rastoV({ twd: devagar }))).filter(e => e.tipo === 'vento'), [])
  // sem twd no rasto (um plano antigo): nada
  const sem = rastoV().map(({ twd: _t, vis: _v, ...p }) => p)
  assert.deepEqual(ac.lembretesDoPlano(planoV(sem)).filter(e => e.tipo === 'vento'), [])
})

test('Tarefa 8.5: chuva e visibilidade — com a visibilidade prevista no rasto, o lembrete é com < 5 km (a 1.ª hora de cada episódio) e substitui o da 3a (< 3 km); sem ela, fica o da 3a', () => {
  const vis = (i) => (i >= 12 && i < 15 ? 4200 : i >= 24 && i < 26 ? 2500 : 20000)
  const da3a = { t: iso(T0 + 4 * H), hora: '17:00', tipo: 'tempo', texto: 'Chuva e visibilidade 2,5 km: radar ligado' }
  const x = ac.lembretesDoPlano(planoV(rastoV({ vis }), [da3a]))
  assert.deepEqual(x.filter(e => e.tipo === 'tempo').map(e => [e.t, e.texto]), [
    [iso(T0 + 2 * H), 'Chuva e visibilidade 4,2 km: radar ligado'],
    [iso(T0 + 4 * H), 'Chuva e visibilidade 2,5 km: radar ligado']
  ])
  // nos eventos do acompanhamento: o da 3a sai (está no rasto), ficam os dois do rasto
  const r = ac.acompanhar(ac.novoEstado(), { plano: planoV(rastoV({ vis }), [da3a]), posicao: A, agora: T0 })
  assert.equal(r.resultado.eventos.filter(e => /^Chuva/.test(e.texto)).length, 2)
  // sem a visibilidade no rasto: fica o da 3a
  const sem = rastoV().map(({ vis: _v, ...p }) => p)
  const k = ac.acompanhar(ac.novoEstado(), { plano: planoV(sem, [da3a]), posicao: A, agora: T0 })
  assert.deepEqual(k.resultado.eventos.filter(e => /^Chuva/.test(e.texto)).map(e => e.texto), [da3a.texto])
})
