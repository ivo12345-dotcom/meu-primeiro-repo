// Ajuda dos testes (não é um teste): a cadeia de elementos abertos à volta de um pedaço do HTML que as páginas
// desenham, para saber, sem browser, se um botão está dentro de uma parte que rola (revisão F3, Important 2, 3
// e 5). Só as etiquetas contam; os elementos vazios (input, br…) e os que fecham sozinhos (SVG) não abrem nada.

const VAZIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const atributo = (attrs, nome) => new RegExp(`\\b${nome}="([^"]*)"`).exec(attrs)?.[1] ?? ''

// [{ tag, classe, estilo, rolar (o data-rolar) }] do mais de fora para o mais de dentro, à volta da 1.ª vez que
// `pedaco` aparece no html (null se não aparece)
export function ancestrais (html, pedaco) {
  const alvo = html.indexOf(pedaco)
  if (alvo < 0) return null
  const pilha = []
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    // a etiqueta que contém o pedaço (ex.: o <button data-acao=…>) não é ancestral dela própria
    if (m.index + m[0].length > alvo) break
    const [, fecha, tag, attrs, sozinho] = m
    const t = tag.toLowerCase()
    if (fecha) {
      const i = pilha.map(x => x.tag).lastIndexOf(t)
      if (i >= 0) pilha.length = i
    } else if (!VAZIOS.has(t) && !sozinho) {
      pilha.push({ tag: t, classe: atributo(attrs, 'class'), estilo: atributo(attrs, 'style'), rolar: atributo(attrs, 'data-rolar') })
    }
  }
  return pilha
}

// está dentro de uma parte que rola (a classe rolar, um overflow na linha ou um data-rolar)?
export const dentroDeRolar = (cadeia) => (cadeia || []).some(a => /\brolar\b/.test(a.classe) || /overflow\s*:\s*(auto|scroll)/.test(a.estilo) || a.rolar)
