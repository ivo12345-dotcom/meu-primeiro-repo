'use strict'
// As contas do ensaio de resistência (resistencia.js), separadas da porta para se ensaiarem sem placas.
// Recebe as linhas uma a uma, com o mesmo leitor que as lê no barco, e conta o que correu mal.
//
// O que conta como falha (veredicto):
//   - linhas que o portátil não lê (estragadas no cabo);
//   - leituras de movimento em falta (saltos no número de ordem);
//   - segundos sem batimento da caixa 1: os que o relógio dela mostra entre dois batimentos e, pelo
//     relógio do portátil, o silêncio que estiver a decorrer (uma caixa que se cala e não volta);
//   - a caixa 1 que recomeça; linhas que ela própria diz que não conseguiu mandar;
//   - a porta que fecha sozinha (o cabo saiu);
//   - com a caixa 2 (se foi pedida, ou desde que apareça): o mesmo silêncio, os recomeços dela e os
//     pacotes que a caixa 1 conta como perdidos no rádio.
// As cópias que a ponte USB repete (e que quem lê a porta deita fora) só se mostram: são linhas boas.
// Os intervalos compridos entre duas linhas também só se mostram (quantos foram, e a que altura do ensaio
// foi o maior): as linhas chegaram, só chegaram tarde.
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')

const FOLGA = 1500 // ms: um batimento que demore mais do que isto a seguir ao anterior já conta como falta
// ms: com o sensor a medir chega uma linha de 100 em 100 ms; mais do que isto entre duas linhas seguidas é
// um atraso na entrega (ou a caixa sem sensor, que só manda o log de meio em meio segundo)
const INTERVALO_COMPRIDO = 250

// A altura do ensaio, para se ler: "aos 12 min 05 s".
const altura = (ms) => `${Math.floor(ms / 60000)} min ${String(Math.floor(ms / 1000) % 60).padStart(2, '0')} s`

// Os segundos em falta num intervalo entre dois batimentos (que deviam vir de segundo a segundo).
const emFalta = (ms) => (ms > FOLGA ? Math.round(ms / 1000) - 1 : 0)

// agora: o relógio do portátil, em ms (para os ensaios lhe darem outro).
// duasCaixas: a caixa 2 tem de dar sinal; sem isto só conta se aparecer.
function novoContador ({ agora = Date.now, duasCaixas = false } = {}) {
  const c = {
    linhas: 0, estragadas: 0, batimentos: 0, log: 0, vento: 0, movimento: 0, motor: 0,
    saltosDoMovimento: 0, leiturasEmFalta: 0, segundosSemBatimento: 0, recomecos: 0,
    mudancasDoSensor: 0, toquesNoRst: 0, maiorSilencioMs: 0, maiorSilencioAos: null, intervalosCompridos: 0,
    deitadasForaPelaCaixa: 0,
    batimentos2: 0, segundosSemBatimento2: 0, recomecos2: 0, perdidosNoRadio: 0,
    repetidas: 0, portaFechou: null
  }
  const exemplos = [] // as primeiras linhas estragadas, para se ver de que tipo são
  const inicio = agora()
  let ultimaLinha = inicio
  let ultimo1 = null // o último batimento da caixa 1: { ms, sensor, rsts, perdidos, hora }
  let ultimo2 = null // o da caixa 2: { ms, perdidos, hora }
  let ultimoN = null

  // O silêncio que está a decorrer, pelo relógio do portátil: desde o último batimento (ou desde o
  // princípio, se ainda não houve nenhum).
  const emAberto = (ultimo) => emFalta(agora() - (ultimo ? ultimo.hora : inicio))
  const segundosSemBatimento = () => c.segundosSemBatimento + emAberto(ultimo1)
  const esperaPela2 = () => duasCaixas || ultimo2 !== null
  const segundosSemBatimento2 = () => (esperaPela2() ? c.segundosSemBatimento2 + emAberto(ultimo2) : 0)

  // O maior silêncio até agora, e a que altura do ensaio se deu por ele (ms desde o princípio).
  function silencio (ms, hora) {
    if (ms <= c.maiorSilencioMs) return
    c.maiorSilencioMs = ms
    c.maiorSilencioAos = hora - inicio
  }

  function tique () {
    const hora = agora()
    silencio(hora - ultimaLinha, hora)
  }

  function linha (texto) {
    const hora = agora()
    silencio(hora - ultimaLinha, hora)
    if (hora - ultimaLinha > INTERVALO_COMPRIDO) c.intervalosCompridos++
    ultimaLinha = hora
    c.linhas++
    if (texto.startsWith('$AQR,')) return // respostas a comandos: não são do contrato com o portátil
    const l = ler(texto)
    if (!l) {
      c.estragadas++
      if (exemplos.length < 10) exemplos.push(texto.slice(0, 120))
      return
    }
    if (l.tipo === 'batimento' && l.caixa === 1) {
      c.batimentos++
      if (ultimo1) {
        // recomeçou: o relógio dela voltou ao zero, por isso o tempo calada mede-se pelo do portátil
        if (l.ms < ultimo1.ms) {
          c.recomecos++
          c.segundosSemBatimento += emFalta(hora - ultimo1.hora)
        } else c.segundosSemBatimento += emFalta(l.ms - ultimo1.ms)
        if (l.sensor !== ultimo1.sensor) c.mudancasDoSensor++
        if (Number.isInteger(l.rsts) && Number.isInteger(ultimo1.rsts) && l.rsts > ultimo1.rsts) c.toquesNoRst += l.rsts - ultimo1.rsts
        // o contador dela recomeça do zero quando ela recomeça: só as subidas contam
        // (o que ela já trazia contado antes do ensaio não é deste ensaio)
        if (Number.isInteger(l.perdidos) && Number.isInteger(ultimo1.perdidos) && l.perdidos > ultimo1.perdidos) c.deitadasForaPelaCaixa += l.perdidos - ultimo1.perdidos
      }
      ultimo1 = { ms: l.ms, sensor: l.sensor, rsts: l.rsts, perdidos: l.perdidos, hora }
    } else if (l.tipo === 'batimento' && l.caixa === 2) {
      c.batimentos2++
      if (ultimo2) {
        if (l.ms < ultimo2.ms) {
          c.recomecos2++
          c.segundosSemBatimento2 += emFalta(hora - ultimo2.hora)
        } else c.segundosSemBatimento2 += emFalta(l.ms - ultimo2.ms)
        if (Number.isInteger(l.perdidos) && Number.isInteger(ultimo2.perdidos) && l.perdidos > ultimo2.perdidos) c.perdidosNoRadio += l.perdidos - ultimo2.perdidos
      }
      ultimo2 = { ms: l.ms, perdidos: l.perdidos, hora }
    } else if (l.tipo === 'log') {
      c.log++
    } else if (l.tipo === 'vento') {
      c.vento++
    } else if (l.tipo === 'motor') {
      c.motor++
    } else if (l.tipo === 'movimento') {
      c.movimento++
      if (ultimoN !== null && l.n > ultimoN + 1) {
        c.saltosDoMovimento++
        c.leiturasEmFalta += l.n - ultimoN - 1
      }
      ultimoN = l.n
    }
  }

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

  function resumo () {
    tique()
    return `${c.linhas} linhas · ${c.estragadas} estragadas · movimento ${c.movimento} (${c.leiturasEmFalta} em falta) · ` +
      `${segundosSemBatimento()} s sem batimento · ${c.recomecos} recomeços · sensor: ${c.mudancasDoSensor} mudanças, ${c.toquesNoRst} toques · ` +
      `maior silêncio ${c.maiorSilencioMs} ms` + (c.maiorSilencioAos === null ? '' : ` (aos ${altura(c.maiorSilencioAos)})`) +
      (c.intervalosCompridos ? ` · ${plural(c.intervalosCompridos, 'intervalo', 'intervalos')} de mais de ${INTERVALO_COMPRIDO} ms` : '') +
      (esperaPela2() ? ` · caixa 2: ${segundosSemBatimento2()} s sem batimento, ${c.recomecos2} recomeços, ${c.perdidosNoRadio} perdidos no rádio` : '') +
      (c.repetidas ? ` · ${c.repetidas} cópias deitadas fora` : '') +
      (c.portaFechou ? ` · A PORTA FECHOU: ${c.portaFechou}` : '')
  }

  function veredicto () {
    tique()
    const falhas = []
    if (c.portaFechou) falhas.push(`a porta fechou: ${c.portaFechou}`)
    if (c.estragadas) falhas.push(plural(c.estragadas, 'linha estragada', 'linhas estragadas'))
    if (c.leiturasEmFalta) falhas.push(plural(c.leiturasEmFalta, 'leitura de movimento em falta', 'leituras de movimento em falta'))
    if (segundosSemBatimento()) falhas.push(`${segundosSemBatimento()} s sem batimento da caixa 1`)
    if (c.recomecos) falhas.push(plural(c.recomecos, 'recomeço da caixa 1', 'recomeços da caixa 1'))
    if (c.deitadasForaPelaCaixa) falhas.push(plural(c.deitadasForaPelaCaixa, 'linha que a caixa não conseguiu mandar', 'linhas que a caixa não conseguiu mandar'))
    if (duasCaixas && c.batimentos2 === 0) falhas.push('a caixa 2 nunca deu sinal')
    else if (segundosSemBatimento2()) falhas.push(`${segundosSemBatimento2()} s sem batimento da caixa 2`)
    if (c.recomecos2) falhas.push(plural(c.recomecos2, 'recomeço da caixa 2', 'recomeços da caixa 2'))
    if (c.perdidosNoRadio) falhas.push(plural(c.perdidosNoRadio, 'pacote perdido no rádio', 'pacotes perdidos no rádio'))
    return { limpo: falhas.length === 0, falhas }
  }

  return {
    c,
    exemplos,
    linha,
    tique,
    resumo,
    veredicto,
    segundosSemBatimento,
    segundosSemBatimento2,
    // a porta fechou sem ninguém pedir (o cabo saiu, a placa desligou-se): fica o motivo
    fechou (motivo) { c.portaFechou = String(motivo || 'sem motivo conhecido') },
    // quantas cópias quem lê a porta já deitou fora (a enxurrada da ponte USB)
    repetidas (n) { c.repetidas = n }
  }
}

module.exports = { novoContador }
