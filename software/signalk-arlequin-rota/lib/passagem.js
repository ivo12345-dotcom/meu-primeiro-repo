'use strict'
// O motor da simulação de uma passagem, extraído de ferramentas/passagem/simular.mjs.
// Função pura: tudo o que vem de fora (tempo, maré, velocidade à vela, gasóleo,
// noite, energia, costa) entra como função. Passos de 1 min.
//
// Mantém-se do simular.mjs: popa até 155° com cambadelas num corredor de ±0,7 MN
// à volta da perna, bordos contra o vento (< 45°), rizos pelos limiares da
// simulação, motor abaixo de 7 nós de vento ou de 3 nós à vela, chuva e
// visibilidade, passagem da frente, noite pelo nascer e pôr do sol.
//
// rota: [{ lat, lon, nome?, perna?, costaLivre? }] (lib/rotas.js). `perna` é o troço
// que chega ao ponto: 'porto' vai sempre a motor (a stwMotorRio); 'aproximacao' vai
// a motor com opcoes.motorNasAproximacoes. costaLivre: fora do mínimo à costa.
//
// Entradas (todas funções, para os cenários trocarem o que quiserem):
//   tempo(lat, lon, t) → { tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir, prevTwd? }
//     (tws/rajada/twd são o vento que decide: o corrigido do cenário; `w` inteiro vai para a velocidade;
//     prevTwd é a direção prevista EM BRUTO, quando o cenário corrige a direção — sem ela, a twd)
//   correnteExtra(lat, lon, t) → { v, dir }   (a maré na barra do Tejo, lib/mare.js)
//   velocidadeVela({ twa, twaPrevAbs, tws, twd, rizos, w, t, lat, lon, rumo }) → STW em nós
//     (antes do fator do leme, do mar e dos rizos, que o motor aplica). twa: ângulo ao vento que
//     decide (para a polar); twaPrevAbs: |TWD previsto em bruto − rumo| (0–180), o do modelo da
//     velocidade da AI (signalk-arlequin-ia/lib/modelos.js: só o que se sabe antes de partir)
//   consumo({ rpm, w, t }) → L/h
//   noite(t) → bool
//   energia: { inicio(t) → estado, passo(estado, { t, dtMs, motor, noite, sog, w }) → { estado, soc, eventos? } }
//   distanciaCosta({ lat, lon }) → MN (opcional)

const GRAU = Math.PI / 180
const MIN = 60000
const H = 3600000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d } // graus
const virgula = (x, d = 1) => x.toFixed(d).replace('.', ',')
const rumo3 = (x) => String(Math.round(x)).padStart(3, '0')

const PADRAO = Object.freeze({
  rpmCruzeiro: 2100,
  stwMotor: 4.3, // nós, × fator de mar
  stwMotorRio: 4.8, // dentro dos portos e do rio
  fatorLeme: 0.85, // leme à mão, sozinho
  fatorMarVela: true, // também à vela o mar tira velocidade (0,8–1)
  fatoresRizos: [1, 0.95, 0.9],
  corredor: 0.7, // MN para cada lado da perna, nos bordos e nas cambadelas
  bolinaMin: 45, // graus: abaixo disto bordeja
  popaMax: 155, // graus: acima disto cambeia (sem piloto)
  anguloPopa: 25, // a popa faz-se a 180 ± 25
  limiarVentoMotor: 7, // nós
  stwMinVela: 3, // nós
  rizo1: { rajada: 20, tws: 16 },
  rizo2: { rajada: 27, tws: 22 },
  motorNasAproximacoes: true,
  chegadaWpMn: 0.15,
  chegadaPassagem: true, // também conta o ponto de rota ao passá-lo (não só a 0,15 MN)
  gasoleoInicial: 124,
  maxHoras: 30,
  fuso: 'Europe/Lisbon',
  textoPartida: null,
  nomeChegada: null
})

// Distância ao lado da perna (MN): + = à direita (EB) de quem vai para o WP.
function vetor (a, b) {
  const dx = (b.lon - a.lon) * 60 * Math.cos(a.lat * GRAU)
  const dy = (b.lat - a.lat) * 60
  return { mn: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy) / GRAU) }
}
function xte (a, b, p) {
  const perna = vetor(a, b)
  const desde = vetor(a, p)
  return desde.mn * Math.sin((desde.rumo - perna.rumo) * GRAU)
}
// Já passou o ponto b da perna a→b (a projeção ao longo da perna vai além dele).
function passou (a, b, p) {
  const perna = vetor(a, b)
  const desde = vetor(a, p)
  return desde.mn * Math.cos((desde.rumo - perna.rumo) * GRAU) >= perna.mn
}

// noite(t) pelo nascer e pôr do sol de cada dia (listas em ms, pela mesma ordem).
// Fora dos dias dados usa o dia mais perto, deslocado de 24 em 24 h.
function noitePeloSol (nasceres, pores) {
  const dias = nasceres.map((n, i) => [n, pores[i]]).filter(([n, p]) => Number.isFinite(n) && Number.isFinite(p)).sort((a, b) => a[0] - b[0])
  return function noite (t) {
    if (!dias.length) return false
    for (const [n, p] of dias) if (t >= n && t < p) return false
    let melhor = dias[0]
    for (const d of dias) if (Math.abs(t - (d[0] + d[1]) / 2) < Math.abs(t - (melhor[0] + melhor[1]) / 2)) melhor = d
    const k = Math.round((t - (melhor[0] + melhor[1]) / 2) / (24 * H))
    return !(t >= melhor[0] + k * 24 * H && t < melhor[1] + k * 24 * H)
  }
}

function simularPassagem ({ rota, partida, tempo, correnteExtra, velocidadeVela, consumo, noite, energia, distanciaCosta, opcoes = {} }) {
  const o = { ...PADRAO, ...opcoes }
  const fmtHora = new Intl.DateTimeFormat('pt-PT', { timeZone: o.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hm = (x) => fmtHora.format(x)
  const ROTA = rota
  let pos = { lat: ROTA[0].lat, lon: ROTA[0].lon }
  let wp = 1
  let t = partida
  let proa = vetor(pos, ROTA[1]).rumo
  let amura = null // 'EB' | 'BB' quando bordeja ou cambeia
  let estadoEnergia = energia ? energia.inicio(t) : null
  let gasoleo = o.gasoleoInicial
  let milhas = 0
  const pontos = []
  const contaCosta = [] // o ponto conta para o mínimo à costa
  const eventos = []
  const ev = (texto, tipo = 'info') => eventos.push({ t, texto, tipo })
  let motorAntes = null
  let rizos = 0
  let viragens = 0
  let cambadelas = 0
  let horasLeme = 0
  let noiteAntes = null
  let visAnunciada = false
  let frenteAnunciada = false
  ev(o.textoPartida ?? `Partida de ${ROTA[0].nome ?? 'a posição atual'} (${hm(t)})`, 'partida')

  while (wp < ROTA.length && t < partida + o.maxHoras * H) {
    const w = tempo(pos.lat, pos.lon, t)
    const alvo = vetor(pos, ROTA[wp])
    const perna = ROTA[wp].perna
    const noPorto = perna === 'porto'
    const eNoite = noite ? !!noite(t) : false
    // Vela ou motor
    const twaWp = dif(w.twd, alvo.rumo) // + = vento por EB
    let motor = noPorto || (o.motorNasAproximacoes && perna === 'aproximacao') || w.tws < o.limiarVentoMotor
    let rumoAlvo = alvo.rumo
    let stw
    const fatorMar = Math.max(0.8, 1 - 0.04 * Math.max(0, (w.ondas ?? 0) - 1))
    if (!motor) {
      const aTwa = Math.abs(twaWp)
      // Bordejar (< 45°) ou cambar em popa (> 155°, sem piloto): o timoneiro
      // mantém-se num corredor de ±0,7 MN à volta da perna e muda de bordo nos limites.
      const lado = xte(ROTA[wp - 1], ROTA[wp], pos)
      const escolher = (eb, bb, mudou) => {
        if (!amura) amura = Math.abs(dif(alvo.rumo, eb)) < Math.abs(dif(alvo.rumo, bb)) ? 'EB' : 'BB'
        const rumo = amura === 'EB' ? eb : bb
        const para = dif(rumo, alvo.rumo) // + = este bordo afasta para a direita da perna
        if ((para > 0 && lado > o.corredor) || (para < 0 && lado < -o.corredor)) { amura = amura === 'EB' ? 'BB' : 'EB'; mudou() }
        return amura === 'EB' ? eb : bb
      }
      if (aTwa < o.bolinaMin) {
        rumoAlvo = escolher(norm(w.twd - o.bolinaMin), norm(w.twd + o.bolinaMin), () => viragens++)
      } else if (aTwa > o.popaMax) {
        rumoAlvo = escolher(norm(w.twd + 180 + o.anguloPopa), norm(w.twd + 180 - o.anguloPopa), () => cambadelas++)
      } else {
        amura = null
      }
      const twa = dif(w.twd, rumoAlvo)
      const rizosAgora = w.rajada > o.rizo2.rajada || w.tws > o.rizo2.tws ? 2 : (w.rajada > o.rizo1.rajada || w.tws > o.rizo1.tws ? 1 : 0)
      if (rizosAgora !== rizos) { ev(`${rizosAgora > rizos ? 'Rizar' : 'Largar rizo'}: ${rizosAgora} rizo${rizosAgora === 1 ? '' : 's'} (vento ${Math.round(w.tws)} nós, rajadas ${Math.round(w.rajada)})`, 'vela'); rizos = rizosAgora }
      const twaPrevAbs = Math.abs(dif(w.prevTwd ?? w.twd, rumoAlvo))
      stw = velocidadeVela({ twa, twaPrevAbs, tws: w.tws, twd: w.twd, rizos, w, t, lat: pos.lat, lon: pos.lon, rumo: rumoAlvo }) * o.fatorLeme * (o.fatorMarVela ? fatorMar : 1)
      stw *= o.fatoresRizos[rizos]
      if (stw < o.stwMinVela) motor = true
    }
    if (motor) { rumoAlvo = alvo.rumo; stw = (noPorto ? o.stwMotorRio : o.stwMotor) * fatorMar; amura = null }
    if (motor !== motorAntes) {
      if (motorAntes !== null) {
        const porque = noPorto ? 'dentro do porto' : perna === 'aproximacao' && o.motorNasAproximacoes ? 'aproximação' : `vento ${Math.round(w.tws)} nós: sem vento para andar`
        ev(motor ? `Motor ligado (${porque})` : `Motor desligado, à vela (vento ${Math.round(w.tws)} nós de ${rumo3(w.twd)}°)`, 'motor')
      }
      motorAntes = motor
    }
    proa = rumoAlvo
    // Corrente: oceânica (previsão) + maré no Tejo
    const mare = correnteExtra ? correnteExtra(pos.lat, pos.lon, t) : { v: 0, dir: 0 }
    const cx = (w.corrente ?? 0) * Math.sin((w.correnteDir ?? 0) * GRAU) + mare.v * Math.sin(mare.dir * GRAU)
    const cy = (w.corrente ?? 0) * Math.cos((w.correnteDir ?? 0) * GRAU) + mare.v * Math.cos(mare.dir * GRAU)
    const vx = stw * Math.sin(proa * GRAU) + cx
    const vy = stw * Math.cos(proa * GRAU) + cy
    const sog = Math.hypot(vx, vy)
    const cog = norm(Math.atan2(vx, vy) / GRAU)
    // Avança 1 min
    const passoMn = sog / 60
    pos = { lat: pos.lat + vy / 60 / 60, lon: pos.lon + vx / 60 / 60 / Math.cos(pos.lat * GRAU) }
    milhas += passoMn
    if (motor) gasoleo -= consumo({ rpm: o.rpmCruzeiro, w, t }) / 60
    else horasLeme += 1 / 60
    let soc = null
    if (energia) {
      const e = energia.passo(estadoEnergia, { t, dtMs: MIN, motor, noite: eNoite, sog, w })
      estadoEnergia = e.estado
      soc = e.soc
      for (const x of e.eventos || []) ev(x.texto, x.tipo || 'alarme')
    }
    // Marcos
    if (noiteAntes === null) { if (eNoite) ev(`Partida de noite (${hm(t)}): ecrã em modo noite, luzes de navegação`, 'noite') } else if (eNoite && !noiteAntes) ev(`Pôr do sol (${hm(t)}): ecrã em modo noite, luzes de navegação`, 'noite')
    else if (!eNoite && noiteAntes) ev(`Nascer do sol (${hm(t)}): ecrã em modo dia`, 'noite')
    noiteAntes = eNoite
    if (!visAnunciada && w.visibilidade != null && w.visibilidade < 3000) { visAnunciada = true; ev(`Chuva e visibilidade ${virgula(w.visibilidade / 1000)} km: radar ligado`, 'tempo') }
    if (!frenteAnunciada && pontos.length && pontos[pontos.length - 1].tws > 12 && w.tws < 8) { frenteAnunciada = true; ev(`Passagem da frente: o vento cai de ${Math.round(pontos[pontos.length - 1].tws)} para ${Math.round(w.tws)} nós e roda para ${rumo3(w.twd)}°. Fica o mar (${virgula(w.ondas ?? 0)} m)`, 'tempo') }
    const costa = distanciaCosta ? distanciaCosta(pos) : null
    pontos.push({ t, costa, lat: pos.lat, lon: pos.lon, proa, cog, sog, stw, tws: w.tws, rajada: w.rajada, twd: w.twd, ondas: w.ondas, chuva: w.chuva, vis: w.visibilidade, motor, soc, gasoleo, rizos, noite: eNoite, wp: ROTA[wp].nome ?? null, mare: mare.v })
    contaCosta.push(!ROTA[wp].costaLivre)
    const chegouWp = vetor(pos, ROTA[wp]).mn < o.chegadaWpMn || (o.chegadaPassagem && wp < ROTA.length - 1 && passou(ROTA[wp - 1], ROTA[wp], pos))
    if (chegouWp) { if (ROTA[wp].nome) ev(`${ROTA[wp].nome}: ${virgula(milhas)} MN feitas`, 'wp'); wp++ }
    t += MIN
  }
  const chegou = wp >= ROTA.length
  ev(chegou ? `Chegada a ${o.nomeChegada ?? ROTA[ROTA.length - 1].nome ?? 'destino'} (${hm(t)})` : `Não chegou dentro de ${o.maxHoras} h`, 'chegada')
  const duracaoH = (t - partida) / H
  const ultimo = pontos[pontos.length - 1]
  const resumo = {
    partida: new Date(partida).toISOString(),
    chegada: new Date(t).toISOString(),
    chegou,
    duracaoH,
    milhas,
    horasVela: pontos.filter(p => !p.motor).length / 60,
    horasMotor: pontos.filter(p => p.motor).length / 60,
    horasNoite: pontos.filter(p => p.noite).length / 60,
    gasoleoGasto: o.gasoleoInicial - gasoleo,
    socFinal: energia && ultimo ? ultimo.soc : null,
    socMin: energia && ultimo ? pontos.reduce((m, p) => Math.min(m, p.soc), Infinity) : null,
    ventoMax: pontos.reduce((m, p) => Math.max(m, p.tws), -Infinity),
    rajadaMax: pontos.reduce((m, p) => Math.max(m, p.rajada), -Infinity),
    ondasMax: pontos.reduce((m, p) => Math.max(m, p.ondas ?? -Infinity), -Infinity),
    viragens,
    cambadelas,
    horasLemeSeguidas: horasLeme,
    // Fora das aproximações (costaLivre), que são perto de terra de propósito.
    costaMinMn: distanciaCosta ? pontos.reduce((m, p, i) => (contaCosta[i] ? Math.min(m, p.costa) : m), Infinity) : null
  }
  return { pontos, eventos, resumo }
}

module.exports = { PADRAO, simularPassagem, noitePeloSol, vetor, xte }
