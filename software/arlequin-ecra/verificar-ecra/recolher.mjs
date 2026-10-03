// O que o verificar-ecra mede dentro do Chromium (verificar.mjs injeta esta função na página, por isso só
// usa o DOM do browser e não importa nada). Devolve os números em bruto; quem decide o que é um problema é o
// problemas.mjs (testado no npm test).
//   alvos: cada elemento que se toca (botões, campos, data-acao, linhas AIS), com a caixa, a parte que se
//     vê (cortada pelos pais com overflow, pelo ecrã e, dentro da página, pelos botões de baixo) e a lista
//     que rola onde está (se estiver numa);
//   rolar: cada contentor da página com overflow auto/scroll (a chave data-rolar, a caixa, a parte à vista,
//     a altura do conteúdo);
//   conteudo: os mosaicos e as linhas dentro deles que ficam cortados sem estarem numa lista que rola;
//   barra: os filhos da barra de cima (a caixa de cada um);
//   achados: para cada texto pedido (procurar), o elemento mais pequeno da página que o tem, a caixa e a parte
//     à vista (ex.: a linha da fuga de gasóleo no Motor).
export function recolher (procurar = []) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r4 = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) })
  const pagina = document.getElementById('pagina')
  const botoes = document.getElementById('botoes')
  const barra = document.getElementById('barra')
  const rPag = pagina.getBoundingClientRect()
  const rBot = botoes.getBoundingClientRect()
  const visivel = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const fixo = (el) => { for (let q = el; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).position === 'fixed') return true; return false }
  const rola = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) }
  // a parte que se vê de um elemento: os pais com overflow que não é visible cortam; o ecrã corta; dentro da
  // página (e sem ser fixo) os botões de baixo tapam o que passa do fundo da página
  function recorte (el) {
    let c = { l: 0, t: 0, r: vw, b: vh }
    const emFixo = fixo(el)
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (p === document.body) break
      const cs = getComputedStyle(p)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect()
        c = { l: Math.max(c.l, pr.left), t: Math.max(c.t, pr.top), r: Math.min(c.r, pr.right), b: Math.min(c.b, pr.bottom) }
      }
      if (cs.position === 'fixed') break
    }
    if (pagina.contains(el) && !emFixo) c = { ...c, t: Math.max(c.t, rPag.top), b: Math.min(c.b, rBot.top) }
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, c.r) - Math.max(r.left, c.l))
    const h = Math.max(0, Math.min(r.bottom, c.b) - Math.max(r.top, c.t))
    return { w: Math.round(w), h: Math.round(h) }
  }
  // a lista que rola onde o elemento está (a mais perto), se o conteúdo dela passa da altura
  function listaDe (el) {
    for (let p = el.parentElement; p && p !== pagina.parentElement; p = p.parentElement) {
      if (rola(p) && p.scrollHeight > p.clientHeight + 1) return p
    }
    return null
  }
  const nomeDe = (el) => el.getAttribute('data-rolar') || (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : el.tagName.toLowerCase())
  const zona = (el) => (barra.contains(el) ? 'barra' : botoes.contains(el) ? 'botoes' : fixo(el) ? 'fixo' : 'pagina')
  const texto = (el) => (el.textContent || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 40)

  const alvos = []
  const vistos = new Set()
  for (const el of document.querySelectorAll('button, input, select, textarea, [data-acao], [data-pag], tr[data-mmsi]')) {
    if (vistos.has(el) || !visivel(el)) continue
    vistos.add(el)
    const lista = listaDe(el)
    alvos.push({
      zona: zona(el),
      tag: el.tagName.toLowerCase(),
      acao: el.getAttribute('data-acao') || el.getAttribute('data-pag') || '',
      texto: texto(el),
      caixa: r4(el.getBoundingClientRect()),
      vis: recorte(el),
      lista: lista ? { nome: nomeDe(lista), caixa: r4(lista.getBoundingClientRect()), vis: recorte(lista) } : null
    })
  }

  const rolar = []
  for (const el of pagina.querySelectorAll('*')) {
    if (!visivel(el) || !rola(el)) continue
    rolar.push({ nome: nomeDe(el), chave: el.getAttribute('data-rolar'), caixa: r4(el.getBoundingClientRect()), vis: recorte(el), clientH: el.clientHeight, scrollH: el.scrollHeight })
  }

  const conteudo = []
  for (const el of pagina.querySelectorAll('.tile, .tile > *, .col > *, .acoes')) {
    if (!visivel(el) || fixo(el) || listaDe(el)) continue
    const r = el.getBoundingClientRect()
    const v = recorte(el)
    if (v.h < Math.round(r.height) - 2 || v.w < Math.round(r.width) - 2) conteudo.push({ nome: nomeDe(el), texto: texto(el), caixa: r4(r), vis: v })
  }

  const filhosBarra = [...barra.children].filter(visivel).map(el => ({ nome: nomeDe(el), texto: texto(el), caixa: r4(el.getBoundingClientRect()) }))

  const achados = procurar.map(t => {
    let melhor = null
    for (const el of document.querySelectorAll('#barra *, #pagina *')) {
      if (!visivel(el) || !(el.textContent || '').includes(t)) continue
      if (!melhor || melhor.contains(el)) melhor = el
    }
    if (!melhor) return { texto: t, achado: false }
    const lista = listaDe(melhor)
    return { texto: t, achado: true, caixa: r4(melhor.getBoundingClientRect()), vis: recorte(melhor), lista: lista ? { nome: nomeDe(lista), caixa: r4(lista.getBoundingClientRect()), vis: recorte(lista), scrollTop: lista.scrollTop } : null }
  })

  return { vw, vh, barra: r4(barra.getBoundingClientRect()), pagina: r4(rPag), botoes: r4(rBot), alvos, rolar, conteudo, filhosBarra, achados }
}
