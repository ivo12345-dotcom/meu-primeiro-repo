// O plano ativo aberto (desenho 3b-2): à espera de sair, a navegar ou em pausa. Num módulo à parte para o
// Pedir, o Resultado e o Mapa (o "Voltar ao leme", auditoria I-25) e o navegar.js lerem a mesma regra.

// "à espera de sair" (auditoria M-35, o do plugin com o acento) e o antigo "a espera de sair" (um plugin de
// antes da correção): os dois contam
export const A_ESPERA = new Set(['à espera de sair', 'a espera de sair'])
export const ABERTOS = new Set([...A_ESPERA, 'a navegar', 'pausado'])
export const aEspera = (p) => A_ESPERA.has(p?.estado)
export const aberto = (p) => (ABERTOS.has(p?.estado) ? p : null)
export const planoAberto = (ctx) => aberto(ctx.estado.planoAtivo)
export const pausado = (ctx) => planoAberto(ctx)?.estado === 'pausado'
