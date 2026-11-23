'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { abrirFonte, pedirSerialport, RELIGAR, PROVA, CALADA } = require('../lib/fonte')
const { escrever } = require('../lib/linhas')

// Uma SerialPort a fingir. Lembra-se de todas as que se criaram, abre sem erro (a não ser que o nome
// esteja em naoAbrem) e, depois de abrir, chama o aoAbrir desse nome, para o teste "mandar" bytes.
// Como a verdadeira, responde ao open() e ao close() mais tarde, nunca na mesma volta, e dá o
// evento 'close' também quando é o programa a fechá-la.
function portasAFingir ({ lista = [], naoAbrem = {}, aoAbrir = {}, falhaDaLista = null } = {}) {
  const criadas = []
  const estado = { falhaDaLista }
  let listagens = 0
  class Porta extends EventEmitter {
    constructor (opcoes) {
      super()
      this.opcoes = opcoes
      this.path = opcoes.path
      this.isOpen = false
      criadas.push(this)
    }

    open (cb) {
      setImmediate(() => {
        if (naoAbrem[this.path]) return cb(new Error(naoAbrem[this.path]))
        this.isOpen = true
        cb(null)
        if (aoAbrir[this.path]) aoAbrir[this.path](this)
      })
    }

    close (cb) {
      if (!this.isOpen) return setImmediate(() => cb && cb(new Error('Port is not open')))
      this.isOpen = false
      setImmediate(() => {
        if (cb) cb(null)
        this.emit('close', null)
      })
    }

    write () {}

    static list () {
      listagens++
      return estado.falhaDaLista ? Promise.reject(new Error(estado.falhaDaLista)) : Promise.resolve(lista.map(p => ({ ...p })))
    }
  }
  return { SerialPort: Porta, criadas, lista, naoAbrem, aoAbrir, estado, listagens: () => listagens }
}

// Os relógios do teste (só o setTimeout): ligam-se uma vez por teste, mesmo que ele abra duas fontes.
const comRelogios = new WeakSet()
function relogios (t) {
  if (comRelogios.has(t)) return
  t.mock.timers.enable({ apis: ['setTimeout'] })
  comRelogios.add(t)
}

// Deixa correr o que ficou marcado para "logo a seguir": os open, os close e as promessas.
async function assentar () {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
}

// O cabo que sai: a porta fecha sem ninguém pedir.
function cair (porta) {
  porta.isOpen = false
  porta.emit('close', Object.assign(new Error('desligada'), { disconnected: true }))
}

const batimento = (caixa) => escrever('B', [caixa, 1000, '0.1.0', 0, caixa === 1 ? 0 : -60, 0])

// Uma fonte numa porta de nome fixo, com os relógios do teste.
function fixa (t, opcoes = {}) {
  relogios(t)
  const f = portasAFingir(opcoes)
  const linhas = []
  const estados = []
  const fonte = abrirFonte({
    porta: opcoes.porta || 'COM7',
    aoLinha: l => linhas.push(l),
    aoEstado: e => estados.push(e),
    deps: { SerialPort: f.SerialPort }
  })
  return { f, linhas, estados, fonte }
}

test('os tempos da fonte', () => {
  assert.equal(RELIGAR, 3000)
  assert.equal(PROVA, 3000)
  assert.equal(CALADA, 10000)
})

test('linhas partidas em bocados e com \\r\\n chegam inteiras', async (t) => {
  const { f, linhas, fonte } = fixa(t)
  await assentar()
  const p = f.criadas[0]
  // hupcl: false deixa em repouso a linha que, ligada, reiniciava a placa ou a prendia no modo de gravação
  assert.deepEqual(p.opcoes, { path: 'COM7', baudRate: 460800, autoOpen: false, hupcl: false })
  p.emit('data', Buffer.from('$AQL,1,2'))
  assert.deepEqual(linhas, [])
  p.emit('data', Buffer.from(',3*hh\r\n$AQ'))
  assert.deepEqual(linhas, ['$AQL,1,2,3*hh'])
  p.emit('data', Buffer.from('B\n\n\r\nfim\n'))
  assert.deepEqual(linhas, ['$AQL,1,2,3*hh', '$AQB', 'fim']) // as linhas vazias não contam
  fonte.fechar()
})

test('Review Focus 4: uma linha com mais de 200 caracteres deita-se fora', async (t) => {
  const { f, linhas, fonte } = fixa(t)
  await assentar()
  const p = f.criadas[0]
  p.emit('data', Buffer.from('x'.repeat(150)))
  p.emit('data', Buffer.from('y'.repeat(150))) // 300 sem fim de linha
  p.emit('data', Buffer.from('zzz'))
  p.emit('data', Buffer.from('\nola\n'))
  assert.deepEqual(linhas, ['ola'])
  p.emit('data', Buffer.from('a'.repeat(200) + '\r\n' + 'b'.repeat(201) + '\n'))
  assert.deepEqual(linhas, ['ola', 'a'.repeat(200)]) // 200 ainda passa, 201 já não
  fonte.fechar()
})

test('Review Focus 1: a porta fecha a meio de uma linha', async (t) => {
  const { f, linhas, estados, fonte } = fixa(t)
  await assentar()
  f.criadas[0].emit('data', Buffer.from('$AQL,1,'))
  cair(f.criadas[0])
  assert.deepEqual(estados.at(-1), { aberta: false, nome: 'COM7', motivo: 'o cabo USB saiu ou a placa desligou-se' })
  t.mock.timers.tick(2999)
  await assentar()
  assert.equal(f.criadas.length, 1) // ainda não passaram os 3 s
  t.mock.timers.tick(1)
  await assentar()
  assert.equal(f.criadas.length, 2)
  f.criadas[1].emit('data', Buffer.from('2,3*hh\n'))
  assert.deepEqual(linhas, ['2,3*hh']) // nunca '$AQL,1,2,3*hh': o que ficou a meio antes do fecho deitou-se fora
  assert.deepEqual(estados.map(e => e.aberta), [true, false, true])
  fonte.fechar()
})

test('o fechar() cancela a religação e cala a fonte', async (t) => {
  const { f, linhas, estados, fonte } = fixa(t)
  await assentar()
  cair(f.criadas[0])
  fonte.fechar()
  t.mock.timers.tick(10000)
  await assentar()
  assert.equal(f.criadas.length, 1)
  assert.equal(estados.length, 2)

  // com a porta aberta: fecha-a, e o que ela ainda disser já não chega a ninguém
  const outra = fixa(t)
  await assentar()
  const p = outra.f.criadas[0]
  outra.fonte.fechar()
  p.emit('data', Buffer.from('tarde\n'))
  await assentar()
  t.mock.timers.tick(10000)
  await assentar()
  assert.equal(p.isOpen, false)
  assert.deepEqual(outra.linhas, [])
  assert.deepEqual(outra.estados, [{ aberta: true, nome: 'COM7' }])
  assert.equal(outra.f.criadas.length, 1)
  assert.deepEqual(linhas, [])
})

test('a porta não abre: diz porquê, por palavras que digam o que fazer, e volta a tentar', async (t) => {
  const { f, estados, fonte } = fixa(t, { naoAbrem: { COM7: 'Opening COM7: File not found' } })
  await assentar()
  assert.deepEqual(estados, [{ aberta: false, nome: 'COM7', motivo: 'não existe (o cabo USB está ligado?)' }])
  f.naoAbrem.COM7 = 'Opening COM7: Access denied'
  t.mock.timers.tick(3000)
  await assentar()
  assert.equal(f.criadas.length, 2)
  assert.deepEqual(estados.at(-1), { aberta: false, nome: 'COM7', motivo: 'está ocupada por outro programa' })
  f.naoAbrem.COM7 = 'Unknown error code 31'
  t.mock.timers.tick(3000)
  await assentar()
  assert.deepEqual(estados.at(-1), { aberta: false, nome: 'COM7', motivo: 'Unknown error code 31' })
  delete f.naoAbrem.COM7
  t.mock.timers.tick(3000)
  await assentar()
  assert.deepEqual(estados.at(-1), { aberta: true, nome: 'COM7' })
  fonte.fechar()
})

test('um erro seguido do fecho conta uma vez só: uma religação, um aviso', async (t) => {
  const { f, estados, fonte } = fixa(t)
  await assentar()
  const p = f.criadas[0]
  p.emit('error', new Error('Reading from COM port (ReadIOCompletion): Operation aborted'))
  cair(p)
  p.emit('error', new Error('outra vez'))
  t.mock.timers.tick(3000)
  await assentar()
  assert.equal(f.criadas.length, 2)
  assert.deepEqual(estados.map(e => e.aberta), [true, false, true])
  fonte.fechar()
})

test('Review Focus 5: uma porta aberta mas calada há 10 s fecha-se e abre-se de novo', async (t) => {
  const { f, estados, fonte } = fixa(t)
  await assentar()
  t.mock.timers.tick(9000)
  f.criadas[0].emit('data', Buffer.from('x')) // um byte chega para a dar por viva
  t.mock.timers.tick(9000)
  await assentar()
  assert.equal(f.criadas.length, 1)
  assert.equal(f.criadas[0].isOpen, true)
  t.mock.timers.tick(1000) // 10 s sem nada
  await assentar()
  assert.equal(f.criadas[0].isOpen, false)
  assert.deepEqual(estados.at(-1), { aberta: false, nome: 'COM7', motivo: 'aberta mas calada há 10 s' })
  t.mock.timers.tick(3000)
  await assentar()
  assert.equal(f.criadas.length, 2)
  assert.deepEqual(estados.at(-1), { aberta: true, nome: 'COM7' })
  fonte.fechar()
})

// --- porta 'auto' --------------------------------------------------------------------------------

function automatica (t, opcoes) {
  relogios(t)
  const f = portasAFingir(opcoes)
  const linhas = []
  const estados = []
  const fonte = abrirFonte({ porta: 'auto', aoLinha: l => linhas.push(l), aoEstado: e => estados.push(e), deps: { SerialPort: f.SerialPort } })
  return { f, linhas, estados, fonte }
}

// Avança os relógios do teste aos bocados, deixando assentar entre cada um.
async function passar (t, ms, vezes) {
  await assentar()
  for (let i = 0; i < vezes; i++) {
    t.mock.timers.tick(ms)
    await assentar()
  }
}

test('Review Focus 2: auto escolhe a porta da caixa 1', async (t) => {
  const { f, linhas, estados, fonte } = automatica(t, {
    lista: [
      { path: 'COM3', vendorId: '046D' }, // um rato
      { path: 'COM9', vendorId: '10C4' },
      { path: 'COM5', vendorId: '10c4' },
      { path: 'COM8', vendorId: '1A86' },
      { path: 'COM1' } // uma porta da própria máquina, sem fabricante
    ],
    aoAbrir: {
      COM5: p => p.emit('data', Buffer.from('\x00\xffrst:0x1 (POWERON_RESET)\r\nlixo\r\n')),
      COM8: p => p.emit('data', Buffer.from(batimento(2) + '\n')),
      COM9: p => p.emit('data', Buffer.from('$AQL,1,2,3*00\n' + batimento(1) + '\n$AQL,123500,5210,38462*48\n'))
    }
  })
  await passar(t, 3000, 2)
  assert.deepEqual(f.criadas.map(p => p.path), ['COM5', 'COM8', 'COM9']) // por ordem do nome; a COM3 e a COM1 nunca
  assert.deepEqual(f.criadas.filter(p => p.isOpen).map(p => p.path), ['COM9'])
  assert.deepEqual(estados, [{ aberta: true, nome: 'COM9' }])
  // as linhas contam a partir do batimento que a confirmou; as das outras portas nunca
  assert.deepEqual(linhas, [batimento(1), '$AQL,123500,5210,38462*48'])
  f.criadas[2].emit('data', Buffer.from('$AQL,124000,5215,38000*00\n'))
  assert.equal(linhas.length, 3)
  fonte.fechar()
  await assentar()
  assert.equal(f.criadas[2].isOpen, false)
})

// Revisão final das caixas (23/11/2026): a caixa 1 passa pelo seu próprio cabo o batimento da caixa 2,
// que lhe chega pelo rádio. A procura desistia da porta ao ler um batimento que não fosse da caixa 1:
// com as duas caixas a funcionar, achar a caixa 1 ficava à sorte de qual dos dois batimentos chegava
// primeiro, e podia falhar muitas vezes seguidas.
test('auto: o batimento da caixa 2 que a caixa 1 retransmite não faz desistir da porta dela', async (t) => {
  const { f, linhas, estados, fonte } = automatica(t, {
    lista: [{ path: 'COM3', vendorId: '10C4' }],
    aoAbrir: { COM3: p => p.emit('data', Buffer.from(batimento(2) + '\n(12.345678) can1 0CF00400#FFFFFF004BFFFFFF*2E\n')) }
  })
  await passar(t, 400, 1) // aberta; o primeiro batimento que chegou foi o da caixa 2, vindo pelo rádio
  assert.equal(f.criadas[0].isOpen, true, 'a porta fica aberta, à espera do batimento da caixa 1')
  assert.deepEqual(estados, [])
  f.criadas[0].emit('data', Buffer.from(batimento(1) + '\n$AQL,123500,5210,38462*48\n'))
  await assentar()
  assert.deepEqual(f.criadas.map(p => p.path), ['COM3']) // uma abertura só
  assert.deepEqual(estados, [{ aberta: true, nome: 'COM3' }])
  // as linhas contam a partir do batimento da caixa 1: antes dele não se sabe se ela finge
  assert.deepEqual(linhas, [batimento(1), '$AQL,123500,5210,38462*48'])
  fonte.fechar()
})

// A porta da própria caixa 2 (ligada por USB só para ter corrente) só dá o batimento dela: larga-se no
// fim do prazo da prova, e a procura segue para a porta seguinte.
test('auto: uma porta que só dá o batimento da caixa 2 larga-se ao fim do prazo, e a seguinte é provada', async (t) => {
  const { f, estados, fonte } = automatica(t, {
    lista: [{ path: 'COM5', vendorId: '10C4' }, { path: 'COM6', vendorId: '10C4' }],
    aoAbrir: {
      COM5: p => p.emit('data', Buffer.from(batimento(2) + '\n')),
      COM6: p => p.emit('data', Buffer.from(batimento(1) + '\n'))
    }
  })
  await passar(t, 2900, 1)
  assert.deepEqual(f.criadas.map(p => p.path), ['COM5']) // ainda dentro do prazo: pode ser a caixa 1 a retransmitir
  await passar(t, 100, 1)
  assert.deepEqual(f.criadas.map(p => p.path), ['COM5', 'COM6'])
  assert.equal(f.criadas[0].isOpen, false)
  assert.deepEqual(estados, [{ aberta: true, nome: 'COM6' }])
  fonte.fechar()
})

test('Review Focus 2: a porta muda de número: perde-a, procura outra vez e encontra-a', async (t) => {
  const { f, linhas, estados, fonte } = automatica(t, {
    lista: [{ path: 'COM9', vendorId: '10C4' }],
    aoAbrir: { COM9: p => p.emit('data', Buffer.from(batimento(1) + '\n')) }
  })
  await passar(t, 0, 1)
  assert.deepEqual(estados, [{ aberta: true, nome: 'COM9' }])
  cair(f.criadas[0])
  f.lista.splice(0, 1, { path: 'COM12', vendorId: '10C4' }, { path: 'COM4', vendorId: '10C4' })
  f.aoAbrir.COM12 = p => p.emit('data', Buffer.from(batimento(1) + '\n'))
  await passar(t, 3000, 2)
  assert.deepEqual(f.criadas.map(p => p.path), ['COM9', 'COM4', 'COM12']) // a 4 antes da 12: pelo número, não pelas letras
  assert.deepEqual(estados, [
    { aberta: true, nome: 'COM9' },
    { aberta: false, nome: 'COM9', motivo: 'o cabo USB saiu ou a placa desligou-se' },
    { aberta: true, nome: 'COM12' }
  ])
  assert.deepEqual(linhas, [batimento(1), batimento(1)])
  fonte.fechar()
})

test('auto sem nenhuma caixa: diz as portas que viu e volta a tentar', async (t) => {
  const { f, linhas, estados, fonte } = automatica(t, {
    lista: [{ path: 'COM5', vendorId: '10c4' }],
    aoAbrir: { COM5: p => p.emit('data', Buffer.from('lixo\r\n')) }
  })
  await passar(t, 3000, 1)
  assert.deepEqual(estados, [{ aberta: false, nome: 'auto', motivo: 'nenhuma porta com a caixa 1 (vistas: COM5)' }])
  assert.equal(f.criadas[0].isOpen, false)
  assert.equal(f.listagens(), 1)
  await passar(t, 3000, 1)
  assert.equal(f.listagens(), 2)
  assert.deepEqual(linhas, [])
  fonte.fechar()

  const vazia = automatica(t, { lista: [] })
  await passar(t, 0, 1)
  assert.deepEqual(vazia.estados, [{ aberta: false, nome: 'auto', motivo: 'nenhuma porta com a caixa 1 (vistas: nenhuma)' }])
  vazia.fonte.fechar()
  t.mock.timers.tick(10000)
  await assentar()
  assert.equal(vazia.f.listagens(), 1) // fechada, não procura mais
})

test('auto: se não se conseguem ver as portas, diz e volta a tentar', async (t) => {
  const { f, estados, fonte } = automatica(t, { lista: [], falhaDaLista: 'sem acesso' })
  await passar(t, 0, 1)
  assert.deepEqual(estados, [{ aberta: false, nome: 'auto', motivo: 'não se conseguem ver as portas: sem acesso' }])
  f.estado.falhaDaLista = null
  await passar(t, 3000, 1)
  assert.equal(f.listagens(), 2)
  fonte.fechar()
})

test('auto: o fechar() a meio de uma prova larga a porta e não procura mais', async (t) => {
  const { f, estados, fonte } = automatica(t, {
    lista: [{ path: 'COM5', vendorId: '10C4' }, { path: 'COM6', vendorId: '10C4' }]
  })
  await passar(t, 1000, 1) // a COM5 aberta, à espera do batimento
  assert.equal(f.criadas[0].isOpen, true)
  fonte.fechar()
  await passar(t, 10000, 2)
  assert.deepEqual(f.criadas.map(p => p.path), ['COM5'])
  assert.equal(f.criadas[0].isOpen, false)
  assert.deepEqual(estados, [])
})

// --- TCP (a caixa a fingir) ----------------------------------------------------------------------

async function esperar (condicao, ms = 3000) {
  const fim = Date.now() + ms
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('esperei de mais')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('tcp: liga, recebe linhas e religa quando o outro lado fecha', async () => {
  const ligacoes = []
  const servidor = net.createServer((s) => {
    ligacoes.push(s)
    s.on('error', () => {})
    s.write(`linha ${ligacoes.length}\r\nmeia`)
    if (ligacoes.length === 1) setTimeout(() => s.destroy(), 20)
  })
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const nome = `tcp://127.0.0.1:${servidor.address().port}`
  const linhas = []
  const estados = []
  const fonte = abrirFonte({ porta: nome, aoLinha: l => linhas.push(l), aoEstado: e => estados.push(e), deps: { religar: 50 } })
  try {
    await esperar(() => ligacoes.length === 2 && linhas.length === 2)
    assert.deepEqual(linhas, ['linha 1', 'linha 2']) // a "meia" da primeira ligação não se cola à segunda
    assert.deepEqual(estados.map(e => e.aberta), [true, false, true])
    assert.deepEqual(estados[0], { aberta: true, nome })
    assert.equal(estados[1].nome, nome)
  } finally {
    fonte.fechar()
    for (const s of ligacoes) s.destroy()
    await new Promise(resolve => servidor.close(resolve))
  }
})

test('tcp: sem ninguém do outro lado, diz e volta a tentar; um endereço mal escrito diz-se uma vez', async () => {
  // uma porta livre: abre-se, vê-se o número e fecha-se
  const livre = await new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
  const estados = []
  const fonte = abrirFonte({ porta: `tcp://127.0.0.1:${livre}`, aoLinha: () => {}, aoEstado: e => estados.push(e), deps: { religar: 20 } })
  try {
    await esperar(() => estados.length >= 2)
    assert.equal(estados[0].aberta, false)
    assert.match(estados[0].motivo, /ECONNREFUSED/)
  } finally {
    fonte.fechar()
  }

  const mal = []
  const outra = abrirFonte({ porta: 'tcp://sem-porta', aoLinha: () => {}, aoEstado: e => mal.push(e), deps: { religar: 20 } })
  await new Promise(resolve => setTimeout(resolve, 100))
  outra.fechar()
  assert.deepEqual(mal, [{ aberta: false, nome: 'tcp://sem-porta', motivo: 'endereço mal escrito: tem de ser tcp://máquina:porta' }])
})

// --- a biblioteca da porta série -----------------------------------------------------------------

test('pedirSerialport: usa a do servidor quando o plugin não a tem, e diz que falta quando não há', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-fonte-'))
  try {
    const vazia = path.join(pasta, 'vazia')
    const servidor = path.join(pasta, 'servidor')
    fs.mkdirSync(vazia)
    fs.mkdirSync(path.join(servidor, 'node_modules', 'serialport'), { recursive: true })
    fs.writeFileSync(path.join(servidor, 'node_modules', 'serialport', 'index.js'), 'module.exports = { SerialPort: { list () { return "a do servidor" } } }\n')
    assert.equal(pedirSerialport([vazia, servidor]).SerialPort.list(), 'a do servidor')
    assert.throws(() => pedirSerialport([vazia]), /falta a biblioteca "serialport"/)
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true })
  }
})
