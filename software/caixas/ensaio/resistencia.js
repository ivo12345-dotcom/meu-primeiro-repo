'use strict'
// Ensaio de resistência das caixas: fica a ouvir a caixa 1 durante o tempo que se pedir e conta o que
// pode correr mal no caminho até ao portátil, com o mesmo leitor que lê as linhas no barco.
//
//   node resistencia.js COM3 180                  3 horas, com os sinais a fingir da caixa 1 ligados
//   node resistencia.js COM3 60 --caixa2 COM5     1 hora com as duas: liga também o motor a fingir da caixa 2
//   node resistencia.js COM3 180 --sem-geradores  3 horas com o que a caixa tiver de verdade (o sensor)
//   node resistencia.js COM3 180 --duas           exige o sinal da caixa 2 (sem lhe mexer)
//   ... --registo <ficheiro>                       guarda também o que escreve, de minuto a minuto
//
// ATENÇÃO: os sinais a fingir fazem a caixa escrever nos próprios pinos de entrada (o do log e o do
// vento). Só na bancada, com esses dois fios soltos; no barco, com a roda do log ou o mostrador do vento
// ligados, usar sempre --sem-geradores.
//
// As contas e o que conta como falha estão no contador.js. De minuto a minuto diz como vai; no fim, o
// resumo e LIMPO ou COM FALHAS (e sai com 0 ou 1). Se a porta se perder a meio, acaba logo, com falhas.
const fs = require('node:fs')
const { abrir, espera } = require('./placa')
const { novoContador } = require('./contador')

const argumentos = process.argv.slice(2)
const porta = argumentos[0]
const minutos = Number(argumentos[1])
const semGeradores = argumentos.includes('--sem-geradores')
const depoisDe = (nome) => { const i = argumentos.indexOf(nome); return i >= 0 ? argumentos[i + 1] : null }
const registo = depoisDe('--registo')
const portaDa2 = depoisDe('--caixa2')
const duas = argumentos.includes('--duas') || Boolean(portaDa2)
if (!porta || !(minutos > 0) || (argumentos.includes('--caixa2') && !portaDa2) || (argumentos.includes('--registo') && !registo)) {
  console.error('uso: node resistencia.js <porta da caixa 1> <minutos> [--sem-geradores] [--duas] [--caixa2 <porta>] [--registo <ficheiro>]')
  process.exit(2)
}

const hora = () => new Date().toLocaleTimeString('pt-PT')
const escreve = (texto) => {
  console.log(texto)
  if (registo) fs.appendFileSync(registo, texto + '\n')
}

async function mandar (p, nome, ...valores) {
  const r = await p.manda(nome, ...valores)
  if (r !== 'ok') throw new Error(`a caixa em ${p.porta} respondeu "${r}" ao comando ${nome}`)
}

// A caixa 2 só se abre para lhe dar uma ordem (ligar ou parar o motor a fingir): o que ela manda vem
// pelo rádio, pela porta da caixa 1.
async function ordemA2 (nome, ...valores) {
  const p2 = await abrir(portaDa2)
  try {
    await mandar(p2, nome, ...valores)
  } finally {
    await p2.fechar()
  }
}

async function principal () {
  const p = await abrir(porta)
  const motorAFingir = Boolean(portaDa2) && !semGeradores
  if (!semGeradores) {
    for (const [nome, ...valores] of [['parar'], ['log', 26], ['vento', 350, 140], ['movimento', 1]]) await mandar(p, nome, ...valores)
    if (motorAFingir) await ordemA2('motor', 2100)
  }
  const c = novoContador({ duasCaixas: duas })
  const inicio = Date.now()
  escreve(`# ${hora()} ensaio de resistência em ${porta}, ${minutos} min` +
    (semGeradores ? ', sem geradores' : ', com os sinais a fingir ligados (só na bancada, com os fios do log e do vento soltos)') +
    (duas ? `, com a caixa 2${motorAFingir ? ` (motor a fingir, ligado por ${portaDa2})` : ''}` : ''))

  let perdeu = null
  const perdida = new Promise((resolve) => { perdeu = resolve })
  p.aoFechar((motivo) => {
    c.fechou(motivo)
    perdeu('perdida')
  })
  const parar = p.ouvir((linha) => c.linha(linha))
  const relogio = setInterval(() => {
    c.repetidas(p.repetidas)
    c.tique()
  }, 1000)

  for (let minuto = 1; minuto <= minutos; minuto++) {
    if (await Promise.race([espera(60000), perdida]) === 'perdida') break
    escreve(`${hora()} ${String(minuto).padStart(4)} min · ${c.resumo()}`)
  }
  clearInterval(relogio)
  c.repetidas(p.repetidas)
  // o resumo e o veredicto tiram-se já, antes de parar os sinais: o que conta é o que se viu no ensaio
  const segundos = Math.round((Date.now() - inicio) / 1000)
  const resumoFinal = c.resumo()
  const v = c.veredicto()
  parar()
  if (!c.c.portaFechou && !semGeradores) await p.manda('parar').catch(() => {})
  await p.fechar()
  if (motorAFingir) await ordemA2('parar').catch((erro) => escreve(`# a caixa 2 ficou com o motor a fingir ligado: ${erro.message}`))

  const falhas = [...v.falhas]
  if (motorAFingir && c.c.motor === 0) falhas.push('nenhuma trama do motor chegou pelo rádio')
  escreve(`# ${hora()} fim: ${segundos} s · ${resumoFinal}`)
  escreve(`# linhas estragadas: ${c.c.estragadas} em ${c.c.linhas} (${c.c.linhas ? (100 * c.c.estragadas / c.c.linhas).toFixed(4) : '0'} %)`)
  for (const e of c.exemplos) escreve(`#   estragada: ${JSON.stringify(e)}`)
  escreve(`# por tipo: batimento da caixa 1 ${c.c.batimentos} · da caixa 2 ${c.c.batimentos2} · log ${c.c.log} · vento ${c.c.vento} · movimento ${c.c.movimento} · motor ${c.c.motor}`)
  for (const f of falhas) escreve(`#   falha: ${f}`)
  escreve(`# ${falhas.length === 0 ? 'LIMPO' : 'COM FALHAS'}`)
  process.exit(falhas.length === 0 ? 0 : 1)
}

principal().catch((erro) => { console.error(erro.message); process.exit(2) })
