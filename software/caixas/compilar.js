'use strict'
// Compila (e grava) o programa de uma das caixas com o arduino-cli.
//   node compilar.js 1                 compila a caixa 1
//   node compilar.js 1 --gravar COM3   compila e grava na placa que está nessa porta
//   node compilar.js 1 --baud 230400 --gravar COM3   o mesmo, com outra velocidade na porta USB (só para
//                                      ensaios: a do portátil está em signalk-arlequin-caixas/lib/linhas.js)
// A pasta de compilação fica fora do projeto, na pasta temporária do sistema; a primeira vez de cada
// caixa demora uns minutos. A biblioteca partilhada pelas duas caixas é a pasta "comum".
// O arduino-cli procura-se na variável ARDUINO_CLI, depois no caminho do sistema, depois em
// %LOCALAPPDATA%\Programs\arduino-cli.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PLACA = 'esp32:esp32:esp32doit-devkit-v1'

function arduinoCli () {
  const candidatos = [
    process.env.ARDUINO_CLI,
    'arduino-cli',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'arduino-cli', 'arduino-cli.exe')
  ].filter(Boolean)
  for (const c of candidatos) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8' })
    if (!r.error && r.status === 0) return c
  }
  throw new Error(`não encontro o arduino-cli (procurado em: ${candidatos.join('; ')})`)
}

function correr (cli, argumentos) {
  const r = spawnSync(cli, argumentos, { stdio: 'inherit', cwd: __dirname })
  if (r.error) throw r.error
  if (r.status !== 0) process.exit(r.status || 1)
}

function principal (argv) {
  const caixa = argv[0]
  if (caixa !== '1' && caixa !== '2') {
    console.error('uso: node compilar.js <1|2> [--gravar <porta>]')
    process.exit(2)
  }
  const gravar = argv.indexOf('--gravar')
  const porta = gravar >= 0 ? argv[gravar + 1] : null
  if (gravar >= 0 && !porta) {
    console.error('falta a porta: node compilar.js ' + caixa + ' --gravar COM3')
    process.exit(2)
  }
  const iBaud = argv.indexOf('--baud')
  const baud = iBaud >= 0 ? Number(argv[iBaud + 1]) : null
  if (iBaud >= 0 && !(Number.isInteger(baud) && baud >= 9600 && baud <= 921600)) {
    console.error('a velocidade tem de ser um número entre 9600 e 921600')
    process.exit(2)
  }
  const programa = `caixa${caixa}`
  // cada velocidade de ensaio tem a sua pasta de compilação, para não misturar com a do barco
  const pasta = path.join(os.tmpdir(), 'arlequin-caixas', baud ? `${programa}-${baud}` : programa)
  fs.mkdirSync(pasta, { recursive: true })
  const cli = arduinoCli()
  const opcoes = baud ? ['--build-property', `compiler.cpp.extra_flags=-DAQ_BAUD=${baud}UL`] : []
  correr(cli, ['compile', '--fqbn', PLACA, '--library', 'comum', ...opcoes, '--build-path', pasta, programa])
  if (porta) correr(cli, ['upload', '--fqbn', PLACA, '--input-dir', pasta, '-p', porta, programa])
}

principal(process.argv.slice(2))
