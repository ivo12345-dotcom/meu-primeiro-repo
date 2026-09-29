// Copia a caixa negra do Pi para o portátil e confirma ao Pi o que chegou bem.
// O transporte (ssh pelo Tailscale, ou uma pasta local para testes e pens) dá:
//   listar() → [{ ficheiro, bytes }]      copiar(ficheiros, destino)
//   hashes(ficheiros) → { ficheiro: sha256 }   escreverEntrada(nome, texto)
//   lerConfirmados() → o confirmados.json do Pi    podeConfirmar (só o ssh)
// Só se confirmam horas do bruto já fechadas: a hora atual ainda está a crescer.
// O que conta como confirmado é o que o PRÓPRIO Pi já aceitou (o confirmados.json
// dele): se uma lista ficou por processar, na vez seguinte volta a mandar-se.
// Um bruto já confirmado, ou de uma hora fechada que o portátil já tem, só se
// sobrescreve se o do Pi for MAIOR (a cópia foi feita a meio da hora); se for
// mais pequeno, a cópia do portátil fica e o do Pi guarda-se ao lado como
// <nome>.1, .2… (`conflitos`), para nunca se perder a cópia boa.
// As confirmações vão em listas de até `bytesPorLista` (150 MB) do Pi: o Pi
// confere uma lista inteira de uma vez, e uma lista de semanas de bruto (GB)
// parava o SignalK nesse minuto. Um ficheiro maior do que isso vai sozinho.

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
// Só uma hora do bruto com o nome certo (um .danificado-* copia-se mas nunca se confirma).
const horaDoBruto = (f) => f.match(/^bruto\/(\d{4}-\d{2}-\d{2}T\d{2})\.ndjson\.gz$/)?.[1]

export async function sincronizar ({ transporte, destino, agora = Date.now(), bytesPorLista = 150e6 }) {
  mkdirSync(destino, { recursive: true })
  const local = (f) => path.join(destino, ...f.split('/'))
  const remotos = await transporte.listar()
  const confirmadosPi = transporte.podeConfirmar ? await transporte.lerConfirmados() : {}
  // O Pi pode só fechar o ficheiro da hora até 10 s depois de o relógio do portátil já ter
  // virado a hora; margem para não confirmar um bruto que ainda pode crescer.
  const horaAtual = new Date(agora - 10 * 60000).toISOString().slice(0, 13)
  const fechado = (f) => { const h = horaDoBruto(f); return !!h && h < horaAtual }
  const protegido = (f) => !!confirmadosPi[f] || fechado(f)

  const aCopiar = []
  const conflitos = []
  for (const r of remotos) {
    if (!existsSync(local(r.ficheiro))) { aCopiar.push(r); continue }
    const tam = statSync(local(r.ficheiro)).size
    if (tam === r.bytes) continue
    if (protegido(r.ficheiro) && r.bytes < tam) conflitos.push(r)
    else aCopiar.push(r)
  }
  if (aCopiar.length) await transporte.copiar(aCopiar.map(r => r.ficheiro), destino)
  const guardados = await guardarConflitos(transporte, destino, local, conflitos)

  const emConflito = new Set(conflitos.map(r => r.ficheiro))
  const recopiados = new Set(aCopiar.map(r => r.ficheiro))
  // Não se volta a calcular o hash do que o Pi já confirmou (anos de bruto), só do novo ou recopiado.
  // Pela pen não se confirma nada: a lista ficava na pen e nunca chegava ao Pi.
  const candidatos = !transporte.podeConfirmar ? [] : remotos
    .map(r => r.ficheiro)
    .filter(f => fechado(f) && !emConflito.has(f) && existsSync(local(f)) && (!confirmadosPi[f] || recopiados.has(f)))
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
  const bytesDe = (f) => remotos.find(r => r.ficheiro === f)?.bytes ?? 0
  const ts = new Date(agora).toISOString().replace(/[:.]/g, '-')
  for (const [i, lista] of partir(confirmar, (c) => bytesDe(c.ficheiro), bytesPorLista).entries()) {
    await transporte.escreverEntrada(`confirmados-${ts}-${i + 1}.json`, JSON.stringify(lista))
  }
  return {
    remotos: remotos.length,
    copiados: aCopiar.length + reparados.length,
    bytes: aCopiar.reduce((s, r) => s + r.bytes, 0) + reparados.reduce((s, f) => s + bytesDe(f), 0),
    confirmados: confirmar.length,
    semConfirmar: !transporte.podeConfirmar,
    diferentes,
    conflitos: guardados
  }
}

// Parte a lista em grupos seguidos de até `limite` bytes; um elemento maior do
// que o limite fica num grupo só dele.
function partir (itens, bytes, limite) {
  const grupos = []
  let atual = []
  let soma = 0
  for (const x of itens) {
    const b = bytes(x)
    if (atual.length && soma + b > limite) { grupos.push(atual); atual = []; soma = 0 }
    atual.push(x)
    soma += b
  }
  if (atual.length) grupos.push(atual)
  return grupos
}

// Guarda o ficheiro do Pi ao lado da cópia do portátil (<nome>.N, o primeiro N
// livre), copiando-o primeiro para uma pasta temporária. Se já houver um <nome>.N
// com o mesmo tamanho, já foi guardado numa vez anterior: não se repete.
async function guardarConflitos (transporte, destino, local, conflitos) {
  const jaGuardado = (r) => {
    for (let n = 1; existsSync(`${local(r.ficheiro)}.${n}`); n++) {
      if (statSync(`${local(r.ficheiro)}.${n}`).size === r.bytes) return true
    }
    return false
  }
  const novos = conflitos.filter(r => !jaGuardado(r))
  if (!novos.length) return []
  const tmp = mkdtempSync(path.join(destino, '.conflitos-'))
  try {
    await transporte.copiar(novos.map(r => r.ficheiro), tmp)
    return novos.map(r => {
      let n = 1
      while (existsSync(`${local(r.ficheiro)}.${n}`)) n++
      renameSync(path.join(tmp, ...r.ficheiro.split('/')), `${local(r.ficheiro)}.${n}`)
      return { ficheiro: r.ficheiro, guardadoComo: `${r.ficheiro}.${n}` }
    })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
