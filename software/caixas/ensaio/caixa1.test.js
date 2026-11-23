'use strict'
// Ensaios com a caixa 1 verdadeira ligada ao portátil por USB.
//   ARLEQUIN_CAIXA1=COM3 npm test        (na pasta software/caixas)
// Sem a variável, saltam-se todos e dizem porquê. Cada linha que chega é lida pelo ler() do plugin das
// caixas, que é quem as vai ler no barco.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { abrir, comPlaca, espera } = require('./placa')
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

// A versão que a placa tem de dizer é a do programa que está nesta pasta (o que se acabou de gravar).
const VERSAO = /#define\s+AQ_VERSAO\s+"([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, '..', 'comum', 'src', 'arlequin_versao.h'), 'utf8'))[1]

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
    assert.equal(x.fw, VERSAO, 'a placa não tem o programa desta pasta: gravar com npm run gravar:1')
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
  // o contador do log é desde o arranque: não tem de estar a zero, tem é de não mexer
  const log = linhas.map(ler).filter(l => l && l.tipo === 'log')
  assert.ok(log.every(l => l.impulsos === log[0].impulsos), 'apareceram impulsos do log')
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

// --- A roda do log (impulsos a fingir feitos pela própria placa, no pino do log) ---------------------
const contas = require('../../signalk-arlequin-caixas/lib/contas')
const logs = (linhas) => linhas.map(ler).filter(l => l && l.tipo === 'log')
const recomecou = (p, antes) => p.ate((l) => { const b = batimento1(l); return b && b.ms < antes.ms ? b : null }, 12000, 'a caixa a recomeçar')

test('log a 26 impulsos por segundo: a conta do portátil dá 5,2 nós', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('log', 26), 'ok')
  await espera(1200)
  const l = logs(await p.linhas(5000))
  assert.ok(l.length >= 9 && l.length <= 11, `${l.length} linhas do log em 5 s`)
  for (let i = 1; i < l.length; i++) assert.ok(Math.abs(l[i].ms - l[i - 1].ms - 500) <= 30, `linhas do log a ${l[i].ms - l[i - 1].ms} ms`)
  const porSegundo = (l.at(-1).impulsos - l[0].impulsos) / ((l.at(-1).ms - l[0].ms) / 1000)
  assert.ok(Math.abs(porSegundo - 26) <= 1, `${porSegundo.toFixed(2)} impulsos por segundo`)
  for (const x of l) assert.ok(Math.abs(x.periodoUs - 38462) < 385, `período de ${x.periodoUs} µs`)
  let conta = contas.novoLog()
  for (const x of l) conta = contas.juntarLog(conta, x)
  const nos = contas.velocidadeNaAgua(contas.hzLog(conta)) / contas.NO
  assert.ok(Math.abs(nos - 5.2) < 0.1, `${nos.toFixed(2)} nós`)
  assert.equal(await p.manda('parar'), 'ok')
}))

test('Review Focus 5: com a roda parada a contagem não mexe, e sem dois impulsos o período é 0', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('log', 26), 'ok')
  await espera(1500)
  assert.equal(await p.manda('log', 0), 'ok')
  await espera(600)
  const parado = logs(await p.linhas(3000))
  assert.ok(parado.length >= 5, `${parado.length} linhas do log em 3 s`)
  assert.ok(parado[0].impulsos > 20, `só ${parado[0].impulsos} impulsos contados`)
  assert.ok(parado.every(x => x.impulsos === parado[0].impulsos), 'a contagem mexeu com a roda parada')
  // uma caixa acabada de arrancar: nem impulsos nem período
  const antes = await proximoBatimento(p)
  assert.equal(await p.manda('prender'), 'ok')
  await recomecou(p, antes)
  const novo = logs(await p.linhas(2500))
  assert.ok(novo.length >= 3, `${novo.length} linhas do log depois de recomeçar`)
  assert.ok(novo.every(x => x.impulsos === 0 && x.periodoUs === 0), JSON.stringify(novo[0]))
}))

test('Review Focus 5: impulsos duplos (a menos de 4 ms um do outro) contam como um', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('log', 400), 'ok') // muito acima do que a roda dá: 2,5 ms entre impulsos
  await espera(1000)
  const l = logs(await p.linhas(3000))
  const porSegundo = (l.at(-1).impulsos - l[0].impulsos) / ((l.at(-1).ms - l[0].ms) / 1000)
  assert.ok(porSegundo > 150 && porSegundo <= 250, `${porSegundo.toFixed(1)} impulsos por segundo`)
  assert.equal(await p.manda('parar'), 'ok')
  assert.equal(await p.manda('log', 1000), 'fora-dos-limites')
}))

// --- O vento (a frase a fingir sai de uma segunda porta série da placa, para o próprio pino do vento) --
const ventos = (linhas) => linhas.filter(l => /^\$..MWV,/.test(l))

test('vento a fingir: a frase passa tal e qual, e o portátil lê 35° e 14 nós', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('vento', 350, 140), 'ok')
  const linhas = await p.linhas(4500)
  const v = ventos(linhas)
  assert.ok(v.length >= 3 && v.length <= 5, `${v.length} frases de vento em 4,5 s`)
  for (const f of v) {
    assert.equal(f, '$IIMWV,35.0,R,14.0,N,A*3E')
    const l = ler(f)
    assert.equal(l.angulo, 35)
    assert.ok(Math.abs(l.velocidade - 7.202216) < 1e-6)
  }
  assert.ok(linhas.map(ler).every(Boolean), 'saiu uma linha que o portátil não lê')
  assert.ok(batimentos(linhas).every(b => b.sim === true), 'a caixa não disse que fingia')
  assert.equal(await p.manda('parar'), 'ok')
  await espera(1200)
  assert.equal(ventos(await p.linhas(2500)).length, 0, 'o vento continuou depois de parar')
}))

test('Review Focus 4: lixo na entrada do vento nunca dá uma frase, e a caixa não se cala', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('vento', -1, 0), 'ok') // soma errada, frase cortada a meio e bytes ao acaso
  const linhas = await p.linhas(5000)
  assert.equal(ventos(linhas).length, 0, `saiu uma frase de vento: ${ventos(linhas)[0]}`)
  assert.ok(linhas.map(ler).every(Boolean), 'saiu uma linha que o portátil não lê')
  const b = batimentos(linhas)
  assert.ok(b.length >= 4, `só ${b.length} batimentos em 5 s`)
  assert.equal(await p.manda('parar'), 'ok')
}))

test('outras frases do mostrador não passam: só o MWV', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('vento', 3599, 5, 1), 'ok') // o terceiro valor junta um $IIVWR por segundo
  const linhas = await p.linhas(4000)
  assert.ok(ventos(linhas).length >= 3, `${ventos(linhas).length} frases de vento em 4 s`)
  assert.ok(ventos(linhas).every(f => f.startsWith('$IIMWV,359.9,R,0.5,N,A*')), ventos(linhas)[0])
  assert.ok(linhas.every(l => !/VWR/.test(l)), 'passou uma frase que não é o MWV')
  assert.ok(linhas.map(ler).every(Boolean), 'saiu uma linha que o portátil não lê')
  assert.equal(await p.manda('parar'), 'ok')
  assert.equal(await p.manda('vento', 3600, 10), 'fora-dos-limites')
}))

// Visto na placa a 23/11: com a porta do vento ligada pelo caminho direto do pino, a leitura morria mal
// o gerador escrevia no pino, e só voltava com um recomeço. O comando "estado" dá os contadores da caixa.
const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))

test('o gerador do vento liga e desliga sem a leitura morrer, e a caixa conta o que entra pelo pino', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  const antes = contadores(await p.manda('estado'))
  for (const chave of ['vento-mexidas', 'vento-bytes', 'vento-frases', 'vento-invalidas', 'perdidas', 'cortadas']) {
    assert.ok(Number.isInteger(antes[chave]), `falta o contador ${chave}`)
  }
  assert.equal(await p.manda('vento', 350, 140), 'ok')
  await espera(2500)
  assert.equal(await p.manda('vento', 0, 0), 'ok')
  await espera(500)
  assert.equal(await p.manda('vento', 100, 50), 'ok') // outra vez, com outro vento
  const v = ventos(await p.linhas(3500))
  assert.ok(v.length >= 2, `${v.length} frases depois de voltar a ligar o gerador`)
  assert.ok(v.every(f => f.startsWith('$IIMWV,10.0,R,5.0,N,A*')), v[0])
  assert.equal(await p.manda('parar'), 'ok')
  const depois = contadores(await p.manda('estado'))
  assert.ok(depois['vento-frases'] - antes['vento-frases'] >= 3, 'as frases não foram contadas')
  assert.ok(depois['vento-bytes'] - antes['vento-bytes'] >= 100, 'os bytes não foram contados')
  assert.ok(depois['vento-mexidas'] - antes['vento-mexidas'] >= 500, 'as mudanças de nível do pino não foram contadas')
  assert.equal(depois['vento-invalidas'], antes['vento-invalidas'])
}))

// --- O movimento (leituras a fingir, 100 por segundo, com o cenário da caixa a fingir do portátil) ----
const GRAU = Math.PI / 180
const movimentos = (linhas) => linhas.map(ler).filter(l => l && l.tipo === 'movimento')

test('movimento a fingir: 10 linhas por segundo, com a média de cada décimo, e o portátil lê 12° de adornamento', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('movimento', 1), 'ok')
  await espera(600)
  const linhas = await p.linhas(5000)
  assert.ok(linhas.map(ler).every(Boolean), 'saiu uma linha que o portátil não lê')
  const m = movimentos(linhas)
  assert.ok(m.length >= 49 && m.length <= 51, `${m.length} linhas do movimento em 5 s`)
  for (let i = 1; i < m.length; i++) assert.equal(m[i].n, m[i - 1].n + 1, 'saltou um número de ordem')
  assert.ok(m.every(x => x.k >= 9 && x.k <= 11), `leituras por linha: ${[...new Set(m.map(x => x.k))]}`)
  const eixos = contas.eixos('+y', '+z')
  for (const x of m) {
    const a = contas.atitude(x.q.map(v => v / 10000), eixos)
    assert.ok(Math.abs(a.roll / GRAU - 12) < 0.5, `adornamento de ${(a.roll / GRAU).toFixed(2)}°`)
    assert.ok(a.heading / GRAU > 241.5 && a.heading / GRAU < 248.5, `proa de ${(a.heading / GRAU).toFixed(1)}°`)
    assert.ok(Math.abs(a.pitch / GRAU) < 2.5, `caimento de ${(a.pitch / GRAU).toFixed(2)}°`)
    const g = Math.hypot(...x.a) / 1000
    assert.ok(g > 9.3 && g < 10.3, `aceleração de ${g.toFixed(2)} m/s²`)
    assert.equal(x.estado, 3)
  }
  const b = batimentos(linhas)
  assert.ok(b.every(x => x.sim === true && x.sensor === 4), 'a caixa não disse que o movimento era a fingir')
  assert.equal(await p.manda('parar'), 'ok')
}))

test('sem leituras do sensor não há linhas do movimento, e o número de ordem não avança sozinho', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('movimento', 1), 'ok')
  const antes = movimentos(await p.linhas(1200))
  assert.equal(await p.manda('movimento', 0), 'ok')
  await espera(400)
  const parado = await p.linhas(2500)
  assert.equal(movimentos(parado).length, 0, 'continuaram a sair linhas do movimento')
  assert.ok(batimentos(parado).every(x => x.sensor !== 4 && x.sim === false))
  assert.equal(await p.manda('movimento', 1), 'ok')
  const depois = movimentos(await p.linhas(1200))
  assert.ok(antes.length > 0 && depois.length > 0)
  assert.ok(depois[0].n - antes.at(-1).n <= 5, `o número de ordem andou ${depois[0].n - antes.at(-1).n} com o sensor calado`)
  assert.equal(await p.manda('parar'), 'ok')
  assert.equal(await p.manda('movimento', 2), 'fora-dos-limites')
}))

// --- Revisão final das caixas (23/11/2026) ------------------------------------------------------------

// A caixa dizia que fingia só no batimento seguinte, até um segundo depois de as primeiras linhas a
// fingir já terem saído: nesse intervalo o portátil tomava-as por medições.
const semFingir = (p) => p.ate((l) => { const b = batimento1(l); return b && !b.sim ? b : null }, 2500, 'um batimento sem fingir')
const eMovimento = (l) => { const x = ler(l); return Boolean(x && x.tipo === 'movimento') }
const eVento = (l) => /^\$..MWV,/.test(l)

for (const [nome, valores, eAFingir] of [['movimento', [1], eMovimento], ['vento', [350, 140], eVento]]) {
  test(`ao ligar o ${nome} a fingir, a caixa diz que finge antes de sair a primeira linha a fingir`, COM_PLACA, () => comACaixa(async (p) => {
    assert.equal(await p.manda('parar'), 'ok')
    await espera(300)
    await semFingir(p)
    await espera(150) // longe do batimento seguinte: sem o aviso imediato, ele só vinha uns 850 ms depois
    const vistas = []
    const parar = p.ouvir((l) => vistas.push(l))
    assert.equal(await p.manda(nome, ...valores), 'ok')
    await p.ate(eAFingir, 2500, `uma linha a fingir do ${nome}`)
    parar()
    const primeira = vistas.findIndex(eAFingir)
    assert.ok(primeira >= 0, `não saiu nenhuma linha a fingir do ${nome}`)
    const avisou = vistas.slice(0, primeira).some((l) => { const b = batimento1(l); return Boolean(b && b.sim) })
    assert.ok(avisou, `a primeira linha a fingir do ${nome} saiu antes de a caixa dizer que fingia`)
    assert.equal(await p.manda('parar'), 'ok')
  }))
}

// Um fio no ar a apanhar ruído, ou um comparador a oscilar, davam uma interrupção por cada flanco, sem
// limite: o ciclo principal deixava de correr e o cão de guarda reiniciava a caixa uma vez e outra, e
// com ela o vento, o log, o movimento e o que vem do motor. A avalanche de bancada é uma onda de 1 MHz
// feita pelo próprio chip no pino de entrada, que continua mesmo com o ciclo principal parado.
const hzDoLog = (l) => (l.at(-1).impulsos - l[0].impulsos) / ((l.at(-1).ms - l[0].ms) / 1000)

async function aguentaAAvalanche (p, qual) {
  assert.equal(await p.manda('parar'), 'ok')
  const antes = await proximoBatimento(p)
  const contados = contadores(await p.manda('estado'))
  assert.equal(await p.manda('avalanche', qual, 1000), 'ok')
  const linhas = await p.linhas(8000) // mais do que os 5 s do cão de guarda
  const b = batimentos(linhas)
  assert.ok(b.length >= 7, `só ${b.length} batimentos em 8 s de avalanche`)
  assert.ok(b.every(x => x.ms > antes.ms), 'a caixa recomeçou')
  for (let i = 1; i < b.length; i++) assert.ok(b[i].ms - b[i - 1].ms <= 1200, `batimentos a ${b[i].ms - b[i - 1].ms} ms um do outro`)
  assert.ok(b.every(x => x.sim === true), 'a caixa não disse que fingia')
  assert.ok(linhas.map(ler).every(Boolean), `saiu uma linha que o portátil não lê: ${linhas.find(l => !ler(l))}`)
  // a meio da avalanche a caixa continua a obedecer
  const durante = contadores(await p.manda('estado'))
  assert.equal(await p.manda('parar'), 'ok')
  await espera(300)
  const depois = await proximoBatimento(p)
  assert.ok(depois.ms > antes.ms, 'a caixa recomeçou')
  assert.equal(depois.arranque, antes.arranque)
  return { linhas, contados, durante }
}

test('avalanche na entrada do log (1 MHz): a caixa continua a dar o batimento, obedece e não recomeça', COM_PLACA, () => comACaixa(async (p) => {
  const { linhas, contados, durante } = await aguentaAAvalanche(p, 1)
  // a contagem não dispara: no máximo um impulso de 4 em 4 ms
  const l = logs(linhas)
  assert.ok(l.length >= 14, `${l.length} linhas do log em 8 s`)
  assert.ok(hzDoLog(l) <= 255, `${hzDoLog(l).toFixed(0)} impulsos por segundo contados na avalanche`)
  assert.ok(durante['log-recusados'] - contados['log-recusados'] >= 1000, 'a caixa não contou os flancos a mais que recusou')
  // e a entrada fica como estava: a roda a fingir volta a contar certo
  assert.equal(await p.manda('log', 26), 'ok')
  await espera(1200)
  const certo = logs(await p.linhas(3000))
  assert.ok(Math.abs(hzDoLog(certo) - 26) <= 1.5, `${hzDoLog(certo).toFixed(2)} impulsos por segundo depois da avalanche`)
  assert.equal(await p.manda('parar'), 'ok')
}))

test('avalanche na entrada do vento (1 MHz): a caixa continua a dar o batimento, obedece e não recomeça', COM_PLACA, () => comACaixa(async (p) => {
  const { linhas, contados, durante } = await aguentaAAvalanche(p, 2)
  assert.equal(ventos(linhas).length, 0, `saiu uma frase de vento da avalanche: ${ventos(linhas)[0]}`)
  assert.ok(durante.avalanches - contados.avalanches >= 1000, 'a caixa não deu pela avalanche')
  // e a entrada fica como estava: o vento a fingir volta a passar
  assert.equal(await p.manda('vento', 350, 140), 'ok')
  const v = ventos(await p.linhas(3500))
  assert.ok(v.length >= 2, `${v.length} frases de vento depois da avalanche`)
  assert.ok(v.every(f => f === '$IIMWV,35.0,R,14.0,N,A*3E'), v[0])
  assert.equal(await p.manda('parar'), 'ok')
  assert.equal(await p.manda('avalanche', 3, 1000), 'fora-dos-limites')
  assert.equal(await p.manda('avalanche', 1, 5000), 'fora-dos-limites')
}))

// Um recomeço da placa não apaga o que os pinos tinham. Visto na placa a 23/11/2026: com a avalanche na
// entrada do vento a caixa recomeçava e ficava presa a arrancar, calada, até lhe cortarem a corrente (a
// interrupção do pino continuava ligada de antes do recomeço, sem ninguém para a atender). Aqui força-se
// o recomeço com a avalanche a decorrer: a onda do chip, como um sinal de fora, não para com ele.
for (const [nome, qual] of [['do log', 1], ['do vento', 2]]) {
  test(`a caixa que recomeça a meio de uma avalanche na entrada ${nome} volta a arrancar e fica a funcionar`, COM_PLACA, () => comACaixa(async (p) => {
    assert.equal(await p.manda('parar'), 'ok')
    const antes = await proximoBatimento(p)
    assert.equal(await p.manda('avalanche', qual, 1000), 'ok')
    await espera(1500)
    assert.equal(await p.manda('prender'), 'ok')
    const depois = await recomecou(p, antes)
    assert.ok(CAO_DE_GUARDA.includes(depois.arranque), `motivo do arranque: ${depois.arranque}`)
    const linhas = await p.linhas(4000)
    const b = batimentos(linhas)
    assert.ok(b.length >= 3, `só ${b.length} batimentos em 4 s depois de recomeçar`)
    assert.ok(b.every(x => x.sim === false), 'a avalanche sobreviveu ao recomeço')
    assert.ok(linhas.map(ler).every(Boolean), `saiu uma linha que o portátil não lê: ${linhas.find(l => !ler(l))}`)
    // e as duas entradas ficam a funcionar
    assert.equal(await p.manda('log', 26), 'ok')
    assert.equal(await p.manda('vento', 350, 140), 'ok')
    await espera(1200)
    const aSeguir = await p.linhas(3500)
    assert.ok(Math.abs(hzDoLog(logs(aSeguir)) - 26) <= 1.5, `${hzDoLog(logs(aSeguir)).toFixed(2)} impulsos por segundo depois de recomeçar`)
    assert.ok(ventos(aSeguir).length >= 2, `${ventos(aSeguir).length} frases de vento depois de recomeçar`)
    assert.equal(await p.manda('parar'), 'ok')
  }))
}
