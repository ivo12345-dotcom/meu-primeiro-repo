'use strict'
// O plano ativo (desenho 3b-2, "Plano ativo"): o que fica gravado ao Ativar uma alternativa, para o
// plugin seguir a viagem a navegar (com o ecrã desligado e depois de reinícios).
//
// criarPlano({ idCalculo, resultado, indice, href, aproximacao?, envio?, agora }) → plano:
//   { versao: 1, idCalculo, indice, ativadoEm, href, estado, pausadoDe, saida, chegou, fechadoEm,
//     tripulacao, alternativa: { id, nome, propulsao, semVela, partida, chegada, milhas, horas,
//     gasoleoL, pontosRota, rasto, eventos }, destino: { id, nome, aproximacao, cais: { lat, lon } },
//     partida: { nome, lat, lon }, desistencia, desistenciaResumo,
//     envio: null | { contactos: [nome], alarme: iso, pedido, enviadoEm } }
//   aproximacao: a do destino na lista (dados/destinos.json ou os do Ivo), [[lat, lon], …]; sem ela
//   (um destino avulso), o último ponto da rota. O cais é sempre o último ponto da rota (o fim da
//   aproximação). A desistência só se calcula para a 1.ª alternativa: nas outras fica vazia.
// Estados: 'a espera de sair' → 'a navegar' → 'chegado'; 'terminado' (botão Terminar); 'pausado'
//   (a rota ativa deixou de ser a do plano), que volta ao estado de antes (pausadoDe) quando a rota
//   do plano volta a estar ativa (Continuar, ou o Ivo no OpenCPN).
// avaliar(plano, leitura, mem, agora, opcoes?) → { plano, mem, mudou: null | 'saiu' | 'chegou' | 'pausado' | 'retomado' }
//   leitura: { posicao: { lat, lon } | null (sem GPS), sogNos: número | null, href: string | null
//   (nenhuma rota ativa) | undefined (não se sabe: a API de rumo não respondeu), milhas: as milhas
//   feitas na rota (lib/acompanhamento.js) | null }; opcoes.portos: [{ id, nome, cais }] (a lista).
//   mem: os temporizadores dos "seguidos" (só em memória: num reinício recomeçam, e a saída ou a
//   chegada dão-se mais tarde, nunca a dobrar) e a sugestão de outro porto. Funções puras: o plano de
//   entrada não muda. As janelas "seguidos" só contam amostras a ≤ 2 min umas das outras (um salto do
//   relógio, para a frente ou para trás, recomeça-as).
//   Saída: a mais de 0,5 MN da partida em 2 amostras seguidas (saída = a 1.ª; um salto do GPS no cais
//   não é a saída), ou SOG > 2 nós durante 5 min seguidos (saída = o início dos 5 min); navegarDesde =
//   a hora em que passou a "a navegar".
//   Chegada ("a navegar", ou pausado depois de sair): a menos de 0,3 MN do cais e SOG < 0,5 nó durante
//   5 min seguidos, com progresso real (decisão do Ivo de 01/10): ≥ 50 % das milhas da rota, ou, numa
//   rota com menos de 1 MN, 5 min "a navegar" antes (chegou = o início dos 5 min parado).
//   Pausado depois de sair, parado (SOG < 0,5 nó) 30 min a menos de 0,3 MN de outro porto da lista (não
//   o destino): mem.sugestao = { id, nome, desde } (o ecrã pergunta "Chegaste a X?"; o plano não muda).
// chegarA(plano, { id, nome }, chegou, agora): fecha o plano como chegado a outro porto (o botão).
// gravar(dir, plano): plano-ativo.json, escrita atómica com fsync (lib/previsao.js escreverAtomico).
// ler(dir) → { plano | null, erro | null } (um ficheiro estragado não é um plano: o erro diz porquê).
// arquivar(dir, plano, agora): o plano substituído vai para planos-fechados.json (os 5 mais recentes;
// decisão do Ivo de 01/10: o plano-ativo.json não cresce de viagem para viagem); lerFechados(dir).

const fs = require('node:fs')
const path = require('node:path')
const c = require('./costa')
const { escreverAtomico } = require('./previsao')

const MIN = 60000
const FICHEIRO = 'plano-ativo.json'
const FECHADOS = 'planos-fechados.json'
const MAX_FECHADOS = 5
const ESTADOS = Object.freeze({ ESPERA: 'a espera de sair', NAVEGAR: 'a navegar', CHEGADO: 'chegado', TERMINADO: 'terminado', PAUSADO: 'pausado' })
const ABERTOS = new Set([ESTADOS.ESPERA, ESTADOS.NAVEGAR, ESTADOS.PAUSADO])
const PADRAO = Object.freeze({
  saidaMn: 0.5, saidaSogNos: 2, saidaMin: 5, chegadaMn: 0.3, chegadaSogNos: 0.5, chegadaMin: 5,
  progresso: 0.5, rotaCurtaMn: 1, navegarMin: 5, outroPortoMin: 30, amostrasMaxMin: 2
})

const iso = (t) => new Date(t).toISOString()
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const ponto = (p) => ({ lat: p.lat, lon: p.lon })

function criarPlano ({ idCalculo, resultado, indice, href, aproximacao = null, envio = null, agora }) {
  const alt = resultado?.alternativas?.[indice]
  if (!alt) throw new Error('alternativa desconhecida')
  const pts = alt.pontosRota || []
  const cais = pts.length ? ponto(pts.at(-1)) : null
  const partida = pts.length ? ponto(pts[0]) : null
  const aprox = Array.isArray(aproximacao) && aproximacao.length ? aproximacao.map(([lat, lon]) => [lat, lon]) : cais ? [[cais.lat, cais.lon]] : []
  return {
    versao: 1,
    idCalculo,
    indice,
    ativadoEm: iso(agora),
    href,
    estado: ESTADOS.ESPERA,
    pausadoDe: null,
    saida: null,
    chegou: null,
    fechadoEm: null,
    tripulacao: resultado.tripulacao === 'acompanhado' ? 'acompanhado' : 'so',
    alternativa: {
      id: alt.id,
      nome: alt.nome,
      propulsao: alt.propulsao,
      semVela: typeof alt.semVela === 'boolean' ? alt.semVela : null,
      partida: alt.partida,
      chegada: alt.chegada,
      milhas: alt.milhas ?? null,
      horas: alt.horas ?? null,
      gasoleoL: alt.gasoleoL ?? null,
      pontosRota: pts,
      rasto: alt.rasto || [],
      eventos: alt.eventos || []
    },
    destino: { id: resultado.destino?.id ?? null, nome: resultado.destino?.nome ?? 'destino', aproximacao: aprox, cais },
    partida: partida && { nome: resultado.partida?.nome ?? 'partida', ...partida },
    desistencia: indice === 0 && Array.isArray(resultado.desistencia) ? resultado.desistencia : [],
    desistenciaResumo: indice === 0 ? resultado.desistenciaResumo ?? null : null,
    envio: envio ? { ...envio, contactos: [...(envio.contactos || [])] } : null
  }
}

const aberto = (p) => !!p && ABERTOS.has(p.estado)
// longeDesde: a 1.ª amostra a mais de 0,5 MN da partida; outro: { id, desde } o outro porto onde está
// parado (em pausa); sugestao: { id, nome, desde } ao fim de 30 min; ultimaT: a hora da última amostra
const novaMemoria = () => ({ sogAltaDesde: null, paradoDesde: null, longeDesde: null, outro: null, sugestao: null, ultimaT: null })
const semJanelas = (m) => Object.assign(m, { sogAltaDesde: null, paradoDesde: null, longeDesde: null, outro: null, sugestao: null })

// o comprimento da rota do plano (MN)
function comprimentoRota (p) {
  const pts = (p.alternativa?.pontosRota || []).filter(x => Number.isFinite(x?.lat) && Number.isFinite(x?.lon))
  return pts.length > 1 ? c.prepararLinha(pts).total : 0
}
// o progresso real (decisão do Ivo de 01/10): ≥ 50 % das milhas da rota, ou, numa rota com menos de
// 1 MN, pelo menos 5 min "a navegar"
function comProgresso (p, milhas, agora, o) {
  const total = comprimentoRota(p)
  if (Number.isFinite(milhas) && total > 0 && milhas >= o.progresso * total) return true
  if (total >= o.rotaCurtaMn) return false
  const desde = Date.parse(p.navegarDesde ?? p.saida)
  return Number.isFinite(desde) && agora - desde >= o.navegarMin * MIN
}
// a chegada ao cais do plano (a navegar, ou em pausa no mar): perto, parado e com progresso, 5 min
// seguidos; true quando chega
function verChegada (p, m, pos, sog, milhas, agora, o) {
  const perto = p.destino?.cais && c.distanciaMn(pos, p.destino.cais) < o.chegadaMn
  if (!(perto && sog != null && sog < o.chegadaSogNos && comProgresso(p, milhas, agora, o))) { m.paradoDesde = null; return false }
  if (m.paradoDesde == null) m.paradoDesde = agora
  if (agora - m.paradoDesde < o.chegadaMin * MIN) return false
  p.estado = ESTADOS.CHEGADO
  p.pausadoDe = null
  p.chegou = iso(m.paradoDesde)
  p.fechadoEm = iso(agora)
  return true
}
// em pausa no mar, parado perto de outro porto da lista (não o destino): a sugestão ao fim de 30 min
function verOutroPorto (p, m, pos, sog, portos, agora, o) {
  const perto = sog != null && sog < o.chegadaSogNos
    ? (portos || []).find(x => x?.cais && x.id !== p.destino?.id && c.distanciaMn(pos, x.cais) < o.chegadaMn)
    : null
  if (!perto) { m.outro = null; m.sugestao = null; return }
  if (m.outro?.id !== perto.id) m.outro = { id: perto.id, desde: agora }
  m.sugestao = agora - m.outro.desde >= o.outroPortoMin * MIN ? { id: perto.id, nome: perto.nome, desde: m.outro.desde } : null
}

// opcoes: os limites (PADRAO) e portos: [{ id, nome, cais: { lat, lon } }] (os da lista, para a
// sugestão em pausa); leitura.milhas: as milhas feitas na rota (lib/acompanhamento.js) ou null
function avaliar (plano, leitura = {}, mem = novaMemoria(), agora, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const p = { ...plano }
  const m = { ...novaMemoria(), ...mem }
  const fim = (mudou) => ({ plano: p, mem: m, mudou })
  if (!aberto(p)) return fim(null)
  // as janelas "seguidos" só com amostras a ≤ 2 min umas das outras: um salto do relógio (para a frente
  // ou para trás) ou um ciclo que parou recomeçam-nas
  if (m.ultimaT != null && (agora - m.ultimaT > o.amostrasMaxMin * MIN || agora < m.ultimaT)) semJanelas(m)
  m.ultimaT = agora
  // a rota ativa: só quando se sabe (undefined: a API de rumo não respondeu)
  if (leitura.href !== undefined) {
    const daPlano = leitura.href === p.href
    if (p.estado !== ESTADOS.PAUSADO && !daPlano) {
      p.pausadoDe = p.estado
      p.estado = ESTADOS.PAUSADO
      return { plano: p, mem: { ...novaMemoria(), ultimaT: agora }, mudou: 'pausado' }
    }
    if (p.estado === ESTADOS.PAUSADO && daPlano) {
      p.estado = p.pausadoDe || ESTADOS.ESPERA
      p.pausadoDe = null
      return { plano: p, mem: { ...novaMemoria(), ultimaT: agora }, mudou: 'retomado' }
    }
  }
  const pos = leitura.posicao && Number.isFinite(leitura.posicao.lat) && Number.isFinite(leitura.posicao.lon) ? leitura.posicao : null
  const sog = Number.isFinite(leitura.sogNos) ? leitura.sogNos : null
  const milhas = Number.isFinite(leitura.milhas) ? leitura.milhas : null
  if (!pos) { semJanelas(m); return fim(null) }

  // em pausa (decisão do Ivo de 01/10, "ver a chegada mesmo em pausa"): só depois de sair; a chegada ao
  // cais do plano conta como a navegar; parado noutro porto da lista, só a sugestão
  if (p.estado === ESTADOS.PAUSADO) {
    if (p.pausadoDe !== ESTADOS.NAVEGAR) { semJanelas(m); return fim(null) }
    if (verChegada(p, m, pos, sog, milhas, agora, o)) return { plano: p, mem: { ...novaMemoria(), ultimaT: agora }, mudou: 'chegou' }
    verOutroPorto(p, m, pos, sog, o.portos, agora, o)
    return fim(null)
  }
  m.outro = null
  m.sugestao = null

  if (p.estado === ESTADOS.ESPERA) {
    const sai = (desde) => {
      p.estado = ESTADOS.NAVEGAR
      p.saida = iso(desde)
      p.navegarDesde = iso(agora)
      return { plano: p, mem: { ...novaMemoria(), ultimaT: agora }, mudou: 'saiu' }
    }
    // a mais de 0,5 MN em 2 amostras seguidas (um salto do GPS no cais não é a saída)
    if (p.partida && c.distanciaMn(pos, p.partida) > o.saidaMn) {
      if (m.longeDesde != null) return sai(m.longeDesde)
      m.longeDesde = agora
    } else m.longeDesde = null
    if (sog != null && sog > o.saidaSogNos) {
      if (m.sogAltaDesde == null) m.sogAltaDesde = agora
      if (agora - m.sogAltaDesde >= o.saidaMin * MIN) return sai(m.sogAltaDesde)
    } else m.sogAltaDesde = null
    return fim(null)
  }

  // a navegar: a chegada
  if (verChegada(p, m, pos, sog, milhas, agora, o)) return { plano: p, mem: { ...novaMemoria(), ultimaT: agora }, mudou: 'chegou' }
  return fim(null)
}

function terminar (plano, agora) {
  return { ...plano, estado: ESTADOS.TERMINADO, pausadoDe: null, fechadoEm: iso(agora) }
}

// "Cheguei bem a X" pelo botão (decisão 5): fecha o plano como chegado a outro porto
function chegarA (plano, destino, chegou, agora) {
  return { ...plano, estado: ESTADOS.CHEGADO, pausadoDe: null, chegou: iso(chegou), fechadoEm: iso(agora), chegouA: { id: destino.id, nome: destino.nome } }
}

// Os planos substituídos (decisão do Ivo de 01/10): planos-fechados.json, só os 5 mais recentes
function lerFechados (dir) {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(dir, FECHADOS), 'utf8'))
    return Array.isArray(l) ? l.filter(eObjeto) : []
  } catch { return [] }
}
function arquivar (dir, plano, agora, max = MAX_FECHADOS) {
  fs.mkdirSync(dir, { recursive: true })
  const l = [...lerFechados(dir), { ...plano, arquivadoEm: iso(agora) }].slice(-max)
  escreverAtomico(path.join(dir, FECHADOS), JSON.stringify(l))
}

function continuar (plano) {
  if (plano.estado !== ESTADOS.PAUSADO) return { ...plano }
  return { ...plano, estado: plano.pausadoDe || ESTADOS.ESPERA, pausadoDe: null }
}

function gravar (dir, plano) {
  fs.mkdirSync(dir, { recursive: true })
  escreverAtomico(path.join(dir, FICHEIRO), JSON.stringify(plano))
}

function ler (dir) {
  let texto
  try { texto = fs.readFileSync(path.join(dir, FICHEIRO), 'utf8') } catch (e) {
    return { plano: null, erro: e.code === 'ENOENT' ? null : `${FICHEIRO} ilegível: ${e.message}` }
  }
  try {
    const p = JSON.parse(texto)
    if (!eObjeto(p) || p.versao !== 1 || typeof p.estado !== 'string' || !eObjeto(p.alternativa)) return { plano: null, erro: `${FICHEIRO} ilegível: não é um plano` }
    return { plano: p, erro: null }
  } catch (e) { return { plano: null, erro: `${FICHEIRO} ilegível: ${e.message}` } }
}

module.exports = { FICHEIRO, FECHADOS, ESTADOS, PADRAO, criarPlano, aberto, novaMemoria, avaliar, terminar, chegarA, continuar, gravar, ler, arquivar, lerFechados, comprimentoRota }
