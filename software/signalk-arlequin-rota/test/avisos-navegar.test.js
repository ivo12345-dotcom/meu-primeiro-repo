'use strict'
// Os avisos a navegar (desenho 3b-2, "Avisos"): cada um no limite e ao lado, como se apagam, o "come e
// bebe" só com "só eu", o apito curto na previsão com mais de 12 h, e o que se publica (só as mudanças).
const test = require('node:test')
const assert = require('node:assert/strict')
const av = require('../lib/avisos-navegar')

const MIN = 60000
const H = 3600000
const T0 = Date.parse('2026-09-29T14:00:00Z') // 15:00 em Lisboa
const iso = (t) => new Date(t).toISOString()
const METODO = ['visual', 'sound']

// a entrada de um minuto, com tudo normal
const base = (extra = {}) => ({
  navegar: true,
  tripulacao: 'acompanhado',
  saida: T0,
  destino: 'Peniche',
  semGps: false,
  atrasoMin: 0,
  vento: { medido: 12, previsto: 12, desvioNos: 0, desvioPct: 0 },
  previsaoIdadeH: 1,
  barometro: [],
  recursos: { gasoleoChegadaL: 80, bateriaChegadaPct: 90 },
  eventos: [],
  chegadaNoite: false,
  ...extra
})
// corre minuto a minuto de m0 a m1 (inclusive) com a entrada de cada minuto; devolve o último
function correr (estado, m0, m1, entrada) {
  let r = { estado, avisos: {} }
  for (let m = m0; m <= m1; m++) r = av.avaliar(r.estado, typeof entrada === 'function' ? entrada(m) : entrada, T0 + m * MIN)
  return r
}
const st = (r, k) => r.avisos[`notifications.rota.${k}`]?.state

test('todos com method visual e sound; nada ativo com tudo normal; e sem o plano "a navegar", tudo normal', () => {
  const r = av.avaliar(av.novoEstado(), base({ atrasoMin: 45 }), T0)
  assert.equal(st(r, 'recalcula'), 'warn')
  for (const v of Object.values(r.avisos)) assert.deepEqual(v.method, METODO)
  const n = av.avaliar(av.novoEstado(), base(), T0)
  assert.ok(Object.values(n.avisos).every(v => v.state === 'normal'), JSON.stringify(n.avisos))
  const fora = av.avaliar(av.novoEstado(), base({ navegar: false, atrasoMin: 90, previsaoIdadeH: 20, recursos: { gasoleoChegadaL: 5, bateriaChegadaPct: 10 } }), T0)
  assert.ok(Object.values(fora.avisos).every(v => v.state === 'normal'))
})

test('recalcula: atraso de 31 min sim, 29 min não (30 não é mais de 30); a mensagem diz o atraso', () => {
  assert.equal(st(av.avaliar(av.novoEstado(), base({ atrasoMin: 29 }), T0), 'recalcula'), 'normal')
  assert.equal(st(av.avaliar(av.novoEstado(), base({ atrasoMin: 30 }), T0), 'recalcula'), 'normal')
  const r = av.avaliar(av.novoEstado(), base({ atrasoMin: 31 }), T0)
  assert.equal(st(r, 'recalcula'), 'warn')
  assert.equal(r.avisos['notifications.rota.recalcula'].message, 'Recalcula a rota: atraso de 31 min sobre o plano')
  assert.equal(r.avisos['notifications.rota.recalcula'].apito, undefined)
})

test('recalcula pelo vento: ±31 % e mais de 4 nós durante 30 min seguidos (29 min não); 29 % ou 4 nós não contam', () => {
  const vento = (medido, previsto) => base({ vento: { medido, previsto, desvioNos: medido - previsto, desvioPct: 100 * (medido - previsto) / previsto } })
  // 31 % e 5,58 nós acima
  assert.equal(st(correr(av.novoEstado(), 0, 29, vento(23.58, 18)), 'recalcula'), 'normal', '29 min')
  const r = correr(av.novoEstado(), 0, 30, vento(23.58, 18))
  assert.equal(st(r, 'recalcula'), 'warn', '30 min')
  assert.equal(r.avisos['notifications.rota.recalcula'].message, 'Recalcula a rota: vento de 24 nós, previsto 18 (+31 %)')
  // abaixo do previsto também (−31 %)
  assert.equal(st(correr(av.novoEstado(), 0, 31, vento(12.42, 18)), 'recalcula'), 'warn')
  // 29 % (5,22 nós): não
  assert.equal(st(correr(av.novoEstado(), 0, 60, vento(23.22, 18)), 'recalcula'), 'normal')
  // 50 % mas só 4 nós: não
  assert.equal(st(correr(av.novoEstado(), 0, 60, vento(12, 8)), 'recalcula'), 'normal')
  // a meio volta ao normal: a contagem recomeça
  const quebra = (m) => (m === 20 ? vento(18, 18) : vento(24, 18))
  assert.equal(st(correr(av.novoEstado(), 0, 50, quebra), 'recalcula'), 'normal')
  assert.equal(st(correr(av.novoEstado(), 0, 51, quebra), 'recalcula'), 'warn')
  // sem previsão (vento null): não se avalia
  assert.equal(st(correr(av.novoEstado(), 0, 60, base({ vento: null })), 'recalcula'), 'normal')
  // os dois motivos na mensagem
  const dois = correr(av.novoEstado(), 0, 30, { ...vento(24, 18), atrasoMin: 40 })
  assert.equal(dois.avisos['notifications.rota.recalcula'].message, 'Recalcula a rota: atraso de 40 min sobre o plano · vento de 24 nós, previsto 18 (+33 %)')
})

test('recalcula apaga-se quando o atraso e o vento voltam ao normal durante 10 min seguidos', () => {
  let r = correr(av.novoEstado(), 0, 0, base({ atrasoMin: 40 }))
  assert.equal(st(r, 'recalcula'), 'warn')
  // os 10 min contam-se como os 30 do vento: da 1.ª à última amostra normal (minutos 1 a 11)
  r = correr(r.estado, 1, 10, base({ atrasoMin: 20 }))
  assert.equal(st(r, 'recalcula'), 'warn', '9 min normal')
  r = correr(r.estado, 11, 11, base({ atrasoMin: 20 }))
  assert.equal(st(r, 'recalcula'), 'normal', '10 min normal')
  // o vento ainda fora do normal (mesmo antes dos 30 min) não deixa apagar
  r = correr(av.novoEstado(), 0, 0, base({ atrasoMin: 40 }))
  r = correr(r.estado, 1, 30, base({ atrasoMin: 20, vento: { medido: 24, previsto: 18, desvioNos: 6, desvioPct: 33 } }))
  assert.equal(st(r, 'recalcula'), 'warn')
})

test('recursos: gasóleo à chegada < 40 L (39 sim, 40 não) ou bateria < 50 % (49 sim, 50 não); sem leitura, nada', () => {
  const rec = (g, b) => av.avaliar(av.novoEstado(), base({ recursos: { gasoleoChegadaL: g, bateriaChegadaPct: b } }), T0)
  assert.equal(st(rec(40, 50), 'recursos'), 'normal')
  const g = rec(39.4, 80)
  assert.equal(st(g, 'recursos'), 'warn')
  assert.equal(g.avisos['notifications.rota.recursos'].message, 'Recursos: gasóleo à chegada ~39 L')
  const b = rec(80, 49)
  assert.equal(b.avisos['notifications.rota.recursos'].message, 'Recursos: bateria à chegada ~49 %')
  assert.equal(rec(34, 45).avisos['notifications.rota.recursos'].message, 'Recursos: gasóleo à chegada ~34 L · bateria à chegada ~45 %')
  assert.equal(st(rec(null, null), 'recursos'), 'normal')
})

test('previsão: 6 h nada, mais de 6 h warn, mais de 12 h alarm com o apito curto e o texto; sem previsão nenhuma, alarm', () => {
  const p = (h) => av.avaliar(av.novoEstado(), base({ previsaoIdadeH: h }), T0).avisos['notifications.rota.previsao']
  assert.equal(p(6).state, 'normal')
  assert.deepEqual(p(6.2), { state: 'warn', method: METODO, message: 'Previsão com 6 h' })
  assert.deepEqual(p(12), { state: 'warn', method: METODO, message: 'Previsão com 12 h' })
  assert.deepEqual(p(12.6), { state: 'alarm', method: METODO, apito: 'curto', message: 'Previsão com 13 h: confia nos instrumentos e no barómetro' })
  assert.deepEqual(p(null), { state: 'alarm', method: METODO, apito: 'curto', message: 'Sem previsão: confia nos instrumentos e no barómetro' })
})

test('barómetro: queda de 3,1 hPa em 3 h sim, 2,9 não; apaga-se só quando a queda fica ≤ 2 hPa; sem pressão, nada', () => {
  // amostras de minuto a minuto: a pressão cai `queda` hPa ao longo de 3 h
  const amostras = (queda, ate = T0) => Array.from({ length: 181 }, (_, i) => ({ t: ate - (180 - i) * MIN, hPa: 1015 - queda * i / 180 }))
  const b = (a) => av.avaliar(av.novoEstado(), base({ barometro: a }), T0)
  assert.equal(av.quedaEm3h(amostras(3.1), T0).toFixed(2), '3.10')
  assert.equal(st(b(amostras(2.9)), 'barometro'), 'normal')
  const r = b(amostras(3.1))
  assert.equal(st(r, 'barometro'), 'warn')
  assert.equal(r.avisos['notifications.rota.barometro'].message, 'Barómetro: caiu 3,1 hPa em 3 h — o tempo pode piorar antes do previsto')
  // ativo: com 2,5 hPa continua; com 2 apaga-se
  let s = av.avaliar(r.estado, base({ barometro: amostras(2.5, T0 + MIN) }), T0 + MIN)
  assert.equal(st(s, 'barometro'), 'warn')
  s = av.avaliar(s.estado, base({ barometro: amostras(2, T0 + 2 * MIN) }), T0 + 2 * MIN)
  assert.equal(st(s, 'barometro'), 'normal')
  // as amostras com mais de 3 h não contam
  assert.equal(av.quedaEm3h([{ t: T0 - 4 * H, hPa: 1020 }, { t: T0 - 2 * H, hPa: 1015 }, { t: T0, hPa: 1014.5 }], T0), 0.5)
  assert.equal(av.quedaEm3h([], T0), null)
  assert.equal(st(b([]), 'barometro'), 'normal')
  // juntarPressao guarda 3 h (e um pouco mais)
  let lista = []
  for (let m = 0; m <= 300; m++) lista = av.juntarPressao(lista, { t: T0 + m * MIN, hPa: 1010 }, T0 + m * MIN)
  assert.ok(lista.length <= 190 && lista.length >= 181, lista.length)
})

const ev = (id, t, tipo, texto, sitio, curto) => ({ id, t: iso(t), tPlano: iso(t), tipo, texto, sitio, curto })

test('lembretes: 30 min antes de rizar, do pôr do sol, da chuva, da frente e da chegada de noite (alert, apito curto); apagam-se à hora do evento; os pontos da rota e o motor não', () => {
  const eventos = [
    ev('e1', T0 + H, 'vela', 'Rizar: 1 rizo (vento 17 nós, rajadas 22)', true, 'rizar'),
    ev('e2', T0 + H, 'wp', 'Cabo Raso: 12,5 MN feitas', true, 'Cabo Raso'),
    ev('e3', T0 + H, 'motor', 'Motor ligado (aproximação)', true, 'motor ligado'),
    ev('e4', T0 + 2 * H, 'noite', 'Pôr do sol (17:00): ecrã em modo noite, luzes de navegação', false, 'pôr do sol'),
    ev('e5', T0 + 3 * H, 'tempo', 'Chuva e visibilidade 2,5 km: radar ligado', false, 'chuva e visibilidade'),
    ev('e6', T0 + 4 * H, 'tempo', 'Passagem da frente: o vento cai de 15 para 6 nós e roda para 300°. Fica o mar (1,5 m)', false, 'passagem da frente'),
    ev('e7', T0 + 5 * H, 'chegada', 'Chegada a Peniche (19:00)', true, 'chegada a Peniche'),
    ev('e8', T0 + 6 * H, 'noite', 'Nascer do sol (07:30): ecrã em modo dia', false, 'nascer do sol')
  ]
  const em = (t, extra = {}) => av.avaliar(av.novoEstado(), base({ eventos, chegadaNoite: true, ...extra }), t).avisos
  const L = (id) => `notifications.rota.lembrete.${id}`
  assert.equal(em(T0 + 29 * MIN)[L('e1')]?.state ?? 'normal', 'normal', '31 min antes')
  const a = em(T0 + 30 * MIN)
  assert.deepEqual(a[L('e1')], { state: 'alert', method: METODO, message: 'Às 16:00: Rizar: 1 rizo (vento 17 nós, rajadas 22)' })
  assert.equal(a[L('e2')], undefined)
  assert.equal(a[L('e3')], undefined)
  assert.equal(em(T0 + 59 * MIN)[L('e1')].state, 'alert')
  assert.equal(em(T0 + 60 * MIN)[L('e1')]?.state ?? 'normal', 'normal', 'à hora do evento')
  assert.equal(em(T0 + 90 * MIN)[L('e4')].message, 'Às 17:00: pôr do sol — luzes, arnês, come antes de escurecer')
  assert.equal(em(T0 + 150 * MIN)[L('e5')].message, 'Às 18:00: chuva e pouca visibilidade — radar ligado e luzes')
  assert.equal(em(T0 + 210 * MIN)[L('e6')].message, 'Às 19:00: Passagem da frente: o vento cai de 15 para 6 nós e roda para 300°. Fica o mar (1,5 m)')
  assert.equal(em(T0 + 270 * MIN)[L('e7')].message, 'Às 20:00: chegada de noite a Peniche')
  // a chegada de dia não lembra; o nascer do sol também não
  assert.equal(em(T0 + 270 * MIN, { chegadaNoite: false })[L('e7')], undefined)
  assert.equal(em(T0 + 330 * MIN)[L('e8')], undefined)
  // sem GPS: os de sítio (rizar, chegada) param; os de hora fixa (pôr do sol) continuam
  assert.equal(em(T0 + 30 * MIN, { semGps: true })[L('e1')], undefined)
  assert.equal(em(T0 + 90 * MIN, { semGps: true })[L('e4')].state, 'alert')
})

test('come e bebe: só com "só eu", de 3 em 3 h desde a saída real, durante 15 min', () => {
  const c = (m, trip = 'so') => av.avaliar(av.novoEstado(), base({ tripulacao: trip, saida: T0 }), T0 + m * MIN).avisos['notifications.rota.comer']
  assert.equal(c(179).state, 'normal')
  assert.deepEqual(c(180), { state: 'alert', method: METODO, message: 'Come e bebe: 3 h ao leme' })
  assert.equal(c(194).state, 'alert')
  assert.equal(c(195).state, 'normal')
  assert.equal(c(360).state, 'alert')
  assert.equal(c(0).state, 'normal')
  assert.equal(c(180, 'acompanhado').state, 'normal')
})

test('publicar: só as mudanças (estado ou motivo), os que desaparecem voltam a normal, e o estado inicial lê-se da árvore do SignalK', () => {
  const a1 = { 'notifications.rota.recalcula': { state: 'warn', method: METODO, message: 'Recalcula a rota: atraso de 31 min sobre o plano', chave: 'atraso' }, 'notifications.rota.lembrete.e1': { state: 'alert', method: METODO, message: 'x' }, 'notifications.rota.barometro': { state: 'normal', method: METODO, message: '' } }
  let r = av.publicar({}, a1)
  assert.deepEqual(r.deltas.map(d => [d.path, d.value.state]), [['notifications.rota.recalcula', 'warn'], ['notifications.rota.lembrete.e1', 'alert'], ['notifications.rota.barometro', 'normal']])
  assert.equal(r.deltas[0].value.chave, undefined, 'a chave não vai para o SignalK')
  // o mesmo outra vez (a mensagem com outro número): nada
  r = av.publicar(r.publicados, { ...a1, 'notifications.rota.recalcula': { ...a1['notifications.rota.recalcula'], message: 'Recalcula a rota: atraso de 35 min sobre o plano' } })
  assert.deepEqual(r.deltas, [])
  // o lembrete desaparece: normal; outro motivo no recalcula: publica
  r = av.publicar(r.publicados, { 'notifications.rota.recalcula': { state: 'warn', method: METODO, message: 'y', chave: 'atraso vento' } })
  assert.deepEqual(r.deltas.map(d => [d.path, d.value.state]), [['notifications.rota.recalcula', 'warn'], ['notifications.rota.lembrete.e1', 'normal']])
  // da árvore do SignalK: { recalcula: { value: { state } }, lembrete: { e3: { value } } }
  const arvore = { recalcula: { value: { state: 'warn', message: 'z' } }, lembrete: { e3: { value: { state: 'alert' } } }, barometro: { value: { state: 'normal' } } }
  assert.deepEqual(av.publicadosDaArvore(arvore), { 'notifications.rota.recalcula': { state: 'warn', chave: null }, 'notifications.rota.lembrete.e3': { state: 'alert', chave: null }, 'notifications.rota.barometro': { state: 'normal', chave: null } })
  assert.deepEqual(av.publicadosDaArvore(undefined), {})
  // o que já estava ativo antes do reinício não se publica outra vez (não apita a dobrar)
  const k = av.publicar(av.publicadosDaArvore(arvore), { 'notifications.rota.recalcula': { state: 'warn', method: METODO, message: 'z', chave: 'atraso' } })
  assert.deepEqual(k.deltas.map(d => [d.path, d.value.state]), [['notifications.rota.lembrete.e3', 'normal']])
})

test('a mensagem nunca mostra o limite quando já o passou (visto ao vivo: "atraso de 30 min", "~40 L", "3,0 hPa"): arredonda para o lado do aviso', () => {
  const m = (entrada) => av.avaliar(av.novoEstado(), base(entrada), T0).avisos
  assert.equal(m({ atrasoMin: 30.4 })['notifications.rota.recalcula'].message, 'Recalcula a rota: atraso de 31 min sobre o plano')
  assert.equal(m({ recursos: { gasoleoChegadaL: 39.6, bateriaChegadaPct: 49.7 } })['notifications.rota.recursos'].message, 'Recursos: gasóleo à chegada ~39 L · bateria à chegada ~49 %')
  const amostras = [{ t: T0 - 3 * H, hPa: 1015 }, { t: T0, hPa: 1011.96 }]
  assert.equal(m({ barometro: amostras })['notifications.rota.barometro'].message, 'Barómetro: caiu 3,1 hPa em 3 h — o tempo pode piorar antes do previsto')
})

test('M6: previsto P50 de 0 nós (calma): só a regra absoluta dos 4 nós (sem %), nunca Infinity; a mensagem sem a percentagem', () => {
  const calma = (medido) => base({ vento: { medido, previsto: 0, desvioNos: medido, desvioPct: null } })
  assert.equal(st(correr(av.novoEstado(), 0, 29, calma(12)), 'recalcula'), 'normal', '29 min')
  const r = correr(av.novoEstado(), 0, 30, calma(12))
  assert.equal(st(r, 'recalcula'), 'warn')
  assert.equal(r.avisos['notifications.rota.recalcula'].message, 'Recalcula a rota: vento de 12 nós, previsto 0')
  // 4 nós com a previsão de calma: não
  assert.equal(st(correr(av.novoEstado(), 0, 60, calma(4)), 'recalcula'), 'normal')
})

test('M2: os "30 min seguidos" do vento e os "10 min normal" só contam amostras a ≤ 2 min umas das outras (um salto do relógio recomeça)', () => {
  const fora = base({ vento: { medido: 24, previsto: 18, desvioNos: 6, desvioPct: 33 } })
  // uma amostra e outra 30 min depois (o relógio saltou): não
  let r = av.avaliar(av.novoEstado(), fora, T0)
  r = av.avaliar(r.estado, fora, T0 + 30 * MIN)
  assert.equal(st(r, 'recalcula'), 'normal')
  // de 2 em 2 min conta
  r = { estado: av.novoEstado() }
  for (let m = 0; m <= 30; m += 2) r = av.avaliar(r.estado, fora, T0 + m * MIN)
  assert.equal(st(r, 'recalcula'), 'warn')
  // o normal: uma amostra e outra 10 min depois não apagam
  r = av.avaliar(r.estado, base(), T0 + 31 * MIN)
  r = av.avaliar(r.estado, base(), T0 + 41 * MIN)
  assert.equal(st(r, 'recalcula'), 'warn')
  r = correr(r.estado, 42, 50, base())
  assert.equal(st(r, 'recalcula'), 'warn', 'de 41 a 50: 9 min')
  r = correr(r.estado, 51, 51, base())
  assert.equal(st(r, 'recalcula'), 'normal')
  // para trás também recomeça
  r = { estado: av.novoEstado() }
  r = correr(r.estado, 0, 20, fora)
  r = av.avaliar(r.estado, fora, T0 + 5 * MIN)
  r = correr(r.estado, 6, 34, fora)
  assert.equal(st(r, 'recalcula'), 'normal', 'de 5 a 34: 29 min')
  assert.equal(st(correr(r.estado, 35, 35, fora), 'recalcula'), 'warn')
})

test('Tarefa 8.5: os lembretes novos, 30 min antes: "Às HH:MM: virar/cambar no Cabo X" (de sítio: para sem GPS) e "Às HH:MM: rotação do vento de 350° para 50°"', () => {
  const eventos = [
    ev('e9', T0 + H, 'viragem', 'Virar/cambar no Cabo X', true, 'virar/cambar no Cabo X'),
    ev('e10', T0 + 2 * H, 'vento', 'Rotação do vento de 350° para 50°', false, 'rotação do vento de 350° para 50°')
  ]
  const L = (id) => `notifications.rota.lembrete.${id}`
  const a = av.avaliar(av.novoEstado(), base({ eventos }), T0 + 30 * MIN).avisos
  assert.deepEqual(a[L('e9')], { state: 'alert', method: METODO, message: 'Às 16:00: virar/cambar no Cabo X' })
  const b = av.avaliar(av.novoEstado(), base({ eventos }), T0 + 90 * MIN).avisos
  assert.deepEqual(b[L('e10')], { state: 'alert', method: METODO, message: 'Às 17:00: rotação do vento de 350° para 50°' })
  // sem GPS, o de sítio para
  assert.equal(av.avaliar(av.novoEstado(), base({ eventos, semGps: true }), T0 + 30 * MIN).avisos[L('e9')], undefined)
})

test('revisão final I2: notifications.rota.alarmeTerra (alert, apito curto, só no ecrã) 60 min antes da hora de alarme que terra tem, com o plano aberto: "Os contactos em terra ligam ao MRCC às HH:MM: avisa-os ou Terminar"', () => {
  const alarme = T0 + 3 * H // 18:00 em Lisboa
  assert.equal(av.alarmeTerra({ aberto: true, alarme }, alarme - 61 * MIN).state, 'normal')
  const a = av.alarmeTerra({ aberto: true, alarme }, alarme - 59 * MIN)
  assert.deepEqual(a, { state: 'alert', method: METODO, message: 'Os contactos em terra ligam ao MRCC às 18:00: avisa-os ou Terminar', apito: 'curto', chave: iso(alarme) })
  // passada a hora fica (terra pode já estar a ligar)
  assert.equal(av.alarmeTerra({ aberto: true, alarme }, alarme + 30 * MIN).state, 'alert')
  // sem plano aberto ou sem hora de alarme em terra: normal
  assert.equal(av.alarmeTerra({ aberto: false, alarme }, alarme - 10 * MIN).state, 'normal')
  assert.equal(av.alarmeTerra({ aberto: true, alarme: NaN }, alarme - 10 * MIN).state, 'normal')
  assert.equal(av.CAMINHO_ALARME_TERRA, 'notifications.rota.alarmeTerra')
})

test('auditoria K-12: com o plano fechado e o "cheguei bem"/"viagem terminada" por entregar (fecho), o aviso de terra sai 60 min antes e fica depois da hora de alarme, com o texto do fecho', () => {
  const alarme = T0 + 3 * H // 18:00 em Lisboa
  assert.equal(av.alarmeTerra({ aberto: false, alarme, fecho: 'chegada' }, alarme - 61 * MIN).state, 'normal')
  assert.deepEqual(av.alarmeTerra({ aberto: false, alarme, fecho: 'chegada' }, alarme - 59 * MIN), { state: 'alert', method: METODO, message: 'O «cheguei bem» ainda não chegou a terra: os contactos ligam ao MRCC às 18:00 — liga-lhes', apito: 'curto', chave: `${iso(alarme)} chegada` })
  assert.equal(av.alarmeTerra({ aberto: false, alarme, fecho: 'terminado' }, alarme + 2 * H).message, 'A «viagem terminada» ainda não chegou a terra: os contactos ligam ao MRCC às 18:00 — liga-lhes')
  assert.equal(av.alarmeTerra({ aberto: false, alarme, fecho: null }, alarme).state, 'normal')
})

test('auditoria I-02 (decisão n.º 15): terra tem um plano que não é o do plano ativo — sem plano ativo "ativa-o ou avisa-os", com outro plano ativo "o plano de outra alternativa"; 60 min antes, e apaga-se à hora de alarme (terra já não espera)', () => {
  const alarme = T0 + 3 * H // 18:00 em Lisboa
  assert.equal(av.alarmeTerra({ semPlano: 'nenhum', alarme }, alarme - 61 * MIN).state, 'normal')
  assert.deepEqual(av.alarmeTerra({ semPlano: 'nenhum', alarme }, alarme - 59 * MIN), { state: 'alert', method: METODO, message: 'Os contactos em terra têm um plano com alarme às 18:00 e não há plano ativo: ativa-o ou avisa-os', apito: 'curto', chave: `${iso(alarme)} sem-plano` })
  assert.equal(av.alarmeTerra({ semPlano: 'outro', alarme }, alarme - 10 * MIN).message, 'Os contactos em terra têm o plano de outra alternativa, com alarme às 18:00: avisa-os')
  assert.equal(av.alarmeTerra({ semPlano: 'nenhum', alarme }, alarme).state, 'normal')
})
