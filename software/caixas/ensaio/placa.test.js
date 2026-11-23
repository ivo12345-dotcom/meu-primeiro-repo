'use strict'
// O placa.js sem placas, com uma porta série a fingir: o que tem de dizer quando a porta se perde.
// Revisão final das caixas (23/11/2026): os erros da porta eram engolidos, e o ensaio de resistência
// continuava a contar "tudo bem" com o cabo fora.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { abrir } = require('./placa')

function portaAFingir () {
  const criadas = []
  class Porta extends EventEmitter {
    constructor (opcoes) {
      super()
      this.opcoes = opcoes
      this.isOpen = false
      criadas.push(this)
    }

    open (cb) { setImmediate(() => { this.isOpen = true; cb(null) }) }
    flush (cb) { setImmediate(() => cb(null)) }
    write (dados, cb) { setImmediate(() => cb && cb(null)) }
    drain (cb) { setImmediate(() => cb && cb(null)) }
    close (cb) {
      this.isOpen = false
      setImmediate(() => {
        if (cb) cb(null)
        this.emit('close', null)
      })
    }
  }
  return { SerialPort: Porta, criadas }
}

const assentar = () => new Promise((resolve) => setTimeout(resolve, 20))

test('placa: quando o cabo sai, quem pediu para saber é avisado uma vez só, com o motivo', async () => {
  const f = portaAFingir()
  const placa = await abrir('COM99', { SerialPort: f.SerialPort })
  const motivos = []
  placa.aoFechar((motivo) => motivos.push(motivo))
  const s = f.criadas[0]
  s.isOpen = false
  s.emit('close', Object.assign(new Error('desligada'), { disconnected: true }))
  s.emit('error', new Error('mais um erro a seguir ao fecho'))
  await assentar()
  assert.deepEqual(motivos, ['o cabo USB saiu ou a placa desligou-se'])
})

test('placa: um erro da porta também avisa, com o que o sistema disse', async () => {
  const f = portaAFingir()
  const placa = await abrir('COM99', { SerialPort: f.SerialPort })
  const motivos = []
  placa.aoFechar((motivo) => motivos.push(motivo))
  f.criadas[0].emit('error', new Error('Reading from COM port: Access denied'))
  await assentar()
  assert.deepEqual(motivos, ['Reading from COM port: Access denied'])
})

test('placa: fechar a pedido não avisa ninguém, e as linhas continuam a chegar inteiras até lá', async () => {
  const f = portaAFingir()
  const placa = await abrir('COM99', { SerialPort: f.SerialPort })
  const motivos = []
  const linhas = []
  placa.aoFechar((motivo) => motivos.push(motivo))
  placa.ouvir((l) => linhas.push(l))
  f.criadas[0].emit('data', Buffer.from('$AQL,1,2,3*00\r\n$AQL,4,5'))
  f.criadas[0].emit('data', Buffer.from(',6*00\n'))
  await placa.fechar()
  await assentar()
  assert.deepEqual(linhas, ['$AQL,1,2,3*00', '$AQL,4,5,6*00'])
  assert.deepEqual(motivos, [])
})

// Revisão final das caixas (23/11/2026): a regra que deita fora as cópias da ponte USB (uma linha igual
// à anterior, chegada logo a seguir) apanhava também a resposta a um comando quando a resposta ao
// comando anterior era igual: o segundo comando ficava sem resposta e o ensaio falhava por engano.
test('placa: duas respostas iguais a dois comandos seguidos chegam as duas; as cópias de outras linhas não', async () => {
  const f = portaAFingir()
  const placa = await abrir('COM99', { SerialPort: f.SerialPort })
  const linhas = []
  placa.ouvir((l) => linhas.push(l))
  const s = f.criadas[0]
  s.emit('data', Buffer.from('$AQR,avalanche,fora-dos-limites*38\n'))
  s.emit('data', Buffer.from('$AQR,avalanche,fora-dos-limites*38\n'))
  s.emit('data', Buffer.from('$AQL,1,2,3*00\n$AQL,1,2,3*00\n$AQL,1,2,3*00\n'))
  await placa.fechar()
  assert.deepEqual(linhas, ['$AQR,avalanche,fora-dos-limites*38', '$AQR,avalanche,fora-dos-limites*38', '$AQL,1,2,3*00'])
  assert.equal(placa.repetidas, 2)
})
