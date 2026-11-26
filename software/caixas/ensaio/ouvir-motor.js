'use strict'
// A escuta do motor, no barco: mostra no portátil o que a caixa 2 ouve na linha do motor.
//
// As tramas chegam pelo caminho de sempre (caixa 2 → rádio → caixa 1 → USB), por isso a porta é a da
// caixa 1. De 5 em 5 segundos diz como está: o sinal da caixa 2, quantas tramas chegaram e os valores
// que já sabemos ler (rotações, água, tensão, horas). No fim escreve a tabela de todos os tipos de
// trama que apareceram, os que conhecemos e os que não.
//
//   node ensaio/ouvir-motor.js COM5                 um minuto
//   node ensaio/ouvir-motor.js COM5 300             cinco minutos (0 = até se carregar em Ctrl+C)
//   ... --registo <ficheiro>                         guarda também todas as linhas, tal como chegam
//
// NÃO MANDA NADA a nenhuma caixa: só ouve. Pode correr com o motor a trabalhar.
// O ecrã do barco não pode estar a usar a mesma porta ao mesmo tempo.
const fs = require('node:fs')
const { abrir } = require('./placa')
const { novoCenso } = require('./censo')

const argumentos = process.argv.slice(2)
const porta = argumentos[0]
const iRegisto = argumentos.indexOf('--registo')
const registo = iRegisto >= 0 ? argumentos[iRegisto + 1] : null
const segundos = argumentos[1] !== undefined && argumentos[1] !== '--registo' ? Number(argumentos[1]) : 60
if (!porta || porta.startsWith('--') || !(segundos >= 0) || (iRegisto >= 0 && !registo)) {
  console.error('uso: node ensaio/ouvir-motor.js <porta da caixa 1> [segundos] [--registo <ficheiro>]')
  process.exit(2)
}

const dois = (n, casas = 2) => String(n).padStart(casas, '0')
function hora () {
  const d = new Date()
  return `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`
}

async function principal () {
  const p = await abrir(porta)
  const censo = novoCenso()
  const saida = registo ? fs.createWriteStream(registo, { flags: 'a' }) : null
  let acabou = false

  const parar = p.ouvir((linha) => {
    censo.linha(linha)
    if (saida) saida.write(`${hora()}.${dois(new Date().getMilliseconds(), 3)} ${linha}\n`)
  })
  const relogio = setInterval(() => console.log(`${hora()}  ${censo.resumo()}`), 5000)

  async function fim (codigo, motivo) {
    if (acabou) return
    acabou = true
    clearInterval(relogio)
    parar()
    if (motivo) console.log(motivo)
    console.log(`${hora()}  ${censo.resumo()}`)
    const tabela = censo.tabela()
    console.log(tabela.length ? '\nO que a caixa 2 ouviu, por tipo de trama:' : '\nA caixa 2 não ouviu nenhuma trama do motor.')
    for (const l of tabela) console.log('  ' + l)
    if (saida) await new Promise((feito) => saida.end(feito))
    await p.fechar()
    process.exit(codigo)
  }

  p.aoFechar((motivo) => fim(1, `a porta ${porta} perdeu-se: ${motivo}`))
  process.on('SIGINT', () => fim(0))
  console.log(`${hora()}  a ouvir a caixa 1 em ${porta}${segundos > 0 ? ` durante ${segundos} s` : ' (Ctrl+C para acabar)'}${registo ? `, com registo em ${registo}` : ''}`)
  if (segundos > 0) setTimeout(() => fim(0), segundos * 1000)
}

principal().catch((erro) => {
  console.error('erro:', erro.message)
  process.exit(1)
})
