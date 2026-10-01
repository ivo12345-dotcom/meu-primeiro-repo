// O brilho do modo noite (decisão do Ivo de 01/10): 5 níveis, do mais escuro (1) ao mais claro (5),
// o 2 por omissão. De noite a página toda (#app) leva filter: brightness(x) (estilo.css, pelo
// data-brilho do body); de dia, nada. Funções puras (o app.js guarda o nível no localStorage).

export const NIVEIS = Object.freeze([0.35, 0.5, 0.65, 0.8, 1])
export const PADRAO = 2

// Um nível guardado (ou do ?brilho=): 1–5; outra coisa qualquer, o 2.
export function nivelValido (x) {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x
  return Number.isInteger(n) && n >= 1 && n <= NIVEIS.length ? n : PADRAO
}

// − e +: um nível abaixo ou acima, sem passar das pontas.
export const mudarNivel = (n, passo) => Math.max(1, Math.min(NIVEIS.length, nivelValido(n) + passo))

// O filtro CSS da página: só de noite.
export const filtro = (noite, n) => (noite ? `brightness(${NIVEIS[nivelValido(n) - 1]})` : 'none')
