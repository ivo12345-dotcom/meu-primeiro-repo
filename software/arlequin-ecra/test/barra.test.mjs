// A barra de cima do ecrã (public/lib/barra.js): função pura, sem browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { barraHtml } from '../public/lib/barra.js'

const base = { agora: Date.parse('2026-09-29T14:32:00Z'), gps: true, pressao: 101600, tendencia: { sentido: 'desce', hpa3h: -2.4 }, piloto: 'standby', ligado: true }

test('a barra: nome, GPS, barómetro com a seta, piloto e, sem ligação, "SEM LIGAÇÃO AO SIGNALK"', () => {
  const html = barraHtml(base)
  assert.match(html, /ARLEQUIN/)
  assert.match(html, /class="chip bom">GPS/)
  assert.match(html, /1016 hPa ▼/)
  assert.match(html, /Piloto: standby/)
  assert.doesNotMatch(html, /SEM LIGAÇÃO/)
  assert.match(barraHtml({ ...base, ligado: false, gps: false, pressao: undefined, tendencia: null, piloto: undefined }), /class="chip off">GPS[\s\S]*— hPa[\s\S]*Piloto: manual[\s\S]*SEM LIGAÇÃO AO SIGNALK/)
})

test('auditoria K-04: o estado do piloto vem do SignalK e passa pelo esc', () => {
  const html = barraHtml({ ...base, piloto: '<!--<i id=x>' })
  assert.ok(!html.includes('<!--'))
  assert.ok(!html.includes('<i id=x>'))
  assert.match(html, /Piloto: &lt;!--&lt;i id=x&gt;/)
})
