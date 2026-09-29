// Simulação de uma passagem do Arlequin com a meteorologia REAL (Open-Meteo):
// vento, rajadas, ondas, corrente, chuva/visibilidade, maré no Tejo (aprox.),
// polar do Arlequin, leme à mão (sem piloto), motor, energia e alarmes do sistema.
//   node simular.mjs [partida ISO local]  → passagem.json + resumo.json
// Tudo o que é estimativa está assinalado no resumo.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const sw = path.join(aqui, '..', '..')
const require = createRequire(import.meta.url)
const { lerPolar, velocidadeAlvo } = await import('file://' + path.join(sw, 'arlequin-ecra/public/lib/polar.js'))
const { criarModelo, avancar } = require(path.join(sw, 'arlequin-simulador/lib/modelo.js'))
const { novoEstado, avaliar } = require(path.join(sw, 'signalk-arlequin-energia/lib/regras.js'))
const { litrosHora } = require(path.join(sw, 'signalk-arlequin-j1939/lib/consumo.js'))

const NO = 1852 / 3600
const GRAU = Math.PI / 180
const MIN = 60000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d } // graus

// ---------- rota: Algés → Peniche por fora ----------
export const ROTA = [
  { nome: 'Algés (partida)', lat: 38.6955, lon: -9.2330 },
  { nome: 'Barra Norte', lat: 38.6680, lon: -9.3150 },
  { nome: 'Largo de Carcavelos', lat: 38.6630, lon: -9.3500 },
  { nome: 'Largo de Cascais', lat: 38.6700, lon: -9.4300 },
  { nome: 'Cabo Raso', lat: 38.7050, lon: -9.5200 },
  { nome: 'Cabo da Roca', lat: 38.7800, lon: -9.5450 },
  { nome: 'Ericeira', lat: 38.9700, lon: -9.4750 },
  { nome: 'Santa Cruz', lat: 39.1300, lon: -9.4350 },
  { nome: 'Peniche Sul', lat: 39.3300, lon: -9.3950 },
  { nome: 'Peniche (porto)', lat: 39.3530, lon: -9.3770 }
]

// Costa APROXIMADA (pontos conhecidos), só para verificar a distância a terra.
export const COSTA = [
  [38.707, -9.135], [38.692, -9.216], [38.675, -9.325], [38.679, -9.336], [38.686, -9.355], [38.694, -9.372],
  [38.703, -9.395], [38.692, -9.419], [38.692, -9.431], [38.696, -9.447], [38.709, -9.486],
  [38.780, -9.499], [38.840, -9.470], [38.920, -9.425], [38.963, -9.418], [39.060, -9.405],
  [39.133, -9.383], [39.200, -9.360], [39.270, -9.340], [39.340, -9.345], [39.360, -9.408]
].map(([lat, lon]) => ({ lat, lon }))

function distanciaCostaMn (p) {
  let min = Infinity
  for (let i = 1; i < COSTA.length; i++) {
    const a = COSTA[i - 1]; const b = COSTA[i]
    const k = Math.cos(p.lat * GRAU) * 60
    const ax = a.lon * k; const ay = a.lat * 60; const bx = b.lon * k; const by = b.lat * 60; const px = p.lon * k; const py = p.lat * 60
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    min = Math.min(min, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))))
  }
  return min
}

// Distância ao lado da perna (MN): + = à direita (EB) de quem vai para o WP.
function xte (a, b, p) {
  const perna = vetor(a, b)
  const desde = vetor(a, p)
  return desde.mn * Math.sin((desde.rumo - perna.rumo) * GRAU)
}

function vetor (a, b) {
  const dx = (b.lon - a.lon) * 60 * Math.cos(a.lat * GRAU)
  const dy = (b.lat - a.lat) * 60
  return { mn: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy) / GRAU) }
}

// ---------- meteorologia ----------
const PONTOS = [{ lat: 38.68, lon: -9.35 }, { lat: 38.78, lon: -9.55 }, { lat: 38.97, lon: -9.50 }, { lat: 39.30, lon: -9.45 }]
async function meteorologia () {
  const lat = PONTOS.map(p => p.lat).join(',')
  const lon = PONTOS.map(p => p.lon).join(',')
  const v = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility,cloud_cover&wind_speed_unit=kn&timezone=Europe%2FLisbon&forecast_days=2`)).json()
  const m = await (await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction&timezone=Europe%2FLisbon&forecast_days=2`)).json()
  const s = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=38.9&longitude=-9.45&daily=sunrise,sunset&timezone=Europe%2FLisbon&forecast_days=2')).json()
  return { v, m, s, obtida: new Date().toISOString() }
}

// Interpola no tempo (hora) e no espaço (latitude entre os 4 pontos).
function tempoAqui (met, lat, t) {
  const horas = met.v[0].hourly.time.map(x => new Date(x).getTime())
  let i = horas.findIndex(h => h > t) - 1
  if (i < 0) i = 0
  const f = Math.min(1, Math.max(0, (t - horas[i]) / 3600000))
  const lats = PONTOS.map(p => p.lat)
  let j = lats.findIndex(l => l > lat) - 1
  if (j < 0) j = 0
  if (j > 2) j = 2
  const g = Math.min(1, Math.max(0, (lat - lats[j]) / (lats[j + 1] - lats[j])))
  const lin = (arr, k) => arr[k] * (1 - f) + arr[Math.min(k + 1, arr.length - 1)] * f
  const ang = (a, b, w) => norm(a + dif(b, a) * w)
  const v = (key, pj) => lin(met.v[pj].hourly[key], i)
  const mm = (key, pj) => lin(met.m[pj].hourly[key], i)
  const mix = (fn, key) => fn(key, j) * (1 - g) + fn(key, j + 1) * g
  const dirA = ang(met.v[j].hourly.wind_direction_10m[i], met.v[j].hourly.wind_direction_10m[Math.min(i + 1, 47)], f)
  const dirB = ang(met.v[j + 1].hourly.wind_direction_10m[i], met.v[j + 1].hourly.wind_direction_10m[Math.min(i + 1, 47)], f)
  return {
    tws: mix(v, 'wind_speed_10m'), rajada: mix(v, 'wind_gusts_10m'), twd: ang(dirA, dirB, g),
    chuva: mix(v, 'precipitation'), visibilidade: mix(v, 'visibility'), nuvens: mix(v, 'cloud_cover'),
    ondas: mix(mm, 'wave_height'), periodo: mix(mm, 'wave_period'),
    corrente: mix(mm, 'ocean_current_velocity') / 3.6 / NO, // km/h → nós
    correnteDir: met.m[j].hourly.ocean_current_direction[i]
  }
}

// Maré no Tejo (APROXIMADA): Cascais preia-mar 16:37 (coef. 90). Estofo ~45 min
// depois; vazante positiva (sai a 250°), até ~1,8 nó na barra. Só a leste de 9°25'W.
const PREIA_MAR = new Date('2026-09-29T16:37:00').getTime()
function mareTejo (lat, lon, t) {
  if (lon < -9.42) return { v: 0, dir: 0 }
  const fase = 2 * Math.PI * (t - (PREIA_MAR + 45 * MIN)) / (12.42 * 3600000)
  const v = 1.8 * Math.sin(fase)
  return v >= 0 ? { v, dir: 250 } : { v: -v, dir: 70 }
}

// ---------- simulação ----------
async function simular (partida) {
  const met = await meteorologia()
  const polar = lerPolar(readFileSync(path.join(sw, 'arlequin-ecra/public/polar-arlequin.csv'), 'utf8'))
  const porDoSol = new Date(met.s.daily.sunset[0]).getTime()
  const nascer = new Date(met.s.daily.sunrise[1]).getTime()
  let pos = { lat: ROTA[0].lat, lon: ROTA[0].lon }
  let wp = 1
  let t = partida
  let proa = vetor(pos, ROTA[1]).rumo
  let amura = null // 'EB' | 'BB' quando bordeja ou cambeia
  let energia = criarModelo({ socInicial: 0.95, nascer: new Date(met.s.daily.sunrise[0]).getHours() + 0.5, por: new Date(porDoSol).getHours() + new Date(porDoSol).getMinutes() / 60, horasSolPico: 3.5 }, t)
  let alarmesEnergia = novoEstado()
  let gasoleo = 124
  let milhas = 0
  const pontos = []
  const eventos = []
  const ev = (texto, tipo = 'info') => eventos.push({ t, texto, tipo })
  let motorAntes = null
  let rizos = 0
  let viragens = 0
  let cambadelas = 0
  let horasLeme = 0
  let noiteAnunciada = false
  let visAnunciada = false
  let frenteAnunciada = false
  ev(`Partida de Algés a motor (${new Date(t).toTimeString().slice(0, 5)}). Maré: enchente fraca contra até ao estofo (~17:20)`, 'partida')

  while (wp < ROTA.length && t < partida + 30 * 3600000) {
    const w = tempoAqui(met, pos.lat, t)
    const alvo = vetor(pos, ROTA[wp])
    const noRio = wp <= 1
    const noite = t >= porDoSol && t < nascer
    // Vela ou motor
    const twaWp = dif(w.twd, alvo.rumo) // + = vento por EB
    let motor = noRio || w.tws < 7
    let rumoAlvo = alvo.rumo
    let stw
    const fatorLeme = 0.85 // leme à mão, sozinho
    const fatorMar = Math.max(0.8, 1 - 0.04 * Math.max(0, w.ondas - 1))
    if (!motor) {
      const aTwa = Math.abs(twaWp)
      // Bordejar (< 45°) ou cambar em popa (> 155°, sem piloto): o timoneiro
      // mantém-se num corredor de ±0,7 MN à volta da perna e muda de bordo nos limites.
      const perna = xte(ROTA[wp - 1], ROTA[wp], pos)
      const corredor = 0.7
      const escolher = (eb, bb, deQueLado) => {
        if (!amura) amura = Math.abs(dif(alvo.rumo, eb)) < Math.abs(dif(alvo.rumo, bb)) ? 'EB' : 'BB'
        const rumo = amura === 'EB' ? eb : bb
        const lado = dif(rumo, alvo.rumo) // + = este bordo afasta para a direita da perna
        if ((lado > 0 && perna > corredor) || (lado < 0 && perna < -corredor)) { amura = amura === 'EB' ? 'BB' : 'EB'; deQueLado() }
        return amura === 'EB' ? eb : bb
      }
      if (aTwa < 45) {
        rumoAlvo = escolher(norm(w.twd - 45), norm(w.twd + 45), () => viragens++)
      } else if (aTwa > 155) {
        rumoAlvo = escolher(norm(w.twd + 180 + 25), norm(w.twd + 180 - 25), () => cambadelas++)
      } else {
        amura = null
      }
      const twa = dif(w.twd, rumoAlvo)
      stw = velocidadeAlvo(polar, twa * GRAU, Math.min(w.tws, 20) * NO) / NO * fatorLeme * fatorMar
      const rizosAgora = w.rajada > 27 || w.tws > 22 ? 2 : (w.rajada > 20 || w.tws > 16 ? 1 : 0)
      if (rizosAgora !== rizos) { ev(`${rizosAgora > rizos ? 'Rizar' : 'Largar rizo'}: ${rizosAgora} rizo${rizosAgora === 1 ? '' : 's'} (vento ${Math.round(w.tws)} nós, rajadas ${Math.round(w.rajada)})`, 'vela'); rizos = rizosAgora }
      stw *= rizos === 2 ? 0.9 : rizos === 1 ? 0.95 : 1
      if (stw < 3) motor = true
    }
    if (motor) { rumoAlvo = alvo.rumo; stw = (noRio ? 4.8 : 4.3) * fatorMar; amura = null }
    if (motor !== motorAntes) {
      if (motorAntes !== null) ev(motor ? `Motor ligado (vento ${Math.round(w.tws)} nós: sem vento para andar)` : `Motor desligado, à vela (vento ${Math.round(w.tws)} nós de ${String(Math.round(w.twd)).padStart(3, '0')}°)`, 'motor')
      motorAntes = motor
    }
    proa = rumoAlvo
    // Corrente: oceânica (modelo) + maré no Tejo (aproximada)
    const mare = mareTejo(pos.lat, pos.lon, t)
    const cx = w.corrente * Math.sin(w.correnteDir * GRAU) + mare.v * Math.sin(mare.dir * GRAU)
    const cy = w.corrente * Math.cos(w.correnteDir * GRAU) + mare.v * Math.cos(mare.dir * GRAU)
    const vx = stw * Math.sin(proa * GRAU) + cx
    const vy = stw * Math.cos(proa * GRAU) + cy
    const sog = Math.hypot(vx, vy)
    const cog = norm(Math.atan2(vx, vy) / GRAU)
    // Avança 1 min
    const passoMn = sog / 60
    pos = { lat: pos.lat + vy / 60 / 60, lon: pos.lon + vx / 60 / 60 / Math.cos(pos.lat * GRAU) }
    milhas += passoMn
    if (motor) gasoleo -= litrosHora(2000) / 60
    else horasLeme += 1 / 60
    const e = avancar(energia, MIN, { navegar: true, motor, frigorifico: true })
    energia = e.modelo
    // Alarmes de energia (as regras do plugin do Arlequin)
    const a = avaliar(alarmesEnergia, { soc: e.leitura.soc, socEm: t, vMotor: e.leitura.vMotor, rpm: motor ? 33 : 0, sog: sog * NO, modo: noite ? 'night' : 'day' }, t)
    alarmesEnergia = a.estado
    for (const n of a.notificacoes) if (n.state !== 'normal') ev(`Alarme do sistema: ${n.message}${n.method.includes('sound') ? ' (com som)' : ''}`, 'alarme')
    // Marcos
    if (!noiteAnunciada && noite) { noiteAnunciada = true; ev(`Pôr do sol (${new Date(porDoSol).toTimeString().slice(0, 5)}): ecrã em modo noite, luzes de navegação`, 'noite') }
    if (!visAnunciada && w.visibilidade < 3000) { visAnunciada = true; ev(`Chuva e visibilidade ${(w.visibilidade / 1000).toFixed(1).replace('.', ',')} km: radar ligado`, 'tempo') }
    if (!frenteAnunciada && pontos.length && pontos[pontos.length - 1].tws > 12 && w.tws < 8) { frenteAnunciada = true; ev(`Passagem da frente: o vento cai de ${Math.round(pontos[pontos.length - 1].tws)} para ${Math.round(w.tws)} nós e roda para ${String(Math.round(w.twd)).padStart(3, '0')}°. Fica o mar (${w.ondas.toFixed(1).replace('.', ',')} m)`, 'tempo') }
    const costa = distanciaCostaMn(pos)
    pontos.push({ t, costa, lat: pos.lat, lon: pos.lon, proa, cog, sog, stw, tws: w.tws, rajada: w.rajada, twd: w.twd, ondas: w.ondas, chuva: w.chuva, vis: w.visibilidade, motor, soc: e.leitura.soc, gasoleo, rizos, noite, wp: ROTA[wp].nome, mare: mare.v })
    if (vetor(pos, ROTA[wp]).mn < 0.15) { ev(`${ROTA[wp].nome}: ${milhas.toFixed(1).replace('.', ',')} MN feitas`, 'wp'); wp++ }
    t += MIN
  }
  const chegou = wp >= ROTA.length
  ev(chegou ? `Chegada a Peniche (${new Date(t).toTimeString().slice(0, 5)})` : 'Não chegou dentro de 30 h', 'chegada')
  const duracaoH = (t - partida) / 3600000
  const resumo = {
    partida: new Date(partida).toISOString(), chegada: new Date(t).toISOString(), chegou, duracaoH, milhas,
    horasVela: pontos.filter(p => !p.motor).length / 60, horasMotor: pontos.filter(p => p.motor).length / 60,
    horasNoite: pontos.filter(p => p.noite).length / 60, gasoleoGasto: 124 - gasoleo,
    socFinal: pontos[pontos.length - 1].soc, socMin: Math.min(...pontos.map(p => p.soc)),
    ventoMax: Math.max(...pontos.map(p => p.tws)), rajadaMax: Math.max(...pontos.map(p => p.rajada)), ondasMax: Math.max(...pontos.map(p => p.ondas)),
    viragens, cambadelas, horasLemeSeguidas: horasLeme,
    // Fora do canal da Barra Norte e da entrada de Peniche, que são perto de terra de propósito.
    costaMinMn: Math.min(...pontos.filter(p => !['Barra Norte', 'Largo de Carcavelos', 'Peniche (porto)', 'Peniche Sul'].includes(p.wp)).map(p => p.costa)), eventos, meteoObtida: met.obtida, porDoSol, nascer
  }
  return { resumo, pontos }
}

const partida = process.argv[2] ? new Date(process.argv[2]).getTime() : Date.now() + 3600000
const r = await simular(partida)
writeFileSync(path.join(aqui, 'passagem.json'), JSON.stringify(r.pontos))
writeFileSync(path.join(aqui, 'resumo.json'), JSON.stringify(r.resumo, null, 2))
writeFileSync(path.join(aqui, 'rota.json'), JSON.stringify({ ROTA, COSTA }))
const f = (x, d = 1) => x.toFixed(d).replace('.', ',')
console.log(`Chegada: ${new Date(r.resumo.chegada).toLocaleString('pt-PT')} · ${f(r.resumo.duracaoH)} h · ${f(r.resumo.milhas)} MN · vela ${f(r.resumo.horasVela)} h · motor ${f(r.resumo.horasMotor)} h · noite ${f(r.resumo.horasNoite)} h`)
console.log(`Mínimo à costa (fora do rio e da chegada): ${f(r.resumo.costaMinMn)} MN`)
console.log(`Gasóleo ${f(r.resumo.gasoleoGasto)} L · SoC final ${Math.round(r.resumo.socFinal * 100)}% (mín ${Math.round(r.resumo.socMin * 100)}%) · vento máx ${Math.round(r.resumo.ventoMax)} nós, rajadas ${Math.round(r.resumo.rajadaMax)} · ondas ${f(r.resumo.ondasMax)} m · viragens ${r.resumo.viragens} · cambadelas ${r.resumo.cambadelas}`)
for (const e of r.resumo.eventos) console.log(new Date(e.t).toTimeString().slice(0, 5), e.tipo.padEnd(8), e.texto)
