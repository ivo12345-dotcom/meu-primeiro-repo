'use strict'
// A fonte das linhas: a porta série da caixa 1 (o cabo USB) ou, nos ensaios, uma ligação TCP à caixa
// a fingir. Parte os bytes em linhas, volta a ligar sozinha quando a ligação cai ou se cala e, com
// a porta 'auto', procura a caixa 1 pelo batimento dela (o número da porta COM muda de dia para dia).
//
// Quem a usa dá duas funções que não podem rebentar: aoLinha(texto) e aoEstado({ aberta, nome, motivo }).

const path = require('node:path')
const { BAUD, MAX_LINHA, ler } = require('./linhas')

const RELIGAR = 3000 // ms entre uma queda e a tentativa seguinte
const PROVA = 3000 // ms à espera do batimento da caixa 1 em cada porta, na procura
const CALADA = 10000 // ms sem um único byte numa porta aberta: dá-se por perdida e abre-se de novo
// os chips de USB das placas ESP32: Silicon Labs (CP210x), WCH (CH340, CH9102), FTDI e a própria Espressif
const FABRICANTES = ['10C4', '1A86', '0403', '303A']

// A biblioteca da porta série é a do servidor SignalK: os nossos plugins não trazem dependências.
// Procura-se ao pé do plugin e, se não houver, nas pastas dadas (por omissão, a do servidor).
function pedirSerialport (pastas) {
  try {
    return require('serialport')
  } catch (erro) {
    if (erro.code !== 'MODULE_NOT_FOUND') throw erro
  }
  const onde = pastas || [process.cwd(), ...(require.main && require.main.filename ? [path.dirname(require.main.filename)] : [])]
  try {
    return require(require.resolve('serialport', { paths: onde }))
  } catch (erro) {
    if (erro.code !== 'MODULE_NOT_FOUND') throw erro
    throw new Error(`falta a biblioteca "serialport", que vem com o servidor SignalK (procurada ao pé do plugin e em ${onde.join('; ')})`)
  }
}

// Os erros do sistema ao abrir uma porta, por palavras que digam o que fazer.
function explicar (mensagem) {
  const m = String(mensagem)
  if (/file not found|no such file/i.test(m)) return 'não existe (o cabo USB está ligado?)'
  if (/access denied|permission denied|resource busy/i.test(m)) return 'está ocupada por outro programa'
  return m
}

// Parte os bocados que chegam em linhas inteiras, sem o \r nem o \n. As linhas vazias não contam e
// uma linha com mais de MAX_LINHA caracteres deita-se fora inteira, chegue em quantos bocados chegar.
function partidor (aoLinha) {
  let resto = ''
  let aDeitarFora = false
  return (bocado) => {
    let texto = typeof bocado === 'string' ? bocado : bocado.toString('latin1')
    if (aDeitarFora) {
      const fim = texto.indexOf('\n')
      if (fim === -1) return // ainda a meio da linha comprida de mais
      texto = texto.slice(fim + 1)
      aDeitarFora = false
    }
    const partes = (resto + texto).split('\n')
    resto = partes.pop()
    for (const parte of partes) {
      const linha = parte.endsWith('\r') ? parte.slice(0, -1) : parte
      if (linha.length > 0 && linha.length <= MAX_LINHA) aoLinha(linha)
    }
    if (resto.length > MAX_LINHA + 1) { // + 1: o \r de uma linha com o tamanho máximo
      resto = ''
      aDeitarFora = true
    }
  }
}

// Uma ligação chama ev.aoAbrir(), ev.aoBocado(bytes) e ev.aoCair(motivo) as vezes que calhar; quem a
// usa é que filtra. Devolve { largar() }.
function ligarSerie (SerialPort, nome, ev) {
  // hupcl: false abre com as linhas de comando em repouso. Na biblioteca do servidor (Windows), o
  // costume é abrir com o DTR ligado e o RTS desligado, e nas placas ESP32 isso segura em baixo o pino
  // que escolhe o modo de arranque: se a placa recomeçasse sozinha, ficava presa à espera de ser gravada.
  const porta = new SerialPort({ path: nome, baudRate: BAUD, autoOpen: false, hupcl: false })
  let largada = false
  const fechar = () => { if (porta.isOpen) porta.close(() => {}) }
  porta.on('data', ev.aoBocado)
  porta.on('error', (erro) => ev.aoCair(erro.message))
  porta.on('close', (erro) => ev.aoCair(erro && erro.disconnected ? 'o cabo USB saiu ou a placa desligou-se' : 'a porta fechou'))
  porta.open((erro) => {
    if (erro) return ev.aoCair(erro.message)
    if (largada) return fechar() // largaram-na enquanto abria
    ev.aoAbrir()
  })
  return { largar () { largada = true; fechar() } }
}

function ligarTcp (net, maquina, porto, ev) {
  const s = net.connect({ host: maquina, port: porto })
  s.on('connect', ev.aoAbrir)
  s.on('data', ev.aoBocado)
  s.on('error', (erro) => ev.aoCair(erro.message))
  s.on('close', () => ev.aoCair('o outro lado fechou a ligação'))
  return { largar () { s.destroy() } }
}

// porta: 'auto', o nome de uma porta série ('COM7', '/dev/ttyUSB0') ou 'tcp://máquina:porta'.
// deps (para os testes): { SerialPort, net, religar, prova, calada }.
function abrirFonte ({ porta, aoLinha, aoEstado, deps = {} }) {
  const religar = deps.religar ?? RELIGAR
  const prova = deps.prova ?? PROVA
  const calada = deps.calada ?? CALADA
  const alvo = String(porta || 'auto').trim()
  const tcp = /^tcp:\/\/([^:/\s]+):(\d{1,5})\/?$/i.exec(alvo)
  let fechada = false
  let marcada = null // a tentativa que ficou marcada
  let atual = null // o que está em curso: { largar() }
  let serie = null

  const dizer = (estado) => { if (!fechada) aoEstado(estado) }
  const marcar = (passo) => { if (!fechada) marcada = setTimeout(passo, religar) }
  const biblioteca = () => (serie = serie || deps.SerialPort || pedirSerialport().SerialPort)

  function abrir (nome, ev) {
    try {
      if (tcp) return ligarTcp(deps.net || require('node:net'), tcp[1], Number(tcp[2]), ev)
      return ligarSerie(biblioteca(), nome, ev)
    } catch (erro) {
      // a biblioteca que falta, um nome ou um número de porta impossíveis: conta como porta que não abre
      setImmediate(() => ev.aoCair(erro.message))
      return { largar () {} }
    }
  }

  // Uma sessão: uma ligação partida em linhas e vigiada. Perde-se uma vez só (por cair, por não abrir
  // ou por se calar); depois de perdida ou largada não chama mais ninguém.
  function sessao (nome, { aoAbrir, aoLinhaDela, aoPerder }) {
    let viva = true
    let silencio = null
    let ligacao = null
    const partir = partidor((linha) => { if (viva) aoLinhaDela(linha) })
    const acabar = () => {
      viva = false
      clearTimeout(silencio)
      if (ligacao) ligacao.largar()
    }
    const perder = (motivo) => {
      if (!viva) return
      acabar()
      aoPerder(motivo)
    }
    const ouvir = () => {
      clearTimeout(silencio)
      silencio = setTimeout(() => perder(`aberta mas calada há ${Math.round(calada / 1000)} s`), calada)
    }
    ligacao = abrir(nome, {
      aoAbrir: () => { if (viva) { ouvir(); aoAbrir() } },
      aoBocado: (bytes) => { if (viva) { ouvir(); partir(bytes) } },
      aoCair: (motivo) => perder(explicar(motivo))
    })
    return { largar () { if (viva) acabar() } }
  }

  // Uma porta de nome certo (ou o TCP): abre, e quando a perde volta a tentar.
  function ligarFixa () {
    marcada = null
    atual = sessao(alvo, {
      aoAbrir: () => dizer({ aberta: true, nome: alvo }),
      aoLinhaDela: aoLinha,
      aoPerder: (motivo) => {
        atual = null
        dizer({ aberta: false, nome: alvo, motivo })
        marcar(ligarFixa)
      }
    })
  }

  // Abre uma porta e espera pelo batimento da caixa 1. Resolve true se ficou com ela: a partir daí é a
  // ligação, e as linhas dela seguem para quem ouve (a começar pelo batimento que a confirmou).
  function provar (nome) {
    return new Promise((resolve) => {
      let confirmada = false
      let prazo = null
      let s = null
      const desistir = () => {
        clearTimeout(prazo)
        if (s) s.largar()
        atual = null
        resolve(false)
      }
      s = sessao(nome, {
        aoAbrir: () => {},
        aoLinhaDela: (linha) => {
          if (confirmada) return aoLinha(linha)
          const b = ler(linha)
          if (!b || b.tipo !== 'batimento') return
          if (b.caixa !== 1) return desistir() // é a caixa do motor, ligada por USB só para ter corrente
          confirmada = true
          clearTimeout(prazo)
          dizer({ aberta: true, nome })
          aoLinha(linha)
          resolve(true)
        },
        aoPerder: (motivo) => {
          clearTimeout(prazo)
          atual = null
          if (!confirmada) return resolve(false)
          dizer({ aberta: false, nome, motivo })
          marcar(procurar)
        }
      })
      prazo = setTimeout(desistir, prova)
      atual = { largar: desistir }
    })
  }

  // Vê as portas que há, fica só com as dos chips de USB das placas e prova-as uma a uma, por ordem.
  async function procurarUmaVez () {
    marcada = null
    let portas
    try {
      portas = await biblioteca().list()
    } catch (erro) {
      dizer({ aberta: false, nome: 'auto', motivo: `não se conseguem ver as portas: ${erro.message}` })
      return marcar(procurar)
    }
    const nomes = portas
      .filter(p => FABRICANTES.includes(String(p.vendorId || '').toUpperCase()))
      .map(p => p.path)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    for (const nome of nomes) {
      if (fechada) return
      if (await provar(nome)) return
    }
    dizer({ aberta: false, nome: 'auto', motivo: `nenhuma porta com a caixa 1 (vistas: ${nomes.join(', ') || 'nenhuma'})` })
    marcar(procurar)
  }

  function procurar () {
    procurarUmaVez().catch((erro) => {
      dizer({ aberta: false, nome: 'auto', motivo: `a procura falhou: ${erro.message}` })
      marcar(procurar)
    })
  }

  if (/^tcp:/i.test(alvo) && !tcp) {
    setImmediate(() => dizer({ aberta: false, nome: alvo, motivo: 'endereço mal escrito: tem de ser tcp://máquina:porta' }))
  } else if (alvo === 'auto') {
    procurar()
  } else {
    ligarFixa()
  }

  return {
    fechar () {
      if (fechada) return
      fechada = true
      clearTimeout(marcada)
      if (atual) atual.largar()
      atual = null
    }
  }
}

module.exports = { RELIGAR, PROVA, CALADA, abrirFonte, pedirSerialport }
