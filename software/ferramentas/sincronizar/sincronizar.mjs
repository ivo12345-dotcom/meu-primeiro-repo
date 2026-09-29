// Copia a caixa negra do Arlequin para o portátil (pelo Tailscale) e confirma
// ao Pi o que chegou bem, para ele poder libertar espaço quando o disco encher.
//   node sincronizar.mjs                          → ssh pi@arlequin → Documents\Veleiro\arlequin-dados
//   node sincronizar.mjs --host ivo@arlequin --destino D:\arlequin-dados
//   node sincronizar.mjs --origem E:\arlequin-dados   (pasta local, ex.: uma pen)

import os from 'node:os'
import path from 'node:path'
import { sincronizar } from './lib.mjs'
import { transporteSsh, transporteLocal } from './transportes.mjs'

const arg = (nome, omissao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : omissao }
const destino = arg('destino', path.join(os.homedir(), 'Documents', 'Veleiro', 'arlequin-dados'))
const transporte = arg('origem') ? transporteLocal(arg('origem')) : transporteSsh(arg('host', 'pi@arlequin'))
const inicio = Date.now()
try {
  const r = await sincronizar({ transporte, destino })
  console.log(`Ficheiros no barco: ${r.remotos} · copiados agora: ${r.copiados} (${(r.bytes / 1e6).toFixed(1)} MB) · confirmados ao Pi: ${r.confirmados}`)
  if (r.diferentes.length) console.log(`ATENÇÃO: ${r.diferentes.length} ficheiro(s) com hash diferente, não confirmados: ${r.diferentes.join(', ')}`)
  console.log(`Em ${destino} · ${Math.round((Date.now() - inicio) / 1000)} s`)
} catch (e) {
  console.error(`Falhou: ${e.message}`)
  process.exit(1)
}
