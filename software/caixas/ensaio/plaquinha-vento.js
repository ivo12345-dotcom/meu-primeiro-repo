'use strict'
// Ensaio da plaquinha do vento, em casa, só com a caixa 1 e o portátil.
//   node ensaio/plaquinha-vento.js <porta da caixa 1> [segundos por fase, 20 por omissão]
//
// A caixa 1 faz de mostrador do vento: manda a frase pelo pino TX2, ao contrário (repouso em baixo, como
// a manda o mostrador NASA), e NÃO a leva por dentro ao pino do vento. Quem a tem de trazer, direita, ao
// RX2 é a plaquinha do optoacoplador. Ligações (docs/caixas/vento-plaquinha-montagem.jpg):
//   TX2 da placa -> fio AMARELO da plaquinha      GND da placa -> fio VERDE
//   RX2 <- fio RX2      GND <- fio GND      3V3 <- fio 3V3
// Três fases com ventos diferentes; cada uma passa se chegar uma frase por segundo e nenhuma estragada.
const { abrir } = require('./placa')
const { FASES, comandoDaFase, fraseEsperada, contas } = require('./plaquinha')

const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function principal (argv) {
  const porta = argv[0]
  const segundos = argv[1] === undefined ? 20 : Number(argv[1])
  if (!porta || !(Number.isInteger(segundos) && segundos >= 5 && segundos <= 600)) {
    console.error('uso: node ensaio/plaquinha-vento.js <porta da caixa 1> [segundos por fase, de 5 a 600; 20 por omissão]')
    process.exit(2)
  }
  const p = await abrir(porta)
  let perdida = null
  p.aoFechar((motivo) => { perdida = motivo })
  let todas = true
  try {
    await p.manda('parar')
    for (const [i, fase] of FASES.entries()) {
      if (perdida) throw new Error(`a porta perdeu-se: ${perdida}`)
      const resposta = await p.manda('vento', ...comandoDaFase(fase))
      if (resposta !== 'ok') {
        throw new Error(`a caixa respondeu "${resposta}" ao comando do vento por fora: o programa dela é anterior ao 0.2.2 (gravar outra vez: npm run gravar:1 -- ${porta})`)
      }
      await espera(1500) // a primeira frase da fase, e o resto da anterior, ficam de fora da janela
      const antes = contadores(await p.manda('estado'))
      const linhas = await p.linhas(segundos * 1000)
      const depois = contadores(await p.manda('estado'))
      const r = contas({ segundos, esperada: fraseEsperada(fase.graus, fase.nos), linhas, antes, depois })
      todas = todas && r.passa
      console.log(`fase ${i + 1} de ${FASES.length} (${fase.nome}): ${r.passa ? 'PASSA' : 'FALHA'}`)
      console.log(`   ${r.diagnostico}`)
      console.log(`   frases certas ${r.recebidas} de ${r.esperadas}, estragadas ${r.invalidas}, outras ${r.outras}, bytes ${r.bytes}, mudanças do pino ${r.mexidas}`)
    }
  } finally {
    try { if (!perdida) await p.manda('parar') } catch (e) { /* a porta pode já ter ido */ }
    await p.fechar()
  }
  console.log(todas ? 'RESULTADO: A PLAQUINHA PASSA' : 'RESULTADO: A PLAQUINHA FALHA')
  process.exit(todas ? 0 : 1)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro.message)
  process.exit(1)
})
