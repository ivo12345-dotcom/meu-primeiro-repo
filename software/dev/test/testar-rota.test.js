'use strict'
// O testar-rota do dev (auditoria I-35, contrato C9): o que injeta fica "simulado" na caixa negra, e o
// --em (posição, SoC e gasóleo falsos) e o --ativar (ativa rotas, pode reenviar o plano aos contactos)
// só correm no SignalK do dev, com a mesma guarda da viagem acelerada. Só as contas (sem SignalK).
const test = require('node:test')
const assert = require('node:assert/strict')
const { deltaNoCais, precisaGuarda, guarda } = require('../testar-rota')
const est = require('../../signalk-arlequin-caixanegra/lib/estado')

const PORTO_DEV = { enabled: false, configuration: { telegramToken: 'DEV-TELEGRAM-FALSO', telegramBase: 'http://localhost:8081', contactosPlano: [{ nome: 'Teste em terra', chatId: '222' }] } }
// o SignalK falso: GET /plugins/<id>/config
const servidor = (configs) => async (url) => {
  const id = url.split('/plugins/')[1]?.split('/')[0]
  return id in configs && configs[id] ? { status: 200, corpo: configs[id] } : { status: 401, corpo: 'Unauthorized' }
}

test('I-35: o delta do --em leva a marca de fonte do simulador e a caixa negra marca-o simulado', () => {
  const d = deltaNoCais({ lat: 38.695, lon: -9.2344 }, Date.parse('2026-10-02T10:00:00Z'))
  assert.equal(d.context, 'vessels.self')
  assert.equal(d.updates[0].$source, 'arlequin-simulador.testar-rota')
  assert.deepEqual(d.updates[0].values.map(v => v.path), ['navigation.position', 'electrical.batteries.servico.capacity.stateOfCharge', 'tanks.fuel.0.currentVolume'])
  const e = est.novoEstado()
  est.aplicar(e, d, 'vessels.urn:mrn:signalk:uuid:arlequin', 1000)
  assert.equal(est.simuladoRecente(e, 1000), true)
})

test('I-35: só o --em e o --ativar precisam da guarda; o cálculo sozinho corre em qualquer lado', () => {
  assert.equal(precisaGuarda(['--em', 'alges', '--destino', 'peniche']), true)
  assert.equal(precisaGuarda(['--destino', 'peniche', '--ativar']), true)
  assert.equal(precisaGuarda(['--destino', 'peniche', '--tripulacao', 'so']), false)
})

test('I-35: --em/--ativar recusam fora do dev (sem modoTeste, a configuração por ler, Telegram ou contactos verdadeiros); no dev correm', async () => {
  const base = 'http://localhost:3000'
  const dev = { 'signalk-arlequin-rota': { enabled: true, configuration: { modoTeste: true } }, 'signalk-arlequin-porto': PORTO_DEV }
  assert.deepEqual(await guarda(['--em', 'alges'], base, servidor(dev)), [])
  // o testar-rota não precisa da hora simulada (a viagem acelerada sim)
  assert.deepEqual(await guarda(['--ativar'], base, servidor(dev)), [])
  // o barco: o modoTeste desligado
  const barco = { ...dev, 'signalk-arlequin-rota': { enabled: true, configuration: {} } }
  assert.match((await guarda(['--ativar'], base, servidor(barco))).join(' | '), /modoTeste/)
  // a segurança do SignalK ligada: a configuração não se lê (401)
  assert.match((await guarda(['--em', 'alges'], base, servidor({}))).join(' | '), /não consegui ler a configuração do plugin da rota/)
  // o porto ligado ao Telegram verdadeiro ou com um contacto verdadeiro
  const tg = { ...dev, 'signalk-arlequin-porto': { enabled: true, configuration: { ...PORTO_DEV.configuration, telegramBase: 'https://api.telegram.org' } } }
  assert.match((await guarda(['--ativar'], base, servidor(tg))).join(' | '), /Telegram falso/)
  const mae = { ...dev, 'signalk-arlequin-porto': { enabled: true, configuration: { ...PORTO_DEV.configuration, contactosPlano: [{ nome: 'Mãe', chatId: '123456789' }] } } }
  assert.match((await guarda(['--ativar'], base, servidor(mae))).join(' | '), /contactos do plano verdadeiros: Mãe/)
  // sem --em nem --ativar não se pergunta nada ao servidor
  assert.deepEqual(await guarda(['--destino', 'peniche'], base, async () => { throw new Error('não devia perguntar') }), [])
})
