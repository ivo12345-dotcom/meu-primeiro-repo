// Copia a caixa negra do Pi para o portátil e confirma ao Pi o que chegou bem.
// O transporte (ssh pelo Tailscale, ou uma pasta local para testes e pens) dá:
//   listar() → [{ ficheiro, bytes }]      copiar(ficheiros, destino)
//   hashes(ficheiros) → { ficheiro: sha256 }   escreverEntrada(nome, texto)
//   lerConfirmados() → o confirmados.json do Pi    podeConfirmar (só o ssh)
// Só se confirmam horas do bruto já fechadas: a hora atual ainda está a crescer.
// O que conta como confirmado é o que o PRÓPRIO Pi já aceitou (o confirmados.json
// dele): se uma lista ficou por processar, na vez seguinte volta a mandar-se.

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const horaDoBruto = (f) => f.match(/^bruto\/(\d{4}-\d{2}-\d{2}T\d{2})\.ndjson\.gz$/)?.[1]

export async function sincronizar ({ transporte, destino, agora = Date.now() }) {
  mkdirSync(destino, { recursive: true })
  const local = (f) => path.join(destino, ...f.split('/'))
  const remotos = await transporte.listar()
  const confirmadosPi = transporte.podeConfirmar ? await transporte.lerConfirmados() : {}
  const aCopiar = remotos.filter(r => !existsSync(local(r.ficheiro)) || statSync(local(r.ficheiro)).size !== r.bytes)
  if (aCopiar.length) await transporte.copiar(aCopiar.map(r => r.ficheiro), destino)

  // O Pi pode só fechar o ficheiro da hora até 10 s depois de o relógio do portátil já ter
  // virado a hora; margem para não confirmar um bruto que ainda pode crescer.
  const horaAtual = new Date(agora - 10 * 60000).toISOString().slice(0, 13)
  const recopiados = new Set(aCopiar.map(r => r.ficheiro))
  // Não se volta a calcular o hash do que o Pi já confirmou (anos de bruto), só do novo ou recopiado.
  // Pela pen não se confirma nada: a lista ficava na pen e nunca chegava ao Pi.
  const candidatos = !transporte.podeConfirmar ? [] : remotos
    .map(r => r.ficheiro)
    .filter(f => { const h = horaDoBruto(f); return h && h < horaAtual && existsSync(local(f)) && (!confirmadosPi[f] || recopiados.has(f)) })
  const remotosHash = candidatos.length ? await transporte.hashes(candidatos) : {}
  // Única verificação: só se confirma quando o sha256 local bate certo com o do Pi.
  const verificar = (ficheiros) => {
    const ok = []
    const mal = []
    for (const f of ficheiros) {
      const h = sha256(local(f))
      if (remotosHash[f] === h) ok.push({ ficheiro: f, sha256: h })
      else mal.push(f)
    }
    return { ok, mal }
  }
  const primeira = verificar(candidatos)
  const confirmar = primeira.ok
  let diferentes = primeira.mal
  let reparados = []
  if (diferentes.length) {
    // Mesmo tamanho mas conteúdo diferente: a cópia local está corrompida. Recopia-se uma vez
    // e confirma-se as que passarem a bater certo; só ficam em `diferentes` as que persistirem.
    reparados = diferentes
    await transporte.copiar(diferentes, destino)
    const segunda = verificar(diferentes)
    confirmar.push(...segunda.ok)
    diferentes = segunda.mal
  }
  if (confirmar.length) {
    const nome = `confirmados-${new Date(agora).toISOString().replace(/[:.]/g, '-')}.json`
    await transporte.escreverEntrada(nome, JSON.stringify(confirmar))
  }
  const bytesDe = (f) => remotos.find(r => r.ficheiro === f)?.bytes ?? 0
  return {
    remotos: remotos.length,
    copiados: aCopiar.length + reparados.length,
    bytes: aCopiar.reduce((s, r) => s + r.bytes, 0) + reparados.reduce((s, f) => s + bytesDe(f), 0),
    confirmados: confirmar.length,
    semConfirmar: !transporte.podeConfirmar,
    diferentes
  }
}
