// A barra de cima do ecrã (string HTML), numa função pura: o nome, a hora, o GPS, o barómetro, o aviso
// do som, o alarme mais grave, o piloto e a ligação ao SignalK. O que vem de fora (o estado do piloto,
// os textos dos alarmes) passa sempre pelo esc.

import { esc } from './rota-texto.js'
import { hora, num, hpa } from './formato.js'

// { agora (ms ou Date), gps (bool), pressao (Pa), tendencia ({ sentido } | null), somHtml, alarmeHtml,
//   piloto (texto do SignalK), ligado (bool) }
export function barraHtml ({ agora = Date.now(), gps = false, pressao, tendencia, somHtml = '', alarmeHtml = '', piloto, ligado = false } = {}) {
  const seta = !tendencia ? '' : tendencia.sentido === 'sobe' ? ' ▲' : tendencia.sentido === 'desce' ? ' ▼' : ' ▬'
  return `<span class="nome">ARLEQUIN</span><span>${hora(new Date(agora))}</span>
<span class="chip ${gps ? 'bom' : 'off'}">GPS</span><span class="chip off" title="Meshtastic: depois de validar o sistema">Mesh</span><span class="chip off" title="4G: a instalar">4G</span>
<span class="chip">${pressao ? num(hpa(pressao), 0) : '—'} hPa${seta}</span>${somHtml}${alarmeHtml}
<span class="chip piloto">Piloto: ${esc(piloto || 'manual')}</span>${ligado ? '' : '<span class="chip alarme">SEM LIGAÇÃO AO SIGNALK</span>'}`
}
