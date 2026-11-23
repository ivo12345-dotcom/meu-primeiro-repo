'use strict'
// Fala com uma caixa verdadeira pela porta USB, para os ensaios com as placas ligadas.
// Abre a porta como o plugin das caixas a abre no barco (460 800 baud, sem reiniciar a placa), junta os
// bytes em linhas inteiras e manda os comandos $AQC com a soma. A biblioteca da porta série é a do
// servidor SignalK do software/dev: aqui não há dependências.
const path = require('node:path')
const { pedirSerialport } = require('../../signalk-arlequin-caixas/lib/fonte')
const { soma, BAUD, MAX_LINHA } = require('../../signalk-arlequin-caixas/lib/linhas')

// Para ensaiar outra velocidade na porta (com a placa compilada para ela): ARLEQUIN_BAUD=230400
const VELOCIDADE = Number(process.env.ARLEQUIN_BAUD) || BAUD

const RESPOSTA = /^\$(AQR,([^,*]+),([^*]*))\*([0-9A-Fa-f]{2})$/

// A porta de uma placa, dada por uma variável de ambiente (ARLEQUIN_CAIXA1=COM3), ou null.
function comPlaca (nome) {
  const v = process.env[nome]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// O comando como vai no fio: $AQC,<comando>[,<valores>]*HH
function comando (nome, ...valores) {
  const corpo = ['AQC', nome, ...valores].join(',')
  return `$${corpo}*${soma(corpo)}`
}

// deps (só para os ensaios sem placas): { SerialPort }.
function abrir (porta, deps = {}) {
  const SerialPort = deps.SerialPort || pedirSerialport([path.join(__dirname, '..', '..', 'dev')]).SerialPort
  return new Promise((resolve, reject) => {
    // hupcl: false deixa as duas linhas de comando em repouso: abrir a porta não reinicia a placa
    const s = new SerialPort({ path: porta, baudRate: VELOCIDADE, autoOpen: false, hupcl: false })
    const ouvintes = new Set()
    const aoFechar = new Set() // quem quer saber que a porta se perdeu
    let pedida = false // fomos nós a fechá-la
    let perdida = false
    // A porta perdeu-se sem ninguém pedir (o cabo saiu, a placa desligou-se, um erro do sistema): diz-se
    // uma vez só, com o motivo. Sem isto, quem estivesse a contar linhas ficava a contar "nada de mal".
    const perdeu = (motivo) => {
      if (pedida || perdida) return
      perdida = true
      for (const f of [...aoFechar]) f(motivo)
    }
    let resto = ''
    // Ao abrir, a porta pode trazer duas coisas que não são da caixa agora:
    //   - o fim de uma linha que já ia a meio;
    //   - uma enxurrada da ponte USB da placa. Visto a 23/11/2026 neste portátil, com as duas bibliotecas
    //     (esta e o pyserial): depois de a porta estar fechada uns segundos com a caixa a mandar poucas
    //     linhas, a abertura entrega até 200 KB de cópias das últimas linhas, tudo no primeiro segundo e
    //     mais depressa do que o fio consegue levar. Daí em diante vem limpo.
    // Por isso deita-se fora tudo até a linha sossegar (15 ms sem um byte, com 40 ms no mínimo e 1,5 s no
    // máximo); se nessa altura se ficou a meio de uma linha, deita-se fora também o resto dela. Daí em
    // diante todas as linhas são inteiras, a primeira incluída (pode ser a resposta a um comando).
    let acertada = false
    let aMeio = false
    let ultimoBocado = 0
    let ultimaLinha = null
    let horaDaUltima = 0
    s.on('data', (bocado) => {
      let texto = bocado.toString('latin1')
      if (!acertada) {
        aMeio = !texto.endsWith('\n')
        ultimoBocado = Date.now()
        return
      }
      if (aMeio) {
        const fim = texto.indexOf('\n')
        if (fim === -1) return
        texto = texto.slice(fim + 1)
        aMeio = false
      }
      const partes = (resto + texto).split('\n')
      resto = partes.pop()
      if (resto.length > 4 * MAX_LINHA) resto = ''
      const agora = Date.now()
      for (const parte of partes) {
        const linha = parte.endsWith('\r') ? parte.slice(0, -1) : parte
        if (linha.length === 0) continue
        // A enxurrada da ponte USB (ver acima) pode começar depois de a linha parecer sossegada: uma
        // linha igual à anterior, chegada menos de 20 ms depois dela, é cópia e não se conta. A caixa
        // nunca manda duas linhas iguais tão juntas, a não ser as respostas a dois comandos seguidos
        // com o mesmo resultado ($AQR): essas passam sempre (uma resposta repetida não faz mal a ninguém).
        if (linha === ultimaLinha && agora - horaDaUltima < 20 && !linha.startsWith('$AQR,')) {
          horaDaUltima = agora
          placa.repetidas++
          continue
        }
        ultimaLinha = linha
        horaDaUltima = agora
        for (const o of [...ouvintes]) o(linha)
      }
    })
    s.on('error', (erro) => perdeu(erro && erro.message ? erro.message : 'erro da porta'))
    s.on('close', (erro) => perdeu(erro && erro.disconnected ? 'o cabo USB saiu ou a placa desligou-se' : 'a porta fechou'))

    const placa = {
      porta,
      repetidas: 0, // cópias deitadas fora (a enxurrada da ponte USB)
      // Chama aoPerder(motivo), uma vez, se a porta se perder sem ser a pedido. Devolve a função que desiste.
      aoFechar (aoPerder) {
        aoFechar.add(aoPerder)
        return () => aoFechar.delete(aoPerder)
      },
      // Chama aoLinha(linha) por cada linha inteira, à medida que chegam. Devolve a função que para.
      ouvir (aoLinha) {
        ouvintes.add(aoLinha)
        return () => ouvintes.delete(aoLinha)
      },
      // As linhas inteiras recebidas nos próximos ms.
      linhas (ms) {
        return new Promise((feito) => {
          const juntas = []
          const o = (l) => juntas.push(l)
          ouvintes.add(o)
          setTimeout(() => { ouvintes.delete(o); feito(juntas) }, ms)
        })
      },
      // A primeira linha que servir (o que a função devolver, se não for falso), ou um erro ao fim de ms.
      ate (serve, ms, oQue = 'a linha esperada') {
        return new Promise((feito, falhou) => {
          const o = (l) => {
            const r = serve(l)
            if (!r) return
            clearTimeout(prazo)
            ouvintes.delete(o)
            feito(r)
          }
          const prazo = setTimeout(() => { ouvintes.delete(o); falhou(new Error(`${porta}: ${ms} ms sem ${oQue}`)) }, ms)
          ouvintes.add(o)
        })
      },
      // Bytes em bruto, tal e qual.
      escreve (dados) {
        return new Promise((feito, falhou) => s.write(dados, (erro) => (erro ? falhou(erro) : s.drain(() => feito()))))
      },
      // Manda um comando de ensaio e devolve o resultado que a caixa respondeu ("ok", ou o motivo da recusa).
      async manda (nome, ...valores) {
        const resposta = placa.ate((l) => {
          const m = RESPOSTA.exec(l)
          return m && m[2] === nome && soma(m[1]) === m[4].toUpperCase() ? { resultado: m[3] } : null
        }, 2000, `a resposta ao comando "${nome}"`)
        await placa.escreve(comando(nome, ...valores) + '\n')
        return (await resposta).resultado
      },
      fechar () {
        pedida = true
        return new Promise((feito) => (s.isOpen ? s.close(() => feito()) : feito()))
      }
    }
    s.open((erro) => {
      if (erro) return reject(new Error(`${porta} não abre: ${erro.message}`))
      s.flush(() => {
        const aberta = Date.now()
        const relogio = setInterval(() => {
          const agora = Date.now()
          const sossegada = agora - aberta >= 40 && agora - ultimoBocado >= 15
          if (!sossegada && agora - aberta < 1500) return
          clearInterval(relogio)
          acertada = true
          resolve(placa)
        }, 5)
      })
    })
  })
}

module.exports = { abrir, comPlaca, comando, espera }
