'use strict'
// A fotografia do interior (lib/foto.js): cada pedido escreve num ficheiro temporário só seu. Antes o nome
// era só "arlequin-foto-<ms>.jpg": dois pedidos no mesmo milissegundo (com os testes em paralelo, vários
// processos) davam "ENOENT" — um lia e apagava a fotografia do outro — e o Ivo recebia "a câmara falhou".
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tirarFoto, nomeTemporario } = require('../lib/foto')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
// uma câmara falsa: escreve o JPEG no ficheiro pedido logo que a chamam e só avisa que acabou no ciclo seguinte
// (os dois pedidos já escreveram quando o primeiro vai ler)
const camaraFalsa = (falhar = null) => (comando, opcoes, aoAcabar) => {
  const ficheiro = comando.replace(/^camara /, '')
  fs.writeFileSync(ficheiro, JPEG)
  setImmediate(() => aoAcabar(falhar))
}

test('cada fotografia tem o seu ficheiro temporário: dois pedidos no mesmo milissegundo não se pisam', async () => {
  const agora = Date.now
  Date.now = () => 1790000000000
  try {
    const a = nomeTemporario()
    const b = nomeTemporario()
    assert.notEqual(a, b)
    assert.ok(a.includes(`${process.pid}`) && a.endsWith('.jpg'), a)
    // dois pedidos ao mesmo tempo, com a hora parada: as duas fotografias chegam
    const [x, y] = await Promise.all([tirarFoto('camara {ficheiro}', { exec: camaraFalsa() }), tirarFoto('camara {ficheiro}', { exec: camaraFalsa() })])
    assert.deepEqual(x, JPEG)
    assert.deepEqual(y, JPEG)
  } finally { Date.now = agora }
})

test('sem comando da câmara: "sem câmara configurada" (semCamara); um comando que falha: "câmara: …"', async () => {
  await assert.rejects(tirarFoto(''), (e) => e.semCamara === true && e.message === 'sem câmara configurada')
  await assert.rejects(tirarFoto('camara {ficheiro}', { exec: camaraFalsa(new Error('Command failed: rpicam-still')) }), (e) => !e.semCamara && e.message === 'câmara: Command failed: rpicam-still')
})
