'use strict'
// Escuta da roda do log no barco: mostra no portátil cada volta que a caixa 1 conta, à medida que as conta.
//   node ensaio/ouvir-roda.js <porta da caixa 1> [segundos, 60 por omissão; 0 fica até Ctrl+C]
//
// Serve para a prova à mão, com o barco em seco: dão-se 10 voltas à roda com o dedo, por baixo do casco, e
// a caixa tem de contar 10. Em cada volta diz também quanto tempo a roda esteve aberta, e que parte da
// volta isso foi: é o que diz se, com a roda depressa, o pino ainda chega a descer (o condensador da
// entrada pede cerca de 1 ms). No fim diz quantas voltas contou, quantas subidas do pino recusou (as que
// não se aguentaram em cima 2 ms, ou vieram a menos de 4 ms da volta anterior: ver caixa1/log.h) e a mais
// comprida dessas.
//
// Só lê. Manda à caixa dois comandos, "estado" e "tempos", que não mexem em pino nenhum: não liga
// geradores nem manda "parar". O ecrã do barco não pode estar a usar a mesma porta ao mesmo tempo.
const { abrir } = require('./placa')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
const hora = () => new Date().toTimeString().slice(0, 8)
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ms = (us) => (us / 1000).toFixed(us < 10000 ? 1 : 0)

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
  let primeira = null // a primeira linha do log desta escuta
  let ultima = null // a mais recente
  let mostradas = 0 // as voltas já escritas
  let recusadosAntes = 0
  let comTempos = false
  let maisCurta = 0 // a volta em que a roda esteve menos tempo aberta, em µs (0: nenhuma medida)
  let recusadaMaisComprida = 0
  let caladasAntes = 0
  let caladas = 0
  const partes = [] // a parte da volta em que a roda esteve aberta, em cada volta medida
  let interrompida = false
  process.once('SIGINT', () => { interrompida = true })

  // Escreve as voltas novas, com as medidas do contacto se a caixa as der.
  const mostra = async () => {
    if (!primeira || !ultima) return
    const voltas = ultima.impulsos - primeira.impulsos
    if (voltas === mostradas) return
    let medida = ''
    if (comTempos) {
      const t = contadores(await p.manda('tempos'))
      if (t['aberta-min'] > 0 && (maisCurta === 0 || t['aberta-min'] < maisCurta)) maisCurta = t['aberta-min']
      if (t['recusada-max'] > recusadaMaisComprida) recusadaMaisComprida = t['recusada-max']
      caladas = t.caladas - caladasAntes
      if (t['aberta-ult'] > 0 && ultima.periodoUs > 0 && voltas - mostradas === 1 && mostradas > 0) {
        const parte = 100 * t['aberta-ult'] / ultima.periodoUs
        partes.push(parte)
        medida = `, aberta ${ms(t['aberta-ult'])} ms (${parte.toFixed(parte < 10 ? 1 : 0)} % da volta)`
      }
    }
    const periodo = ultima.periodoUs > 0 && mostradas > 0 ? `, ${ms(ultima.periodoUs)} ms desde a anterior` : ''
    console.log(`${hora()}  +${voltas - mostradas}  →  ${voltas} ${voltas === 1 ? 'volta' : 'voltas'}${periodo}${medida}`)
    mostradas = voltas
  }

  try {
    const batimento = await p.ate((l) => (l.startsWith('$AQB,1,') ? l.split('*')[0].split(',') : null), 3000, 'o sinal de vida da caixa 1 (é a porta dela?)')
    if (batimento[4] === '1') console.log('ATENÇÃO: a caixa diz que está a fingir (há um sinal de bancada ligado). O que se segue pode não ser da roda.')
    recusadosAntes = contadores(await p.manda('estado'))['log-recusados']
    const tempos = await p.manda('tempos') // as medidas contam-se desde esta pergunta
    comTempos = tempos !== 'desconhecido'
    if (comTempos) caladasAntes = contadores(tempos).caladas
    else console.log(`(o programa desta caixa, ${batimento[3]}, ainda não mede quanto tempo a roda fica aberta: é preciso a versão 0.3.4)`)
    console.log(`# ${hora()} a ouvir a roda do log da caixa 1 (${batimento[3]}) em ${porta}${segundos ? `, ${segundos} s` : ', até Ctrl+C'}`)
    p.ouvir((linha) => {
      const l = ler(linha)
      if (!l || l.tipo !== 'log') return
      if (!primeira) { primeira = l; ultima = l; return }
      if (l.impulsos < ultima.impulsos) { // a caixa recomeçou: a conta dela voltou a zero
        console.log(`${hora()}  a caixa recomeçou: a contagem dela voltou a ${l.impulsos}`)
        primeira = { ...l, impulsos: l.impulsos - (ultima.impulsos - primeira.impulsos) }
      }
      ultima = l
    })
    const fim = segundos === 0 ? Infinity : Date.now() + segundos * 1000
    while (Date.now() < fim && !perdida && !interrompida) {
      await mostra()
      await espera(150)
    }
    // a caixa manda a contagem de meio em meio segundo: espera-se pela linha seguinte, para a última volta
    // dada mesmo antes de se parar não ficar de fora
    if (!perdida) {
      await p.ate((l) => { const x = ler(l); return x && x.tipo === 'log' ? x : null }, 1500, 'a última linha do log').catch(() => null)
      await espera(50)
      await mostra()
    }
  } finally {
    let recusadas = '?'
    try { if (!perdida) recusadas = contadores(await p.manda('estado'))['log-recusados'] - recusadosAntes } catch (e) { /* a porta pode já ter ido */ }
    await p.fechar()
    const voltas = primeira && ultima ? ultima.impulsos - primeira.impulsos : 0
    console.log(`RESULTADO: ${voltas} ${voltas === 1 ? 'volta contada' : 'voltas contadas'}; ${recusadas} subidas do pino recusadas`)
    if (comTempos && voltas > 0) {
      const dasPartes = partes.length ? `, entre ${Math.min(...partes).toFixed(1)} % e ${Math.max(...partes).toFixed(1)} % da volta` : ''
      console.log(`A roda esteve aberta, na volta mais curta, ${maisCurta ? ms(maisCurta) + ' ms' : 'sem medida'}${dasPartes}. ` +
        `A subida recusada mais comprida: ${recusadaMaisComprida ? ms(recusadaMaisComprida) + ' ms (a regra recusa até 2 ms)' : 'nenhuma'}.` +
        (caladas > 0 ? ` ATENÇÃO: a entrada calou-se ${caladas} vezes por ter mudanças a mais: há ruído no fio da roda.` : ''))
    }
    if (perdida) console.log(`ATENÇÃO: a porta perdeu-se a meio: ${perdida}`)
  }
  process.exit(perdida ? 1 : 0)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro.message)
  process.exit(1)
})
