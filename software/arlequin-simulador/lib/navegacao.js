'use strict'
// Simulação de navegação em tempo real ao largo de Peniche, para o ecrã da
// roda: barco a seguir uma rota (bordeja contra o vento), vento com rajadas,
// corrente, três alvos AIS (um em rota de colisão) e ciclo vela/motor.
// Lógica pura: avancarNav(estado, dt) devolve o novo estado e as deltas.

const NO = 1852 / 3600
const GRAU = Math.PI / 180
const M_POR_GRAU = 111320
const DOIS_PI = 2 * Math.PI

const norm = (a) => ((a % DOIS_PI) + DOIS_PI) % DOIS_PI
const dif = (a, b) => { let d = norm(a - b); if (d > Math.PI) d -= DOIS_PI; return d }

// Peniche → Nazaré por fora do Cabo Carvoeiro (o porto fica a sul da península).
const ROTA = [
  { nome: 'WP1 Sul Carvoeiro', latitude: 39.343, longitude: -9.412 },
  { nome: 'WP2 Carvoeiro', latitude: 39.370, longitude: -9.440 },
  { nome: 'WP3 Baleal', latitude: 39.455, longitude: -9.345 },
  { nome: 'WP4 Nazaré', latitude: 39.595, longitude: -9.085 }
]

const PADRAO = Object.freeze({
  inicio: { latitude: 39.352, longitude: -9.378 }, // saída do porto de Peniche
  ventoDir: 20 * GRAU, // de onde vem (a rota até à Nazaré fica contra o vento)
  ventoNos: 14,
  corrente: { set: 200 * GRAU, drift: 0.6 * NO },
  anguloBolina: 45 * GRAU,
  cicloVelaS: 20 * 60,
  cicloMotorS: 5 * 60,
  combustivelM3: 0.2 * 0.62,
  capacidadeM3: 0.2,
  pressaoPa: 101600
})

// Deslocamento em metros para lat/lon (plano local).
function mover (p, dx, dy) {
  return {
    latitude: p.latitude + dy / M_POR_GRAU,
    longitude: p.longitude + dx / (M_POR_GRAU * Math.cos(p.latitude * GRAU))
  }
}

function vetor (p, q) {
  const dx = (q.longitude - p.longitude) * M_POR_GRAU * Math.cos(p.latitude * GRAU)
  const dy = (q.latitude - p.latitude) * M_POR_GRAU
  return { dx, dy, dist: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy)) }
}

// Velocidade na água à vela (simples, perto da polar estimada).
function stwVela (twaAbs, twsNos) {
  if (twaAbs < 35 * GRAU) return 0
  const forma = Math.sin(Math.min(twaAbs, 100 * GRAU)) * (twaAbs > 100 * GRAU ? 0.9 + 0.1 * Math.cos(twaAbs - 100 * GRAU) : 1)
  return Math.min(7.2, 0.46 * twsNos) * forma * 0.85 * NO // ~85-95% da polar
}

function alvoColisao (eu, vEu, t) {
  // Põe o NORDIC STAR onde, a 250° e 12 nós, se encontra connosco daqui a 12 min.
  const T = 12 * 60
  const cog = 250 * GRAU
  const sog = 12 * NO
  const dx = vEu.vx * T - sog * Math.sin(cog) * T + 250 // passa a ~250 m
  const dy = vEu.vy * T - sog * Math.cos(cog) * T
  return { mmsi: '263000001', nome: 'NORDIC STAR', tipo: { id: 70, name: 'Cargo' }, position: mover(eu, dx, dy), cog, sog, nasceu: t }
}

function criarNavegacao (opcoes = {}, t0 = Date.now()) {
  const c = { ...PADRAO, ...opcoes }
  const pos = { ...c.inicio }
  return {
    c,
    t: t0,
    inicio: t0,
    pos,
    proa: 0,
    wp: 0,
    xte: 0,
    combustivel: c.combustivelM3,
    tempMotor: 290,
    alvos: [
      null, // o NORDIC STAR nasce no 1.º passo, já com a nossa velocidade
      { mmsi: '263000002', nome: 'MARIA JOÃO', tipo: { id: 30, name: 'Pesca' }, position: mover(pos, -3000, 2500), cog: 120 * GRAU, sog: 3 * NO },
      { mmsi: '263000003', nome: 'SEAGULL', tipo: { id: 37, name: 'Recreio' }, position: mover(pos, 5000, 5500), cog: 30 * GRAU, sog: 6.2 * NO }
    ]
  }
}

function motorLigado (e) {
  const ciclo = e.c.cicloVelaS + e.c.cicloMotorS
  return ((e.t - e.inicio) / 1000) % ciclo >= e.c.cicloVelaS
}

function avancarNav (e0, dtMs) {
  const e = { ...e0, t: e0.t + dtMs, alvos: [...e0.alvos] }
  const dt = dtMs / 1000
  const seg = (e.t - e.inicio) / 1000
  const c = e.c

  // Vento com oscilação lenta e rajadas.
  const ventoDir = norm(c.ventoDir + 8 * GRAU * Math.sin(seg / 600))
  const tws = (c.ventoNos + 2.5 * Math.sin(seg / 47) + 1.5 * Math.sin(seg / 13)) * NO

  // Rota: WP atual (passa ao seguinte a 0,1 MN; no fim volta ao início).
  let alvoWp = ROTA[e.wp]
  let v = vetor(e.pos, alvoWp)
  if (v.dist < 185) {
    e.wp = (e.wp + 1) % ROTA.length
    if (e.wp === 0) e.pos = { ...c.inicio }
    alvoWp = ROTA[e.wp]
    v = vetor(e.pos, alvoWp)
  }

  // O timoneiro: direto ao WP se der; contra o vento, bolina e vira na layline.
  const motor = motorLigado(e)
  let proa = v.rumo
  if (!motor && Math.abs(dif(v.rumo, ventoDir)) < c.anguloBolina) {
    const eb = norm(ventoDir - c.anguloBolina)
    const bb = norm(ventoDir + c.anguloBolina)
    const atual = Math.abs(dif(e.proa, eb)) < Math.abs(dif(e.proa, bb)) ? eb : bb
    const outro = atual === eb ? bb : eb
    const dOutro = dif(outro, atual)
    const dWp = dif(v.rumo, atual)
    const virar = Math.sign(dWp) === Math.sign(dOutro) && Math.abs(dWp) >= Math.abs(dOutro)
    proa = virar ? outro : atual
  }
  e.proa = proa

  const twa = dif(ventoDir, proa) // + = vento por EB
  const stw = motor ? 5.5 * NO : stwVela(Math.abs(twa), tws / NO)
  const vx = stw * Math.sin(proa) + c.corrente.drift * Math.sin(c.corrente.set)
  const vy = stw * Math.cos(proa) + c.corrente.drift * Math.cos(c.corrente.set)
  e.pos = mover(e.pos, vx * dt, vy * dt)
  const sog = Math.hypot(vx, vy)
  const cog = norm(Math.atan2(vx, vy))

  // Vento aparente = real + vento do movimento na água.
  const wx = -tws * Math.sin(ventoDir) - stw * Math.sin(proa)
  const wy = -tws * Math.cos(ventoDir) - stw * Math.cos(proa)
  const aws = Math.hypot(wx, wy)
  const awa = dif(norm(Math.atan2(-wx, -wy)), proa)

  // Adorno para sotavento (roll + = EB para baixo) e abatimento.
  const forca = motor ? 0 : Math.min(1, tws / (16 * NO)) * Math.max(0, Math.sin(Math.abs(awa)))
  const roll = -Math.sign(awa) * 18 * GRAU * forca
  const leeway = -Math.sign(awa) * 5 * GRAU * forca * Math.max(0, Math.cos(Math.abs(twa)))

  // Motor: temperatura sobe a ~85 °C a trabalhar e desce parado.
  const alvoTemp = motor ? 358 : 290
  e.tempMotor += (alvoTemp - e.tempMotor) * Math.min(1, dt / 120)
  const fuelRate = motor ? 0.9 / 3600 / 1000 : 0
  e.combustivel = Math.max(0, e.combustivel - fuelRate * dt)

  // Rota: distância, XTE à perna, tempo e VMG ao WP.
  const anterior = e.wp === 0 ? c.inicio : ROTA[e.wp - 1]
  const perna = vetor(anterior, alvoWp)
  const doInicio = vetor(anterior, e.pos)
  const xte = doInicio.dist * Math.sin(dif(doInicio.rumo, perna.rumo))
  const vmg = sog * Math.cos(dif(cog, v.rumo))

  // AIS: o NORDIC STAR renasce de 30 em 30 min em rota de colisão.
  if (!e.alvos[0] || e.t - e.alvos[0].nasceu > 30 * 60 * 1000) e.alvos[0] = alvoColisao(e.pos, { vx, vy }, e.t)
  e.alvos = e.alvos.map((a, i) => {
    const cogA = i === 1 ? norm(a.cog + 2 * GRAU * dt / 10) : a.cog // o pesqueiro anda às voltas
    return { ...a, cog: cogA, position: mover(a.position, a.sog * Math.sin(cogA) * dt, a.sog * Math.cos(cogA) * dt) }
  })

  const ts = new Date(e.t).toISOString()
  const self = [
    { path: 'navigation.position', value: e.pos },
    { path: 'navigation.headingTrue', value: proa },
    { path: 'navigation.courseOverGroundTrue', value: cog },
    { path: 'navigation.speedOverGround', value: sog },
    { path: 'navigation.speedThroughWater', value: stw },
    { path: 'navigation.attitude', value: { roll, pitch: 0, yaw: proa } },
    { path: 'navigation.leewayAngle', value: leeway },
    { path: 'environment.depth.belowTransducer', value: 28 + 20 * Math.sin(seg / 900) + 2 * Math.sin(seg / 31) },
    { path: 'environment.wind.angleApparent', value: awa },
    { path: 'environment.wind.speedApparent', value: aws },
    { path: 'environment.wind.angleTrueWater', value: twa },
    { path: 'environment.wind.speedTrue', value: tws },
    { path: 'environment.wind.directionTrue', value: ventoDir },
    { path: 'environment.current', value: { setTrue: c.corrente.set, drift: c.corrente.drift } },
    { path: 'environment.outside.pressure', value: c.pressaoPa - 80 * seg / 3600 },
    { path: 'environment.inside.temperature', value: 294.2 },
    { path: 'environment.inside.relativeHumidity', value: 0.68 },
    { path: 'navigation.course.calcValues.bearingTrue', value: v.rumo },
    { path: 'navigation.course.calcValues.distance', value: v.dist },
    { path: 'navigation.course.calcValues.crossTrackError', value: xte },
    { path: 'navigation.course.calcValues.velocityMadeGood', value: vmg },
    { path: 'navigation.course.calcValues.timeToGo', value: vmg > 0.2 ? v.dist / vmg : null },
    { path: 'navigation.course.nextPoint', value: { name: alvoWp.nome, position: { latitude: alvoWp.latitude, longitude: alvoWp.longitude } } },
    { path: 'propulsion.main.temperature', value: e.tempMotor },
    { path: 'propulsion.main.oilPressure', value: motor ? 350000 : 0 },
    { path: 'propulsion.main.alternatorVoltage', value: motor ? 14.2 : 0 },
    { path: 'propulsion.main.fuel.rate', value: fuelRate },
    { path: 'tanks.fuel.0.currentLevel', value: e.combustivel / c.capacidadeM3 },
    { path: 'tanks.fuel.0.capacity', value: c.capacidadeM3 }
  ]
  const deltas = [{ updates: [{ timestamp: ts, values: self }] }]
  for (const a of e.alvos) {
    deltas.push({
      context: `vessels.urn:mrn:imo:mmsi:${a.mmsi}`,
      updates: [{
        timestamp: ts,
        values: [
          { path: '', value: { name: a.nome, mmsi: a.mmsi } },
          { path: 'navigation.position', value: a.position },
          { path: 'navigation.courseOverGroundTrue', value: a.cog },
          { path: 'navigation.speedOverGround', value: a.sog },
          { path: 'design.aisShipType', value: a.tipo }
        ]
      }]
    })
  }
  return { estado: e, deltas, motor, sog }
}

module.exports = { ROTA, PADRAO, criarNavegacao, avancarNav, motorLigado }
