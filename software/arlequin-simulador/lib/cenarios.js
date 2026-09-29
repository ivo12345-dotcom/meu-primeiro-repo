'use strict'
// Cenários prontos. Cada passo: { horas, navegar, motor, frigorifico, sol, vMotor }.
// motor: true | false | 'auto' (liga a 55% e desliga a 85%, como o Ivo faria).

const CENARIOS = {
  // Um dia no porto com o Pi sempre ligado, depois quatro dias a navegar
  // de inverno com o frigorífico, carregando com o motor quando o alarme pede.
  'inverno-navegar': {
    descricao: '1 dia no porto + 4 dias a navegar de inverno (motor auto)',
    opcoes: { socInicial: 0.65, horasSolPico: 2.7, nascer: 7.9, por: 17.4 },
    passos: [
      { horas: 24 },
      { horas: 96, navegar: true, frigorifico: true, motor: 'auto' }
    ]
  },
  // Sem motor: o serviço desce até ao alarme crítico (testa o < 50%).
  'descarga-critica': {
    descricao: 'a navegar sem sol nem motor até abaixo de 50%',
    opcoes: { socInicial: 0.62, fatorSolar: 0 },
    passos: [{ horas: 30, navegar: true, frigorifico: true }]
  },
  // Bateria do motor a perder tensão com o barco parado.
  'motor-fraca': {
    descricao: 'bateria do motor desce para 12,0 V',
    opcoes: { socInicial: 0.9 },
    passos: [{ horas: 2 }, { horas: 2, vMotor: 12.0 }, { horas: 1, vMotor: 12.6 }]
  },
  // Verão a navegar sem piloto: o sol chega, não deve haver alarmes.
  'verao-navegar': {
    descricao: '3 dias a navegar de verão sem piloto (motor auto, não deve ser preciso)',
    opcoes: { socInicial: 0.8, horasSolPico: 6.5, nascer: 6.4, por: 21.0 },
    passos: [{ horas: 72, navegar: true, frigorifico: true, motor: 'auto' }]
  }
}

// Expande os passos numa função: minuto desde o início -> passo ativo (ou null no fim).
function passoEm (cenario, minuto) {
  let acumulado = 0
  for (const p of cenario.passos) {
    acumulado += p.horas * 60
    if (minuto < acumulado) return p
  }
  return null
}

module.exports = { CENARIOS, passoEm }
