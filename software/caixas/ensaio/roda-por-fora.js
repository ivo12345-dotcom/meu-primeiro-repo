'use strict'
// Ensaio da entrada da roda do log, em casa, só com a caixa 1, a plaquinha e o portátil.
//   node ensaio/roda-por-fora.js <porta da caixa 1> [segundos por fase, 20 por omissão]
//
// A caixa 1 faz de roda: o pino D26 fica em cima enquanto a roda estaria fechada e solto enquanto estaria
// aberta, uma vez por volta. O sinal entra na plaquinha pelo fio da roda do lado do D27 e chega ao pino
// do log pelo caminho verdadeiro: sobe depressa e desce devagar (10 kΩ e 100 nF). Ligações
// (docs/caixas/caixa1-fila-montagem.jpg), com o cabo USB fora:
//   fio RODA do furo Q9 -> pino D26 (fila do VIN, o 7.º a contar da ficha USB)
//   fio do D27 (furo W9) -> pino D27 (o 6.º)      verde sem fita -> GND      verde com fita -> 3V3
//   o outro fio da RODA (furo T7) fica solto
// Seis fases: devagar, depressa, e as duas últimas com o contacto a ressaltar ao abrir (essas pedem o
// programa 0.3.4 ou mais novo). Cada uma passa se a caixa contar exatamente as voltas que a roda deu; nas
// do ressalto, também se os ressaltos chegaram ao pino e foram recusados. Em cada fase diz ainda como o
// pino viu a roda (comando "tempos"): quanto tempo esteve em baixo em cada volta e a subida recusada mais
// comprida. É por aí que se vê o que o condensador faz ao sinal.
const { abrir } = require('./placa')
const { FASES, comandoDaFase, contas } = require('./roda')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const linhaDoLog = (linha) => {
  const l = ler(linha)
  return l && l.tipo === 'log' ? l : null
}

async function principal (argv) {
  const porta = argv[0]
  const segundos = argv[1] === undefined ? 20 : Number(argv[1])
  if (!porta || !(Number.isInteger(segundos) && segundos >= 5 && segundos <= 3600)) {
    console.error('uso: node ensaio/roda-por-fora.js <porta da caixa 1> [segundos por fase, de 5 a 3600; 20 por omissão]')
    process.exit(2)
  }
  const p = await abrir(porta)
  let perdida = null
  p.aoFechar((motivo) => { perdida = motivo })
  // a contagem do log: a da próxima linha que a caixa mandar (sai uma de meio em meio segundo)
  const contagem = async () => (await p.ate(linhaDoLog, 2000, 'a linha do log')).impulsos
  let todas = true
  try {
    await p.manda('parar')
    for (const [i, fase] of FASES.entries()) {
      if (perdida) throw new Error(`a porta perdeu-se: ${perdida}`)
      await espera(700) // o que vinha de trás já está contado
      const antes = contadores(await p.manda('estado'))
      const impulsosAntes = await contagem()
      const temposAntes = await p.manda('tempos') // a mais curta e a mais comprida contam-se desde esta pergunta
      const resposta = await p.manda('roda', ...comandoDaFase(fase))
      if (resposta !== 'ok') {
        throw new Error(`a caixa respondeu "${resposta}" ao comando da roda por fora (${fase.nome}): o programa dela é anterior ao ${fase.ressalto ? '0.3.4' : '0.3.0-a8'} (gravar outra vez: npm run gravar:1 -- ${porta})`)
      }
      await espera(segundos * 1000)
      const voltas = Number(await p.manda('roda', 0))
      await espera(700) // a última volta ainda pode estar por contar
      const impulsos = (await contagem()) - impulsosAntes
      const depois = contadores(await p.manda('estado'))
      const r = contas({ voltas, impulsos, recusados: depois['log-recusados'] - antes['log-recusados'], ressalto: fase.ressalto })
      todas = todas && r.passa
      console.log(`fase ${i + 1} de ${FASES.length} (${fase.nome}): ${r.passa ? 'PASSA' : 'FALHA'}`)
      console.log(`   ${r.diagnostico}`)
      // como o pino viu a roda: quanto tempo esteve em baixo em cada volta, e a subida recusada mais comprida
      if (temposAntes !== 'desconhecido') {
        const t = contadores(await p.manda('tempos'))
        const esperada = (1000 / fase.hz) * fase.aberta / 100
        console.log(`   o pino esteve em baixo ${(t['aberta-ult'] / 1000).toFixed(2)} ms na última volta e ${(t['aberta-min'] / 1000).toFixed(2)} ms na mais curta ` +
          `(a roda a fingir esteve aberta ${esperada.toFixed(2)} ms); a subida recusada mais comprida: ${(t['recusada-max'] / 1000).toFixed(2)} ms; ` +
          `a entrada calou-se ${t.caladas - contadores(temposAntes).caladas} vezes`)
      }
    }
  } finally {
    try { if (!perdida) await p.manda('parar') } catch (e) { /* a porta pode já ter ido */ }
    await p.fechar()
  }
  console.log(todas ? 'RESULTADO: A ENTRADA DA RODA PASSA' : 'RESULTADO: A ENTRADA DA RODA FALHA')
  process.exit(todas ? 0 : 1)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro.message)
  process.exit(1)
})
