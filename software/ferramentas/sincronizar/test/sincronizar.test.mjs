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
// Uma pasta local a fazer de Pi por ssh (que pode confirmar); uma pen não confirma.
const comoPi = (origem) => transporteLocal(origem, { podeConfirmar: true })

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
  const r = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA })
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
  const r2 = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA })
  assert.equal(r2.copiados, 0)
  assert.equal(r2.confirmados, 0)
  assert.equal(existsSync(path.join(destino, '.confirmados.json')), false, 'o registo é o confirmados.json do Pi, não um do portátil')
  // a hora atual cresceu e a hora fechou: copia de novo e confirma
  appendFileSync(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz'), ' e mais')
  const r3 = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA + 3600000 })
  assert.equal(r3.copiados, 1)
  assert.equal(r3.confirmados, 1)
  assert.equal(sha256(path.join(destino, 'bruto', '2026-09-29T14.ndjson.gz')), sha256(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz')))
})

test('hash diferente: não confirma e avisa', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const t = comoPi(origem)
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
  assert.equal(t.podeConfirmar, true)
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

test('ssh: lê o confirmados.json do próprio Pi (sem ficheiro ou estragado → vazio)', async () => {
  let resposta = '{"bruto/2026-09-29T10.ndjson.gz":"abc"}\n'
  const chamadas = []
  const exec = async (cmd, args) => { chamadas.push(args[1]); return resposta }
  const t = transporteSsh('pi@arlequin', { exec })
  assert.deepEqual(await t.lerConfirmados(), { 'bruto/2026-09-29T10.ndjson.gz': 'abc' })
  assert.equal(chamadas[0], 'cat ~/arlequin-dados/confirmados.json 2>/dev/null || echo {}')
  resposta = '{}\n'
  assert.deepEqual(await t.lerConfirmados(), {})
  resposta = '{estragado'
  assert.deepEqual(await t.lerConfirmados(), {})
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
  const r = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA })
  assert.equal(r.copiados, 3) // T14 e tabela (tamanho diferente) + T10 reparado (recopiado na passagem de reparação)
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
  const r = await sincronizar({ transporte: comoPi(origem), destino, agora })
  assert.equal(r.confirmados, 1) // só a T10 (fechada); a T14, mesmo já "no passado" à hora do relógio, tem 10 min de margem
  const [nome] = readdirSync(path.join(origem, 'entrada'))
  const confirmados = JSON.parse(readFileSync(path.join(origem, 'entrada', nome), 'utf8'))
  assert.deepEqual(confirmados.map(c => c.ficheiro), ['bruto/2026-09-29T10.ndjson.gz'])
})

test('a confirmação só conta quando o Pi a aceita: se a lista ficou por processar, volta a enviar', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const r1 = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA })
  assert.equal(r1.confirmados, 1)
  // O Pi ainda não leu a entrada (desligado, plugin parado…): o confirmados.json dele continua vazio.
  const r2 = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA + 60000 })
  assert.equal(r2.confirmados, 1, 'volta a mandar, porque o Pi ainda não confirmou')
  assert.equal(readdirSync(path.join(origem, 'entrada')).length, 2)
  // Agora o Pi processa: aceita (as duas listas iguais não fazem mal) e deixa de ser preciso mandar.
  assert.deepEqual(confirmados.processarEntrada(origem).aceites, ['bruto/2026-09-29T10.ndjson.gz', 'bruto/2026-09-29T10.ndjson.gz'])
  const r3 = await sincronizar({ transporte: comoPi(origem), destino, agora: AGORA + 120000 })
  assert.equal(r3.confirmados, 0)
})

test('pela pen (pasta local): copia, mas nunca escreve confirmações (não chegavam ao Pi)', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const t = transporteLocal(origem)
  assert.equal(t.podeConfirmar, false)
  const r = await sincronizar({ transporte: t, destino, agora: AGORA })
  assert.equal(r.copiados, 3)
  assert.equal(r.confirmados, 0)
  assert.equal(r.semConfirmar, true)
  assert.deepEqual(readdirSync(path.join(origem, 'entrada')), [])
  assert.equal(readFileSync(path.join(destino, 'bruto', '2026-09-29T10.ndjson.gz'), 'utf8'), 'dez')
})

test('local: lerConfirmados lê o confirmados.json da origem (sem ficheiro → vazio)', async () => {
  const origem = pi()
  writeFileSync(path.join(origem, 'confirmados.json'), '{"bruto/2026-09-29T10.ndjson.gz":"h"}')
  assert.deepEqual(await transporteLocal(origem).lerConfirmados(), { 'bruto/2026-09-29T10.ndjson.gz': 'h' })
  const vazia = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pi-'))
  assert.deepEqual(await transporteLocal(vazia).lerConfirmados(), {})
})
