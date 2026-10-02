// O plano ativo aberto (desenho 3b-2): à espera de sair, a navegar ou em pausa. Num módulo à parte para o
// Pedir, o Resultado e o Mapa (o "Voltar ao leme", auditoria I-25) e o navegar.js lerem a mesma regra.

export const ABERTOS = new Set(['a espera de sair', 'a navegar', 'pausado'])
export const aberto = (p) => (ABERTOS.has(p?.estado) ? p : null)
export const planoAberto = (ctx) => aberto(ctx.estado.planoAtivo)
export const pausado = (ctx) => planoAberto(ctx)?.estado === 'pausado'
