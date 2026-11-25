'use strict'
// Ensaio de bancada: a caixa 2 ouve tramas verdadeiras vindas por um fio?
//
// O motor a fingir da caixa 2 nasce dentro dela e não passa pelo módulo do barramento nem pelo pino
// D4. Aqui, outra placa (com o programa software/ferramentas/bancada/motor_no_fio e o módulo B, o que
// tem a resistência de 120 ohm) escreve tramas num par de fios, e a caixa 2 (com o módulo A, sem a
// resistência) tem de as ouvir todas: nem uma a menos, nem uma a mais.
//
//   node ensaio/escuta-fio.js <porta da placa que faz de motor> <porta da caixa 2>
//   node ensaio/escuta-fio.js COM3 COM5
//
// Só na bancada. A placa que faz de motor NUNCA se liga à linha do motor do barco.
const { abrir, espera } = require('./placa')

// "motor-tramas=12;motor-ignoradas=0;..." -> { 'motor-tramas': 12, ... }
function campos (texto) {
  const o = {}
  for (const parte of String(texto).split(';')) {
    const i = parte.indexOf('=')
    if (i > 0) o[parte.slice(0, i)] = Number(parte.slice(i + 1))
  }
  return o
}

// "fim postas=1000 recusadas=0 falhadas=0 por-sair=0 erros=0 estado=a-andar" -> { postas: '1000', ... }
function relato (linha) {
  const o = {}
  for (const parte of String(linha).split(' ').slice(1)) {
    const i = parte.indexOf('=')
    if (i > 0) o[parte.slice(0, i)] = parte.slice(i + 1)
  }
  return o
}

// O que saiu de facto para o fio, pelas contas da placa que faz de motor.
function saidas (r) {
  return Number(r.postas) - Number(r.falhadas) - Number(r['por-sair'])
}

// Uma rajada de 1000 tramas ('n': uma de 5 em 5 ms; 'r': uma por milissegundo) e a conta do que a caixa 2 ouviu.
async function rajada (motor, caixa2, letra) {
  const antes = campos(await caixa2.manda('estado'))
  const fim = motor.ate((l) => (l.startsWith('fim ') ? relato(l) : null), 20000, 'o fim da rajada')
  await motor.escreve(letra)
  const r = await fim
  await espera(300)
  const depois = campos(await caixa2.manda('estado'))
  return {
    saidas: saidas(r),
    recusadas: Number(r.recusadas),
    falhadas: Number(r.falhadas),
    erros: Number(r.erros),
    estado: r.estado,
    ouvidas: depois['motor-tramas'] - antes['motor-tramas'],
    ignoradas: depois['motor-ignoradas'] - antes['motor-ignoradas']
  }
}

// Dez segundos à cadência do motor (14 tramas por segundo) e a conta do que a caixa 2 ouviu.
async function cadencia (motor, caixa2, segundos) {
  const antes = campos(await caixa2.manda('estado'))
  await motor.escreve('a')
  await espera(segundos * 1000)
  const parado = motor.ate((l) => (l.startsWith('parado ') ? relato(l) : null), 3000, 'a resposta ao parar')
  await motor.escreve('p')
  const r = await parado
  await espera(300)
  const depois = campos(await caixa2.manda('estado'))
  return {
    saidas: saidas(r),
    recusadas: Number(r.recusadas),
    falhadas: Number(r.falhadas),
    erros: Number(r.erros),
    estado: r.estado,
    ouvidas: depois['motor-tramas'] - antes['motor-tramas'],
    ignoradas: depois['motor-ignoradas'] - antes['motor-ignoradas']
  }
}

function limpa (x, esperadas) {
  return x.ouvidas === x.saidas && x.ignoradas === 0 && x.falhadas === 0 && x.recusadas === 0 && x.erros === 0 &&
    (esperadas == null || x.saidas === esperadas)
}

async function principal (argv) {
  const [portaMotor, portaCaixa2] = argv
  if (!portaMotor || !portaCaixa2) {
    console.error('uso: node ensaio/escuta-fio.js <porta da placa que faz de motor> <porta da caixa 2>')
    process.exit(2)
  }
  const motor = await abrir(portaMotor)
  const caixa2 = await abrir(portaCaixa2)
  let falhas = 0
  try {
    const pronto = motor.ate((l) => (l.startsWith('estado ') ? relato(l) : null), 3000, 'a resposta da placa que faz de motor (tem o programa motor_no_fio?)')
    await motor.escreve('e')
    console.log('placa que faz de motor:', JSON.stringify(await pronto))
    console.log('caixa 2 antes:', await caixa2.manda('estado'))

    const passos = [['n', 'rajada de 1000, uma de 5 em 5 ms'], ['n', 'rajada de 1000, uma de 5 em 5 ms'], ['n', 'rajada de 1000, uma de 5 em 5 ms'],
      ['r', 'rajada de 1000, uma por milissegundo'], ['r', 'rajada de 1000, uma por milissegundo'], ['r', 'rajada de 1000, uma por milissegundo']]
    for (const [letra, nome] of passos) {
      const x = await rajada(motor, caixa2, letra)
      const ok = limpa(x, 1000)
      if (!ok) falhas++
      console.log(`${ok ? 'CERTO ' : 'FALHOU'} ${nome}: saíram ${x.saidas}, a caixa 2 ouviu ${x.ouvidas} (ignoradas ${x.ignoradas}; falhadas ${x.falhadas}, recusadas ${x.recusadas}, erros na linha ${x.erros}, ${x.estado})`)
    }
    const c = await cadencia(motor, caixa2, 10)
    const ok = limpa(c, null) && c.saidas >= 130 && c.saidas <= 150
    if (!ok) falhas++
    console.log(`${ok ? 'CERTO ' : 'FALHOU'} dez segundos à cadência do motor: saíram ${c.saidas}, a caixa 2 ouviu ${c.ouvidas} (ignoradas ${c.ignoradas}; falhadas ${c.falhadas}, erros na linha ${c.erros}, ${c.estado})`)
    console.log('caixa 2 depois:', await caixa2.manda('estado'))
  } finally {
    await motor.escreve('p').catch(() => {})
    await motor.fechar()
    await caixa2.fechar()
  }
  console.log(falhas === 0 ? 'LIMPO: a caixa 2 ouviu pelo fio tudo o que saiu.' : `COM FALHAS: ${falhas} passo(s) falharam.`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error('erro:', erro.message)
  process.exit(1)
})
