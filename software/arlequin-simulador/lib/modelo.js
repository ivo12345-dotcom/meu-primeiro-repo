'use strict'
// Modelo simples do sistema elétrico do Arlequin para testes em casa.
// Números do balanço de energia (NAVEGACAO.md §5b/§5c). Lógica pura.

const H = 3600 * 1000

const PADRAO = Object.freeze({
  capacidadeAh: 440, // bancos 2+3 AGM
  socInicial: 0.9,
  paineisW: [305, 305],
  fatorSolar: 0.65, // perdas, painel deitado, sombras (0,55–0,75)
  horasSolPico: 5.0, // sol útil por dia: inverno 2,7 · primavera 5,0 · verão 6,5
  nascer: 7.5, // hora local
  por: 19.5,
  consumoPortoA: 1.1, // ~27 Ah/dia
  consumoNavegarA: 1.7, // extra a navegar (instrumentos, ecrãs, VHF, AIS)
  consumoNoiteNavegarA: 1.75, // radar + luzes de navegação à noite (~21 Ah/noite)
  frigorificoA: 1.5, // ~35 Ah/dia
  alternadorA: 60,
  rpmMotorHz: 30, // 1800 rpm
  sogNavegarMs: 2.57, // 5 nós
  vMotorRepouso: 12.7
})

function criarModelo (opcoes = {}, inicioMs = Date.now()) {
  const c = { ...PADRAO, ...opcoes }
  return { c, t: inicioMs, ah: c.capacidadeAh * c.socInicial, motor: false }
}

function horaLocal (t) {
  const d = new Date(t)
  return d.getHours() + d.getMinutes() / 60
}

// Curva em sino entre o nascer e o pôr do sol, escalada para que a energia
// do dia dê exatamente as horas de sol de pico.
function solarW (c, hora, sol = 1) {
  if (hora <= c.nascer || hora >= c.por) return c.paineisW.map(() => 0)
  const dia = c.por - c.nascer
  const pico = Math.PI * c.horasSolPico / (2 * dia)
  const f = pico * Math.sin(Math.PI * (hora - c.nascer) / dia)
  return c.paineisW.map(w => w * c.fatorSolar * f * sol)
}

// As AGM aceitam tudo até 80%; depois a corrente cai até zero nos 100%.
function limiteAceitacaoA (c, soc) {
  return c.capacidadeAh * 0.25 * Math.min(1, (1 - soc) / 0.2)
}

// passo: { navegar, motor: true|false|'auto', frigorifico, sol, vMotor }
// 'auto' imita o Ivo: liga a 55% e desliga a 85%.
function avancar (m, dtMs, passo = {}) {
  const c = m.c
  const t = m.t + dtMs
  const hora = horaLocal(t)
  const noite = hora < c.nascer || hora >= c.por
  let soc = m.ah / c.capacidadeAh

  let motor = passo.motor ?? false
  if (motor === 'auto') motor = m.motor ? soc < 0.85 : soc <= 0.55

  const pv = solarW(c, hora, passo.sol ?? 1)
  const cargaA = pv.reduce((a, b) => a + b, 0) / 13.5 + (motor ? c.alternadorA : 0)
  const consumoA = c.consumoPortoA +
    (passo.navegar ? c.consumoNavegarA : 0) +
    (passo.navegar && noite ? c.consumoNoiteNavegarA : 0) +
    (passo.frigorifico ? c.frigorificoA : 0)
  const entraA = Math.min(cargaA, limiteAceitacaoA(c, soc))
  const corrente = entraA - consumoA

  const ah = Math.min(c.capacidadeAh, Math.max(0, m.ah + corrente * dtMs / H))
  soc = ah / c.capacidadeAh
  const tensao = 11.9 + 0.9 * soc + (corrente > 0 ? 0.8 : 0)
  const vMotor = motor ? 14.2 : (passo.vMotor ?? c.vMotorRepouso)

  return {
    modelo: { c, t, ah, motor },
    leitura: {
      t,
      soc,
      tensao,
      corrente,
      vMotor,
      rpm: motor ? c.rpmMotorHz : 0,
      sog: passo.navegar ? c.sogNavegarMs : 0.05,
      modo: noite ? 'night' : 'day',
      pv
    }
  }
}

module.exports = { PADRAO, criarModelo, avancar, solarW, limiteAceitacaoA }
