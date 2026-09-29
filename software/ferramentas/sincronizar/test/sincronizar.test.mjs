import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { sincronizar, sha256 } from '../lib.mjs'
import { transporteLocal, transporteSsh, executar } from '../transportes.mjs'

const require = createRequire(import.meta.url)
const confirmados = require('../../../signalk-arlequin-caixanegra/lib/confirmados.js')
const AGORA = Date.UTC(2026, 8, 29, 14, 30, 0)

function pi () {
  const b = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pi-'))
  for (const d of ['bruto', 'tabela', 'saidas', 'entrada']) mkdirSync(path.join(b, d))
  writeFileSync(path.join(b, 'bruto', '2026-09-29T10.ndjson.gz'), 'dez')
  writeFileSync(path.join(b, 'bruto', '2026-09-29T14.ndjson.gz'), 'catorze') // hora atual, a crescer
  writeFileSync(path.join(b, 'tabela', '2026-09-29.csv.gz'), 't')
  writeFileSync(path.join(b, 'confirmados.json'), '{}')
  return b
}

test('copia tudo, confirma só horas fechadas, e o Pi aceita a confirmação', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const r = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA })
  assert.equal(r.copiados, 3)
  assert.equal(r.confirmados, 1)
  assert.deepEqual(r.diferentes, [])
  assert.equal(readFileSync(path.join(destino, 'bruto', '2026-09-29T14.ndjson.gz'), 'utf8'), 'catorze')
  assert.equal(existsSync(path.join(destino, 'entrada')), false, 'a entrada não se copia')
  const listas = readdirSync(path.join(origem, 'entrada'))
  assert.equal(listas.length, 1)
  assert.match(listas[0], /^confirmados-.*\.json$/)
  const aceite = confirmados.processarEntrada(origem)
  assert.deepEqual(aceite.aceites, ['bruto/2026-09-29T10.ndjson.gz'])
  // segunda vez: nada de novo
  const r2 = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA })
  assert.equal(r2.copiados, 0)
  assert.equal(r2.confirmados, 0)
  // a hora atual cresceu e a hora fechou: copia de novo e confirma
  appendFileSync(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz'), ' e mais')
  const r3 = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA + 3600000 })
  assert.equal(r3.copiados, 1)
  assert.equal(r3.confirmados, 1)
  assert.equal(sha256(path.join(destino, 'bruto', '2026-09-29T14.ndjson.gz')), sha256(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz')))
})

test('hash diferente: não confirma e avisa', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const t = transporteLocal(origem)
  const mau = { ...t, hashes: async (fs) => Object.fromEntries(fs.map(f => [f, '0'.repeat(64)])) }
  const r = await sincronizar({ transporte: mau, destino, agora: AGORA })
  assert.deepEqual(r.diferentes, ['bruto/2026-09-29T10.ndjson.gz'])
  assert.equal(r.confirmados, 0)
  assert.equal(readdirSync(path.join(origem, 'entrada')).length, 0)
})

test('ssh: comandos certos e respostas bem lidas', async () => {
  const chamadas = []
  const exec = async (cmd, args, op = {}) => {
    chamadas.push({ cmd, args, ...op })
    const remoto = args[1]
    if (remoto.includes('find ')) return 'bruto/2026-09-29T10.ndjson.gz\t123\ntabela/2026-09-29.csv.gz\t45\n'
    if (remoto.includes('sha256sum')) return `${'a'.repeat(64)}  bruto/2026-09-29T10.ndjson.gz\n`
    return ''
  }
  const t = transporteSsh('pi@arlequin', { exec })
  assert.deepEqual(await t.listar(), [{ ficheiro: 'bruto/2026-09-29T10.ndjson.gz', bytes: 123 }, { ficheiro: 'tabela/2026-09-29.csv.gz', bytes: 45 }])
  assert.match(chamadas[0].args[1], /^cd ~\/arlequin-dados \|\| exit 1; find /)
  assert.deepEqual(await t.hashes(['bruto/2026-09-29T10.ndjson.gz']), { 'bruto/2026-09-29T10.ndjson.gz': 'a'.repeat(64) })
  await t.copiar(['bruto/2026-09-29T10.ndjson.gz'], 'C:\\dados')
  await t.escreverEntrada('confirmados-x.json', '[]')
  const copiar = chamadas[2]
  assert.equal(copiar.cmd, 'ssh')
  assert.equal(copiar.args[1], "cd ~/arlequin-dados && tar --warning=no-file-changed -cf - -T -; s=$?; [ $s -eq 1 ] && exit 0; exit $s")
  assert.deepEqual(copiar.para, ['tar', ['-xf', '-', '-C', 'C:\\dados']])
  assert.equal(copiar.entrada, 'bruto/2026-09-29T10.ndjson.gz\n')
  assert.match(chamadas[3].args[1], /cat > ~\/arlequin-dados\/entrada\/confirmados-x\.json\.tmp && mv .*confirmados-x\.json\.tmp .*confirmados-x\.json$/)
  assert.ok(chamadas.every(c => c.args[0] === 'pi@arlequin'))
})

test('executar: não rebenta com EPIPE, dá reject limpo', { timeout: 20000 }, async () => {
  await assert.rejects(
    executar(process.execPath, ['-e', 'process.exit(2)']),
    /saiu com o código 2/
  )

  await assert.rejects(
    executar(
      process.execPath,
      ['-e', 'process.stdout.write(Buffer.alloc(20e6))'],
      { para: [process.execPath, ['-e', 'process.exit(3)']] }
    )
  )

  const ok = await executar(process.execPath, ['-e', "process.stdout.write('ok')"])
  assert.equal(ok, 'ok')
})

test('lib: uma cópia local corrompida com o mesmo tamanho é reparada', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  mkdirSync(path.join(destino, 'bruto'), { recursive: true })
  writeFileSync(path.join(destino, 'bruto', '2026-09-29T10.ndjson.gz'), 'xyz') // mesmo tamanho que 'dez', conteúdo diferente
  const r = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA })
  assert.equal(r.copiados, 2) // T14 e tabela; T10 fica de fora por ter o mesmo tamanho
  assert.equal(r.confirmados, 1)
  assert.deepEqual(r.diferentes, [])
  assert.equal(
    readFileSync(path.join(destino, 'bruto', '2026-09-29T10.ndjson.gz'), 'utf8'),
    readFileSync(path.join(origem, 'bruto', '2026-09-29T10.ndjson.gz'), 'utf8')
  )
})

test('lib: margem de 10 min antes de fechar a hora', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const agora = Date.UTC(2026, 8, 29, 15, 5, 0)
  const r = await sincronizar({ transporte: transporteLocal(origem), destino, agora })
  assert.equal(r.confirmados, 1) // só a T10 (fechada); a T14, mesmo já "no passado" à hora do relógio, tem 10 min de margem
  const [nome] = readdirSync(path.join(origem, 'entrada'))
  const confirmados = JSON.parse(readFileSync(path.join(origem, 'entrada', nome), 'utf8'))
  assert.deepEqual(confirmados.map(c => c.ficheiro), ['bruto/2026-09-29T10.ndjson.gz'])
})
