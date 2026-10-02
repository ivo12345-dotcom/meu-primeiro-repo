// Desenhos SVG do ecrã (strings). Cores pelas variáveis CSS, para o modo noite.

const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const GRAU = Math.PI / 180

// Mostrador de vento: arco vermelho (BB) e verde (EB) à proa, ponteiro amarelo
// do vento aparente e ponteiro azul do vento real. Ângulos relativos em rad.
export function mostradorVento (awa, twa) {
  const pt = (a, r) => [50 + r * Math.sin(a), 50 - r * Math.cos(a)].map(n => n.toFixed(1)).join(' ')
  const ponteiro = (a, r, cor, w) => ok(a) ? `<line x1="50" y1="50" x2="${pt(a, r).split(' ')[0]}" y2="${pt(a, r).split(' ')[1]}" stroke="${cor}" stroke-width="${w}" stroke-linecap="round"/>` : ''
  let marcas = ''
  for (let g = 0; g < 360; g += 30) {
    const a = g * GRAU
    marcas += `<line x1="${pt(a, 40).split(' ')[0]}" y1="${pt(a, 40).split(' ')[1]}" x2="${pt(a, 44).split(' ')[0]}" y2="${pt(a, 44).split(' ')[1]}" stroke="var(--linha)" stroke-width="1.5"/>`
  }
  return `<svg viewBox="0 0 100 100" class="mostrador" role="img" aria-label="vento">
<circle cx="50" cy="50" r="44" fill="none" stroke="var(--linha)" stroke-width="2"/>
<path d="M${pt(0, 44)} A44 44 0 0 0 ${pt(-60 * GRAU, 44)}" stroke="var(--bb)" stroke-width="5" fill="none"/>
<path d="M${pt(0, 44)} A44 44 0 0 1 ${pt(60 * GRAU, 44)}" stroke="var(--eb)" stroke-width="5" fill="none"/>
${marcas}
<polygon points="50,14 46,24 54,24" fill="var(--texto-2)"/>
${ponteiro(twa, 34, 'var(--azul)', 3)}
${ponteiro(awa, 40, 'var(--amarelo)', 4.5)}
<circle cx="50" cy="50" r="4" fill="var(--texto)"/>
</svg>`
}

// Barra de nível 0–1.
export function barra (frac, cor = 'var(--verde)') {
  const f = ok(frac) ? Math.max(0, Math.min(1, frac)) : 0
  return `<div class="barra"><div style="width:${(f * 100).toFixed(1)}%;background:${cor}"></div></div>`
}

// Barra de XTE: o barco em relação à linha da rota (escala ±lim metros).
export function barraXte (xte, lim = 0.25 * 1852) {
  const f = ok(xte) ? Math.max(-1, Math.min(1, xte / lim)) : 0
  return `<svg viewBox="0 0 200 24" class="xte"><line x1="100" y1="2" x2="100" y2="22" stroke="var(--rosa)" stroke-width="2"/>
<line x1="10" y1="12" x2="190" y2="12" stroke="var(--linha)" stroke-width="1"/>
<polygon points="${100 + f * 90},4 ${95 + f * 90},20 ${105 + f * 90},20" fill="var(--texto)"/></svg>`
}

// Polar para um TWS (meia polar, 0–180°), com o ponto alvo e o real.
export function polarSvg (polar, twsNos, alvo, real) {
  if (!polar) return ''
  const cx = 12
  const cy = 110
  const k = 12.5
  let h = ''
  for (const r of [2, 4, 6, 8]) {
    h += `<path d="M${cx} ${cy - r * k} A${r * k} ${r * k} 0 0 1 ${cx} ${cy + r * k}" fill="none" stroke="var(--linha)" stroke-width="0.6"/><text x="${cx + 2}" y="${cy - r * k - 2}" font-size="7" fill="var(--texto-2)">${r}</text>`
  }
  for (const a of [30, 60, 90, 120, 150]) {
    const t = a * GRAU
    h += `<line x1="${cx}" y1="${cy}" x2="${cx + 8.3 * k * Math.sin(t)}" y2="${cy - 8.3 * k * Math.cos(t)}" stroke="var(--linha)" stroke-width="0.4"/><text x="${cx + 8.9 * k * Math.sin(t)}" y="${cy - 8.9 * k * Math.cos(t) + 3}" font-size="7" fill="var(--texto-2)" text-anchor="middle">${a}°</text>`
  }
  // Curva interpolada para o TWS atual.
  const j = polar.tws.findIndex(t => t >= twsNos)
  // acima da última coluna, a última (auditoria M-37: o j = −1 caía no "j <= 0" e dava a 1.ª, a dos 6 nós)
  const lin = (i) => {
    if (j === -1) return polar.v[i][polar.tws.length - 1]
    if (j === 0) return polar.v[i][0]
    const f = (twsNos - polar.tws[j - 1]) / (polar.tws[j] - polar.tws[j - 1])
    return polar.v[i][j - 1] * (1 - f) + polar.v[i][j] * f
  }
  const pts = polar.twa.map((a, i) => { const t = a * GRAU; const r = lin(i) * k; return `${(cx + r * Math.sin(t)).toFixed(1)},${(cy - r * Math.cos(t)).toFixed(1)}` })
  h += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--amarelo)" stroke-width="2"/>`
  const ponto = (p, cor, cheio) => ok(p?.twa) && ok(p?.v)
    ? `<circle cx="${cx + p.v * k * Math.sin(Math.abs(p.twa))}" cy="${cy - p.v * k * Math.cos(Math.abs(p.twa))}" r="4" fill="${cheio ? cor : 'none'}" stroke="${cor}" stroke-width="2"/>`
    : ''
  h += ponto(alvo, 'var(--amarelo)', true) + ponto(real, 'var(--texto)', false)
  return `<svg viewBox="0 0 125 220" class="polar" role="img" aria-label="polar">${h}</svg>`
}
