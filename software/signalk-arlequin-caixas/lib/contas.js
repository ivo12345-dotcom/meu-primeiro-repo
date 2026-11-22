'use strict'
// As contas do que a caixa 1 manda em bruto: a velocidade na água pelos impulsos da roda do log, o
// vento aparente pela frase do mostrador, e a proa, o adornamento e o caimento pela orientação que o
// BNO085 calcula. As calibrações vêm da configuração do plugin: corrigem-se sem regravar a placa.

const NO = 0.514444 // m/s por nó
const GRAU = Math.PI / 180
const VOLTA = 2 * Math.PI

// --- Roda do log -----------------------------------------------------------------------------------
// A caixa manda, 2 vezes por segundo, o contador de impulsos e o período entre os dois últimos.
// Guardam-se as leituras dos últimos 3 s (pelo tempo da caixa). Depressa, contam-se os impulsos;
// devagar (menos de 8 na janela), usa-se o período, que dá a velocidade sem degraus, com o teto do
// que os impulsos contados permitem.
const JANELA_MS = 3000
const MINIMO_MS = 2000
const RAPIDO = 8

function novoLog () {
  return { leituras: [] }
}

function juntarLog (estado, { ms, impulsos, periodoUs }) {
  const ultima = estado.leituras[estado.leituras.length - 1]
  // o tempo ou o contador a andar para trás: a caixa reiniciou, a conta recomeça do zero
  const reiniciou = ultima && (ms < ultima.ms || impulsos < ultima.impulsos)
  const antes = reiniciou ? [] : estado.leituras
  return { leituras: [...antes, { ms, impulsos, periodoUs }].filter(l => ms - l.ms <= JANELA_MS) }
}

// Impulsos por segundo, ou null enquanto não houver 2 s de leituras.
function hzLog (estado) {
  const l = estado.leituras
  if (l.length < 2) return null
  const primeira = l[0]
  const ultima = l[l.length - 1]
  const ms = ultima.ms - primeira.ms
  if (ms < MINIMO_MS) return null
  const impulsos = ultima.impulsos - primeira.impulsos
  if (impulsos >= RAPIDO) return impulsos * 1000 / ms
  // Devagar vale o período, mas nunca mais do que os impulsos contados deixam: n impulsos seguidos
  // em t segundos são, no máximo, (n + 1) / t por segundo. Assim um impulso falso colado ao anterior
  // (um período de microssegundos) não dá um pico de centenas de nós.
  if (impulsos >= 1 && ultima.periodoUs > 0) return Math.min(1000000 / ultima.periodoUs, (impulsos + 1) * 1000 / ms)
  return 0
}

// m/s. O fator é o do log: nós por impulso por segundo (0,2 nas notas da NASA; acerta-se contra o GPS).
function velocidadeNaAgua (hz, nosPorHz = 0.2) {
  return hz * nosPorHz * NO
}

// --- Vento -----------------------------------------------------------------------------------------
// O mostrador dá o ângulo de 0 a 360° a contar da proa; no SignalK vai de −π a π, positivo a estibordo.
function ventoAparente ({ angulo, velocidade }, { desvioVento = 0, fatorVento = 1 } = {}) {
  let graus = (((angulo + desvioVento) % 360) + 360) % 360
  if (graus > 180) graus -= 360
  return { angleApparent: graus * GRAU, speedApparent: velocidade * fatorVento }
}

// --- Atitude ---------------------------------------------------------------------------------------
const EIXOS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }
const semZeroNegativo = (v) => (v === 0 ? 0 : v)
const vetorial = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(semZeroNegativo)

// A montagem da caixa: que eixo do sensor aponta à proa e qual aponta para cima. Devolve os três
// vetores do barco no referencial do sensor (f para a proa, u para cima, s para estibordo), ou null
// se os nomes não existirem ou os dois eixos não forem perpendiculares.
function eixos (eixoProa, eixoCima) {
  if (!Object.hasOwn(EIXOS, eixoProa) || !Object.hasOwn(EIXOS, eixoCima)) return null
  const f = EIXOS[eixoProa]
  const u = EIXOS[eixoCima]
  if (f[0] * u[0] + f[1] * u[1] + f[2] * u[2] !== 0) return null
  return { f: [...f], u: [...u], s: vetorial(f, u) }
}

// Roda um vetor do referencial do sensor para o do mundo com o quaternião [i, j, k, r] (de norma 1).
function rodar ([i, j, k, r], v) {
  const t = [2 * (j * v[2] - k * v[1]), 2 * (k * v[0] - i * v[2]), 2 * (i * v[1] - j * v[0])]
  return [
    v[0] + r * t[0] + (j * t[2] - k * t[1]),
    v[1] + r * t[1] + (k * t[0] - i * t[2]),
    v[2] + r * t[2] + (i * t[1] - j * t[0])
  ]
}

// O chip dá a orientação do sensor no referencial Leste-Norte-Cima (x leste, y norte, z cima).
// → { roll (estibordo a descer é positivo), pitch (proa a subir é positivo), heading (0…2π, magnética,
// sem desvios) } em radianos, ou null.
function atitude (q, montagem) {
  if (!montagem || !Array.isArray(q) || q.length !== 4) return null
  const norma = Math.hypot(...q)
  if (!(norma > 0) || !Number.isFinite(norma)) return null
  const u = q.map(v => v / norma)
  const F = rodar(u, montagem.f)
  const S = rodar(u, montagem.s)
  const U = rodar(u, montagem.u)
  return {
    roll: Math.atan2(-S[2], U[2]),
    pitch: Math.asin(Math.max(-1, Math.min(1, F[2]))),
    heading: ((Math.atan2(F[0], F[1]) % VOLTA) + VOLTA) % VOLTA
  }
}

// O desvio da tabela para um rumo (graus), interpolado entre as duas entradas vizinhas, com a volta
// aos 360°. Sem entradas é 0; com uma só, é sempre esse valor.
function desvioDaTabela (rumo, tabela) {
  const t = (Array.isArray(tabela) ? tabela : [])
    .filter(x => Number.isFinite(x?.rumo) && Number.isFinite(x?.desvio))
    .map(x => ({ rumo: ((x.rumo % 360) + 360) % 360, desvio: x.desvio }))
    .sort((a, b) => a.rumo - b.rumo)
  if (!t.length) return 0
  if (t.length === 1) return t[0].desvio
  const seguinte = t.findIndex(x => x.rumo > rumo)
  const ultima = t[t.length - 1]
  const a = seguinte === 0 ? { rumo: ultima.rumo - 360, desvio: ultima.desvio } : seguinte === -1 ? ultima : t[seguinte - 1]
  const b = seguinte === -1 ? { rumo: t[0].rumo + 360, desvio: t[0].desvio } : t[seguinte]
  if (b.rumo === a.rumo) return a.desvio
  return a.desvio + (b.desvio - a.desvio) * (rumo - a.rumo) / (b.rumo - a.rumo)
}

// A proa do sensor com o desvio fixo (o sensor não ficou bem apontado) e a tabela de desvios por rumo
// (o ferro do barco). Radianos, 0…2π.
function corrigirProa (heading, { desvioProa = 0, tabelaDesvios = [] } = {}) {
  const graus = (((heading / GRAU + desvioProa) % 360) + 360) % 360
  return ((((graus + desvioDaTabela(graus, tabelaDesvios)) % 360) + 360) % 360) * GRAU
}

// O zero do adornamento e do caimento (a caixa não ficou bem de nível).
function corrigirInclinacao ({ roll, pitch }, { desvioAdorno = 0, desvioCaimento = 0 } = {}) {
  return { roll: roll - desvioAdorno * GRAU, pitch: pitch - desvioCaimento * GRAU }
}

module.exports = { NO, novoLog, juntarLog, hzLog, velocidadeNaAgua, ventoAparente, eixos, atitude, corrigirProa, corrigirInclinacao }
