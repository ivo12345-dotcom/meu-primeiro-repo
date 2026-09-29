'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { criarGravadorBruto, nomeHora } = require('../lib/bruto')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-bruto-'))
const linhas = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

test('nome por hora em UTC, sem ":"', () => {
  assert.equal(nomeHora(Date.UTC(2026, 8, 29, 14, 59, 59)), '2026-09-29T14.ndjson.gz')
})

test('uma linha por mensagem, ficheiro novo a cada hora', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  g.escrever({ n: 1 }, Date.UTC(2026, 8, 29, 10, 59, 59))
  g.escrever({ n: 2 }, Date.UTC(2026, 8, 29, 11, 0, 1))
  g.escrever({ n: 3 }, Date.UTC(2026, 8, 29, 11, 0, 2))
  assert.equal(g.pendentes, 3)
  assert.ok(g.despejar() > 0)
  assert.equal(g.pendentes, 0)
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T10.ndjson.gz')), [{ n: 1 }])
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T11.ndjson.gz')), [{ n: 2 }, { n: 3 }])
})

test('vários despejos na mesma hora: o .gz com vários blocos lê-se inteiro', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  const t = Date.UTC(2026, 8, 29, 12, 0, 0)
  g.escrever({ a: 1 }, t); g.despejar()
  g.escrever({ a: 2 }, t + 10000); g.despejar()
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T12.ndjson.gz')), [{ a: 1 }, { a: 2 }])
  assert.equal(g.despejar(), 0) // nada pendente, nada escrito
})

test('parado não grava; retomar volta a gravar', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  const t = Date.UTC(2026, 8, 29, 12, 0, 0)
  g.parar()
  assert.equal(g.parado, true)
  g.escrever({ x: 1 }, t)
  assert.equal(g.pendentes, 0)
  g.retomar()
  g.escrever({ x: 2 }, t); g.despejar()
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T12.ndjson.gz')), [{ x: 2 }])
})
