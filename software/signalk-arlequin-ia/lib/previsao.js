'use strict'
// Arquivo da previsão do tempo (Open-Meteo) para a posição do barco, para a AI
// aprender em quanto a previsão falha. De hora a hora a navegar, de 3 em 3 h
// parado; sem rede tenta outra vez 10 min depois. Horas em UTC, vento em nós,
// direções em graus (de onde vem), ondas em m e s.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const MIN = 60000

function urls (lat, lon) {
  const q = `latitude=${lat}&longitude=${lon}&timezone=UTC&forecast_days=2`
  return {
    vento: `https://api.open-meteo.com/v1/forecast?${q}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`,
    mar: `https://marine-api.open-meteo.com/v1/marine?${q}&hourly=wave_height,wave_period,wave_direction`
  }
}

// Junta as duas respostas num registo; o mar é opcional (perto de terra pode faltar).
function compor (lat, lon, obtida, vento, mar) {
  const horas = vento.hourly.time
  const iMar = new Map((mar?.hourly?.time || []).map((t, i) => [t, i]))
  const doMar = (campo) => horas.map(t => { const i = iMar.get(t); return i === undefined ? null : (mar.hourly[campo][i] ?? null) })
  return {
    obtida: new Date(obtida).toISOString(),
    lat,
    lon,
    horas: horas.map(t => `${t}:00Z`),
    tws: vento.hourly.wind_speed_10m,
    rajada: vento.hourly.wind_gusts_10m,
    twd: vento.hourly.wind_direction_10m,
    ondas: doMar('wave_height'),
    periodo: doMar('wave_period'),
    ondasDir: doMar('wave_direction')
  }
}

async function descarregar (lat, lon, agora, fetchFn = fetch) {
  const la = Math.round(lat * 1000) / 1000
  const lo = Math.round(lon * 1000) / 1000
  const u = urls(la, lo)
  const r = await fetchFn(u.vento)
  if (!r.ok) throw new Error(`Open-Meteo respondeu ${r.status}`)
  const vento = await r.json()
  let mar = null
  try { const rm = await fetchFn(u.mar); if (rm.ok) mar = await rm.json() } catch { mar = null }
  return compor(la, lo, agora, vento, mar)
}

const nomeFicheiro = (obtida) => new Date(obtida).toISOString().slice(0, 16).replace(':', '-') + '.json.gz'

function guardar (pasta, registo) {
  fs.mkdirSync(pasta, { recursive: true })
  const f = path.join(pasta, nomeFicheiro(registo.obtida))
  fs.writeFileSync(f + '.tmp', zlib.gzipSync(JSON.stringify(registo)))
  fs.renameSync(f + '.tmp', f)
  return f
}

function precisaPrevisao ({ agora, okEm, tentativaEm, aNavegar }) {
  if (tentativaEm && agora - tentativaEm < 10 * MIN) return false
  return !okEm || agora - okEm >= (aNavegar ? 60 : 180) * MIN
}

module.exports = { urls, compor, descarregar, nomeFicheiro, guardar, precisaPrevisao }
