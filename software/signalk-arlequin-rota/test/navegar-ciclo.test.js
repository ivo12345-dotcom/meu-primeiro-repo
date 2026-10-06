'use strict'
// O ciclo de minuto a minuto no plugin (desenho 3b-2): lê o SignalK (posição, SOG, vento real,
// pressão, gasóleo, SoC e a rota ativa), segue o plano ativo e publica os notifications.rota.* por
// delta, só nas mudanças; com o relógio e o SignalK falsos.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pa = require('../lib/plano-ativo')
const c = require('../lib/costa')
const prev = require('../lib/previsao')
const { appFalso, plugin, chamar, calcular, fetchFalso, H } = require('./ajuda')

const MIN = 60000
const NO = 1852 / 3600 // m/s
const estadoDe = (app, k) => app.self[`notifications.rota.${k}`]?.state ?? 'normal'
const ativos = (app) => Object.entries(app.self).filter(([k, v]) => k.startsWith('notifications.rota.') && v?.state !== 'normal').map(([k, v]) => `${k}=${v.state}`)
// os deltas publicados de um caminho
const publicacoes = (app, caminho) => app.deltas.flatMap(d => d.updates.flatMap(u => u.values)).filter(v => v.path === caminho)

// Cascais → Algés, "sair agora", ativado; o barco no cais. agendados: o ciclo registado no start()
async function preparar (extra = {}) {
  const app = appFalso()
  const agendados = []
  const pl = plugin(app, { agendarCiclo: (fn, ms) => { agendados.push({ fn, ms }); return agendados.length }, pararCiclo: () => {}, ...extra })
  pl.p.start({ pasta: path.join(app.dir, 'dados') })
  // a melhor sai amanhã às 09:30 (o relógio vai para lá, com a previsão obtida a essa hora)
  const { id, resultado } = await calcular(pl.r, { destino: 'alges', tripulacao: 'so' })
  const a = await chamar(pl.r.post['/ativar'], { body: { id, alternativa: 0 } })
  assert.equal(a.code, 200, a.erro)
  const alt = resultado.alternativas[0]
  const t0 = Date.parse(alt.partida)
  const pontos = [...alt.rasto.filter((_, i) => i % 5 === 0), alt.rasto.at(-1)].map(p => ({ lat: p.lat, lon: p.lon }))
  prev.guardarArquivo(path.join(app.dir, 'dados', 'previsoes'), await prev.obterPrevisao({ pontos, agora: t0, fetch: fetchFalso() }))
  pl.acertar(t0)
  app.self['environment.outside.pressure'] = 101500
  app.self['navigation.speedOverGround'] = 0
  const por = (p, sogNos = 4.3) => { app.self['navigation.position'] = { latitude: p.lat, longitude: p.lon }; app.self['navigation.speedOverGround'] = sogNos * NO }
  const ciclo = async (ms = MIN) => { pl.avancar(ms); await pl.p.cicloNavegar() }
  return { app, ...pl, id, alt, t0, agendados, por, ciclo }
}

test('o start() regista o ciclo de minuto a minuto (60 s); sem plano ativo o ciclo não publica nada ativo', async () => {
  const app = appFalso()
  const agendados = []
  const { p } = plugin(app, { agendarCiclo: (fn, ms) => { agendados.push(ms); return 1 }, pararCiclo: () => {} })
  p.start({ pasta: path.join(app.dir, 'dados') })
  assert.deepEqual(agendados, [60000])
  await p.cicloNavegar()
  assert.deepEqual(ativos(app), [])
  p.stop()
})

test('à espera de sair: sem avisos; ao sair (> 0,5 MN) passa a "a navegar" e grava a saída; parado no rasto, o atraso cresce e passa os 30 min → recalcula (warn)', async () => {
  const s = await preparar()
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'à espera de sair')
  assert.deepEqual(s.app.deltas.flatMap(d => d.updates.flatMap(u => u.values)).filter(v => v.value.state !== 'normal'), [])
  // 20 min depois, no ponto do rasto dos 20 min: a navegar, sem atraso
  const r20 = s.alt.rasto[2]
  s.por(r20)
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  assert.equal(pa.ler(s.app.getDataDirPath()).plano.estado, 'a navegar')
  assert.equal(pa.ler(s.app.getDataDirPath()).plano.saida, new Date(s.t0 + 20 * MIN).toISOString())
  assert.ok(Math.abs(s.p.acompanhamento().atrasoMin) < 1, s.p.acompanhamento().atrasoMin)
  // parado ali: de minuto a minuto o atraso cresce (média de 10 min)
  s.por(r20, 0)
  for (let m = 1; m <= 35; m++) await s.ciclo()
  assert.ok(s.p.acompanhamento().atrasoMin > 25, s.p.acompanhamento().atrasoMin)
  for (let m = 1; m <= 10; m++) await s.ciclo()
  assert.equal(estadoDe(s.app, 'recalcula'), 'warn')
  assert.match(s.app.self['notifications.rota.recalcula'].message, /^Recalcula a rota: atraso de \d+ min sobre o plano$/)
  assert.deepEqual(s.app.self['notifications.rota.recalcula'].method, ['visual', 'sound'])
  // publicado uma vez só (as mensagens seguintes, com outros minutos, não se publicam)
  assert.equal(publicacoes(s.app, 'notifications.rota.recalcula').filter(v => v.value.state === 'warn').length, 1)
  s.p.stop()
})

test('barómetro: amostras de minuto a minuto guardadas no plugin (barometro.json); 3,5 hPa em 1 h → warn; sem pressão, nada', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  for (let m = 1; m <= 60; m++) { s.app.self['environment.outside.pressure'] = 101500 - m * 350 / 60; s.por(s.alt.rasto[Math.min(2 + Math.floor(m / 10), s.alt.rasto.length - 1)]); await s.ciclo() }
  assert.equal(estadoDe(s.app, 'barometro'), 'warn')
  // a mensagem é a do minuto em que passou dos 3 hPa
  assert.match(s.app.self['notifications.rota.barometro'].message, /^Barómetro: caiu 3,[01] hPa em 3 h — o tempo pode piorar antes do previsto$/)
  assert.equal(s.p.acompanhamento().barometroSemLeitura, false)
  delete s.app.self['environment.outside.pressure']
  await s.ciclo()
  assert.equal(s.p.acompanhamento().barometroSemLeitura, true)
  s.p.stop()
  // no disco de 10 em 10 min e no stop: as 61 amostras (a 2.ª da saída, à mesma hora, não conta)
  const guardadas = JSON.parse(fs.readFileSync(path.join(s.app.getDataDirPath(), 'barometro.json'), 'utf8'))
  assert.equal(guardadas.length, 61)
})

test('previsão: a mais recente arquivada que cubra a posição; com mais de 6 h warn, com mais de 12 h alarm com apito curto', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  assert.equal(estadoDe(s.app, 'previsao'), 'normal')
  await s.ciclo(6.5 * H)
  assert.equal(estadoDe(s.app, 'previsao'), 'warn')
  await s.ciclo(6 * H)
  assert.deepEqual(s.app.self['notifications.rota.previsao'], { state: 'alarm', method: ['visual', 'sound'], apito: 'curto', message: 'Previsão com 13 h: confia nos instrumentos e no barómetro' })
  s.p.stop()
})

test('rota mudada no OpenCPN: "pausado", o acompanhamento para, os avisos voltam a normal e nada segue para os contactos; a rota do plano de volta: retoma', async () => {
  const s = await preparar()
  const planos = []
  s.app.on('arlequin:plano', (e) => planos.push(e))
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  await s.ciclo(13 * H)
  assert.equal(estadoDe(s.app, 'previsao'), 'alarm')
  const href = s.app.rotaAtiva
  s.app.rotaAtiva = '/resources/routes/outra'
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'a navegar', 'uma leitura não chega (Tarefa 8.3)')
  await s.ciclo(); await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  assert.equal(pa.ler(s.app.getDataDirPath()).plano.estado, 'pausado')
  assert.deepEqual(ativos(s.app), [])
  assert.deepEqual(planos, [])
  s.app.rotaAtiva = null
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'pausado')
  s.app.rotaAtiva = href
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  assert.equal(estadoDe(s.app, 'previsao'), 'alarm')
  s.p.stop()
})

test('sem GPS mais de 2 min (a hora da posição): "sem GPS", e o plano não muda; a API de rumo a falhar não pausa', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  s.app.horas['navigation.position'] = new Date(s.t0 + 20 * MIN).toISOString()
  await s.ciclo(2 * MIN)
  assert.equal(s.p.acompanhamento().semGps, false, '2 min')
  await s.ciclo(1 * MIN)
  assert.equal(s.p.acompanhamento().semGps, true, '3 min')
  s.app.getCourse = async () => { throw new Error('sem API') }
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  s.p.stop()
})

test('reinício a meio: o plano continua do ficheiro (a navegar, com a posição na rota), o barómetro guardado, e o que já estava publicado não se publica outra vez', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0) // a 2.ª amostra longe da partida: saiu
  s.por(s.alt.rasto[2], 0)
  for (let m = 1; m <= 45; m++) await s.ciclo()
  assert.equal(estadoDe(s.app, 'recalcula'), 'warn')
  const antes = s.app.deltas.length
  const milhas = s.p.acompanhamento().milhas
  s.p.stop()
  const q = plugin(s.app, { agendarCiclo: () => 1, pararCiclo: () => {} })
  q.acertar(s.agora())
  q.p.start({ pasta: path.join(s.app.dir, 'dados') })
  assert.equal(q.p.planoAtivo().estado, 'a navegar')
  for (let m = 1; m <= 3; m++) { q.avancar(MIN); await q.p.cicloNavegar() }
  // o atraso recomeça a média, mas não salta para o fim da rota e não se publica o recalcula outra vez
  assert.ok(Math.abs(q.p.acompanhamento().milhas - milhas) < 0.05)
  const novos = s.app.deltas.slice(antes).flatMap(d => d.updates.flatMap(u => u.values))
  assert.deepEqual(novos.filter(v => v.path === 'notifications.rota.recalcula'), [])
  q.p.stop()
})

test('um erro no ciclo vai para o registo e o ciclo seguinte corre', async () => {
  const s = await preparar()
  const getSelfPath = s.app.getSelfPath
  s.app.getSelfPath = () => { throw new Error('rebentou') }
  await s.ciclo()
  assert.match(s.app.erros.at(-1), /^a navegar: rebentou$/)
  s.app.getSelfPath = getSelfPath
  await s.ciclo()
  assert.equal(s.p.planoAtivo().estado, 'à espera de sair')
  s.p.stop()
})

test('M3: as leituras com mais de 2 min (ou sem hora legível) contam como em falta: a pressão e o vento velhos não entram; a posição sem hora é "sem GPS"', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0)
  s.app.self['environment.wind.speedTrue'] = 25 * NO
  await s.ciclo()
  assert.equal(s.p.acompanhamento().barometroSemLeitura, false)
  assert.ok(s.p.acompanhamento().vento, 'o vento fresco entra')
  // 3 min depois da última atualização: velhos
  const velho = new Date(s.agora() - 2 * MIN).toISOString()
  s.app.horas['environment.outside.pressure'] = velho
  s.app.horas['environment.wind.speedTrue'] = velho
  for (let m = 0; m < 11; m++) await s.ciclo()
  assert.equal(s.p.acompanhamento().barometroSemLeitura, true, 'pressão velha: sem leitura')
  assert.equal(s.p.acompanhamento().vento, null, 'o vento velho sai da média de 10 min')
  assert.equal(s.p.acompanhamento().semGps, false)
  s.app.horas['navigation.position'] = 'sem hora'
  await s.ciclo()
  assert.equal(s.p.acompanhamento().semGps, true, 'posição sem hora legível')
  s.p.stop()
})

test('M3: um SOG velho (de antes de parar o GPS) não conta: SOG > 2 nós com mais de 2 min não faz a saída', async () => {
  const s = await preparar()
  const partida = s.alt.pontosRota[0]
  s.por(partida, 3)
  s.app.horas['navigation.speedOverGround'] = new Date(s.agora() - 3 * MIN).toISOString()
  for (let m = 0; m < 8; m++) { s.app.horas['navigation.speedOverGround'] = new Date(s.agora() - 2 * MIN).toISOString(); await s.ciclo() }
  assert.equal(s.p.planoAtivo().estado, 'à espera de sair')
  s.p.stop()
})

test('M4: a API de rumo que nunca responde não pára o ciclo (limite: não se sabe a rota, o plano não pausa)', async () => {
  const s = await preparar({ esperaRumoMs: 20 })
  s.app.getCourse = () => new Promise(() => {})
  const parado = (ms) => new Promise((resolve, reject) => setTimeout(() => reject(new Error('o ciclo ficou parado')), ms))
  for (let m = 0; m < 2; m++) {
    await Promise.race([s.ciclo(), parado(1000)])
    assert.equal(s.p.acompanhamento().agora, s.agora(), `o ciclo ${m} correu`)
  }
  assert.equal(s.p.planoAtivo().estado, 'à espera de sair')
  s.p.stop()
})

test('M9: o barómetro fica em memória; no disco só com um plano aberto e no máximo de 10 em 10 min (e no stop)', async () => {
  // sem plano: nada no disco
  const app = appFalso()
  const { p, avancar } = plugin(app, { agendarCiclo: () => 1, pararCiclo: () => {} })
  p.start({ pasta: path.join(app.dir, 'dados') })
  app.self['environment.outside.pressure'] = 101500
  for (let m = 0; m < 15; m++) { avancar(MIN); await p.cicloNavegar() }
  const ficheiro = path.join(app.getDataDirPath(), 'barometro.json')
  assert.equal(fs.existsSync(ficheiro), false)
  p.stop()
  // com plano: a 1.ª, e depois de 10 em 10 min
  const s = await preparar()
  const f = path.join(s.app.getDataDirPath(), 'barometro.json')
  const gravadas = () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).length : 0)
  await s.ciclo(0)
  assert.equal(gravadas(), 1)
  for (let m = 1; m <= 9; m++) await s.ciclo()
  assert.equal(gravadas(), 1, '9 min')
  await s.ciclo()
  assert.equal(gravadas(), 11, '10 min')
  await s.ciclo(0) // a mesma hora outra vez não é outra amostra
  for (let m = 1; m <= 3; m++) await s.ciclo()
  assert.equal(gravadas(), 11)
  s.p.stop()
  assert.equal(gravadas(), 14, 'o stop grava o que falta')
})

test('auditoria M-13: a navegar, o aviso dos recursos usa o gasóleo e a bateria mínimos à chegada da configuração (os mesmos do cálculo)', async () => {
  const s = await preparar()
  s.p.stop()
  s.p.start({ pasta: path.join(s.app.dir, 'dados'), seguranca: { gasoleoMinL: 130 } })
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  await s.ciclo()
  // 124 L no depósito: à chegada fica abaixo dos 130 L configurados
  assert.equal(s.app.self['notifications.rota.recursos'].state, 'warn')
  assert.match(s.app.self['notifications.rota.recursos'].message, /^Recursos: gasóleo à chegada ~\d+ L$/)
  s.p.stop()
  // com o padrão (40 L): nada
  const t = await preparar()
  t.por(t.alt.rasto[2])
  await t.ciclo(20 * MIN)
  await t.ciclo(0)
  await t.ciclo()
  assert.equal(t.app.self['notifications.rota.recursos']?.state ?? 'normal', 'normal')
  t.p.stop()
})

test('auditoria I-16: a navegar, a correção do vento da AI recebe a tendência do barómetro em 3 h (antes ia sempre null)', async () => {
  const cenarios = require('../lib/cenarios')
  const original = cenarios.criarCorrecaoVento
  const vistas = []
  cenarios.criarCorrecaoVento = (a) => { vistas.push(a.tendPressao3h); return original(a) }
  try {
    const s = await preparar()
    s.por(s.alt.rasto[2])
    await s.ciclo(20 * MIN)
    await s.ciclo(0)
    assert.equal(s.p.planoAtivo().estado, 'a navegar')
    for (let m = 1; m <= 185; m++) {
      s.app.self['environment.outside.pressure'] = 101500 - 2 * m
      s.por(s.alt.rasto[Math.min(2 + Math.floor(m / 10), s.alt.rasto.length - 1)])
      await s.ciclo()
    }
    assert.equal(vistas[0], null, 'sem 3 h de amostras')
    assert.ok(Math.abs(vistas.at(-1) - (-3.6)) < 1e-6, `${vistas.at(-1)}`)
    s.p.stop()
  } finally { cenarios.criarCorrecaoVento = original }
})

test('auditoria M-27: a previsão de agora não se lê do arquivo de minuto a minuto (no máximo de 10 em 10 min, ou com uma previsão nova, ou 5 MN mais longe) e só conta a dos últimos 50 h', async () => {
  const s = await preparar()
  s.por(s.alt.rasto[2])
  await s.ciclo(20 * MIN)
  await s.ciclo(0)
  assert.equal(s.p.planoAtivo().estado, 'a navegar')
  const pasta = path.join(s.app.dir, 'dados', 'previsoes')
  const orig = fs.readFileSync
  let lidas = 0
  fs.readFileSync = (f, ...x) => { if (String(f).startsWith(pasta)) lidas++; return orig(f, ...x) }
  try {
    await s.ciclo()
    const primeira = lidas
    for (let m = 0; m < 8; m++) await s.ciclo()
    assert.equal(lidas, primeira, 'nos 9 min seguintes não volta a ler o arquivo')
    assert.equal(estadoDe(s.app, 'previsao'), 'normal')
    await s.ciclo(2 * MIN)
    assert.ok(lidas > primeira, 'passados 10 min, lê outra vez')
  } finally { fs.readFileSync = orig }
  // com a previsão mais recente com mais de 50 h: não serve (sem previsão)
  await s.ciclo(51 * H)
  assert.deepEqual(s.app.self['notifications.rota.previsao'], { state: 'alarm', method: ['visual', 'sound'], apito: 'curto', message: 'Sem previsão: confia nos instrumentos e no barómetro' })
  s.p.stop()
})

test('06/10 (demonstração ao vivo): com o plano aberto e a sua rota ativa, quando o barco passa um ponto da rota o plugin avança o ponto a seguir na API de rumo (app.activateRoute com o pointIndex novo, a API interna: sem sessão); no cais, parado, não; com outra rota ativa, não', async () => {
  const s = await preparar()
  const pts = (await s.app.resourcesApi.getResource('routes', s.app.rotaAtiva.split('/').pop())).feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
  assert.ok(pts.length >= 4, `a rota tem ${pts.length} pontos`)
  // a API de rumo do falso passa a devolver o pointIndex da última ativação (como o servidor)
  s.app.getCourse = async () => ({ activeRoute: { href: s.app.rotaAtiva, pointIndex: s.app.ativacoes.at(-1)?.pointIndex ?? 1, pointTotal: pts.length } })
  const n = s.app.ativacoes.length
  await s.ciclo(0)
  assert.equal(s.app.ativacoes.length, n, 'no cais, parado: nada')
  // 0,2 MN para lá de um ponto cujo troço seguinte tem pelo menos 0,6 MN (os primeiros, no cais, estão a dezenas
  // de metros uns dos outros), a 5 nós: o ponto a seguir passa a ser o seguinte
  // a mais de 1,5 MN do cais (o plano só projeta as milhas depois de sair: 0,5 MN em duas leituras)
  let acum = 0; const acums = pts.map((q, i) => (acum += i ? c.distanciaMn(pts[i - 1], q) : 0))
  const k = pts.findIndex((q, i) => i >= 2 && i < pts.length - 1 && acums[i] >= 1.5 && c.distanciaMn(q, pts[i + 1]) >= 0.6)
  assert.ok(k >= 2, 'há um troço de 0,6 MN ou mais')
  // (0,2 MN para lá, no sentido do troço seguinte: a rota pode ter pontos repetidos, e o troço anterior ser nulo)
  const f = 0.2 / c.distanciaMn(pts[k], pts[k + 1])
  const pos = { lat: pts[k].lat + (pts[k + 1].lat - pts[k].lat) * f, lon: pts[k].lon + (pts[k + 1].lon - pts[k].lon) * f }
  s.por(pos, 5)
  // alguns ciclos (a janela à frente, 5 MN por ciclo, apanha o salto do teste): o ponto a seguir chega ao seguinte
  // ao sítio onde o barco está, sem nunca recuar
  await s.ciclo(50 * MIN)
  for (let m = 0; m < 4; m++) await s.ciclo()
  const indices = s.app.ativacoes.slice(n).map(x => x.pointIndex)
  assert.ok(indices.length >= 1, `avançou o ponto (estado ${s.p.planoAtivo().estado})`)
  for (let j = 1; j < indices.length; j++) assert.ok(indices[j] > indices[j - 1], `nunca recua: ${indices}`)
  const ult = s.app.ativacoes.at(-1)
  assert.equal(ult.href, s.app.rotaAtiva)
  assert.equal(ult.pointIndex, k + 1, JSON.stringify({ k, indices }))
  // o mesmo sítio outra vez: já está no ponto certo, não volta a ativar
  const n2 = s.app.ativacoes.length
  await s.ciclo()
  assert.equal(s.app.ativacoes.length, n2, 'sem mudança não há nova ativação')
  // outra rota ativa (não é a do plano): nada
  s.app.rotaAtiva = '/resources/routes/outra'
  await s.ciclo()
  assert.equal(s.app.ativacoes.length, n2)
  s.p.stop()
})
