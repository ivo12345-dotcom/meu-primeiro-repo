import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NIVEIS, PADRAO, nivelValido, mudarNivel, filtro } from '../public/lib/brilho.js'

const css = readFileSync(new URL('../public/estilo.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const regra = (seletor) => {
  const i = css.indexOf(`${seletor} {`)
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
}
// os tokens de um bloco: { nome: '#rrggbb' }
function tokens (bloco) {
  const out = {}
  for (const [, nome, hex] of bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\b/gi)) {
    out[nome] = hex.length === 4 ? `#${[...hex.slice(1)].map(x => x + x).join('')}` : hex.toLowerCase()
  }
  return out
}
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
// o tom (0–360) e a saturação (HSL)
function hsl (hex) {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2; const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { h: (h + 360) % 360, s, l }
}
const lin = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const luminancia = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const difTom = (a, b) => Math.abs(((b - a) % 360 + 540) % 360 - 180)
const dia = tokens(regra(':root'))
const noite = tokens(regra('body.noite'))

test('modo noite (decisão do Ivo de 01/10: substitui o vermelho de 29/09): as mesmas cores do dia, muito escurecidas — cada cor fica com o tom do dia e mais escura', () => {
  const cores = ['azul', 'amarelo', 'verde', 'ok', 'bb', 'eb', 'rosa', 'perigo', 'perigo-fundo', 'aviso-fundo', 'ativo', 'rt', 'rt-on', 'vel', 'vel-on', 'mar', 'segue', 'espera', 'naorec', 'volta']
  for (const k of cores) {
    assert.ok(dia[k] && noite[k], k)
    assert.ok(difTom(hsl(dia[k]).h, hsl(noite[k]).h) <= 20, `${k}: o tom do dia ${dia[k]} → ${noite[k]}`)
    assert.ok(luminancia(noite[k]) < luminancia(dia[k]), `${k}: mais escuro`)
  }
  // o texto é cinzento (nada de vermelho), mais escuro do que de dia
  for (const k of ['texto', 'texto-2', 'linha']) {
    assert.ok(hsl(noite[k]).s < 0.12, `${k} cinzento: ${noite[k]}`)
    assert.ok(luminancia(noite[k]) < luminancia(dia[k]), k)
  }
  // nenhuma cor do modo noite é o vermelho antigo: o azul é azul, o ok verde, o amarelo âmbar
  assert.ok(hsl(noite.azul).h >= 195 && hsl(noite.azul).h <= 230, noite.azul)
  assert.ok(hsl(noite.ok).h >= 70 && hsl(noite.ok).h <= 140, noite.ok)
  assert.ok(hsl(noite.amarelo).h >= 25 && hsl(noite.amarelo).h <= 50, noite.amarelo)
  assert.ok(hsl(noite.perigo).h <= 15 || hsl(noite.perigo).h >= 345, noite.perigo)
})

test('modo noite: fundo preto, sem áreas grandes claras (nem brancas nem azul-claras); o texto lê-se (no brilho máximo, contraste ≥ 7 o texto e ≥ 4,5 o secundário)', () => {
  assert.equal(noite.fundo, '#000000')
  for (const k of ['barra', 'tile', 'botao', 'mar', 'segue', 'espera', 'naorec', 'volta', 'ativo', 'perigo-fundo', 'aviso-fundo']) assert.ok(luminancia(noite[k]) < 0.03, `${k} escuro: ${noite[k]}`)
  assert.ok(contraste(noite.texto, noite.fundo) >= 7, noite.texto)
  assert.ok(contraste(noite['texto-2'], noite.fundo) >= 4.5, noite['texto-2'])
  assert.ok(contraste(noite['faixa-texto'], noite.volta) >= 4.5, 'o texto das faixas sobre o vermelho')
  // a zona branca da carta (no portátil) fica escura de noite
  assert.match(regra('body.noite .carta-demo'), /background:\s*var\(--tile\)/)
})

test('modo noite: o mini-mapa distingue as linhas (vela azul, motor cinzento), as zonas a evitar (vermelho), a terra e o mar', () => {
  // vela: var(--azul); motor: var(--texto-2) (lib/mapa.js)
  assert.ok(hsl(noite.azul).s > 0.3 && hsl(noite['texto-2']).s < 0.12, `${noite.azul} / ${noite['texto-2']}`)
  assert.ok(Math.hypot(...rgb(noite.azul).map((x, i) => x - rgb(noite['texto-2'])[i])) > 0.2, 'a vela e o motor diferentes')
  assert.ok(difTom(hsl(noite.perigo).h, hsl(noite.azul).h) > 90)
  assert.notEqual(noite.mar, noite.terra)
  assert.ok(hsl(noite.mar).h >= 190 && hsl(noite.mar).h <= 230, `o mar azulado: ${noite.mar}`)
  for (const bloco of [dia, noite]) { assert.ok(bloco.mar); assert.ok(bloco.terra) }
})

test('de noite o botão escolhido (vela atual, .acao.go) distingue-se: verde escuro com contorno no verde do ok; de dia fica igual', () => {
  const n = regra('body.noite .acao.go')
  assert.match(n, /outline:\s*2px solid var\(--ok\)/)
  assert.match(n, /background:\s*var\(--segue\)/)
  assert.doesNotMatch(n, /#ff5a3a/)
  assert.match(regra('.acao.go'), /background:\s*#0f6e56/, 'de dia fica igual')
})

test('as caixas das precauções têm pelo menos 44 px de altura (para o dedo, ao leme)', () => {
  assert.match(regra('.caixa'), /min-height:\s*44px/)
})

test('9: o Terminar dentro da caixa vermelha da rota mudada vê-se de dia e de noite (contorno; de noite, fundo preto e letra e contorno no cinzento do texto)', () => {
  assert.match(regra('.plano-pausado .acao.stop'), /outline:\s*2px solid #fff/)
  const n = regra('body.noite .plano-pausado .acao.stop')
  assert.match(n, /outline:\s*2px solid var\(--texto\)/)
  assert.match(n, /background:\s*#000/)
  assert.match(n, /color:\s*var\(--texto\)/)
})

test('nada do vermelho antigo do modo noite fica no estilo', () => {
  for (const velho of ['#ff5a3a', '#d42a1a', '#a0200f', '#200;']) assert.ok(!css.includes(velho), velho)
})

test('brilho de noite: 5 níveis (0,35 · 0,5 · 0,65 · 0,8 · 1), o 2 por omissão; − e + param nas pontas; um valor guardado estragado volta ao 2', () => {
  assert.deepEqual(NIVEIS, [0.35, 0.5, 0.65, 0.8, 1])
  assert.equal(PADRAO, 2)
  for (const [x, y] of [[1, 1], [5, 5], ['3', 3], [0, 2], [6, 2], [2.5, 2], [null, 2], [undefined, 2], ['x', 2]]) assert.equal(nivelValido(x), y, String(x))
  assert.equal(mudarNivel(2, -1), 1)
  assert.equal(mudarNivel(1, -1), 1)
  assert.equal(mudarNivel(4, +1), 5)
  assert.equal(mudarNivel(5, +1), 5)
  assert.equal(filtro(false, 1), 'none', 'de dia, nada')
  assert.equal(filtro(true, 1), 'brightness(0.35)')
  assert.equal(filtro(true, 5), 'brightness(1)')
})

test('brilho de noite no estilo: cada nível escurece a página toda (#app) só de noite; os botões − e + ao lado do Noite, com 44 px para o dedo, só de noite', () => {
  NIVEIS.forEach((x, i) => assert.match(regra(`body.noite[data-brilho="${i + 1}"] #app`), new RegExp(`filter:\\s*brightness\\(${x}\\)`)))
  assert.match(regra('#botoes button.brilho'), /min-width:\s*44px/)
  assert.match(regra('#botoes button.brilho'), /min-height:\s*44px/)
  assert.match(regra('.brilho'), /display:\s*none/)
  assert.match(regra('body.noite .brilho'), /display:\s*block/)
  // ao lado do Noite, no index.html
  const i = html.indexOf('id="b-noite"')
  assert.ok(i > 0)
  assert.match(html.slice(i - 200, i + 300), /data-acao="brilho-menos"[^>]*>−</)
  assert.match(html.slice(i - 200, i + 300), /data-acao="brilho-mais"[^>]*>\+</)
})
