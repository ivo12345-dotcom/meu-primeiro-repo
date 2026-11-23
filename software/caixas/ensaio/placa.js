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
    // Ao abrir, a porta pode trazer o fim de uma linha que já ia a meio. Nos primeiros 40 ms deita-se
    // tudo fora; se nessa altura se ficou a meio de uma linha, deita-se fora também o resto dela. Daí em
    // diante todas as linhas são inteiras, a primeira incluída (pode ser a resposta a um comando).
    let acertada = false
    let aMeio = false
    s.on('data', (bocado) => {
      let texto = bocado.toString('latin1')
      if (!acertada) {
        aMeio = !texto.endsWith('\n')
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
      for (const parte of partes) {
        const linha = parte.endsWith('\r') ? parte.slice(0, -1) : parte
        if (linha.length === 0) continue
        for (const o of [...ouvintes]) o(linha)
      }
    })
    s.on('error', () => {})

    const placa = {
      porta,
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
        return new Promise((feito) => (s.isOpen ? s.close(() => feito()) : feito()))
      }
    }
    s.open((erro) => {
      if (erro) return reject(new Error(`${porta} não abre: ${erro.message}`))
      s.flush(() => setTimeout(() => { acertada = true; resolve(placa) }, 40))
    })
  })
}

module.exports = { abrir, comPlaca, comando, espera }
