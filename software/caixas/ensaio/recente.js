'use strict'
// A tabela do ensaio da conta "há quanto tempo chegou o sinal da outra caixa" (aqRecente, em
// comum/src/arlequin_radio.h). É a mesma para as duas caixas: cada uma faz a conta com o comando de
// bancada "recente,<agora>,<quando>,<prazo>" (em milissegundos) e responde 1 (chegou há pouco) ou 0.
//
// O que estava mal (revisão final das caixas, 23/11/2026): o rádio da caixa 2 só manda enquanto ouvir o
// sinal da caixa 1 ("chegou há 5 s ou menos"), e a conta fazia-se sem sinal. Se o sinal chegasse a meio
// de uma volta do ciclo, depois de a volta ter tirado a hora, o "há quanto tempo" dava a volta para 49
// dias e a caixa deitava fora um pacote (até 11 dados do motor) ou um sinal de vida.
//
// As horas negativas são as do fim da volta do relógio da placa: -16 é 16 ms antes de ele dar a volta.
const RECENTE = [
  ['chegou agora mesmo', [1000, 1000, 5000], 1],
  ['chegou há 3 s', [4000, 1000, 5000], 1],
  ['chegou há 5 s certos', [6000, 1000, 5000], 1],
  ['chegou há 5 s e 1 ms', [6001, 1000, 5000], 0],
  ['com prazo 0 só vale o próprio instante', [1000, 1000, 0], 1],
  ['com prazo 0, 1 ms depois já não vale', [1001, 1000, 0], 0],
  ['chegou a meio da volta do ciclo, 3 ms depois de ela tirar a hora', [1000, 1003, 5000], 1],
  ['chegou a meio de uma volta comprida, 1 s depois de ela tirar a hora', [1000, 2000, 5000], 1],
  ['mais de 1 s "depois de agora" não é desta volta: é um silêncio de 49 dias', [1000, 2001, 5000], 0],
  ['o relógio deu a volta entre o sinal e agora (21 ms)', [5, -16, 5000], 1],
  ['o relógio deu a volta e já passaram 6 s', [5984, -16, 5000], 0],
  ['chegou a meio da volta do ciclo, com o relógio a dar a volta pelo meio', [-2, 3, 5000], 1],
  ['sem sinal há 24,9 dias (meia volta do relógio)', [-2147483648, 0, 5000], 0],
  ['sem sinal há 30 dias', [-1702967296, 0, 5000], 0]
]

// Corre a tabela toda na placa p (aberta com o abrir() do placa.js) e devolve os casos em que ela se
// enganou, todos de uma vez.
async function enganosDoRecente (p) {
  const enganos = []
  for (const [nome, valores, esperado] of RECENTE) {
    const deu = await p.manda('recente', ...valores)
    if (deu !== String(esperado)) enganos.push(`${nome} (agora ${valores[0]}, sinal ${valores[1]}, prazo ${valores[2]}): deu ${deu}, devia dar ${esperado}`)
  }
  return enganos
}

module.exports = { RECENTE, enganosDoRecente }
