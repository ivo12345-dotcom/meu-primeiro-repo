'use strict'
// Fala com uma caixa verdadeira pela porta USB, para os ensaios com as placas ligadas.
// Abre a porta como o plugin das caixas a abre no barco (460 800 baud, sem reiniciar a placa), junta os
// bytes em linhas inteiras e manda os comandos $AQC com a soma. A biblioteca da porta série é a do
// servidor SignalK do software/dev: aqui não há dependências.
const path = require('node:path')
const { pedirSerialport } = require('../../signalk-arlequin-caixas/lib/fonte')
const { soma, BAUD, MAX_LINHA } = require('../../signalk-arlequin-caixas/lib/linhas')

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

function abrir (porta) {
  const { SerialPort } = pedirSerialport([path.join(__dirname, '..', '..', 'dev')])
  return new Promise((resolve, reject) => {
    // hupcl: false deixa as duas linhas de comando em repouso: abrir a porta não reinicia a placa
    const s = new SerialPort({ path: porta, baudRate: BAUD, autoOpen: false, hupcl: false })
    const ouvintes = new Set()
    let resto = ''
    let primeira = true // o primeiro bocado pode começar a meio de uma linha: deita-se fora
    s.on('data', (bocado) => {
      const partes = (resto + bocado.toString('latin1')).split('\n')
      resto = partes.pop()
      if (resto.length > 4 * MAX_LINHA) resto = ''
      for (const parte of partes) {
        if (primeira) { primeira = false; continue }
        const linha = parte.endsWith('\r') ? parte.slice(0, -1) : parte
        if (linha.length === 0) continue
        for (const o of [...ouvintes]) o(linha)
      }
    })
    s.on('error', () => {})

    const placa = {
      porta,
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
        return new Promise((feito) => (s.isOpen ? s.close(() => feito()) : feito()))
      }
    }
    s.open((erro) => (erro ? reject(new Error(`${porta} não abre: ${erro.message}`)) : resolve(placa)))
  })
}

module.exports = { abrir, comPlaca, comando, espera }
