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
// avaliar(plano, leitura, mem, agora) → { plano, mem, mudou: null | 'saiu' | 'chegou' | 'pausado' | 'retomado' }
//   leitura: { posicao: { lat, lon } | null (sem GPS), sogNos: número | null, href: string | null
//   (nenhuma rota ativa) | undefined (não se sabe: a API de rumo não respondeu) }.
//   mem: os temporizadores dos "5 min seguidos" (só em memória: num reinício recomeçam, e a saída ou a
//   chegada dão-se mais tarde, nunca a dobrar). Funções puras: o plano de entrada não muda.
//   Saída: a mais de 0,5 MN da partida (saída = agora), ou SOG > 2 nós durante 5 min seguidos (saída =
//   o início dos 5 min). Chegada (só "a navegar"): a menos de 0,3 MN do cais e SOG < 0,5 nó durante
//   5 min seguidos (chegou = o início dos 5 min).
// gravar(dir, plano): plano-ativo.json, escrita atómica com fsync (lib/previsao.js escreverAtomico).
// ler(dir) → { plano | null, erro | null } (um ficheiro estragado não é um plano: o erro diz porquê).

const fs = require('node:fs')
const path = require('node:path')
const c = require('./costa')
const { escreverAtomico } = require('./previsao')

const MIN = 60000
const FICHEIRO = 'plano-ativo.json'
const ESTADOS = Object.freeze({ ESPERA: 'a espera de sair', NAVEGAR: 'a navegar', CHEGADO: 'chegado', TERMINADO: 'terminado', PAUSADO: 'pausado' })
const ABERTOS = new Set([ESTADOS.ESPERA, ESTADOS.NAVEGAR, ESTADOS.PAUSADO])
const PADRAO = Object.freeze({ saidaMn: 0.5, saidaSogNos: 2, saidaMin: 5, chegadaMn: 0.3, chegadaSogNos: 0.5, chegadaMin: 5 })

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
const novaMemoria = () => ({ sogAltaDesde: null, paradoDesde: null })

function avaliar (plano, leitura = {}, mem = novaMemoria(), agora, opcoes = {}) {
  const o = { ...PADRAO, ...opcoes }
  const p = { ...plano }
  const m = { ...novaMemoria(), ...mem }
  const fim = (mudou) => ({ plano: p, mem: m, mudou })
  if (!aberto(p)) return fim(null)
  // a rota ativa: só quando se sabe (undefined: a API de rumo não respondeu)
  if (leitura.href !== undefined) {
    const daPlano = leitura.href === p.href
    if (p.estado !== ESTADOS.PAUSADO && !daPlano) {
      p.pausadoDe = p.estado
      p.estado = ESTADOS.PAUSADO
      return { plano: p, mem: novaMemoria(), mudou: 'pausado' }
    }
    if (p.estado === ESTADOS.PAUSADO && daPlano) {
      p.estado = p.pausadoDe || ESTADOS.ESPERA
      p.pausadoDe = null
      return { plano: p, mem: novaMemoria(), mudou: 'retomado' }
    }
  }
  if (p.estado === ESTADOS.PAUSADO) return fim(null)
  const pos = leitura.posicao && Number.isFinite(leitura.posicao.lat) && Number.isFinite(leitura.posicao.lon) ? leitura.posicao : null
  const sog = Number.isFinite(leitura.sogNos) ? leitura.sogNos : null
  if (!pos) { m.sogAltaDesde = null; m.paradoDesde = null; return fim(null) }

  if (p.estado === ESTADOS.ESPERA) {
    if (p.partida && c.distanciaMn(pos, p.partida) > o.saidaMn) {
      p.estado = ESTADOS.NAVEGAR
      p.saida = iso(agora)
      return { plano: p, mem: novaMemoria(), mudou: 'saiu' }
    }
    if (sog != null && sog > o.saidaSogNos) {
      if (m.sogAltaDesde == null) m.sogAltaDesde = agora
      if (agora - m.sogAltaDesde >= o.saidaMin * MIN) {
        p.estado = ESTADOS.NAVEGAR
        p.saida = iso(m.sogAltaDesde)
        return { plano: p, mem: novaMemoria(), mudou: 'saiu' }
      }
    } else m.sogAltaDesde = null
    return fim(null)
  }

  // a navegar: a chegada
  const perto = p.destino?.cais && c.distanciaMn(pos, p.destino.cais) < o.chegadaMn
  if (perto && sog != null && sog < o.chegadaSogNos) {
    if (m.paradoDesde == null) m.paradoDesde = agora
    if (agora - m.paradoDesde >= o.chegadaMin * MIN) {
      p.estado = ESTADOS.CHEGADO
      p.chegou = iso(m.paradoDesde)
      p.fechadoEm = iso(agora)
      return { plano: p, mem: novaMemoria(), mudou: 'chegou' }
    }
  } else m.paradoDesde = null
  return fim(null)
}

function terminar (plano, agora) {
  return { ...plano, estado: ESTADOS.TERMINADO, pausadoDe: null, fechadoEm: iso(agora) }
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

module.exports = { FICHEIRO, ESTADOS, PADRAO, criarPlano, aberto, novaMemoria, avaliar, terminar, continuar, gravar, ler }
