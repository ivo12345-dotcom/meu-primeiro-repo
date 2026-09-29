'use strict'
// Consumo por milha ao vivo e curva aprendida no barco: em regime estável,
// guarda por faixas de 200 rpm a velocidade e o consumo médios. Assim sabe-se
// qual é o regime mais económico do Arlequin com o hélice e o casco reais.

const NO = 1852 / 3600
const FAIXA = 200
const MIN_AMOSTRAS = 60 // 1 min de dados estáveis por faixa
const MIN_NOS = 3 // abaixo disto não é um regime de navegar

// L/h ÷ nós (só a andar mais de 0,5 nó)
function litrosPorMilha (lh, velMs) {
  if (typeof lh !== 'number' || typeof velMs !== 'number' || velMs < 0.5 * NO) return null
  return lh / (velMs / NO)
}

function criarDetetor () {
  return { amostras: [] } // [{ t, rpm }] dos últimos 30 s
}

// Estável = há 30 s de rotações e todas dentro de 60 rpm.
function estavel (d, rpm, t) {
  const amostras = [...d.amostras.filter(a => a.t >= t - 30000), { t, rpm }]
  const cheio = amostras[0].t <= t - 29000
  const rs = amostras.map(a => a.rpm)
  return { d: { amostras }, estavel: cheio && Math.max(...rs) - Math.min(...rs) <= 60 }
}

function novaCurva () {
  return { faixas: {} } // de → { n, somaVel, somaLh }
}

function amostra (c, { rpm, lh, vel }) {
  const de = Math.floor(rpm / FAIXA) * FAIXA
  const f = c.faixas[de] || { n: 0, somaVel: 0, somaLh: 0 }
  return { faixas: { ...c.faixas, [de]: { n: f.n + 1, somaVel: f.somaVel + vel, somaLh: f.somaLh + lh } } }
}

function resumo (c) {
  const faixas = Object.entries(c.faixas)
    .map(([de, f]) => ({ de: Number(de), ate: Number(de) + FAIXA, n: f.n, nos: f.somaVel / f.n / NO, lh: f.somaLh / f.n }))
    .filter(f => f.n >= MIN_AMOSTRAS)
    .map(f => ({ ...f, lmn: f.lh / f.nos }))
    .sort((a, b) => a.de - b.de)
  const candidatas = faixas.filter(f => f.nos >= MIN_NOS)
  const melhor = candidatas.reduce((m, f) => (!m || f.lmn < m.lmn ? f : m), null)
  return { faixas, melhor }
}

module.exports = { litrosPorMilha, criarDetetor, estavel, novaCurva, amostra, resumo }
