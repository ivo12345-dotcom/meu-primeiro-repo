// A cola entre o DOM e as páginas, usada pelo app.js (funções pequenas, testadas sem browser).

// O render de 1 Hz refaz a página só se ninguém estiver a escrever num campo nem com o dedo no ecrã
// (entre o pointerdown e o click, refazer a página trocava o botão e o toque perdia-se). O dedo só
// pausa até PAUSA_TOQUE_MS: uma mão pousada ou gotas de água no ecrã não congelam o Leme.
// premidoHaMs: há quanto tempo foi o pointerdown ainda sem pointerup (null: nenhum dedo). Forçado
// (mudar de página, depois de uma ação, depois do Enter): refaz sempre.
// Um scroll recente conta como um dedo (revisão F3, Important 5): ao rolar com o dedo o browser larga o toque
// (pointercancel) e a inércia continua a rolar depois; refazer a página a meio tirava a lista debaixo do dedo.
// roladoHaMs: há quanto tempo foi o último scroll; aRolarHaMs: há quanto tempo começou esta série de scrolls.
// Pausa até PAUSA_ROLAR_MS depois do último e nunca mais de PAUSA_ROLAR_MAX_MS seguidos.
export const PAUSA_TOQUE_MS = 3000
export const PAUSA_ROLAR_MS = 1500
export const PAUSA_ROLAR_MAX_MS = 10000
export function podeRedesenhar ({ forcar = false, aEscrever = false, premidoHaMs = null, roladoHaMs = null, aRolarHaMs = null } = {}) {
  const premido = premidoHaMs != null && premidoHaMs < PAUSA_TOQUE_MS
  const aRolar = roladoHaMs != null && roladoHaMs < PAUSA_ROLAR_MS && !(aRolarHaMs != null && aRolarHaMs >= PAUSA_ROLAR_MAX_MS)
  return forcar || (!aEscrever && !premido && !aRolar)
}

// As listas que rolam (revisão F3, Important 5): o render refaz a página inteira (innerHTML) de segundo a
// segundo e cada lista voltava ao cimo. Cada parte que rola tem uma chave data-rolar (única na página); antes do
// innerHTML guarda-se o scrollTop de cada chave e, a seguir, repõe-se na lista nova com a mesma chave (uma página
// ou uma vista diferente tem outras chaves e começa no cimo). Sem dependências: o verificar-ecra corre estas duas
// funções no Chromium.
export function guardarRolagem (raiz) {
  const mapa = {}
  if (!raiz || typeof raiz.querySelectorAll !== 'function') return mapa
  for (const el of raiz.querySelectorAll('[data-rolar]')) {
    const chave = el.dataset && el.dataset.rolar
    if (chave && Number.isFinite(el.scrollTop)) mapa[chave] = el.scrollTop
  }
  return mapa
}
// → Map(elemento → scrollTop que ficou) dos que mudaram (o browser corta ao que o conteúdo novo deixa): o scroll
// que a reposição causa não é um dedo a rolar
export function reporRolagem (raiz, mapa) {
  const repostos = new Map()
  if (!raiz || typeof raiz.querySelectorAll !== 'function' || !mapa || typeof mapa !== 'object') return repostos
  for (const el of raiz.querySelectorAll('[data-rolar]')) {
    const chave = el.dataset && el.dataset.rolar
    const v = chave && Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : 0
    if (!(v > 0)) continue
    el.scrollTop = v
    repostos.set(el, el.scrollTop)
  }
  return repostos
}

// Enter num campo: a ação "enter" da página e depois um render forçado (o render normal salta-se
// enquanto o campo tem o foco, e o resultado do Enter não aparecia).
export async function aoEnter (pagina, ctx, alvo, redesenhar) {
  await pagina.acao?.('enter', alvo.dataset, ctx, alvo)
  redesenhar(true)
}

// O que se escreve num campo com data-campo vai para o estado da página (ação "campo"), para um
// render não o apagar.
export function aoEscrever (pagina, ctx, alvo) {
  const campo = alvo?.dataset?.campo
  if (campo) pagina.acao?.('campo', { campo, valor: alvo.value }, ctx)
}
