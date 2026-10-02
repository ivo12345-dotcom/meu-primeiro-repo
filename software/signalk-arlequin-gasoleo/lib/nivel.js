'use strict'
// Nível do gasóleo a partir da sonda resistiva original (boia de braço), lida
// pelo ADS1115: razão sonda/alimentação → tabela → mediana sem adorno → fusão
// com o consumo do motor. Alarmes de reserva e de fuga. Lógica pura.
// Limites aprovados pelo Ivo (29/09): reserva 40 L; fuga > 5 L em 12 h parado.

const S = 1000
const MIN = 60 * S
const H = 60 * MIN

const LIMITES = Object.freeze({
  reserva: 40, reservaLimpa: 45, // L
  fugaLitros: 5, fugaJanela: 12 * H,
  abastecimento: 10, // L acima do estimado, com o motor parado
  adornoMax: 5 * Math.PI / 180,
  janela: 3 * MIN, minAmostras: 60,
  intervaloCorrecao: 30 * S,
  alfaParado: 0.5, alfaMotor: 0.1,
  sessaoMinima: 1, // L esperados para valer a pena comparar
  consumoMargemL: 3, consumoMargemRel: 0.3 // aviso se gastar > esperado + max(3 L, 30%)
})

// Interpolação linear na tabela [{ razao, litros }] (crescente ou decrescente).
function litrosDaRazao (tabela, razao) {
  if (!Array.isArray(tabela) || tabela.length < 2 || typeof razao !== 'number') return null
  const t = [...tabela].sort((a, b) => a.razao - b.razao)
  if (razao <= t[0].razao) return t[0].litros
  if (razao >= t[t.length - 1].razao) return t[t.length - 1].litros
  for (let i = 1; i < t.length; i++) {
    if (razao <= t[i].razao) {
      const a = t[i - 1]
      const b = t[i]
      return a.litros + (b.litros - a.litros) * (razao - a.razao) / (b.razao - a.razao)
    }
  }
  return null
}

function mediana (xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function novoEstado () {
  return {
    janela: [], litros: null, ultimaCorrecao: null, ultimoT: null, mediana: null, razao: null, razaoMediana: null, parado: [], ativos: {},
    motorAntes: false, // estado do motor no passo anterior
    ultimaParado: null, // última mediana com o motor parado (referência antes de arrancar)
    sessao: null, // { antes, esperado } durante e depois de uma saída a motor
    ultimaSessao: null // { medido, esperado, fatorSugerido } da última comparação
  }
}

// O consumo do motor desde a última amostra e as mudanças do motor (ligou/parou). É o 1.º passo de
// cada amostra e, sem a sonda (ADS1115 calado, auditoria I-12), o único: os litros continuam a
// descer com o consumo do J1939 e a saída a motor continua a contar o esperado.
// l: { t, fuelRate (m³/s) | null, motorLigado }
function descontar (e0, l) {
  const e = { ...e0 }
  if (e.ultimoT !== null && typeof l.fuelRate === 'number' && l.motorLigado) {
    const gasto = l.fuelRate * 1000 * (l.t - e.ultimoT) / 1000
    if (e.litros !== null) e.litros = Math.max(0, e.litros - gasto)
    if (e.sessao) e.sessao = { ...e.sessao, esperado: e.sessao.esperado + gasto }
  }
  e.ultimoT = l.t
  if (l.motorLigado) e.parado = [] // a janela da fuga só conta com o motor parado
  // Ao mudar o motor, a janela recomeça: as medianas não misturam parado e a trabalhar.
  if (l.motorLigado !== e.motorAntes) {
    e.janela = []
    if (l.motorLigado) e.sessao = e.ultimaParado !== null ? { antes: e.ultimaParado, esperado: 0 } : null
  }
  e.motorAntes = l.motorLigado
  return e
}

// l: { t, sonda (V), alimentacao (V), roll (rad) | null, fuelRate (m³/s) | null, motorLigado }
function passo (e0, l, tabela, lim = LIMITES) {
  // 1. Consumo desde a última amostra (e o esperado da saída a motor); o motor a mudar.
  const e = { ...descontar(e0, l), ativos: { ...e0.ativos } }
  const notificacoes = []
  let abastecimento = null

  // 2. Amostra: razão → litros, só com o barco direito.
  const razao = l.alimentacao > 1 ? l.sonda / l.alimentacao : null
  e.razao = razao
  const direito = typeof l.roll !== 'number' || Math.abs(l.roll) < lim.adornoMax
  const litrosSonda = litrosDaRazao(tabela, razao)
  e.janela = e.janela.filter(a => a.t > l.t - lim.janela)
  if (direito && razao !== null) e.janela.push({ t: l.t, razao, litros: litrosSonda })

  // 3. De 30 em 30 s: mediana, correção, abastecimento, fuga.
  if (e.ultimaCorrecao === null || l.t - e.ultimaCorrecao >= lim.intervaloCorrecao) {
    e.ultimaCorrecao = l.t
    const cheia = e.janela.length >= lim.minAmostras
    // A razão mediana serve para calibrar, mesmo antes de haver tabela.
    e.razaoMediana = cheia ? mediana(e.janela.map(a => a.razao)) : null
    const comLitros = e.janela.filter(a => a.litros !== null)
    e.mediana = cheia && comLitros.length >= lim.minAmostras ? mediana(comLitros.map(a => a.litros)) : null
    if (e.mediana !== null) {
      if (e.litros === null) {
        e.litros = e.mediana
      } else if (!l.motorLigado && e.mediana - e.litros > lim.abastecimento) {
        abastecimento = { antes: e.litros, depois: e.mediana, delta: e.mediana - e.litros }
        e.litros = e.mediana
        e.parado = []
      } else {
        e.litros += (l.motorLigado ? lim.alfaMotor : lim.alfaParado) * (e.mediana - e.litros)
      }
      if (!l.motorLigado) {
        e.parado = [...e.parado.filter(p => p.t > l.t - lim.fugaJanela), { t: l.t, litros: e.mediana }]
        // Depois de uma saída a motor: o que baixou contra o esperado.
        if (e.sessao && !abastecimento && e.sessao.esperado >= lim.sessaoMinima) {
          const medido = e.sessao.antes - e.mediana
          const esperado = e.sessao.esperado
          e.ultimaSessao = { medido, esperado, fatorSugerido: medido / esperado }
          const excesso = medido - esperado
          const anormal = excesso > Math.max(lim.consumoMargemL, lim.consumoMargemRel * esperado)
          const f = (x) => x.toFixed(1).replace('.', ',')
          if (anormal && !e.ativos.consumoAnormal) {
            e.ativos.consumoAnormal = true
            notificacoes.push({ id: 'consumoAnormal', state: 'warn', method: ['visual', 'sound'], message: `Gastou ${f(medido)} L em vez de ~${f(esperado)} L: possível fuga ou avaria no motor` })
          } else if (!anormal && e.ativos.consumoAnormal) {
            delete e.ativos.consumoAnormal
            notificacoes.push({ id: 'consumoAnormal', state: 'normal', method: [], message: 'Normal' })
          }
        }
        e.sessao = null
        e.ultimaParado = e.mediana
      }
    }
  }

  // 4. Alarmes. O apito (decisão n.º 2 do Ivo, contrato C1 da auditoria): a fuga é perigo imediato
  // (contínuo); um alarme de outro tipo seria curto; os avisos não precisam do campo.
  const mudar = (id, deve, estado, mensagem) => {
    if (deve === null || deve === !!e.ativos[id]) return
    const apito = estado === 'alarm' ? { apito: id === 'fuga' ? 'continuo' : 'curto' } : {}
    if (deve) { e.ativos[id] = true; notificacoes.push({ id, state: estado, method: ['visual', 'sound'], message: mensagem, ...apito }) }
    else { delete e.ativos[id]; notificacoes.push({ id, state: 'normal', method: [], message: 'Normal' }) }
  }
  if (e.litros !== null) {
    const L = Math.round(e.litros)
    mudar('reserva', e.ativos.reserva ? e.litros <= lim.reservaLimpa : e.litros <= lim.reserva, 'warn', `Gasóleo na reserva: ${L} L`)
  }
  if (e.parado.length >= 2 && e.mediana !== null) {
    const maximo = Math.max(...e.parado.map(p => p.litros))
    const desceu = maximo - e.mediana
    mudar('fuga', e.ativos.fuga ? desceu > lim.fugaLitros - 1 : desceu > lim.fugaLitros, 'alarm',
      `Possível fuga de gasóleo: −${desceu.toFixed(1).replace('.', ',')} L com o motor parado`)
  } else if (l.motorLigado && e.ativos.fuga) {
    mudar('fuga', false)
  }

  return { estado: e, notificacoes, abastecimento }
}

module.exports = { LIMITES, litrosDaRazao, mediana, novoEstado, descontar, passo }
