'use strict'
// Tabela de treino da AI: uma linha a cada 10 s, em unidades de gente (nós,
// graus, hPa, rpm, L/h), num CSV comprimido por dia (UTC). A previsão do tempo
// não entra aqui: junta-se no treino, a partir de previsoes/, pela hora e posição.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const NO = 1852 / 3600
const GRAU = 180 / Math.PI

const COLUNAS = ['t', 'lat', 'lon', 'proa', 'cog', 'sog', 'stw', 'tws', 'twa', 'twd', 'aws', 'awa', 'rajada',
  'adorno', 'caimento', 'pressao', 'rpm', 'litrosHora', 'grandeRizos', 'genoaPct', 'profundidade', 'soc',
  'simulado', 'estavel', 'consumoMedido']
// consumoMedido (acrescentada no fim, 30/09): 1 se o litrosHora foi medido pelo MDI
// (PGN 65266), 0 se é a estimativa do plugin J1939 pela curva da Volvo, vazio sem
// origem. Os ficheiros antigos não a têm: a AI lê-a como em branco.
const CONSUMO_MEDIDO = { medido: '1', estimado: '0' }

const num = (x, casas) => Number.isFinite(x) ? x.toFixed(casas) : ''
const rumo360 = (rad) => Number.isFinite(rad) ? ((rad * GRAU) % 360 + 360) % 360 : NaN
const angulo180 = (rad) => { const d = rumo360(rad); return d > 180 ? d - 360 : d }

function linha ({ v: valor, agora, rajadaMs, simulado, estavel }) {
  // null no SignalK é "desconhecido" (ex.: sem rotações do motor há 5 s): em branco,
  // nunca 0 (null * 60 dava 0, e um motor desconhecido parecia parado, à vela).
  const v = (c) => { const x = valor(c); return x === null ? undefined : x }
  const pos = v('navigation.position') || {}
  const att = v('navigation.attitude') || {}
  const campos = {
    t: new Date(agora).toISOString(),
    lat: num(pos.latitude, 5),
    lon: num(pos.longitude, 5),
    proa: num(rumo360(v('navigation.headingTrue')), 1),
    cog: num(rumo360(v('navigation.courseOverGroundTrue')), 1),
    sog: num(v('navigation.speedOverGround') / NO, 2),
    stw: num(v('navigation.speedThroughWater') / NO, 2),
    tws: num(v('environment.wind.speedTrue') / NO, 2),
    twa: num(angulo180(v('environment.wind.angleTrueWater')), 1),
    twd: num(rumo360(v('environment.wind.directionTrue')), 1),
    aws: num(v('environment.wind.speedApparent') / NO, 2),
    awa: num(angulo180(v('environment.wind.angleApparent')), 1),
    rajada: num(rajadaMs === null ? NaN : rajadaMs / NO, 2),
    adorno: num(att.roll * GRAU, 1),
    caimento: num(att.pitch * GRAU, 1),
    pressao: num(v('environment.outside.pressure') / 100, 1),
    rpm: num(v('propulsion.main.revolutions') * 60, 0),
    litrosHora: num(v('propulsion.main.fuel.rate') * 3.6e6, 2),
    grandeRizos: num(v('sails.grande.rizos'), 0),
    genoaPct: num(v('sails.genoa.percentagem'), 0),
    profundidade: num(v('environment.depth.belowTransducer'), 1),
    soc: num(v('electrical.batteries.servico.capacity.stateOfCharge') * 100, 0),
    simulado: simulado ? '1' : '0',
    estavel: estavel ? '1' : '0',
    consumoMedido: Object.hasOwn(CONSUMO_MEDIDO, v('propulsion.main.fuel.rateOrigem') ?? '') ? CONSUMO_MEDIDO[v('propulsion.main.fuel.rateOrigem')] : ''
  }
  return COLUNAS.map(c => campos[c]).join(',')
}

const nomeDia = (t) => new Date(t).toISOString().slice(0, 10) + '.csv.gz'

function escrever (dir, agora, texto) {
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, nomeDia(agora))
  const novo = !fs.existsSync(f)
  fs.appendFileSync(f, zlib.gzipSync((novo ? COLUNAS.join(',') + '\n' : '') + texto + '\n'))
  return f
}

module.exports = { COLUNAS, linha, escrever, nomeDia }
