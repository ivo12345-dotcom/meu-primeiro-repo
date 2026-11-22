'use strict'
// O que a caixa 1 mandaria ao portátil, a fingir: as linhas da linguagem das caixas (batimentos, roda
// do log, vento, movimento e as tramas do motor que a caixa 2 lhe passa) e, à parte, as frases de um GPS.
// Não tem relógio nem acaso lá dentro: tudo sai do tempo (ms desde o arranque) que lhe derem, para os
// ensaios darem sempre o mesmo.

const { escrever, soma } = require('../../../signalk-arlequin-caixas/lib/linhas')
const { tramasMotor } = require('../../../arlequin-simulador/lib/j1939sim')

const CENARIO = {
  nos: 5.2, // velocidade na água
  impulsosPorSegundo: 26, // da roda do log (0,2 nós por impulso por segundo)
  ventoAngulo: 35, // vento aparente: graus a contar da proa, por estibordo
  ventoNos: 14.0,
  proa: 245, // magnética, a oscilar proaOscila graus para cada lado de 20 em 20 s
  proaOscila: 3,
  adorno: 12, // graus a estibordo
  caimentoOscila: 2, // graus para cada lado, de periodo em periodo
  sobeDesce: 0.4, // m/s² para cada lado, de periodo em periodo
  periodo: 6, // s
  cicloMotor: 120, // s: desligado na primeira metade, a trabalhar na segunda
  rpm: 2100,
  rssi: -58, // o rádio entre as duas caixas, em dBm
  lat: 38.695, // 38° 41,700' N
  lon: -9.236667, // 9° 14,200' W
  sog: 5.0, // nós
  cog: 245
}

const GRAU = Math.PI / 180
const NO = 0.514444 // m/s por nó
const G = 9.80665
const PASSO = 100 // ms: a caixa manda o movimento 10 vezes por segundo
const ATRASO_MAX = 5000 // depois de uma pausa só se recupera este tempo: não se despejam minutos de linhas
const PERIODO_PROA = 20 // s
const VERSAO = '0.1.0-f'
const MOTOR = { tempK: 355.15, volt: 14.2, horasS: 1243.5 * 3600 }

// O produto de dois quaterniões [i, j, k, r]: roda primeiro pelo segundo, depois pelo primeiro.
function vezes (a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ]
}
const emTorno = (eixo, graus) => { const q = [0, 0, 0, Math.cos(graus * GRAU / 2)]; q[eixo] = Math.sin(graus * GRAU / 2); return q }

// A orientação de uma caixa montada com o eixo y à proa e o z para cima, no referencial Leste-Norte-Cima
// do chip: a proa conta-se de norte para leste (por isso o sinal), o caimento é a proa a subir (roda em
// torno do x, que aponta a estibordo) e o adornamento é estibordo a descer (roda em torno do y).
function quaterniao ({ proa, adorno, caimento }) {
  return vezes(vezes(emTorno(2, -proa), emTorno(0, caimento)), emTorno(1, adorno))
}

// Um vetor do mundo visto pelo sensor (a rotação ao contrário).
function noSensor ([i, j, k, r], v) {
  const [a, b, c] = [-i, -j, -k]
  const t = [2 * (b * v[2] - c * v[1]), 2 * (c * v[0] - a * v[2]), 2 * (a * v[1] - b * v[0])]
  return [v[0] + r * t[0] + (b * t[2] - c * t[1]), v[1] + r * t[1] + (c * t[0] - a * t[2]), v[2] + r * t[2] + (a * t[1] - b * t[0])]
}

const dois = (n) => String(n).padStart(2, '0')
const frase = (corpo) => `$${corpo}*${soma(corpo)}`

// Graus → 'ddmm.mmmm' (ou 'dddmm.mmmm'), arredondando primeiro os minutos todos para nunca sair "60.0000".
function grausMinutos (graus, casasDosGraus) {
  const minutos = Math.round(Math.abs(graus) * 60 * 10000) / 10000
  const g = Math.floor(minutos / 60)
  return String(g).padStart(casasDosGraus, '0') + (minutos - g * 60).toFixed(4).padStart(7, '0')
}

// opcoes: inicio (a hora que o GPS a fingir dá no instante 0), semCaixa2, semVento, lixo e, para mudar o
// cenário, qualquer chave do CENARIO.
function criarGerador ({ inicio = Date.UTC(2026, 10, 22, 10, 15, 0), semCaixa2 = false, semVento = false, lixo = false, ...mudancas } = {}) {
  const c = { ...CENARIO, ...mudancas }
  let ultimo = 0 // até onde já se mandaram as linhas da caixa
  let ultimoGps = 0

  const proaEm = (s) => c.proa + c.proaOscila * Math.sin(2 * Math.PI * s / PERIODO_PROA)
  const caimentoEm = (s) => c.caimentoOscila * Math.sin(2 * Math.PI * s / c.periodo)
  const motorLigado = (t) => (t % (c.cicloMotor * 1000)) >= c.cicloMotor * 500

  function movimento (t) {
    const s = t / 1000
    const q = quaterniao({ proa: proaEm(s), adorno: c.adorno, caimento: caimentoEm(s) })
    // o que o acelerómetro sente: o peso (para cima) mais o sobe e desce, vistos pelo sensor inclinado
    const a = noSensor(q, [0, 0, G + c.sobeDesce * Math.sin(2 * Math.PI * s / c.periodo)])
    // a rotação: o caimento a mexer (em torno do x) e a proa a passear (em torno do z, ao contrário)
    const w = [
      c.caimentoOscila * GRAU * (2 * Math.PI / c.periodo) * Math.cos(2 * Math.PI * s / c.periodo),
      0,
      -c.proaOscila * GRAU * (2 * Math.PI / PERIODO_PROA) * Math.cos(2 * Math.PI * s / PERIODO_PROA)
    ]
    return escrever('M', [t / PASSO, 10, ...a.map(x => Math.round(x * 1000)), ...w.map(x => Math.round(x * 10000)), ...q.map(x => Math.round(x * 10000)), 349, 3])
  }

  // As linhas de um instante (múltiplo de 100 ms), pela ordem em que a caixa as mandaria.
  function instante (t) {
    const saida = []
    if (t % 1000 === 0) {
      saida.push(escrever('B', [1, t, VERSAO, 1, 0, 0]))
      if (!semCaixa2) saida.push(escrever('B', [2, t, VERSAO, 1, c.rssi, 0]))
    }
    if (t % 500 === 0) saida.push(escrever('L', [t, Math.floor(t * c.impulsosPorSegundo / 1000), Math.round(1e6 / c.impulsosPorSegundo)]))
    if (t % 1000 === 0 && !semVento) saida.push(frase(`IIMWV,${c.ventoAngulo.toFixed(1)},R,${c.ventoNos.toFixed(1)},N,A`))
    saida.push(movimento(t))
    if (t % 1000 === 0 && !semCaixa2 && motorLigado(t)) {
      saida.push(...tramasMotor({ t, rpm: c.rpm, tempK: MOTOR.tempK, volt: MOTOR.volt, horasS: MOTOR.horasS + t / 1000 }))
    }
    if (lixo && t % 5000 === 0) {
      saida.push('rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)') // o que a placa diz ao arrancar
      saida.push(`$AQL,${t},52`) // uma linha cortada a meio
    }
    return saida
  }

  // As linhas devidas desde a chamada anterior (ms: tempo desde o arranque).
  function linhas (ms) {
    const ate = Math.floor(ms / PASSO) * PASSO
    if (ate - ultimo > ATRASO_MAX) ultimo = ate - ATRASO_MAX
    const saida = []
    for (let t = ultimo + PASSO; t <= ate; t += PASSO) saida.push(...instante(t))
    if (ate > ultimo) ultimo = ate
    return saida
  }

  // Uma RMC e uma GGA por segundo, a andar a c.sog nós no rumo c.cog desde a posição do cenário.
  function gpsEm (t) {
    const quando = new Date(inicio + t)
    const metros = c.sog * NO * t / 1000
    const lat = c.lat + metros * Math.cos(c.cog * GRAU) / 111120
    const lon = c.lon + metros * Math.sin(c.cog * GRAU) / (111120 * Math.cos(c.lat * GRAU))
    const hora = `${dois(quando.getUTCHours())}${dois(quando.getUTCMinutes())}${dois(quando.getUTCSeconds())}.00`
    const dia = `${dois(quando.getUTCDate())}${dois(quando.getUTCMonth() + 1)}${dois(quando.getUTCFullYear() % 100)}`
    const onde = `${grausMinutos(lat, 2)},${lat < 0 ? 'S' : 'N'},${grausMinutos(lon, 3)},${lon < 0 ? 'W' : 'E'}`
    return [
      frase(`GPRMC,${hora},A,${onde},${c.sog.toFixed(1)},${c.cog.toFixed(1)},${dia},,,A`),
      frase(`GPGGA,${hora},${onde},1,08,1.0,5.0,M,50.0,M,,`)
    ]
  }

  function gps (ms) {
    const ate = Math.floor(ms / 1000) * 1000
    if (ate - ultimoGps > ATRASO_MAX) ultimoGps = ate - ATRASO_MAX
    const saida = []
    for (let t = ultimoGps + 1000; t <= ate; t += 1000) saida.push(...gpsEm(t))
    if (ate > ultimoGps) ultimoGps = ate
    return saida
  }

  return { linhas, gps, cenario: c, motorLigado }
}

module.exports = { CENARIO, quaterniao, criarGerador }
