'use strict'
// Regras dos alarmes de energia do Arlequin. Lógica pura: não sabe nada do
// SignalK. Recebe uma leitura e a hora, devolve o novo estado e as
// notificações a publicar (só quando algo muda ou quando é hora de repetir).

const MIN = 60 * 1000

const LIMITES = Object.freeze({
  ligar: 0.55, // SoC a que se pede para ligar o motor
  ligarLimpa: 0.58, // histerese do aviso de ligar
  desligar: 0.85, // SoC a que se diz que já pode desligar
  critico: 0.50, // abaixo disto as AGM estragam-se
  criticoLimpa: 0.52,
  motorFraca: 12.2, // V do banco do motor, em repouso
  motorFracaLimpa: 12.4,
  rpmLigado: 5, // Hz (300 rpm)
  sogNavegar: 0.514, // m/s (1 nó)
  janelaNavegar: 5 * MIN, // tempo contínuo para mudar navegar/parado
  motorParadoMin: 5 * MIN, // repouso antes de julgar a bateria do motor
  repetir: 30 * MIN, // repetição do aviso de ligar o motor
  dadosVelhos: 5 * MIN // SoC sem atualizar há mais disto = sensor perdido
})

function novoEstado () {
  return {
    ativos: {}, // id -> { desde, ultimoEnvio }
    navegar: { estado: false, candidatoDesde: null },
    motor: { ligado: false, paradoDesde: null, paraCarregar: false }
  }
}

// Arredonda para baixo: 49,9% aparece como 49%, nunca como "50% — abaixo de 50%".
const pct = (soc) => `${Math.floor(soc * 100 + 1e-9)}%`
const volts = (v) => `${v.toFixed(1).replace('.', ',')} V`

const MENSAGENS = {
  ligarMotor: (l) => `Serviço a ${pct(l.soc)} — liga o motor para carregar`,
  desligarMotor: (l) => `Serviço a ${pct(l.soc)} — já podes desligar o motor`,
  servicoCritico: (l) => `Serviço a ${pct(l.soc)} — abaixo de 50%, as AGM estragam-se`,
  motorFraca: (l) => `Bateria do motor a ${volts(l.vMotor)} — pode não arrancar`,
  sensorPerdido: () => 'Sem dados do SmartShunt há mais de 5 min'
}

const GRAVIDADE = {
  ligarMotor: 'warn',
  desligarMotor: 'warn',
  servicoCritico: 'alarm',
  motorFraca: 'alarm',
  sensorPerdido: 'warn'
}

// Decide se a notificação leva som. Os alarmes tocam sempre. Os avisos ficam
// só no ecrã de noite com o barco parado; o sensor perdido nunca toca.
function metodo (id, leitura, navegar) {
  if (GRAVIDADE[id] === 'alarm') return ['visual', 'sound']
  if (id === 'sensorPerdido') return ['visual']
  if (leitura.modo === 'night' && !navegar) return ['visual']
  return ['visual', 'sound']
}

function atualizarNavegar (nav, sog, agora, lim) {
  const acima = typeof sog === 'number' && sog > lim.sogNavegar
  if (acima === nav.estado) return { estado: nav.estado, candidatoDesde: null }
  const desde = nav.candidatoDesde ?? agora
  if (agora - desde >= lim.janelaNavegar) return { estado: acima, candidatoDesde: null }
  return { estado: nav.estado, candidatoDesde: desde }
}

// paraCarregar: o motor arrancou COM a bateria baixa (aviso dos 55% ativo ou
// abaixo de 58%). Só então faz sentido dizer "já podes desligar" aos 85%. Sair
// da marina a motor com a bateria cheia não é uma carga (visto na simulação
// Algés → Peniche de 29/09: apitava ao largar).
function atualizarMotor (motor, rpm, agora, lim, ativos = {}, soc = null) {
  const ligado = typeof rpm === 'number' && rpm > lim.rpmLigado
  if (ligado) {
    const arrancou = !motor.ligado
    const paraCarregar = arrancou
      ? !!ativos.ligarMotor || (typeof soc === 'number' && soc <= lim.ligarLimpa)
      : !!motor.paraCarregar
    return { ligado: true, paradoDesde: null, paraCarregar }
  }
  return { ligado: false, paradoDesde: motor.paradoDesde ?? agora, paraCarregar: false }
}

// Para cada alarme: true = deve ficar ativo, false = deve limpar,
// null = não se pode julgar agora (mantém como está).
function condicoes (ativos, l, motor, agora, lim) {
  const socFresco = typeof l.soc === 'number' && agora - l.socEm <= lim.dadosVelhos
  const c = { sensorPerdido: !socFresco }

  if (socFresco) {
    c.ligarMotor = ativos.ligarMotor
      ? l.soc <= lim.ligarLimpa && !motor.ligado
      : l.soc <= lim.ligar && !motor.ligado
    c.desligarMotor = motor.ligado && motor.paraCarregar && (ativos.desligarMotor ? true : l.soc >= lim.desligar)
    c.servicoCritico = ativos.servicoCritico ? l.soc <= lim.criticoLimpa : l.soc < lim.critico
  } else {
    c.ligarMotor = c.desligarMotor = c.servicoCritico = null
  }

  if (motor.ligado) {
    c.motorFraca = false // o motor arrancou e o alternador está a carregar
  } else if (typeof l.vMotor === 'number' && agora - motor.paradoDesde >= lim.motorParadoMin) {
    c.motorFraca = ativos.motorFraca ? l.vMotor <= lim.motorFracaLimpa : l.vMotor < lim.motorFraca
  } else {
    c.motorFraca = null
  }
  return c
}

function avaliar (estado, leitura, agora, lim = LIMITES) {
  const navegar = atualizarNavegar(estado.navegar, leitura.sog, agora, lim)
  const motor = atualizarMotor(estado.motor, leitura.rpm, agora, lim, estado.ativos, leitura.soc)
  const ativos = { ...estado.ativos }
  const notificacoes = []
  const cond = condicoes(ativos, leitura, motor, agora, lim)

  const emitir = (id) => notificacoes.push({
    id,
    state: GRAVIDADE[id],
    method: metodo(id, leitura, navegar.estado),
    message: MENSAGENS[id](leitura)
  })

  for (const [id, deve] of Object.entries(cond)) {
    if (deve === null) continue
    const ativo = ativos[id]
    if (deve && !ativo) {
      ativos[id] = { desde: agora, ultimoEnvio: agora }
      emitir(id)
    } else if (!deve && ativo) {
      delete ativos[id]
      notificacoes.push({ id, state: 'normal', method: [], message: 'Normal' })
    } else if (deve && id === 'ligarMotor' && agora - ativo.ultimoEnvio >= lim.repetir) {
      ativos[id] = { ...ativo, ultimoEnvio: agora }
      emitir(id)
    }
  }

  return { estado: { ativos, navegar, motor }, notificacoes }
}

module.exports = { LIMITES, novoEstado, avaliar, metodo }
