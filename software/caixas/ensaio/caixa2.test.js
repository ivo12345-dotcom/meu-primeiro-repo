'use strict'
// Ensaios com as duas caixas verdadeiras ligadas ao portátil por USB (a segunda só precisa do cabo para
// ter corrente e receber os comandos de ensaio: o que ela manda à caixa 1 vai pelo rádio das placas).
//   ARLEQUIN_CAIXA1=COM3 ARLEQUIN_CAIXA2=COM5 npm test        (na pasta software/caixas)
// Sem as variáveis, saltam-se e dizem porquê. O último ensaio lê só o código e corre sempre.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { abrir, comPlaca, espera } = require('./placa')
const { enganosDoRecente } = require('./recente')
const { enxurrada, respostas } = require('./enxurrada')
const { ler, linhaMotor } = require('../../signalk-arlequin-caixas/lib/linhas')
const { lerLinha, descodificar } = require('../../signalk-arlequin-j1939/lib/j1939')
const { examinar, ficheirosDaCaixa2 } = require('./so-escuta')

// A versão que as placas têm de dizer é a do programa que está nesta pasta (o que se acabou de gravar).
const VERSAO = /#define\s+AQ_VERSAO\s+"([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, '..', 'comum', 'src', 'arlequin_versao.h'), 'utf8'))[1]

const P1 = comPlaca('ARLEQUIN_CAIXA1')
const P2 = comPlaca('ARLEQUIN_CAIXA2')
const COM_A_2 = P2 ? {} : { skip: 'sem a caixa 2 ligada: definir ARLEQUIN_CAIXA2=COMx' }
const COM_AS_DUAS = P1 && P2 ? {} : { skip: 'sem as duas caixas ligadas: definir ARLEQUIN_CAIXA1 e ARLEQUIN_CAIXA2' }

const batimento = (caixa) => (linha) => {
  const b = ler(linha)
  return b && b.tipo === 'batimento' && b.caixa === caixa ? b : null
}
const batimentos = (linhas, caixa) => linhas.map(batimento(caixa)).filter(Boolean)
const proximo = (p, caixa, ms = 2500) => p.ate(batimento(caixa), ms, `o batimento da caixa ${caixa}`)

// Abre as duas portas, corre o ensaio e fecha-as sempre.
async function comAsDuas (ensaio) {
  const p1 = await abrir(P1)
  let p2
  try {
    p2 = await abrir(P2)
    await ensaio(p1, p2)
  } finally {
    if (p2) { await p2.manda('parar').catch(() => {}); await p2.fechar() }
    await p1.fechar()
  }
}

// As rotações (por minuto) que o plugin do motor tira de uma linha do motor mandada pela caixa 1.
function rotacoes (linha) {
  const l = ler(linha)
  if (!l || l.tipo !== 'motor') return null
  const trama = lerLinha(linhaMotor(l, 1_727_600_000_000)) // como o plugin das caixas a passa ao do motor
  if (!trama) return null
  const v = descodificar(trama.pgn, trama.dados).find(x => x.path === 'propulsion.main.revolutions')
  return v ? v.value * 60 : null
}

test('a caixa 2 sozinha, pelo USB: o batimento dela, de segundo a segundo, e mais nada', COM_A_2, async () => {
  const p = await abrir(P2)
  try {
    assert.equal(await p.manda('parar'), 'ok')
    await proximo(p, 2)
    const linhas = await p.linhas(5000)
    assert.ok(linhas.map(ler).every(Boolean), `linha que o portátil não lê: ${linhas[linhas.map(ler).indexOf(null)]}`)
    const b = batimentos(linhas, 2)
    assert.ok(b.length >= 4 && b.length <= 6, `${b.length} batimentos em 5 s`)
    assert.equal(b.length, linhas.length, 'a caixa 2 mandou pelo USB mais do que o batimento')
    for (const x of b) {
      assert.equal(x.fw, VERSAO, 'a caixa 2 não tem o programa desta pasta: gravar com npm run gravar:2')
      assert.equal(x.sim, false)
      assert.equal(x.rssi, 0)
    }
    for (let i = 1; i < b.length; i++) assert.ok(Math.abs(b[i].ms - b[i - 1].ms - 1000) <= 50, `batimentos a ${b[i].ms - b[i - 1].ms} ms`)
  } finally {
    await p.fechar()
  }
})

test('motor a fingir, pelo rádio: a caixa 1 passa o batimento e as tramas da caixa 2, e o portátil lê 2100 rotações', COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
  assert.equal(await p2.manda('motor', 2100), 'ok')
  await espera(2500) // a caixa 2 só manda depois de ouvir o farol da caixa 1
  const linhas = await p1.linhas(6000)
  assert.ok(linhas.map(ler).every(Boolean), `linha que o portátil não lê: ${linhas[linhas.map(ler).indexOf(null)]}`)
  const b2 = batimentos(linhas, 2)
  assert.ok(b2.length >= 4 && b2.length <= 7, `${b2.length} batimentos da caixa 2 em 6 s`)
  for (const x of b2) {
    assert.equal(x.sim, true, 'a caixa 2 não disse que fingia')
    assert.equal(x.fw, VERSAO)
    assert.ok(x.rssi >= -90 && x.rssi <= -10, `força do rádio: ${x.rssi} dBm`)
  }
  assert.ok(b2.at(-1).perdidos - b2[0].perdidos <= 3, `pacotes perdidos em 6 s, lado a lado: ${b2.at(-1).perdidos - b2[0].perdidos}`)
  const motor = linhas.map(ler).filter(l => l && l.tipo === 'motor')
  assert.ok(motor.length >= 40, `só ${motor.length} tramas do motor em 6 s`)
  const rpm = linhas.map(rotacoes).filter(v => v !== null)
  assert.ok(rpm.length >= 40, `só ${rpm.length} tramas com rotações`)
  assert.ok(rpm.every(v => Math.abs(v - 2100) < 0.5), `rotações lidas: ${[...new Set(rpm)].join(', ')}`)
  // as outras tramas do cenário: temperatura da água, tensão, horas
  const pgns = new Set(motor.map(m => (m.id >>> 8) & 0x3FFFF))
  for (const pgn of [61444, 65262, 65271, 65253]) assert.ok(pgns.has(pgn), `falta a trama ${pgn}`)
  // a caixa 1 não finge: quem finge é a 2
  assert.ok(batimentos(linhas, 1).every(x => x.sim === false))
}))

// Revisão final das caixas (23/11/2026): a caixa 2 só dizia que fingia no batimento seguinte, até um
// segundo depois de as primeiras tramas a fingir já terem chegado ao portátil, que as tomava por medições.
const eMotor = (l) => { const x = ler(l); return Boolean(x && x.tipo === 'motor') }

test('ao ligar o motor a fingir, a caixa 2 diz que finge antes de chegar a primeira trama a fingir', COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
  assert.equal(await p2.manda('parar'), 'ok')
  await espera(1500) // deixa passar as tramas que ainda vinham a caminho
  await p1.ate((l) => { const b = batimento(2)(l); return b && !b.sim ? b : null }, 3000, 'um batimento da caixa 2 sem fingir')
  await espera(150) // longe do batimento seguinte: sem o aviso imediato, ele só vinha uns 850 ms depois
  const vistas = []
  const parar = p1.ouvir((l) => vistas.push(l))
  assert.equal(await p2.manda('motor', 2100), 'ok')
  await p1.ate(eMotor, 3000, 'uma trama do motor a fingir')
  parar()
  const primeira = vistas.findIndex(eMotor)
  assert.ok(primeira >= 0, 'não chegou nenhuma trama do motor a fingir')
  const avisou = vistas.slice(0, primeira).some((l) => { const b = batimento(2)(l); return Boolean(b && b.sim) })
  assert.ok(avisou, 'a primeira trama a fingir chegou antes de a caixa 2 dizer que fingia')
}))

test('Review Focus 2: a caixa 2 recomeça; o batimento dela para e volta, e os perdidos não disparam nem andam para trás', COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
  assert.equal(await p2.manda('motor', 2100), 'ok')
  await espera(2500)
  const antes = await proximo(p1, 2)
  assert.equal(await p2.manda('prender'), 'ok')
  // enquanto a caixa 2 está presa (5 s até o cão de guarda a reiniciar), o batimento dela não chega
  const calada = batimentos(await p1.linhas(3500), 2)
  assert.ok(calada.length <= 1, `a caixa 1 continuou a dar ${calada.length} batimentos da caixa 2 presa`)
  const depois = await p1.ate((l) => { const b = batimento(2)(l); return b && b.ms < antes.ms ? b : null }, 15000, 'o batimento da caixa 2 depois de recomeçar')
  assert.equal(depois.sim, false, 'o gerador da caixa 2 sobreviveu ao recomeço')
  await espera(1500)
  const fim = await proximo(p1, 2)
  assert.ok(fim.perdidos >= antes.perdidos, `os perdidos andaram para trás: ${antes.perdidos} → ${fim.perdidos}`)
  assert.ok(fim.perdidos - antes.perdidos <= 50, `os perdidos dispararam: ${antes.perdidos} → ${fim.perdidos}`)
}))

test('Review Focus 2: com a caixa 2 calada, a caixa 1 continua a mandar o dela sem falhar', COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
  assert.equal(await p1.manda('log', 26), 'ok')
  try {
    assert.equal(await p2.manda('prender'), 'ok')
    const linhas = await p1.linhas(4000)
    assert.ok(linhas.map(ler).every(Boolean), 'saiu da caixa 1 uma linha que o portátil não lê')
    const b1 = batimentos(linhas, 1)
    assert.ok(b1.length >= 3 && b1.length <= 5, `${b1.length} batimentos da caixa 1 em 4 s`)
    for (let i = 1; i < b1.length; i++) assert.ok(Math.abs(b1[i].ms - b1[i - 1].ms - 1000) <= 50)
    const log = linhas.map(ler).filter(l => l && l.tipo === 'log')
    assert.ok(log.length >= 7 && log.length <= 9, `${log.length} linhas do log em 4 s`)
    // espera que a caixa 2 volte, para a deixar pronta para o ensaio seguinte
    await p1.ate(batimento(2), 15000, 'a caixa 2 de volta')
  } finally {
    await p1.manda('parar').catch(() => {})
  }
}))

// Pontos adiados da revisão final (passo 7 da Tarefa 7, 27/11/2026). O rádio da caixa 2 só manda enquanto
// ouvir o sinal da caixa 1; a conta "há quanto tempo chegou o sinal" enganava-se se ele chegasse a meio
// de uma volta do ciclo. É a mesma tabela que a caixa 1 corre (ensaio/recente.js), aqui na caixa que usa
// a conta de verdade (radio2.h, radioTemOuvinte).
test('caixa 2: há quanto tempo chegou o sinal da caixa 1, a conta não se engana a meio da volta do ciclo nem com o relógio a dar a volta', COM_A_2, async () => {
  const p = await abrir(P2)
  try {
    assert.deepEqual(await enganosDoRecente(p), [])
    assert.equal(await p.manda('recente', 1000, 1000, 60001), 'fora-dos-limites')
    assert.equal(await p.manda('recente', 1000, 1000, -1), 'fora-dos-limites')
  } finally {
    await p.fechar()
  }
})

// A caixa 2 lê as ordens do USB da mesma maneira, com o mesmo limite (ensaio/enxurrada.js). No barco o
// USB só lhe dá corrente; isto é para a bancada e para o dia em que a liguem a um portátil.
test('caixa 2: uma enxurrada de ordens pelo USB (3 s) não lhe atrasa o batimento nem a faz recomeçar', COM_A_2, async () => {
  const p = await abrir(P2)
  try {
    assert.equal(await p.manda('parar'), 'ok')
    await espera(300)
    const antes = await proximo(p, 2)
    const { mandadas, vistas } = await enxurrada(p)
    assert.equal(await p.manda('parar'), 'ok', 'depois da enxurrada a caixa 2 deixou de obedecer')
    const depois = await proximo(p, 2)
    assert.ok(mandadas >= 3000, `só se conseguiram mandar ${mandadas} ordens em 3 s: não chega a ser uma enxurrada`)
    const b = batimentos(vistas, 2)
    assert.ok(b.length >= 4, `só ${b.length} batimentos da caixa 2 em 4,5 s`)
    assert.ok(b.every(x => x.ms > antes.ms) && depois.ms > antes.ms, 'a caixa 2 recomeçou')
    for (let i = 1; i < b.length; i++) {
      const passo = b[i].ms - b[i - 1].ms
      assert.ok(passo >= 950 && passo <= 1050, `batimentos da caixa 2 a ${passo} ms um do outro durante a enxurrada`)
    }
    const r = respostas(vistas)
    assert.ok(r >= 100 && r <= 600, `${r} respostas a ${mandadas} ordens`)
  } finally {
    await p.fechar()
  }
})

// O último ponto adiado: o rádio da caixa 2 que falha e volta a tentar. Até à 0.3.0, se o rádio não
// ligasse ao arrancar, ou se o destino (a caixa 1) não ficasse registado, a caixa 2 ficava calada no rádio
// até lhe cortarem a corrente, com o batimento dela a sair pelo USB como se nada fosse. As avarias
// fazem-se na bancada com o comando "avaria": 1 deita o rádio abaixo, como se não tivesse ligado ao
// arrancar (a caixa volta a tentar de 10 em 10 s); 2 tira-lhe o destino, como se o registo tivesse
// falhado (volta a tentar de segundo a segundo).
const contadores = (texto) => Object.fromEntries(texto.split(';').map(par => { const [k, v] = par.split('='); return [k, Number(v)] }))
for (const [avaria, nome, caladaMs, prazoMs] of [
  [1, 'o rádio da caixa 2 vai abaixo e ela volta a ligá-lo sozinha', 5000, 15000],
  [2, 'a caixa 2 perde o destino e volta a registá-lo sozinha', 0, 3000]
]) {
  test(`${nome}: o batimento dela volta à caixa 1 em menos de ${prazoMs / 1000} s, sem ela recomeçar`, COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
    assert.equal(await p2.manda('parar'), 'ok')
    await p1.ate(batimento(2), 12000, 'o batimento da caixa 2, pelo rádio, antes da avaria')
    const estadoAntes = contadores(await p2.manda('estado'))
    const antes = await proximo(p2, 2)
    const chegados = [] // as horas (do portátil) a que a caixa 1 passou um batimento da caixa 2
    const parar = p1.ouvir((l) => { if (batimento(2)(l)) chegados.push(Date.now()) })
    assert.equal(await p2.manda('avaria', avaria), 'ok')
    const daAvaria = Date.now()
    await espera(prazoMs)
    parar()
    // os batimentos que chegaram depois do silêncio (ou, na avaria 2, depois de o que ia a caminho já
    // ter chegado): são os da volta
    const depoisDoSilencio = chegados.filter(h => h - daAvaria > Math.max(caladaMs, 300))
    const noSilencio = chegados.filter(h => h - daAvaria > 1200 && h - daAvaria <= caladaMs)
    assert.equal(noSilencio.length, 0, `a caixa 1 continuou a ouvir a caixa 2 (${noSilencio.length} batimentos) com a avaria feita`)
    assert.ok(depoisDoSilencio.length >= 1, `o batimento da caixa 2 não voltou à caixa 1 em ${prazoMs / 1000} s`)
    // voltou sozinha: sem recomeçar, e contou que teve de repor o rádio
    const depois = await proximo(p2, 2)
    assert.ok(depois.ms > antes.ms, 'a caixa 2 recomeçou para voltar a ter rádio')
    const estadoDepois = contadores(await p2.manda('estado'))
    assert.equal(estadoDepois.religado - estadoAntes.religado, 1, 'a caixa 2 não contou que teve de repor o rádio')
    // e fica a funcionar: o motor a fingir chega à caixa 1, e os perdidos não disparam
    const b1 = await proximo(p1, 2, 3000)
    assert.equal(await p2.manda('motor', 2100), 'ok')
    await p1.ate(eMotor, 4000, 'uma trama do motor depois de o rádio voltar')
    await espera(1500)
    const b2 = await proximo(p1, 2, 3000)
    assert.ok(b2.perdidos - b1.perdidos <= 3, `pacotes perdidos depois de o rádio voltar: ${b2.perdidos - b1.perdidos}`)
  }))
}

// O mesmo do lado da caixa 1 (revisão final da Tarefa 7, 28/11/2026): se o rádio dela não ligasse ao
// arrancar, não saía o farol, a caixa 2 ficava calada (só manda a quem ouve) e do portátil só se via "caixa
// 2 sem ligação", até alguém cortar a corrente à caixa certa. Passou a tentar outra vez de 30 em 30 s. A
// avaria faz-se com "avaria,1" na caixa 1.
test('o rádio da caixa 1 vai abaixo e ela volta a ligá-lo sozinha: o batimento da caixa 2 volta em menos de 45 s, sem nenhuma das duas recomeçar', COM_AS_DUAS, () => comAsDuas(async (p1, p2) => {
  assert.equal(await p2.manda('parar'), 'ok')
  assert.equal(await p1.manda('parar'), 'ok')
  await p1.ate(batimento(2), 12000, 'o batimento da caixa 2, pelo rádio, antes da avaria')
  const radioAntes = contadores(await p1.manda('radio'))
  assert.equal(radioAntes.ligado, 1)
  const antes1 = await proximo(p1, 1)
  const antes2 = await proximo(p2, 2)
  const vistas = []
  const parar = p1.ouvir((l) => vistas.push({ l, quando: Date.now() }))
  assert.equal(await p1.manda('avaria', 1), 'ok')
  const daAvaria = Date.now()
  await espera(45000)
  parar()
  const da2 = vistas.filter(x => batimento(2)(x.l)).map(x => x.quando - daAvaria)
  const noSilencio = da2.filter(ms => ms > 1500 && ms <= 20000)
  assert.equal(noSilencio.length, 0, `a caixa 1 continuou a ouvir a caixa 2 (${noSilencio.length} batimentos) com o rádio em baixo`)
  assert.ok(da2.some(ms => ms > 20000), 'o batimento da caixa 2 não voltou em 45 s')
  // voltou sozinha: nenhuma das duas recomeçou, e a caixa 1 contou que teve de repor o rádio
  const b1 = vistas.map(x => batimento(1)(x.l)).filter(Boolean)
  assert.ok(b1.length >= 43, `só ${b1.length} batimentos da caixa 1 em 45 s`)
  for (let i = 1; i < b1.length; i++) {
    const passo = b1[i].ms - b1[i - 1].ms
    assert.ok(passo >= 900 && passo <= 1100, `batimentos da caixa 1 a ${passo} ms um do outro com o rádio a ser reposto`)
  }
  assert.ok(b1.every(x => x.arranque === antes1.arranque), 'a caixa 1 recomeçou')
  assert.ok((await proximo(p2, 2)).ms > antes2.ms, 'a caixa 2 recomeçou')
  const radioDepois = contadores(await p1.manda('radio'))
  assert.equal(radioDepois.ligado, 1)
  assert.equal(radioDepois.religado - radioAntes.religado, 1, 'a caixa 1 não contou que teve de repor o rádio')
  // e fica a funcionar: o motor a fingir chega, e os perdidos não disparam (a caixa 2 ainda mandou uns 5
  // batimentos antes de dar pela falta do farol)
  const b2 = vistas.map(x => batimento(2)(x.l)).filter(Boolean)
  assert.ok(b2.at(-1).perdidos - b2[0].perdidos <= 12, `pacotes perdidos com o rádio da caixa 1 em baixo: ${b2.at(-1).perdidos - b2[0].perdidos}`)
  assert.equal(await p2.manda('motor', 2100), 'ok')
  await p1.ate(eMotor, 4000, 'uma trama do motor depois de o rádio voltar')
}))

test('caixa 2: a avaria de bancada só aceita 1 ou 2', COM_A_2, async () => {
  const p = await abrir(P2)
  try {
    for (const fora of [0, 3, -1]) assert.equal(await p.manda('avaria', fora), 'fora-dos-limites', `avaria,${fora}`)
  } finally {
    await p.fechar()
  }
})

test('só em escuta: o programa da caixa 2 nunca escreve no barramento do motor', () => {
  const ficheiros = ficheirosDaCaixa2()
  const nomes = ficheiros.map(f => f.nome)
  assert.ok(nomes.includes('caixa2/caixa2.ino') && nomes.includes('caixa2/motor.h'), `ficheiros da caixa 2: ${nomes}`)
  assert.deepEqual(examinar(ficheiros), [], 'o programa da caixa 2 podia escrever na linha do motor')
})
