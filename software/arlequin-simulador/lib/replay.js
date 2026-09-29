'use strict'
// Leva um minuto da simulação de passagem (ferramentas/passagem/passagem.json)
// para deltas SignalK, para o sistema "viver" esse momento: navegação, vento
// aparente calculado, rota ativa, energia e (à parte) o motor por J1939.

const NO = 1852 / 3600
const GRAU = Math.PI / 180
const norm = (a) => ((a % 360) + 360) % 360
const dif = (a, b) => { let d = norm(a - b); if (d > 180) d -= 360; return d }

function pontoMaisPerto (pontos, t) {
  let melhor = pontos[0]
  for (const p of pontos) if (Math.abs(p.t - t) < Math.abs(melhor.t - t)) melhor = p
  return melhor
}

// ROTA: [{ nome, lat, lon }] — para o próximo WP, distância, XTE.
function deltaDoPonto (p, ROTA) {
  const i = Math.max(1, ROTA.findIndex(w => w.nome === p.wp))
  const wp = ROTA[i]
  const ant = ROTA[i - 1]
  const vet = (a, b) => {
    const dx = (b.lon - a.lon) * 60 * Math.cos(a.lat * GRAU); const dy = (b.lat - a.lat) * 60
    return { mn: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy) / GRAU) }
  }
  const aoWp = vet({ lat: p.lat, lon: p.lon }, wp)
  const perna = vet(ant, wp)
  const desde = vet(ant, { lat: p.lat, lon: p.lon })
  const xte = desde.mn * Math.sin((desde.rumo - perna.rumo) * GRAU) * 1852
  const vmg = p.sog * Math.cos((p.cog - aoWp.rumo) * GRAU)
  // Vento real (de onde vem) → aparente, com a velocidade na água e a proa.
  const tws = p.tws * NO; const stw = p.stw * NO
  const wx = -tws * Math.sin(p.twd * GRAU) - stw * Math.sin(p.proa * GRAU)
  const wy = -tws * Math.cos(p.twd * GRAU) - stw * Math.cos(p.proa * GRAU)
  const awa = dif(norm(Math.atan2(-wx, -wy) / GRAU), p.proa)
  const twa = dif(p.twd, p.proa)
  const adorno = p.motor ? 3 : Math.min(20, 1.1 * p.tws * Math.abs(Math.sin(awa * GRAU))) * -Math.sign(awa)
  return {
    updates: [{
      timestamp: new Date().toISOString(),
      values: [
        { path: 'navigation.position', value: { latitude: p.lat, longitude: p.lon } },
        { path: 'navigation.headingTrue', value: p.proa * GRAU },
        { path: 'navigation.courseOverGroundTrue', value: p.cog * GRAU },
        { path: 'navigation.speedOverGround', value: p.sog * NO },
        { path: 'navigation.speedThroughWater', value: p.stw * NO },
        { path: 'navigation.attitude', value: { roll: adorno * GRAU, pitch: 0, yaw: p.proa * GRAU } },
        { path: 'navigation.leewayAngle', value: p.motor ? 0 : -Math.sign(awa) * 3 * GRAU },
        { path: 'environment.wind.angleApparent', value: awa * GRAU },
        { path: 'environment.wind.speedApparent', value: Math.hypot(wx, wy) },
        { path: 'environment.wind.angleTrueWater', value: twa * GRAU },
        { path: 'environment.wind.speedTrue', value: tws },
        { path: 'environment.wind.directionTrue', value: p.twd * GRAU },
        { path: 'environment.depth.belowTransducer', value: 60 },
        { path: 'environment.outside.pressure', value: 101200 },
        { path: 'navigation.course.calcValues.bearingTrue', value: aoWp.rumo * GRAU },
        { path: 'navigation.course.calcValues.distance', value: aoWp.mn * 1852 },
        { path: 'navigation.course.calcValues.crossTrackError', value: xte },
        { path: 'navigation.course.calcValues.velocityMadeGood', value: vmg * NO },
        { path: 'navigation.course.calcValues.timeToGo', value: vmg > 0.2 ? aoWp.mn / vmg * 3600 : null },
        { path: 'navigation.course.nextPoint', value: { name: wp.nome, position: { latitude: wp.lat, longitude: wp.lon } } },
        { path: 'electrical.batteries.servico.capacity.stateOfCharge', value: p.soc },
        { path: 'electrical.batteries.servico.current', value: p.motor ? 45 : -4.5 },
        { path: 'electrical.batteries.servico.voltage', value: p.motor ? 14.1 : 12.7 },
        { path: 'electrical.batteries.motor.voltage', value: p.motor ? 14.2 : 12.7 },
        { path: 'electrical.solar.mppt1.panelPower', value: p.noite ? 0 : 60 },
        { path: 'electrical.solar.mppt2.panelPower', value: p.noite ? 0 : 60 }
      ]
    }]
  }
}

module.exports = { pontoMaisPerto, deltaDoPonto }
