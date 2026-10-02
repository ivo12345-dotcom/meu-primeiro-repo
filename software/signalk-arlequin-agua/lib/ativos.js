'use strict'
// Os alarmes ativos do plugin num ficheiro da pasta de dados (nota do SignalK 2.33, adenda 2 da auditoria):
// ao parar um plugin o servidor apaga da árvore os valores dele (removeSource), e cada reinício parecia um
// alarme resolvido. No arranque seguinte o plugin volta a publicá-los — o mesmo caminho e o mesmo valor —
// e as regras continuam a partir deles (decidem depois se ficam ou passam a normal).
// Ficheiro: { em, ativos: { caminho: valor }, estado } — em: a última vez que se gravou (quando os ativos
// mudam, de minuto a minuto enquanto houver algum, e no stop()); estado: o que a regra do plugin precisa
// para continuar (ou nada). Um ficheiro com mais de VALIDADE (o Pi esteve desligado) não repõe nada: as
// regras voltam a dar os alarmes que ainda forem verdade. Escrita atómica (tmp + rename). Este ficheiro é
// igual nos plugins dos sensores (J1939, gasóleo, energia, água); o do AIS tem o seu (lib/vigia.js).

const fs = require('node:fs')

const VALIDADE = 10 * 60 * 1000
const GRAVAR = 60 * 1000

const ativo = (valor) => !!valor && typeof valor === 'object' && typeof valor.state === 'string' && valor.state !== 'normal'

function criarAtivos (ficheiro, { erro = () => {}, agora = () => Date.now() } = {}) {
  let mapa = {}
  let gravado = null
  let gravadoEm = -Infinity

  // Os do ficheiro, se for recente: { ativos: { caminho: valor }, estado }. Também passam a ser os de agora.
  function repor () {
    let j = null
    try { j = JSON.parse(fs.readFileSync(ficheiro, 'utf8')) } catch { /* sem ficheiro (1.ª vez) ou ilegível */ }
    const fresco = j && typeof j === 'object' && Number.isFinite(j.em) && agora() - j.em <= VALIDADE && agora() >= j.em
    const ativos = {}
    if (fresco && j.ativos && typeof j.ativos === 'object') {
      for (const [caminho, valor] of Object.entries(j.ativos)) if (typeof caminho === 'string' && caminho.startsWith('notifications.') && ativo(valor)) ativos[caminho] = valor
    }
    mapa = { ...ativos }
    return { ativos, estado: fresco ? (j.estado ?? null) : null }
  }

  // Os valores publicados ([{ path, value }]): uma notificação ativa fica, uma normal sai.
  function registar (values) {
    for (const { path: caminho, value } of values || []) {
      if (typeof caminho !== 'string' || !caminho.startsWith('notifications.')) continue
      if (ativo(value)) mapa[caminho] = value
      else delete mapa[caminho]
    }
  }

  // Grava se os ativos mudaram, de GRAVAR em GRAVAR enquanto houver algum, ou com forcar (o stop()).
  function gravar ({ estado = null, forcar = false } = {}) {
    const t = agora()
    const conteudo = JSON.stringify(mapa)
    const algum = conteudo !== '{}'
    if (!forcar && conteudo === gravado && !(algum && t - gravadoEm >= GRAVAR)) return
    if (!forcar && gravado === null && !algum) { gravado = conteudo; return } // nada a dizer (o arranque sem alarmes)
    try {
      fs.writeFileSync(ficheiro + '.tmp', JSON.stringify({ em: t, ativos: mapa, ...(algum && estado ? { estado } : {}) }))
      fs.renameSync(ficheiro + '.tmp', ficheiro)
      gravado = conteudo
      gravadoEm = t
    } catch (e) { erro(`não gravei os alarmes ativos (${ficheiro}): ${e.message}`) }
  }

  return { repor, registar, gravar, lista: () => ({ ...mapa }) }
}

module.exports = { criarAtivos, VALIDADE, GRAVAR }
