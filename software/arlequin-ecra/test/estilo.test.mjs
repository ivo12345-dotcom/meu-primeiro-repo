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
  // (revisão F3, Minor 11: a etiqueta --texto-2 de noite lê-se ≥ 3:1 no brilho 2, o que pede mais luminância do que
  // a etiqueta do dia tem; fica abaixo do texto do dia — e abaixo do texto de noite, ver o teste do Minor 11)
  for (const k of ['texto', 'texto-2', 'linha']) {
    assert.ok(hsl(noite[k]).s < 0.12, `${k} cinzento: ${noite[k]}`)
    assert.ok(luminancia(noite[k]) < luminancia(dia[k === 'texto-2' ? 'texto' : k]), k)
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

// ---------- auditoria I-26: alvos de toque ≥ 44 px também no LAFVIN 7" (1024×600) da roda ----------
// o tamanho em px de uma propriedade de uma regra (só px: o rem encolhe com o ecrã)
const px = (seletor, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}:\\s*([\\d.]+)px`).exec(regra(seletor))
  return m ? Number(m[1]) : null
}

test('auditoria I-26: a letra de base tem um mínimo de 14 px (a 600 px de altura o rem dava 12 px e os botões ~34 px)', () => {
  const m = /^html\s*\{\s*font-size:\s*max\((\d+)px,\s*([\d.]+)vh\);/m.exec(css)
  assert.ok(m, 'html { font-size: max(14px, 2vh); }')
  const rem = (altura) => Math.max(Number(m[1]), Number(m[2]) * altura / 100)
  assert.equal(rem(600), 14, 'LAFVIN 7" (1024×600)')
  assert.equal(rem(800), 16, '10" (1280×800), como antes')
})

test('auditoria I-26: cada alvo de toque tem 44 px no mínimo (em px, não encolhe): botões, linhas das tabelas tocáveis, campos, chip do alarme, silenciar, brilho, precauções e cartões', () => {
  for (const [seletor, prop, minimo] of [
    ['button, .btn', 'min-height', 44],
    ['button, .btn', 'min-width', 44],
    ['input[type=text]', 'min-height', 44],
    ['tr[data-acao] > td, tr[data-mmsi] > td', 'height', 44],
    ['.chip[data-acao]', 'min-height', 44],
    ['.silenciar', 'min-height', 44],
    ['.silenciar', 'min-width', 44],
    ['#botoes button.brilho', 'min-height', 44],
    ['#botoes button.brilho', 'min-width', 44],
    ['.caixa', 'min-height', 44],
    ['.cartao', 'min-height', 44]
  ]) assert.ok(px(seletor, prop) >= minimo, `${seletor} { ${prop} } = ${px(seletor, prop)}`)
  // a barra de cima tem sempre a altura do chip de 44 px (o desenho não salta quando chega um alarme)
  assert.match(regra('#barra'), /min-height:\s*calc\(44px \+ \.7rem\)/)
  // nenhuma regra põe um alvo de toque mais baixo do que 44 px
  for (const [, sel, corpo] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/button|\.btn|\.acao|input|\.chip|\.silenciar|\.caixa|\.cartao/.test(sel)) continue
    for (const [, prop, v] of corpo.matchAll(/\b((?:max-|min-)?height):\s*([\d.]+)px/g)) {
      if (prop !== 'max-height' && Number(v) < 44) assert.fail(`${sel.trim()} { ${prop}: ${v}px }`)
      if (prop === 'max-height') assert.fail(`${sel.trim()} { max-height }`)
    }
  }
})

test('revisão F3, Important 1: a barra de cima nunca empurra o alarme nem o botão de calar para fora do ecrã — os chips encolhem com reticências, os de informação primeiro, o alarme fica com largura para se ler e o botão de calar, o nome e a hora não encolhem', () => {
  // cada chip pode encolher (sem o min-width: 0 um flex item não fica mais estreito do que o texto) e corta com "…"
  const chip = regra('.chip')
  for (const r of [/min-width:\s*0/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(chip, r, `.chip ${r}`)
  // o chip que se toca não pode ser flex: num flex o texto vira um item anónimo e as reticências não aparecem
  assert.doesNotMatch(regra('.chip[data-acao]'), /display:\s*(inline-)?flex/)
  assert.match(regra('.chip[data-acao]'), /line-height:\s*calc\(44px - \.3rem\)/, 'o texto ao meio dos 44 px')
  // o alarme: largura mínima (o começo lê-se sempre) e encolhe pouco
  assert.match(regra('.chip[data-acao="ir-alarme"]'), /min-width:\s*7rem/)
  // os de informação (GPS, Mesh, 4G, barómetro, piloto) encolhem primeiro
  const info = /flex-shrink:\s*(\d+)/.exec(regra('.chip.info'))
  assert.ok(info && Number(info[1]) >= 4, '.chip.info { flex-shrink ≥ 4 }')
  // o botão de calar, o nome e a hora nunca encolhem
  assert.match(regra('.silenciar'), /flex:\s*0 0 auto/)
  assert.match(regra('.nome'), /flex:\s*0 0 auto/)
  assert.match(regra('.hora'), /flex:\s*0 0 auto/)
  // a barra não parte (com duas linhas a página perdia altura a 1024×600), a não ser ao alto
  assert.doesNotMatch(regra('#barra'), /flex-wrap:\s*wrap/)
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

test('revisão final M5: no brilho por omissão (nível 2) o texto lê-se (≥ 3:1) e as linhas do mini-mapa (vela e motor) destacam-se do mar (≥ 1,5:1); o chip de alarme tem contorno no vermelho de perigo (o de aviso não)', () => {
  const k = NIVEIS[PADRAO - 1]
  // o filter: brightness(k) multiplica cada componente
  const escurecer = (hex) => `#${rgb(hex).map(x => Math.round(x * k * 255).toString(16).padStart(2, '0')).join('')}`
  assert.ok(contraste(escurecer(noite.texto), escurecer(noite.fundo)) >= 3, 'o texto no nível 2')
  // auditoria I-27 e M-46: quase todo o texto está sobre o mosaico (--tile), não sobre o fundo preto
  assert.ok(contraste(escurecer(noite.texto), escurecer(noite.tile)) >= 3, `o texto sobre o mosaico no nível 2: ${contraste(escurecer(noite.texto), escurecer(noite.tile)).toFixed(2)}`)
  for (const linha of ['azul', 'texto-2']) {
    assert.ok(contraste(escurecer(noite[linha]), escurecer(noite.mar)) >= 1.5, `${linha} sobre o mar no nível 2`)
    assert.ok(contraste(escurecer(noite[linha]), escurecer(noite.fundo)) >= 1.5, `${linha} sobre o fundo no nível 2`)
  }
  assert.match(regra('body.noite .chip.alarme'), /outline:\s*2px solid var\(--perigo\)/)
  assert.match(regra('body.noite .chip.alarme'), /outline-offset:\s*-2px/)
  assert.doesNotMatch(regra('body.noite .chip.aviso'), /outline/)
})

test('auditoria I-27 (decisão do Ivo n.º 21): de noite, a correção do leme (◀ 12° BB / 8° EB ▶) lê-se no brilho por omissão — ≥ 3:1 sobre o mosaico, com o tom do dia; de dia fica igual', () => {
  const k = NIVEIS[PADRAO - 1]
  const escurecer = (hex) => `#${rgb(hex).map(x => Math.round(x * k * 255).toString(16).padStart(2, '0')).join('')}`
  assert.match(regra('.bb-txt'), /color:\s*var\(--bb-txt\)/)
  assert.match(css, /\.eb-txt \{ color: var\(--eb-txt\); \}/)
  for (const [txt, cor] of [['bb-txt', 'bb'], ['eb-txt', 'eb']]) {
    assert.equal(dia[txt], dia[cor], `${txt} de dia = --${cor}`)
    const c = contraste(escurecer(noite[txt]), escurecer(noite.tile))
    assert.ok(c >= 3, `${txt} de noite no nível 2 sobre o mosaico: ${c.toFixed(2)}`)
    assert.ok(difTom(hsl(noite[txt]).h, hsl(dia[cor]).h) <= 10, `${txt}: o tom do dia (${noite[txt]})`)
  }
  // o vermelho e o verde continuam a distinguir-se (BB vermelho, EB verde)
  assert.ok(difTom(hsl(noite['bb-txt']).h, hsl(noite['eb-txt']).h) > 90)
})

// ---------- revisão F3, Minor 11: o resto do texto de noite ----------
// Como o I-27, medido no brilho por omissão (nível 2: o filter: brightness(0.5) multiplica cada componente sRGB) sobre
// o fundo verdadeiro de cada texto: o mosaico (--tile), o cartão e o botão (--botao), a linha escolhida da AIS e o botão
// da página aberta (--ativo), os botões coloridos (--rt, --vel e os seus "on", --segue, --perigo-fundo).
// Antes (tokens do I-27): .perigo 1,94 e .atencao 2,27 sobre o mosaico (1,77 e 2,06 na linha escolhida da AIS), .lab
// 1,99 (1,93 no cartão escolhido, 1,87 na linha escolhida), o texto dos botões 2,95 sobre --botao e 2,26–2,84 sobre os
// coloridos. Cada cor mantém o tom e fica só o claro que o contraste pede (cerca de 3,1–3,4:1, não 6–7 como de dia):
// para o texto de perigo e de atenção há tokens de texto à parte (--perigo-txt, --amarelo-txt, como os --bb-txt do
// I-27), porque o --perigo e o --amarelo servem também de contorno, mapa e mostradores e esses ficam como estavam.
test('revisão F3 (Minor 11): de noite, no brilho por omissão (nível 2), o texto de perigo, o de atenção, as etiquetas e o texto dos botões leem-se (≥ 3:1) sobre o fundo verdadeiro de cada um, e ficam ténues (≤ 4,5:1 sobre o mosaico, luminância à vista ≤ 0,2)', () => {
  const k = NIVEIS[PADRAO - 1]
  const escurecer = (hex) => `#${rgb(hex).map(x => Math.round(x * k * 255).toString(16).padStart(2, '0')).join('')}`
  const razao = (texto, fundo) => Math.round(contraste(escurecer(noite[texto]), escurecer(noite[fundo])) * 100) / 100
  const PARES = [
    ['perigo-txt', ['tile', 'ativo']], // .perigo: alarmes do Motor, erros, avisos vermelhos; a linha escolhida da AIS
    ['amarelo-txt', ['tile', 'ativo']], // .atencao e .amarelo: avisos, a pergunta do Enchi; o nome ARLEQUIN
    ['texto-2', ['tile', 'botao', 'ativo']], // .lab e th: o mosaico, o cartão escolhido, a linha escolhida da AIS
    ['texto', ['botao', 'ativo', 'rt', 'rt-on', 'vel', 'vel-on', 'segue', 'perigo-fundo']] // o texto de todos os botões
  ]
  const medido = {}
  for (const [texto, fundos] of PARES) for (const f of fundos) medido[`${texto} / ${f}`] = razao(texto, f)
  assert.deepEqual(medido, {
    'perigo-txt / tile': 3.38, 'perigo-txt / ativo': 3.08,
    'amarelo-txt / tile': 3.38, 'amarelo-txt / ativo': 3.08,
    'texto-2 / tile': 3.33, 'texto-2 / botao': 3.24, 'texto-2 / ativo': 3.03,
    'texto / botao': 3.7, 'texto / ativo': 3.47, 'texto / rt': 3.56, 'texto / rt-on': 3.23, 'texto / vel': 3.53, 'texto / vel-on': 3.06, 'texto / segue': 3.44, 'texto / perigo-fundo': 3.44
  })
  for (const [par, r] of Object.entries(medido)) assert.ok(r >= 3, `${par}: ${r}:1`)
  // ténues: nada passa de 4,5:1 sobre o mosaico nem de 0,2 de luminância à vista (o texto do dia chega a 0,8)
  for (const t of ['perigo-txt', 'amarelo-txt', 'texto-2', 'texto']) {
    assert.ok(razao(t, 'tile') <= 4.5, `${t} sobre o mosaico: ${razao(t, 'tile')}:1`)
    assert.ok(luminancia(escurecer(noite[t])) <= 0.2, `${t}: luminância à vista ${luminancia(escurecer(noite[t])).toFixed(3)}`)
  }
  // a etiqueta não é mais clara do que o texto
  assert.ok(luminancia(noite['texto-2']) < luminancia(noite.texto))
  // o mesmo tom do dia; de dia os tokens de texto são os próprios --perigo e --amarelo
  assert.equal(dia['perigo-txt'], dia.perigo)
  assert.equal(dia['amarelo-txt'], dia.amarelo)
  for (const [txt, base] of [['perigo-txt', 'perigo'], ['amarelo-txt', 'amarelo']]) assert.ok(difTom(hsl(noite[txt]).h, hsl(dia[base]).h) <= 10, `${txt}: o tom do dia (${noite[txt]})`)
  assert.ok(hsl(noite['texto-2']).s < 0.12 && hsl(noite.texto).s < 0.12, 'o texto e a etiqueta continuam cinzentos')
  // o estilo usa-os
  assert.match(regra('.perigo'), /color:\s*var\(--perigo-txt\)/)
  assert.match(regra('.atencao'), /color:\s*var\(--amarelo-txt\)/)
  assert.match(regra('.amarelo'), /color:\s*var\(--amarelo-txt\)/)
  assert.match(regra('.nome'), /color:\s*var\(--amarelo-txt\)/)
  assert.match(regra('.lab'), /color:\s*var\(--texto-2\)/)
  assert.match(regra('body.noite button, body.noite .btn'), /color:\s*var\(--texto\)/)
  // o que não é texto ficou como estava (o contorno do alarme e as zonas do mapa)
  assert.equal(noite.perigo, '#b86c6c')
  assert.equal(noite.amarelo, '#b08f54')
})

test('revisão final M6: um <script> clássico logo a seguir ao <body> põe o modo noite e o brilho (localStorage ou ?noite=/?brilho=) antes do primeiro desenho; um armazenamento que falha não rebenta', async () => {
  const { runInNewContext } = await import('node:vm')
  const m = /<body>\s*<script>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(m, 'o script logo a seguir ao <body>')
  assert.ok(html.indexOf(m[0]) < html.indexOf('<div id="app">'))
  const correr = ({ guardado = {}, busca = '', falha = false }) => {
    const classes = new Set()
    const body = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, dataset: {} }
    const localStorage = { getItem: (k) => { if (falha) throw new Error('bloqueado'); return k in guardado ? guardado[k] : null } }
    runInNewContext(m[1], { document: { body }, localStorage, location: { search: busca }, URLSearchParams, JSON, Number, String })
    return { noite: classes.has('noite'), brilho: body.dataset.brilho }
  }
  assert.deepEqual(correr({ guardado: { 'arlequin.noite': 'true', 'arlequin.brilho': '4' } }), { noite: true, brilho: '4' })
  assert.deepEqual(correr({ guardado: { 'arlequin.noite': 'false' } }), { noite: false, brilho: '2' })
  assert.deepEqual(correr({ guardado: { 'arlequin.noite': 'false', 'arlequin.brilho': '9' }, busca: '?noite=1&brilho=1' }), { noite: true, brilho: '1' })
  assert.deepEqual(correr({ busca: '?noite=0' }), { noite: false, brilho: '2' })
  assert.deepEqual(correr({ falha: true }), { noite: false, brilho: '2' })
  assert.deepEqual(correr({ guardado: { 'arlequin.noite': '{estragado', 'arlequin.brilho': '"x"' } }), { noite: false, brilho: '2' })
})
