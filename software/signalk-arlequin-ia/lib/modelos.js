'use strict'
// Os modelos da AI em uso (modelos/<nome>/atual → vNNNN.json.gz) e as previsões
// com os limites de sanidade do desenho. As variáveis vão nas unidades da
// tabela da caixa negra (nós, graus, rpm, m). Sem modelo, fica o que se sabia
// antes: a polar, a previsão tal e qual, a curva da Volvo.
//
// CONTRATO PARA A PARTE 3 (o planeador de rotas, signalk-arlequin-rota). Tirado de
// arlequin-ia/arlequin_ia/treino.py (MODELOS) e variaveis.py; o `x` de cada
// função é { nomeDaVariavel: número | null } com estes nomes e unidades.
// Os modelos da velocidade e do consumo são de PLANEAMENTO: só usam o que se
// sabe antes de partir (nada medido no mar: nem vento medido, nem adorno, nem balanço).
//
// velocidade → STW em nós (velocidade na água, NÃO a SOG: a corrente fica de fora)
//   prevTws        nós   vento previsto EM BRUTO (Open-Meteo, sem a correção da AI)
//   twaAbs         graus |TWA| (0–180): no planeamento, o ângulo entre o rumo e o vento corrigido
//   prevRajada     nós   rajada prevista EM BRUTO
//   prevOndas      m     altura das ondas prevista
//   prevPeriodo    s     período das ondas previsto
//   ondasAnguloRel graus |direção das ondas prevista − proa| (0–180)
//   grandeRizos    −1 arriada, 0 inteira, 1 ou 2 rizos (no planeamento: os limiares da simulação)
//   genoaPct       %     0 enrolada … 100 toda aberta
//   Quem dá o quê: o planeador passa a previsão em bruto do ponto e hora (lib/previsao.js) e as velas que
//   decidiu; o `stwPolar` de preverVelocidade é a polar no vento CORRIGIDO (preverVento, P50 ou o do
//   cenário). A correção entra só pela polar: o modelo aprendeu "com esta previsão em bruto, andaste X",
//   por isso dar-lhe o vento corrigido contava a correção duas vezes.
//   O peso da AI (pesoCelula) é por célula de 2 nós de prevTws × 15° de twaAbs, como treino.chave_celula.
// ventoForca → razão TWS medido / TWS previsto; ventoDirecao → TWD medido − previsto (graus, −180…180)
//   latCel, lonCel graus  quadrícula de 0,1° (floor(lat × 10) / 10)
//   prevTws        nós    TWS previsto em bruto
//   prevTwd        graus  TWD previsto em bruto (de onde vem)
//   horaDia        horas  hora do dia em UTC (0–24, com decimais), NÃO a hora local
//   idadePrevH     horas  há quanto tempo a previsão foi obtida; treinado só com 0–12 h
//   tendPressao3h  hPa    MEDIDA: pressão agora − há 3 h (no planeamento: a do barómetro à partida, ou null)
// consumo → L/h de gasóleo (só aprendido com o caudal medido pelo MDI)
//   rpm            rpm   (atenção: não Hz como o propulsion.main.revolutions)
//   prevOndas, ondasAnguloRel  como acima
//
// Cuidados:
// - A velocidade só aprende em horas com previsão arquivada (as linhas sem previsão ficam fora do treino).
// - Um null vai pelo ramo por omissão do LightGBM, que não quer dizer "valor típico": o planeador deve
//   passar as 8 variáveis da velocidade (todas conhecidas antes de partir).
// - idadePrevH fora de 0–12 h é extrapolação.
// - Com peso 0 (célula sem horas), preverVelocidade devolve a polar em P10, P50
//   e P90: não há banda de incerteza, não quer dizer certeza.

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

// Peso da AI numa célula de 2 nós de vento previsto em bruto × 15°: cresce até 1 com 2 h de dados.
function pesoCelula (modelo, prevTws, twaAbs) {
  const h = modelo?.celulas?.[`${Math.floor(prevTws / 2) * 2}|${Math.floor(twaAbs / 15) * 15}`] ?? 0
  return Math.min(1, h / 2)
}

// Velocidade na água (nós): mistura com a polar pelo peso da célula e fica entre 40% e 120% da polar.
function preverVelocidade (modelo, x, stwPolar) {
  if (!modelo) return { p10: stwPolar, p50: stwPolar, p90: stwPolar, peso: 0 }
  const peso = pesoCelula(modelo, x.prevTws, x.twaAbs) // a célula é do vento previsto em bruto
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
