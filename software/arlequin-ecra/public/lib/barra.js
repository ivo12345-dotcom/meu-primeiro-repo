// A barra de cima do ecrã (string HTML), numa função pura: o nome, a hora, o alarme e o botão de calar, o
// aviso do som, as falhas do ecrã, a ligação ao SignalK e, no fim, o GPS, o barómetro e o piloto. O que vem de
// fora (o estado do piloto, os textos dos alarmes) passa sempre pelo esc.
// A ordem conta (revisão F3, Important 1): a 1024×600, com uma falha, o "sem som" e um alarme comprido a barra
// não cabe; os chips encolhem com reticências (estilo.css), os de informação (classe info) primeiro, e o alarme
// e o botão de calar ficam logo a seguir à hora, sempre à vista.

import { esc } from './rota-texto.js'
import { hora, num, hpa } from './formato.js'

// { agora (ms ou Date), gps (bool), pressao (Pa), tendencia ({ sentido } | null), somHtml, alarmeHtml,
//   calarFalha (texto: porque não se calou, logo a seguir ao botão), piloto (texto do SignalK), ligado (bool),
//   falhas: [texto] (ex.: a do modo noite do OpenCPN) }
export function barraHtml ({ agora = Date.now(), gps = false, pressao, tendencia, somHtml = '', alarmeHtml = '', calarFalha = null, piloto, ligado = false, falhas = [] } = {}) {
  const seta = !tendencia ? '' : tendencia.sentido === 'sobe' ? ' ▲' : tendencia.sentido === 'desce' ? ' ▼' : ' ▬'
  const recusa = calarFalha ? `<span class="chip falha calar">⚠ ${esc(calarFalha)}</span>` : ''
  return `<span class="nome">ARLEQUIN</span><span class="hora">${hora(new Date(agora))}</span>${alarmeHtml}${recusa}${somHtml}${falhas.filter(Boolean).map(f => `<span class="chip falha">⚠ ${esc(f)}</span>`).join('')}${ligado ? '' : '<span class="chip alarme">SEM LIGAÇÃO AO SIGNALK</span>'}
<span class="chip info ${gps ? 'bom' : 'off'}">GPS</span><span class="chip info off" title="Meshtastic: depois de validar o sistema">Mesh</span><span class="chip info off" title="4G: a instalar">4G</span>
<span class="chip info">${pressao ? num(hpa(pressao), 0) : '—'} hPa${seta}</span><span class="chip info piloto">Piloto: ${esc(piloto || 'manual')}</span>`
}
