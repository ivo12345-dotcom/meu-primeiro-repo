// Simulação de uma passagem do Arlequin com a meteorologia REAL (Open-Meteo):
// vento, rajadas, ondas, corrente, chuva/visibilidade, maré no Tejo (aprox.),
// polar do Arlequin, leme à mão (sem piloto), motor, energia e alarmes do sistema.
// O motor da simulação é o do plugin da rota (signalk-arlequin-rota/lib/passagem.js);
// aqui ficam a rota, a meteorologia deste caso, a energia do simulador e os alarmes.
//   node simular.mjs [partida ISO local] [--dia AAAA-MM-DD] [--meteo f.json[.gz]] [--guardar-meteo f.json[.gz]]
//     → passagem.json + resumo.json
//   --dia: previsão de um dia passado (arquivo da Open-Meteo, esse dia e o seguinte)
//   --meteo: corre com a meteorologia gravada (sem rede); --guardar-meteo: grava a que usou
// Tudo o que é estimativa está assinalado no resumo.

import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
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
const { simularPassagem } = require(path.join(sw, 'signalk-arlequin-rota/lib/passagem.js'))
const { criarMareTejo } = require(path.join(sw, 'signalk-arlequin-rota/lib/mare.js'))

// Argumentos: [partida] --dia AAAA-MM-DD --meteo f --guardar-meteo f
const PRINCIPAL = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
const ARGS = {}
for (let i = 2; PRINCIPAL && i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--dia') ARGS.dia = process.argv[++i]
  else if (a === '--meteo') ARGS.meteo = process.argv[++i]
  else if (a === '--guardar-meteo') ARGS.guardarMeteo = process.argv[++i]
  else ARGS.partida = a
}

const NO = 1852 / 3600
const GRAU = Math.PI / 180
const MIN = 60000
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d } // graus
const hora = (t) => new Date(t).toTimeString().slice(0, 5)

// ---------- rota: Algés → Peniche por fora ----------
export const ROTA = [
  // Rio: canal da barra norte. Depois de Cascais afasta-se para ~5 MN dos cabos
  // e da costa (pedido do Ivo: ir por fora, não junto à costa).
  { nome: 'Algés (partida)', lat: 38.6955, lon: -9.2330 },
  // perna 'porto': a motor no rio (4,8 nós); costaLivre: fora do mínimo à costa
  { nome: 'Barra Norte', lat: 38.6680, lon: -9.3150, perna: 'porto', costaLivre: true },
  { nome: 'Largo de Carcavelos', lat: 38.6630, lon: -9.3500, costaLivre: true },
  { nome: 'Largo de Cascais', lat: 38.6500, lon: -9.4500 },
  { nome: 'Largo do Cabo Raso', lat: 38.6900, lon: -9.6000 },
  { nome: 'Largo da Roca', lat: 38.7800, lon: -9.6200 },
  { nome: 'Largo da Ericeira', lat: 38.9650, lon: -9.5400 },
  { nome: 'Largo de Santa Cruz', lat: 39.1300, lon: -9.5000 },
  { nome: 'Largo de Peniche', lat: 39.2800, lon: -9.4500 },
  { nome: 'Peniche Sul', lat: 39.3300, lon: -9.3950, costaLivre: true },
  { nome: 'Peniche (porto)', lat: 39.3530, lon: -9.3770, costaLivre: true }
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

// ---------- meteorologia ----------
// Meteorologia ao largo, onde a rota passa (vento e ondas lá fora são maiores).
const PONTOS = [{ lat: 38.68, lon: -9.35 }, { lat: 38.78, lon: -9.62 }, { lat: 38.97, lon: -9.55 }, { lat: 39.30, lon: -9.47 }]
async function meteorologia () {
  if (ARGS.meteo) return lerJson(ARGS.meteo)
  const lat = PONTOS.map(p => p.lat).join(',')
  const lon = PONTOS.map(p => p.lon).join(',')
  // dias: os próximos 2, ou (--dia) esse dia e o seguinte, do arquivo de previsões da Open-Meteo
  const dias = ARGS.dia ? `start_date=${ARGS.dia}&end_date=${new Date(Date.parse(ARGS.dia) + 86400000).toISOString().slice(0, 10)}` : 'forecast_days=2'
  const v = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility,cloud_cover&wind_speed_unit=kn&timezone=Europe%2FLisbon&${dias}`)).json()
  const m = await (await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction&timezone=Europe%2FLisbon&${dias}`)).json()
  const s = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=38.9&longitude=-9.45&daily=sunrise,sunset&timezone=Europe%2FLisbon&${dias}`)).json()
  const met = { v, m, s, obtida: new Date().toISOString() }
  if (ARGS.guardarMeteo) escreverJson(ARGS.guardarMeteo, met)
  return met
}

function lerJson (f) {
  const b = readFileSync(f)
  return JSON.parse(f.endsWith('.gz') ? gunzipSync(b) : b)
}
function escreverJson (f, o) {
  const b = Buffer.from(JSON.stringify(o))
  writeFileSync(f, f.endsWith('.gz') ? gzipSync(b) : b)
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
const mareTejo = criarMareTejo([{ t: PREIA_MAR }])

// ---------- simulação ----------
// Energia: o modelo do simulador (bancos de 440 Ah, frigorífico) com os alarmes do plugin da energia.
function energiaSimulador (met, porDoSol) {
  return {
    inicio: (t) => ({ modelo: criarModelo({ socInicial: 0.95, nascer: new Date(met.s.daily.sunrise[0]).getHours() + 0.5, por: new Date(porDoSol).getHours() + new Date(porDoSol).getMinutes() / 60, horasSolPico: 3.5 }, t), alarmes: novoEstado() }),
    passo (estado, { t, dtMs, motor, noite, sog }) {
      const e = avancar(estado.modelo, dtMs, { navegar: true, motor, frigorifico: true })
      // Alarmes de energia (as regras do plugin do Arlequin)
      const a = avaliar(estado.alarmes, { soc: e.leitura.soc, socEm: t, vMotor: e.leitura.vMotor, rpm: motor ? 33 : 0, sog: sog * NO, modo: noite ? 'night' : 'day' }, t)
      const eventos = a.notificacoes.filter(n => n.state !== 'normal').map(n => ({ texto: `Alarme do sistema: ${n.message}${n.method.includes('sound') ? ' (com som)' : ''}`, tipo: 'alarme' }))
      return { estado: { modelo: e.modelo, alarmes: a.estado }, soc: e.leitura.soc, eventos }
    }
  }
}

export async function simular (partida, met) {
  met = met || await meteorologia()
  const polar = lerPolar(readFileSync(path.join(sw, 'arlequin-ecra/public/polar-arlequin.csv'), 'utf8'))
  const porDoSol = new Date(met.s.daily.sunset[0]).getTime()
  const nascer = new Date(met.s.daily.sunrise[1]).getTime()
  const r = simularPassagem({
    rota: ROTA,
    partida,
    tempo: (lat, lon, t) => tempoAqui(met, lat, t),
    correnteExtra: mareTejo,
    velocidadeVela: ({ twa, tws }) => velocidadeAlvo(polar, twa * GRAU, Math.min(tws, 20) * NO) / NO,
    consumo: ({ rpm }) => litrosHora(rpm),
    noite: (t) => t >= porDoSol && t < nascer,
    energia: energiaSimulador(met, porDoSol),
    distanciaCosta: distanciaCostaMn,
    opcoes: {
      rpmCruzeiro: 2000, // a simulação de 29/09 usava 2000 rpm (o plugin usa 2100 por omissão)
      motorNasAproximacoes: false, // só o rio (perna 'porto') vai a motor
      chegadaPassagem: false, // os pontos de rota só contam a 0,15 MN, como antes
      gasoleoInicial: 124,
      maxHoras: 30,
      textoPartida: `Partida de Algés a motor (${hora(partida)}). Maré: enchente fraca contra até ao estofo (~17:20)`,
      nomeChegada: 'Peniche'
    }
  })
  const resumo = { ...r.resumo, eventos: r.eventos, meteoObtida: met.obtida, porDoSol, nascer }
  return { resumo, pontos: r.pontos }
}

async function principal () {
  const partida = ARGS.partida ? new Date(ARGS.partida).getTime() : Date.now() + 3600000
  const r = await simular(partida)
  writeFileSync(path.join(aqui, 'passagem.json'), JSON.stringify(r.pontos))
  writeFileSync(path.join(aqui, 'resumo.json'), JSON.stringify(r.resumo, null, 2))
  writeFileSync(path.join(aqui, 'rota.json'), JSON.stringify({ ROTA, COSTA }))
  const f = (x, d = 1) => x.toFixed(d).replace('.', ',')
  console.log(`Chegada: ${new Date(r.resumo.chegada).toLocaleString('pt-PT')} · ${f(r.resumo.duracaoH)} h · ${f(r.resumo.milhas)} MN · vela ${f(r.resumo.horasVela)} h · motor ${f(r.resumo.horasMotor)} h · noite ${f(r.resumo.horasNoite)} h`)
  console.log(`Mínimo à costa (fora do rio e da chegada): ${f(r.resumo.costaMinMn)} MN`)
  console.log(`Gasóleo ${f(r.resumo.gasoleoGasto)} L · SoC final ${Math.round(r.resumo.socFinal * 100)}% (mín ${Math.round(r.resumo.socMin * 100)}%) · vento máx ${Math.round(r.resumo.ventoMax)} nós, rajadas ${Math.round(r.resumo.rajadaMax)} · ondas ${f(r.resumo.ondasMax)} m · viragens ${r.resumo.viragens} · cambadelas ${r.resumo.cambadelas}`)
  for (const e of r.resumo.eventos) console.log(new Date(e.t).toTimeString().slice(0, 5), e.tipo.padEnd(8), e.texto)
}

if (PRINCIPAL) await principal()
