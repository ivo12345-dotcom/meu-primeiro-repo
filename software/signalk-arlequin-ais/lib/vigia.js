'use strict'
// Vigia AIS: para cada alvo decide se há alarme de colisão. Lógica pura; o cálculo de CPA/TCPA e a
// classificação vêm de arlequin-ecra/public/lib/cpa.js (injetado), para o ecrã e o servidor darem
// exatamente o mesmo resultado.
//
// A velocidade de cada barco (o nosso e cada alvo), por esta ordem (revisão F6, Importantes 1 e 2):
//   1. a medida: o SOG (abaixo de 0,5 nó = parado, sem precisar do COG) e o COG. Um SOG/COG de um alvo
//      mais velho do que a posição dele 30 s não conta (o SignalK não publica o "não disponível" do AIS:
//      fica o último na árvore); o nosso conta 10 s desde a última mudança (o GPS manda-o de segundo a
//      segundo: 10 s sem um novo é o GPS calado; Menor 8);
//   2. a última medida, durante esses 30 s (10 s a nossa): o GPS a 0,5–1 nó cala o COG numa RMC sim e
//      noutra não (o SignalK publica null) e um alvo pode perder o COG a meio; sem isto o alarme ligava e
//      desligava de 2 em 2 s;
//   3. a do rasto do próprio barco (as nossas posições do GPS, as do alvo pelo AIS): com 2 posições ou
//      mais em 30 s ou mais, a mediana das inclinações entre todos os pares (Theil–Sen), que um salto do
//      GPS em menos de ~1/3 das posições não mexe; daí o CPA/TCPA de sempre;
//   4. sem nenhuma: a regra da distância (K-01) — a menos de 0,5 MN e a aproximar-se de forma
//      sustentada: em 30 s ou mais de histórico, a distância desceu 50 m, não voltou a subir 25 m, e a
//      mediana das inclinações dela é de mais de 0,5 nó (um degrau do GPS não chega).
// Um alarme que vem de uma velocidade estimada ou da regra da distância só sai confirmado numa segunda
// avaliação, com uma posição nova de quem não tem velocidade medida (uma posição errada não chega).
//
// Muito perto (a menos de 0,05 MN, ~90 m): um alvo que veio para nós pelas posições dele (20 m ou mais
// nos últimos 3 min; ex.: um barco a garrar, abaixo dos 0,5 nó que contam como parado) dá alarme, também
// amarrados ou no porto (mexe-se). O nosso movimento (atracar devagar) e os saltos do nosso GPS não
// contam: só as posições do alvo. Num fundeadouro apertado, um vizinho a bornear para o nosso lado
// também o pode dar (Menor 7).
//
// Amarrado ou fundeado (decisão n.º 3): o nosso SOG abaixo de 0,5 nó durante 5 min; deixa de estar com
// 1 min seguido a 0,5 nó ou mais. Rodar à âncora (bornear) com o GPS da proa a 0,6–0,9 nó mais de 1 min
// seguido também tira deste estado, e um vizinho fundeado perto pode então dar alarme: o erro fica para
// o lado do alarme, porque exigir também uma deslocação atrasaria o alarme de quem garra (revisão F6,
// Menor 6: a regra fica assim e o NAVEGACAO tem de a dizer). Amarrados, os alvos também parados não dão
// alarme. Um alvo que se mexe dá sempre alarme.
//
// Em porto (decisão do Ivo de 02/10, contrato C12): a menos de 0,5 MN de um porto conhecido (os destinos
// da rota e os extras da configuração do plugin) e com o nosso SOG abaixo de 4 nós, um alvo parado (ou
// ainda sem velocidade conhecida) não apita — o ecrã mostra-o a amarelo (classificar com { emPorto }).
// O "em porto" só muda com a condição nova 30 s seguidos (o SOG a 3,9/4,1 nós não o faz oscilar).
//
// Um alarme ativo não se publica outra vez enquanto continua (o "silenciar" do ecrã fica: o SignalK só
// volta a apitar quando a gravidade sobe) e só limpa com 30 s seguidos sem perigo — passou (TCPA
// negativo), CPA acima de 0,6 MN, os dois parados, ou parado no porto/amarrado; sem velocidade nenhuma,
// só a afastar-se 25 m do mais perto — ou com o alvo perdido (sem posição há 10 min).

const VELHO = 10 * 60 * 1000 // alvo sem posição há mais de 10 min = desapareceu
const LIMPA_CPA = 0.6 * 1852 // histerese: o alarme ativo continua com o CPA abaixo de 0,6 MN
const LIMPA_APOS = 30 * 1000 // e só limpa com tanto tempo seguido sem perigo
const PARADO_PADRAO = 0.5 * 1852 / 3600 // m/s (0,5 nó), se o cálculo não trouxer o seu
const PORTO_PADRAO = { distancia: 0.5 * 1852, sog: 4 * 1852 / 3600 } // idem para o "em porto"
const AMARRADO = 5 * 60 * 1000 // tanto tempo abaixo de 0,5 nó = amarrado ou fundeado
const LARGOU = 60 * 1000 // tanto tempo seguido a andar = largou
const MANTER = 30 * 1000 // um SOG/COG de um alvo em falta: vale o último durante tanto tempo
const MANTER_EU = 10 * 1000 // o nosso (o GPS manda-o de segundo a segundo)
const RASTO_EU = 60 * 1000 // as nossas posições para estimar a nossa velocidade
const RASTO_ALVO = 6 * 60 * 1000 // as de cada alvo (um classe B parado manda de 3 em 3 min)
const RASTO_MAX = 60 // posições guardadas de cada barco (no máximo)
const RASTO_MIN = 30 * 1000 // a estimativa pede 2 posições ou mais em tanto tempo ou mais
const TRECHO = 60 * 1000 // a estimativa usa as posições mais recentes até juntar 1 min e 4 posições
const JANELA_APROX = 3 * 60 * 1000 // a memória das distâncias de cada alvo
const APROX_M = 50 // a aproximar-se: desceu pelo menos isto na janela …
const VOLTA_M = 25 // … e não voltou a subir isto desde o mais perto (já passou)
const MUITO_PERTO = 0.05 * 1852 // a menos disto, um alvo que vem para nós devagar também dá alarme
const PERTO_JANELA = 3 * 60 * 1000 // … pelas posições dele neste tempo …
const PERTO_M = 20 // … se se aproximou pelo menos isto
const PORTO_CONFIRMA = 30 * 1000 // o "em porto" muda com a condição nova tanto tempo seguido
const M_POR_GRAU = 111320

const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const temPos = (p) => p && ok(p.latitude) && ok(p.longitude)

// A distância nas mensagens: abaixo de 0,05 MN em metros (revisão F6, Menor 9: "a 0,0 MN" não diz nada).
const distancia = (m) => (m < 0.05 * 1852 ? `${Math.round(m)} m` : `${(m / 1852).toFixed(1).replace('.', ',')} MN`)
const SEM_RUMO = { alvo: 'alvo sem rumo', eu: 'sem o nosso rumo', ambos: 'sem rumo de nenhum dos dois' }
const PELO_RASTO = { alvo: 'rumo do alvo pelo rasto', eu: 'o nosso rumo pelo rasto', ambos: 'os rumos pelo rasto' }

// Sem o tempo que falta: a mensagem fica parada, o TCPA vivo está no ecrã.
function mensagem (a, r, motivo, quemEstimado) {
  const nome = a.nome || a.mmsi
  if (motivo === 'distancia') return `${nome} a ${distancia(r.distancia)} e a aproximar-se · ${SEM_RUMO[r.semVelocidade]}`
  if (motivo === 'perto') return `${nome} a ${distancia(r.distancia)} e a aproximar-se devagar`
  return `${nome} em rota de colisão · CPA ${distancia(r.cpa)}${quemEstimado ? ` · ${PELO_RASTO[quemEstimado]}` : ''}`
}

function mediana (xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Theil–Sen: a mediana das inclinações (por segundo) entre todos os pares de pontos [{ t (ms) }].
function inclinacao (pts, f) {
  const s = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dt = (pts[j].t - pts[i].t) / 1000
      if (dt > 0) s.push((f(pts[j]) - f(pts[i])) / dt)
    }
  }
  return s.length ? mediana(s) : null
}

function novoBarco () {
  return { sog: null, cog: null, rasto: [] }
}

function novaMemoria () {
  return { amarrado: false, paradoDesde: null, andarDesde: null, eu: novoBarco(), alvos: {}, alarmes: {}, porto: null }
}

// Um SOG ou um COG: { v, em } do lido (um número, com a hora em que foi medido) ou, sem ele, o último
// que houve se não tiver mais de `manter`; null se não há.
function lembrar (guardado, valor, em, agora, manter = MANTER) {
  if (ok(valor) && !(agora - em > manter)) return { v: valor, em }
  return guardado && agora - guardado.em <= manter ? guardado : null
}

// Junta uma posição ao rasto (uma por hora de posição) e esquece as mais velhas que a janela.
function juntar (rasto, p, t, janela) {
  if (!temPos(p) || !ok(t)) return rasto
  const ultimo = rasto.at(-1)
  const r = ultimo && ultimo.t === t ? rasto : [...rasto, { t, lat: p.latitude, lon: p.longitude }]
  return r.filter(x => x.t > t - janela && x.t <= t).slice(-RASTO_MAX)
}

// A velocidade pelo rasto { vx, vy (m/s), duracao (ms) }, com as posições de [desde, …]; null sem
// 2 posições em RASTO_MIN ou mais. Por omissão as mais recentes até juntar TRECHO e 4 posições (segue
// as viragens); um alvo que fala de 3 em 3 min usa as que houver.
function estimar (rasto, { desde = null } = {}) {
  let pts
  if (desde !== null) pts = rasto.filter(p => p.t >= desde)
  else {
    pts = []
    for (let i = rasto.length - 1; i >= 0; i--) {
      pts.unshift(rasto[i])
      if (pts.length >= 4 && pts.at(-1).t - pts[0].t >= TRECHO) break
    }
  }
  if (pts.length < 2 || pts.at(-1).t - pts[0].t < RASTO_MIN) return null
  const ref = pts.at(-1)
  const cosLat = Math.cos(ref.lat * Math.PI / 180)
  const xy = pts.map(p => ({ t: p.t, x: (p.lon - ref.lon) * M_POR_GRAU * cosLat, y: (p.lat - ref.lat) * M_POR_GRAU }))
  return { vx: inclinacao(xy, p => p.x), vy: inclinacao(xy, p => p.y), duracao: ref.t - pts[0].t }
}

// A velocidade a usar: { sog, cog, origem: 'medido' | 'estimado' }, ou null (desconhecida).
function movimento (b, parado) {
  if (b.sog && b.sog.v < parado) return { sog: b.sog.v, origem: 'medido' }
  if (b.sog && b.cog) return { sog: b.sog.v, cog: b.cog.v, origem: 'medido' }
  const v = estimar(b.rasto)
  if (!v) return null
  return { sog: Math.hypot(v.vx, v.vy), cog: (Math.atan2(v.vx, v.vy) + 2 * Math.PI) % (2 * Math.PI), origem: 'estimado' }
}

// O nosso barco amarrado/fundeado? Entra com 5 min parado, sai com 1 min seguido a andar.
function amarracao (m, movEu, agora, parado) {
  const quieto = !!movEu && movEu.sog < parado
  const paradoDesde = quieto ? (m.paradoDesde ?? agora) : null
  const andarDesde = quieto ? null : (m.andarDesde ?? agora)
  const amarrado = m.amarrado
    ? !(andarDesde !== null && agora - andarDesde >= LARGOU)
    : paradoDesde !== null && agora - paradoDesde >= AMARRADO
  return { amarrado, paradoDesde, andarDesde }
}

// O porto conhecido mais perto a menos do raio: { nome, d } ou null. portos: [{ nome, lat, lon }]
function portoPerto (pos, portos, raio) {
  const cosLat = Math.cos(pos.latitude * Math.PI / 180)
  let melhor = null
  for (const p of portos || []) {
    if (!ok(p?.lat) || !ok(p?.lon)) continue
    const d = Math.hypot((p.lon - pos.longitude) * M_POR_GRAU * cosLat, (p.lat - pos.latitude) * M_POR_GRAU)
    if (d <= raio && (!melhor || d < melhor.d)) melhor = { nome: p.nome, d }
  }
  return melhor
}

// Em porto? { valor, nome, candidato, desde }: a 1.ª avaliação diz logo; depois só muda com a condição
// nova PORTO_CONFIRMA seguido. Sem a nossa velocidade (nem pelo rasto) não está em porto (os alarmes
// ficam todos ligados).
function avaliarPorto (antes, pos, movEu, portos, lim, agora) {
  const perto = portoPerto(pos, portos, lim.distancia)
  const bruto = !!perto && !!movEu && movEu.sog < lim.sog
  const nome = perto?.nome ?? null
  if (!antes) return { valor: bruto, nome, candidato: null, desde: null }
  if (bruto === antes.valor) return { valor: bruto, nome: bruto ? nome : antes.nome, candidato: null, desde: null }
  const desde = antes.candidato === bruto ? antes.desde : agora
  if (agora - desde >= PORTO_CONFIRMA) return { valor: bruto, nome, candidato: null, desde: null }
  return { ...antes, candidato: bruto, desde }
}

// A regra da distância (sem a velocidade de um dos barcos): a aproximar-se de forma sustentada.
// hist: [{ t, d }] da janela, já com a distância de agora (d).
function aproximaSe (hist, d, parado) {
  if (hist.length < 2 || hist.at(-1).t - hist[0].t < RASTO_MIN) return false
  let max = -Infinity
  let min = Infinity
  for (const h of hist) { if (h.d > max) max = h.d; if (h.d < min) min = h.d }
  if (!(max - d >= APROX_M && d - min < VOLTA_M)) return false
  const s = inclinacao(hist, h => h.d)
  return s !== null && s <= -parado
}

// Muito perto: o alvo veio para nós pelas posições dele (nos últimos PERTO_JANELA)?
function vemParaNos (rasto, r, agora) {
  if (!(r.distancia < MUITO_PERTO)) return false
  const v = estimar(rasto, { desde: (rasto.at(-1)?.t ?? agora) - PERTO_JANELA })
  if (!v) return false
  const fecho = -(v.vx * Math.sin(r.marcacao) + v.vy * Math.cos(r.marcacao)) // m/s a vir para nós
  return fecho > 0 && fecho * v.duracao / 1000 >= PERTO_M
}

// eu: { position, cog, sog, posEm?, sogEm?, cogEm? } — as horas (ms) em que a posição, o SOG e o COG
//   mudaram pela última vez (sem elas: agora);
// alvos: [{ mmsi, nome, position, cog, sog, em, sogEm?, cogEm? }] — em: a hora da posição do alvo;
//   sogEm/cogEm: as do SOG e do COG (sem elas: as da posição);
// ativos: { mmsi: true }; memoria: a que a avaliação anterior devolveu (ou nada, na primeira);
// opcoes: { portos: [{ nome, lat, lon }] } (os portos conhecidos, para o "em porto").
// Devolve { ativos, notificacoes: [{ mmsi, state, method, message, apito? }], memoria, emPorto }
function avaliarAlvos (ativos, eu, alvos, agora, calc, memoria = novaMemoria(), { portos = [] } = {}) {
  const { cpa, classificar } = calc
  const parado = calc.PARADO ?? PARADO_PADRAO
  const limPorto = calc.LIMITES_PORTO ?? PORTO_PADRAO
  const m0 = { ...novaMemoria(), ...memoria }

  const euMem = {
    sog: lembrar(m0.eu.sog, eu.sog, eu.sogEm ?? agora, agora, MANTER_EU),
    cog: lembrar(m0.eu.cog, eu.cog, eu.cogEm ?? agora, agora, MANTER_EU),
    rasto: juntar(m0.eu.rasto, eu.position, eu.posEm ?? agora, RASTO_EU)
  }
  const movEu = movimento(euMem, parado)
  const euCalc = { position: eu.position, sog: movEu?.sog, cog: movEu?.cog }
  const euFix = euMem.rasto.at(-1)?.t ?? agora
  const porto = temPos(eu.position) ? avaliarPorto(m0.porto, eu.position, movEu, portos, limPorto, agora) : m0.porto
  const emPorto = !!porto?.valor
  const m = { ...amarracao(m0, movEu, agora, parado), eu: euMem, alvos: {}, alarmes: {}, porto }

  const novos = {}
  const notificacoes = []
  const vistos = new Set()

  for (const a of alvos) {
    if (!a.em || agora - a.em > VELHO) continue
    vistos.add(a.mmsi)
    const g = m0.alvos[a.mmsi] || novoBarco()
    const am = {
      sog: lembrar(g.sog, a.sog, a.sogEm ?? a.em, a.em),
      cog: lembrar(g.cog, a.cog, a.cogEm ?? a.em, a.em),
      rasto: juntar(g.rasto, a.position, a.em, RASTO_ALVO),
      dist: g.dist || [],
      pendente: g.pendente ?? null
    }
    m.alvos[a.mmsi] = am
    const movA = movimento(am, parado)
    const r = cpa(euCalc, { position: a.position, sog: movA?.sog, cog: movA?.cog })
    if (!r) continue
    am.dist = [...am.dist.filter(h => h.t > agora - JANELA_APROX), { t: agora, d: r.distancia }]

    const aproxima = !!r.semVelocidade && aproximaSe(am.dist, r.distancia, parado) // a regra da distância só conta assim
    const classe = classificar(r, undefined, { aproxima, emPorto })
    // amarrados ou fundeados: um alvo também parado nunca é colisão (decisão n.º 3)
    const porCpa = classe === 'perigo' && !(m.amarrado && r.alvoParado === true)
    const perto = vemParaNos(am.rasto, r, agora)
    const estimadoEu = movEu?.origem === 'estimado'
    const estimadoAlvo = movA?.origem === 'estimado'
    const quemEstimado = estimadoEu ? (estimadoAlvo ? 'ambos' : 'eu') : estimadoAlvo ? 'alvo' : null
    const motivo = porCpa ? (r.semVelocidade ? 'distancia' : quemEstimado ? 'estimado' : 'medido') : perto ? 'perto' : null

    if (ativos[a.mmsi]) {
      // ativo: continua enquanto houver perigo ou dúvida; limpa com LIMPA_APOS seguido sem perigo
      const antes = m0.alarmes[a.mmsi] || {}
      const al = { message: antes.message, desde: antes.desde ?? agora, vistoEm: a.em, dMin: Math.min(antes.dMin ?? Infinity, r.distancia), seguroDesde: antes.seguroDesde ?? null }
      let seguro
      if (motivo) seguro = false
      else if (r.semVelocidade) seguro = r.distancia - al.dMin >= VOLTA_M
      else {
        const calado = (emPorto || m.amarrado) && r.alvoParado === true
        seguro = calado || !(Number.isFinite(r.tcpa) && r.tcpa >= 0 && r.cpa < LIMPA_CPA)
      }
      al.seguroDesde = seguro ? (al.seguroDesde ?? agora) : null
      if (seguro && agora - al.seguroDesde >= LIMPA_APOS) {
        notificacoes.push({ mmsi: a.mmsi, state: 'normal', method: [], message: 'Normal' })
      } else {
        novos[a.mmsi] = true
        m.alarmes[a.mmsi] = al
      }
      am.pendente = null
    } else if (motivo) {
      // um alarme que vem de uma velocidade estimada ou da regra da distância só sai confirmado numa
      // avaliação com uma posição nova de quem não tem velocidade medida
      const chave = motivo === 'estimado' ? `${estimadoEu ? euFix : ''}|${estimadoAlvo ? a.em : ''}` : `${euFix}|${a.em}`
      if (motivo === 'medido' || (am.pendente !== null && am.pendente !== chave)) {
        const message = mensagem(a, r, motivo, quemEstimado)
        novos[a.mmsi] = true
        m.alarmes[a.mmsi] = { message, desde: agora, vistoEm: a.em, dMin: r.distancia, seguroDesde: null }
        // colisão = perigo imediato: apito contínuo (decisão n.º 2, contrato C1)
        notificacoes.push({ mmsi: a.mmsi, state: 'alarm', method: ['visual', 'sound'], apito: 'continuo', message })
        am.pendente = null
      } else if (am.pendente === null) am.pendente = chave
    } else am.pendente = null
  }

  // Alvos com alarme que não vieram nesta avaliação: o alarme fica até o alvo se perder (sem posição
  // há VELHO); um que nunca se viu (ou de que não há memória) perdeu-se já.
  for (const mmsi of Object.keys(ativos)) {
    if (vistos.has(mmsi)) continue
    const al = m0.alarmes[mmsi]
    if (al && ok(al.vistoEm) && agora - al.vistoEm <= VELHO) {
      novos[mmsi] = true
      m.alarmes[mmsi] = al
      continue
    }
    notificacoes.push({ mmsi, state: 'normal', method: [], message: 'Alvo perdido' })
  }
  // a memória dos alvos que não vieram fica enquanto não estiverem perdidos
  for (const [mmsi, g] of Object.entries(m0.alvos)) {
    if (!m.alvos[mmsi] && agora - (g.rasto.at(-1)?.t ?? -Infinity) <= VELHO) m.alvos[mmsi] = g
  }
  return { ativos: novos, notificacoes, memoria: m, emPorto }
}

module.exports = { avaliarAlvos, novaMemoria, VELHO, LIMPA_APOS, MUITO_PERTO, MANTER, MANTER_EU }
