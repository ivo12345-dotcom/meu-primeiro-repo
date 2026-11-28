'use strict'
// As contas do ensaio da roda do log por fora (a entrada da roda na plaquinha: 1 kΩ, 10 kΩ e 100 nF).
// A caixa 1 faz de roda: o pino D26 fica em cima enquanto a roda estaria fechada e solto enquanto
// estaria aberta, e a caixa diz quantas voltas deu. Aqui só se fazem contas: quem fala com a placa é o
// roda-por-fora.js.

// Voltas por segundo e a parte da volta em que a roda está aberta (a verdadeira abre uma vez por volta
// e fica fechada quase a volta toda). Devagar e a meio, a roda fica aberta mais do que os 4 ms em que a
// caixa recusa um segundo impulso: é aí que uma subida falsa, na descida lenta do pino, contava a dobrar.
// Depressa, fica aberta menos de 4 ms, e a subida falsa ficava escondida pela recusa.
//
// As duas últimas fases juntam um ressalto do contacto ao abrir: 1,5 ms depois de abrir (com o pino já em
// baixo), a roda fecha outra vez um instante. O condensador da entrada estica esse instante (carrega
// depressa, descarrega devagar): o ressalto de 150 µs fica no pino como uma subida de mais de meio
// milissegundo, e o de 1 ms como uma de milissegundo e meio ou mais, conforme o chip. Nenhuma é uma volta.
// A do ressalto comprido mostra a folga da regra dos 2 ms neste chip. Precisam do programa 0.3.4 ou mais
// novo (o comando "roda" com três valores e o ressalto 1,5 ms depois de abrir).
const FASES = [
  { nome: 'devagar: 2 voltas por segundo', hz: 2, aberta: 15 },
  { nome: '26 voltas por segundo', hz: 26, aberta: 15 },
  { nome: 'depressa: 60 voltas por segundo', hz: 60, aberta: 15 },
  { nome: '26 voltas por segundo, aberta quase metade da volta', hz: 26, aberta: 45 },
  { nome: '13 voltas por segundo, com o contacto a ressaltar ao abrir', hz: 13, aberta: 15, ressalto: 150 },
  { nome: '13 voltas por segundo, com um ressalto comprido, de 1 ms', hz: 13, aberta: 15, ressalto: 1000 }
]

// Os valores do comando "roda" de uma fase: voltas por segundo, percentagem da volta com a roda aberta
// e, se a fase o tiver, o ressalto ao abrir, em microssegundos.
const comandoDaFase = (f) => (f.ressalto ? [f.hz, f.aberta, f.ressalto] : [f.hz, f.aberta])

const MINIMO_DE_VOLTAS = 20

// O resultado de uma fase: as voltas que a roda a fingir deu, os impulsos que o contador do log contou
// nesse tempo e as subidas que ele recusou (as que não se aguentaram em cima, ou a menos de 4 ms da volta
// anterior). ressalto: o da fase, em µs, se o tiver: aí, contar certo só prova alguma coisa se os
// ressaltos chegaram ao pino, e isso vê-se por terem sido recusados (um por volta).
function contas ({ voltas, impulsos, recusados, ressalto = 0 }) {
  const r = { voltas, impulsos, recusados, passa: false, diagnostico: '' }
  const dasRecusadas = recusados > 0 ? `, ${recusados} subidas recusadas` : ''
  if (voltas < MINIMO_DE_VOLTAS) {
    r.diagnostico = `poucas voltas (${voltas}) para provar alguma coisa: alongar a fase`
  } else if (impulsos === voltas && ressalto > 0 && recusados < voltas - 1) {
    r.diagnostico = `contou certo (${voltas} voltas), mas o ressalto não chegou ao pino: só ${recusados} subidas recusadas em ` +
      `${voltas} ressaltos. A fase não provou nada: ver se o pino chega a descer antes do ressalto`
  } else if (impulsos === voltas) {
    r.passa = true
    r.diagnostico = `passa: ${voltas} voltas, ${impulsos} impulsos${dasRecusadas}`
  } else if (impulsos === 0) {
    r.diagnostico = 'não chega nada ao pino da roda: ver o fio RODA do furo Q9 no pino D26 (fila de trás, o 7.º a ' +
      'contar da ficha USB), o fio do D27 no 6.º, e as pontes da fila 9 da plaquinha'
  } else if (impulsos > voltas) {
    const aMais = impulsos - voltas
    r.diagnostico = (impulsos === 2 * voltas
      ? `contou o dobro (${impulsos} impulsos em ${voltas} voltas)`
      : `${aMais} impulsos a mais (${impulsos} em ${voltas} voltas)`) +
      ': cada volta está a dar mais de uma subida no pino; a descida lenta, quando a roda abre, passa por subida' +
      dasRecusadas
  } else {
    r.diagnostico = `faltam ${voltas - impulsos} impulsos (${impulsos} em ${voltas} voltas): o pino não chega a ` +
      'descer ou a subir em todas as voltas; ver as resistências de 10 kΩ e de 1 kΩ e as soldas' + dasRecusadas
  }
  return r
}

module.exports = { FASES, comandoDaFase, contas, MINIMO_DE_VOLTAS }
