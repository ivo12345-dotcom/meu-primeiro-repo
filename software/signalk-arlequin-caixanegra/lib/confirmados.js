'use strict'
// Ficheiros do bruto já copiados e verificados no portátil. O portátil deixa
// listas [{ ficheiro, sha256 }] em entrada/*.json (escreve .tmp e muda o nome
// no fim, para nunca se ler uma lista a meio). Aqui confere-se o hash de cada
// ficheiro no SSD: só os que batem certo ficam em confirmados.json, e só esses
// podem ser apagados quando o disco enche, e só se o hash ainda bater certo.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const sha256Ficheiro = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const ficheiroConf = (base) => path.join(base, 'confirmados.json')

// Sem ficheiro (ainda nada confirmado) → {}. Ilegível ou estragado → {} também
// (o portátil volta a confirmar e o ficheiro reescreve-se), mas avisa por
// `aoErro`, para o problema se ver no plugin em vez de passar calado.
function lerConfirmados (base, aoErro = () => {}) {
  let texto
  try { texto = fs.readFileSync(ficheiroConf(base), 'utf8') } catch (e) {
    if (e.code !== 'ENOENT') aoErro(new Error(`confirmados.json ilegível: ${e.message}`))
    return {}
  }
  try {
    const m = JSON.parse(texto)
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('não é um mapa')
    return m
  } catch (e) {
    aoErro(new Error(`confirmados.json estragado: ${e.message}`))
    return {}
  }
}
function gravarConfirmados (base, conf) {
  const tmp = ficheiroConf(base) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(conf, null, 1))
  fs.renameSync(tmp, ficheiroConf(base))
}

function processarEntrada (base, { aoErro } = {}) {
  const dir = path.join(base, 'entrada')
  const conf = lerConfirmados(base, aoErro)
  const r = { aceites: [], rejeitados: [] }
  let nomes = []
  try { nomes = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort() } catch { return r }
  for (const nome of nomes) {
    const f = path.join(dir, nome)
    let lista
    try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(lista)) throw new Error('não é lista') } catch {
      r.rejeitados.push({ ficheiro: nome, motivo: 'lista ilegível' })
      fs.renameSync(f, f + '.mau')
      continue
    }
    for (const { ficheiro, sha256 } of lista) {
      if (typeof ficheiro !== 'string' || !/^bruto\/[\w-][\w.-]*$/.test(ficheiro)) { r.rejeitados.push({ ficheiro: String(ficheiro), motivo: 'fora do bruto' }); continue }
      const alvo = path.join(base, ficheiro)
      if (!fs.existsSync(alvo)) { r.rejeitados.push({ ficheiro, motivo: 'não existe' }); continue }
      if (sha256Ficheiro(alvo) !== sha256) { r.rejeitados.push({ ficheiro, motivo: 'hash diferente' }); continue }
      conf[ficheiro] = sha256
      r.aceites.push(ficheiro)
    }
    fs.unlinkSync(f)
  }
  if (r.aceites.length) gravarConfirmados(base, conf)
  return r
}

function apagarConfirmados (base, ficheiros, { aoErro } = {}) {
  const conf = lerConfirmados(base, aoErro)
  const apagados = []
  for (const ficheiro of ficheiros) {
    const alvo = path.join(base, ficheiro)
    if (!conf[ficheiro] || !fs.existsSync(alvo)) continue
    if (sha256Ficheiro(alvo) !== conf[ficheiro]) continue // mudou depois de confirmado: fica
    fs.unlinkSync(alvo)
    delete conf[ficheiro]
    apagados.push(ficheiro)
  }
  if (apagados.length) gravarConfirmados(base, conf)
  return apagados
}

module.exports = { sha256Ficheiro, lerConfirmados, processarEntrada, apagarConfirmados }
