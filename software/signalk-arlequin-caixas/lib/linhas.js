'use strict'
// A linguagem das linhas entre a caixa 1 e o portátil (o contrato com o firmware; a tabela completa
// está em docs/superpowers/plans/2026-11-22-sistema-no-portatil-parte1.md).
//
// Porta série a 460 800 baud, uma linha por leitura, 200 caracteres no máximo:
//   $AQB  batimento de uma caixa        $AQL  impulsos da roda do log
//   $AQM  movimento (o sensor BNO085)   $..MWV  a frase do vento, tal como o mostrador a manda
//   (s.µs) can1 ID#DADOS*HH  uma trama do motor, como a escreve o candump -L, mais a soma
// As linhas $AQ levam a soma do NMEA 0183 (ou-exclusivo do que está entre o $ e o *); a do motor leva
// o ou-exclusivo de tudo o que está antes do *. Sem a soma certa uma linha não vale. Campos a mais
// no fim ignoram-se, para a linguagem poder crescer; campos a menos ou fora dos limites invalidam a
// linha inteira: daqui nunca sai um valor de uma linha estragada.
// O batimento da caixa 1 pode trazer três campos a mais: o estado do sensor (0 a medir, 1 a arrancar,
// 2 calado e a tentar o RST, 3 não volta, 4 a fingir), o motivo do último arranque da placa e os
// toques no RST desde o arranque.

const BAUD = 460800
const MAX_LINHA = 200
const U32 = 0xFFFFFFFF
const INTEIRO = /^-?\d+$/
const DECIMAL = /^\d+(\.\d+)?$/
const VERSAO = /^[A-Za-z0-9._-]{1,12}$/
const COM_SOMA = /^\$([^$*]*)\*([0-9A-Fa-f]{2})$/
const MOTOR = /^\((\d+)\.(\d{1,6})\)\s+(\S+)\s+([0-9A-Fa-f]{8})#((?:[0-9A-Fa-f]{2}){0,8})$/
const MOTOR_COM_SOMA = /^(\(.*)\*([0-9A-Fa-f]{2})\s*$/
// para m/s: nós, metros por segundo e quilómetros por hora
const UNIDADES = { N: 0.514444, M: 1, K: 0.277778 }

function soma (texto) {
  let x = 0
  for (let i = 0; i < texto.length; i++) x ^= texto.charCodeAt(i)
  return (x & 0xFF).toString(16).toUpperCase().padStart(2, '0')
}

function escrever (tipo, campos) {
  const corpo = `AQ${tipo},${campos.join(',')}`
  return `$${corpo}*${soma(corpo)}`
}

// Um inteiro dentro dos limites, ou null.
function inteiro (texto, min, max) {
  if (typeof texto !== 'string' || !INTEIRO.test(texto)) return null
  const v = Number(texto)
  if (!(v >= min && v <= max)) return null
  return v === 0 ? 0 : v // nunca -0
}

// Vários inteiros seguidos com os mesmos limites, ou null se algum falhar.
function inteiros (campos, de, quantos, min, max) {
  const r = []
  for (let i = de; i < de + quantos; i++) {
    const v = inteiro(campos[i], min, max)
    if (v === null) return null
    r.push(v)
  }
  return r
}

function batimento (c) {
  const caixa = inteiro(c[1], 1, 2)
  const ms = inteiro(c[2], 0, U32)
  const sim = inteiro(c[4], 0, 1)
  const rssi = inteiro(c[5], -127, 0)
  const perdidos = inteiro(c[6], 0, U32)
  if (caixa === null || ms === null || sim === null || rssi === null || perdidos === null) return null
  if (typeof c[3] !== 'string' || !VERSAO.test(c[3])) return null
  const b = { tipo: 'batimento', caixa, ms, fw: c[3], sim: sim === 1, rssi, perdidos }
  if (caixa === 1 && c.length >= 10) {
    const sensor = inteiro(c[7], 0, 4)
    const arranque = inteiro(c[8], 0, 255)
    const rsts = inteiro(c[9], 0, U32)
    if (sensor !== null && arranque !== null && rsts !== null) Object.assign(b, { sensor, arranque, rsts })
  }
  return b
}

function log (c) {
  const v = inteiros(c, 1, 3, 0, U32)
  return v ? { tipo: 'log', ms: v[0], impulsos: v[1], periodoUs: v[2] } : null
}

function movimento (c) {
  const n = inteiro(c[1], 0, U32)
  const k = inteiro(c[2], 1, 255)
  const a = inteiros(c, 3, 3, -160000, 160000)
  const w = inteiros(c, 6, 3, -350000, 350000)
  const q = inteiros(c, 9, 4, -10000, 10000)
  const precisao = inteiro(c[13], 0, 31416)
  const estado = inteiro(c[14], 0, 3)
  if (n === null || k === null || !a || !w || !q || precisao === null || estado === null) return null
  const norma = Math.hypot(...q) / 10000
  if (!(norma >= 0.9 && norma <= 1.1)) return null
  return { tipo: 'movimento', n, k, a, w, q, precisao, estado }
}

// $..MWV,<ângulo>,R,<velocidade>,<unidade>,A — só o vento aparente (R) que o mostrador dá por válido (A).
function vento (c) {
  if (c.length < 6 || c[2] !== 'R' || c[5] !== 'A') return null
  if (!DECIMAL.test(c[1]) || !DECIMAL.test(c[3]) || !Object.hasOwn(UNIDADES, c[4])) return null
  let angulo = Number(c[1])
  if (!(angulo >= 0 && angulo <= 360)) return null
  if (angulo === 360) angulo = 0
  return { tipo: 'vento', angulo, velocidade: Number(c[3]) * UNIDADES[c[4]] }
}

function motor (linha) {
  const s = MOTOR_COM_SOMA.exec(linha)
  if (!s || soma(s[1]) !== s[2].toUpperCase()) return null
  const m = MOTOR.exec(s[1])
  return m ? { tipo: 'motor', id: parseInt(m[4], 16), dados: m[5].toUpperCase() } : null
}

// Uma linha → o que ela diz, ou null.
function ler (linha) {
  if (typeof linha !== 'string') return null
  const l = linha.replace(/[\r\n]+$/, '')
  if (l.length === 0 || l.length > MAX_LINHA) return null
  if (l[0] === '(') return motor(l)
  const m = COM_SOMA.exec(l)
  if (!m || soma(m[1]) !== m[2].toUpperCase()) return null
  const c = m[1].split(',')
  if (c[0] === 'AQB') return batimento(c)
  if (c[0] === 'AQL') return log(c)
  if (c[0] === 'AQM') return movimento(c)
  if (/^[A-Z]{2}MWV$/.test(c[0])) return vento(c)
  return null
}

// A trama do motor como linha do candump -L, com a hora do portátil (o plugin do motor lê este formato).
function linhaMotor (m, agoraMs) {
  const seg = Math.floor(agoraMs / 1000)
  const us = String((agoraMs % 1000) * 1000).padStart(6, '0')
  const id = (m.id >>> 0).toString(16).toUpperCase().padStart(8, '0')
  return `(${seg}.${us}) can1 ${id}#${m.dados}`
}

module.exports = { BAUD, MAX_LINHA, soma, escrever, ler, linhaMotor }
