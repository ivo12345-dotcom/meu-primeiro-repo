'use strict'
// Registo das sessões de carga: sempre num ficheiro JSONL do plugin e,
// opcionalmente, como entrada no diário de bordo (plugin signalk-logbook).

const fs = require('node:fs/promises')

// Sem SoC (o SmartShunt ainda não chegou ou calou-se): "—", nunca "0%" (auditoria M-65).
const pct = (soc) => (typeof soc === 'number' && Number.isFinite(soc) ? `${Math.round(soc * 100)}%` : '—')

function duracao (min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

function textoSessao (s) {
  const ah = s.ah.toFixed(1).replace('.', ',')
  return `Carga pelo motor: ${duracao(s.duracaoMin)}, +${ah} Ah, serviço ${pct(s.socInicial)} → ${pct(s.socFinal)}`
}

// Devolve { erro: null | string }. Nunca lança: o plugin tem de continuar.
async function registar (sessao, { ficheiro, logbookUrl, token, fetchFn = globalThis.fetch }) {
  await fs.appendFile(ficheiro, JSON.stringify(sessao) + '\n', 'utf8')
  if (!logbookUrl) return { erro: null }
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetchFn(logbookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: textoSessao(sessao), category: 'engine', origin: 'auto' })
    })
    return { erro: res.ok ? null : `logbook respondeu ${res.status}` }
  } catch (e) {
    return { erro: `logbook inacessível: ${e.message}` }
  }
}

module.exports = { textoSessao, registar }
