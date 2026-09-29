'use strict'
// Calibração completa do depósito (Ivo, 29/09): depósito vazio e limpo, e
// depois gasóleo aos 5 L. A cada adição espera-se que a leitura estabilize e
// grava-se o ponto (razão, litros). Onde a boia deixa de mexer ("bate" no fundo
// ou no topo) não se metem pontos repetidos: regista-se o intervalo.
// Também importa a folha do multímetro (litros, V sonda, V alimentação).
// Lógica pura; o plugin guarda a sessão e expõe-a ao ecrã.

const S = 1000
const JANELA = 20 * S // estável = 20 s de leituras …
const MIN_AMOSTRAS = 15
const VARIACAO = 0.004 // … todas dentro de ±0,002
const ESPERA = 30 * S // e pelo menos 30 s depois de deitar o gasóleo
const BOIA_PARADA = 0.003 // razão que quase não mexeu = boia parada

function estavelAgora (amostras, agora) {
  const r = amostras.filter(a => a.t > agora - JANELA).map(a => a.razao)
  return r.length >= MIN_AMOSTRAS && Math.max(...r) - Math.min(...r) <= VARIACAO
}

const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// Começa com o depósito no nível inicial (normalmente 0 = vazio).
function iniciar (litrosIniciais = 0) {
  return { pontos: [], total: litrosIniciais, pendente: { litros: litrosIniciais, desde: null }, amostras: [], boiaParada: null }
}

function gravar (c, agora) {
  const r = media(c.amostras.filter(a => a.t > agora - JANELA).map(a => a.razao))
  const litros = c.pendente.litros
  const ultimo = c.pontos[c.pontos.length - 1]
  let boiaParada = c.boiaParada
  let pontos = c.pontos
  if (ultimo && Math.abs(r - ultimo.razao) < BOIA_PARADA) {
    // A boia não mexeu: guarda-se só o intervalo, para saber onde o medidor mente.
    boiaParada = { de: boiaParada?.ate === ultimo.litros || boiaParada?.de === ultimo.litros ? boiaParada.de : ultimo.litros, ate: litros }
  } else {
    pontos = [...pontos, { razao: Math.round(r * 10000) / 10000, litros }]
  }
  return { ...c, pontos, boiaParada, pendente: null }
}

// Uma leitura (1 por segundo). Grava o pendente quando estabiliza.
function amostra (c, { t, razao }) {
  if (typeof razao !== 'number') return c
  const n = { ...c, amostras: [...c.amostras.filter(a => a.t > t - JANELA), { t, razao }] }
  if (!n.pendente) return n
  if (n.pendente.desde === null) n.pendente = { ...n.pendente, desde: t }
  if (t - n.pendente.desde >= (n.pontos.length === 0 && n.total === n.pendente.litros ? 0 : ESPERA) && estavelAgora(n.amostras, t)) {
    return gravar(n, t)
  }
  return n
}

// "Deitei mais X litros."
function adicionar (c, litros, agora) {
  if (c.pendente) throw new Error('ainda a estabilizar o ponto anterior')
  if (!(litros > 0)) throw new Error('litros inválidos')
  const total = c.total + litros
  return { ...c, total, pendente: { litros: total, desde: agora, antes: c.total } }
}

function desfazer (c) {
  if (c.pendente) return { ...c, total: c.pendente.antes ?? c.total, pendente: null }
  const ultimo = c.pontos[c.pontos.length - 1]
  if (!ultimo) return c
  const anterior = c.pontos[c.pontos.length - 2]
  return { ...c, pontos: c.pontos.slice(0, -1), total: anterior ? anterior.litros : 0 }
}

// Fecha a sessão: a tabela nova e, se o depósito ficou cheio, a capacidade real.
function terminar (c, { cheio = false } = {}) {
  if (c.pontos.length < 2) throw new Error('são precisos pelo menos 2 pontos')
  return { tabela: c.pontos, capacidadeL: cheio ? c.total : null, boiaParada: c.boiaParada }
}

// Folha do multímetro: [{ litros, sonda (V), alimentacao (V) }] → tabela.
function importar (linhas) {
  let c = { pontos: [], total: 0, pendente: null, amostras: [], boiaParada: null }
  for (const l of [...linhas].sort((a, b) => a.litros - b.litros)) {
    if (!(l.alimentacao > 1)) throw new Error(`alimentação inválida aos ${l.litros} L`)
    c = gravar({ ...c, pendente: { litros: l.litros }, amostras: [{ t: 0, razao: l.sonda / l.alimentacao }] }, 1)
  }
  return { tabela: c.pontos, boiaParada: c.boiaParada }
}

module.exports = { iniciar, amostra, adicionar, desfazer, terminar, importar, estavelAgora }
