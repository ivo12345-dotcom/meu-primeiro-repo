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
// A última fase junta um ressalto do contacto ao abrir: 300 µs depois de abrir, a roda fecha outra vez
// durante 150 µs. O condensador da entrada estica esse instante (carrega depressa, descarrega devagar):
// no pino do log fica uma subida de meio milissegundo, que não é uma volta. Precisa do programa 0.3.3
// ou mais novo (o comando "roda" com três valores).
const FASES = [
  { nome: 'devagar: 2 voltas por segundo', hz: 2, aberta: 15 },
  { nome: '26 voltas por segundo', hz: 26, aberta: 15 },
  { nome: 'depressa: 60 voltas por segundo', hz: 60, aberta: 15 },
  { nome: '26 voltas por segundo, aberta quase metade da volta', hz: 26, aberta: 45 },
  { nome: '26 voltas por segundo, com o contacto a ressaltar ao abrir', hz: 26, aberta: 15, ressalto: 150 }
]

// Os valores do comando "roda" de uma fase: voltas por segundo, percentagem da volta com a roda aberta
// e, se a fase o tiver, o ressalto ao abrir, em microssegundos.
const comandoDaFase = (f) => (f.ressalto ? [f.hz, f.aberta, f.ressalto] : [f.hz, f.aberta])

const MINIMO_DE_VOLTAS = 20

// O resultado de uma fase: as voltas que a roda a fingir deu, os impulsos que o contador do log contou
// nesse tempo e as subidas que ele recusou (a menos de 4 ms da anterior).
function contas ({ voltas, impulsos, recusados }) {
  const r = { voltas, impulsos, recusados, passa: false, diagnostico: '' }
  const dasRecusadas = recusados > 0 ? `, ${recusados} subidas recusadas` : ''
  if (voltas < MINIMO_DE_VOLTAS) {
    r.diagnostico = `poucas voltas (${voltas}) para provar alguma coisa: alongar a fase`
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
