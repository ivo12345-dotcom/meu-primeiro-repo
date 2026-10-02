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

// A corrente do banco de serviço (como a rota conta: 4,5 A de dia, 6 A de noite; o alternador a motor).
const correnteServico = (p) => (p.motor ? 45 : p.noite ? -6 : -4.5)

// ROTA: [{ nome, lat, lon }] — para o próximo WP, distância, XTE.
// O próximo WP é o do ponto (p.wp), também o 1.º (aí a perna começa no próprio ponto: XTE 0); com um
// WP que a rota não tem não se inventa rumo nenhum (auditoria M-69: o Math.max(1, …) mostrava outro).
function deltaDoPonto (p, ROTA) {
  const i = ROTA.findIndex(w => w.nome === p.wp)
  const vet = (a, b) => {
    const dx = (b.lon - a.lon) * 60 * Math.cos(a.lat * GRAU); const dy = (b.lat - a.lat) * 60
    return { mn: Math.hypot(dx, dy), rumo: norm(Math.atan2(dx, dy) / GRAU) }
  }
  const aqui = { lat: p.lat, lon: p.lon }
  const wp = ROTA[i]
  const ant = i > 0 ? ROTA[i - 1] : aqui
  const aoWp = wp ? vet(aqui, wp) : null
  const perna = wp ? vet(ant, wp) : null
  const desde = vet(ant, aqui)
  const xte = wp && desde.mn > 0 ? desde.mn * Math.sin((desde.rumo - perna.rumo) * GRAU) * 1852 : 0
  const vmg = aoWp ? p.sog * Math.cos((p.cog - aoWp.rumo) * GRAU) : null
  const rumo = !wp
    ? []
    : [
        { path: 'navigation.course.calcValues.bearingTrue', value: aoWp.rumo * GRAU },
        { path: 'navigation.course.calcValues.distance', value: aoWp.mn * 1852 },
        { path: 'navigation.course.calcValues.crossTrackError', value: xte },
        { path: 'navigation.course.calcValues.velocityMadeGood', value: vmg * NO },
        { path: 'navigation.course.calcValues.timeToGo', value: vmg > 0.2 ? aoWp.mn / vmg * 3600 : null },
        { path: 'navigation.course.nextPoint', value: { name: wp.nome, position: { latitude: wp.lat, longitude: wp.lon } } }
      ]
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
        ...rumo,
        { path: 'electrical.batteries.servico.capacity.stateOfCharge', value: p.soc },
        { path: 'electrical.batteries.servico.current', value: correnteServico(p) },
        { path: 'electrical.batteries.servico.voltage', value: p.motor ? 14.1 : 12.7 },
        { path: 'electrical.batteries.motor.voltage', value: p.motor ? 14.2 : 12.7 },
        { path: 'electrical.solar.mppt1.panelPower', value: p.noite ? 0 : 60 },
        { path: 'electrical.solar.mppt2.panelPower', value: p.noite ? 0 : 60 }
      ]
    }]
  }
}

module.exports = { pontoMaisPerto, deltaDoPonto }
