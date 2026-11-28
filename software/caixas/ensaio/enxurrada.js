'use strict'
// Uma enxurrada de ordens para uma caixa, para os ensaios das duas (passo 7 da Tarefa 7, 27/11/2026).
//
// Um portátil a mandar ordens sem parar (um programa avariado, outro programa na porta errada) não pode
// atrasar o ciclo da caixa nem pô-la a deitar fora as medições para lhe responder. Sem limite, a caixa
// obedecia a todas (uns milhares por segundo) e as respostas enchiam a saída: o batimento, o log e o
// movimento deixavam de caber e iam para a conta das linhas perdidas. Com o limite (AqOrdens, em
// comum/src/arlequin_linhas.h) lê no máximo 96 bytes de ordens em cada volta do ciclo e, depois de
// obedecer a uma, só volta a ler passados 10 ms: no máximo 100 respostas por segundo, menos de metade do
// que o cabo leva. O que chegar entretanto espera na memória da porta; numa enxurrada não cabe lá e
// perde-se, que é o que se quer.
const { comando, espera } = require('./placa')

// Manda à placa p (aberta com o abrir() do placa.js) a ordem "estado" sem parar durante ms, o mais
// depressa que a porta levar, e dá-lhe depois um segundo e meio para despachar o que tiver à espera.
// Devolve quantas ordens mandou e as linhas que a placa escreveu desde o princípio.
async function enxurrada (p, ms = 3000) {
  const vistas = []
  const parar = p.ouvir((l) => vistas.push(l))
  try {
    const bocado = Buffer.from((comando('estado') + '\n').repeat(256))
    const fim = Date.now() + ms
    let mandadas = 0
    while (Date.now() < fim) {
      await p.escreve(bocado)
      mandadas += 256
    }
    await espera(1500)
    return { mandadas, vistas }
  } finally {
    parar()
  }
}

// As respostas à ordem "estado" que a placa chegou a dar.
const respostas = (vistas) => vistas.filter(l => l.startsWith('$AQR,estado,')).length

module.exports = { enxurrada, respostas }
