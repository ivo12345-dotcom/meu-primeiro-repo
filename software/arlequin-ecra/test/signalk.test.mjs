import test from 'node:test'
import assert from 'node:assert/strict'
import { criarStore, aplicarDelta, perderLigacao, pedir } from '../public/signalk.js'

test('sem ligação o ecrã esquece os alarmes (não fica a apitar)', () => {
  const store = criarStore()
  aplicarDelta(store, { updates: [{ timestamp: '2026-09-29T09:00:00Z', values: [
    { path: 'notifications.arlequin.ais.1', value: { state: 'alarm', method: ['visual', 'sound'], message: 'x' } },
    { path: 'navigation.speedOverGround', value: 2.5 }
  ] }] })
  assert.equal(store.notificacoes.size, 1)
  perderLigacao(store)
  assert.equal(store.ligado, false)
  assert.equal(store.notificacoes.size, 0)
  assert.equal(store.self.get('navigation.speedOverGround').value, 2.5)
})

test('alvos AIS: nome pelo caminho vazio e posição com hora', () => {
  const store = criarStore()
  store.selfContext = 'vessels.urn:mrn:signalk:uuid:eu'
  aplicarDelta(store, { context: 'vessels.urn:mrn:imo:mmsi:263000001', updates: [{ timestamp: '2026-09-29T09:00:00Z', values: [
    { path: '', value: { name: 'NORDIC STAR' } },
    { path: 'navigation.position', value: { latitude: 39.4, longitude: -9.4 } }
  ] }] })
  const a = store.vessels.get('vessels.urn:mrn:imo:mmsi:263000001')
  assert.equal(a.name, 'NORDIC STAR')
  assert.equal(a.mmsi, '263000001')
  assert.equal(a.em, Date.parse('2026-09-29T09:00:00Z'))
})

test('pedir: o erro leva o código e o corpo do plugin (num 409, o id do cálculo que já corre)', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, erro: 'já há um cálculo a correr', id: 'calc-0' }), { status: 409, headers: { 'content-type': 'application/json' } })
  try {
    await assert.rejects(pedir('/plugins/signalk-arlequin-rota/calcular', { method: 'POST', body: {} }), (e) => e.status === 409 && e.message === 'já há um cálculo a correr' && e.corpo?.id === 'calc-0')
  } finally { globalThis.fetch = orig }
})
