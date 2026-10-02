// Relatório da passagem simulada: SVG com o mapa (costa aproximada, rota,
// rasto à vela/a motor, dia/noite) e gráficos de vento, velocidade e ondas.
//   node relatorio.mjs → relatorio.svg
// Lê as saídas da última corrida do simular.mjs (passagem.json, resumo.json, rota.json, aqui ao lado,
// fora do git): corre primeiro o simular.mjs (ver lá como reproduzir o resultado de referência de 29/09).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const pts = JSON.parse(readFileSync(path.join(aqui, 'passagem.json'), 'utf8'))
const res = JSON.parse(readFileSync(path.join(aqui, 'resumo.json'), 'utf8'))
const { ROTA, COSTA } = JSON.parse(readFileSync(path.join(aqui, 'rota.json'), 'utf8'))

const W = 680; const H = 760
const mapa = { x: 10, y: 40, w: 250, h: 700 }
const lat0 = 38.63; const lat1 = 39.38; const lon0 = -9.72; const lon1 = -9.18
const k = Math.cos(39 * Math.PI / 180)
const esc = Math.min(mapa.w / ((lon1 - lon0) * k), mapa.h / (lat1 - lat0))
const X = (lon) => (mapa.x + (lon - lon0) * k * esc).toFixed(1)
const Y = (lat) => (mapa.y + (lat1 - lat) * esc).toFixed(1)
const hm = (t) => new Date(t).toTimeString().slice(0, 5)
const f1 = (x) => x.toFixed(1).replace('.', ',')

let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><title>Passagem Algés → Peniche simulada</title>
<desc>Mapa com a rota e o rasto (verde à vela, laranja a motor), e gráficos de vento, rajadas, velocidade e ondas ao longo do tempo.</desc>
<text x="10" y="22" class="th">Algés → Peniche · partida ${hm(new Date(res.partida))} · chegada ${hm(new Date(res.chegada))} (${f1(res.duracaoH)} h, ${f1(res.milhas)} MN)</text>`
// mar + costa (terra a leste da linha de costa)
s += `<rect x="${mapa.x}" y="${mapa.y}" width="${mapa.w}" height="${mapa.h}" rx="6" fill="#E6F1FB"/>`
const costa = COSTA.map(c => `${X(c.lon)},${Y(c.lat)}`).join(' ')
s += `<polygon points="${X(-9.18)},${Y(38.707)} ${costa} ${X(-9.18)},${Y(39.38)}" fill="#F1EFE8" stroke="#888780" stroke-width="1"/>`
s += `<polygon points="${X(-9.18)},${Y(38.686)} ${X(-9.148)},${Y(38.686)} ${X(-9.235)},${Y(38.668)} ${X(-9.24)},${Y(38.63)} ${X(-9.18)},${Y(38.63)}" fill="#F1EFE8" stroke="#888780" stroke-width="1"/>`
for (const [n, la, lo] of [['Lisboa', 38.71, -9.20], ['Cascais', 38.70, -9.42], ['C. Raso', 38.715, -9.47], ['C. da Roca', 38.785, -9.48], ['Ericeira', 38.965, -9.40], ['Sta Cruz', 39.135, -9.37], ['Peniche', 39.36, -9.37]]) s += `<text x="${+X(lo) + 3}" y="${Y(la)}" font-size="9" fill="#5F5E5A">${n}</text>`
// rota
s += `<polyline points="${ROTA.map(w => `${X(w.lon)},${Y(w.lat)}`).join(' ')}" fill="none" stroke="#888780" stroke-width="1" stroke-dasharray="4 3"/>`
// rasto por troços (vela/motor, noite mais escuro)
for (let i = 10; i < pts.length; i += 10) {
  const a = pts[i - 10]; const b = pts[i]
  const cor = b.motor ? (b.noite ? '#854F0B' : '#BA7517') : (b.noite ? '#0F6E56' : '#1D9E75')
  s += `<line x1="${X(a.lon)}" y1="${Y(a.lat)}" x2="${X(b.lon)}" y2="${Y(b.lat)}" stroke="${cor}" stroke-width="3" stroke-linecap="round"/>`
}
// marcas de hora
for (let i = 0; i < pts.length; i += 120) s += `<circle cx="${X(pts[i].lon)}" cy="${Y(pts[i].lat)}" r="2.5" fill="#2C2C2A"/><text x="${+X(pts[i].lon) - 34}" y="${+Y(pts[i].lat) + 3}" font-size="9" fill="#2C2C2A">${hm(pts[i].t)}</text>`
// vento real em setas (de 2 em 2 h)
for (let i = 60; i < pts.length; i += 120) {
  const p = pts[i]; const ang = (p.twd + 180) * Math.PI / 180
  const x = +X(p.lon) - 40; const y = +Y(p.lat); const L = 8 + p.tws
  s += `<line x1="${x}" y1="${y}" x2="${(x + L * Math.sin(ang)).toFixed(1)}" y2="${(y - L * Math.cos(ang)).toFixed(1)}" stroke="#185FA5" stroke-width="1.5" marker-end="url(#seta)"/><text x="${x - 16}" y="${y + 12}" font-size="8" fill="#185FA5">${Math.round(p.tws)} nós</text>`
}
s = s.replace('<desc>', '<defs><marker id="seta" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#185FA5" stroke-width="1.5"/></marker></defs><desc>')
// legenda do mapa
s += `<g font-size="9" fill="#2C2C2A"><line x1="20" y1="728" x2="34" y2="728" stroke="#1D9E75" stroke-width="3"/><text x="38" y="731">vela</text><line x1="68" y1="728" x2="82" y2="728" stroke="#BA7517" stroke-width="3"/><text x="86" y="731">motor</text><text x="122" y="731">(escuro = noite)</text></g>`

// gráficos à direita
const gx = 290; const gw = 380
function grafico (y0, h, titulo, series, max, unidade) {
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t
  const tx = (t) => (gx + (t - t0) / (t1 - t0) * gw).toFixed(1)
  const ty = (v) => (y0 + h - v / max * h).toFixed(1)
  let g = `<text x="${gx}" y="${y0 - 6}" class="ts">${titulo}</text><rect x="${gx}" y="${y0}" width="${gw}" height="${h}" fill="none" stroke="#D3D1C7" stroke-width="0.5"/>`
  // noite sombreada
  const n0 = pts.find(p => p.noite); const n1 = [...pts].reverse().find(p => p.noite)
  if (n0) g += `<rect x="${tx(n0.t)}" y="${y0}" width="${(tx(n1.t) - tx(n0.t)).toFixed(1)}" height="${h}" fill="#2C2C2A" opacity="0.07"/>`
  for (let v = 0; v <= max; v += max / 4) g += `<text x="${gx - 4}" y="${(+ty(v) + 3).toFixed(1)}" font-size="8" fill="#888780" text-anchor="end">${Math.round(v)}</text>`
  for (const [campo, cor, larg] of series) g += `<polyline points="${pts.filter((_, i) => i % 5 === 0).map(p => `${tx(p.t)},${ty(Math.min(max, p[campo]))}`).join(' ')}" fill="none" stroke="${cor}" stroke-width="${larg}"/>`
  for (let t = Math.ceil(t0 / 7200000) * 7200000; t < t1; t += 7200000) g += `<text x="${tx(t)}" y="${y0 + h + 11}" font-size="8" fill="#888780" text-anchor="middle">${hm(t)}</text>`
  return g
}
s += grafico(60, 110, 'Vento real (azul) e rajadas (cinza), nós · sombreado = noite', [['rajada', '#B4B2A9', 1], ['tws', '#185FA5', 2]], 32)
s += grafico(215, 90, 'Velocidade no fundo (verde), nós', [['sog', '#1D9E75', 2]], 8)
s += grafico(350, 70, 'Ondas, m', [['ondas', '#534AB7', 2]], 3)

// resumo
const linhas = [
  `À vela ${f1(res.horasVela)} h · a motor ${f1(res.horasMotor)} h · de noite ${f1(res.horasNoite)} h`,
  `Vento até ${Math.round(res.ventoMax)} nós, rajadas ${Math.round(res.rajadaMax)} · ondas até ${f1(res.ondasMax)} m`,
  `${res.cambadelas} cambadelas (popa a 155°, sem piloto) · a ≥ ${f1(res.costaMinMn)} MN da costa`,
  `Gasóleo ${f1(res.gasoleoGasto)} L · serviço mín. ${Math.round(res.socMin * 100)}% · leme à mão ${f1(res.horasLemeSeguidas)} h`
]
linhas.forEach((l, i) => { s += `<text x="${gx}" y="${462 + i * 17}" font-size="11" fill="#2C2C2A">${l}</text>` })
// eventos principais
const evs = res.eventos.filter(e => ['partida', 'vela', 'motor', 'noite', 'tempo', 'chegada'].includes(e.tipo)).slice(0, 12)
s += `<text x="${gx}" y="${545}" class="ts">Momentos</text>`
evs.forEach((e, i) => { s += `<text x="${gx}" y="${562 + i * 15}" font-size="9.5" fill="#444441"><tspan font-weight="bold">${hm(e.t)}</tspan> ${e.texto.replace(/&/g, '&amp;').slice(0, 80)}</text>` })
s += '</svg>'
writeFileSync(path.join(aqui, 'relatorio.svg'), s)
console.log(s.length, 'bytes')
