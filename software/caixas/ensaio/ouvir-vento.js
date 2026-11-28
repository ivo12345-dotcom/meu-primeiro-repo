'use strict'
// Escuta do vento no barco: mostra no portátil, tal e qual, o que entra pelo fio do vento da caixa 1, e
// diz em português corrente se está bom e, se não está, o que é.
//   node ensaio/ouvir-vento.js <porta da caixa 1> [segundos, 20 por omissão]
//
// Só lê. Manda à caixa dois comandos, "estado" e "cru", que não mexem em pino nenhum: não liga geradores
// nem manda "parar". Pode correr com o mostrador ligado e a mandar. O ecrã do barco não pode estar a usar
// a mesma porta ao mesmo tempo. As contas estão em ensaio/cru.js, com ensaios sem placas (cru.test.js).
const { abrir } = require('./placa')
const { juntar, emLinhas, classificar, veredicto } = require('./cru')

const CONTADORES = ['vento-mexidas', 'vento-bytes', 'vento-frases', 'vento-invalidas']
const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hora = () => new Date().toTimeString().slice(0, 8)
// uma linha como chegou, com o que não é letra à vista (\xHH)
const aVista = (linha) => linha.replace(/[^\x20-\x7E]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
const NOMES = {
  'mwv-boa': 'vento, boa',
  'mwv-soma-errada': 'vento, SOMA ERRADA',
  'mwv-sem-soma': 'vento, SEM SOMA',
  'outra-boa': 'outra frase',
  'outra-sem-soma': 'outra frase, sem soma',
  lixo: 'NÃO É UMA FRASE'
}

async function principal (argv) {
  const porta = argv[0]
  const segundos = argv[1] === undefined ? 20 : Number(argv[1])
  if (!porta || !(Number.isInteger(segundos) && segundos >= 5 && segundos <= 600)) {
    console.error('uso: node ensaio/ouvir-vento.js <porta da caixa 1> [segundos, de 5 a 600; 20 por omissão]')
    process.exit(2)
  }
  const p = await abrir(porta)
  let perdida = null
  p.aoFechar((motivo) => { perdida = motivo })
  let v = null
  try {
    // é a caixa 1, e não está a fingir?
    const batimento = await p.ate((l) => (l.startsWith('$AQB,1,') ? l.split('*')[0].split(',') : null), 3000, 'o sinal de vida da caixa 1 (é a porta dela?)')
    if (batimento[4] === '1') console.log('ATENÇÃO: a caixa diz que está a fingir (há um sinal de bancada ligado). O que se segue pode não ser do mostrador.')
    const primeira = await p.manda('cru')
    if (primeira === 'desconhecido') throw new Error(`o programa desta caixa (${batimento[3]}) ainda não tem a escuta do vento: é preciso a versão 0.3.2 ou mais nova`)
    let fita = juntar(null, primeira)
    const antes = contadores(await p.manda('estado'))
    console.log(`# ${hora()} a ouvir o fio do vento da caixa 1 (${batimento[3]}) em ${porta}, ${segundos} s`)
    let impressas = 0
    const mostra = () => {
      const { linhas } = emLinhas(fita.bytes)
      for (const l of linhas.slice(impressas)) {
        const c = classificar(l)
        console.log(`${hora()}  ${(NOMES[c.classe] + (c.classe.startsWith('outra') ? ` (${c.tipo})` : '')).padEnd(24)} ${aVista(l)}`)
      }
      impressas = linhas.length
    }
    const fim = Date.now() + segundos * 1000
    while (Date.now() < fim) {
      if (perdida) throw new Error(`a porta perdeu-se: ${perdida}`)
      fita = juntar(fita, await p.manda('cru'))
      mostra()
      await espera(100)
    }
    fita = juntar(fita, await p.manda('cru'))
    mostra()
    const depois = contadores(await p.manda('estado'))
    const andou = Object.fromEntries(CONTADORES.map(k => [k, depois[k] - antes[k]]))
    const { linhas, resto } = emLinhas(fita.bytes)
    if (resto.length > 0) console.log(`${hora()}  ${'(sem fim de linha)'.padEnd(24)} ${aVista(resto.toString('latin1'))}`)
    if (fita.recomecos > 0) console.log(`ATENÇÃO: a caixa recomeçou ${fita.recomecos} vez(es) durante a escuta.`)
    console.log(`# em ${segundos} s: o fio mexeu ${andou['vento-mexidas']} vezes, entraram ${andou['vento-bytes']} letras, ${andou['vento-frases']} frases de vento boas, ${andou['vento-invalidas']} estragadas`)
    v = veredicto({ segundos, linhas, contadores: andou, perdidas: fita.perdidas })
  } finally {
    await p.fechar()
  }
  console.log(`RESULTADO: ${v.passa ? 'O VENTO CHEGA BEM' : 'O VENTO AINDA NÃO ESTÁ BOM'}`)
  console.log(v.texto)
  process.exit(v.passa ? 0 : 1)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro.message)
  process.exit(1)
})
