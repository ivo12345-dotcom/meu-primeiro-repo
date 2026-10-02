'use strict'
// A fotografia do interior: corre o comando da câmara (comandoFoto, com {ficheiro} no sítio do JPEG a
// escrever) e devolve o JPEG. Tirada do index.js (auditoria F4b, revisão da F4, Menor 15).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec: execPadrao } = require('node:child_process')

// O ficheiro temporário desta fotografia, só seu: com o processo e um contador além da hora, dois pedidos no
// mesmo milissegundo (ou dois processos) não se pisam. Antes era só a hora: um lia e apagava a fotografia do
// outro ("ENOENT") e o Ivo recebia "a câmara falhou" (apanhado com os testes em paralelo).
let pedidos = 0
function nomeTemporario () {
  return path.join(os.tmpdir(), `arlequin-foto-${process.pid}-${Date.now()}-${++pedidos}.jpg`)
}

// → Promise<Buffer>; rejeita com semCamara se não há comando, ou com "câmara: …" se a câmara falha
function tirarFoto (comando, { exec = execPadrao } = {}) {
  return new Promise((resolve, reject) => {
    if (!comando) return reject(Object.assign(new Error('sem câmara configurada'), { semCamara: true }))
    const f = nomeTemporario()
    exec(comando.replace('{ficheiro}', f), { timeout: 20000 }, (e) => {
      if (e) return reject(new Error(`câmara: ${e.message}`))
      try { const b = fs.readFileSync(f); fs.unlink(f, () => {}); resolve(b) } catch (err) { reject(new Error(`câmara: ${err.message}`)) }
    })
  })
}

module.exports = { tirarFoto, nomeTemporario }
