'use strict'
// As contas da escuta do vento (ensaio/ouvir-vento.js). A caixa 1 guarda as últimas 80 letras que entraram
// pelo pino do vento, tal e qual chegaram, e o comando "cru" devolve-as em hexadecimal, com o total de
// letras entradas desde o arranque: "total=<n>;hex=<...>". Aqui juntam-se essas respostas numa fita só,
// parte-se a fita em linhas, diz-se o que é cada linha e dá-se o veredicto em português corrente.
//
// Serve no barco, na primeira escuta do mostrador verdadeiro: a caixa só deixa passar a frase MWV com a
// soma certa, e sem isto não se via o que o mostrador manda quando não é isso.

const ANEL = 80 // as letras que a caixa guarda (VENTO_CRU, em caixa1/vento.h)
const RESPOSTA = /^total=(\d{1,10});hex=((?:[0-9A-Fa-f]{2})*)$/

// "total=5;hex=2441420D0A" -> { total, bytes }, ou null se não for uma resposta do comando cru.
function lerResposta (texto) {
  const m = typeof texto === 'string' ? RESPOSTA.exec(texto) : null
  if (!m) return null
  const total = Number(m[1])
  if (total > 0xFFFFFFFF) return null
  return { total, bytes: Buffer.from(m[2], 'hex') }
}

// Junta uma resposta à fita. A primeira (fita null) só marca o ponto de partida: o que a caixa já tinha
// guardado entrou antes de se começar a ouvir. Daí em diante acrescentam-se só as letras novas; as que
// o anel já não tinha contam-se em "perdidas". Se o total voltar atrás, a caixa recomeçou.
function juntar (fita, texto) {
  const r = lerResposta(texto)
  if (!r) throw new Error(`a caixa não respondeu ao comando cru como se esperava: "${texto}"`)
  if (!fita) return { total: r.total, bytes: Buffer.alloc(0), perdidas: 0, recomecos: 0 }
  let novas = (r.total - fita.total) >>> 0 // a conta dá a volta aos 2^32 com o total da caixa
  let recomecos = fita.recomecos
  if (novas > 0x7FFFFFFF) { // o total voltou atrás: a caixa recomeçou, e tudo o que tem é novo
    recomecos++
    novas = r.total
  }
  const aproveitadas = Math.min(novas, r.bytes.length)
  return {
    total: r.total,
    bytes: Buffer.concat([fita.bytes, r.bytes.subarray(r.bytes.length - aproveitadas)]),
    perdidas: fita.perdidas + (novas - aproveitadas),
    recomecos
  }
}

// Parte as letras em linhas inteiras (acabadas em CR ou LF). -> { linhas, resto }: o resto é o que ainda
// vai a meio.
function emLinhas (bytes) {
  const linhas = []
  let inicio = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 13 && bytes[i] !== 10) continue
    if (i > inicio) linhas.push(bytes.subarray(inicio, i).toString('latin1'))
    inicio = i + 1
  }
  return { linhas, resto: bytes.subarray(inicio) }
}

const soma = (corpo) => [...corpo].reduce((a, c) => a ^ c.charCodeAt(0), 0)
const FRASE = /^\$([A-Z]{2})([A-Z]{3}),([\x20-\x29\x2B-\x7E]*)(?:\*([0-9A-Fa-f]{2}))?$/ // sem "*" no corpo

// O que é uma linha: "mwv-boa" (a que a caixa deixa passar), "mwv-soma-errada", "mwv-sem-soma",
// "outra-boa" (uma frase certa de outro tipo), "outra-sem-soma", ou "lixo".
function classificar (linha) {
  const m = FRASE.exec(linha)
  if (!m) return { classe: 'lixo' }
  const [, , tipo, campos, hh] = m
  const certa = hh !== undefined && soma(linha.slice(1, linha.lastIndexOf('*'))) === parseInt(hh, 16)
  if (tipo !== 'MWV') {
    if (hh === undefined) return { classe: 'outra-sem-soma', tipo }
    return certa ? { classe: 'outra-boa', tipo } : { classe: 'lixo' }
  }
  if (hh === undefined) return { classe: 'mwv-sem-soma', tipo }
  if (!certa) return { classe: 'mwv-soma-errada', tipo }
  const [angulo, referencia, velocidade, unidade, valida] = campos.split(',')
  return { classe: 'mwv-boa', tipo, angulo: Number(angulo), velocidade: Number(velocidade), referencia, unidade, valida }
}

const UNIDADES = { N: 'nós', M: 'm/s', K: 'km/h' }
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// O veredicto da escuta. contadores: o que os contadores da caixa andaram durante a escuta
// (vento-mexidas, vento-bytes, vento-frases, vento-invalidas). linhas: as linhas inteiras da fita.
// As frases boas contam-se pela caixa (é ela que as deixa passar); as linhas explicam o resto.
function veredicto ({ segundos, linhas, contadores, perdidas = 0 }) {
  const mexidas = contadores['vento-mexidas']
  const bytes = contadores['vento-bytes']
  const boas = contadores['vento-frases']
  const invalidas = contadores['vento-invalidas']
  const classes = linhas.map(classificar)
  const quantas = (classe) => classes.filter(c => c.classe === classe).length
  const ultima = classes.filter(c => c.classe === 'mwv-boa').at(-1)
  const outras = [...new Set(classes.filter(c => c.classe === 'outra-boa' || c.classe === 'outra-sem-soma').map(c => c.tipo))]
  const nota = perdidas > 0 ? ` (a escuta perdeu ${perdidas} letras pelo caminho: o que falta nas linhas mostradas é disso)` : ''

  if (mexidas === 0) {
    return { passa: false, texto: 'O fio do vento está parado: não chega sinal nenhum à caixa. A ver: o mostrador ligado; o amarelo e o verde da ficha trocados; os fios azul e branco da plaquinha; os 3,3 V da plaquinha.' }
  }
  if (bytes === 0) {
    return { passa: false, texto: `O fio do vento mexe (${mexidas} mudanças em ${segundos} s) mas não se formou nenhuma letra: o sinal chega fraco ou em impulsos curtos de mais. A ver: a resistência de entrada da plaquinha e as soldas do optoacoplador.` }
  }
  if (boas > 0 && invalidas === 0) {
    const leitura = ultima ? ` A última: ${ultima.angulo}° e ${ultima.velocidade} ${UNIDADES[ultima.unidade] || ultima.unidade}.` : ''
    const mais = outras.length ? ` O mostrador manda também frases de outro tipo (${outras.join(', ')}), que a caixa ignora.` : ''
    return { passa: true, texto: `Chegam ${plural(boas, 'frase de vento boa', 'frases de vento boas')} em ${segundos} s, nenhuma estragada.${leitura}${mais}${nota}` }
  }
  if (boas > 0) {
    return { passa: false, texto: `Chegam frases de vento, mas nem todas inteiras: ${boas} boas e ${invalidas} estragadas em ${segundos} s. O sinal está no limite: mexer na resistência de entrada da plaquinha (mais ohms se o mostrador mandar 12 V).${nota}` }
  }
  if (quantas('mwv-sem-soma') > 0) {
    return { passa: false, texto: `O mostrador manda a frase do vento sem a soma no fim (${quantas('mwv-sem-soma')} em ${segundos} s). A caixa só aceita frases com soma: muda-se o programa da caixa para aceitar estas.${nota}` }
  }
  if (quantas('mwv-soma-errada') > 0) {
    return { passa: false, texto: `Chegam frases de vento, mas estragadas pelo caminho (${quantas('mwv-soma-errada')} com a soma errada em ${segundos} s). A ver: a resistência de entrada da plaquinha e os fios do mostrador.${nota}` }
  }
  if (outras.length > 0) {
    return { passa: false, texto: `O mostrador manda frases inteiras, mas de outro tipo (${outras.join(', ')}), e nenhuma MWV. Muda-se o programa da caixa para ler essas.${nota}` }
  }
  return { passa: false, texto: `Entram letras (${bytes} em ${segundos} s) mas não são texto: a velocidade ou o sentido do sinal não são os que a caixa espera (4800 por segundo, repouso em baixo do lado do mostrador).${nota}` }
}

module.exports = { ANEL, lerResposta, juntar, emLinhas, classificar, veredicto }
