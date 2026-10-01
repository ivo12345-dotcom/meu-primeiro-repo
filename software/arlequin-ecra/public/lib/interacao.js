// A cola entre o DOM e as páginas, usada pelo app.js (funções pequenas, testadas sem browser).

// O render de 1 Hz refaz a página só se ninguém estiver a escrever num campo nem com o dedo no ecrã
// (entre o pointerdown e o click, refazer a página trocava o botão e o toque perdia-se). Forçado
// (mudar de página, depois de uma ação, depois do Enter): refaz sempre.
export function podeRedesenhar ({ forcar = false, aEscrever = false, premido = false } = {}) {
  return forcar || (!aEscrever && !premido)
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
