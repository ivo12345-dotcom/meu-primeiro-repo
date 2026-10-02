// O som do ecrã (auditoria K-03). O Chromium só deixa tocar depois de um toque no ecrã, a não ser que
// arranque com --autoplay-policy=no-user-gesture-required (o kiosk do Pi): o AudioContext cria-se logo
// no arranque e, enquanto o browser o tiver suspenso, tenta-se retomá-lo a cada ciclo e a cada toque.
// O aviso "sem som" na barra só aparece com o som parado, vermelho e grande: sem som o ecrã não protege.

// O AudioContext (ou null se o browser não o tiver ou o recusar).
export function criarAudio (Contexto = globalThis.AudioContext) {
  if (typeof Contexto !== 'function') return null
  try { return new Contexto() } catch { return null }
}

// Suspenso: pede ao browser para o retomar (sem esperar; uma recusa fica para o ciclo seguinte).
export function retomar (audio) {
  if (!audio || audio.state !== 'suspended' || typeof audio.resume !== 'function') return
  try {
    const p = audio.resume()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch { /* o ciclo seguinte tenta outra vez */ }
}

// O som está mesmo a sair (o contexto a correr).
export const comSom = (audio) => !!audio && audio.state === 'running'

export function chipSemSom (audio) {
  if (comSom(audio)) return ''
  return '<span class="chip sem-som" data-acao="ligar-som" title="O browser só deixa tocar depois de um toque (no Pi, o kiosk arranca com o autoplay)">🔇 SEM SOM: toca no ecrã</span>'
}
