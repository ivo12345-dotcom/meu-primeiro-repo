'use strict'
// Ensaio de resistência da caixa 1: fica a ouvir a placa durante o tempo que se pedir e conta o que
// pode correr mal no caminho até ao portátil, com o mesmo leitor que lê as linhas no barco.
//
//   node resistencia.js COM3 180                 3 horas, com os sinais a fingir da caixa ligados
//   node resistencia.js COM3 180 --sem-geradores 3 horas com o que a caixa tiver de verdade (o sensor)
//   node resistencia.js COM3 180 --registo <ficheiro>   guarda também as linhas de minuto a minuto
//
// Conta: linhas recebidas e as que o portátil não lê (estragadas no cabo); saltos no número de ordem
// do movimento; segundos sem batimento; recomeços da caixa; mudanças do estado do sensor e toques no
// recomeço dele; e o maior silêncio. De minuto a minuto diz como vai; no fim, o resumo.
const fs = require('node:fs')
const { abrir } = require('./placa')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const argumentos = process.argv.slice(2)
const porta = argumentos[0]
const minutos = Number(argumentos[1])
const semGeradores = argumentos.includes('--sem-geradores')
const iRegisto = argumentos.indexOf('--registo')
const registo = iRegisto >= 0 ? argumentos[iRegisto + 1] : null
if (!porta || !(minutos > 0)) {
  console.error('uso: node resistencia.js <porta> <minutos> [--sem-geradores] [--registo <ficheiro>]')
  process.exit(2)
}

const hora = () => new Date().toLocaleTimeString('pt-PT')
const escreve = (texto) => {
  console.log(texto)
  if (registo) fs.appendFileSync(registo, texto + '\n')
}

async function principal () {
  const p = await abrir(porta)
  if (!semGeradores) {
    for (const [nome, ...valores] of [['parar'], ['log', 26], ['vento', 350, 140], ['movimento', 1]]) {
      const r = await p.manda(nome, ...valores)
      if (r !== 'ok') throw new Error(`a caixa respondeu "${r}" ao comando ${nome}`)
    }
  }
  const c = {
    linhas: 0, estragadas: 0, batimentos: 0, log: 0, vento: 0, movimento: 0, motor: 0,
    saltosDoMovimento: 0, leiturasEmFalta: 0, segundosSemBatimento: 0, recomecos: 0,
    mudancasDoSensor: 0, toquesNoRst: 0, maiorSilencioMs: 0
  }
  const exemplos = [] // as primeiras linhas estragadas, para se ver de que tipo são
  let ultimaLinha = Date.now()
  let ultimoBatimento = null // { ms, hora, sensor, rsts }
  let ultimoN = null
  const inicio = Date.now()
  escreve(`# ${hora()} ensaio de resistência em ${porta}, ${minutos} min${semGeradores ? ', sem geradores' : ', com os sinais a fingir ligados'}`)

  const parar = p.ouvir((linha) => {
      {
        const agora = Date.now()
        c.maiorSilencioMs = Math.max(c.maiorSilencioMs, agora - ultimaLinha)
        ultimaLinha = agora
        c.linhas++
        if (linha.startsWith('$AQR,')) return // respostas a comandos: não são do contrato com o portátil
        const l = ler(linha)
        if (!l) {
          c.estragadas++
          if (exemplos.length < 10) exemplos.push(linha.slice(0, 120))
          return
        }
        if (l.tipo === 'batimento' && l.caixa === 1) {
          c.batimentos++
          if (ultimoBatimento) {
            if (l.ms < ultimoBatimento.ms) c.recomecos++
            else if (l.ms - ultimoBatimento.ms > 1500) c.segundosSemBatimento += Math.round((l.ms - ultimoBatimento.ms) / 1000) - 1
            if (l.sensor !== ultimoBatimento.sensor) c.mudancasDoSensor++
            if (Number.isInteger(l.rsts) && Number.isInteger(ultimoBatimento.rsts) && l.rsts > ultimoBatimento.rsts) c.toquesNoRst += l.rsts - ultimoBatimento.rsts
          }
          ultimoBatimento = { ms: l.ms, sensor: l.sensor, rsts: l.rsts }
        } else if (l.tipo === 'log') {
          c.log++
        } else if (l.tipo === 'vento') {
          c.vento++
        } else if (l.tipo === 'motor') {
          c.motor++
        } else if (l.tipo === 'movimento') {
          c.movimento++
          if (ultimoN !== null && l.n > ultimoN + 1) {
            c.saltosDoMovimento++
            c.leiturasEmFalta += l.n - ultimoN - 1
          }
          ultimoN = l.n
        }
      }
  })

  const resumo = () => `${c.linhas} linhas · ${c.estragadas} estragadas · movimento ${c.movimento} (${c.leiturasEmFalta} em falta) · ` +
    `${c.segundosSemBatimento} s sem batimento · ${c.recomecos} recomeços · sensor: ${c.mudancasDoSensor} mudanças, ${c.toquesNoRst} toques · maior silêncio ${c.maiorSilencioMs} ms`
  for (let minuto = 1; minuto <= minutos; minuto++) {
    await new Promise((resolve) => setTimeout(resolve, 60000))
    escreve(`${hora()} ${String(minuto).padStart(4)} min · ${resumo()}`)
  }
  parar()
  if (!semGeradores) await p.manda('parar').catch(() => {})
  await p.fechar()

  const segundos = Math.round((Date.now() - inicio) / 1000)
  escreve(`# ${hora()} fim: ${segundos} s · ${resumo()}`)
  escreve(`# linhas estragadas: ${c.estragadas} em ${c.linhas} (${c.linhas ? (100 * c.estragadas / c.linhas).toFixed(4) : '0'} %)`)
  for (const e of exemplos) escreve(`#   estragada: ${JSON.stringify(e)}`)
  escreve(`# por tipo: batimento ${c.batimentos} · log ${c.log} · vento ${c.vento} · movimento ${c.movimento} · motor ${c.motor}`)
  const limpo = c.estragadas === 0 && c.leiturasEmFalta === 0 && c.segundosSemBatimento === 0 && c.recomecos === 0
  escreve(`# ${limpo ? 'LIMPO' : 'COM FALHAS'}`)
  process.exit(limpo ? 0 : 1)
}

principal().catch((erro) => { console.error(erro.message); process.exit(2) })
