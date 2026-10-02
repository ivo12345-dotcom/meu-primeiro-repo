'use strict'
// O simular.mjs dá o mesmo em qualquer fuso do sistema (a partida sem fuso é hora de Lisboa,
// as horas da Open-Meteo leem-se do texto): este teste não fixa o TZ, para o provar no Pi (UTC)
// e no portátil (Europe/Lisbon).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { simularPassagem, noitePeloSol, PADRAO } = require('../lib/passagem')
const { criarEnergia } = require('../lib/energia')

const H = 3600000
const MIN = 60000
const FIXTURES = path.join(__dirname, 'fixtures')
const SW = path.join(__dirname, '..', '..')
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, f))))

// ---------- o simular.mjs de 29/09 (resultado de referência gravado com o código antigo a 29/09 e ----------
// ---------- regravado a 01/10, com a maré do Tejo só na caixa da barra: chegada 05:00 → 05:01) ----------

test('reproduz o simular.mjs de 29/09 (Algés → Peniche, partida 15:32): resumo e linha do tempo iguais', async () => {
  const { simular, parsePartida, ROTA, COSTA } = await import('file://' + path.join(SW, 'ferramentas', 'passagem', 'simular.mjs').replace(/\\/g, '/'))
  const met = gz('meteo-simular-2026-09-29.json.gz')
  const ref = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'simular-2026-09-29-resumo.json'), 'utf8'))
  const partida = parsePartida('2026-09-29T15:32') // hora de Lisboa, como o comando da Task 4
  assert.equal(partida, Date.parse('2026-09-29T14:32Z'))
  const r = await simular(partida, met)
  // o que o desenho pede: ±2% na distância e na hora de chegada (duração)
  assert.ok(Math.abs(r.resumo.milhas / ref.milhas - 1) < 0.02)
  assert.ok(Math.abs(r.resumo.duracaoH / ref.duracaoH - 1) < 0.02)
  // e na verdade é igual, número a número, com os mesmos eventos e os mesmos pontos
  assert.deepEqual(JSON.parse(JSON.stringify(r.resumo)), ref)
  // pontos: igual ao de referência, tirando o `periodo` novo (Task 8, fix da revisão: cada ponto
  // passa a guardar o periodo da previsão, para a Task 9 calcular as horas de leme equivalentes)
  const semPeriodo = (p) => { const { periodo, ...resto } = p; return resto }
  assert.ok(r.pontos.every(p => Number.isFinite(p.periodo)))
  assert.deepEqual(JSON.parse(JSON.stringify(r.pontos)).map(semPeriodo), gz('simular-2026-09-29-passagem.json.gz'))
  assert.equal(ref.chegada, '2026-09-30T05:01:00.000Z') // 05:00 até 01/10, com a maré do Tejo errada à chegada a Peniche
  // rota.json (só nome/lat/lon + COSTA): igual ao gravado. Barato de comparar porque ROTA/COSTA
  // são exportados e não dependem da meteorologia nem da partida (principal() escreve o mesmo).
  const rotaJson = { ROTA: ROTA.map(({ nome, lat, lon }) => ({ nome, lat, lon })), COSTA }
  const rotaRef = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'simular-rota.json'), 'utf8'))
  assert.deepEqual(rotaJson, rotaRef)
  // stdout do `principal()` não se testa aqui: o seu texto é só console.log de r.resumo, já
  // coberto pelo deepEqual acima, e correr principal() em si exige simular um processo à parte
  // (o argv-guard `PRINCIPAL` e a escrita de ficheiros), o que não é barato e reestruturar
  // simular.mjs para o tornar testável em processo está fora do âmbito desta ronda (simular.mjs
  // só muda no cabeçalho). Sem limite de tempo (auditoria M-17: o relógio de parede não é do teste).
})

// ---------- o motor com um ambiente inventado ----------

const reta = (mn, extra = {}) => [{ nome: 'A', lat: 39, lon: -9.5 }, { nome: 'B', lat: 39 + mn / 60, lon: -9.5, ...extra }]
const ventoFixo = (tws, twd, extra = {}) => () => ({ tws, rajada: tws * 1.2, twd, chuva: 0, visibilidade: 20000, radiacao: 0, ondas: 1, periodo: 8, ondasDir: twd, corrente: 0, correnteDir: 0, ...extra })
const base = (o = {}) => ({
  rota: reta(10),
  partida: Date.UTC(2026, 8, 29, 12),
  tempo: ventoFixo(12, 270),
  velocidadeVela: () => 6,
  consumo: ({ rpm }) => rpm / 1000, // L/h
  ...o
})

test('través com 12 nós: vai à vela a 6 × 0,85 nós, sem motor, e chega', () => {
  const r = simularPassagem(base())
  assert.equal(r.resumo.chegou, true)
  assert.equal(r.resumo.horasMotor, 0)
  assert.ok(Math.abs(r.pontos[0].stw - 6 * 0.85) < 1e-12)
  assert.ok(Math.abs(r.resumo.duracaoH - 10 / 5.1) < 0.05, `${r.resumo.duracaoH} h`)
  assert.ok(Math.abs(r.resumo.milhas - 10) < 0.2)
  assert.equal(r.resumo.gasoleoGasto, 0)
  assert.ok(Math.abs(r.resumo.horasLemeSeguidas - r.resumo.horasVela) < 1e-9)
  assert.equal(r.eventos[0].texto, 'Partida de A (13:00)') // hora de Lisboa
  assert.equal(r.eventos.at(-1).tipo, 'chegada')
  assert.match(r.eventos.at(-1).texto, /^Chegada a B \(\d\d:\d\d\)$/)
  assert.equal(r.resumo.socFinal, null) // sem energia
  assert.equal(r.resumo.costaMinMn, null) // sem costa
})

test('vento abaixo de 7 nós: motor a 2100 rpm e 4,3 nós; velocidade à vela < 3 nós: também motor', () => {
  const r = simularPassagem(base({ tempo: ventoFixo(5, 270) }))
  assert.equal(r.resumo.horasVela, 0)
  assert.ok(Math.abs(r.pontos[0].stw - 4.3) < 1e-12)
  assert.ok(Math.abs(r.resumo.gasoleoGasto - 2.1 * r.resumo.horasMotor) < 1e-9)
  assert.equal(PADRAO.rpmCruzeiro, 2100)
  const lenta = simularPassagem(base({ velocidadeVela: () => 3 })) // 3 × 0,85 < 3
  assert.equal(lenta.resumo.horasVela, 0)
  // o consumo recebe também a proa (para o ângulo às ondas do modelo do consumo)
  const vistos = []
  simularPassagem(base({ tempo: ventoFixo(5, 270), consumo: (x) => { vistos.push(x); return 2 } }))
  assert.equal(vistos[0].rpm, 2100)
  assert.ok(Math.abs(vistos[0].rumo) < 1e-9 || Math.abs(vistos[0].rumo - 360) < 1e-9) // rota para norte
  // o mar tira velocidade: ondas de 3 m → 0,92
  const mar = simularPassagem(base({ tempo: ventoFixo(5, 270, { ondas: 3 }) }))
  assert.ok(Math.abs(mar.pontos[0].stw - 4.3 * 0.92) < 1e-12)
})

test('ondas desconhecidas (ondas null): fatorMar conservador como no pior caso do armador (3 m), nunca mar chão', () => {
  const semOndas = simularPassagem(base({ tempo: ventoFixo(5, 270, { ondas: null }) }))
  const ondas1 = simularPassagem(base({ tempo: ventoFixo(5, 270, { ondas: 1 }) }))
  const ondas3 = simularPassagem(base({ tempo: ventoFixo(5, 270, { ondas: 3 }) }))
  assert.equal(Number.isNaN(semOndas.pontos[0].stw), false)
  // nunca mais rápido do que com 1 m de onda conhecida (mar chão seria o melhor caso possível)
  assert.ok(semOndas.pontos[0].stw <= ondas1.pontos[0].stw, `${semOndas.pontos[0].stw} > ${ondas1.pontos[0].stw}`)
  // e exatamente como o pior caso assumido (3 m), não um valor arbitrário
  assert.ok(Math.abs(semOndas.pontos[0].stw - ondas3.pontos[0].stw) < 1e-12)
  assert.equal(semOndas.resumo.chegou, true)
})

test('portos e aproximações a motor; o rio a 4,8 nós; o evento diz porquê', () => {
  const rota = [{ nome: 'Cais', lat: 39, lon: -9.5 }, { lat: 39 + 1 / 60, lon: -9.5, perna: 'porto' }, { nome: 'Largo', lat: 39 + 3 / 60, lon: -9.5, perna: 'aproximacao' }, { nome: 'Fim', lat: 39 + 8 / 60, lon: -9.5, perna: 'linha' }]
  const r = simularPassagem(base({ rota }))
  assert.ok(Math.abs(r.pontos[0].stw - 4.8) < 1e-12)
  const naAprox = r.pontos.find(p => p.wp === 'Largo')
  assert.equal(naAprox.motor, true)
  assert.ok(Math.abs(naAprox.stw - 4.3) < 1e-12)
  assert.equal(r.pontos.at(-1).motor, false)
  assert.ok(r.eventos.some(e => /^Motor desligado, à vela \(vento 12 nós de 270°\)$/.test(e.texto)))
  // um ponto sem nome não dá evento de chegada
  assert.equal(r.eventos.filter(e => e.tipo === 'wp').map(e => e.texto.split(':')[0]).join(','), 'Largo,Fim')
  const semAprox = simularPassagem(base({ rota, opcoes: { motorNasAproximacoes: false } }))
  assert.equal(semAprox.pontos.find(p => p.wp === 'Largo').motor, false)
  const liga = simularPassagem(base({ rota: [rota[0], { ...rota[2], perna: 'linha' }, { ...rota[3], perna: 'aproximacao' }] }))
  assert.ok(liga.eventos.some(e => e.texto === 'Motor ligado (aproximação)'))
})

test('contra o vento bordeja no corredor de ±0,7 MN; em popa cambeia (sem passar os 155°)', () => {
  const contra = simularPassagem(base({ tempo: ventoFixo(12, 0) }))
  assert.ok(contra.resumo.viragens >= 2, `${contra.resumo.viragens} viragens`)
  assert.equal(contra.resumo.chegou, true)
  for (const p of contra.pontos) assert.ok(Math.abs((p.lon + 9.5) * 60 * Math.cos(39 * Math.PI / 180)) < 0.85)
  assert.ok(contra.resumo.milhas > 12)
  const popa = simularPassagem(base({ tempo: ventoFixo(12, 180) }))
  assert.ok(popa.resumo.cambadelas >= 1)
  for (const p of popa.pontos) assert.ok(Math.abs(((p.proa - 180 + 540) % 360) - 180) <= 155 + 1e-9)
})

test('rizos pelas rajadas (20 e 27 nós) com os fatores 0,95 e 0,9, e evento', () => {
  const r1 = simularPassagem(base({ tempo: () => ({ ...ventoFixo(14, 270)(), rajada: 22 }) }))
  assert.equal(r1.pontos[0].rizos, 1)
  assert.ok(Math.abs(r1.pontos[0].stw - 6 * 0.85 * 0.95) < 1e-12)
  assert.equal(r1.eventos[1].texto, 'Rizar: 1 rizo (vento 14 nós, rajadas 22)')
  const r2 = simularPassagem(base({ tempo: () => ({ ...ventoFixo(18, 270)(), rajada: 28 }) }))
  assert.equal(r2.pontos[0].rizos, 2)
  // a velocidade à vela recebe os rizos já decididos
  const vistos = []
  simularPassagem(base({ tempo: () => ({ ...ventoFixo(18, 270)(), rajada: 28 }), velocidadeVela: (x) => { vistos.push(x.rizos); return 6 } }))
  assert.equal(vistos[0], 2)
})

test('rizar por tws quando a rajada não tem previsão (null): o evento diz "sem previsão", não "NaN"', () => {
  // tws=18 > rizo1.tws (16) já riza por si só; rajada null nunca ultrapassa os limiares (não força rizo2)
  const r = simularPassagem(base({ tempo: () => ({ ...ventoFixo(18, 270)(), rajada: null }) }))
  assert.equal(r.pontos[0].rizos, 1)
  assert.equal(r.eventos[1].texto, 'Rizar: 1 rizo (vento 18 nós, rajadas sem previsão)')
})

test('twd desconhecido (tws/rajada conhecidos): vai a motor por "sem previsão de vento", sem mexer nos rizos', () => {
  let n = 0
  // fase 1: vento conhecido e forte o suficiente para rizar 1; fase 2: só a direção desaparece
  const tempo = (lat, lon, t) => (n++ < 10 ? ventoFixo(18, 270)() : { ...ventoFixo(18, 270)(), twd: null })
  const r = simularPassagem(base({ tempo }))
  assert.equal(r.pontos[9].rizos, 1) // rizou na fase 1, à vela
  const troca = r.pontos.findIndex(p => p.motor === true)
  assert.ok(troca > 0, 'devia ter passado a motor quando a twd desaparece')
  assert.equal(Number.isNaN(r.pontos[troca].stw), false)
  assert.equal(r.pontos[troca].rizos, r.pontos[troca - 1].rizos) // sem mexer nos rizos ao ir a motor
  assert.ok(r.eventos.some(e => e.texto === 'Motor ligado (sem previsão de vento)'))
})

test('função pura: as mesmas entradas dão o mesmo resultado e não mexe na rota nem nas opções', () => {
  const rota = Object.freeze(reta(10).map(p => Object.freeze(p)))
  const opcoes = Object.freeze({ maxHoras: 5 })
  const a = simularPassagem(base({ rota, opcoes, tempo: ventoFixo(12, 0), energia: criarEnergia({ socInicial: 0.7 }) }))
  const b = simularPassagem(base({ rota, opcoes, tempo: ventoFixo(12, 0), energia: criarEnergia({ socInicial: 0.7 }) }))
  assert.deepEqual(a, b)
  assert.deepEqual(rota, reta(10))
})

test('a velocidade à vela recebe twaPrevAbs = |TWD previsto em bruto − rumo| (não o ângulo ao vento do cenário)', () => {
  // rota para norte (rumo 0°); o vento que decide vem de 270°, o previsto em bruto de 300°
  const vistos = []
  const velocidadeVela = (x) => { vistos.push(x); return 6 }
  simularPassagem(base({ tempo: ventoFixo(12, 270, { prevTwd: 300 }), velocidadeVela }))
  assert.ok(Math.abs(vistos[0].twaPrevAbs - 60) < 1e-9, `${vistos[0].twaPrevAbs}`)
  assert.ok(Math.abs(vistos[0].twa - -90) < 1e-9, `${vistos[0].twa}`) // a polar continua no vento do cenário
  assert.equal('twaAbs' in vistos[0], false) // o |TWA| medido não entra no planeamento
  // sem prevTwd, o vento do cenário é o previsto
  vistos.length = 0
  simularPassagem(base({ velocidadeVela }))
  assert.ok(Math.abs(vistos[0].twaPrevAbs - 90) < 1e-9, `${vistos[0].twaPrevAbs}`)
})

test('sem prevTwd, a queda para a twd só é segura se o cenário não se disser corrigido (w.corrigido)', () => {
  // w.corrigido === true sem prevTwd: a correção entraria a dobrar, em silêncio, no modelo da
  // velocidade — é um erro interno do cenário, não um valor a assumir
  assert.throws(() => {
    simularPassagem(base({ tempo: ventoFixo(12, 270, { corrigido: true }) }))
  }, /prevTwd/)
  // w.corrigido === true COM prevTwd: continua a usar-se o prevTwd, normalmente
  const vistos = []
  const velocidadeVela = (x) => { vistos.push(x); return 6 }
  simularPassagem(base({ tempo: ventoFixo(12, 270, { corrigido: true, prevTwd: 300 }), velocidadeVela }))
  assert.ok(Math.abs(vistos[0].twaPrevAbs - 60) < 1e-9, `${vistos[0].twaPrevAbs}`)
  // sem corrigido (contrato antigo, ex.: simular.mjs), a ausência de prevTwd continua a cair para a twd
  vistos.length = 0
  simularPassagem(base({ tempo: ventoFixo(12, 270), velocidadeVela }))
  assert.ok(Math.abs(vistos[0].twaPrevAbs - 90) < 1e-9, `${vistos[0].twaPrevAbs}`)
})

test('o consumo recebe o rumo e a posição, como a velocidade à vela, para o modelo calcular ondasAnguloRel', () => {
  const vistos = []
  const consumo = (x) => { vistos.push(x); return 2 }
  // vento fraco: motor desde o 1º minuto
  const r = simularPassagem(base({ tempo: ventoFixo(5, 270), consumo }))
  assert.ok(vistos.length > 0)
  assert.equal(vistos[0].rumo, r.pontos[0].proa) // o mesmo rumo que decidiu o ponto (rumoAlvo)
  assert.equal(vistos[0].lat, r.pontos[0].lat) // a mesma posição (pos, já avançada este minuto) que o ponto guarda
  assert.equal(vistos[0].lon, r.pontos[0].lon)
  assert.equal(vistos[0].w.ondasDir, 270) // a direção das ondas previstas, entra em w tal como sempre
  assert.equal(vistos[0].rpm, PADRAO.rpmCruzeiro)
})

test('cada ponto guarda o periodo da previsão (a par de ondas/tws), para a Task 9 calcular horas de leme equivalentes', () => {
  const r = simularPassagem(base())
  assert.equal(r.pontos[0].periodo, 8) // o periodo do ventoFixo() de teste
  assert.equal('motor' in r.pontos[0], true) // o sinal motor/vela já existe, não é preciso acrescentar
})

test('corrente e maré somam à velocidade no fundo; chuva, noite e nascer do sol dão eventos', () => {
  const corrente = simularPassagem(base({ tempo: ventoFixo(12, 270, { corrente: 1, correnteDir: 0 }), correnteExtra: () => ({ v: 0.5, dir: 0 }) }))
  assert.ok(Math.abs(corrente.pontos[0].sog - (5.1 + 1.5)) < 1e-9)
  assert.equal(corrente.pontos[0].mare, 0.5)
  const partida = Date.UTC(2026, 8, 29, 17, 0)
  const noite = noitePeloSol([Date.UTC(2026, 8, 29, 6, 31), Date.UTC(2026, 8, 30, 6, 32)], [Date.UTC(2026, 8, 29, 18, 23), Date.UTC(2026, 8, 30, 18, 22)])
  const r = simularPassagem(base({ rota: reta(70), partida, noite, tempo: ventoFixo(12, 270, { visibilidade: 2500 }), opcoes: { maxHoras: 20 } }))
  const textos = r.eventos.map(e => e.texto)
  assert.ok(textos.includes('Pôr do sol (19:23): ecrã em modo noite, luzes de navegação'))
  assert.ok(textos.includes('Nascer do sol (07:32): ecrã em modo dia'))
  // sem chuva (o ventoFixo tem chuva 0) é só "Visibilidade" (I-17); era "Chuva e visibilidade"
  assert.ok(textos.includes('Visibilidade 2,5 km: radar ligado'), textos.join(' | '))
  assert.ok(Math.abs(r.resumo.horasNoite - (12 * 60 + 9) / 60) < 0.02)
  // noitePeloSol fora dos dias dados: o dia mais perto, deslocado
  assert.equal(noite(Date.UTC(2026, 9, 5, 12)), false)
  assert.equal(noite(Date.UTC(2026, 9, 5, 23)), true)
  const deNoite = simularPassagem(base({ partida: Date.UTC(2026, 8, 29, 22), noite }))
  assert.equal(deNoite.eventos[1].texto, 'Partida de noite (23:00): ecrã em modo noite, luzes de navegação')
})

test('I-17 (decisão do Ivo n.º 10): visibilidade abaixo de 5 km (a constante única), um evento por episódio, "Chuva e" só a chover', () => {
  const { VISIBILIDADE_RADAR_M, CHUVA_RADAR_MM_H, PADRAO: AVISOS } = require('../lib/avisos')
  assert.equal(VISIBILIDADE_RADAR_M, 5000)
  assert.equal(AVISOS.visibilidadeRadar, VISIBILIDADE_RADAR_M)
  assert.equal(AVISOS.chuvaRadar, CHUVA_RADAR_MM_H)
  // 4 km (entre os 3 e os 5 km): antes não dava evento nenhum
  const quatro = simularPassagem(base({ tempo: ventoFixo(12, 270, { visibilidade: 4000 }) }))
  assert.deepEqual(quatro.eventos.filter(e => e.tipo === 'tempo').map(e => e.texto), ['Visibilidade 4,0 km: radar ligado'])
  // no limite (5 km) não; um pouco abaixo sim
  assert.equal(simularPassagem(base({ tempo: ventoFixo(12, 270, { visibilidade: 5000 }) })).eventos.filter(e => e.tipo === 'tempo').length, 0)
  assert.equal(simularPassagem(base({ tempo: ventoFixo(12, 270, { visibilidade: 4999 }) })).eventos.filter(e => e.tipo === 'tempo').length, 1)
  // dois episódios (fraca, boa, fraca): dois eventos; a chover, "Chuva e visibilidade"
  let n = 0
  const tempo = () => {
    const k = n++
    if (k < 20) return ventoFixo(12, 270, { visibilidade: 3000, chuva: 1.2 })()
    if (k < 40) return ventoFixo(12, 270, { visibilidade: 20000 })()
    if (k < 50) return ventoFixo(12, 270, { visibilidade: null })() // sem previsão: acaba o episódio
    return ventoFixo(12, 270, { visibilidade: 2000, chuva: 0.1 })()
  }
  const dois = simularPassagem(base({ tempo }))
  const vis = dois.eventos.filter(e => e.tipo === 'tempo')
  assert.deepEqual(vis.map(e => e.texto), ['Chuva e visibilidade 3,0 km: radar ligado', 'Visibilidade 2,0 km: radar ligado'])
  assert.equal(vis[0].t, dois.pontos[0].t)
  assert.equal(vis[1].t, dois.pontos[50].t)
})

test('M-02: a passagem da frente sem previsão de ondas diz "Fica o mar (sem previsão de ondas)", nunca "(0,0 m)"', () => {
  let n = 0
  const r = simularPassagem(base({ tempo: () => (n++ < 30 ? ventoFixo(15, 270)() : ventoFixo(6, 330, { ondas: null })()) }))
  assert.ok(r.eventos.some(e => e.texto === 'Passagem da frente: o vento cai de 15 para 6 nós e roda para 330°. Fica o mar (sem previsão de ondas)'), r.eventos.map(e => e.texto).join(' | '))
  assert.ok(!r.eventos.some(e => /0,0 m/.test(e.texto)))
})

test('M-19: "Partida da posição atual", "Chegada à Nazaré", "Chegada ao destino" (as preposições com os nomes)', () => {
  const r = simularPassagem(base({ rota: [{ lat: 39, lon: -9.5 }, { nome: 'Nazaré', lat: 39 + 10 / 60, lon: -9.5 }] }))
  assert.equal(r.eventos[0].texto, 'Partida da posição atual (13:00)') // era "Partida de a posição atual"
  assert.match(r.eventos.at(-1).texto, /^Chegada à Nazaré \(\d\d:\d\d\)$/)
  const semNome = simularPassagem(base({ rota: [{ nome: 'Posição atual', lat: 39, lon: -9.5 }, { lat: 39 + 10 / 60, lon: -9.5 }] }))
  assert.equal(semNome.eventos[0].texto, 'Partida da posição atual (13:00)')
  assert.match(semNome.eventos.at(-1).texto, /^Chegada ao destino \(\d\d:\d\d\)$/)
  // com nomeChegada (o do plano), e os sem artigo como sempre
  assert.match(simularPassagem(base({ opcoes: { nomeChegada: 'Figueira da Foz' } })).eventos.at(-1).texto, /^Chegada à Figueira da Foz /)
  assert.equal(simularPassagem(base()).eventos[0].texto, 'Partida de A (13:00)')
})

test('passagem da frente, energia, costa e "não chegou"', () => {
  let n = 0
  const frente = simularPassagem(base({ tempo: () => (n++ < 30 ? ventoFixo(15, 270)() : ventoFixo(6, 330, { ondas: 2.2 })()) }))
  assert.ok(frente.eventos.some(e => e.texto === 'Passagem da frente: o vento cai de 15 para 6 nós e roda para 330°. Fica o mar (2,2 m)'))
  const e = simularPassagem(base({ energia: criarEnergia({ socInicial: 0.5 }), distanciaCosta: (p) => 3 + (p.lat - 39) * 60 }))
  assert.ok(e.resumo.socFinal < 0.5 && e.resumo.socFinal > 0.45)
  assert.equal(e.resumo.socMin, e.resumo.socFinal)
  assert.ok(Math.abs(e.resumo.costaMinMn - 3) < 0.1)
  const alarmes = simularPassagem(base({ energia: { inicio: () => 0, passo: (s, ctx) => ({ estado: s + 1, soc: 0.5, eventos: s === 3 ? [{ texto: 'Bateria baixa' }] : [] }) } }))
  assert.deepEqual(alarmes.eventos.filter(x => x.tipo === 'alarme').map(x => x.texto), ['Bateria baixa'])
  const longe = simularPassagem(base({ rota: reta(100), opcoes: { maxHoras: 2 } }))
  assert.equal(longe.resumo.chegou, false)
  assert.equal(longe.eventos.at(-1).texto, 'Não chegou dentro de 2 h')
  assert.equal(longe.resumo.duracaoH, 2)
})

test('um ponto de rota passado ao lado (a mais de 0,15 MN) conta como passado', () => {
  const rota = [{ nome: 'A', lat: 39, lon: -9.5 }, { nome: 'Meio', lat: 39 + 5 / 60, lon: -9.5 }, { nome: 'Fim', lat: 39 + 10 / 60, lon: -9.5 }]
  // corrente de través de 1 nó empurra para leste e o barco não corrige
  const r = simularPassagem(base({ rota, velocidadeVela: () => 6, tempo: ventoFixo(12, 270, { corrente: 1, correnteDir: 90 }) }))
  assert.ok(r.eventos.some(e => e.texto.startsWith('Meio:')))
  assert.equal(r.resumo.chegou, true)
})

// ---------- os três cenários com a previsão real de 29/09 ----------

test('29/09, Algés → Peniche a 5 MN: pessimista, provável e otimista por ordem (os cenários do lib/cenarios.js)', async () => {
  const c = require('../lib/costa')
  const rotas = require('../lib/rotas')
  const prev = require('../lib/previsao')
  const mare = require('../lib/mare')
  const base = require('../lib/base')
  const { criarCenarios } = require('../lib/cenarios')

  const f = gz('previsao-2026-09-29.json.gz')
  const p29 = prev.interpretar(f.pontos.map(c.P), f.forecast, f.marine, f.obtidaSimulada)
  const tempoBruto = prev.criarTempo(p29)
  const nivel = prev.nivelDoMar(p29)
  const correnteExtra = mare.criarMareTejo(mare.preiaMares(nivel.t, nivel.nivel))
  const costa = c.carregarCosta()
  const D = (id) => costa.destinos.find(d => d.id === id)
  const alt = rotas.gerarRota(costa, { partida: D('alges'), destino: D('peniche'), afastamento: 5 })
  assert.equal(alt.excluida, false)
  const noite = noitePeloSol(f.sol.daily.sunrise.map(x => Date.parse(x + 'Z')), f.sol.daily.sunset.map(x => Date.parse(x + 'Z')))

  // Os cenários são os do cálculo (lib/cenarios.js, sem modelos da AI): o vento que decide (rizos, motor,
  // máximos) é o do cenário (pessimista = vento P90), a velocidade à vela é a polar no vento do quantil
  // contrário (pessimista = menos vento a empurrar) e o gasóleo é o do quantil do cenário. Antes eram
  // montados à mão aqui (× 1,1 / × 0,9) e uma regressão no lib/cenarios.js não se via (auditoria M-17).
  const cenarios = criarCenarios({ tempoBruto, modelos: {}, polar: base.carregarPolar(), obtida: Date.parse(p29.obtida) })
  const res = {}
  for (const nome of ['pessimista', 'provavel', 'otimista']) {
    const k = cenarios[nome]
    res[nome] = simularPassagem({
      rota: alt.pontos,
      partida: Date.parse('2026-09-29T14:32Z'),
      tempo: k.tempo,
      correnteExtra,
      velocidadeVela: k.velocidadeVela,
      consumo: k.consumo,
      noite,
      energia: criarEnergia({ socInicial: 0.9 }),
      distanciaCosta: (p) => costa.distanciaTerra(p)
    }).resumo
  }
  const { pessimista: pe, provavel: pr, otimista: ot } = res
  for (const r of [pe, pr, ot]) assert.equal(r.chegou, true)
  assert.ok(pe.duracaoH > pr.duracaoH && pr.duracaoH > ot.duracaoH, `${pe.duracaoH} > ${pr.duracaoH} > ${ot.duracaoH}`)
  assert.ok(pe.gasoleoGasto >= pr.gasoleoGasto && pr.gasoleoGasto >= ot.gasoleoGasto)
  assert.ok(pe.ventoMax > pr.ventoMax && pr.ventoMax > ot.ventoMax)
  // a rota tem ~63,6 MN (as aproximações de Algés e de Peniche pelo canal da carta, dados/destinos.json)
  // e a simulação faz o mesmo mais os bordos e cambadelas
  assert.ok(Math.abs(alt.milhas - 63.6) < 0.5, `${alt.milhas}`)
  for (const r of [pe, pr, ot]) assert.ok(r.milhas > alt.milhas - 0.5 && r.milhas < alt.milhas + 3)
  if (process.env.ROTA_MOSTRAR) console.log(JSON.stringify({ milhasRota: alt.milhas, pe, pr, ot }, null, 1))
})

test('a linha do tempo leva o semDados e o aproximado da previsão (lib/previsao.js) só quando os há, para a segurança', () => {
  const sem = simularPassagem(base())
  assert.equal('semDados' in sem.pontos[0], false)
  assert.equal('aproximado' in sem.pontos[0], false)
  let n = 0
  const tempo = (lat, lon, t) => ({ ...ventoFixo(12, 270)(), ...(n++ === 5 ? { semDados: ['ondas'], aproximado: ['tws'] } : {}) })
  const r = simularPassagem(base({ tempo }))
  assert.deepEqual(r.pontos[5].semDados, ['ondas'])
  assert.deepEqual(r.pontos[5].aproximado, ['tws'])
  assert.equal('semDados' in r.pontos[4], false)
})
