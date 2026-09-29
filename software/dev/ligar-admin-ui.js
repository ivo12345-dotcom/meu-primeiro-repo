'use strict'
// O signalk-server procura a página de administração em
// node_modules/signalk-server/node_modules/@signalk/server-admin-ui, mas numa
// instalação local o npm põe-na um nível acima. Cria a ligação que falta.
// (No Pi, com o OpenPlotter, isto não é preciso.)
const fs = require('node:fs')
const path = require('node:path')

const alvo = path.join(__dirname, 'node_modules', '@signalk', 'server-admin-ui')
const ligacao = path.join(__dirname, 'node_modules', 'signalk-server', 'node_modules', '@signalk', 'server-admin-ui')

if (!fs.existsSync(alvo)) {
  console.error('server-admin-ui não encontrado em', alvo)
  process.exit(1)
}
if (fs.existsSync(path.join(ligacao, 'public', 'index.html'))) {
  console.log('admin UI já está no sítio')
  process.exit(0)
}
fs.mkdirSync(path.dirname(ligacao), { recursive: true })
fs.symlinkSync(alvo, ligacao, 'junction')
console.log('admin UI ligada:', ligacao)
