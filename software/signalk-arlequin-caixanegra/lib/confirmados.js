'use strict'
// Ficheiros do bruto já copiados e verificados no portátil. O portátil deixa
// listas [{ ficheiro, sha256 }] em entrada/*.json (escreve .tmp e muda o nome
// no fim, para nunca se ler uma lista a meio). Aqui confere-se o hash de cada
// ficheiro no SSD: só os que batem certo ficam em confirmados.json, e só esses
// podem ser apagados quando o disco enche, e só se o hash ainda bater certo.
// Calcular sha256 bloqueia o SignalK: por minuto só se lê até `orcamentoBytes`
// (200 MB); o que não couber fica para o minuto seguinte.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const sha256Ficheiro = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const ficheiroConf = (base) => path.join(base, 'confirmados.json')
const ORCAMENTO_BYTES = 200e6
// Só horas fechadas do bruto (nunca um .danificado-*, nem nada fora do bruto).
const NOME_BRUTO = /^bruto\/\d{4}-\d{2}-\d{2}T\d{2}\.ndjson\.gz$/
const valido = (x) => !!x && typeof x === 'object' && typeof x.ficheiro === 'string' && NOME_BRUTO.test(x.ficheiro)
// Bytes que é preciso ler para conferir o hash desta entrada (0 se não há nada a ler).
function custo (base, x) {
  if (!valido(x)) return 0
  try { return fs.statSync(path.join(base, x.ficheiro)).size } catch { return 0 }
}

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

// Uma lista confere-se inteira ou fica toda para o minuto seguinte; uma lista
// maior do que o orçamento confere-se sozinha (senão nunca passava).
function processarEntrada (base, { orcamentoBytes = ORCAMENTO_BYTES, aoErro } = {}) {
  const dir = path.join(base, 'entrada')
  const conf = lerConfirmados(base, aoErro)
  const r = { aceites: [], rejeitados: [], adiadas: 0 }
  let nomes = []
  try { nomes = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort() } catch { return r }
  let gastos = 0
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i]
    const f = path.join(dir, nome)
    let lista
    try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(lista)) throw new Error('não é lista') } catch {
      r.rejeitados.push({ ficheiro: nome, motivo: 'lista ilegível' })
      fs.renameSync(f, f + '.mau')
      continue
    }
    const bytes = lista.reduce((s, x) => s + custo(base, x), 0)
    if (gastos > 0 && gastos + bytes > orcamentoBytes) { r.adiadas = nomes.length - i; break }
    gastos += bytes
    for (const item of lista) {
      // Um elemento que não é objeto (null, número…) não pode travar a lista para sempre.
      if (!item || typeof item !== 'object') { r.rejeitados.push({ ficheiro: String(item), motivo: 'entrada inválida' }); continue }
      const { ficheiro, sha256 } = item
      if (typeof ficheiro !== 'string' || !NOME_BRUTO.test(ficheiro)) { r.rejeitados.push({ ficheiro: String(ficheiro), motivo: 'fora do bruto' }); continue }
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

// Devolve { apagados, mudados }: `mudados` são confirmados cujo sha256 já não
// bate certo (mudaram depois de confirmados). Esses nunca se apagam; quem chama
// não os pode contar como espaço a libertar.
function apagarConfirmados (base, ficheiros, { orcamentoBytes = ORCAMENTO_BYTES, aoErro } = {}) {
  const conf = lerConfirmados(base, aoErro)
  const apagados = []
  const mudados = []
  let gastos = 0
  for (const ficheiro of ficheiros) {
    const alvo = path.join(base, ficheiro)
    if (!conf[ficheiro] || !fs.existsSync(alvo)) continue
    const bytes = fs.statSync(alvo).size
    if (gastos > 0 && gastos + bytes > orcamentoBytes) break // o resto fica para o minuto seguinte
    gastos += bytes
    if (sha256Ficheiro(alvo) !== conf[ficheiro]) { mudados.push(ficheiro); continue } // mudou depois de confirmado: fica
    fs.unlinkSync(alvo)
    delete conf[ficheiro]
    apagados.push(ficheiro)
  }
  if (apagados.length) gravarConfirmados(base, conf)
  return { apagados, mudados }
}

module.exports = { sha256Ficheiro, lerConfirmados, processarEntrada, apagarConfirmados }
