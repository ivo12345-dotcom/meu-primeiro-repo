'use strict'
// Caixa negra em bruto: todas as mensagens do SignalK, uma por linha (NDJSON),
// num ficheiro comprimido por hora (UTC). As linhas juntam-se em memória e cada
// despejo acrescenta um bloco gzip ao ficheiro: um .gz com vários blocos lê-se
// inteiro (zcat/gunzip) e, se o Pi se desligar, perde-se só o último intervalo.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const nomeHora = (t) => new Date(t).toISOString().slice(0, 13) + '.ndjson.gz'

function criarGravadorBruto (dir) {
  fs.mkdirSync(dir, { recursive: true })
  let linhas = [] // { nome, texto }
  let parado = false
  return {
    escrever (delta, agora) {
      if (parado) return
      linhas.push({ nome: nomeHora(agora), texto: JSON.stringify(delta) })
    },
    despejar () {
      const porFicheiro = new Map()
      for (const l of linhas) {
        if (!porFicheiro.has(l.nome)) porFicheiro.set(l.nome, [])
        porFicheiro.get(l.nome).push(l.texto)
      }
      linhas = []
      let bytes = 0
      for (const [nome, textos] of porFicheiro) {
        const gz = zlib.gzipSync(textos.join('\n') + '\n')
        fs.appendFileSync(path.join(dir, nome), gz)
        bytes += gz.length
      }
      return bytes
    },
    parar () { parado = true; linhas = [] },
    retomar () { parado = false },
    get parado () { return parado },
    get pendentes () { return linhas.length }
  }
}

module.exports = { criarGravadorBruto, nomeHora }
