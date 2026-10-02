'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const prev = require('../lib/previsao')
const { avaliarDisparo } = require('../lib/disparo')
const { lancarTreino } = require('../lib/processo')

const NO = 1852 / 3600
const MIN = 60000
const VENTO = { hourly: { time: ['2026-09-29T14:00', '2026-09-29T15:00'], wind_speed_10m: [12, 14], wind_gusts_10m: [16, 19], wind_direction_10m: [350, 10] } }
const MAR = { hourly: { time: ['2026-09-29T15:00'], wave_height: [1.8], wave_period: [9], wave_direction: [300] } }

test('compor: junta vento e mar pela hora, em UTC; o mar em falta fica null', () => {
  const r = prev.compor(39, -9.6, Date.UTC(2026, 8, 29, 14, 5), VENTO, MAR)
  assert.deepEqual(r, {
    obtida: '2026-09-29T14:05:00.000Z',
    lat: 39,
    lon: -9.6,
    horas: ['2026-09-29T14:00:00Z', '2026-09-29T15:00:00Z'],
    tws: [12, 14],
    rajada: [16, 19],
    twd: [350, 10],
    ondas: [null, 1.8],
    periodo: [null, 9],
    ondasDir: [null, 300]
  })
  assert.deepEqual(prev.compor(39, -9.6, 0, VENTO, null).ondas, [null, null])
})

test('descarregar: pede em nós e UTC, arredonda a posição; sem mar guarda o vento; erro do vento rebenta', async () => {
  const pedidos = []
  const fetchOk = async (u) => { pedidos.push(u); return { ok: true, json: async () => (u.includes('marine') ? MAR : VENTO) } }
  const r = await prev.descarregar(39.123456, -9.654321, Date.UTC(2026, 8, 29, 14), fetchOk)
  assert.equal(r.lat, 39.123)
  assert.match(pedidos[0], /wind_speed_unit=kn/)
  assert.match(pedidos[0], /timezone=UTC/)
  assert.match(pedidos[1], /marine-api/)
  const semMar = await prev.descarregar(39, -9, 0, async (u) => {
    if (u.includes('marine')) throw new Error('rede')
    return { ok: true, json: async () => VENTO }
  })
  assert.deepEqual(semMar.ondas, [null, null])
  await assert.rejects(prev.descarregar(39, -9, 0, async () => ({ ok: false, status: 503 })), /503/)
})

test('descarregar: o vento e o mar pedem-se com cell_selection=sea — a célula de terra (a omissão do forecast) subestima o vento junto à costa (auditoria K-05)', async () => {
  const pedidos = []
  await prev.descarregar(38.61, -9.46, Date.UTC(2026, 9, 2, 12), async (u) => { pedidos.push(u); return { ok: true, json: async () => (u.includes('marine') ? MAR : VENTO) } })
  assert.equal(pedidos.length, 2)
  assert.match(pedidos[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/)
  assert.match(pedidos[1], /^https:\/\/marine-api\.open-meteo\.com\/v1\/marine\?/)
  for (const u of pedidos) assert.equal(new URL(u).searchParams.get('cell_selection'), 'sea', u)
  const u = prev.urls(38.61, -9.46)
  for (const x of [u.vento, u.mar]) assert.equal(new URL(x).searchParams.get('cell_selection'), 'sea', x)
})

test('guardar: previsoes/AAAA-MM-DDTHH-MM.json.gz, sem ":" no nome', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-prev-'))
  const f = prev.guardar(path.join(p, 'previsoes'), prev.compor(39, -9.6, Date.UTC(2026, 8, 29, 14, 5), VENTO, MAR))
  assert.equal(path.basename(f), '2026-09-29T14-05.json.gz')
  assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))).tws[1], 14)
  assert.deepEqual(fs.readdirSync(path.join(p, 'previsoes')), ['2026-09-29T14-05.json.gz'])
})

test('cadência: 1 h a navegar, 3 h parado, 10 min depois de uma falha', () => {
  const t = 1e12
  assert.equal(prev.precisaPrevisao({ agora: t }), true)
  assert.equal(prev.precisaPrevisao({ agora: t, okEm: t - 59 * MIN, aNavegar: true }), false)
  assert.equal(prev.precisaPrevisao({ agora: t, okEm: t - 60 * MIN, aNavegar: true }), true)
  assert.equal(prev.precisaPrevisao({ agora: t, okEm: t - 120 * MIN, aNavegar: false }), false)
  assert.equal(prev.precisaPrevisao({ agora: t, okEm: t - 180 * MIN, aNavegar: false }), true)
  assert.equal(prev.precisaPrevisao({ agora: t, tentativaEm: t - 5 * MIN }), false)
})

test('disparo: parado há 1 h com uma saída nova → treinar; a andar, com motor ou sem saída nova → não', () => {
  let e = {}
  const base = { sog: 0.1, rpm: 0, ultimaSaidaMs: 500, ultimoTreinoMs: 100 }
  let r = avaliarDisparo(e, { ...base, agora: 0 }); e = r.e
  assert.equal(r.treinar, false)
  r = avaliarDisparo(e, { ...base, agora: 59 * MIN }); e = r.e
  assert.equal(r.treinar, false)
  r = avaliarDisparo(e, { ...base, agora: 60 * MIN })
  assert.equal(r.treinar, true)
  assert.equal(avaliarDisparo(e, { ...base, agora: 60 * MIN, ultimoTreinoMs: 600 }).treinar, false)
  assert.equal(avaliarDisparo(e, { ...base, agora: 60 * MIN, sog: 2 * NO }).e.paradoDesde, null)
  assert.equal(avaliarDisparo(e, { ...base, agora: 60 * MIN, rpm: 20 }).treinar, false)
  assert.equal(avaliarDisparo({}, { agora: 0, ultimaSaidaMs: 1 }).e.paradoDesde, 0, 'sem GPS conta como parado')
})

test('processo: lê uma linha JSON por modelo; falha e tempo esgotado dão erro claro', async () => {
  const js = (codigo) => [process.execPath, '-e', codigo]
  const ok = 'console.log(JSON.stringify({modelo:"velocidade",aceite:true}));console.log(JSON.stringify({modelo:"consumo",aceite:false}))'
  const r = await lancarTreino({ comando: js(ok), nice: false })
  assert.deepEqual(r.map(x => x.modelo), ['velocidade', 'consumo'])
  await assert.rejects(lancarTreino({ comando: js('console.error("ModuleNotFoundError: lightgbm");process.exit(1)'), nice: false }), /código 1\): ModuleNotFoundError: lightgbm/)
  await assert.rejects(lancarTreino({ comando: js('setTimeout(()=>{},5000)'), nice: false, timeoutMs: 200 }), /passou de 0 min e foi parado/)
  await assert.rejects(lancarTreino({ comando: ['nao-existe-este-programa'], nice: false }), /não consegui lançar o treino/)
})

test('processo: linhas do stdout que não são JSON (avisos do LightGBM) saltam-se sem perder os resultados', async () => {
  const js = (codigo) => [process.execPath, '-e', codigo]
  const r = await lancarTreino({ comando: js('console.log("[LightGBM] [Warning] No further splits");console.log(JSON.stringify({modelo:"velocidade"}));console.log("lixo {");console.log(JSON.stringify({modelo:"consumo"}))'), nice: false })
  assert.deepEqual(r.map(x => x.modelo), ['velocidade', 'consumo'])
})

// Um processo filho falso: só fecha quando o teste quiser.
function filhoFalso () {
  const { EventEmitter } = require('node:events')
  const p = new EventEmitter()
  p.stdout = new EventEmitter()
  p.stderr = new EventEmitter()
  p.sinais = []
  p.kill = (s) => { p.sinais.push(s ?? 'SIGTERM') }
  return p
}

test('processo: no tempo esgotado mata o filho e só rejeita depois de ele fechar (e insiste com SIGKILL)', async () => {
  const p = filhoFalso()
  let rejeitou = null
  const pr = lancarTreino({ comando: ['python3'], nice: false, timeoutMs: 20, esperaKillMs: 60, spawnFn: () => p }).catch(e => { rejeitou = e })
  await new Promise(r => setTimeout(r, 40))
  assert.deepEqual(p.sinais, ['SIGTERM'])
  assert.equal(rejeitou, null, 'ainda não fechou: o treino continua ocupado')
  await new Promise(r => setTimeout(r, 60))
  assert.deepEqual(p.sinais, ['SIGTERM', 'SIGKILL'])
  assert.equal(rejeitou, null)
  p.emit('close', null)
  await pr
  assert.match(rejeitou.message, /passou de 0 min e foi parado/)
})

test('descarregar: cada pedido leva um sinal de tempo limite (30 s)', async () => {
  const opcoes = []
  await prev.descarregar(39, -9, 0, async (u, op) => { opcoes.push(op); return { ok: true, json: async () => (u.includes('marine') ? MAR : VENTO) } })
  assert.equal(opcoes.length, 2)
  for (const op of opcoes) assert.ok(op?.signal instanceof AbortSignal)
})

test('guardar: escreve com fsync antes de trocar o .tmp', (t) => {
  const chamadas = []
  const original = fs.fsyncSync
  fs.fsyncSync = (fd) => { chamadas.push(fd); return original(fd) }
  t.after(() => { fs.fsyncSync = original })
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-prev-'))
  const f = prev.guardar(path.join(p, 'previsoes'), prev.compor(39, -9.6, Date.UTC(2026, 8, 29, 14, 5), VENTO, MAR))
  assert.equal(chamadas.length, 1)
  assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))).tws[0], 12)
  assert.deepEqual(fs.readdirSync(path.join(p, 'previsoes')), ['2026-09-29T14-05.json.gz'])
})
