// O verificar-ecra (npm run verificar-ecra): desenha cada página e estado do ecrã num Chromium sem cabeça a 1024×600 e
// confirma que nenhum elemento tocável fica fora do ecrã (revisão F3, Minor 13: o teste dos 44 px confirmava tamanhos,
// não se o alvo estava à vista). O Chromium não corre no npm test; aqui só o que não precisa dele: o que conta como
// problema (problemas.mjs, função pura), os estados que se desenham (estados.mjs) e a forma como se corre.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { problemas, CHIP_ALARME_MIN } from '../verificar-ecra/problemas.mjs'
import { estados } from '../verificar-ecra/estados.mjs'

const caixa = (l, t, w, h) => ({ l, t, r: l + w, b: t + h, w, h })
// um alvo de toque como o recolher.mjs o mede: a caixa e a parte que se vê (cortada pelos pais, pelo ecrã e pelos botões de baixo)
const alvo = (o = {}) => ({ zona: 'pagina', tag: 'button', acao: 'ativar', texto: 'Ativar esta rota', caixa: caixa(100, 100, 145, 44), vis: { w: 145, h: 44 }, lista: null, ...o })
const dados = (o = {}) => ({ vw: 1024, vh: 600, alvos: [], rolar: [], conteudo: [], filhosBarra: [], rolagem: [], ...o })
const tipos = (d) => problemas(d).map(p => p.tipo)

test('verificar-ecra: um alvo todo à vista, ou cortado por menos de 1 px (arredondamentos), não é problema', () => {
  assert.deepEqual(problemas(dados({ alvos: [alvo()] })), [])
  assert.deepEqual(problemas(dados({ alvos: [alvo({ vis: { w: 145, h: 43 } })] })), [])
  assert.deepEqual(problemas(dados()), [])
  assert.deepEqual(problemas({}), [], 'sem medidas não rebenta')
})

test('verificar-ecra: um alvo cortado (pelos botões de baixo, pelo ecrã ou por um pai) é um problema com o nome e as medidas', () => {
  // o "Ativar esta rota" do Resultado antes do Important 2: y 593–637, à vista 0 (por baixo da dobra)
  const p = problemas(dados({ alvos: [alvo({ caixa: caixa(300, 593, 145, 44), vis: { w: 145, h: 0 } })] }))
  assert.equal(p.length, 1)
  assert.equal(p[0].tipo, 'alvo cortado')
  assert.match(p[0].alvo, /button\[ativar\] "Ativar esta rota"/)
  assert.match(p[0].detalhe, /145×44.*à vista 145×0/)
  // o botão de calar fora do ecrã pela direita (a barra de antes do Important 1: x 1045–1126)
  assert.deepEqual(tipos(dados({ alvos: [alvo({ zona: 'barra', acao: 'silenciar', texto: 'silenciar', caixa: caixa(1045, 5, 81, 44), vis: { w: 0, h: 44 } })] })), ['alvo cortado'])
  // cortado só um pouco (metade da altura) também conta
  assert.deepEqual(tipos(dados({ alvos: [alvo({ vis: { w: 145, h: 22 } })] })), ['alvo cortado'])
})

test('verificar-ecra: um alvo numa lista que rola não conta como cortado (chega-se lá a rolar), mas a lista tem de estar toda à vista e o alvo não pode sair para os lados', () => {
  const lista = (vis) => ({ nome: 'ais-alvos', caixa: caixa(10, 60, 1000, 288), vis })
  const emLista = (o = {}) => alvo({ tag: 'tr', acao: 'sel', texto: 'ALVO 11', caixa: caixa(10, 700, 1000, 44), vis: { w: 1000, h: 0 }, lista: lista({ w: 1000, h: 288 }), ...o })
  assert.deepEqual(problemas(dados({ alvos: [emLista()] })), [], 'uma linha lá em baixo da lista: rola-se')
  // a lista cortada pelos botões de baixo: a parte de baixo dela nunca aparece
  const cortada = problemas(dados({ alvos: [emLista({ lista: lista({ w: 1000, h: 200 }) })] }))
  assert.deepEqual(cortada.map(x => x.tipo), ['lista cortada'])
  assert.match(cortada[0].alvo, /ais-alvos/)
  // o alvo a sair da lista pelos lados
  assert.deepEqual(tipos(dados({ alvos: [emLista({ caixa: caixa(10, 100, 1200, 44), vis: { w: 1000, h: 44 } })] })), ['alvo cortado de lado'])
})

test('verificar-ecra: cada lista que rola tem de ter data-rolar (sem ele o desenho de 1 Hz põe-na no cimo a cada segundo); uma que não rola não precisa', () => {
  const lista = (o) => ({ nome: '.tile.rolar', chave: null, caixa: caixa(10, 60, 500, 300), vis: { w: 500, h: 300 }, clientH: 300, scrollH: 724, ...o })
  const p = problemas(dados({ rolar: [lista()] }))
  assert.deepEqual(p.map(x => x.tipo), ['lista sem data-rolar'])
  assert.match(p[0].detalhe, /724 px para 300 à vista/)
  assert.deepEqual(problemas(dados({ rolar: [lista({ chave: 'pedir-destinos' })] })), [])
  assert.deepEqual(problemas(dados({ rolar: [lista({ scrollH: 300 })] })), [], 'cabe: não rola')
  assert.deepEqual(problemas(dados({ rolar: [lista({ scrollH: 301 })] })), [], 'mais 1 px: arredondamento')
})

test('verificar-ecra: a barra de cima não pode ter nada fora do ecrã, e o chip do alarme tem de ter largura para se ler o começo', () => {
  const filho = (nome, texto, l, w) => ({ nome, texto, caixa: caixa(l, 5, w, 44) })
  assert.deepEqual(problemas(dados({ filhosBarra: [filho('.nome', 'ARLEQUIN', 10, 90), filho('.silenciar', 'silenciar', 600, 81), filho('.chip.piloto', 'Piloto: standby', 900, 100)] })), [])
  const fora = problemas(dados({ filhosBarra: [filho('.silenciar', 'silenciar', 1045, 81)] }))
  assert.deepEqual(fora.map(x => x.tipo), ['barra fora do ecrã'])
  assert.match(fora[0].detalhe, /x 1045–1126 \(ecrã 1024\)/)
  assert.deepEqual(tipos(dados({ filhosBarra: [filho('.chip', 'à esquerda', -20, 90)] })), ['barra fora do ecrã'])
  // o chip do alarme espremido pelos outros: 96 px (o começo da mensagem, "⚠ Água no por…") é o mínimo
  assert.equal(CHIP_ALARME_MIN, 96)
  assert.deepEqual(tipos(dados({ filhosBarra: [filho('span[ir-alarme]', '⚠ Água no porão!', 300, 95)] })), ['chip do alarme estreito'])
  assert.deepEqual(tipos(dados({ filhosBarra: [filho('span[ir-alarme]', '⚠ Água no porão!', 300, 96)] })), [])
  // só o chip do alarme (com o ⚠): um chip de informação estreito não conta
  assert.deepEqual(tipos(dados({ filhosBarra: [filho('.chip.info', 'GPS', 300, 20)] })), [])
})

test('verificar-ecra: depois de refazer a página como o app.js, cada lista que rola tem de ficar onde estava; um conteúdo cortado só conta uma vez (o mosaico, não as linhas dele)', () => {
  assert.deepEqual(problemas(dados({ rolagem: [{ chave: 'ais-alvos', antes: 150, depois: 150 }] })), [])
  assert.deepEqual(problemas(dados({ rolagem: [{ chave: 'ais-alvos', antes: 150, depois: 149.5 }] })), [], 'menos de 1 px')
  const p = problemas(dados({ rolagem: [{ chave: 'resultado-dir', antes: 150, depois: 0 }, { chave: 'x', antes: 10, depois: undefined }] }))
  assert.deepEqual(p.map(x => x.tipo), ['rolagem perdida', 'rolagem perdida'])
  assert.match(p[0].detalhe, /150 antes de refazer, 0 depois/)
  const tile = { nome: '.tile', texto: 'Alarmes do motor', caixa: caixa(10, 487, 506, 122), vis: { w: 506, h: 61 } }
  const linha = { nome: '.alarme-linha', texto: 'Possível fuga', caixa: caixa(20, 572, 490, 16), vis: { w: 490, h: 0 } }
  const c = problemas(dados({ conteudo: [tile, linha] }))
  assert.deepEqual(c.map(x => x.tipo), ['conteúdo cortado'])
  assert.match(c[0].alvo, /\.tile/)
  assert.deepEqual(tipos(dados({ conteudo: [linha] })), ['conteúdo cortado'], 'a linha sozinha conta')
})

test('verificar-ecra: os estados desenham-se (com os módulos e o estilo verdadeiros) e cobrem as 8 páginas, a barra, de dia e de noite', () => {
  const lista = estados()
  assert.ok(lista.length >= 50, `${lista.length} estados`)
  const nomes = lista.map(e => e.nome)
  assert.equal(new Set(nomes).size, nomes.length, 'nomes repetidos')
  for (const e of lista) {
    assert.ok(typeof e.barra === 'string' && e.barra.includes('ARLEQUIN'), `${e.nome}: a barra`)
    assert.ok(typeof e.pagina === 'string' && e.pagina.length > 50, `${e.nome}: a página`)
    assert.doesNotMatch(`${e.barra}${e.pagina}`.replace(/<[^>]+>/g, ' '), /undefined|NaN|\[object Object\]/, `${e.nome}: texto em falta`)
  }
  // cada página (carta, instr, ais, motor, viagem, diario, melhor, velas) e os pedaços que mais apertam o ecrã
  for (const prefixo of ['carta', 'instr', 'ais', 'motor-', 'viagem', 'diario', 'velas-passo', 'pedir', 'a-calcular', 'resultado-', 'mapa-', 'leme-', 'barra-']) assert.ok(nomes.some(n => n.startsWith(prefixo)), `falta um estado "${prefixo}…"`)
  for (const n of ['barra-pior-caso', 'barra-falha-semsom-60letras', 'barra-fumo-reconhecido-porao', 'motor-6-alarmes', 'motor-teclado', 'motor-calibracao', 'motor-agua-por-confirmar', 'resultado-fuga', 'resultado-fuga-2a', 'mapa-fuga', 'leme-6-avisos', 'ais-sem-cog', 'carta-sem-cog']) assert.ok(nomes.includes(n), `falta o estado ${n}`)
  assert.ok(lista.some(e => e.noite) && lista.some(e => !e.noite), 'de dia e de noite')
})

test('verificar-ecra: corre-se com npm run verificar-ecra (sai com 1 se houver problemas, 2 sem browser) e não faz parte do npm test', () => {
  const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pacote.scripts['verificar-ecra'], 'node verificar-ecra/verificar.mjs')
  assert.match(pacote.scripts.test, /test\/\*\.test\.mjs/, 'o npm test só corre test/*.test.mjs (o verificar-ecra precisa de um Chromium)')
  const fonte = readFileSync(new URL('../verificar-ecra/verificar.mjs', import.meta.url), 'utf8')
  assert.match(fonte, /process\.exit\(2\)/, 'sem browser: 2')
  assert.match(fonte, /process\.exitCode = total && !args\['sem-falhar'\] \? 1 : 0/, 'com problemas: 1')
  assert.match(fonte, /--headless=new/)
  assert.match(fonte, /1024/, 'o LAFVIN 7" da roda')
})

test('verificar-ecra (F3b, item 10): o rótulo de um botão tem de caber na caixa dele — "Melhor rota" a 430 px saía da caixa e o botão do lado tapava-o ("Melhor ro")', () => {
  const botao = (o = {}) => alvo({ zona: 'botoes', acao: 'melhor', texto: 'Melhor rota', caixa: caixa(287, 553, 45, 44), vis: { w: 45, h: 44 }, corte: 0, ...o })
  const p = problemas(dados({ alvos: [botao({ corte: 11 })] }))
  assert.deepEqual(p.map(x => x.tipo), ['rótulo cortado'])
  assert.match(p[0].alvo, /button\[melhor\] "Melhor rota"/)
  assert.match(p[0].detalhe, /o texto passa 11 px da caixa de 45 px/)
  assert.deepEqual(problemas(dados({ alvos: [botao({ corte: 0 })] })), [])
  assert.deepEqual(problemas(dados({ alvos: [botao({ corte: 1 })] })), [], 'um píxel: arredondamento')
  assert.deepEqual(problemas(dados({ alvos: [botao({ corte: undefined })] })), [], 'medida antiga, sem o corte')
  // só os botões: uma linha de tabela mais larga do que a caixa (colunas) rola ou corta-se sozinha
  assert.deepEqual(problemas(dados({ alvos: [botao({ tag: 'tr', corte: 40 })] })), [])
  // o verificador mede-o em cada alvo
  assert.match(readFileSync(new URL('../verificar-ecra/recolher.mjs', import.meta.url), 'utf8'), /corte: Math\.max\(0, el\.scrollWidth - el\.clientWidth\)/)
})

test('o estilo (F3b, item 10): a janela da Carta (430 px, ecrã ao alto) parte o rótulo dos botões de baixo em duas linhas e, de noite, passa os do brilho para uma 2.ª fila; o cartão do rumo do Leme dimensiona as letras pela altura que tem e nunca se corta', () => {
  const css = readFileSync(new URL('../public/estilo.css', import.meta.url), 'utf8').replace(/\r/g, '')
  const i = css.indexOf('@media (max-aspect-ratio: 1/1) {')
  assert.ok(i > 0, 'o bloco dos ecrãs ao alto')
  const bloco = css.slice(i, css.indexOf('\n}\n', i))
  assert.match(bloco, /#botoes \{ flex-wrap: wrap; \}/)
  assert.match(bloco, /#botoes button \{[^}]*white-space: normal;/)
  // de dia e a 1024×600 os botões ficam numa fila só e sem partir
  assert.match(css, /#botoes \{ display: flex; gap: \.2rem;/)
  assert.match(css, /#botoes button \{ flex: 1; padding: \.75rem 0; font-size: 1\.05rem; white-space: nowrap; \}/)
  // o cartão do rumo: unidades de contentor, no máximo o tamanho de sempre (6 e 4,6 rem)
  const rumo = css.slice(css.indexOf('.rumo-tile {'), css.indexOf('.rumo-proa {'))
  assert.match(rumo, /container-type: size/)
  assert.match(rumo, /\.rumo-valor \{ font-size: min\(6rem, \d+cqh\); \}/)
  assert.match(rumo, /\.rumo-corr \{ font-size: min\(4\.6rem, \d+cqh\);/)
  assert.match(rumo, /min-height: 7rem/)
  const leme = readFileSync(new URL('../public/paginas/melhor/leme.js', import.meta.url), 'utf8')
  assert.match(leme, /class="tile centro rumo-tile"/)
  assert.doesNotMatch(leme, /font-size:6rem|font-size:4\.6rem/, 'o tamanho fixo saiu do desenho')
  // as colunas do Leme que podem passar do ecrã rolam (a do rumo não)
  assert.match(leme, /<div class="col estica rolar" data-rolar="leme-dir">/)
  assert.match(leme, /<div class="col rolar" data-rolar="leme-unica"/)
})
