'use strict'
// O acompanhamento a navegar (desenho 3b-2, "Acompanhamento"). Funções puras, com o relógio (agora)
// sempre de fora.
//
// Milhas feitas: a projeção da posição sobre a rota do plano (o ponto mais perto, lib/costa.js
// projetar), com a janela de passagem da 3a (lib/rotas.js: projetar entre `de` e `ate`): de 0,5 MN
// atrás da última posição até ao que o barco pode ter andado desde então (15 nós, no mínimo 2 MN).
// Assim, numa rota que volta atrás, a posição não salta para a perna de volta. Sem posição anterior
// (o plugin acabou de arrancar), a rota toda.
// O rasto provável do plano (de 10 em 10 min) projeta-se da mesma maneira: a tabela { s, t } diz a
// hora a que o plano passava em cada milha (s nunca desce).
// Atraso = agora − a hora a que o rasto provável passava nas mesmas milhas (positivo = atrasado), em
// minutos, com a média móvel de 10 min (só a navegar; sem GPS, fica a média que havia).
// Eventos (os da 3a, lib/passagem.js, por tipo): os de sítio (partida, wp — cabos, largos, pontos da
// rota —, vela — rizar e largar rizo —, motor e chegada) deslizam com o atraso; os de hora fixa (noite
// — pôr e nascer do sol —, tempo — chuva, visibilidade, frente — e os outros) ficam na hora do plano.
// Mais os lembretes gerados do plano (lembretesDoPlano, Tarefa 8.5): a viragem (> 45° num ponto da
// rota, de sítio), a rotação do vento previsto (> 45° em 1 h, hora fixa) e a chuva e visibilidade
// (< 5 km, com a visibilidade prevista no rasto; sem ela, o evento da 3a, < 3 km).
// O deslize é o atraso arredondado ao minuto.
// Chegada prevista agora = a chegada provável do plano (chegada.p50) + atraso; de noite ou não, pelo
// nascer e pôr do sol no cais (lib/sol.js).
// Recursos à chegada: gasóleo = o medido − horas de motor que faltam no rasto do plano × a curva da
// Volvo (lib/base.js) às rpm de cruzeiro (2100); bateria = o SoC agora + o balanço do lib/energia.js
// no troço que falta (motor e noite do rasto, ou a noite pelo sol à hora deslizada; sem radiação
// conhecida, sem sol). Sem leitura, null.
// O vento: a média de 10 min do medido e do previsto (P50 naquele sítio e hora), com o desvio em nós e
// em % (o % fica null com a previsão de calma, 0 nós: nunca Infinity).

const c = require('./costa')
const { litrosHora } = require('./base')
const { criarEnergia } = require('./energia')
const { nasceresPores } = require('./sol')
const { noitePeloSol } = require('./passagem')

const MIN = 60000
const H = 3600000
const DIA = 86400000
const JANELA_MEDIA = 10 * MIN
const PADRAO = Object.freeze({ recuoMn: 0.5, velMaxNos: 15, avancoMinMn: 2, rpm: 2100 })
const SITIO = new Set(['partida', 'wp', 'vela', 'motor', 'chegada', 'viragem'])
// os lembretes gerados do plano (Tarefa 8.5)
const VIRAGEM_GRAUS = 45 // o rumo da rota muda mais do que isto num ponto
const ROTACAO_GRAUS = 45 // o vento previsto roda mais do que isto…
const ROTACAO_MS = H // …em 1 h
const ROTACAO_INICIO_GRAUS = 5 // o início da rotação: o último ponto ainda a ≤ 5° da direção de antes
const VIS_LEMBRETE_M = 5000 // chuva e visibilidade: < 5 km (o desenho)
const iso = (t) => new Date(t).toISOString()

// ---------- a rota e o rasto ----------
function projetar (rota, pos, anterior, agora, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const { linha } = rota
  if (!anterior || !Number.isFinite(anterior.s)) return c.projetar(linha, pos)
  const dtH = Math.max(0, (agora - anterior.t) / H)
  const de = Math.max(0, anterior.s - o.recuoMn)
  const ate = Math.min(linha.total, anterior.s + Math.max(o.avancoMinMn, o.velMaxNos * dtH))
  return c.projetar(linha, pos, { de, ate })
}

function prepararRota (plano, opcoes = {}) {
  const pts = (plano.alternativa?.pontosRota || []).map(p => ({ lat: p.lat, lon: p.lon }))
  // uma rota de um ponto (ou pontos iguais): uma linha de comprimento 0
  const linha = c.prepararLinha(pts.length > 1 ? pts : [pts[0], pts[0]])
  const rota = { linha, tabela: [] }
  let anterior = null
  for (const p of plano.alternativa?.rasto || []) {
    const t = Date.parse(p.t)
    if (!Number.isFinite(t)) continue
    const q = projetar(rota, p, anterior, t, opcoes)
    const s = Math.max(q.s, anterior ? anterior.s : 0)
    rota.tabela.push({ s, t })
    anterior = { s, t }
  }
  return rota
}

// A hora (ms) a que o plano passava em s milhas (a primeira vez); depois do fim, a do fim.
function horaNoPlano (tabela, s) {
  if (!tabela.length) return NaN
  if (s <= tabela[0].s) return tabela[0].t
  for (let i = 1; i < tabela.length; i++) {
    if (tabela[i].s >= s) {
      const a = tabela[i - 1]; const b = tabela[i]
      const f = (s - a.s) / (b.s - a.s)
      return Math.round(a.t + f * (b.t - a.t))
    }
  }
  return tabela.at(-1).t
}

const atrasoMin = (tabela, s, agora) => (agora - horaNoPlano(tabela, s)) / MIN

// ---------- médias ----------
const juntarAmostra = (amostras, amostra, agora, janela = JANELA_MEDIA) => [...amostras, amostra].filter(a => a.t >= agora - janela)
function media (amostras, campo = 'v') {
  const v = amostras.map(a => a[campo]).filter(Number.isFinite)
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null
}

// ---------- eventos ----------
const minuscula = (s) => s.charAt(0).toLowerCase() + s.slice(1)
function textoCurto (e) {
  const t = String(e.texto || '').trim()
  if (e.tipo === 'tempo') {
    if (/^chuva/i.test(t)) return 'chuva e visibilidade'
    if (/^passagem da frente/i.test(t)) return 'passagem da frente'
  }
  const curto = t.split(/:| \(|,/)[0].trim() || e.tipo
  return e.tipo === 'wp' ? curto : minuscula(curto)
}

// [{ id: 'e<i>' (ou o id do evento), tipo, texto, curto, sitio, tPlano, t (deslizada) }]; atraso null: como no plano.
function deslizarEventos (eventos = [], atraso = null) {
  const desliza = Number.isFinite(atraso) ? Math.round(atraso) * MIN : 0
  return eventos.map((e, i) => {
    const tPlano = Date.parse(e.t)
    const sitio = SITIO.has(e.tipo)
    return { id: e.id ?? `e${i}`, tipo: e.tipo, texto: e.texto, curto: textoCurto(e), sitio, tPlano: e.t, t: Number.isFinite(tPlano) ? iso(tPlano + (sitio ? desliza : 0)) : e.t }
  })
}

// ---------- os lembretes gerados do plano (Tarefa 8.5) ----------
const difAngulo = (a, b) => Math.abs((((b - a) % 360) + 540) % 360 - 180)
const grau = (x) => Math.round(((x % 360) + 360) % 360)
const virgula = (x) => x.toFixed(1).replace('.', ',')
const daChuva3a = (e) => e.tipo === 'tempo' && /^chuva/i.test(String(e.texto || ''))
const comVisibilidade = (plano) => (plano.alternativa?.rasto || []).some(p => Number.isFinite(p.vis))

// [{ id, t, tipo, texto }] a partir do plano ativo:
//   viragem: nos pontos da rota onde o rumo muda mais de 45° (fora do porto), "Virar/cambar no <nome>"
//     (sem nome, WP<i>), à hora a que o plano passa lá (de sítio: desliza com o atraso);
//   vento: onde o twd previsto do rasto roda mais de 45° em 1 h, "Rotação do vento de X° para Y°", à hora
//     em que começa a rodar (X) e até onde para de se afastar (Y) (hora fixa);
//   tempo: com a visibilidade prevista no rasto, "Chuva e visibilidade X km: radar ligado" no 1.º ponto de
//     cada troço com menos de 5 km (sem ela no rasto, fica o evento da 3a, com menos de 3 km).
function lembretesDoPlano (plano, rota = prepararRota(plano)) {
  const out = []
  const pts = plano.alternativa?.pontosRota || []
  // os pontos distintos (sem os repetidos), com o índice na rota
  const idx = []
  pts.forEach((p, i) => { if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && !(idx.length && c.distanciaMn(pts[idx.at(-1)], p) < 1e-6)) idx.push(i) })
  for (let k = 1; k < idx.length - 1; k++) {
    const [a, b, d] = [pts[idx[k - 1]], pts[idx[k]], pts[idx[k + 1]]]
    if (b.perna === 'porto' || d.perna === 'porto') continue
    if (difAngulo(c.vetor(a, b).rumo, c.vetor(b, d).rumo) <= VIRAGEM_GRAUS) continue
    const t = horaNoPlano(rota.tabela, rota.linha.s[idx[k]])
    if (Number.isFinite(t)) out.push({ id: `v${idx[k]}`, t: iso(t), tipo: 'viragem', texto: `Virar/cambar no ${b.nome || `WP${idx[k]}`}` })
  }
  const rasto = (plano.alternativa?.rasto || []).map(p => ({ ...p, t: Date.parse(p.t) })).filter(p => Number.isFinite(p.t))
  const r = rasto.filter(p => Number.isFinite(p.twd))
  for (let j = 0; j < r.length; j++) {
    let k = -1
    for (let q = j + 1; q < r.length && r[q].t - r[j].t <= ROTACAO_MS; q++) if (difAngulo(r[j].twd, r[q].twd) > ROTACAO_GRAUS) { k = q; break }
    if (k < 0) continue
    let a = j
    while (a + 1 < k && difAngulo(r[j].twd, r[a + 1].twd) <= ROTACAO_INICIO_GRAUS) a++
    let b = k
    while (b + 1 < r.length && difAngulo(r[a].twd, r[b + 1].twd) > difAngulo(r[a].twd, r[b].twd)) b++
    out.push({ id: `r${a}`, t: iso(r[a].t), tipo: 'vento', texto: `Rotação do vento de ${grau(r[a].twd)}° para ${grau(r[b].twd)}°` })
    j = b
  }
  let antes = null
  for (const [i, p] of rasto.entries()) {
    if (!Number.isFinite(p.vis)) continue
    const baixa = p.vis < VIS_LEMBRETE_M
    if (baixa && !antes) out.push({ id: `c${i}`, t: iso(p.t), tipo: 'tempo', texto: `Chuva e visibilidade ${virgula(p.vis / 1000)} km: radar ligado` })
    antes = baixa
  }
  return out
}

// O próximo evento depois de agora (sem a partida): { id, texto, hora, tipo } ou null.
function proximoEvento (deslizados, agora) {
  const e = deslizados.filter(x => x.tipo !== 'partida' && Date.parse(x.t) > agora).sort((a, b) => Date.parse(a.t) - Date.parse(b.t))[0]
  return e ? { id: e.id, texto: e.curto, hora: e.t, tipo: e.tipo } : null
}

function chegadaDeNoite (t, cais) {
  if (!Number.isFinite(t) || !cais) return null
  const sol = nasceresPores(cais.lat, cais.lon, t - 2 * DIA, t + 2 * DIA)
  return !!noitePeloSol(sol.nasceres, sol.pores)(t)
}

// ---------- recursos ----------
function recursos ({ plano, tPlano, gasoleoL = null, socPct = null, energia = {}, rpm = PADRAO.rpm, atrasoMs = 0, noite = null, radiacao = null }) {
  const rasto = (plano.alternativa?.rasto || []).map(p => ({ ...p, t: Date.parse(p.t) })).filter(p => Number.isFinite(p.t))
  const e = criarEnergia(energia)
  let estado = Number.isFinite(socPct) ? e.inicio(tPlano, socPct / 100) : null
  let soc = Number.isFinite(socPct) ? socPct / 100 : null
  let horasMotor = 0
  for (let i = 0; i < rasto.length - 1; i++) {
    const a = Math.max(rasto[i].t, tPlano)
    const b = rasto[i + 1].t
    if (b <= a) continue
    const dur = b - a
    const motor = !!rasto[i].motor
    if (motor) horasMotor += dur / H
    if (estado) {
      const real = a + atrasoMs
      const eNoite = typeof noite === 'function' ? !!noite(real) : !!rasto[i].noite
      const rad = typeof radiacao === 'function' ? radiacao(rasto[i].lat, rasto[i].lon, real) : 0
      const r = e.passo(estado, { dtMs: dur, motor, noite: eNoite, radiacao: Number.isFinite(rad) ? rad : 0 })
      estado = r.estado
      soc = r.soc
    }
  }
  return {
    horasMotorFaltam: horasMotor,
    gasoleoChegadaL: Number.isFinite(gasoleoL) ? gasoleoL - horasMotor * litrosHora(rpm) : null,
    bateriaChegadaPct: soc == null ? null : soc * 100
  }
}

// ---------- o vento ----------
function desvioVento (amostras) {
  const ok = amostras.filter(a => Number.isFinite(a.medido) && Number.isFinite(a.previsto))
  if (!ok.length) return null
  const medido = media(ok, 'medido')
  const previsto = media(ok, 'previsto')
  const desvioNos = medido - previsto
  // com a previsão de calma (0 nós) não há percentagem: null (só conta a regra dos 4 nós, avisos-navegar.js)
  const desvioPct = previsto > 0 ? 100 * desvioNos / previsto : null
  return { medido, previsto, desvioNos, desvioPct }
}

// ---------- tudo junto, de minuto a minuto ----------
const novoEstado = () => ({ anterior: null, amostras: [] })

// entrada: { plano, posicao | null (sem GPS), agora, gasoleoL?, socPct?, energia?, rpm?, radiacao?, opcoes? }
// → { estado, resultado: { estado, semGps, milhas, distRota, atrasoMin, tPlano, chegadaPlano, chegadaAgora,
//     chegadaNoite, eventos, proximo, recursos } }
function acompanhar (estado0, entrada) {
  const { plano, posicao, agora } = entrada
  const estado = { ...novoEstado(), ...estado0 }
  const rota = prepararRota(plano, entrada.opcoes)
  const navegar = plano.estado === 'a navegar'
  const semGps = !posicao
  let milhas = estado.anterior ? estado.anterior.s : null
  let distRota = null
  if (navegar && posicao) {
    const q = projetar(rota, posicao, estado.anterior, agora, entrada.opcoes)
    milhas = q.s
    distRota = q.dist
    estado.anterior = { s: q.s, t: agora }
    // uma amostra por minuto: o mesmo minuto outra vez (o relógio parado) não pesa a dobrar
    if (estado.amostras.at(-1)?.t !== agora) estado.amostras = juntarAmostra(estado.amostras, { t: agora, v: atrasoMin(rota.tabela, q.s, agora) }, agora)
  }
  const atraso = navegar ? media(estado.amostras) : null
  const desliza = Number.isFinite(atraso) ? Math.round(atraso) * MIN : 0
  const p50 = Date.parse(plano.alternativa?.chegada?.p50)
  const chegadaAgora = Number.isFinite(p50) ? p50 + desliza : null
  // a hora do plano em que o barco está (antes de sair: o início do plano)
  const inicio = rota.tabela.length ? rota.tabela[0].t : Date.parse(plano.alternativa?.partida)
  const tPlano = Number.isFinite(atraso) ? agora - desliza : inicio
  // os do plano (sem a chuva da 3a quando o rasto tem a visibilidade) e os lembretes gerados do plano
  const doPlano = (plano.alternativa?.eventos || []).map((e, i) => ({ ...e, id: `e${i}` }))
  const vis = comVisibilidade(plano)
  const eventos = deslizarEventos([...doPlano.filter(e => !(vis && daChuva3a(e))), ...lembretesDoPlano(plano, rota)], atraso)
  const cais = plano.destino?.cais
  const noite = cais ? (t) => chegadaDeNoite(t, cais) : null
  const rec = recursos({ plano, tPlano, gasoleoL: entrada.gasoleoL, socPct: entrada.socPct, energia: entrada.energia, rpm: entrada.rpm, atrasoMs: desliza, noite, radiacao: entrada.radiacao })
  return {
    estado,
    resultado: {
      estado: plano.estado,
      semGps,
      milhas,
      distRota,
      atrasoMin: atraso,
      tPlano,
      chegadaPlano: Number.isFinite(p50) ? iso(p50) : null,
      chegadaAgora: chegadaAgora == null ? null : iso(chegadaAgora),
      chegadaNoite: chegadaAgora == null ? null : chegadaDeNoite(chegadaAgora, cais),
      eventos,
      proximo: proximoEvento(eventos, agora),
      recursos: rec
    }
  }
}

module.exports = { PADRAO, SITIO, prepararRota, lembretesDoPlano, projetar, horaNoPlano, atrasoMin, juntarAmostra, media, textoCurto, deslizarEventos, proximoEvento, chegadaDeNoite, recursos, desvioVento, novoEstado, acompanhar }
