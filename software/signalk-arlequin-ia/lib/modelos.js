'use strict'
// Os modelos da AI em uso (modelos/<nome>/atual → vNNNN.json.gz) e as previsões
// com os limites de sanidade do desenho. As variáveis vão nas unidades da
// tabela da caixa negra (nós, graus, rpm, m). Sem modelo, fica o que se sabia
// antes: a polar, a previsão tal e qual, a curva da Volvo.
//
// CONTRATO PARA A PARTE 3 (quem planear rotas com isto). Tirado de
// arlequin-ia/arlequin_ia/treino.py (MODELOS) e variaveis.py; o `x` de cada
// função é { nomeDaVariavel: número | null } com estes nomes e unidades:
//
// velocidade → STW em nós (velocidade na água, NÃO a SOG: a corrente fica de fora)
//   tws            nós   vento real medido
//   twaAbs         graus |TWA| (0–180)
//   rajada         nós   MEDIDA: o máximo do TWS medido nos últimos 2 min (não a rajada prevista)
//   prevOndas      m     altura das ondas prevista (Open-Meteo)
//   prevPeriodo    s     período das ondas previsto
//   ondasAnguloRel graus |direção das ondas prevista − proa| (0–180)
//   balAdorno      graus MEDIDO: desvio padrão do adorno nos últimos 2 min (IMU)
//   balCaimento    graus MEDIDO: desvio padrão do caimento nos últimos 2 min (IMU)
//   adornoAbs      graus MEDIDO: |adorno|
//   grandeRizos    −1 arriada, 0 inteira, 1 ou 2 rizos (página Velas)
//   genoaPct       %     0 enrolada … 100 toda aberta
// ventoForca → razão TWS medido / TWS previsto; ventoDirecao → TWD medido − previsto (graus, −180…180)
//   latCel, lonCel graus  quadrícula de 0,1° (floor(lat × 10) / 10)
//   prevTws        nós    TWS previsto
//   prevTwd        graus  TWD previsto (de onde vem)
//   horaDia        horas  hora do dia em UTC (0–24, com decimais), NÃO a hora local
//   idadePrevH     horas  há quanto tempo a previsão foi obtida; treinado só com 0–12 h
//   tendPressao3h  hPa    MEDIDA: pressão agora − há 3 h
// consumo → L/h de gasóleo (só aprendido com o caudal medido pelo MDI)
//   rpm            rpm   (atenção: não Hz como o propulsion.main.revolutions)
//   stw            nós   MEDIDA
//   prevOndas, ondasAnguloRel, balCaimento  como acima
//
// Cuidados:
// - As variáveis MEDIDAS (adornoAbs, balAdorno, balCaimento, rajada e, no
//   consumo, stw) existiram sempre no treino. Um planeador que as passe null
//   (porque ainda não navegou ali) recebe respostas enviesadas: o LightGBM
//   manda o null pelo ramo por omissão, que não quer dizer "valor típico".
//   Tem de as estimar (p.ex. da previsão ou das últimas horas) ou aceitar o viés.
// - idadePrevH fora de 0–12 h é extrapolação.
// - Com peso 0 (célula sem horas), preverVelocidade devolve a polar em P10, P50
//   e P90: não há banda de incerteza, não quer dizer certeza.
// Isto é o contrato de hoje, não um desenho fechado: a Parte 3 decide com o Ivo.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { preverArvores } = require('./arvores')

const NOMES = ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']
const limitar = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function lerVersao (pasta, nome, versao) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(pasta, nome, `${versao}.json.gz`))))
}

function versaoAtual (pasta, nome) {
  try { return fs.readFileSync(path.join(pasta, nome, 'atual'), 'utf8').trim() } catch { return null }
}

function versoes (pasta, nome) {
  try { return fs.readdirSync(path.join(pasta, nome)).filter(n => /^v\d{4}\.json\.gz$/.test(n)).map(n => n.slice(0, 5)).sort() } catch { return [] }
}

// { nome: modelo | null } com o modelo em uso de cada tipo (sem o texto nativo do Python).
function carregarModelos (pasta, aoErro = () => {}) {
  const out = {}
  for (const nome of NOMES) {
    const v = versaoAtual(pasta, nome)
    try {
      const m = v ? lerVersao(pasta, nome, v) : null
      if (m) delete m.nativo
      out[nome] = m
    } catch (e) { aoErro(nome, e); out[nome] = null }
  }
  return out
}

// P10/P50/P90 por ordem (os quantis treinados à parte podem cruzar-se).
function preverQuantis (modelo, x) {
  const v = ['p10', 'p50', 'p90'].map(q => preverArvores(modelo.quantis[q], x)).sort((a, b) => a - b)
  return { p10: v[0], p50: v[1], p90: v[2] }
}

// Peso da AI numa célula de 2 nós × 15°: cresce até 1 com 2 h de dados.
function pesoCelula (modelo, tws, twaAbs) {
  const h = modelo?.celulas?.[`${Math.floor(tws / 2) * 2}|${Math.floor(twaAbs / 15) * 15}`] ?? 0
  return Math.min(1, h / 2)
}

// Velocidade na água (nós): mistura com a polar pelo peso da célula e fica entre 40% e 120% da polar.
function preverVelocidade (modelo, x, stwPolar) {
  if (!modelo) return { p10: stwPolar, p50: stwPolar, p90: stwPolar, peso: 0 }
  const peso = pesoCelula(modelo, x.tws, x.twaAbs)
  const ai = preverQuantis(modelo, x)
  const out = { peso }
  for (const q of ['p10', 'p50', 'p90']) out[q] = limitar(peso * ai[q] + (1 - peso) * stwPolar, 0.4 * stwPolar, 1.2 * stwPolar)
  return out
}

// Vento real esperado a partir da previsão: força × razão (0,5–1,5) e direção + diferença (±40°).
function preverVento (mForca, mDirecao, x, prevTws, prevTwd) {
  const r = mForca ? preverQuantis(mForca, x) : { p10: 1, p50: 1, p90: 1 }
  const d = mDirecao ? preverArvores(mDirecao.quantis.p50, x) : 0
  const tws = {}
  for (const q of ['p10', 'p50', 'p90']) tws[q] = prevTws * limitar(r[q], 0.5, 1.5)
  return { tws, twd: ((prevTwd + limitar(d, -40, 40)) % 360 + 360) % 360 }
}

// Gasóleo (L/h): entre 50% e 200% da curva da Volvo.
function preverConsumo (modelo, x, litrosVolvo) {
  if (!modelo) return { p10: litrosVolvo, p50: litrosVolvo, p90: litrosVolvo }
  const ai = preverQuantis(modelo, x)
  const out = {}
  for (const q of ['p10', 'p50', 'p90']) out[q] = limitar(ai[q], 0.5 * litrosVolvo, 2 * litrosVolvo)
  return out
}

module.exports = { NOMES, lerVersao, versaoAtual, versoes, carregarModelos, preverQuantis, pesoCelula, preverVelocidade, preverVento, preverConsumo }
