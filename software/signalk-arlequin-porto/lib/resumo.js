'use strict'
// Texto do /estado para o Telegram, a partir dos valores do SignalK.

const ok = (x) => typeof x === 'number' && Number.isFinite(x)
const n0 = (x) => (ok(x) ? String(Math.round(x)) : '—')
const n1 = (x) => (ok(x) ? x.toFixed(1).replace('.', ',') : '—')

// v(caminho) → valor; extra: { armado, amarracao: { ponto, distancia }, alarmes: [texto] }
function resumo (v, extra) {
  const linhas = ['⛵ ARLEQUIN']
  const soc = v('electrical.batteries.servico.capacity.stateOfCharge')
  const i = v('electrical.batteries.servico.current')
  const pv = (v('electrical.solar.mppt1.panelPower') || 0) + (v('electrical.solar.mppt2.panelPower') || 0)
  linhas.push(`🔋 Serviço ${ok(soc) ? n0(soc * 100) + '%' : '—'}${ok(i) ? ` (${i >= 0 ? '+' : ''}${n1(i)} A)` : ''} · ☀️ ${n0(pv)} W · motor ${n1(v('electrical.batteries.motor.voltage'))} V`)
  const gas = v('tanks.fuel.0.currentVolume')
  const a0 = v('tanks.freshWater.0.currentVolume')
  const a1 = v('tanks.freshWater.1.currentVolume')
  linhas.push(`⛽ Gasóleo ${ok(gas) ? n0(gas * 1000) + ' L' : '—'} · 💧 ${v('tanks.freshWater.0.name') || 'BB'} ${ok(a0) ? n0(a0 * 1000) + ' L' : '—'}, ${v('tanks.freshWater.1.name') || 'EB'} ${ok(a1) ? n0(a1 * 1000) + ' L' : '—'}`)
  const tIn = v('environment.inside.temperature')
  const hIn = v('environment.inside.relativeHumidity')
  if (ok(tIn) || ok(hIn)) linhas.push(`🌡️ Cabine ${ok(tIn) ? n0(tIn - 273.15) + ' °C' : '—'} · ${ok(hIn) ? n0(hIn * 100) + '% humidade' : '—'}`)
  linhas.push(`🔒 Alarme ${extra.armado ? 'ARMADO' : 'desarmado'} · ⚓ ${extra.amarracao?.ponto ? `amarrado, a ${n0(extra.amarracao.distancia)} m do ponto` : 'sem ponto de amarração'}`)
  linhas.push(extra.alarmes?.length ? `🚨 Ativos: ${extra.alarmes.join(' · ')}` : '✅ Sem alarmes')
  return linhas.join('\n')
}

module.exports = { resumo }
