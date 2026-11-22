'use strict'
// O estado de cada caixa, pelo batimento que manda de segundo a segundo, e o aviso de caixa calada.
//   caixa 1 (instrumentos): 'a-receber' com um batimento há 5 s ou menos; senão 'sem-ligacao', com o
//     motivo (a porta não abre, ou está aberta e a caixa não fala).
//   caixa 2 (motor): o batimento dela chega pela caixa 1. Sem a caixa 1 não se sabe nada da 2.
// Só a caixa 1 dá aviso daqui: o da caixa 2 dá-o o plugin do motor (o semLigacao dele, com o motivo).
// "A fingir" é das duas: se uma disser que finge, tudo o que sai é marcado como simulado.
// As funções não mexem no estado que recebem: devolvem um novo.

const VELHO = 5000 // um batimento mais velho do que isto já não conta
const ESPERA = 30000 // uma caixa que nunca falou só dá aviso ao fim deste tempo

const ACESO = (motivo) => ({
  id: 'caixa1',
  state: 'warn',
  method: ['visual', 'sound'],
  apito: 'curto',
  message: `A caixa dos instrumentos (vento, velocidade, proa) deixou de falar: ${motivo}`
})
const APAGADO = { id: 'caixa1', state: 'normal', method: [], message: 'Normal' }

function novoEstadoCaixas (agora) {
  return {
    desde: agora, // o arranque
    batimentos: { 1: null, 2: null }, // a hora do último de cada caixa
    fingem: { 1: false, 2: false }, // o que cada caixa disse de si no último batimento dela
    porta: { aberta: false, nome: '', motivo: '' },
    falou: false, // a caixa 1 já falou alguma vez
    aviso: false // o aviso caixa1 está aceso
  }
}

function anotarBatimento (estado, batimento, agora) {
  const e = {
    ...estado,
    batimentos: { ...estado.batimentos, [batimento.caixa]: agora },
    fingem: { ...estado.fingem, [batimento.caixa]: batimento.sim === true }
  }
  if (batimento.caixa === 1) e.falou = true
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
  // A fingir: basta uma das duas dizê-lo, porque o que a caixa do motor manda entra na mesma linha da
  // caixa negra do que o resto. O que a caixa do motor disse só conta enquanto ela der sinal.
  const sim = estado.fingem[1] || (viva2 && estado.fingem[2])
  return { estado: { ...estado, aviso }, caixas, sim, notificacoes }
}

module.exports = { VELHO, ESPERA, novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas }
