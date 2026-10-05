'use strict'
// Viagem acelerada no SignalK local (desenho 3b-2, validação ao vivo da melhor rota "a navegar").
// O simulador do dev não segue uma rota nem acelera o relógio: este script faz de GPS, barómetro,
// depósito e relógio, por deltas no WebSocket do SignalK.
//
//   node viagem-acelerada.js [--de alges] [--para peniche] [--tripulacao so] [--porta 3000] [--fator 60]
//        [--atraso-em 0.3] [--atraso-min 60] [--baro-em 0.5] [--baro-queda 4] [--baro-horas 2]
//        [--pressao 1015] [--gasoleo 70] [--consumo 2.5] [--soc 0.85] [--pausa <ficheiro>]
//        [--telegram http://localhost:8081]
//
// NUNCA no Pi (nem noutro SignalK que não seja o do dev): injeta posição e hora falsas, manda planos e
// ativa rotas. O script recusa-se a correr sem a configuração de dev, lida do próprio servidor (GET
// /plugins/<id>/config): o plugin da rota com modoTeste, horaSimulada (e cicloSegundos 1), e o porto
// ligado ao Telegram falso (telegramBase em localhost) só com os contactos falsos do dev (chatId 222);
// com a segurança do SignalK ligada (como no barco), a configuração não se lê e também recusa.
// Ctrl-C (ou um erro a meio): termina o plano, desativa a rota e repõe a hora (navigation.datetime de
// agora). No fim do teste, desliga a horaSimulada e põe o cicloSegundos nos 60 (no plugin da rota as
// opções de teste vêm desligadas por omissão; na configuração do dev o modoTeste fica ligado — é a marca
// de que este SignalK é de testes, e o testar-rota --em/--ativar também a pede).
// Os deltas levam a fonte 'arlequin-simulador.viagem-acelerada': a caixa negra marca-os "simulado".
//
// Antes (o plugin da rota com modoTeste, horaSimulada e cicloSegundos 1; o simulador desligado; o porto
// ligado ao Telegram falso):
//   1. põe o barco no cais de partida, com a hora de agora;
//   2. calcula "sair agora" até ao destino, envia o plano pelo Telegram (POST /plano-telegram) e ativa
//      a 1.ª alternativa;
// Depois, de segundo em segundo (com --fator 60, 1 s = 1 min da viagem), manda a posição no rasto
// provável do plano, o SOG, o rumo, a hora (navigation.datetime), a pressão, o gasóleo e o SoC:
//   - parado durante --atraso-min a --atraso-em da viagem (o atraso forçado);
//   - a pressão parte de --pressao hPa (1015) e cai --baro-queda hPa em --baro-horas a partir de --baro-em
//     da viagem;
//   - o gasóleo desce --consumo L/h a andar (mais do que a curva da Volvo que o plano conta).
// Com --pausa <ficheiro>: enquanto o ficheiro existir, a hora não anda (para as capturas).
// Se o SignalK cair (parado a meio), espera e volta a ligar; a hora da viagem não anda entretanto.
// Escreve a linha do tempo (hora da viagem, estado do plano, avisos notifications.rota.*) e, no fim,
// o que o Telegram falso recebeu em cada chat.

const fs = require('node:fs')
const path = require('node:path')
const { ROTA_ID, FALSOS, fonteDev, verificarDev, motivosParaNaoCorrer } = require('./guarda-dev')

const MIN = 60000
const H = 3600000
const NO = 1852 / 3600
const GRAU = Math.PI / 180
// A fonte dos deltas (auditoria I-35, contrato C9): a caixa negra marca 'arlequin-simulador.*' como
// simulado (nunca treina a AI). A guarda (verificarDev) e os contactos falsos estão em guarda-dev.js.
const FONTE = fonteDev('viagem-acelerada')

// O delta que a viagem manda pelo WebSocket, à hora (simulada) t.
const deltaViagem = (t, valores) => ({ context: 'vessels.self', updates: [{ $source: FONTE, timestamp: new Date(t).toISOString(), values: valores }] })

// Ctrl-C ou um erro a meio: termina o plano, desativa a rota e repõe a hora (um passo que falha não
// impede os outros).
async function limpar ({ base, json, enviar, agora = () => Date.now(), log = console.log }) {
  const passo = async (texto, fn) => { try { await fn() } catch (e) { log(`não consegui ${texto}: ${e.message}`) } }
  await passo('terminar o plano', () => json(`${base}/plugins/${ROTA_ID}/plano-ativo/terminar`, { method: 'POST' }))
  await passo('desativar a rota', () => json(`${base}/signalk/v2/api/vessels/self/navigation/course`, { method: 'DELETE' }))
  await passo('repor a hora', async () => {
    const t = agora()
    if (!enviar(t, [{ path: 'navigation.datetime', value: new Date(t).toISOString() }])) throw new Error('sem ligação ao SignalK')
  })
}

// ---------- as contas (testadas em test/viagem-acelerada.test.js) ----------
// A posição no rasto [{ lat, lon, t }] à hora do plano tPlano: { lat, lon, sogNos, cog (rad), fim }.
function posicaoNoRasto (rasto, tPlano) {
  const ts = rasto.map(p => Date.parse(p.t))
  if (tPlano <= ts[0]) return { lat: rasto[0].lat, lon: rasto[0].lon, sogNos: 0, cog: 0, fim: false }
  const n = rasto.length - 1
  if (tPlano >= ts[n]) return { lat: rasto[n].lat, lon: rasto[n].lon, sogNos: 0, cog: 0, fim: true }
  let i = 0
  while (ts[i + 1] < tPlano) i++
  const a = rasto[i]; const b = rasto[i + 1]
  const f = (tPlano - ts[i]) / (ts[i + 1] - ts[i])
  const dx = (b.lon - a.lon) * 60 * Math.cos(a.lat * GRAU)
  const dy = (b.lat - a.lat) * 60
  const horas = (ts[i + 1] - ts[i]) / H
  const cog = ((Math.atan2(dx, dy) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, sogNos: Math.hypot(dx, dy) / horas, cog, fim: false }
}

// O cenário: a hora do plano, parado, a pressão e o gasóleo a cada hora simulada t.
function criarCenario ({ t0, duracaoMs, atrasoEm = 0.3, atrasoMin = 60, baroEm = 0.5, baroQueda = 4, baroHoras = 2, pressao = 1015, gasoleo = 70, consumo = 2.5 }) {
  const tA = t0 + atrasoEm * duracaoMs
  const atrasoMs = atrasoMin * MIN
  const tB = t0 + baroEm * duracaoMs
  return function (t) {
    const parado = t >= tA && t < tA + atrasoMs
    const paradoMs = Math.min(Math.max(t - tA, 0), atrasoMs)
    const tPlano = t - paradoMs
    const queda = baroQueda * Math.min(Math.max((t - tB) / (baroHoras * H), 0), 1)
    const fimPlano = t0 + duracaoMs
    const andouH = Math.max(0, Math.min(tPlano, fimPlano) - t0) / H
    return { tPlano, parado, pressaoHpa: pressao - queda, gasoleoL: gasoleo - consumo * andouH }
  }
}

// ---------- a viagem ----------
const args = process.argv.slice(2)
const arg = (nome, padrao) => { const i = args.indexOf(`--${nome}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao }
const num = (nome, padrao) => Number(arg(nome, padrao))

async function main () {
  const porta = num('porta', 3000)
  const base = `http://localhost:${porta}`
  const rota = `${base}/plugins/signalk-arlequin-rota`
  const fator = num('fator', 60)
  const pausa = arg('pausa', null)
  const telegram = arg('telegram', 'http://localhost:8081')
  const hora = (t) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
  const log = (t, texto) => console.log(`[${new Date().toISOString().slice(11, 19)} real · ${t ? hora(t) : '—'} viagem] ${texto}`)
  async function json (url, opcoes = {}) {
    const r = await fetch(url, { ...opcoes, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) })
    const texto = await r.text()
    let corpo = null
    try { corpo = JSON.parse(texto) } catch { corpo = texto }
    return { status: r.status, corpo }
  }

  // o WebSocket, com religação (a hora da viagem não anda sem ligação)
  let ws = null
  let ligado = false
  const avisos = new Map()
  let tAtual = null
  function ligar () {
    ws = new WebSocket(`ws://localhost:${porta}/signalk/v1/stream?subscribe=none`)
    ws.onopen = () => {
      ligado = true
      ws.send(JSON.stringify({ context: 'vessels.self', subscribe: [{ path: 'notifications.rota.*', policy: 'instant' }] }))
      log(tAtual, 'ligado ao SignalK')
    }
    ws.onmessage = (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      for (const u of m.updates || []) {
        for (const v of u.values || []) {
          if (!v.path?.startsWith('notifications.rota.') || !v.value) continue
          const antes = avisos.get(v.path)
          if (antes === `${v.value.state}|${v.value.message}`) continue
          avisos.set(v.path, `${v.value.state}|${v.value.message}`)
          log(tAtual, `AVISO ${v.path} = ${v.value.state}${v.value.apito ? ` (apito ${v.value.apito})` : ''}${v.value.message ? `: ${v.value.message}` : ''}`)
        }
      }
    }
    ws.onclose = () => { if (ligado) log(tAtual, 'sem ligação ao SignalK: à espera'); ligado = false; setTimeout(ligar, 2000) }
    ws.onerror = () => {}
  }
  const enviar = (t, valores) => {
    if (!ligado) return false
    ws.send(JSON.stringify(deltaViagem(t, valores)))
    return true
  }

  // 0. só no SignalK do dev (nunca no Pi): a configuração lida do servidor
  const motivos = await motivosParaNaoCorrer(base, json)
  if (motivos.length) throw new Error(`não corro aqui (só no SignalK do dev):\n  - ${motivos.join('\n  - ')}`)

  // Ctrl-C a meio: termina o plano, desativa a rota e repõe a hora
  let ativado = false
  let aLimpar = false
  const sair = async (codigo) => {
    if (aLimpar) return
    aLimpar = true
    if (ativado) await limpar({ base, json, enviar, log: (x) => log(tAtual, x) })
    if (ws) { ws.onclose = null; ws.close() }
    process.exit(codigo)
  }
  arrumar = sair
  process.on('SIGINT', () => { log(tAtual, 'Ctrl-C: termino o plano, desativo a rota e reponho a hora'); sair(130) })

  ligar()
  while (!ligado) await new Promise(resolve => setTimeout(resolve, 200))

  // 1. no cais de partida, agora
  const destinos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'signalk-arlequin-rota', 'dados', 'destinos.json'), 'utf8'))
  const de = destinos.find(d => d.id === arg('de', 'alges'))
  if (!de) throw new Error(`destino desconhecido: ${arg('de', 'alges')}`)
  const [lat0, lon0] = de.aproximacao.at(-1)
  const gasoleo0 = num('gasoleo', 70)
  const soc = num('soc', 0.85)
  let t = Date.now()
  tAtual = t
  const estadoBase = (tt, p, extra = []) => [
    { path: 'navigation.position', value: { latitude: p.lat, longitude: p.lon } },
    { path: 'navigation.speedOverGround', value: p.sogNos * NO },
    { path: 'navigation.courseOverGroundTrue', value: p.cog },
    { path: 'navigation.headingTrue', value: p.cog },
    { path: 'navigation.datetime', value: new Date(tt).toISOString() },
    { path: 'electrical.batteries.servico.capacity.stateOfCharge', value: soc },
    ...extra
  ]
  enviar(t, estadoBase(t, { lat: lat0, lon: lon0, sogNos: 0, cog: 0 }, [{ path: 'tanks.fuel.0.currentVolume', value: gasoleo0 / 1000 }, { path: 'environment.outside.pressure', value: num('pressao', 1015) * 100 }]))
  await new Promise(resolve => setTimeout(resolve, 1500))
  log(t, `no cais de ${de.nome} (${lat0}, ${lon0}), ${gasoleo0} L, SoC ${soc * 100}%`)

  // 2. calcular, enviar o plano, ativar
  const pedido = { destino: arg('para', 'peniche'), tripulacao: arg('tripulacao', 'so'), sairAgora: true }
  const c = await json(`${rota}/calcular`, { method: 'POST', body: JSON.stringify(pedido) })
  if (c.status !== 202) throw new Error(`/calcular respondeu ${c.status}: ${JSON.stringify(c.corpo)}`)
  let r
  for (;;) {
    r = await json(`${rota}/resultado/${c.corpo.id}`)
    if (r.corpo.estado !== 'a calcular') break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (r.corpo.estado !== 'pronto') throw new Error(`o cálculo falhou: ${r.corpo.erro}`)
  const res = r.corpo.resultado
  if (!res.alternativas.length) throw new Error(`nenhuma alternativa: ${res.veredicto.texto}`)
  const alt = res.alternativas[0]
  log(t, `calculado: ${res.veredicto.texto} · 1.ª: ${alt.nome}, partida ${alt.partida}, chegada ${alt.chegada.p50} (p90 ${alt.chegada.p90}), ${alt.milhas} MN, eventos: ${alt.eventos.map(e => `${e.hora} ${e.texto}`).join(' | ')}`)
  const pt = await json(`${rota}/plano-telegram`, { method: 'POST', body: JSON.stringify({ id: c.corpo.id, alternativa: 0 }) })
  if (pt.status !== 202) throw new Error(`/plano-telegram respondeu ${pt.status}: ${JSON.stringify(pt.corpo)}`)
  let ep
  for (let i = 0; i < 40; i++) {
    ep = await json(`${rota}/plano-telegram/${pt.corpo.pedido}`)
    if (ep.corpo.estado !== 'a enviar') break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  log(t, `plano enviado: ${ep.corpo.estado} · entregues ${JSON.stringify(ep.corpo.entregues)} · contactos em terra ${JSON.stringify(ep.corpo.contactos)}`)
  const at = await json(`${rota}/ativar`, { method: 'POST', body: JSON.stringify({ id: c.corpo.id, alternativa: 0 }) })
  if (at.status !== 200) throw new Error(`/ativar respondeu ${at.status}: ${JSON.stringify(at.corpo)}`)
  ativado = true
  log(t, `ativada: ${at.corpo.href} · plano ativo ${at.corpo.planoAtivo?.estado}`)

  // 3. a viagem
  const rasto = alt.rasto
  const t0 = Date.parse(rasto[0].t)
  const duracaoMs = Date.parse(rasto.at(-1).t) - t0
  const cenario = criarCenario({
    t0, duracaoMs, atrasoEm: num('atraso-em', 0.3), atrasoMin: num('atraso-min', 60), baroEm: num('baro-em', 0.5),
    baroQueda: num('baro-queda', 4), baroHoras: num('baro-horas', 2), pressao: num('pressao', 1015), gasoleo: gasoleo0, consumo: num('consumo', 2.5)
  })
  t = Math.max(t, t0)
  let ultimoResumo = 0
  let paradoAntes = false
  let fimEm = null
  for (;;) {
    const emPausa = pausa && fs.existsSync(pausa)
    const e = cenario(t)
    const p = posicaoNoRasto(rasto, e.tPlano)
    const pos = e.parado ? { ...p, sogNos: 0 } : p
    tAtual = t
    const ok = enviar(t, estadoBase(t, pos, [
      { path: 'environment.outside.pressure', value: e.pressaoHpa * 100 },
      { path: 'tanks.fuel.0.currentVolume', value: e.gasoleoL / 1000 }
    ]))
    if (e.parado !== paradoAntes) { log(t, e.parado ? `ATRASO FORÇADO: parado ${num('atraso-min', 60)} min` : 'a andar outra vez'); paradoAntes = e.parado }
    if (ok && t - ultimoResumo >= 30 * MIN) {
      ultimoResumo = t
      const g = await json(`${rota}/plano-ativo`).catch(() => null)
      const x = g?.corpo || {}
      log(t, `plano ${x.estado} · atraso ${x.atrasoMin ?? '—'} min · próximo ${x.proximo ? `${x.proximo.texto} ${x.proximo.hora}` : '—'} · chegada ${x.chegadaAgora ?? '—'} (plano ${x.chegadaPlano ?? '—'}) · gasóleo ${e.gasoleoL.toFixed(1)} L (à chegada ${x.recursos?.gasoleoChegadaL ?? '—'}) · ${e.pressaoHpa.toFixed(1)} hPa · fila ${(x.filaContactos || []).map(m => m.tipo).join(',') || '—'} · enviadas ${(x.enviadas || []).map(m => m.tipo).join(',') || '—'}`)
      if (x.estado === 'chegado' && fimEm == null) fimEm = t
    }
    if (p.fim && fimEm == null) {
      const g = await json(`${rota}/plano-ativo`).catch(() => null)
      if (g?.corpo?.estado === 'chegado') { fimEm = t; log(t, `CHEGOU (${g.corpo.chegou})`) }
    }
    if (fimEm != null && t - fimEm >= 10 * MIN) break
    if (p.fim && t - (t0 + duracaoMs + num('atraso-min', 60) * MIN) > 3 * H) { log(t, 'não chegou 3 h depois do fim do rasto: paro'); break }
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (ok && !emPausa) t += fator * 1000
  }

  // 4. o que o Telegram falso recebeu
  const tg = await json(`${telegram}/_enviados`).catch(() => null)
  if (Array.isArray(tg?.corpo)) {
    for (const m of tg.corpo) console.log(`TELEGRAM ${m.chatId} ${m.metodo}: ${(m.text ?? m.nomeFicheiro ?? '').replace(/\n/g, ' ⏎ ').slice(0, 300)}`)
  }
  ws.onclose = null
  ws.close()
  process.removeAllListeners('SIGINT')
  arrumar = null
}

// o arrumar da viagem em curso (Ctrl-C ou um erro a meio)
let arrumar = null

if (require.main === module) {
  main().catch(async e => {
    console.error(e.message)
    // um erro a meio da viagem: arruma como no Ctrl-C
    if (arrumar) await arrumar(1)
    process.exit(1)
  })
}

module.exports = { posicaoNoRasto, criarCenario, verificarDev, limpar, FALSOS, FONTE, deltaViagem }
