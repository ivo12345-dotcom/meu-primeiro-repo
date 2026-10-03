// A política do som dos alarmes, ciclo a ciclo (lib/alarmes.js, decidirSom), com o relógio injetado:
//   - Adenda 2 do dono (02/10): o fumo reconhecido pára o apito contínuo, o alarme fica vermelho no ecrã e repete
//     um bip curto de 2 em 2 minutos enquanto houver fumo; se o fumo passar e voltar, apita contínuo outra vez;
//   - o apito curto continua a tocar uma só vez por alarme (caminho + hora).
// As notificações têm a forma com que chegam ao ecrã: o valor do plugin mais o id e o status do servidor
// (signalk-server api/notifications/alarm.js), e a hora da delta.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lerFonte, funcao } from './ajuda-fonte.mjs'
import { deveTocar, decidirSom, novaMemoriaSom, emergenciaReconhecida, LEMBRETE_RECONHECIDA_MS, alarmeDaBarra, chipAlarme } from '../public/lib/alarmes.js'

const SOM = ['visual', 'sound']
const st = (x = {}) => ({ silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true, canClear: false, ...x })
const ID = '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e'
// o fumo como o porto o publica (regras.js: emergency, apito contínuo) e como o SignalK o deixa depois de reconhecido
// (alarm.js, alignAlarmMethod: a emergência reconhecida fica só visual)
const fumo = (extra = {}) => ({ caminho: 'notifications.arlequin.porto.fumo', id: ID, state: 'emergency', method: SOM, apito: 'continuo', message: 'FUMO a bordo!', status: st(), timestamp: '2026-10-03T10:00:00.000Z', ...extra })
const fumoReconhecido = (extra = {}) => fumo({ method: ['visual'], status: st({ acknowledged: true, acknowledgedAt: '2026-10-03T10:00:20.000Z' }), ...extra })
const fumoNormal = { caminho: 'notifications.arlequin.porto.fumo', state: 'normal', method: [], message: 'Normal', timestamp: '2026-10-03T10:05:00.000Z' }
const ais = (extra = {}) => ({ caminho: 'notifications.arlequin.ais.263000001', id: '1c7f4d3f-2e3b-4d66-8e2f-7b2a3c4d5e6f', state: 'alarm', method: SOM, apito: 'continuo', message: 'NORDIC STAR em rota de colisão · CPA 0,1 MN', status: st(), timestamp: '2026-10-03T10:01:00.000Z', ...extra })
const lembrete = (extra = {}) => ({ caminho: 'notifications.rota.lembrete.e3', id: '2d8f5e40-3f4c-4e77-9f30-8c3b4d5e6f70', state: 'alert', method: SOM, apito: 'curto', message: 'Às 15:57: rizar', status: st(), timestamp: '2026-10-03T10:02:00.000Z', ...extra })

const T0 = Date.parse('2026-10-03T10:00:00.000Z')
const S = 1000

// Corre os ciclos de `de` a `ate` segundos (de 1 em 1 s, como o setInterval do app.js) com o que a função dá em
// cada segundo; devolve os segundos em que tocou cada coisa.
function correr (memoria, de, ate, notificacoes) {
  const continuo = []
  const lembretes = []
  const curtos = []
  for (let s = de; s <= ate; s++) {
    const l = typeof notificacoes === 'function' ? notificacoes(s) : notificacoes
    const r = decidirSom(l, memoria, T0 + s * S)
    if (r.continuo) continuo.push(s)
    if (r.lembretes.length) lembretes.push(s)
    for (const c of r.curtos) curtos.push([s, c])
  }
  return { continuo, lembretes, curtos }
}

test('Adenda 2 (fumo): sem reconhecer, o fumo apita contínuo a cada ciclo; os lembretes só existem depois de reconhecido', () => {
  const m = novaMemoriaSom()
  const r = correr(m, 0, 30, [fumo()])
  assert.equal(r.continuo.length, 31, 'contínuo em todos os ciclos')
  assert.deepEqual(r.lembretes, [])
  assert.equal(deveTocar(fumo()), 'continuo')
})

test('Adenda 2 (fumo): reconhecido, o contínuo pára e fica um bip curto de 2 em 2 minutos enquanto houver fumo (o 1.º, 2 min depois de o ver reconhecido)', () => {
  assert.equal(LEMBRETE_RECONHECIDA_MS, 2 * 60 * 1000)
  const m = novaMemoriaSom()
  // reconhecido desde o 1.º ciclo: 10 minutos de fumo
  const r = correr(m, 0, 600, [fumoReconhecido()])
  assert.deepEqual(r.continuo, [], 'nada de contínuo')
  assert.deepEqual(r.lembretes, [120, 240, 360, 480, 600], 'um bip curto de 2 em 2 minutos, nem um segundo a mais')
  assert.equal(deveTocar(fumoReconhecido()), null, 'o som do servidor continua calado (o botão "reconhecer" já não aparece)')
})

test('Adenda 2 (fumo): o alarme fica vermelho no ecrã depois de reconhecido (a barra mostra-o, sem botão de calar)', () => {
  const n = fumoReconhecido()
  assert.ok(emergenciaReconhecida(n))
  assert.equal(alarmeDaBarra([n]), n, 'ainda é o alarme da barra')
  const html = chipAlarme(n)
  assert.match(html, /^<span class="chip alarme" data-acao="ir-alarme"[^>]*>⚠ FUMO a bordo!<\/span>$/, 'o chip vermelho (alarme), sem botão')
  // o das outras gravidades reconhecidas não conta
  assert.equal(emergenciaReconhecida(ais({ method: [], status: st({ acknowledged: true }) })), false)
  assert.equal(emergenciaReconhecida(fumo()), false, 'por reconhecer')
  assert.equal(emergenciaReconhecida(fumoReconhecido({ state: 'normal' })), false)
  assert.equal(emergenciaReconhecida(null), false)
})

test('Adenda 2 (fumo): reconhece-se a meio — o contínuo pára logo e o 1.º bip curto vem 2 min depois; um calado só visual por baixo continua sem som', () => {
  const m = novaMemoriaSom()
  // 0–29 s a apitar; reconhecido aos 30 s; fumo até aos 400 s
  const r = correr(m, 0, 400, (s) => [s < 30 ? fumo() : fumoReconhecido()])
  assert.deepEqual(r.continuo, Array.from({ length: 30 }, (_, i) => i), 'contínuo até reconhecer')
  assert.deepEqual(r.lembretes, [150, 270, 390], '2 minutos depois do 1.º ciclo reconhecido (30 s), de 2 em 2')
})

test('Adenda 2 (fumo): se o fumo passar e voltar, apita contínuo outra vez e a contagem dos lembretes recomeça só depois de o reconhecer', () => {
  const m = novaMemoriaSom()
  const fases = (s) => {
    if (s < 200) return [fumoReconhecido()] // reconhecido
    if (s < 260) return [fumoNormal] // o fumo passou (o porto publicou "normal")
    if (s < 300) return [fumo({ timestamp: '2026-10-03T10:04:20.000Z', id: 'aaaaaaaa-1d2a-4c55-9d1e-6a1f2b3c4d5e' })] // voltou: o servidor repõe o status (sem reconhecer)
    return [fumoReconhecido({ timestamp: '2026-10-03T10:04:20.000Z', id: 'aaaaaaaa-1d2a-4c55-9d1e-6a1f2b3c4d5e' })] // e reconhecido outra vez aos 300 s
  }
  const r = correr(m, 0, 700, fases)
  assert.deepEqual(r.lembretes.filter(s => s < 200), [120], 'o 1.º fumo: um lembrete aos 2 min')
  assert.deepEqual(r.continuo, Array.from({ length: 40 }, (_, i) => 260 + i), 'o fumo voltou aos 260 s: contínuo outra vez, até reconhecer (300 s)')
  assert.deepEqual(r.lembretes.filter(s => s >= 200), [420, 540, 660], 'depois do 2.º reconhecimento (300 s) a contagem recomeça: 2 min depois, de 2 em 2')
})

test('Adenda 2 (fumo): o servidor repõe o estado de um fumo que volta mesmo que o ecrã não veja o "normal" no meio (a subscrição é de 1 em 1 s): reconhecido → por reconhecer = contínuo outra vez', () => {
  const m = novaMemoriaSom()
  const r = correr(m, 0, 140, (s) => [s < 125 ? fumoReconhecido() : fumo({ timestamp: '2026-10-03T10:02:05.000Z' })])
  assert.deepEqual(r.lembretes, [120])
  assert.deepEqual(r.continuo, Array.from({ length: 16 }, (_, i) => 125 + i))
})

test('Adenda 2 (fumo): só a emergência reconhecida repete; um alarme (alarm) reconhecido ou silenciado fica calado, e o apito curto toca uma só vez por alarme', () => {
  const m = novaMemoriaSom()
  const silenciado = ais({ method: ['visual'], status: st({ silenced: true }) })
  const reconhecidoAlarm = ais({ id: '3e9a6f51-4a5d-4f88-8a41-9d4c5e6f7a81', caminho: 'notifications.arlequin.ais.263000002', method: [], status: st({ acknowledged: true }) })
  const r = correr(m, 0, 600, [silenciado, reconhecidoAlarm, lembrete()])
  assert.deepEqual(r.continuo, [])
  assert.deepEqual(r.lembretes, [])
  assert.deepEqual(r.curtos, [[0, 'notifications.rota.lembrete.e3']], 'o lembrete da rota (curto) toca no 1.º ciclo e não repete')
  // outra hora de alarme no mesmo caminho é outro alarme: toca outra vez uma vez
  const r2 = correr(m, 601, 605, [lembrete({ timestamp: '2026-10-03T10:11:00.000Z' })])
  assert.deepEqual(r2.curtos, [[601, 'notifications.rota.lembrete.e3']])
})

test('Adenda 2 (fumo): com outro alarme contínuo a apitar ao mesmo tempo (colisão AIS), o contínuo toca e o lembrete do fumo reconhecido também chega à hora', () => {
  const m = novaMemoriaSom()
  const r = correr(m, 0, 130, [fumoReconhecido(), ais()])
  assert.equal(r.continuo.length, 131)
  assert.deepEqual(r.lembretes, [120])
  // dois fumos reconhecidos à mesma hora: um só bip (uma chamada) por ciclo
  const m2 = novaMemoriaSom()
  const dois = [fumoReconhecido(), fumoReconhecido({ caminho: 'notifications.arlequin.porto.fumo2' })]
  const r2 = correr(m2, 0, 130, dois)
  assert.deepEqual(r2.lembretes, [120])
  assert.deepEqual(decidirSom(dois, m2, T0 + 240 * S).lembretes.length, 2, 'as duas lá estão, para o app.js tocar um só bip')
})

test('Adenda 2 (fumo): sem ligação ao SignalK (o ecrã esquece os alarmes) a contagem recomeça quando eles voltam', () => {
  const m = novaMemoriaSom()
  const r = correr(m, 0, 400, (s) => (s >= 100 && s < 160 ? [] : [fumoReconhecido()]))
  // visto reconhecido de 0 a 99 (lembrete aos 120? não: caiu aos 100), voltou aos 160: 2 min depois = 280, de 2 em 2
  assert.deepEqual(r.lembretes, [280, 400])
})

test('Adenda 2 (fumo): o app.js toca pelo decidirSom com a hora do ecrã e dá um só bip curto para os lembretes', () => {
  const app = lerFonte('app.js')
  const tocar = funcao(app, 'function tocar')
  assert.match(tocar, /decidirSom\(\s*notificacoes\s*,\s*app\.somMemoria\s*,\s*Date\.now\(\)\s*\)/)
  assert.match(tocar, /lembretes/)
  assert.match(app, /somMemoria:\s*novaMemoriaSom\(\)/)
  assert.doesNotMatch(app, /bipados:\s*new Set/, 'a memória do som é uma só, no lib/alarmes.js')
})
