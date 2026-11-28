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
const { enganosDoRecente } = require('./recente')
const { enxurrada, respostas } = require('./enxurrada')
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
  // muito acima do que a roda dá: 3,3 ms entre voltas, cada uma com o pino 2,8 ms em cima. Conta uma sim,
  // uma não
  const r = await rodaPorDentro(p, 300, 15, 0, 2000)
  assert.ok(r.voltas >= 500, `${r.voltas} voltas em 2 s a 300 por segundo`)
  assert.ok(r.impulsos >= r.voltas * 0.45 && r.impulsos <= r.voltas * 0.55, `${r.impulsos} impulsos em ${r.voltas} voltas`)
  assert.equal(await p.manda('log', 1000), 'fora-dos-limites')
}))

// A roda por fora: o pino D26 faz de roda (fechada quase a volta toda, aberta uma vez por volta) e só
// chega ao pino do log se houver um fio do D26 à plaquinha (ensaio/roda-por-fora.js). Aqui, sem esse fio.
test('roda por fora: sem o fio do D26 não entra nada pelo pino da roda, a caixa diz que finge e conta as voltas que deu', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  const antes = logs(await p.linhas(1200)).at(-1)
  assert.equal(await p.manda('roda', 26, 15), 'ok')
  const linhas = await p.linhas(3000)
  const b = batimentos(linhas)
  assert.ok(b.length >= 3, `${b.length} batimentos em 3 s`)
  assert.ok(b.every(x => x.sim === true), 'a caixa não disse que fingia')
  const voltas = Number(await p.manda('roda', 0))
  assert.ok(voltas >= 72 && voltas <= 86, `${voltas} voltas em cerca de 3 s, a 26 por segundo`)
  await espera(700)
  const depois = logs(await p.linhas(1200)).at(-1)
  assert.equal(depois.impulsos, antes.impulsos, 'entrou alguma coisa pelo pino da roda sem fio nenhum')
  assert.equal((await proximoBatimento(p)).sim, false, 'a caixa continua a dizer que finge depois de a roda parar')
  // a contagem das voltas recomeça de cada vez que a roda se liga, e o "parar" também a para
  assert.equal(await p.manda('roda', 50), 'ok')
  await espera(1000)
  assert.equal(await p.manda('parar'), 'ok')
  const segunda = Number(await p.manda('roda', 0))
  assert.ok(segunda >= 40 && segunda <= 60, `${segunda} voltas em cerca de 1 s, a 50 por segundo`)
  assert.equal((await proximoBatimento(p)).sim, false)
  for (const fora of [[101], [-1], [26, 4], [26, 61]]) {
    assert.equal(await p.manda('roda', ...fora), 'fora-dos-limites', `roda,${fora.join(',')}`)
  }
}))

// A roda por dentro: o mesmo gerador, mas a mexer no próprio pino do log, sem fio nenhum (o quarto valor do
// comando a 1). Faz de roda verdadeira (fechada quase a volta toda, aberta uma vez por volta) e diz quantas
// voltas deu: o log tem de contar exatamente essas. O terceiro valor é um ressalto do contacto ao abrir:
// 300 µs depois de abrir, fecha outra vez durante esses microssegundos.
async function rodaPorDentro (p, hz, aberta, ressalto, ms) {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const impulsosAntes = logs(await p.linhas(1200)).at(-1).impulsos
  const recusadosAntes = contadores(await p.manda('estado'))['log-recusados']
  assert.equal(await p.manda('roda', hz, aberta, ressalto, 1), 'ok')
  await espera(ms)
  const voltas = Number(await p.manda('roda', 0))
  await espera(700) // a última volta ainda pode estar por contar
  const impulsos = logs(await p.linhas(1200)).at(-1).impulsos - impulsosAntes
  const recusados = contadores(await p.manda('estado'))['log-recusados'] - recusadosAntes
  return { voltas, impulsos, recusados }
}

test('a roda por dentro, devagar e depressa: o log conta exatamente as voltas que ela deu', COM_PLACA, () => comACaixa(async (p) => {
  for (const hz of [2, 26, 60, 100]) {
    const r = await rodaPorDentro(p, hz, 15, 0, 3000)
    assert.ok(r.voltas >= hz * 2.5, `${r.voltas} voltas em 3 s a ${hz} por segundo`)
    assert.equal(r.impulsos, r.voltas, `a ${hz} voltas por segundo: ${r.impulsos} impulsos em ${r.voltas} voltas`)
  }
  assert.equal((await proximoBatimento(p)).sim, false, 'a caixa continua a dizer que finge depois de a roda parar')
  for (const fora of [[401, 15, 0, 1], [26, 15, 49, 1], [26, 15, 1001, 1], [100, 5, 150, 1]]) {
    assert.equal(await p.manda('roda', ...fora), 'fora-dos-limites', `roda,${fora.join(',')}`)
  }
}))

// O ponto 4 da revisão final de 28/11: uma subida do pino que não é uma volta. O contacto da roda pode
// ressaltar ao abrir, e o condensador da entrada faz o pino descer devagar, o que neste chip pode parecer
// uma subida. Com a regra antiga (toda a subida a mais de 4 ms da anterior conta), cada volta contava
// duas vezes, devagar e a meio; depressa, a subida falsa contava e a verdadeira era recusada.
test('o contacto da roda ressalta ao abrir: o ressalto não conta como volta', COM_PLACA, () => comACaixa(async (p) => {
  // um ressalto curto, devagar e depressa, e um comprido (1 ms): metade do que a regra pede para contar
  for (const [hz, ressalto] of [[2, 150], [26, 150], [60, 150], [26, 1000]]) {
    const r = await rodaPorDentro(p, hz, 15, ressalto, 3000)
    assert.ok(r.voltas >= hz * 2.5, `${r.voltas} voltas em 3 s a ${hz} por segundo`)
    assert.equal(r.impulsos, r.voltas, `a ${hz} voltas por segundo, com ressalto de ${ressalto} µs: ${r.impulsos} impulsos em ${r.voltas} voltas`)
    assert.ok(r.recusados >= r.voltas - 1, `a ${hz} voltas por segundo: só ${r.recusados} subidas recusadas em ${r.voltas} ressaltos`)
  }
  // o ressalto vem 1,5 ms depois de a roda abrir e tem de caber na parte aberta, com 0,3 ms de folga
  assert.equal(await p.manda('roda', 60, 15, 1000, 1), 'fora-dos-limites')
}))

test('uma subida que não se aguenta 2 ms em cima não é uma volta: a 500 por segundo, metade do tempo em cima, nada conta', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const antes = logs(await p.linhas(1200)).at(-1).impulsos
  const recusadosAntes = contadores(await p.manda('estado'))['log-recusados']
  assert.equal(await p.manda('log', 500), 'ok') // em cima 1 ms de cada vez
  await espera(2000)
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const depois = logs(await p.linhas(1200)).at(-1).impulsos
  // uma em mil ainda se admite: o temporizador que faz a onda pode atrasar-se 1 ms uma vez por acaso
  assert.ok(depois - antes <= 1, `contaram-se ${depois - antes} voltas em 2 s de subidas que não se aguentam`)
  assert.ok(contadores(await p.manda('estado'))['log-recusados'] - recusadosAntes >= 900, 'as subidas recusadas não foram contadas')
}))

// O comando "tempos" diz como o contacto da roda se portou desde a última vez que se perguntou, em
// microssegundos: quanto tempo o pino esteve em baixo na última volta (aberta-ult) e na mais curta
// (aberta-min), contado da descida à subida que ficou; e a subida recusada mais comprida (recusada-max).
// Mais as voltas do ciclo em que a entrada se calou por ter mudanças a mais (caladas). No barco, com a roda
// rodada à mão, é o que diz se o condensador da entrada e os 2 ms servem para o contacto verdadeiro.
test('tempos: a caixa mede quanto tempo a roda esteve aberta em cada volta e a subida recusada mais comprida', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  const chaves = ['aberta-ult', 'aberta-min', 'recusada-max', 'caladas']
  const zero = contadores(await p.manda('tempos')) // o mínimo e o máximo contam-se desde a última pergunta
  for (const k of chaves) assert.ok(Number.isInteger(zero[k]), `falta ${k} na resposta do comando tempos`)
  // a 26 voltas por segundo com 15 % da volta aberta, a roda está aberta 5,8 ms em cada volta
  await rodaPorDentro(p, 26, 15, 0, 2000)
  let t = contadores(await p.manda('tempos'))
  assert.ok(Math.abs(t['aberta-ult'] - 5769) <= 400, `aberta ${t['aberta-ult']} µs na última volta`)
  assert.ok(t['aberta-min'] >= 5369 && t['aberta-min'] <= t['aberta-ult'], `aberta ${t['aberta-min']} µs na volta mais curta`)
  assert.equal(t['recusada-max'], 0)
  assert.equal(t.caladas, zero.caladas, 'a entrada calou-se com a roda a andar normalmente')
  // com um ressalto de 150 µs: a parte aberta conta-se na mesma até à subida que ficou, e o ressalto vê-se
  await rodaPorDentro(p, 26, 15, 150, 2000)
  t = contadores(await p.manda('tempos'))
  assert.ok(Math.abs(t['aberta-ult'] - 5769) <= 400, `aberta ${t['aberta-ult']} µs na última volta, com ressalto`)
  assert.ok(t['recusada-max'] >= 100 && t['recusada-max'] <= 700, `a subida recusada mais comprida: ${t['recusada-max']} µs`)
  // perguntar outra vez sem a roda ter andado: o mínimo e o máximo recomeçam
  t = contadores(await p.manda('tempos'))
  assert.equal(t['aberta-min'], 0)
  assert.equal(t['recusada-max'], 0)
}))

// O ciclo principal pode parar umas dezenas de milissegundos (a escrever para o portátil, por exemplo). A
// contagem não pode depender dele: a interrupção confirma a subida anterior quando chega a descida seguinte.
test('o ciclo principal para dezenas de ms com a roda a andar depressa: não se perde nem se inventa volta nenhuma', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const antes = logs(await p.linhas(1200)).at(-1).impulsos
  assert.equal(await p.manda('roda', 100, 15, 0, 1), 'ok')
  for (let i = 0; i < 15; i++) {
    assert.equal(await p.manda('surto', 64, 0, 0, 30), 'ok') // o ciclo fica parado uns 50 ms
    await espera(120)
  }
  const voltas = Number(await p.manda('roda', 0))
  await espera(700)
  const impulsos = logs(await p.linhas(1200)).at(-1).impulsos - antes
  assert.ok(voltas >= 200, `${voltas} voltas`)
  assert.equal(impulsos, voltas, `${impulsos} impulsos em ${voltas} voltas, com o ciclo a parar 15 vezes`)
}))

// Ruído rápido no fio com o ciclo principal a parar: a interrupção cala-se ao fim de 16 mudanças e deixa de
// vigiar o pino. Uma subida que ficasse à espera nessa altura contava sem ninguém ter visto se o pino se
// aguentou (achado da revisão de 28/11 à regra nova).
test('ruído rápido na entrada da roda com o ciclo principal a parar: não se conta volta nenhuma', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const antes = logs(await p.linhas(1200)).at(-1).impulsos
  const caladasAntes = contadores(await p.manda('tempos')).caladas
  assert.equal(await p.manda('avalanche', 1, 1000), 'ok')
  for (let i = 0; i < 25; i++) {
    assert.equal(await p.manda('surto', 64, 0, 0, 30), 'ok')
    await espera(60)
  }
  const caladas = contadores(await p.manda('tempos')).caladas - caladasAntes
  assert.equal(await p.manda('parar'), 'ok')
  await espera(700)
  const depois = logs(await p.linhas(1200)).at(-1).impulsos
  assert.equal(depois, antes, `contaram-se ${depois - antes} voltas só com ruído no fio`)
  assert.ok(caladas >= 500, `a entrada só se calou ${caladas} vezes em 3 s de ruído: o contador das caladas não anda`)
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

// O comando "cru" devolve as últimas letras que entraram pelo pino do vento, tal e qual chegaram, e o total
// de letras entradas: é como se vê de fora o que o mostrador manda quando a caixa não lhe acha frases
// (ensaio/ouvir-vento.js, para a primeira escuta no barco). Aqui o mostrador a fingir manda o MWV e um VWR
// por segundo: o VWR, que a caixa não deixa passar nem conta, tem de aparecer na fita, e entre duas
// respostas não pode faltar letra nenhuma (o anel da caixa dá a volta três vezes durante o ensaio).
const { juntar, emLinhas } = require('./cru')

test('cru: a caixa mostra tal e qual o que entrou pelo pino do vento, incluindo as frases que não deixa passar', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(300)
  let fita = juntar(null, await p.manda('cru'))
  const antes = contadores(await p.manda('estado'))
  assert.equal(fita.total, antes['vento-bytes'], 'o total do cru não é o contador vento-bytes')
  assert.equal(await p.manda('vento', 350, 140, 1), 'ok') // o MWV e um $IIVWR por segundo
  const fim = Date.now() + 3600
  while (Date.now() < fim) {
    fita = juntar(fita, await p.manda('cru'))
    await espera(100)
  }
  assert.equal(await p.manda('parar'), 'ok')
  await espera(300)
  fita = juntar(fita, await p.manda('cru'))
  const depois = contadores(await p.manda('estado'))
  assert.equal(fita.perdidas, 0, 'faltaram letras entre duas respostas')
  assert.equal(fita.recomecos, 0)
  assert.equal(fita.bytes.length, depois['vento-bytes'] - antes['vento-bytes'], 'a fita não tem as letras todas que a caixa contou')
  const { linhas } = emLinhas(fita.bytes)
  const mwv = linhas.filter(l => l === '$IIMWV,35.0,R,14.0,N,A*3E').length
  const vwr = linhas.filter(l => l === '$IIVWR,35.0,R,14.0,N,7.2,M,25.9,K*71').length
  assert.ok(mwv >= 3, `${mwv} frases MWV inteiras na fita: ${JSON.stringify(linhas.slice(0, 4))}`)
  assert.ok(vwr >= 3, `${vwr} frases VWR inteiras na fita`)
  assert.equal(linhas.length, mwv + vwr, `há linhas na fita que não são nenhuma das duas: ${JSON.stringify(linhas.filter(l => !/^\$II(MWV|VWR)/.test(l)).slice(0, 3))}`)
}))

// O mostrador a fingir "por fora": o quarto valor do comando faz a frase sair só pelo pino TX2 e ao
// contrário (repouso em baixo, como a manda o mostrador NASA), sem a levar por dentro ao pino do vento.
// Quem a traz ao RX2 é a plaquinha do optoacoplador, e isso ensaia-se com ensaio/plaquinha-vento.js.
// Aqui a placa está sem plaquinha e sem fio nenhum no RX2: não pode entrar nada.
test('vento por fora: sem a plaquinha não entra nada pelo pino do vento, e a caixa diz que finge', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  const antes = contadores(await p.manda('estado'))
  assert.equal(await p.manda('vento', 350, 140, 0, 1), 'ok')
  const linhas = await p.linhas(4000)
  assert.equal(ventos(linhas).length, 0, `entrou uma frase de vento sem fio nenhum: ${ventos(linhas)[0]}`)
  const b = batimentos(linhas)
  assert.ok(b.length >= 3 && b.every(x => x.sim === true), 'a caixa não disse que fingia')
  const durante = contadores(await p.manda('estado'))
  assert.equal(durante['vento-bytes'], antes['vento-bytes'], 'entraram bytes pelo pino do vento sem fio nenhum')
  assert.equal(durante['vento-invalidas'], antes['vento-invalidas'])
  // e a seguir o caminho por dentro continua a servir, com a frase direita
  assert.equal(await p.manda('vento', 350, 140), 'ok')
  const v = ventos(await p.linhas(3500))
  assert.ok(v.length >= 2, `${v.length} frases de vento por dentro depois do ensaio por fora`)
  assert.ok(v.every(f => f === '$IIMWV,35.0,R,14.0,N,A*3E'), v[0])
  // de dentro para fora sem parar pelo meio: o pino do vento tem de voltar a ser só entrada
  assert.equal(await p.manda('vento', 350, 140, 0, 1), 'ok')
  await espera(1500)
  assert.equal(ventos(await p.linhas(3000)).length, 0, 'a frase continuou a ir por dentro')
  assert.equal(await p.manda('parar'), 'ok')
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

test('sem leituras do sensor não há linhas do movimento, e o número de ordem não avança sozinho', COM_PLACA, (t) => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await proximoBatimento(p)
  if ((await proximoBatimento(p)).sensor === 0) return t.skip('há um sensor a medir: sem o gerador as linhas do movimento são as dele')
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

// --- O sensor verdadeiro (BNO085 pela ligação de 10 ligações, com o INT e o RST) ----------------------
// Correm com a caixa pousada e parada, e só com um sensor a medir: sem ele saltam-se e dizem porquê.
async function comSensor (t, p) {
  assert.equal(await p.manda('parar'), 'ok')
  await proximoBatimento(p) // um batimento já sem geradores
  const b = await proximoBatimento(p)
  if (b.sensor === 0) return true
  t.skip(`o sensor não está a medir (estado ${b.sensor} no batimento)`)
  return false
}
const pousada = (x) => { const g = Math.hypot(...x.a) / 1000; return g > 9.3 && g < 10.3 }
const eResposta = (l) => l.startsWith('$AQR,')

test('movimento verdadeiro: 10 linhas por segundo, 9 ou mais leituras em cada, e a caixa pousada sente o peso', COM_PLACA, (t) => comACaixa(async (p) => {
  if (!await comSensor(t, p)) return
  const linhas = await p.linhas(5000)
  assert.ok(linhas.map(ler).every(Boolean), 'saiu uma linha que o portátil não lê')
  const m = movimentos(linhas)
  assert.ok(m.length >= 49 && m.length <= 51, `${m.length} linhas do movimento em 5 s`)
  for (let i = 1; i < m.length; i++) assert.equal(m[i].n, m[i - 1].n + 1, 'saltou um número de ordem')
  assert.ok(m.every(x => x.k >= 9), `leituras por linha: ${[...new Set(m.map(x => x.k))]}`)
  const fora = m.find(x => !pousada(x))
  assert.ok(!fora, `aceleração fora do peso: ${fora && (Math.hypot(...fora.a) / 1000).toFixed(2)} m/s²`)
  const b = batimentos(linhas)
  assert.ok(b.length >= 4 && b.every(x => x.sensor === 0 && x.sim === false), 'o batimento não disse que o sensor media')
  const c = contadores(await p.manda('sensor'))
  assert.equal(c.estado, 0)
  assert.equal(c.fase, 7)
  assert.equal(c.ilegiveis, 0)
}))

test('Review Focus 3: o sensor cala-se a meio (um toque no RST) e volta sozinho em menos de 2 s, sem o resto dar por isso', COM_PLACA, (t) => comACaixa(async (p) => {
  if (!await comSensor(t, p)) return
  assert.equal(await p.manda('log', 26), 'ok')
  await espera(1200)
  const antes = contadores(await p.manda('sensor'))
  const juntas = []
  const parar = p.ouvir((l) => juntas.push({ l, quando: Date.now() }))
  await espera(1500)
  const tocado = Date.now()
  assert.equal(await p.manda('rst'), 'ok')
  await espera(5000)
  parar()
  const lidas = juntas.map(x => ({ ...x, v: ler(x.l) }))
  const ilegivel = lidas.find(x => !x.v && !eResposta(x.l))
  assert.ok(!ilegivel, `linha que o portátil não lê: ${ilegivel && ilegivel.l}`)
  const m = lidas.filter(x => x.v && x.v.tipo === 'movimento')
  assert.ok(m.filter(x => x.quando < tocado).length >= 10, 'não havia movimento antes do toque')
  assert.ok(m.filter(x => x.quando >= tocado + 150).length > 0, 'o movimento não voltou em 5 s')
  // o maior buraco no movimento: é o do toque
  let buraco = 0
  for (let i = 1; i < m.length; i++) buraco = Math.max(buraco, m[i].quando - m[i - 1].quando)
  assert.ok(buraco > 150, `o toque no RST não calou o sensor (maior intervalo ${buraco} ms)`)
  assert.ok(buraco < 2000, `o movimento esteve ${buraco} ms calado`)
  // o número de ordem continua de onde ia: não recomeça nem salta
  for (let i = 1; i < m.length; i++) assert.equal(m[i].v.n, m[i - 1].v.n + 1, 'o número de ordem não seguiu')
  // o batimento e o log não falharam uma linha
  const b = lidas.filter(x => x.v && x.v.tipo === 'batimento' && x.v.caixa === 1).map(x => x.v)
  for (let i = 1; i < b.length; i++) {
    const passo = b[i].ms - b[i - 1].ms
    assert.ok(passo >= 950 && passo <= 1050, `batimentos a ${passo} ms um do outro durante o toque`)
  }
  const logs = lidas.filter(x => x.v && x.v.tipo === 'log').map(x => x.v)
  assert.ok(logs.length >= 12, `só ${logs.length} linhas do log em 6,5 s`)
  for (let i = 1; i < logs.length; i++) {
    const passo = logs[i].ms - logs[i - 1].ms
    assert.ok(passo >= 450 && passo <= 550, `linhas do log a ${passo} ms uma da outra durante o toque`)
  }
  assert.equal(await p.manda('parar'), 'ok')
  const depois = contadores(await p.manda('sensor'))
  assert.equal(depois.toques - antes.toques, 1, 'o contador de toques não subiu 1')
  assert.equal(depois.estado, 0)
  assert.equal((await proximoBatimento(p)).rsts, depois.toques, 'o batimento não leva os toques')
}))

test('a placa recomeça com o sensor a meio de uma frase e o movimento volta em menos de 5 s', COM_PLACA, (t) => comACaixa(async (p) => {
  if (!await comSensor(t, p)) return
  const antes = await proximoBatimento(p)
  assert.equal(await p.manda('prender'), 'ok')
  const recomecou = await p.ate((l) => { const b = batimento1(l); return b && b.ms < antes.ms ? b : null }, 12000, 'a caixa a recomeçar')
  const desde = Date.now()
  const primeira = await p.ate((l) => { const x = ler(l); return x && x.tipo === 'movimento' ? x : null }, 6000, 'o movimento depois de recomeçar')
  const demora = Date.now() - desde + recomecou.ms
  assert.ok(demora < 5000, `o movimento só voltou ${demora} ms depois de a placa recomeçar`)
  assert.ok(pousada(primeira))
  assert.equal((await proximoBatimento(p, 3000)).sensor, 0)
}))

test('guardar: o sensor grava as calibrações a pedido e continua a medir', COM_PLACA, (t) => comACaixa(async (p) => {
  if (!await comSensor(t, p)) return
  const antes = contadores(await p.manda('sensor'))
  assert.equal(await p.manda('guardar'), 'ok')
  await espera(2500)
  const depois = contadores(await p.manda('sensor'))
  assert.equal(depois.guardadas - antes.guardadas, 1, `gravações confirmadas: ${depois.guardadas - antes.guardadas}; falhadas: ${depois['por-guardar'] - antes['por-guardar']}`)
  assert.equal(depois.estado, 0)
  assert.equal(depois.toques, antes.toques, 'gravar não pode custar um toque no RST')
  assert.ok(movimentos(await p.linhas(1200)).length >= 10, 'o movimento parou depois de gravar')
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
    // O que chegou antes da resposta foi escrito antes de a caixa obedecer: com o sensor a medir, pode
    // ser uma medição verdadeira (sai uma de 100 em 100 ms), e essa não tem de vir avisada. Até 28/11
    // o ensaio contava-a como a primeira "a fingir" e falhava de vez em quando, conforme a ordem chegava
    // à caixa uns ms antes ou depois dessa medição.
    const resposta = vistas.findIndex(l => l.startsWith(`$AQR,${nome},`))
    assert.ok(resposta >= 0, `não se viu a resposta ao comando "${nome}"`)
    const depois = vistas.slice(resposta + 1)
    const primeira = depois.findIndex(eAFingir)
    assert.ok(primeira >= 0, `não saiu nenhuma linha a fingir do ${nome}`)
    const avisou = depois.slice(0, primeira).some((l) => { const b = batimento1(l); return Boolean(b && b.sim) })
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
  // a contagem não mexe: nenhuma destas subidas se aguenta 2 ms em cima
  const l = logs(linhas)
  assert.ok(l.length >= 14, `${l.length} linhas do log em 8 s`)
  assert.equal(l.at(-1).impulsos, l[0].impulsos, `${l.at(-1).impulsos - l[0].impulsos} voltas contadas na avalanche`)
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

// --- Os pontos adiados da revisão final (passo 7 da Tarefa 7, 27/11/2026) ------------------------------

// A conta dos pacotes que se perdem no rádio (AqPerdidos, em arlequin_radio.h) não tinha ensaio próprio.
// Neste portátil não há compilador para o próprio portátil: é a placa que faz a conta, com a mesma classe
// que usa no rádio. O comando de bancada "perdidos" dá-lhe números de ordem como se chegassem pacotes
// (-1 começa uma conta nova, -2 é a caixa 2 a recomeçar) e ela responde com o total de perdidos. A conta
// da bancada é outra: a do rádio verdadeiro não mexe.
async function perdidosNaPlaca (p, ordens) {
  const valores = [-1, ...ordens.map(o => (o === 'recomeça' ? -2 : o))]
  let total = ''
  for (let i = 0; i < valores.length; i += 4) total = await p.manda('perdidos', ...valores.slice(i, i + 4))
  return total
}

const PERDIDOS = [
  ['o primeiro pacote não conta', [777], 0],
  ['pacotes em ordem', [10, 11, 12, 13], 0],
  ['um salto de três', [10, 11, 15], 3],
  ['dois saltos somam-se', [10, 12, 13, 16], 3],
  ['a volta do número de ordem, sem perdas', [65534, 65535, 0, 1], 0],
  ['a volta do número de ordem, com quatro perdidos pelo meio', [65533, 2], 4],
  ['um pacote repetido', [10, 11, 11, 12], 0],
  ['um pacote atrasado não conta nem faz a conta andar para trás', [10, 11, 12, 10, 13], 0],
  ['atrasado 255 pacotes ainda é um atrasado', [1000, 745, 1001], 0],
  ['256 para trás já é um recomeço mal apanhado: conta-se a partir daí', [1000, 744, 746], 1],
  ['um salto de 1000 ainda conta', [0, 1001], 1000],
  ['um salto de mais de 1000 é um recomeço mal apanhado: não conta', [0, 1002], 0],
  ['depois de um recomeço mal apanhado conta-se a partir daí', [0, 1002, 1004], 1],
  ['a caixa 2 recomeça com o número de ordem lá no alto: não são 535 perdidos', [65000, 'recomeça', 0, 1], 0],
  ['a caixa 2 recomeça pouco depois de arrancar: volta logo a contar', [100, 'recomeça', 0, 3], 2]
]

test('a conta dos pacotes perdidos no rádio: saltos, a volta do número de ordem, repetidos, atrasados e recomeços', COM_PLACA, () => comACaixa(async (p) => {
  // a tabela corre toda, para uma conta estragada mostrar de uma vez todos os casos em que se engana
  const enganos = []
  for (const [nome, ordens, esperado] of PERDIDOS) {
    const total = await perdidosNaPlaca(p, ordens)
    if (total !== String(esperado)) enganos.push(`${nome} (${ordens.join(', ')}): deu ${total}, devia dar ${esperado}`)
  }
  assert.deepEqual(enganos, [])
  assert.equal(await p.manda('perdidos', 65536), 'fora-dos-limites')
  assert.equal(await p.manda('perdidos', -3), 'fora-dos-limites')
  // um valor fora dos limites recusa o comando inteiro: o 13 que vinha antes dele não chegou a contar
  assert.equal(await p.manda('perdidos', -1, 10), '0')
  assert.equal(await p.manda('perdidos', 13, 70000), 'fora-dos-limites')
  assert.equal(await p.manda('perdidos', 13), '2')
}))

// O rádio da caixa 2 só manda enquanto ouvir o sinal da caixa 1. A conta "há quanto tempo chegou o
// sinal" (aqRecente, em arlequin_radio.h) é da biblioteca comum às duas caixas, e a caixa 1 também a põe
// à prova, com o comando de bancada "recente": é ela que está sempre ligada ao portátil. A tabela dos
// casos, e o que estava mal, estão em ensaio/recente.js.
test('há quanto tempo chegou o sinal da outra caixa: a conta não se engana a meio da volta do ciclo nem com o relógio a dar a volta', COM_PLACA, () => comACaixa(async (p) => {
  assert.deepEqual(await enganosDoRecente(p), [])
  assert.equal(await p.manda('recente', 1000, 1000, 60001), 'fora-dos-limites')
  assert.equal(await p.manda('recente', 1000, 1000, -1), 'fora-dos-limites')
}))

// As ordens do portátil lidas sem limite por volta do ciclo: o que estava mal, e o limite que passou a
// haver, estão em ensaio/enxurrada.js.
test('uma enxurrada de ordens do portátil (3 s) não faz a caixa perder linhas nem lhe atrasa o batimento', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  await espera(300)
  const antes = await proximoBatimento(p)
  const { mandadas, vistas } = await enxurrada(p)
  assert.equal(await p.manda('parar'), 'ok', 'depois da enxurrada a caixa deixou de obedecer')
  const depois = await proximoBatimento(p)
  assert.ok(mandadas >= 3000, `só se conseguiram mandar ${mandadas} ordens em 3 s: não chega a ser uma enxurrada`)
  // o batimento não falha nem se atrasa, e a caixa não recomeça
  const b = batimentos(vistas)
  assert.ok(b.length >= 4, `só ${b.length} batimentos em 4,5 s`)
  assert.ok(b.every(x => x.ms > antes.ms) && depois.ms > antes.ms, 'a caixa recomeçou')
  for (let i = 1; i < b.length; i++) {
    const passo = b[i].ms - b[i - 1].ms
    assert.ok(passo >= 950 && passo <= 1050, `batimentos a ${passo} ms um do outro durante a enxurrada`)
  }
  // não deitou fora nenhuma linha dela para responder às ordens
  assert.equal(depois.perdidos, antes.perdidos, `para responder às ordens a caixa deitou fora ${depois.perdidos - antes.perdidos} linhas`)
  // com o sensor a medir, o movimento continua a sair a 10 linhas por segundo, sem uma em falta
  if (antes.sensor === 0) {
    const mov = vistas.map(ler).filter(l => l && l.tipo === 'movimento')
    assert.ok(mov.length >= 40, `só ${mov.length} linhas de movimento em 4,5 s de enxurrada`)
    for (let i = 1; i < mov.length; i++) assert.equal(mov[i].n, mov[i - 1].n + 1, 'faltou uma linha de movimento durante a enxurrada')
  }
  // obedece a algumas (não se cala), mas não a todas: uma de 10 em 10 ms dá umas 300 em 3 s
  const r = respostas(vistas)
  assert.ok(r >= 100 && r <= 600, `${r} respostas a ${mandadas} ordens`)
}))

// --- A ponte USB e os envios que acabam num múltiplo de 64 bytes (ensaio/ponte.js) ---------------------
// Visto a 28/11/2026: com a caixa parada, as linhas do movimento tinham 64 bytes certos e cada uma ficava
// retida na ponte USB da placa até chegar a seguinte (100 ms), ou a do log (até 400 ms). O comando
// "surto" sossega o fio 15 ms, escreve uma linha com os bytes pedidos (e, se for pedida, uma segunda,
// depois de uma pausa do fio em µs), fica calado uns ms e só então responde. Se a última linha escrita
// chegar ao portátil colada à resposta, esteve retida à espera de mais bytes.
const SURTO_CALADO = 20 // ms que a caixa fica calada antes de responder

async function surto (p, n1, pausaUs = 0, n2 = 0) {
  const chegadas = []
  const parar = p.ouvir((l) => { if (l.startsWith('$AQR,x,')) chegadas.push({ hora: performance.now(), bytes: l.length + 1 }) })
  const resposta = await p.manda('surto', n1, pausaUs, n2, SURTO_CALADO)
  const fim = performance.now()
  parar()
  return { resposta, chegadas, antes: chegadas.length ? fim - chegadas.at(-1).hora : null }
}

// [o que é, bytes da primeira linha, pausa do fio em µs, bytes da segunda linha]
const SURTOS = [
  ['uma linha de 64 bytes', 64],
  ['uma linha de 128 bytes', 128],
  ['uma linha de 192 bytes', 192],
  ['duas linhas de seguida que somam 64 bytes (30 + 34)', 30, 0, 34],
  ['duas linhas de 64 bytes de seguida', 64, 0, 64],
  // uma pausa curta: tanto pode ter chegado para a ponte despachar a primeira linha como não
  ['25 e 39 bytes com 0,15 ms de pausa', 25, 150, 39],
  ['25 e 39 bytes com 0,6 ms de pausa', 25, 600, 39],
  ['25 e 39 bytes com 1,5 ms de pausa', 25, 1500, 39],
  ['25 e 39 bytes com 4 ms de pausa', 25, 4000, 39],
  // aqui um único byte a mais desfazia um múltiplo (128) e fazia outro (63 + 1): são precisos dois
  ['65 e 63 bytes com 0,3 ms de pausa', 65, 300, 63],
  ['65 e 63 bytes com 1,5 ms de pausa', 65, 1500, 63],
  ['65 e 63 bytes com 4 ms de pausa', 65, 4000, 63]
]

test('a ponte USB não retém nenhuma linha: nem as de 64 bytes, nem as que somam 64 com a anterior', COM_PLACA, () => comACaixa(async (p) => {
  assert.equal(await p.manda('parar'), 'ok')
  // a prova de que o ensaio distingue: 40 bytes nunca ficaram retidos, e chegam bem antes da resposta
  for (let vez = 0; vez < 3; vez++) {
    const controlo = await surto(p, 40)
    assert.equal(controlo.resposta, 'ok', 'a caixa não conhece o comando "surto": gravar outra vez (npm run gravar:1)')
    assert.equal(controlo.chegadas.length, 1)
    assert.equal(controlo.chegadas[0].bytes, 40, 'a linha do surto não tem os bytes pedidos')
    assert.ok(controlo.antes >= SURTO_CALADO * 0.6, `a linha de 40 bytes chegou só ${controlo.antes.toFixed(1)} ms antes da resposta`)
  }
  const retidas = []
  for (const [nome, n1, pausa = 0, n2 = 0] of SURTOS) {
    for (let vez = 0; vez < 3; vez++) {
      const s = await surto(p, n1, pausa, n2)
      assert.equal(s.resposta, 'ok', nome)
      assert.equal(s.chegadas.length, n2 ? 2 : 1, `${nome}: chegaram ${s.chegadas.length} linhas`)
      if (s.antes < SURTO_CALADO * 0.6) retidas.push(`${nome}: a última linha chegou ${s.antes.toFixed(1)} ms antes da resposta (devia ser perto de ${SURTO_CALADO})`)
    }
  }
  assert.deepEqual(retidas, [], 'linhas retidas na ponte USB')
  for (const fora of [[11, 0, 0, 20], [201, 0, 0, 20], [64, 0, 11, 20], [64, 5001, 0, 20], [64, -1, 0, 20], [64, 0, 0, 31]]) {
    assert.equal(await p.manda('surto', ...fora), 'fora-dos-limites', `surto,${fora.join(',')}`)
  }
}))

// --- Revisão final da Tarefa 7 (28/11/2026): as avarias do sensor, feitas de propósito -------------------
// O comando "avaria" da caixa 1: 3 prende o RST do sensor em baixo os segundos pedidos (fica mudo, como se
// lhe faltasse um fio); 4 manda o sensor deixar de enviar uma das três leituras (1 a aceleração, 2 a
// rotação, 3 a atitude), com as outras a continuarem.

// O caminho inteiro de um sensor que se cala e não volta nunca tinha sido visto de ponta a ponta com o
// sensor montado: o ensaio do toque no RST prova que ele volta, não que a caixa dá pelo silêncio, espaça
// os toques, diz "não volta" e o apanha quando ele voltar. As esperas entre toques são 1, 2, 5, 10 e 30 s.
test('o sensor fica mudo 35 s: a caixa diz "calado", dá toques cada vez mais espaçados, diz "não volta", e apanha-o quando ele volta, sem o resto dar por isso', COM_PLACA, (t) => comACaixa(async (p) => {
  if (!await comSensor(t, p)) return
  assert.equal(await p.manda('parar'), 'ok')
  const antes = await proximoBatimento(p)
  const sensorAntes = contadores(await p.manda('sensor'))
  const vistas = []
  const parar = p.ouvir((l) => vistas.push({ l, quando: Date.now() }))
  await espera(1200)
  const mudo = Date.now()
  assert.equal(await p.manda('avaria', 3, 35), 'ok')
  // seis toques: o do silêncio e mais cinco, o último meio minuto depois de a caixa o dar por perdido
  const voltou = await p.ate((l) => { const b = batimento1(l); return b && b.sensor === 0 && b.rsts >= antes.rsts + 6 ? b : null }, 80000, 'o sensor de volta a medir')
  await espera(3000)
  parar()
  const lidas = vistas.map(x => ({ ...x, v: ler(x.l) }))
  const ilegivel = lidas.find(x => !x.v && !eResposta(x.l))
  assert.ok(!ilegivel, `linha que o portátil não lê: ${ilegivel && ilegivel.l}`)
  const b = lidas.filter(x => x.v && x.v.tipo === 'batimento' && x.v.caixa === 1)
  // os estados que o batimento disse, pela ordem: a medir, calado, não volta, a medir
  const estados = b.map(x => x.v.sensor).filter((e, i, a) => i === 0 || e !== a[i - 1])
  assert.deepEqual(estados, [0, 2, 3, 0], `estados do sensor no batimento: ${estados.join(' → ')}`)
  // o "não volta" veio com o sensor ainda mudo, e ficou até ele voltar
  const primeiroNaoVolta = b.find(x => x.v.sensor === 3)
  assert.ok(primeiroNaoVolta.quando - mudo < 35000, `a caixa só disse "não volta" ${((primeiroNaoVolta.quando - mudo) / 1000).toFixed(0)} s depois: o sensor já podia falar`)
  // os toques: seis, e cada vez mais espaçados (vistos no batimento, de segundo a segundo)
  assert.equal(voltou.rsts - antes.rsts, 6, 'toques no RST durante o silêncio')
  const subidas = []
  for (let i = 1; i < b.length; i++) if (b[i].v.rsts > b[i - 1].v.rsts) subidas.push(b[i].quando)
  assert.equal(subidas.length, 6, `o batimento mostrou ${subidas.length} subidas do contador de toques`)
  const entre = subidas.slice(1).map((q, i) => (q - subidas[i]) / 1000)
  const ESPERAS = [1, 2, 5, 10, 30]
  for (let i = 0; i < ESPERAS.length; i++) {
    assert.ok(entre[i] >= ESPERAS[i] - 0.2 && entre[i] <= ESPERAS[i] + 4, `entre o toque ${i + 1} e o ${i + 2} passaram ${entre[i].toFixed(1)} s (a espera é de ${ESPERAS[i]} s, mais a tentativa)`)
  }
  // enquanto esteve mudo não saiu movimento nenhum, e quando voltou o número de ordem seguiu de onde ia
  const m = lidas.filter(x => x.v && x.v.tipo === 'movimento')
  const noSilencio = m.filter(x => x.quando > mudo + 1500 && x.quando < mudo + 35000)
  assert.equal(noSilencio.length, 0, `saíram ${noSilencio.length} linhas de movimento com o sensor mudo`)
  assert.ok(m.filter(x => x.quando > mudo + 35000).length >= 20, 'o movimento não voltou')
  for (let i = 1; i < m.length; i++) assert.equal(m[i].v.n, m[i - 1].v.n + 1, 'o número de ordem do movimento não seguiu')
  // o batimento e o log não falharam uma linha, e a caixa não recomeçou
  for (let i = 1; i < b.length; i++) {
    const passo = b[i].v.ms - b[i - 1].v.ms
    assert.ok(passo >= 950 && passo <= 1050, `batimentos a ${passo} ms um do outro com o sensor mudo`)
  }
  assert.ok(b.every(x => x.v.arranque === antes.arranque), 'a caixa recomeçou')
  const logs = lidas.filter(x => x.v && x.v.tipo === 'log').map(x => x.v)
  for (let i = 1; i < logs.length; i++) {
    const passo = logs[i].ms - logs[i - 1].ms
    assert.ok(passo >= 450 && passo <= 550, `linhas do log a ${passo} ms uma da outra com o sensor mudo`)
  }
  const sensorDepois = contadores(await p.manda('sensor'))
  assert.equal(sensorDepois.estado, 0)
  assert.equal(sensorDepois.toques - sensorAntes.toques, 6)
  for (const fora of [[3, 0], [3, 121], [4, 0], [4, 4], [5, 1], [0, 1]]) assert.equal(await p.manda('avaria', ...fora), 'fora-dos-limites', `avaria,${fora.join(',')}`)
}))

// Visto na revisão: "calado" era não chegar leitura NENHUMA em meio segundo. Se parasse só a atitude, o
// movimento continuava a sair com a última atitude, parada no tempo, como se fosse de agora; se parasse só
// a aceleração, deixava de sair movimento e a caixa continuava a dizer que o sensor media.
for (const [qual, nome, chave] of [[1, 'a aceleração', 'aceleracao'], [2, 'a rotação', 'rotacao'], [3, 'a atitude', 'atitude']]) {
  test(`o sensor deixa de mandar ${nome} e continua com as outras leituras: a caixa dá por isso e põe-no a medir tudo outra vez em menos de 5 s`, COM_PLACA, (t) => comACaixa(async (p) => {
    if (!await comSensor(t, p)) return
    assert.equal(await p.manda('parar'), 'ok')
    const antes = await proximoBatimento(p)
    const sensorAntes = contadores(await p.manda('sensor'))
    const vistas = []
    const parar = p.ouvir((l) => vistas.push(l))
    assert.equal(await p.manda('avaria', 4, qual), 'ok')
    await espera(5000)
    parar()
    const sensorDepois = contadores(await p.manda('sensor'))
    assert.equal(sensorDepois.toques - sensorAntes.toques, 1, `a caixa não deu por ${nome} ter parado (toques no RST: ${sensorDepois.toques - sensorAntes.toques})`)
    assert.equal(sensorDepois.estado, 0, 'o sensor não voltou a medir')
    // as três leituras voltaram todas a chegar, a 100 por segundo
    const l1 = contadores(await p.manda('leituras'))
    await espera(1500)
    const l2 = contadores(await p.manda('leituras'))
    for (const k of ['aceleracao', 'rotacao', 'atitude']) {
      assert.ok(l2[k] - l1[k] >= 120, `depois de a caixa o pôr a medir outra vez, chegaram ${l2[k] - l1[k]} leituras de ${k} em 1,5 s${k === chave ? ' (a que tinha parado)' : ''}`)
    }
    // o batimento não falhou e a caixa não recomeçou
    const b = batimentos(vistas)
    assert.ok(b.length >= 4, `${b.length} batimentos em 5 s`)
    assert.ok(b.every(x => x.arranque === antes.arranque), 'a caixa recomeçou')
    for (let i = 1; i < b.length; i++) {
      const passo = b[i].ms - b[i - 1].ms
      assert.ok(passo >= 950 && passo <= 1050, `batimentos a ${passo} ms um do outro`)
    }
    assert.ok(vistas.every(l => ler(l) || eResposta(l)), 'saiu uma linha que o portátil não lê')
  }))
}
