#!/usr/bin/env node
'use strict'
// Põe a configuração do SignalK de bordo num de dois modos, antes de o servidor arrancar:
//
//   bordo    o barco a sério: a caixa 1 pelo cabo USB, o B330 se já tiver a porta escrita, e os dados
//            em ~/arlequin-dados (a pasta que conta: polar, consumos, o que a AI aprende).
//   ensaio   em casa, com a caixa a fingir (ferramentas/caixa-a-fingir): a caixa e o GPS por TCP, tudo
//            marcado como simulado, e os dados numa pasta à parte (arlequin-dados-ensaio), para um
//            ensaio nunca se misturar com as viagens verdadeiras.
//
// Muda só estas cinco coisas e guarda o resto como estiver (as calibrações acertadas no barco):
//
//                                        bordo                                   ensaio
//   caixas: porta                        fica; se for tcp://…, passa a "auto"    "tcp://localhost:8765"
//   caixas: ensaio                       false                                   true
//   caixa negra, AI e rota: pasta        "~/arlequin-dados"                      "arlequin-dados-ensaio"
//   GPS a fingir (b330-a-fingir)         desligado                               ligado
//   B330 verdadeiro (b330)               ligado se tiver a porta escrita         desligado
//
//   node preparar.js bordo|ensaio

const fs = require('node:fs')
const path = require('node:path')

const DADOS = { bordo: '~/arlequin-dados', ensaio: 'arlequin-dados-ensaio' }
const PORTA_ENSAIO = 'tcp://localhost:8765'
const COM_DADOS = ['signalk-arlequin-caixanegra', 'signalk-arlequin-ia', 'signalk-arlequin-rota']
const escrito = (json) => JSON.stringify(json, null, 2) + '\n'

// → a lista do que mudou (frases para mostrar). Lê tudo antes de escrever: se faltar um ficheiro, ou um
// não se perceber, dá erro sem ter mexido em nenhum.
function preparar (modo, pasta) {
  if (modo !== 'bordo' && modo !== 'ensaio') throw new Error(`modo desconhecido: ${JSON.stringify(modo)} (é "bordo" ou "ensaio")`)
  const ensaio = modo === 'ensaio'

  const abertos = new Map() // nome → { json, mexido }
  const abrir = (nome) => {
    try {
      abertos.set(nome, { json: JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8')), mexido: false })
    } catch (erro) {
      throw new Error(`não consigo ler ${nome}: ${erro.message}`)
    }
    return abertos.get(nome).json
  }
  const deUmPlugin = (id) => {
    const nome = `plugin-config-data/${id}.json`
    const json = abrir(nome)
    if (!json.configuration || typeof json.configuration !== 'object') throw new Error(`não consigo ler ${nome}: falta a "configuration"`)
    return { nome, c: json.configuration }
  }

  const caixas = deUmPlugin('signalk-arlequin-caixas')
  const comDados = COM_DADOS.map(deUmPlugin)
  const definicoes = abrir('settings.json')
  const fornecedor = (id) => {
    const f = (definicoes.pipedProviders || []).find(p => p.id === id)
    if (!f) throw new Error(`não consigo ler settings.json: falta a entrada "${id}" em pipedProviders`)
    return f
  }
  const b330 = fornecedor('b330')
  const gpsAFingir = fornecedor('b330-a-fingir')

  const mudou = []
  const por = (nome, objeto, chave, valor, oQue) => {
    if (objeto[chave] === valor) return
    mudou.push(`${oQue}: ${JSON.stringify(objeto[chave])} → ${JSON.stringify(valor)}`)
    objeto[chave] = valor
    abertos.get(nome).mexido = true
  }

  const portaDeBordo = /^tcp:/i.test(String(caixas.c.porta ?? '')) || !caixas.c.porta ? 'auto' : caixas.c.porta
  por(caixas.nome, caixas.c, 'porta', ensaio ? PORTA_ENSAIO : portaDeBordo, 'caixas, porta')
  por(caixas.nome, caixas.c, 'ensaio', ensaio, 'caixas, tudo marcado como simulado')
  for (const p of comDados) por(p.nome, p.c, 'pasta', DADOS[modo], `${path.basename(p.nome, '.json').replace('signalk-arlequin-', '')}, pasta dos dados`)
  por('settings.json', gpsAFingir, 'enabled', ensaio, 'GPS a fingir')
  const temPorta = Boolean(b330.pipeElements?.[0]?.options?.subOptions?.device)
  por('settings.json', b330, 'enabled', !ensaio && temPorta, 'B330 verdadeiro')

  for (const [nome, a] of abertos) if (a.mexido) fs.writeFileSync(path.join(pasta, nome), escrito(a.json))
  return mudou
}

if (require.main === module) {
  try {
    const modo = process.argv[2]
    const mudou = preparar(modo, path.join(__dirname, 'config'))
    console.log(`Modo ${modo === 'ensaio' ? 'de ENSAIO (caixa a fingir, dados à parte, tudo marcado como simulado)' : 'de BORDO (a caixa verdadeira, dados em ~/arlequin-dados)'}.`)
    for (const m of mudou) console.log(`  ${m}`)
    if (!mudou.length) console.log('  (a configuração já estava assim)')
  } catch (erro) {
    console.error(`${erro.message}\nuso: node preparar.js bordo|ensaio`)
    process.exit(2)
  }
}

module.exports = { preparar }
