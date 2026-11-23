'use strict'
// Ensaios com a caixa 1 verdadeira ligada ao portátil por USB.
//   ARLEQUIN_CAIXA1=COM3 npm test        (na pasta software/caixas)
// Sem a variável, saltam-se todos e dizem porquê. Cada linha que chega é lida pelo ler() do plugin das
// caixas, que é quem as vai ler no barco.
const test = require('node:test')
const assert = require('node:assert/strict')
const { abrir, comPlaca, espera } = require('./placa')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const PORTA = comPlaca('ARLEQUIN_CAIXA1')
const COM_PLACA = PORTA ? {} : { skip: 'sem a placa ligada: definir ARLEQUIN_CAIXA1=COMx' }
// os motivos de arranque que o chip dá quando é um cão de guarda a reiniciá-lo (ver o README das caixas)
const CAO_DE_GUARDA = [5, 6, 7]

const batimento1 = (linha) => {
  const b = ler(linha)
  return b && b.tipo === 'batimento' && b.caixa === 1 ? b : null
}
const batimentos = (linhas) => linhas.map(batimento1).filter(Boolean)
const proximoBatimento = (p, ms = 2500) => p.ate(batimento1, ms, 'o batimento da caixa 1')

// Abre a porta, corre o ensaio e fecha-a sempre, corra como correr.
async function comACaixa (ensaio) {
  const p = await abrir(PORTA)
  try {
    await ensaio(p)
  } finally {
    await p.fechar()
  }
}

test('batimento desde o primeiro segundo, com a versão e sem fingir', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await proximoBatimento(p) // um batimento já sem geradores
  const linhas = await p.linhas(6000)
  const lidas = linhas.map(ler)
  assert.ok(lidas.every(Boolean), `linha que o portátil não lê: ${linhas[lidas.indexOf(null)]}`)
  const b = batimentos(linhas)
  assert.ok(b.length >= 5 && b.length <= 7, `${b.length} batimentos em 6 s`)
  for (let i = 1; i < b.length; i++) {
    const passo = b[i].ms - b[i - 1].ms
    assert.ok(passo >= 950 && passo <= 1050, `batimentos a ${passo} ms um do outro`)
  }
  for (const x of b) {
    assert.equal(x.fw, '0.2.0')
    assert.equal(x.sim, false)
    assert.equal(x.rssi, 0)
    assert.ok([0, 1, 2, 3].includes(x.sensor), `estado do sensor: ${x.sensor}`)
    assert.ok(Number.isInteger(x.arranque) && Number.isInteger(x.rsts))
  }
}))

test('abrir e fechar a porta não reinicia a caixa', COM_PLACA, async () => {
  let antes = null
  for (let vez = 1; vez <= 3; vez++) {
    const p = await abrir(PORTA)
    const b = await proximoBatimento(p).finally(() => p.fechar())
    const agora = Date.now()
    if (antes) {
      const naCaixa = b.ms - antes.ms
      const noPortatil = agora - antes.hora
      assert.ok(Math.abs(naCaixa - noPortatil) < 400, `à ${vez}.ª abertura a caixa andou ${naCaixa} ms e o portátil ${noPortatil} ms`)
    }
    antes = { ms: b.ms, hora: agora }
    await espera(700)
  }
})

test('lixo e comandos sem soma não fazem nada', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  let semente = 20261123
  const acaso = Buffer.from(Array.from({ length: 300 }, () => { semente = (semente * 1103515245 + 12345) >>> 0; return semente >>> 24 }))
  await p.escreve(acaso)
  await p.escreve('\n$AQC,log,26*00\n$AQC,log,26\n$AQC,log\n$AQC*00\n')
  const linhas = await p.linhas(3500)
  const b = batimentos(linhas)
  assert.ok(b.length >= 3, `só ${b.length} batimentos depois do lixo`)
  assert.ok(b.every(x => x.sim === false), 'a caixa passou a dizer que finge')
  const log = linhas.map(ler).filter(l => l && l.tipo === 'log')
  assert.ok(log.every(l => l.impulsos === 0), 'apareceram impulsos do log')
}))

test('um gerador ligado obriga a caixa a dizer que finge', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('log', 26), 'ok')
  assert.equal((await p.ate((l) => { const b = batimento1(l); return b && b.sim ? b : null }, 2500, 'um batimento a fingir')).sim, true)
  assert.equal(await p.manda('parar'), 'ok')
  await p.ate((l) => { const b = batimento1(l); return b && !b.sim ? b : null }, 2500, 'um batimento sem fingir')
  assert.match(await p.manda('nao-existe'), /^desconhecido/)
}))

test('cão de guarda: a caixa presa recomeça sozinha e diz porquê', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('log', 26), 'ok')
  const antes = await proximoBatimento(p)
  assert.equal(await p.manda('prender'), 'ok')
  const depois = await p.ate((l) => { const b = batimento1(l); return b && b.ms < antes.ms ? b : null }, 12000, 'a caixa a recomeçar')
  assert.ok(depois.ms < 5000, `o primeiro batimento depois de recomeçar vem aos ${depois.ms} ms`)
  assert.ok(CAO_DE_GUARDA.includes(depois.arranque), `motivo do arranque: ${depois.arranque}`)
  assert.equal(depois.sim, false, 'os geradores não podem sobreviver a um recomeço')
}))

test('Review Focus 1: o portátil deixa de ler 20 s e a caixa nem dá por isso', COM_PLACA, async () => {
  let p = await abrir(PORTA)
  let antes
  try {
    assert.equal(await p.manda('log', 50), 'ok')
    antes = { b: await proximoBatimento(p), hora: Date.now() }
  } finally {
    await p.fechar()
  }
  await espera(20000)
  p = await abrir(PORTA)
  try {
    const primeiras = await p.linhas(1500)
    assert.ok(primeiras.length > 0, 'nada chegou depois de reabrir')
    assert.ok(ler(primeiras[0]), `a primeira linha depois de reabrir não se lê: ${primeiras[0]}`)
    const b = await proximoBatimento(p)
    const naCaixa = b.ms - antes.b.ms
    const noPortatil = Date.now() - antes.hora
    assert.ok(Math.abs(naCaixa - noPortatil) < 1200, `a caixa andou ${naCaixa} ms e o portátil ${noPortatil} ms: recomeçou?`)
    assert.equal(b.sim, true)
  } finally {
    await p.manda('parar').catch(() => {})
    await p.fechar()
  }
})
