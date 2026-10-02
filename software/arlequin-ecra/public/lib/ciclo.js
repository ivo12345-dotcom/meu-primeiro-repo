// O ciclo de 1 Hz do ecrã (auditoria I-06): o som nunca depende do desenho. Primeiro o apito, depois o
// desenho (uma página que rebenta mostra uma caixa e os alarmes continuam a tocar), depois os dados
// (barómetro e resumo da viagem). Cada parte dentro do seu try: uma falha vai para o registo e o ciclo segue.

export const ERRO_DESENHO = 'Erro ao desenhar esta página: os alarmes continuam a tocar. Muda de página ou recarrega o ecrã.'
export const CAIXA_ERRO_DESENHO = `<div class="col" style="flex:1;justify-content:center;"><div class="tile caixa-erro">${ERRO_DESENHO}</div></div>`

const seguro = (f) => { try { f() } catch { /* o registo nunca pára o ciclo */ } }

// { tocar, desenhar, dados }: por esta ordem, cada uma no seu try. aoErro(parte, erro): 'som' | 'desenho' | 'dados'.
export function passoCiclo ({ tocar, desenhar, dados } = {}, aoErro = () => {}) {
  for (const [parte, f] of [['som', tocar], ['desenho', desenhar], ['dados', dados]]) {
    if (typeof f !== 'function') continue
    try { f() } catch (e) { seguro(() => aoErro(parte, e)) }
  }
}

// O HTML de render(), ou o de recurso se render() lançar (o erro vai para aoErro, nunca para o ecrã).
export function desenharSeguro (render, recurso = CAIXA_ERRO_DESENHO, aoErro = () => {}) {
  try {
    const html = render()
    return typeof html === 'string' ? html : recurso
  } catch (e) {
    seguro(() => aoErro(e))
    return recurso
  }
}

// A página: a pedida (?pagina=) ou a guardada, se existir mesmo (nunca "constructor" nem lixo); senão a Carta.
export const escolherPagina = (pedida, guardada, paginas, padrao = 'carta') =>
  [pedida, guardada].find(p => typeof p === 'string' && Object.hasOwn(paginas, p)) ?? padrao
