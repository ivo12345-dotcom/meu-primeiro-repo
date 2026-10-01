// A cola entre o DOM e as páginas, usada pelo app.js (funções pequenas, testadas sem browser).

// O render de 1 Hz refaz a página só se ninguém estiver a escrever num campo nem com o dedo no ecrã
// (entre o pointerdown e o click, refazer a página trocava o botão e o toque perdia-se). O dedo só
// pausa até PAUSA_TOQUE_MS: uma mão pousada ou gotas de água no ecrã não congelam o Leme.
// premidoHaMs: há quanto tempo foi o pointerdown ainda sem pointerup (null: nenhum dedo). Forçado
// (mudar de página, depois de uma ação, depois do Enter): refaz sempre.
export const PAUSA_TOQUE_MS = 3000
export function podeRedesenhar ({ forcar = false, aEscrever = false, premidoHaMs = null } = {}) {
  const premido = premidoHaMs != null && premidoHaMs < PAUSA_TOQUE_MS
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
