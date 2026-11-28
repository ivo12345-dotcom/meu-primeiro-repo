'use strict'
// As contas do ensaio de resistência, sem placas: o que o resistencia.js tem de apanhar.
// Revisão final das caixas (23/11/2026): o ensaio de resistência dava "LIMPO" a uma caixa que se calava
// a meio (o registo das 13:56 ficou 7 minutos parado nas 8402 linhas a dizer "0 s sem batimento").
const test = require('node:test')
const assert = require('node:assert/strict')
const { novoContador } = require('./contador')
const { escrever, soma } = require('../../signalk-arlequin-caixas/lib/linhas')

// Um relógio de portátil a fingir, que só anda quando o ensaio manda.
function relogio (inicio = 1_800_000_000_000) {
  let t = inicio
  const agora = () => t
  agora.passa = (ms) => { t += ms }
  return agora
}

const bat1 = (ms, { sim = 1, perdidos = 0, sensor = 4, arranque = 1, rsts = 0 } = {}) => escrever('B', [1, ms, '0.2.1', sim, 0, perdidos, sensor, arranque, rsts])
const bat2 = (ms, { sim = 1, rssi = -22, perdidos = 0 } = {}) => escrever('B', [2, ms, '0.2.1', sim, rssi, perdidos])
const mov = (n) => escrever('M', [n, 10, 512, -2980, 9320, -12, 35, 4, 0, 1736, 0, 9848, 349, 3])
const motor = (s) => { const corpo = `(${s}.000000) can1 0CF00400#FFFFFF004BFFFFFF`; return `${corpo}*${soma(corpo)}` }

// Um segundo do que chega pelo cabo com as duas caixas a mandar: batimentos, log, vento, movimento, motor.
function umSegundo (c, agora, s, { caixa2 = true, n0 = s * 10 } = {}) {
  c.linha(bat1(s * 1000))
  if (caixa2) c.linha(bat2(s * 1000 + 300))
  c.linha(escrever('L', [s * 1000, s * 26, 38462]))
  c.linha('$IIMWV,35.0,R,14.0,N,A*3E')
  for (let i = 0; i < 10; i++) c.linha(mov(n0 + i))
  if (caixa2) c.linha(motor(s))
  agora.passa(1000)
  c.tique()
}

test('uma hora normal com as duas caixas sai limpa', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 3600; s++) umSegundo(c, agora, s)
  const v = c.veredicto()
  assert.deepEqual(v.falhas, [])
  assert.equal(v.limpo, true)
  assert.equal(c.c.batimentos, 3600)
  assert.equal(c.c.batimentos2, 3600)
  assert.equal(c.c.movimento, 36000)
  assert.match(c.resumo(), /0 estragadas/)
})

test('uma caixa que se cala a meio não sai limpa: o silêncio conta-se pelo relógio do portátil', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 120; s++) umSegundo(c, agora, s, { caixa2: false })
  assert.equal(c.veredicto().limpo, true)
  for (let s = 0; s < 180; s++) { // três minutos sem chegar nada
    agora.passa(1000)
    c.tique()
  }
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.ok(c.segundosSemBatimento() >= 178, `${c.segundosSemBatimento()} s sem batimento`)
  assert.ok(c.c.maiorSilencioMs >= 179000, `maior silêncio ${c.c.maiorSilencioMs} ms`)
  assert.match(v.falhas.join(' | '), /sem batimento da caixa 1/)
  assert.match(c.resumo(), /1[78]\d s sem batimento/)
})

test('uma caixa que nunca chega a falar não sai limpa', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 0; s < 60; s++) {
    agora.passa(1000)
    c.tique()
  }
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /sem batimento da caixa 1/)
})

test('a porta que fecha a meio (o cabo saiu) dá falhas, e diz porquê', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 10; s++) umSegundo(c, agora, s, { caixa2: false })
  c.fechou('o cabo USB saiu ou a placa desligou-se')
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /a porta fechou: o cabo USB saiu/)
})

test('com a caixa 2 presente, o silêncio dela e os pacotes que o rádio perdeu contam', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 30; s++) umSegundo(c, agora, s)
  assert.equal(c.veredicto().limpo, true)
  // a caixa 2 cala-se 20 s (a 1 continua), e volta com 11 pacotes perdidos contados pela caixa 1
  for (let s = 31; s <= 50; s++) umSegundo(c, agora, s, { caixa2: false, n0: s * 10 })
  assert.equal(c.veredicto().limpo, false, 'a caixa 2 calada conta mesmo antes de voltar')
  assert.ok(c.segundosSemBatimento2() >= 18)
  c.linha(bat2(51300, { perdidos: 11 }))
  umSegundo(c, agora, 52, { n0: 520 })
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.equal(c.c.perdidosNoRadio, 11)
  assert.ok(c.segundosSemBatimento2() >= 18, `${c.segundosSemBatimento2()} s sem batimento da caixa 2`)
  assert.match(v.falhas.join(' | '), /caixa 2/)
  assert.match(v.falhas.join(' | '), /11 pacotes perdidos no rádio/)
})

test('pedidas as duas caixas, a caixa 2 que nunca aparece dá falhas', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 30; s++) umSegundo(c, agora, s, { caixa2: false })
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /a caixa 2 nunca deu sinal/)
  // sem as pedir, uma caixa só sai limpa
  const so = novoContador({ agora })
  for (let s = 1; s <= 30; s++) umSegundo(so, agora, s, { caixa2: false })
  assert.equal(so.veredicto().limpo, true)
})

test('a caixa que recomeça, as linhas que ela não conseguiu mandar e as estragadas dão falhas', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 10; s++) umSegundo(c, agora, s, { caixa2: false })
  c.linha(bat1(500)) // o relógio da caixa voltou atrás: recomeçou
  assert.equal(c.c.recomecos, 1)
  c.linha(bat1(1500, { perdidos: 3 })) // três linhas que a caixa deitou fora por não caberem na porta
  c.linha('$AQL,1,2,3*00') // soma errada
  c.linha('ÿÿÿ$AQM,1,2')
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.equal(c.c.estragadas, 2)
  assert.equal(c.c.deitadasForaPelaCaixa, 3)
  assert.equal(c.exemplos.length, 2)
  assert.match(v.falhas.join(' | '), /1 recomeço/)
  assert.match(v.falhas.join(' | '), /2 linhas estragadas/)
  assert.match(v.falhas.join(' | '), /3 linhas que a caixa não conseguiu mandar/)
})

test('leituras de movimento em falta contam-se pelo número de ordem; as cópias deitadas fora só se mostram', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 5; s++) umSegundo(c, agora, s, { caixa2: false })
  c.linha(mov(65)) // saltou do 59 para o 65: faltam 5
  c.repetidas(1200)
  const v = c.veredicto()
  assert.equal(c.c.leiturasEmFalta, 5)
  assert.equal(v.limpo, false)
  assert.match(c.resumo(), /1200 cópias deitadas fora/)
  const limpa = novoContador({ agora })
  for (let s = 1; s <= 5; s++) umSegundo(limpa, agora, s, { caixa2: false })
  limpa.repetidas(1200)
  assert.equal(limpa.veredicto().limpo, true, 'as cópias da ponte USB não são falha: são linhas boas repetidas')
})

// Visto nas placas a 23/11 (19:32): a caixa 2 presa de propósito 6 s e reiniciada pelo cão de guarda dava
// "1 recomeço" mas "0 s sem batimento", porque o relógio dela recomeça do zero. Os segundos calada
// contam-se então pelo relógio do portátil.
test('a caixa que recomeça: os segundos que esteve calada contam pelo relógio do portátil', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 20; s++) umSegundo(c, agora, s)
  // a caixa 2 cala-se 6 s (a 1 continua) e volta com o relógio dela a recomeçar
  for (let s = 21; s <= 26; s++) umSegundo(c, agora, s, { caixa2: false, n0: s * 10 })
  c.linha(bat2(400, { sim: 0 }))
  assert.equal(c.c.recomecos2, 1)
  assert.ok(c.segundosSemBatimento2() >= 5 && c.segundosSemBatimento2() <= 7, `${c.segundosSemBatimento2()} s sem batimento da caixa 2`)
  // o mesmo com a caixa 1
  agora.passa(8000)
  c.linha(bat1(900))
  assert.equal(c.c.recomecos, 1)
  assert.ok(c.segundosSemBatimento() >= 7 && c.segundosSemBatimento() <= 9, `${c.segundosSemBatimento()} s sem batimento da caixa 1`)
})

// Ensaio de 3 horas do sensor novo (27/11/2026): o resumo dizia "maior silêncio 501 ms" desde o primeiro
// minuto, sem se saber quando tinha sido nem se se repetia (com o sensor a medir, o costume é uma linha de
// 100 em 100 ms). O contador passa a dizer a que altura do ensaio foi o maior intervalo entre duas linhas
// e quantos passaram dos 250 ms. Não entram no veredicto: as linhas chegaram, só chegaram tarde.
test('os intervalos compridos entre linhas contam-se, e fica a altura do ensaio em que foi o maior', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  let n = 0
  const dezPorSegundo = (segundos) => { for (let i = 0; i < segundos * 10; i++) { agora.passa(100); c.linha(mov(n++)) } }
  dezPorSegundo(65)
  assert.equal(c.c.intervalosCompridos, 0)
  assert.doesNotMatch(c.resumo(), /de mais de 250 ms/)
  agora.passa(500) // um atraso: meio segundo sem chegar nada, aos 65,5 s do ensaio
  c.linha(mov(n++))
  assert.match(c.resumo(), /maior silêncio 500 ms \(aos 1 min 05 s\) · 1 intervalo de mais de 250 ms/)
  dezPorSegundo(120)
  agora.passa(300) // outro, mais pequeno: conta, mas o maior continua a ser o primeiro
  c.linha(mov(n++))
  agora.passa(250) // 250 ms certos ainda não é "mais de 250"
  c.linha(mov(n++))
  dezPorSegundo(10)
  assert.equal(c.c.intervalosCompridos, 2)
  assert.equal(c.c.maiorSilencioMs, 500)
  assert.equal(c.c.maiorSilencioAos, 65500)
  assert.match(c.resumo(), /maior silêncio 500 ms \(aos 1 min 05 s\) · 2 intervalos de mais de 250 ms/)
  // um silêncio que ainda está a decorrer já conta para o maior, com a altura a que se deu por ele;
  // para a conta dos intervalos só entra quando uma linha o fechar
  agora.passa(2000)
  c.tique()
  assert.equal(c.c.maiorSilencioMs, 2000)
  assert.equal(c.c.maiorSilencioAos, 65500 + 120000 + 300 + 250 + 10000 + 2000)
  assert.equal(c.c.intervalosCompridos, 2)
  agora.passa(100)
  c.linha(mov(n++))
  assert.equal(c.c.intervalosCompridos, 3)
  assert.equal(c.c.maiorSilencioMs, 2100)
})

// Revisão final da Tarefa 7 (28/11/2026): o ensaio de resistência dava "LIMPO" a um sensor de movimento que
// se calasse a meio e não voltasse. O número de ordem das linhas do movimento não avança enquanto ele está
// calado (não há salto para contar), o batimento da caixa continua, e as linhas do motor tapam o silêncio.
// A regra 9 do desenho pede o tempo sem leituras contado, e que só passe o que se resolver sozinho.
function umSegundoSemMovimento (c, agora, s, sensor) {
  c.linha(bat1(s * 1000, { sim: 0, sensor }))
  c.linha(bat2(s * 1000 + 300))
  c.linha(escrever('L', [s * 1000, s * 26, 38462]))
  c.linha(motor(s))
  agora.passa(1000)
  c.tique()
}
const umSegundoAMedir = (c, agora, s, n0) => {
  c.linha(bat1(s * 1000, { sim: 0, sensor: 0 }))
  c.linha(bat2(s * 1000 + 300))
  c.linha(escrever('L', [s * 1000, s * 26, 38462]))
  for (let i = 0; i < 10; i++) c.linha(mov(n0 + i))
  c.linha(motor(s))
  agora.passa(1000)
  c.tique()
}

test('o sensor cala-se a meio e não volta: o ensaio não sai limpo, e diz há quanto tempo não há movimento', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 60; s++) umSegundoAMedir(c, agora, s, s * 10)
  assert.equal(c.veredicto().limpo, true)
  assert.doesNotMatch(c.resumo(), /sem movimento/)
  // cala-se: primeiro a caixa tenta acordá-lo (estado 2), depois dá-o por perdido (estado 3)
  for (let s = 61; s <= 150; s++) umSegundoSemMovimento(c, agora, s, s <= 70 ? 2 : 3)
  const v = c.veredicto()
  assert.equal(v.limpo, false, 'um sensor calado há minuto e meio não pode dar LIMPO')
  assert.ok(c.segundosSemMovimento() >= 89 && c.segundosSemMovimento() <= 91, `${c.segundosSemMovimento()} s sem movimento`)
  assert.match(v.falhas.join(' | '), /acabou com o sensor de movimento sem medir \(estado 3\)/)
  assert.match(v.falhas.join(' | '), /9[01] s sem movimento no fim do ensaio|89 s sem movimento no fim do ensaio/)
  assert.match(c.resumo(), /(89|90|91) s sem movimento/)
  // o resto esteve sempre bem: são só essas as falhas
  assert.equal(v.falhas.length, 2, v.falhas.join(' | '))
})

test('o sensor cala-se 8 s e volta sozinho: o ensaio passa, com os segundos sem movimento à vista', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 60; s++) umSegundoAMedir(c, agora, s, s * 10)
  for (let s = 61; s <= 68; s++) umSegundoSemMovimento(c, agora, s, 2)
  // volta: o número de ordem continua de onde ia (a caixa não o avança enquanto o sensor está calado)
  for (let s = 69; s <= 130; s++) umSegundoAMedir(c, agora, s, 610 + (s - 69) * 10)
  const v = c.veredicto()
  assert.deepEqual(v.falhas, [], 'um bloqueio que se resolve sozinho passa (regra 9)')
  assert.equal(c.c.leiturasEmFalta, 0)
  assert.ok(c.segundosSemMovimento() >= 7 && c.segundosSemMovimento() <= 9, `${c.segundosSemMovimento()} s sem movimento`)
  assert.match(c.resumo(), /[789] s sem movimento/)
  assert.equal(c.c.mudancasDoSensor, 2)
})

test('um ensaio em que o sensor nunca chegou a medir não sai limpo', () => {
  const agora = relogio()
  const c = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 30; s++) umSegundoSemMovimento(c, agora, s, 3)
  const v = c.veredicto()
  assert.equal(v.limpo, false)
  assert.match(v.falhas.join(' | '), /sem medir \(estado 3\)/)
  assert.match(v.falhas.join(' | '), /(29|30) s sem movimento no fim do ensaio/)
})

test('uma caixa de programa antigo, que não diz o estado do sensor nem manda movimento, não é acusada de o ter calado', () => {
  const agora = relogio()
  const c = novoContador({ agora })
  for (let s = 1; s <= 30; s++) {
    c.linha(escrever('B', [1, s * 1000, '0.2.0', 0, 0, 0]))
    c.linha(escrever('L', [s * 1000, s * 26, 38462]))
    agora.passa(1000)
    c.tique()
  }
  assert.deepEqual(c.veredicto().falhas, [])
  assert.equal(c.segundosSemMovimento(), 0)
})

test('pedido o motor: sem tramas do motor, ou com elas a pararem antes do fim, o ensaio não sai limpo', () => {
  const agora = relogio()
  const sem = novoContador({ agora, duasCaixas: true, motor: true })
  for (let s = 1; s <= 30; s++) {
    sem.linha(bat1(s * 1000, { sim: 0, sensor: 0 }))
    sem.linha(bat2(s * 1000 + 300))
    for (let i = 0; i < 10; i++) sem.linha(mov(s * 10 + i))
    agora.passa(1000)
    sem.tique()
  }
  assert.match(sem.veredicto().falhas.join(' | '), /nenhuma trama do motor chegou/)

  const com = novoContador({ agora, duasCaixas: true, motor: true })
  for (let s = 1; s <= 30; s++) umSegundoAMedir(com, agora, s, s * 10)
  assert.deepEqual(com.veredicto().falhas, [])
  // o motor deixa de chegar nos últimos 20 s (o resto continua)
  for (let s = 31; s <= 50; s++) {
    com.linha(bat1(s * 1000, { sim: 0, sensor: 0 }))
    com.linha(bat2(s * 1000 + 300))
    for (let i = 0; i < 10; i++) com.linha(mov(s * 10 + i))
    agora.passa(1000)
    com.tique()
  }
  assert.match(com.veredicto().falhas.join(' | '), /(19|20|21) s sem tramas do motor no fim do ensaio/)

  // sem ser pedido, o motor não entra no veredicto
  const livre = novoContador({ agora, duasCaixas: true })
  for (let s = 1; s <= 30; s++) {
    livre.linha(bat1(s * 1000, { sim: 0, sensor: 0 }))
    livre.linha(bat2(s * 1000 + 300))
    for (let i = 0; i < 10; i++) livre.linha(mov(s * 10 + i))
    agora.passa(1000)
    livre.tique()
  }
  assert.deepEqual(livre.veredicto().falhas, [])
})

// Um sensor que recomeça sozinho e volta logo não muda de estado no batimento nem leva toque: só se vê
// nos contadores do comando "sensor", lidos no princípio e no fim do ensaio.
test('os contadores do sensor, do princípio ao fim do ensaio: diz-se o que mudou', () => {
  const { mudancasDoSensor } = require('./contador')
  const antes = 'estado=0;fase=7;toques=2;recomecos=0;deitadas=0;ilegiveis=1;guardadas=0;por-guardar=0;calado-ms=0'
  assert.equal(mudancasDoSensor(antes, antes), 'sensor, do princípio ao fim: nada mudou (toques no RST 2, recomeços sozinho 0, leituras deitadas fora 0, ilegíveis 1)')
  const depois = 'estado=0;fase=7;toques=3;recomecos=2;deitadas=0;ilegiveis=5;guardadas=0;por-guardar=0;calado-ms=0'
  assert.equal(mudancasDoSensor(antes, depois), 'sensor, do princípio ao fim: toques no RST +1, recomeços sozinho +2, ilegíveis +4')
  // a caixa recomeçou a meio: os contadores voltaram a zero e a diferença não quer dizer nada
  const menos = 'estado=0;fase=7;toques=0;recomecos=0;deitadas=0;ilegiveis=0;guardadas=0;por-guardar=0;calado-ms=0'
  assert.match(mudancasDoSensor(antes, menos), /a caixa recomeçou/)
  // um programa antigo não conhece o comando
  assert.equal(mudancasDoSensor('desconhecido', 'desconhecido'), null)
  assert.equal(mudancasDoSensor(null, depois), null)
})
