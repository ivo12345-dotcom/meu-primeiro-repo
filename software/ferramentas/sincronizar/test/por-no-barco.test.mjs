// Pôr no barco um modelo treinado no portátil (pNNNN): só por cópia confirmada (decisão n.º 26).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { porNoBarco } from '../lib.mjs'
import { transporteLocal, transporteSsh } from '../transportes.mjs'

const MODELO = { modelo: 'velocidade', versao: 'p0001', criado: '2026-10-02T10:00:00+00:00', horas: 12.5, mae: 0.31, maeAtual: 0.35, maeBase: 0.6, aceite: true, quantis: { p10: {}, p50: {}, p90: {} } }

function portatil (modelo = MODELO, nome = `${modelo.versao}.json.gz`) {
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  mkdirSync(path.join(destino, 'modelos', 'velocidade'), { recursive: true })
  const bytes = gzipSync(JSON.stringify(modelo))
  writeFileSync(path.join(destino, 'modelos', 'velocidade', nome), bytes)
  return { destino, bytes }
}
function piFalso () {
  const enviados = []
  return { enviados, transporte: { podeConfirmar: true, porModelo: async (nome, versao, bytes) => { enviados.push({ nome, versao, bytes }) } } }
}

test('pôr no barco um modelo do portátil: mostra o resumo e só copia com o sim, os bytes do ficheiro (decisão n.º 26)', async () => {
  const { destino, bytes } = portatil()
  const { transporte, enviados } = piFalso()
  const resumos = []
  const nao = await porNoBarco({ transporte, destino, modelo: 'velocidade/p0001', confirmar: async (r) => { resumos.push(r); return false } })
  assert.equal(nao.feito, false)
  assert.deepEqual(enviados, [], 'sem o sim nada vai para o Pi')
  assert.equal(resumos[0], 'velocidade p0001, treinado no portátil a 02/10/2026, 11:00:00 com 12,5 h de dados: erro 0,31 (o modelo em uso no barco: 0,35; a origem: 0,6)')
  const sim = await porNoBarco({ transporte, destino, modelo: 'velocidade/p0001', confirmar: async () => true })
  assert.equal(sim.feito, true)
  assert.deepEqual(enviados.map(e => [e.nome, e.versao]), [['velocidade', 'p0001']])
  assert.equal(Buffer.compare(enviados[0].bytes, bytes), 0)
})

test('pôr no barco: nunca uma vNNNN (é do barco), um nome estranho, pela pen, ou um ficheiro que não é desse modelo (decisão n.º 26)', async () => {
  const { destino } = portatil()
  const { transporte, enviados } = piFalso()
  const sim = async () => true
  for (const modelo of ['velocidade/v0001', 'velocidade/p1', 'velocidade', 'vento/p0001', '../velocidade/p0001', undefined]) {
    await assert.rejects(porNoBarco({ transporte, destino, modelo, confirmar: sim }), /velocidade\/p0001/, String(modelo))
  }
  await assert.rejects(porNoBarco({ transporte: transporteLocal(destino), destino, modelo: 'velocidade/p0001', confirmar: sim }), /ssh/)
  await assert.rejects(porNoBarco({ transporte, destino, modelo: 'velocidade/p0002', confirmar: sim }), /ENOENT|não há/)
  const outro = portatil({ ...MODELO, modelo: 'consumo' }) // o ficheiro diz que é do consumo
  await assert.rejects(porNoBarco({ transporte, destino: outro.destino, modelo: 'velocidade/p0001', confirmar: sim }), /não é o modelo velocidade p0001/)
  const torto = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  mkdirSync(path.join(torto, 'modelos', 'velocidade'), { recursive: true })
  writeFileSync(path.join(torto, 'modelos', 'velocidade', 'p0001.json.gz'), 'não é gzip')
  await assert.rejects(porNoBarco({ transporte, destino: torto, modelo: 'velocidade/p0001', confirmar: sim }), /ilegível/)
  assert.deepEqual(enviados, [])
})

test('ssh: o modelo e o atual vão com .tmp e mudança de nome, e recusa se a AI está a treinar no Pi (decisão n.º 26)', async () => {
  const chamadas = []
  const exec = async (cmd, args, op = {}) => { chamadas.push({ cmd, args, ...op }); return '' }
  const t = transporteSsh('pi@arlequin', { exec })
  await t.porModelo('velocidade', 'p0001', Buffer.from('bytes do modelo'))
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].cmd, 'ssh')
  assert.equal(chamadas[0].args[0], 'pi@arlequin')
  assert.equal(chamadas[0].args[1], "mkdir -p ~/arlequin-dados/modelos/velocidade && cd ~/arlequin-dados/modelos/velocidade || exit 1; if pgrep -f 'arlequin_i[a] treinar' >/dev/null 2>&1; then echo 'a AI está a treinar no barco: tenta daqui a pouco' >&2; exit 3; fi; cat > p0001.json.gz.tmp && mv p0001.json.gz.tmp p0001.json.gz && printf %s p0001 > atual.tmp && mv atual.tmp atual")
  assert.equal(chamadas[0].entrada.toString(), 'bytes do modelo')
  for (const [nome, versao] of [['velocidade; rm -rf ~', 'p0001'], ['velocidade', 'v0001'], ['velocidade', 'p0001 && x']]) {
    await assert.rejects(t.porModelo(nome, versao, Buffer.from('x')), /inválid/)
  }
  assert.equal(chamadas.length, 1)
})
