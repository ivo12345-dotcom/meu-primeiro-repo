'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { textoSessao, registar } = require('../lib/diario')

const SESSAO = {
  inicio: '2026-10-01T12:00:00.000Z',
  fim: '2026-10-01T13:20:00.000Z',
  duracaoMin: 80,
  ah: 61.6,
  socInicial: 0.55,
  socFinal: 0.812
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-'))

test('texto da sessão em pt-PT', () => {
  assert.equal(textoSessao(SESSAO), 'Carga pelo motor: 1 h 20 min, +61,6 Ah, serviço 55% → 81%')
  assert.equal(textoSessao({ ...SESSAO, duracaoMin: 45 }), 'Carga pelo motor: 45 min, +61,6 Ah, serviço 55% → 81%')
})

test('grava uma linha JSON por sessão', async () => {
  const ficheiro = path.join(tmp(), 'sessoes-carga.jsonl')
  await registar(SESSAO, { ficheiro })
  await registar(SESSAO, { ficheiro })
  const linhas = fs.readFileSync(ficheiro, 'utf8').trim().split('\n')
  assert.equal(linhas.length, 2)
  assert.deepEqual(JSON.parse(linhas[0]), SESSAO)
})

test('com logbook ligado faz POST com categoria engine e origem auto', async () => {
  const ficheiro = path.join(tmp(), 's.jsonl')
  const chamadas = []
  const fetchFn = async (url, opts) => { chamadas.push({ url, opts }); return { ok: true, status: 201 } }
  const r = await registar(SESSAO, { ficheiro, logbookUrl: 'http://localhost:3000/plugins/signalk-logbook/logs', token: 'abc', fetchFn })
  assert.equal(r.erro, null)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].opts.method, 'POST')
  assert.equal(chamadas[0].opts.headers.Authorization, 'Bearer abc')
  assert.deepEqual(JSON.parse(chamadas[0].opts.body), {
    text: textoSessao(SESSAO), category: 'engine', origin: 'auto'
  })
})

test('se o logbook falhar, o JSONL fica gravado e o erro é devolvido (não rebenta)', async () => {
  const ficheiro = path.join(tmp(), 's.jsonl')
  const fetchFn = async () => ({ ok: false, status: 401 })
  const r = await registar(SESSAO, { ficheiro, logbookUrl: 'http://x/logs', fetchFn })
  assert.match(r.erro, /401/)
  assert.equal(fs.readFileSync(ficheiro, 'utf8').trim().split('\n').length, 1)
})
