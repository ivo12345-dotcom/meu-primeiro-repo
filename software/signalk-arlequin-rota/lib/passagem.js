'use strict'
// O motor da simulação de uma passagem, extraído de ferramentas/passagem/simular.mjs.
// Função pura: tudo o que vem de fora (tempo, maré, velocidade à vela, gasóleo,
// noite, energia, costa) entra como função. Passos de 1 min.
//
// Mantém-se do simular.mjs: popa até 155° com cambadelas num corredor de ±0,7 MN
// à volta da perna, bordos contra o vento (< 45°), rizos pelos limiares da
// simulação, motor abaixo de 7 nós de vento ou de 3 nós à vela, chuva e
// visibilidade, passagem da frente, noite pelo nascer e pôr do sol. A visibilidade é a
// de lib/avisos.js (< 5 km, VISIBILIDADE_RADAR_M), com um evento por episódio (auditoria I-17).
//
// rota: [{ lat, lon, nome?, perna?, costaLivre? }] (lib/rotas.js). `perna` é o troço
// que chega ao ponto: 'porto' vai sempre a motor (a stwMotorRio); 'aproximacao' vai
// a motor com opcoes.motorNasAproximacoes. costaLivre: fora do mínimo à costa.
//
// Entradas (todas funções, para os cenários trocarem o que quiserem):
//   tempo(lat, lon, t) → { tws, rajada, twd, chuva, visibilidade, radiacao, ondas, periodo, ondasDir, corrente, correnteDir, prevTwd?, corrigido?, semDados?, aproximado? }
//     (tws/rajada/twd são o vento que decide: o corrigido do cenário; `w` inteiro vai para a velocidade
//     e para o consumo; prevTwd é a direção prevista EM BRUTO, quando o cenário corrige a direção.
//     Sem prevTwd, cai-se na twd — mas só quando o cenário não se declara corrigido, isto é,
//     w.corrigido !== true; um cenário que corrige a direção (w.corrigido === true) e omite
//     prevTwd é um erro interno do cenário, não um valor a assumir: ver prevTwdDe)
//   correnteExtra(lat, lon, t) → { v, dir }   (a maré na barra do Tejo, lib/mare.js)
//   velocidadeVela({ twa, twaPrevAbs, tws, twd, rizos, w, t, lat, lon, rumo }) → STW em nós
//     (antes do fator do leme, do mar e dos rizos, que o motor aplica). twa: ângulo ao vento que
//     decide (para a polar); twaPrevAbs: |TWD previsto em bruto − rumo| (0–180), o do modelo da
//     velocidade da AI (signalk-arlequin-ia/lib/modelos.js: só o que se sabe antes de partir)
//   consumo({ rpm, w, t, lat, lon, rumo }) → L/h
//     (lat/lon/rumo tal como velocidadeVela recebe, para o modelo do consumo poder calcular
//     ondasAnguloRel = |direção das ondas previstas (w.ondasDir) − rumo| (0–180) e usar prevOndas/w)
//   noite(t) → bool
//   energia: { inicio(t) → estado, passo(estado, { t, dtMs, motor, noite, sog, w }) → { estado, soc, eventos? } }
//   distanciaCosta({ lat, lon }) → MN (opcional)

const { VISIBILIDADE_RADAR_M, CHUVA_RADAR_MM_H } = require('./avisos')
const { HORAS_PREVISAO } = require('./previsao')
const { sitio } = require('./costa')

const GRAU = Math.PI / 180
const MIN = 60000
const H = 3600000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d } // graus
const virgula = (x, d = 1) => x.toFixed(d).replace('.', ',')
const rumo3 = (x) => String(Math.round(x)).padStart(3, '0')
// Ondas sem previsão (w.ondas null, semDados): desconhecido não é mar chão. Assume-se o pior caso
// ainda plausível, o limite de ondas do armador (lib/seguranca.js: ondasMax = 3 m) — nunca 0, que
// daria o fatorMar mais otimista possível. A alternativa já fica excluída ou com aviso vermelho
// pelo semDados (lib/seguranca.js); isto só evita que os números mostrados (duração, gasóleo,
// horas de leme) pareçam melhores do que são por assumirem mar chão em silêncio.
const ONDAS_DESCONHECIDAS_M = 3

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
  maxHoras: HORAS_PREVISAO, // o fim da previsão (48 h; auditoria I-19: eram 30 h, ~120 MN a motor)
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

// A direção prevista EM BRUTO para o twaPrevAbs: prevTwd quando o cenário a dá; senão a twd, mas
// só quando o cenário não se declara corrigido (w.corrigido !== true). Um cenário que corrige a
// direção e omite prevTwd é um erro interno — cair para a twd corrigida duplicava a correção em
// silêncio no modelo da velocidade (AI).
function prevTwdDe (w) {
  if (w.prevTwd != null) return w.prevTwd
  if (w.corrigido === true) throw new Error('tempo(): w.corrigido é true mas falta w.prevTwd (o previsto em bruto é obrigatório quando o cenário corrige a direção)')
  return w.twd
}

// Os campos da previsão sem dados ou aproximados (lib/previsao.js) do ponto, só quando os há.
function previsaoIncompleta (w) {
  const out = {}
  if (Array.isArray(w.semDados) && w.semDados.length) out.semDados = w.semDados
  if (Array.isArray(w.aproximado) && w.aproximado.length) out.aproximado = w.aproximado
  return out
}

// O máximo de um campo dos pontos, sem os que não são número (sem previsão). Nenhum: -Infinity,
// como antes (pontos todos sem dado ou nenhum ponto).
const maxFinito = (pontos, k) => pontos.reduce((m, p) => (Number.isFinite(p[k]) ? Math.max(m, p[k]) : m), -Infinity)

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
  let visBaixa = false // num episódio de visibilidade abaixo dos 5 km (um evento por episódio)
  let frenteAnunciada = false
  // "Partida da posição atual", "Chegada à Nazaré" (auditoria M-19; era "Partida de a posição atual")
  ev(o.textoPartida ?? `Partida ${sitio.de(ROTA[0].nome ?? 'Posição atual')} (${hm(t)})`, 'partida')

  while (wp < ROTA.length && t < partida + o.maxHoras * H) {
    const w = tempo(pos.lat, pos.lon, t)
    const alvo = vetor(pos, ROTA[wp])
    const perna = ROTA[wp].perna
    const noPorto = perna === 'porto'
    const eNoite = noite ? !!noite(t) : false
    // Vela ou motor. Vento sem previsão (tws ou twd null: lib/cenarios.js nunca o põe a 0) é
    // desconhecido: a escolha conservadora e simples é o motor, sem mexer nos rizos (só se decidem
    // à vela), e o desconhecido nunca entra em contas (nada de NaN nem de "0 nós").
    const semVento = !Number.isFinite(w.tws) || !Number.isFinite(w.twd)
    const twaWp = semVento ? 0 : dif(w.twd, alvo.rumo) // + = vento por EB
    let motor = noPorto || (o.motorNasAproximacoes && perna === 'aproximacao') || semVento || w.tws < o.limiarVentoMotor
    let rumoAlvo = alvo.rumo
    let stw
    const fatorMar = Math.max(0.8, 1 - 0.04 * Math.max(0, (Number.isFinite(w.ondas) ? w.ondas : ONDAS_DESCONHECIDAS_M) - 1))
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
      if (rizosAgora !== rizos) { ev(`${rizosAgora > rizos ? 'Rizar' : 'Largar rizo'}: ${rizosAgora} rizo${rizosAgora === 1 ? '' : 's'} (vento ${Math.round(w.tws)} nós, rajadas ${Number.isFinite(w.rajada) ? Math.round(w.rajada) : 'sem previsão'})`, 'vela'); rizos = rizosAgora }
      const twaPrevAbs = Math.abs(dif(prevTwdDe(w), rumoAlvo))
      stw = velocidadeVela({ twa, twaPrevAbs, tws: w.tws, twd: w.twd, rizos, w, t, lat: pos.lat, lon: pos.lon, rumo: rumoAlvo }) * o.fatorLeme * (o.fatorMarVela ? fatorMar : 1)
      stw *= o.fatoresRizos[rizos]
      if (stw < o.stwMinVela) motor = true
    }
    if (motor) { rumoAlvo = alvo.rumo; stw = (noPorto ? o.stwMotorRio : o.stwMotor) * fatorMar; amura = null }
    if (motor !== motorAntes) {
      if (motorAntes !== null) {
        const porque = noPorto ? 'dentro do porto' : perna === 'aproximacao' && o.motorNasAproximacoes ? 'aproximação' : semVento ? 'sem previsão de vento' : `vento ${Math.round(w.tws)} nós: sem vento para andar`
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
    if (motor) gasoleo -= consumo({ rpm: o.rpmCruzeiro, w, t, lat: pos.lat, lon: pos.lon, rumo: rumoAlvo }) / 60
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
    // visibilidade abaixo dos 5 km (a constante de lib/avisos.js, decisão do Ivo n.º 10): um evento
    // por episódio (a visibilidade sem previsão acaba o episódio, como nos avisos), "Chuva e
    // visibilidade" só com chuva que conte para o radar, senão "Visibilidade"
    const visAgora = Number.isFinite(w.visibilidade) && w.visibilidade < VISIBILIDADE_RADAR_M
    if (visAgora && !visBaixa) ev(`${Number.isFinite(w.chuva) && w.chuva >= CHUVA_RADAR_MM_H ? 'Chuva e visibilidade' : 'Visibilidade'} ${virgula(w.visibilidade / 1000)} km: radar ligado`, 'tempo')
    visBaixa = visAgora
    if (!frenteAnunciada && !semVento && pontos.length && pontos[pontos.length - 1].tws > 12 && w.tws < 8) { frenteAnunciada = true; ev(`Passagem da frente: o vento cai de ${Math.round(pontos[pontos.length - 1].tws)} para ${Math.round(w.tws)} nós e roda para ${rumo3(w.twd)}°. Fica o mar (${Number.isFinite(w.ondas) ? `${virgula(w.ondas)} m` : 'sem previsão de ondas'})`, 'tempo') }
    const costa = distanciaCosta ? distanciaCosta(pos) : null
    // semDados/aproximado da previsão (lib/previsao.js), só quando os há: a segurança trata o
    // desconhecido como desconhecido (nunca calmo) e avisa do aproximado.
    // periodo: a par de ondas/tws, para a regra da calma (lib/seguranca.js, emCalma: o motor em
    // calma conta metade das horas ao leme; calma = vento < 10 nós e (ondas < 2 m, ou ondas ≤ 3 m
    // com período ≥ 9 s)). `motor` já serve de sinal motor/vela, não duplicado.
    pontos.push({ t, costa, lat: pos.lat, lon: pos.lon, proa, cog, sog, stw, tws: w.tws, rajada: w.rajada, twd: w.twd, ondas: w.ondas, periodo: w.periodo, chuva: w.chuva, vis: w.visibilidade, motor, soc, gasoleo, rizos, noite: eNoite, wp: ROTA[wp].nome ?? null, mare: mare.v, ...previsaoIncompleta(w) })
    contaCosta.push(!ROTA[wp].costaLivre)
    const chegouWp = vetor(pos, ROTA[wp]).mn < o.chegadaWpMn || (o.chegadaPassagem && wp < ROTA.length - 1 && passou(ROTA[wp - 1], ROTA[wp], pos))
    if (chegouWp) { if (ROTA[wp].nome) ev(`${ROTA[wp].nome}: ${virgula(milhas)} MN feitas`, 'wp'); wp++ }
    t += MIN
  }
  const chegou = wp >= ROTA.length
  ev(chegou ? `Chegada ${sitio.a(o.nomeChegada ?? ROTA[ROTA.length - 1].nome ?? 'destino')} (${hm(t)})` : `Não chegou dentro de ${String(Math.round(o.maxHoras * 10) / 10).replace('.', ',')} h`, 'chegada')
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
    // os máximos ignoram o sem previsão (null); a segurança marca-o pelo semDados
    ventoMax: maxFinito(pontos, 'tws'),
    rajadaMax: maxFinito(pontos, 'rajada'),
    ondasMax: maxFinito(pontos, 'ondas'),
    viragens,
    cambadelas,
    // Nome enganador (mantido: cherry-picks futuros dependem dele) — é o total de horas à vela,
    // não horas seguidas de leme. A regra das horas de leme equivalentes (motor em calma conta
    // metade) está em lib/seguranca.js (emCalma), calculada a partir de pontos[].motor/tws/ondas/periodo.
    horasLemeSeguidas: horasLeme,
    // Fora das aproximações (costaLivre), que são perto de terra de propósito.
    costaMinMn: distanciaCosta ? pontos.reduce((m, p, i) => (contaCosta[i] ? Math.min(m, p.costa) : m), Infinity) : null
  }
  return { pontos, eventos, resumo }
}

module.exports = { PADRAO, simularPassagem, noitePeloSol, vetor, xte }
