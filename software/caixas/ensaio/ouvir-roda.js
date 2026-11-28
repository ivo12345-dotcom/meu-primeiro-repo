'use strict'
// Escuta da roda do log no barco: mostra no portátil cada volta que a caixa 1 conta, à medida que as conta.
//   node ensaio/ouvir-roda.js <porta da caixa 1> [segundos, 60 por omissão; 0 fica até Ctrl+C]
//
// Serve para a prova à mão, com o barco em seco: dão-se 10 voltas à roda com o dedo, por baixo do casco, e
// a caixa tem de contar 10. No fim diz quantas voltas contou e quantas subidas do pino recusou (as que não
// se aguentaram em cima 2 ms, ou vieram a menos de 4 ms da volta anterior: ver caixa1/log.h).
//
// Só lê. Manda à caixa um comando só, "estado", ao princípio e ao fim, que não mexe em pino nenhum: não
// liga geradores nem manda "parar". O ecrã do barco não pode estar a usar a mesma porta ao mesmo tempo.
const { abrir } = require('./placa')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
const hora = () => new Date().toTimeString().slice(0, 8)

async function principal (argv) {
  const porta = argv[0]
  const segundos = argv[1] === undefined ? 60 : Number(argv[1])
  if (!porta || !(Number.isInteger(segundos) && segundos >= 0 && segundos <= 3600)) {
    console.error('uso: node ensaio/ouvir-roda.js <porta da caixa 1> [segundos, até 3600; 60 por omissão; 0 fica até Ctrl+C]')
    process.exit(2)
  }
  const p = await abrir(porta)
  let perdida = null
  p.aoFechar((motivo) => { perdida = motivo })
  let primeira = null
  let ultima = null
  let recusadosAntes = 0
  const fecho = async () => {
    let recusadas = '?'
    try { if (!perdida) recusadas = contadores(await p.manda('estado'))['log-recusados'] - recusadosAntes } catch (e) { /* a porta pode já ter ido */ }
    await p.fechar()
    const voltas = primeira && ultima ? ultima.impulsos - primeira.impulsos : 0
    console.log(`RESULTADO: ${voltas} ${voltas === 1 ? 'volta contada' : 'voltas contadas'}; ${recusadas} subidas do pino recusadas`)
    if (perdida) console.log(`ATENÇÃO: a porta perdeu-se a meio: ${perdida}`)
  }
  try {
    const batimento = await p.ate((l) => (l.startsWith('$AQB,1,') ? l.split('*')[0].split(',') : null), 3000, 'o sinal de vida da caixa 1 (é a porta dela?)')
    if (batimento[4] === '1') console.log('ATENÇÃO: a caixa diz que está a fingir (há um sinal de bancada ligado). O que se segue pode não ser da roda.')
    recusadosAntes = contadores(await p.manda('estado'))['log-recusados']
    console.log(`# ${hora()} a ouvir a roda do log da caixa 1 (${batimento[3]}) em ${porta}${segundos ? `, ${segundos} s` : ', até Ctrl+C'}`)
    p.ouvir((linha) => {
      const l = ler(linha)
      if (!l || l.tipo !== 'log') return
      if (!primeira) { primeira = l; ultima = l; return }
      if (l.impulsos < ultima.impulsos) { // a caixa recomeçou: a conta dela voltou a zero
        console.log(`${hora()}  a caixa recomeçou: a contagem dela voltou a ${l.impulsos}`)
        primeira = { ...l, impulsos: l.impulsos - (ultima.impulsos - primeira.impulsos) }
      } else if (l.impulsos > ultima.impulsos) {
        const novas = l.impulsos - ultima.impulsos
        const periodo = l.periodoUs > 0 ? `, ${(l.periodoUs / 1000).toFixed(0)} ms entre as duas últimas` : ''
        console.log(`${hora()}  +${novas}  →  ${l.impulsos - primeira.impulsos} ${l.impulsos - primeira.impulsos === 1 ? 'volta' : 'voltas'}${periodo}`)
      }
      ultima = l
    })
    if (segundos === 0) {
      await new Promise((resolve) => process.once('SIGINT', resolve))
    } else {
      const fim = Date.now() + segundos * 1000
      while (Date.now() < fim && !perdida) await new Promise((resolve) => setTimeout(resolve, 200))
    }
  } finally {
    await fecho()
  }
  process.exit(perdida ? 1 : 0)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro.message)
  process.exit(1)
})
