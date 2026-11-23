'use strict'
// O estado de cada caixa, pelo batimento que manda de segundo a segundo, e o aviso de caixa calada.
//   caixa 1 (instrumentos): 'a-receber' com um batimento há 5 s ou menos; senão 'sem-ligacao', com o
//     motivo (a porta não abre, ou está aberta e a caixa não fala).
//   caixa 2 (motor): o batimento dela chega pela caixa 1. Sem a caixa 1 não se sabe nada da 2.
// Só a caixa 1 dá aviso daqui: o da caixa 2 dá-o o plugin do motor (o semLigacao dele, com o motivo).
// "A fingir" é das duas: se uma disser que finge, tudo o que sai é marcado como simulado.
// O sensor de movimento: a caixa 1 diz no batimento como ele está (a medir, a arrancar, calado, não
// volta, a fingir). "Não volta" dá aviso logo; calado ou a arrancar só ao fim de 20 s seguidos sem
// medir, porque um recomeço do sensor resolve-se em segundos e não é notícia.
// As funções não mexem no estado que recebem: devolvem um novo.

const VELHO = 5000 // um batimento mais velho do que isto já não conta
const ESPERA = 30000 // uma caixa que nunca falou só dá aviso ao fim deste tempo
const SEM_MEDIR = 20000 // o sensor calado ou a arrancar há mais do que isto dá aviso
// Depois do último batimento a dizer que uma caixa fingia, tudo continua marcado como simulado durante
// este tempo: o batimento vem de segundo a segundo, por isso a última linha a fingir pode ter saído até
// um segundo depois dele, e vale 5 s no plugin (o último vento, a última atitude, a janela do log);
// mais um segundo de folga. Sem isto, uma caixa que deixa de fingir (ou recomeça) deixava sair esses
// restos como medição verdadeira.
const PRESO = VELHO + 2000
const SENSOR = ['a-medir', 'a-arrancar', 'calado', 'nao-volta', 'a-fingir'] // pela ordem do número que a caixa manda

const ACESO = (motivo) => ({
  id: 'caixa1',
  state: 'warn',
  method: ['visual', 'sound'],
  apito: 'curto',
  message: `A caixa dos instrumentos (vento, velocidade, proa) deixou de falar: ${motivo}`
})
const APAGADO = { id: 'caixa1', state: 'normal', method: [], message: 'Normal' }
const SENSOR_ACESO = {
  id: 'sensor',
  state: 'warn',
  method: ['visual', 'sound'],
  apito: 'curto',
  message: 'O sensor de movimento não responde: sem proa nem adornamento'
}
const SENSOR_APAGADO = { id: 'sensor', state: 'normal', method: [], message: 'Normal' }

// O sensor está bem quando mede ou quando a caixa finge por ele; se a caixa nada diz, não se sabe.
const semQueixa = (codigo) => codigo === null || codigo === 0 || codigo === 4

function novoEstadoCaixas (agora) {
  return {
    desde: agora, // o arranque
    batimentos: { 1: null, 2: null }, // a hora do último de cada caixa
    fingem: { 1: false, 2: false }, // o que cada caixa disse de si no último batimento dela
    fingiu: null, // a hora do último batimento, de qualquer das duas, a dizer que fingia
    porta: { aberta: false, nome: '', motivo: '' },
    falou: false, // a caixa 1 já falou alguma vez
    aviso: false, // o aviso caixa1 está aceso
    sensor: null, // o número que a caixa 1 disse do sensor no último batimento (null: não disse)
    semMedirDesde: null, // a hora do primeiro batimento seguido em que o sensor não media
    avisoSensor: false // o aviso sensor está aceso
  }
}

function anotarBatimento (estado, batimento, agora) {
  const e = {
    ...estado,
    batimentos: { ...estado.batimentos, [batimento.caixa]: agora },
    fingem: { ...estado.fingem, [batimento.caixa]: batimento.sim === true },
    fingiu: batimento.sim === true ? agora : estado.fingiu
  }
  if (batimento.caixa === 1) {
    e.falou = true
    e.sensor = Number.isInteger(batimento.sensor) && batimento.sensor >= 0 && batimento.sensor < SENSOR.length ? batimento.sensor : null
    e.semMedirDesde = semQueixa(e.sensor) ? null : (estado.semMedirDesde ?? agora)
  }
  return e
}

function anotarPorta (estado, { aberta, nome = '', motivo = '' }, agora) {
  return { ...estado, porta: { aberta: aberta === true, nome, motivo, desde: agora } }
}

const fresco = (hora, agora) => hora !== null && agora - hora <= VELHO

function avaliarCaixas (estado, agora) {
  const viva1 = fresco(estado.batimentos[1], agora)
  const viva2 = fresco(estado.batimentos[2], agora)
  let motivo1 = ''
  if (!viva1) {
    if (!estado.porta.aberta) {
      motivo1 = `a porta ${estado.porta.nome || '(por escolher)'} não abre${estado.porta.motivo ? `: ${estado.porta.motivo}` : ''}`
    } else {
      const desde = estado.batimentos[1] ?? estado.desde
      motivo1 = `a caixa não fala há ${Math.round((agora - desde) / 1000)} s`
    }
  }
  const caixas = {
    1: { estado: viva1 ? 'a-receber' : 'sem-ligacao', motivo: motivo1 },
    2: !viva1
      ? { estado: 'sem-ligacao', motivo: 'sem a caixa dos instrumentos não se sabe' }
      : viva2
        ? { estado: 'a-receber', motivo: '' }
        : { estado: 'sem-ligacao', motivo: 'a caixa do motor não dá sinal (sem corrente ou fora do alcance do rádio)' }
  }
  const notificacoes = []
  let aviso = estado.aviso
  const calou = !viva1 && (estado.falou || agora - estado.desde > ESPERA)
  if (calou && !aviso) {
    aviso = true
    notificacoes.push(ACESO(motivo1))
  } else if (viva1 && aviso) {
    aviso = false
    notificacoes.push(APAGADO)
  }
  // O sensor: só se sabe dele enquanto a caixa 1 falar. Com ela calada, o aviso fica como estava.
  const codigo = viva1 ? estado.sensor : null
  let avisoSensor = estado.avisoSensor
  if (viva1) {
    const falha = codigo === 3 || ((codigo === 1 || codigo === 2) && agora - estado.semMedirDesde > SEM_MEDIR)
    if (falha && !avisoSensor) {
      avisoSensor = true
      notificacoes.push(SENSOR_ACESO)
    } else if (semQueixa(codigo) && avisoSensor) {
      avisoSensor = false
      notificacoes.push(SENSOR_APAGADO)
    }
  }
  // A fingir: basta uma das duas dizê-lo, porque o que a caixa do motor manda entra na mesma linha da
  // caixa negra do que o resto. O que a caixa do motor disse só conta enquanto ela der sinal. E fica
  // preso uns segundos depois do último batimento a dizer que fingia (ver PRESO), enquanto o que ela
  // mandou a fingir ainda vale.
  const preso = estado.fingiu !== null && agora - estado.fingiu <= PRESO
  const sim = estado.fingem[1] || (viva2 && estado.fingem[2]) || preso
  return { estado: { ...estado, aviso, avisoSensor }, caixas, sim, sensor: codigo === null ? null : SENSOR[codigo], notificacoes }
}

module.exports = { VELHO, ESPERA, SEM_MEDIR, PRESO, novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas }
