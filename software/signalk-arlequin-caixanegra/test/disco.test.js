'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const conf = require('../lib/confirmados')
const disco = require('../lib/disco')

function base () {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-disco-'))
  for (const d of ['bruto', 'entrada']) fs.mkdirSync(path.join(b, d))
  fs.writeFileSync(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'), 'dez')
  fs.writeFileSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'), 'onze')
  return b
}
const entrada = (b, nome, lista) => fs.writeFileSync(path.join(b, 'entrada', nome), JSON.stringify(lista))

test('entrada: hash certo fica confirmado; errado, inexistente ou fora do bruto não', () => {
  const b = base()
  const h10 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'))
  entrada(b, 'confirmados-1.json', [
    { ficheiro: 'bruto/2026-09-28T10.ndjson.gz', sha256: h10 },
    { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', sha256: 'f'.repeat(64) },
    { ficheiro: 'bruto/nao-existe.ndjson.gz', sha256: h10 },
    { ficheiro: '../velas.json', sha256: h10 },
    { ficheiro: 'tabela/2026-09-28.csv.gz', sha256: h10 }
  ])
  fs.writeFileSync(path.join(b, 'entrada', 'meio-escrito.json.tmp'), '[')
  const r = conf.processarEntrada(b)
  assert.deepEqual(r.aceites, ['bruto/2026-09-28T10.ndjson.gz'])
  assert.deepEqual(r.rejeitados.map(x => x.motivo), ['hash diferente', 'não existe', 'fora do bruto', 'fora do bruto'])
  assert.deepEqual(conf.lerConfirmados(b), { 'bruto/2026-09-28T10.ndjson.gz': h10 })
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'confirmados-1.json')), false)
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'meio-escrito.json.tmp')), true, 'os .tmp ficam para o fim da cópia')
})

test('lista ilegível: fica de lado (.mau) e não rebenta', () => {
  const b = base()
  fs.writeFileSync(path.join(b, 'entrada', 'x.json'), '{isto não é json')
  const r = conf.processarEntrada(b)
  assert.equal(r.rejeitados[0].motivo, 'lista ilegível')
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'x.json.mau')), true)
})

test('apagar só o confirmado e só se o hash ainda bater certo', () => {
  const b = base()
  const h10 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'))
  const h11 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'))
  entrada(b, 'c.json', [{ ficheiro: 'bruto/2026-09-28T10.ndjson.gz', sha256: h10 }, { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', sha256: h11 }])
  conf.processarEntrada(b)
  fs.appendFileSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'), 'mais') // mudou depois de confirmado
  const apagados = conf.apagarConfirmados(b, ['bruto/2026-09-28T10.ndjson.gz', 'bruto/2026-09-28T11.ndjson.gz', 'bruto/outro.gz'])
  assert.deepEqual(apagados, ['bruto/2026-09-28T10.ndjson.gz'])
  assert.equal(fs.existsSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz')), true)
  assert.deepEqual(Object.keys(conf.lerConfirmados(b)), ['bruto/2026-09-28T11.ndjson.gz'])
})

test('plano do disco: abaixo de 80% nada; acima apaga o confirmado mais antigo até baixar', () => {
  const ficheiros = [
    { ficheiro: 'bruto/2026-09-28T12.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T10.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T13.ndjson.gz', bytes: 30 }
  ]
  const confirmadosTodos = Object.fromEntries(ficheiros.map(f => [f.ficheiro, 'h']))
  assert.deepEqual(disco.planear({ usadoPct: 79, total: 1000, ficheiros, confirmados: confirmadosTodos }), { aviso: false, apagar: [], pararBruto: false })
  const p = disco.planear({ usadoPct: 85, total: 1000, ficheiros, confirmados: confirmadosTodos })
  assert.equal(p.aviso, true)
  assert.deepEqual(p.apagar, ['bruto/2026-09-28T10.ndjson.gz', 'bruto/2026-09-28T11.ndjson.gz'])
  assert.equal(p.pararBruto, false)
  const soUm = disco.planear({ usadoPct: 85, total: 1000, ficheiros, confirmados: { 'bruto/2026-09-28T13.ndjson.gz': 'h' } })
  assert.deepEqual(soUm.apagar, ['bruto/2026-09-28T13.ndjson.gz'], 'nunca o que não está confirmado')
})

test('plano do disco: 96% sem nada confirmado → parar o bruto; com o suficiente não', () => {
  const ficheiros = [{ ficheiro: 'bruto/a.gz', bytes: 20 }, { ficheiro: 'bruto/b.gz', bytes: 20 }]
  assert.equal(disco.planear({ usadoPct: 96, total: 1000, ficheiros, confirmados: {} }).pararBruto, true)
  assert.equal(disco.planear({ usadoPct: 96, total: 1000, ficheiros, confirmados: { 'bruto/a.gz': 'h', 'bruto/b.gz': 'h' } }).pararBruto, false)
})

test('usoDisco dá números com sentido', () => {
  const u = disco.usoDisco(os.tmpdir())
  assert.ok(u.total > 0 && u.livre >= 0 && u.usadoPct >= 0 && u.usadoPct <= 100)
})
