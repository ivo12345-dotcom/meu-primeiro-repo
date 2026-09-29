// Copia a caixa negra do Pi para o portátil e confirma ao Pi o que chegou bem.
// O transporte (ssh pelo Tailscale, ou uma pasta local para testes e pens) dá:
//   listar() → [{ ficheiro, bytes }]      copiar(ficheiros, destino)
//   hashes(ficheiros) → { ficheiro: sha256 }   escreverEntrada(nome, texto)
// Só se confirmam horas do bruto já fechadas: a hora atual ainda está a crescer.

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const horaDoBruto = (f) => f.match(/^bruto\/(\d{4}-\d{2}-\d{2}T\d{2})\.ndjson\.gz$/)?.[1]

export async function sincronizar ({ transporte, destino, agora = Date.now() }) {
  mkdirSync(destino, { recursive: true })
  const local = (f) => path.join(destino, ...f.split('/'))
  const remotos = await transporte.listar()
  const aCopiar = remotos.filter(r => !existsSync(local(r.ficheiro)) || statSync(local(r.ficheiro)).size !== r.bytes)
  if (aCopiar.length) await transporte.copiar(aCopiar.map(r => r.ficheiro), destino)

  const registo = path.join(destino, '.confirmados.json')
  let enviados = {}
  try { enviados = JSON.parse(readFileSync(registo, 'utf8')) } catch { enviados = {} }
  const horaAtual = new Date(agora).toISOString().slice(0, 13)
  const recopiados = new Set(aCopiar.map(r => r.ficheiro))
  // Não se volta a calcular o hash do que já foi confirmado (anos de bruto), só do novo ou recopiado.
  const candidatos = remotos
    .map(r => r.ficheiro)
    .filter(f => { const h = horaDoBruto(f); return h && h < horaAtual && existsSync(local(f)) && (!enviados[f] || recopiados.has(f)) })
  const remotosHash = candidatos.length ? await transporte.hashes(candidatos) : {}
  const confirmar = []
  const diferentes = []
  for (const f of candidatos) {
    const h = sha256(local(f))
    if (remotosHash[f] === h) confirmar.push({ ficheiro: f, sha256: h })
    else diferentes.push(f)
  }
  if (confirmar.length) {
    const nome = `confirmados-${new Date(agora).toISOString().replace(/[:.]/g, '-')}.json`
    await transporte.escreverEntrada(nome, JSON.stringify(confirmar))
    for (const c of confirmar) enviados[c.ficheiro] = c.sha256
    writeFileSync(registo, JSON.stringify(enviados, null, 1))
  }
  return { remotos: remotos.length, copiados: aCopiar.length, bytes: aCopiar.reduce((s, r) => s + r.bytes, 0), confirmados: confirmar.length, diferentes }
}
