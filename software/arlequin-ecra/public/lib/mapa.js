// O mini-mapa da página "Melhor rota" (desenho 3b-1): SVG feito em funções puras a partir do
// `mapa` do resultado (janela, terra, zonas) e das alternativas (rota, rasto, avisos).
//
// - projeção equirretangular com a longitude encolhida por cos(latitude média), a caber na caixa;
// - terra a cheio, zonas a evitar a tracejado vermelho;
// - a alternativa selecionada a traço grosso (desenhada por último), as outras finas;
// - o rasto: vela azul, motor cinzento, de noite mais escuro (opacidade 0,5);
// - marcas nos avisos da selecionada (no rasto, à hora do aviso); bolinhas nos pontos de
//   desistência com o abrigo ("↩ Peniche", mais pequeno e na cor de aviso); a partida e o destino;
//   a escala em MN.
// As cores são os tokens do estilo.css (var(--…)): o modo noite muda-as sozinho.

import { esc, horaLisboa } from './rota-texto.js'

const ok = (x) => typeof x === 'number' && Number.isFinite(x)
const f1 = (x) => String(Math.round(x * 10) / 10)
const ESCALAS = [0.5, 1, 2, 5, 10, 20, 50, 100]

// A projeção da janela para uma caixa largura × altura (px), centrada. → { xy(lat, lon) → [x, y], pxPorMn }
export function projecao (j, largura, altura) {
  const cos = Math.cos((j.latMin + j.latMax) / 2 * Math.PI / 180)
  const w = (j.lonMax - j.lonMin) * cos
  const h = j.latMax - j.latMin
  const k = Math.min(largura / w, altura / h) // px por grau de latitude
  const x0 = (largura - w * k) / 2
  const y0 = (altura - h * k) / 2
  return { xy: (lat, lon) => [x0 + (lon - j.lonMin) * cos * k, y0 + (j.latMax - lat) * k], pxPorMn: k / 60, caixa: { x: x0, y: y0, w: w * k, h: h * k } }
}

// O comprimento da escala (MN): o maior número redondo com no máximo 1/4 da largura.
export function escalaMn (pxPorMn, largura) {
  let melhor = ESCALAS[0]
  for (const e of ESCALAS) if (e * pxPorMn <= largura / 4) melhor = e
  return melhor
}

// A altura da caixa para a janela (largura 1000), entre 500 e 1400.
function alturaPara (j, largura) {
  const cos = Math.cos((j.latMin + j.latMax) / 2 * Math.PI / 180)
  const r = (j.latMax - j.latMin) / ((j.lonMax - j.lonMin) * cos)
  return Math.round(Math.min(1400, Math.max(500, largura * r)))
}

const valido = (lat, lon) => ok(lat) && ok(lon)
const pontosSvg = (pr, lista) => lista.filter(([lat, lon]) => valido(lat, lon)).map(([lat, lon]) => pr.xy(lat, lon).map(f1).join(',')).join(' ')

// Os troços do rasto com o mesmo modo (vela/motor) e a mesma noite; cada troço começa no fim do anterior.
function trocos (rasto) {
  const pts = (rasto || []).filter(p => valido(p?.lat, p?.lon))
  const out = []
  for (const [i, p] of pts.entries()) {
    const chave = `${p.motor ? 'motor' : 'vela'}${p.noite ? ' noite' : ''}`
    const ult = out.at(-1)
    if (ult && ult.chave === chave) ult.pontos.push(p)
    else out.push({ chave, pontos: i ? [pts[i - 1], p] : [p] })
  }
  return out.filter(t => t.pontos.length >= 2)
}

function desenharAlternativa (pr, alt, i, sel) {
  const espessura = sel ? 8 : 3
  const tr = trocos(alt.rasto)
  let corpo
  if (tr.length) {
    corpo = tr.map(t => {
      const [modo, noite] = t.chave.split(' ')
      const cor = modo === 'vela' ? 'var(--azul)' : 'var(--texto-2)'
      // o motor tracejado (revisão final M5): de noite a vela e o motor têm quase a mesma luminância
      const traco = modo === 'vela' ? ' stroke-linecap="round"' : ' stroke-dasharray="6 6" stroke-linecap="butt"'
      return `<polyline class="rasto ${t.chave}" points="${pontosSvg(pr, t.pontos.map(p => [p.lat, p.lon]))}" fill="none" stroke="${cor}"${noite ? ' stroke-opacity="0.5"' : ''} stroke-linejoin="round"${traco}/>`
    }).join('')
  } else {
    corpo = `<polyline class="rota" points="${pontosSvg(pr, alt.rota || [])}" fill="none" stroke="var(--texto-2)" stroke-linejoin="round"/>`
  }
  return `<g class="alt${sel ? ' sel' : ''}" data-i="${i}" stroke-width="${espessura}"${sel ? '' : ' opacity="0.7"'}>${corpo}</g>`
}

// Onde está o barco à hora t no rasto (o ponto mais perto no tempo), ou null.
function noRasto (rasto, t) {
  const tt = typeof t === 'string' ? Date.parse(t) : t
  if (!ok(tt)) return null
  let melhor = null; let d = Infinity
  for (const p of rasto || []) {
    const dp = Math.abs(Date.parse(p.t) - tt)
    if (valido(p.lat, p.lon) && dp < d) { d = dp; melhor = p }
  }
  return melhor
}

const marca = (classe, [x, y], cor, r) => `<rect class="marca ${classe}" x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" fill="${cor}" stroke="var(--fundo)" stroke-width="2"/>`
const rotulo = ([x, y], texto, largura, cor = 'var(--texto)', { classe = '', tamanho = 22 } = {}) => {
  const esquerda = x > largura * 0.7
  return `<text${classe ? ` class="${classe}"` : ''} x="${f1(esquerda ? x - 14 : x + 14)}" y="${f1(y + 7)}" font-size="${tamanho}" fill="${cor}" text-anchor="${esquerda ? 'end' : 'start'}" stroke="var(--fundo)" stroke-width="4" paint-order="stroke">${esc(texto)}</text>`
}

// { mapa, alternativas, selecionada, noite, desistencia, partida (nome), destino (nome), agora,
//   largura (1000), altura? } → '<svg …>' ('' sem mapa)
export function desenharMapa ({ mapa, alternativas = [], selecionada = 0, noite = false, desistencia = [], partida = '', destino = '', agora = Date.now(), largura = 1000, altura } = {}) {
  const j = mapa?.janela
  if (!j || ![j.latMin, j.latMax, j.lonMin, j.lonMax].every(ok) || j.latMax <= j.latMin || j.lonMax <= j.lonMin) return ''
  const alt = ok(altura) ? altura : alturaPara(j, largura)
  const pr = projecao(j, largura, alt)
  const partes = []
  // o mar só na janela (a terra vem recortada a ela); o resto da caixa fica com o fundo do ecrã,
  // e tudo o que se desenha fica cortado à janela
  const c = pr.caixa
  partes.push(`<defs><clipPath id="mapa-janela"><rect x="${f1(c.x)}" y="${f1(c.y)}" width="${f1(c.w)}" height="${f1(c.h)}"/></clipPath></defs><g clip-path="url(#mapa-janela)">`)
  partes.push(`<rect class="mar" x="${f1(c.x)}" y="${f1(c.y)}" width="${f1(c.w)}" height="${f1(c.h)}" fill="var(--mar)"/>`)
  // terra: um path com um anel por M…Z (evenodd para os buracos)
  const d = (mapa.terra || []).map(anel => {
    const pts = (anel || []).filter(p => Array.isArray(p) && valido(p[0], p[1])).map(([lat, lon]) => pr.xy(lat, lon).map(f1).join(' '))
    return pts.length >= 3 ? `M${pts.join('L')}Z` : ''
  }).filter(Boolean).join('')
  partes.push(`<path class="terra" d="${d}" fill="var(--terra)" fill-rule="evenodd"/>`)
  for (const z of mapa.zonas || []) {
    partes.push(`<polygon class="zona" points="${pontosSvg(pr, z.pontos || [])}" fill="none" stroke="var(--perigo)" stroke-width="2" stroke-dasharray="8 6"><title>${esc(z.nome)}</title></polygon>`)
  }
  // as alternativas: as outras primeiro, a selecionada por cima
  const sel = alternativas[selecionada] ? selecionada : 0
  const ordem = alternativas.map((_, i) => i).filter(i => i !== sel)
  if (alternativas[sel]) ordem.push(sel)
  for (const i of ordem) partes.push(desenharAlternativa(pr, alternativas[i], i, i === sel))
  // marcas nos avisos da selecionada
  const a = alternativas[sel]
  for (const av of a?.avisos || []) {
    const p = noRasto(a.rasto, av.t)
    if (!p) continue
    const [x, y] = pr.xy(p.lat, p.lon)
    partes.push(`<path class="aviso" d="M${f1(x)} ${f1(y - 13)}L${f1(x + 11)} ${f1(y + 7)}L${f1(x - 11)} ${f1(y + 7)}Z" fill="var(--amarelo)" stroke="var(--fundo)" stroke-width="2"><title>${esc(av.hora || horaLisboa(av.t, agora))} ${esc(av.texto)}</title></path>`)
  }
  // pontos de desistência (calculados para a 1.ª alternativa): bolinha e o abrigo (o nome só
  // quando muda, para não o repetir em cada ponto)
  let anterior = null
  for (const p of desistencia || []) {
    if (!valido(p?.lat, p?.lon)) continue
    const xy = pr.xy(p.lat, p.lon)
    const nome = p.abrigo?.nome || p.voltar?.nome || ''
    // verde só com uma fuga limpa (abrigo ou volta sem aviso vermelho)
    const vermelho = ![p.abrigo, p.voltar].some(f => f && !f.avisoVermelho)
    partes.push(`<circle class="desistencia" cx="${f1(xy[0])}" cy="${f1(xy[1])}" r="8" fill="${vermelho ? 'var(--perigo)' : 'var(--ok)'}" stroke="var(--fundo)" stroke-width="2"><title>${esc(p.hora || '')} ${esc(nome)}</title></circle>`)
    // "↩ Peniche": a fuga, mais pequena e na cor de aviso (não se confunde com os portos da rota)
    if (nome && nome !== anterior) partes.push(rotulo(xy, `↩ ${nome}`, largura, 'var(--amarelo)', { classe: 'fuga', tamanho: 18 }))
    anterior = nome
  }
  // partida e destino (da selecionada)
  const rota = (a?.rota || []).filter(p => Array.isArray(p) && valido(p[0], p[1]))
  if (rota.length) {
    const ini = pr.xy(rota[0][0], rota[0][1])
    const fim = pr.xy(rota.at(-1)[0], rota.at(-1)[1])
    partes.push(marca('partida', ini, 'var(--ok)', 10), marca('destino', fim, 'var(--amarelo)', 10))
    if (partida) partes.push(rotulo(ini, partida, largura))
    if (destino) partes.push(rotulo(fim, destino, largura))
  }
  partes.push('</g>')
  // escala em MN, em baixo à esquerda da janela
  const mn = escalaMn(pr.pxPorMn, c.w)
  const comp = mn * pr.pxPorMn
  const x = c.x + 30
  const y = c.y + c.h - 30
  partes.push(`<g class="escala" stroke="var(--texto)" stroke-width="3"><path d="M${f1(x)} ${f1(y)}H${f1(x + comp)}M${f1(x)} ${f1(y - 8)}V${f1(y + 8)}M${f1(x + comp)} ${f1(y - 8)}V${f1(y + 8)}" fill="none"/><text x="${f1(x + comp / 2)}" y="${f1(y - 14)}" font-size="22" fill="var(--texto)" stroke="none" text-anchor="middle">${String(mn).replace('.', ',')} MN</text></g>`)
  return `<svg class="mapa${noite ? ' noite' : ''}" viewBox="0 0 ${largura} ${alt}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mini-mapa das alternativas">${partes.join('')}</svg>`
}
