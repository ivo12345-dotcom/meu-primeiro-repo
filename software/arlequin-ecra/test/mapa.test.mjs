// O mini-mapa da página "Melhor rota" (desenho 3b-1): SVG em funções puras.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { projecao, desenharMapa, escalaMn } from '../public/lib/mapa.js'

const ler = (nome) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/resultado-${nome}.json.gz`, import.meta.url))))
const FUGA = ler('fuga') // Algés → Peniche, com fugas na desistência
const CANAL = ler('canal')
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const desenhar = (r, o = {}) => desenharMapa({ mapa: r.mapa, alternativas: r.alternativas, desistencia: r.desistencia, partida: r.partida.nome, destino: r.destino.nome, agora: AGORA, ...o })
const proibido = /NaN|undefined|null|Infinity/

test('projeção equirretangular com cos(latitude média): valores conhecidos', () => {
  const p = projecao({ latMin: 38, latMax: 39, lonMin: -10, lonMax: -9 }, 1000, 1000)
  // o centro da janela fica no centro da caixa; a longitude encolhe por cos(38,5°)
  assert.deepEqual(p.xy(38.5, -9.5).map(v => Math.round(v * 10) / 10), [500, 500])
  const k = Math.cos(38.5 * Math.PI / 180)
  assert.ok(Math.abs(p.xy(39, -10)[0] - (500 - 500 * k)) < 1e-6)
  assert.equal(p.xy(39, -10)[1], 0)
  assert.equal(p.xy(38, -10)[1], 1000)
  assert.ok(Math.abs(p.pxPorMn - 1000 / 60) < 1e-9)
  // uma janela larga enche a largura
  const q = projecao({ latMin: 38, latMax: 38.1, lonMin: -10, lonMax: -9 }, 1000, 700)
  assert.ok(Math.abs(q.xy(38.05, -10)[0]) < 1e-9 && Math.abs(q.xy(38.05, -9)[0] - 1000) < 1e-9)
})

test('a escala em MN: um número redondo com no máximo um quarto da largura', () => {
  assert.equal(escalaMn(1000 / 60, 1000), 10) // 1 MN = 16,7 px → 10 MN = 167 px
  assert.equal(escalaMn(1000 / 6, 1000), 1)
  assert.equal(escalaMn(5, 1000), 50)
})

test('o SVG: terra a cheio, zonas a tracejado, a destacada grossa, o rasto vela/motor/noite, desistência, partida, destino e escala', () => {
  const svg = desenhar(FUGA, { selecionada: 1 })
  assert.match(svg, /^<svg [^>]*viewBox="0 0 1000 \d+(\.\d+)?"/)
  assert.doesNotMatch(svg, proibido)
  // terra: um path com um anel por M…Z
  const terra = svg.match(/<path class="terra" d="([^"]+)"/)
  assert.ok(terra)
  assert.equal((terra[1].match(/M/g) || []).length, FUGA.mapa.terra.length)
  assert.match(svg, /<path class="terra"[^>]*fill="var\(--terra\)"/)
  // zonas
  assert.equal((svg.match(/<polygon class="zona"/g) || []).length, FUGA.mapa.zonas.length)
  assert.match(svg, /class="zona"[^>]*stroke="var\(--perigo\)"[^>]*stroke-dasharray/)
  // uma alternativa por grupo; a selecionada por último e mais grossa
  const grupos = [...svg.matchAll(/<g class="alt( sel)?" data-i="(\d)" stroke-width="([\d.]+)"[^>]*>/g)]
  assert.deepEqual(grupos.map(g => g[2]), ['0', '2', '1'])
  assert.equal(grupos.at(-1)[1], ' sel')
  assert.ok(Number(grupos.at(-1)[3]) > Number(grupos[0][3]))
  // o rasto da selecionada (vela e motor, de noite e de dia): uma polilinha por troço, todas com pontos
  const sel = svg.slice(svg.indexOf('<g class="alt sel"'), svg.indexOf('</g>', svg.indexOf('<g class="alt sel"')))
  const linhas = [...sel.matchAll(/<polyline class="rasto (vela|motor)( noite)?" points="([^"]+)"/g)]
  assert.ok(linhas.some(l => l[1] === 'vela') && linhas.some(l => l[1] === 'motor'), sel.slice(0, 400))
  assert.ok(linhas.some(l => l[2]) && linhas.some(l => !l[2]))
  const total = linhas.reduce((s, l) => s + l[3].trim().split(' ').length, 0)
  assert.ok(total >= FUGA.alternativas[1].rasto.length, `${total}`)
  assert.match(svg, /class="rasto vela[^"]*"[^>]*stroke="var\(--azul\)"/)
  assert.match(svg, /class="rasto motor[^"]*"[^>]*stroke="var\(--texto-2\)"/)
  assert.match(svg, /class="rasto [a-z]+ noite"[^>]*stroke-opacity="0.5"/)
  // desistência: bolinhas com o nome do abrigo, "↩ Cascais" (a fuga, não um porto da rota)
  assert.equal((svg.match(/<circle class="desistencia"/g) || []).length, FUGA.desistencia.length)
  assert.match(svg, />↩ Cascais</)
  assert.doesNotMatch(svg, />Cascais</)
  // partida e destino, escala
  assert.match(svg, /class="marca partida"/)
  assert.match(svg, /class="marca destino"/)
  assert.match(svg, />Algés \(CNA\)</)
  assert.match(svg, />Peniche</)
  assert.match(svg, />\d+ MN</)
})

test('as marcas dos avisos da selecionada, no rasto à hora do aviso', () => {
  const svg = desenhar(FUGA, { selecionada: 0 })
  const n = FUGA.alternativas[0].avisos.length
  assert.equal((svg.match(/<path class="aviso"/g) || []).length, n)
  assert.match(svg, /<title>21:00 Chuva/)
})

test('de noite: a classe "noite" (as cores vêm dos tokens do estilo.css); os mesmos elementos', () => {
  const dia = desenhar(CANAL)
  const noite = desenhar(CANAL, { noite: true })
  assert.match(noite, /^<svg class="mapa noite"/)
  assert.match(dia, /^<svg class="mapa"/)
  assert.equal(noite.replace(' noite"', '"').length, dia.length)
  assert.doesNotMatch(noite, /#[0-9a-f]{3,6}\b/i, 'sem cores fixas: só var(--…)')
})

test('nunca NaN: pontos inválidos saltam-se, sem mapa ou sem rasto não rebenta', () => {
  const mapa = { janela: { latMin: 38, latMax: 39, lonMin: -10, lonMax: -9 }, terra: [[[38.2, -9.2], [null, -9.1], [38.3, -9.3]]], zonas: [] }
  const alternativas = [{ rota: [[38.5, -9.5], [NaN, 1], [38.6, -9.4]], rasto: [], avisos: [{ t: 'x', texto: 'a' }] }, { rota: [] }]
  const svg = desenharMapa({ mapa, alternativas, selecionada: 0, desistencia: [{ lat: null, lon: 1, abrigo: null }] })
  assert.doesNotMatch(svg, proibido)
  assert.match(svg, /<polyline class="rota"/)
  assert.equal(desenharMapa({ mapa: null, alternativas }), '')
})

test('tudo cortado à janela (o mar só nela; as zonas grandes não saem); o nome do abrigo só quando muda', () => {
  const svg = desenhar(FUGA, { selecionada: 0 })
  assert.match(svg, /<clipPath id="mapa-janela"><rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+"\/><\/clipPath>/)
  const corte = svg.indexOf('<g clip-path="url(#mapa-janela)">')
  assert.ok(corte > 0 && svg.indexOf('<path class="terra"') > corte && svg.indexOf('<polygon class="zona"') > corte)
  // as bolinhas todas, mas o rótulo só quando o abrigo muda de um ponto para o seguinte
  const nomes = FUGA.desistencia.map(p => p.abrigo?.nome || p.voltar?.nome)
  const mudancas = nomes.filter((n, i) => n && n !== nomes[i - 1]).length
  const rotulos = [...svg.matchAll(/<circle class="desistencia"[^]*?<\/circle>(<text[^>]*>([^<]+)<\/text>)?/g)].filter(m => m[1]).length
  assert.equal(rotulos, mudancas)
  assert.ok(mudancas < FUGA.desistencia.length)
})

test('as etiquetas das fugas: "↩ " antes do nome, mais pequenas do que as da partida e do destino e na cor de aviso', () => {
  const svg = desenhar(FUGA, { selecionada: 0 })
  const fugas = [...svg.matchAll(/<text class="fuga"[^>]*font-size="(\d+)"[^>]*fill="([^"]+)"[^>]*>([^<]+)<\/text>/g)]
  assert.ok(fugas.length >= 1, svg.slice(0, 200))
  for (const [, tam, cor, texto] of fugas) {
    assert.match(texto, /^↩ \S/)
    assert.ok(Number(tam) < 22, tam)
    assert.equal(cor, 'var(--amarelo)')
  }
  // a partida e o destino continuam sem a seta, no tamanho normal
  assert.match(svg, /font-size="22"[^>]*>Algés \(CNA\)</)
  assert.match(svg, /font-size="22"[^>]*>Peniche</)
})

test('a bolinha da desistência só é verde com uma fuga limpa: sem abrigo e com a volta só junto à costa (aviso vermelho) é vermelha (revisão final, 7)', () => {
  const mapa = { janela: { latMin: 38, latMax: 39.5, lonMin: -10, lonMax: -9 }, terra: [], zonas: [] }
  const alternativas = [{ rota: [[38.5, -9.5], [38.6, -9.4]], rasto: [] }]
  const fuga = (o = {}) => ({ nome: 'Peniche', milhas: 5, vento: 'a favor', avisoVermelho: null, ...o })
  const VERMELHO = 'fuga junto à costa com vento do mar (a sotavento) — só em último recurso'
  const cor = (p) => desenharMapa({ mapa, alternativas, selecionada: 0, desistencia: [{ lat: 38.6, lon: -9.4, hora: '10:00', ...p }] }).match(/<circle class="desistencia"[^>]*fill="([^"]+)"/)[1]
  assert.equal(cor({ abrigo: null, voltar: fuga({ avisoVermelho: VERMELHO }) }), 'var(--perigo)')
  assert.equal(cor({ abrigo: fuga({ avisoVermelho: VERMELHO }), voltar: fuga({ avisoVermelho: VERMELHO }) }), 'var(--perigo)')
  assert.equal(cor({ abrigo: null, voltar: null }), 'var(--perigo)')
  assert.equal(cor({ abrigo: fuga({ avisoVermelho: VERMELHO }), voltar: null }), 'var(--perigo)')
  // uma fuga limpa (abrigo ou volta): verde
  assert.equal(cor({ abrigo: null, voltar: fuga() }), 'var(--ok)')
  assert.equal(cor({ abrigo: fuga(), voltar: fuga({ avisoVermelho: VERMELHO }) }), 'var(--ok)')
  assert.equal(cor({ abrigo: fuga({ avisoVermelho: VERMELHO }), voltar: fuga() }), 'var(--ok)')
})

test('revisão final M5: o rasto a motor é tracejado (de noite a vela e o motor têm quase a mesma luminância: o traço distingue-os); a vela é cheia; a legenda diz "cinzento tracejado: a motor"', async () => {
  for (const noite of [false, true]) {
    const svg = desenhar(FUGA, { selecionada: 0, noite })
    assert.match(svg, /<polyline class="rasto motor[^"]*"[^>]*stroke-dasharray="6 6"/)
    assert.doesNotMatch(svg, /<polyline class="rasto vela[^"]*"[^>]*stroke-dasharray/)
  }
  const pag = readFileSync(new URL('../public/paginas/melhor/mapa.js', import.meta.url), 'utf8')
  assert.match(pag, /cinzento tracejado: a motor/)
})
