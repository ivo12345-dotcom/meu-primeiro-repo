#!/usr/bin/env node
'use strict'
// A caixa a fingir: faz, no próprio portátil, de caixa 1 e de GPS, para ensaiar o sistema sem as placas.
//   porta 8765  as linhas que a caixa 1 mandaria pelo cabo USB (com o batimento e as tramas da caixa 2).
//               O plugin das caixas liga-se a ela com a porta "tcp://127.0.0.1:8765".
//   porta 8766  as frases de um GPS (RMC e GGA), para o SignalK ter posição e hora.
// As duas caixas dizem que fingem: o plugin marca tudo como simulado e a AI não aprende com isto.
// Só escuta no próprio portátil (127.0.0.1): não aparece na rede.
//
//   node caixa-a-fingir.js [--porta 8765] [--porta-gps 8766] [--sem-caixa2] [--sem-vento] [--lixo] [--parar-aos <s>]
//
//   --sem-caixa2   a caixa do motor calada: nem batimento nem tramas
//   --sem-vento    o mostrador do vento desligado
//   --lixo         de 5 em 5 s, uma linha de lixo e uma linha cortada a meio
//   --parar-aos N  ao fim de N segundos fecha a ligação da caixa e deixa de a aceitar (o cabo tirado)

const net = require('node:net')
const { criarGerador } = require('./lib/gerador')

const USO = 'uso: node caixa-a-fingir.js [--porta 8765] [--porta-gps 8766] [--sem-caixa2] [--sem-vento] [--lixo] [--parar-aos <s>]'

function argumentos (argv) {
  const o = { porta: 8765, portaGps: 8766, semCaixa2: false, semVento: false, lixo: false, pararAos: null }
  const numero = (texto, nome) => {
    const n = Number(texto)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${nome} pede um número maior do que zero`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sem-caixa2') o.semCaixa2 = true
    else if (a === '--sem-vento') o.semVento = true
    else if (a === '--lixo') o.lixo = true
    else if (a === '--porta') o.porta = numero(argv[++i], a)
    else if (a === '--porta-gps') o.portaGps = numero(argv[++i], a)
    else if (a === '--parar-aos') o.pararAos = numero(argv[++i], a)
    else throw new Error(`não conheço "${a}"`)
  }
  return o
}

// Um servidor que guarda as ligações abertas; mandar(texto) escreve a todas.
function servidor (porta, nome) {
  const ligacoes = new Set()
  const s = net.createServer((socket) => {
    ligacoes.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => ligacoes.delete(socket))
  })
  s.on('error', (erro) => {
    console.error(erro.code === 'EADDRINUSE' ? `A porta ${porta} (${nome}) já está ocupada: há outra caixa a fingir a correr?` : `${nome}: ${erro.message}`)
    process.exit(1)
  })
  s.listen(porta, '127.0.0.1')
  return {
    quantas: () => ligacoes.size,
    mandar (texto) { for (const l of ligacoes) l.write(texto) },
    fechar () {
      for (const l of ligacoes) l.destroy()
      s.close()
    }
  }
}

function correr (o) {
  const inicio = Date.now()
  const g = criarGerador({ inicio, semCaixa2: o.semCaixa2, semVento: o.semVento, lixo: o.lixo })
  let caixa = servidor(o.porta, 'caixa')
  const gps = servidor(o.portaGps, 'GPS')
  const c = g.cenario
  const plural = (n) => `${n} ${n === 1 ? 'ligação' : 'ligações'}`
  const pt = (n) => n.toFixed(1).replace('.', ',')
  console.log(`Caixa a fingir: tcp://127.0.0.1:${o.porta} (caixa) e 127.0.0.1:${o.portaGps} (GPS). Ctrl+C para parar.`)
  console.log(`  ${pt(c.nos)} nós na água · vento ${c.ventoAngulo}° a ${pt(c.ventoNos)} nós · proa ${c.proa}° · adornado ${c.adorno}° · motor desligado 1 min, a ${c.rpm} rpm 1 min` +
    `${o.semCaixa2 ? ' · SEM a caixa do motor' : ''}${o.semVento ? ' · SEM vento' : ''}${o.lixo ? ' · com lixo' : ''}`)
  let dito = 0
  const relogio = setInterval(() => {
    const ms = Date.now() - inicio
    const linhas = g.linhas(ms)
    if (caixa) {
      if (linhas.length) caixa.mandar(linhas.join('\n') + '\n')
      if (o.pararAos !== null && ms >= o.pararAos * 1000) {
        caixa.fechar()
        caixa = null
        console.log(`  aos ${o.pararAos} s: cabo da caixa tirado (o GPS continua)`)
      }
    }
    const frases = g.gps(ms)
    if (frases.length) gps.mandar(frases.join('\r\n') + '\r\n')
    const s = Math.floor(ms / 1000)
    if (s > dito) {
      dito = s
      const motor = o.semCaixa2 ? 'sem caixa do motor' : g.motorLigado(ms) ? `motor a ${c.rpm} rpm` : 'motor desligado'
      console.log(`  ${String(s).padStart(5)} s · caixa: ${caixa ? plural(caixa.quantas()) : 'cabo tirado'} · GPS: ${plural(gps.quantas())} · ${motor}`)
    }
  }, 100)
  const acabar = () => {
    clearInterval(relogio)
    if (caixa) caixa.fechar()
    gps.fechar()
  }
  process.on('SIGINT', () => { acabar(); process.exit(0) })
  return acabar
}

if (require.main === module) {
  let o
  try {
    o = argumentos(process.argv.slice(2))
  } catch (erro) {
    console.error(`${erro.message}\n${USO}`)
    process.exit(2)
  }
  correr(o)
}

module.exports = { argumentos, correr }
