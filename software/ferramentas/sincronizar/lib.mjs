// Copia a caixa negra do Pi para o portátil e confirma ao Pi o que chegou bem.
// O transporte (ssh pelo Tailscale, ou uma pasta local para testes e pens) dá:
//   listar() → [{ ficheiro, bytes }]      copiar(ficheiros, destino)
//   hashes(ficheiros) → { ficheiro: sha256 }   escreverEntrada(nome, texto)
//   lerConfirmados() → o confirmados.json do Pi    podeConfirmar (só o ssh)
// Só se confirmam horas do bruto já fechadas: a hora atual ainda está a crescer.
// O que conta como confirmado é o que o PRÓPRIO Pi já aceitou (o confirmados.json
// dele): se uma lista ficou por processar, na vez seguinte volta a mandar-se.
// Um bruto já confirmado, ou de uma hora fechada que o portátil já tem, e
// qualquer ficheiro da tabela/, só se sobrescreve se o do Pi for MAIOR (a cópia
// foi feita a meio da hora ou do dia); se for mais pequeno, a cópia do portátil
// fica e o do Pi guarda-se ao lado como <nome>.1, .2… (`conflitos`), para nunca
// se perder a cópia boa. Na tabela acontece quando o Pi isola o ficheiro do dia
// danificado (corte de energia) e recomeça um novo, mais pequeno.
// As confirmações vão em listas de até `bytesPorLista` (150 MB) do Pi: o Pi
// confere uma lista inteira de uma vez, e uma lista de semanas de bruto (GB)
// parava o SignalK nesse minuto. Um ficheiro maior do que isso vai sozinho.
// Só se copia do Pi para o portátil (e as confirmações para a entrada/ do Pi): o que
// só existe no portátil (os modelos pNNNN treinados lá e o registo-portatil.json,
// decisão n.º 26) nunca se apaga nem se sobrescreve, e nunca vai para o Pi sozinho
// (só por cópia confirmada, à mão).

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
// Só uma hora do bruto com o nome certo (um .danificado-* copia-se mas nunca se confirma).
const horaDoBruto = (f) => f.match(/^bruto\/(\d{4}-\d{2}-\d{2}T\d{2})\.ndjson\.gz$/)?.[1]
// O ficheiro que diz qual é a versão em uso de cada modelo no barco.
const ATUAL = /^modelos\/[^/]+\/atual$/

export async function sincronizar ({ transporte, destino, agora = Date.now(), bytesPorLista = 150e6 }) {
  mkdirSync(destino, { recursive: true })
  const local = (f) => path.join(destino, ...f.split('/'))
  const remotos = await transporte.listar()
  const confirmadosPi = transporte.podeConfirmar ? await transporte.lerConfirmados() : {}
  // O Pi pode só fechar o ficheiro da hora até 10 s depois de o relógio do portátil já ter
  // virado a hora; margem para não confirmar um bruto que ainda pode crescer.
  const horaAtual = new Date(agora - 10 * 60000).toISOString().slice(0, 13)
  const fechado = (f) => { const h = horaDoBruto(f); return !!h && h < horaAtual }
  const protegido = (f) => !!confirmadosPi[f] || fechado(f) || f.startsWith('tabela/')

  const aCopiar = []
  const conflitos = []
  const aConferir = []
  for (const r of remotos) {
    if (!existsSync(local(r.ficheiro))) { aCopiar.push(r); continue }
    const tam = statSync(local(r.ficheiro)).size
    if (tam === r.bytes) { if (ATUAL.test(r.ficheiro)) aConferir.push(r); continue }
    if (protegido(r.ficheiro) && r.bytes < tam) conflitos.push(r)
    else aCopiar.push(r)
  }
  // O `atual` de cada modelo ("vNNNN") muda de conteúdo sem mudar de tamanho: com o mesmo tamanho
  // confere-se pelo sha256 (são 5 bytes). Senão o portátil ficava a julgar que o barco usa uma
  // versão que já não usa, e o treino do portátil comparava-se com o modelo errado (decisão n.º 26).
  if (aConferir.length) {
    const h = await transporte.hashes(aConferir.map(r => r.ficheiro))
    for (const r of aConferir) if (h[r.ficheiro] !== sha256(local(r.ficheiro))) aCopiar.push(r)
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
  // Uma hora fechada do bruto em conflito (o Pi recomeçou-a depois de um corte de energia e ficou
  // mais pequena do que a cópia do portátil): a do Pi está guardada ao lado (<nome>.N). Se essa
  // cópia tem o sha256 do ficheiro do Pi, confirma-se com ele: o portátil tem-na inteira e o Pi
  // pode libertá-la quando o disco encher (senão ficava lá para sempre). Já confirmada com o
  // mesmo hash, não se repete.
  const guardadosAConfirmar = !transporte.podeConfirmar ? [] : conflitos
    .filter(r => fechado(r.ficheiro))
    .map(r => ({ ficheiro: r.ficheiro, copia: copiaGuardada(local, r) }))
    .filter(x => x.copia)
    .map(x => ({ ficheiro: x.ficheiro, sha256: sha256(x.copia) }))
    .filter(x => confirmadosPi[x.ficheiro] !== x.sha256)
  const pedirHash = [...candidatos, ...guardadosAConfirmar.map(x => x.ficheiro)]
  const remotosHash = pedirHash.length ? await transporte.hashes(pedirHash) : {}
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
  for (const x of guardadosAConfirmar) {
    if (remotosHash[x.ficheiro] === x.sha256) confirmar.push(x)
    else diferentes.push(x.ficheiro) // a cópia guardada não é a do Pi: nunca se confirma
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

// A cópia de um ficheiro do Pi já guardada ao lado da do portátil (<nome>.N com o tamanho
// do do Pi), ou null.
function copiaGuardada (local, r) {
  for (let n = 1; existsSync(`${local(r.ficheiro)}.${n}`); n++) {
    if (statSync(`${local(r.ficheiro)}.${n}`).size === r.bytes) return `${local(r.ficheiro)}.${n}`
  }
  return null
}

// Guarda o ficheiro do Pi ao lado da cópia do portátil (<nome>.N, o primeiro N
// livre), copiando-o primeiro para uma pasta temporária. Se já houver um <nome>.N
// com o mesmo tamanho, já foi guardado numa vez anterior: não se repete.
async function guardarConflitos (transporte, destino, local, conflitos) {
  const novos = conflitos.filter(r => !copiaGuardada(local, r))
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

// Pôr no barco um modelo treinado no portátil: os pNNNN só vão para o Pi por cópia confirmada
// (decisão n.º 26). `modelo` é "<nome>/<pNNNN>" (ex.: velocidade/p0001), o ficheiro
// <destino>/modelos/<nome>/<pNNNN>.json.gz; `confirmar(resumo)` mostra o resumo e devolve true só
// com o sim do Ivo. O transporte copia-o para o Pi e aponta lá o `atual` para ele (no ecrã fica o
// "Voltar atrás" para a última versão do barco). Nunca uma vNNNN (essas são do barco) nem pela pen.
// Não acrescenta ao registo.json do barco: o ficheiro do modelo diz quando e com que erro se treinou.
const MODELOS = ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']
const virgula = (x) => String(x).replace('.', ',')
const quando = (iso) => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }) : '?'

export async function porNoBarco ({ transporte, destino, modelo, confirmar }) {
  const m = /^([A-Za-z]+)\/(p\d{4})$/.exec(modelo ?? '')
  if (!m || !MODELOS.includes(m[1])) throw new Error(`indica um modelo do portátil assim: velocidade/p0001 (${MODELOS.join(', ')}; só pNNNN)`)
  const [, nome, versao] = m
  if (!transporte.podeConfirmar || typeof transporte.porModelo !== 'function') throw new Error('só pelo ssh (Tailscale): pela pen não se põe nada no barco')
  const f = path.join(destino, 'modelos', nome, `${versao}.json.gz`)
  let bytes
  try { bytes = readFileSync(f) } catch (e) { throw new Error(`não há ${nome}/${versao} no portátil (${f}: ${e.code})`) }
  let dados
  try { dados = JSON.parse(gunzipSync(bytes).toString('utf8')) } catch (e) { throw new Error(`${nome}/${versao} ilegível: ${e.message}`) }
  if (dados?.modelo !== nome || dados?.versao !== versao || !dados?.quantis) throw new Error(`${f} não é o modelo ${nome} ${versao} completo`)
  const emUso = dados.maeAtual != null ? `o modelo em uso no barco: ${virgula(dados.maeAtual)}; ` : ''
  const resumo = `${nome} ${versao}, treinado no portátil a ${quando(dados.criado)} com ${virgula(dados.horas)} h de dados: erro ${virgula(dados.mae)} (${emUso}a origem: ${virgula(dados.maeBase)})`
  if (!(await confirmar(resumo))) return { feito: false, resumo }
  await transporte.porModelo(nome, versao, bytes)
  return { feito: true, resumo }
}
