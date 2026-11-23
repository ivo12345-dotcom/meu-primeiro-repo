#!/usr/bin/env node
'use strict'
// Prepara a pasta de configuração que o SignalK de bordo vai usar, antes de o servidor arrancar.
// Há três pastas, cada uma com o seu papel:
//
//   modelo/         a configuração de fábrica. É a única que vai para o git: sem calibrações, sem
//                   segredos, sem nada do simulador (test/config-bordo.test.js confirma-o).
//   config/         a configuração do BARCO. Nasce do modelo à primeira vez e daí em diante é do barco:
//                   o servidor escreve lá o que se acerta no ecrã de administração (a porta, as
//                   calibrações, a tabela de desvios, as prioridades) e o estado dos plugins (o diário,
//                   os consumos aprendidos, a saída em curso). Fica fora do git.
//   config-ensaio/  a do ENSAIO em casa, com a caixa a fingir. Cada ensaio parte de uma cópia da
//                   configuração do barco, com os valores do ensaio por cima, e deixa o seu estado
//                   aqui. Assim um ensaio nunca escreve na pasta do barco. Fica fora do git.
//
// Os modos:
//
//   bordo    (npm start)        garante que a pasta do barco existe e guarda uma cópia dela na pasta dos
//                               dados quando mudou. Não muda valor nenhum: o que o barco tem, fica.
//   ensaio   (npm run ensaio)   copia a configuração do barco para config-ensaio e põe-lhe por cima:
//                                 caixas: porta "tcp://localhost:8765" e "ensaio" ligado (tudo simulado)
//                                 caixa negra, AI e rota: a pasta de dados "arlequin-dados-ensaio"
//                                 o GPS a fingir ligado e o B330 verdadeiro desligado
//   ensaio-placa (npm run ensaio-placa)  o mesmo ensaio, mas com a caixa 1 verdadeira ligada por USB: fica
//                               a porta que o barco tiver escolhida (e "ensaio" ligado: tudo simulado)
//   criar    (npm run instalar) só garante que a pasta do barco existe, para se instalarem os plugins.
//
// O que o modelo ganhar de novo chega ao barco sem estragar nada: um ficheiro que o barco não tenha é
// copiado; um plugin novo entra na lista (package.json), com a versão do modelo; o resto não se toca.
//
//   node preparar.js bordo|ensaio|ensaio-placa|criar

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const AQUI = __dirname
const PASTAS = { modelo: path.join(AQUI, 'modelo'), config: path.join(AQUI, 'config'), ensaio: path.join(AQUI, 'config-ensaio') }
const MODOS = ['bordo', 'ensaio', 'ensaio-placa', 'criar']
const DADOS = '~/arlequin-dados' // a pasta dos dados, se a configuração não disser outra
const DADOS_ENSAIO = 'arlequin-dados-ensaio'
const PORTA_ENSAIO = 'tcp://localhost:8765'
const COM_DADOS = ['signalk-arlequin-caixanegra', 'signalk-arlequin-ia', 'signalk-arlequin-rota']
const COPIAS = 'copias-da-configuracao'
const GUARDADAS = 10 // quantas cópias da configuração do barco ficam
const CARIMBO = /^\d{4}-\d{2}-\d{2}_\d{6}$/ // o nome de uma cópia: AAAA-MM-DD_HHMMSS
const escrito = (json) => JSON.stringify(json, null, 2) + '\n'

function lerJson (pasta, nome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'))
  } catch (erro) {
    throw new Error(`não consigo ler ${nome}: ${erro.message}`)
  }
}

// Os ficheiros de configuração de uma pasta. Fica de fora o que não é configuração: os plugins
// instalados, o estado que os plugins guardam (as pastas dentro de plugin-config-data) e a segurança
// do servidor.
function ficheiros (pasta) {
  const r = ['package.json', 'settings.json', 'priorities.json'].filter(n => fs.existsSync(path.join(pasta, n)))
  const dosPlugins = path.join(pasta, 'plugin-config-data')
  if (fs.existsSync(dosPlugins)) {
    for (const e of fs.readdirSync(dosPlugins, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.json')) r.push(`plugin-config-data/${e.name}`)
    }
  }
  return r.sort()
}

function copiar (de, para, nome) {
  fs.mkdirSync(path.dirname(path.join(para, nome)), { recursive: true })
  fs.copyFileSync(path.join(de, nome), path.join(para, nome))
}

// A pasta do barco com tudo o que o modelo tem. → os nomes do que foi criado ou atualizado.
function completar (modelo, config) {
  const criados = []
  for (const nome of ficheiros(modelo)) {
    if (fs.existsSync(path.join(config, nome))) continue
    copiar(modelo, config, nome)
    criados.push(nome)
  }
  if (!criados.includes('package.json')) {
    const doModelo = lerJson(modelo, 'package.json').dependencies || {}
    const doBarco = lerJson(config, 'package.json')
    const juntos = { ...(doBarco.dependencies || {}), ...doModelo }
    if (JSON.stringify(juntos) !== JSON.stringify(doBarco.dependencies || {})) {
      fs.writeFileSync(path.join(config, 'package.json'), escrito({ ...doBarco, dependencies: juntos }))
      criados.push('package.json (lista de plugins atualizada pelo modelo)')
    }
  }
  return criados
}

// A configuração do barco, com os valores do ensaio por cima, na pasta do ensaio. Lê e confere tudo
// antes de escrever: se um ficheiro do barco não se perceber, dá erro sem ter mexido em nenhum.
// comAPlaca: o ensaio lê a caixa verdadeira (com os geradores de bancada dela) pela porta que o barco
// tiver escolhida, em vez da caixa a fingir; o resto é igual, e tudo sai marcado como simulado.
function paraOEnsaio (config, ensaio, comAPlaca = false) {
  const abertos = new Map(ficheiros(config).map(nome => [nome, lerJson(config, nome)]))
  const deUmPlugin = (id) => {
    const nome = `plugin-config-data/${id}.json`
    const json = abertos.get(nome)
    if (!json) throw new Error(`não consigo ler ${nome}: falta na configuração do barco`)
    if (!json.configuration || typeof json.configuration !== 'object') throw new Error(`não consigo ler ${nome}: falta a "configuration"`)
    return json.configuration
  }
  const definicoes = abertos.get('settings.json')
  if (!definicoes) throw new Error('não consigo ler settings.json: falta na configuração do barco')
  const fornecedor = (id) => {
    const f = (definicoes.pipedProviders || []).find(p => p.id === id)
    if (!f) throw new Error(`não consigo ler settings.json: falta a entrada "${id}" em pipedProviders`)
    return f
  }

  const caixas = deUmPlugin('signalk-arlequin-caixas')
  if (!comAPlaca) caixas.porta = PORTA_ENSAIO
  caixas.ensaio = true
  for (const id of COM_DADOS) deUmPlugin(id).pasta = DADOS_ENSAIO
  fornecedor('b330').enabled = false
  fornecedor('b330-a-fingir').enabled = true

  for (const [nome, json] of abertos) {
    const destino = path.join(ensaio, nome)
    const texto = escrito(json)
    if (fs.existsSync(destino) && fs.readFileSync(destino, 'utf8') === texto) continue
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, texto)
  }
}

// O servidor procura os plugins em <pasta de configuração>/node_modules. A pasta do ensaio usa os do
// barco por uma ligação (uma "junção" no Windows, que não pede direitos de administrador).
function ligarPlugins (config, ensaio) {
  const instalados = path.join(config, 'node_modules')
  const ligacao = path.join(ensaio, 'node_modules')
  if (!fs.existsSync(instalados)) return
  try {
    fs.lstatSync(ligacao)
  } catch {
    fs.symlinkSync(path.resolve(instalados), ligacao, 'junction')
  }
}

// Onde ficam as cópias: dentro da pasta dos dados do barco (a que a caixa negra usa), que é a pasta que
// a ferramenta de sincronizar leva para fora do portátil. O "~" é a pasta de casa, como nos plugins.
function pastaDasCopias (configCaixaNegra, casa, base) {
  const pasta = configCaixaNegra?.configuration?.pasta || DADOS
  const inteira = pasta.startsWith('~') ? path.join(casa, pasta.slice(1)) : path.resolve(base, pasta)
  return path.join(inteira, COPIAS)
}

const doisDigitos = (n) => String(n).padStart(2, '0')
const carimbo = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}_${doisDigitos(d.getHours())}${doisDigitos(d.getMinutes())}${doisDigitos(d.getSeconds())}`

function iguais (a, b) {
  const nomes = ficheiros(a)
  if (nomes.join('\n') !== ficheiros(b).join('\n')) return false
  return nomes.every(n => fs.readFileSync(path.join(a, n)).equals(fs.readFileSync(path.join(b, n))))
}

// Guarda uma cópia datada da configuração do barco se ela mudou desde a última, e fica só com as
// GUARDADAS mais recentes. → a pasta da cópia nova, ou null se não mudou nada.
function guardarCopia (config, destino, agora) {
  const anteriores = fs.existsSync(destino) ? fs.readdirSync(destino).filter(n => CARIMBO.test(n)).sort() : []
  if (anteriores.length && iguais(config, path.join(destino, anteriores.at(-1)))) return null
  const nome = carimbo(agora)
  const nova = path.join(destino, nome)
  for (const f of ficheiros(config)) copiar(config, nova, f)
  const todas = [...new Set([...anteriores, nome])].sort()
  for (const velha of todas.slice(0, -GUARDADAS)) fs.rmSync(path.join(destino, velha), { recursive: true, force: true })
  return nova
}

// → { pasta (a que se dá ao servidor), criados (o que veio do modelo), copia (a cópia guardada, ou null),
//     aviso (se a cópia falhou), semPlugins (true se ainda falta "npm run instalar") }
function preparar (modo, { modelo = PASTAS.modelo, config = PASTAS.config, ensaio = PASTAS.ensaio, copias, agora = new Date() } = {}) {
  if (!MODOS.includes(modo)) throw new Error(`modo desconhecido: ${JSON.stringify(modo)} (é "bordo", "ensaio", "ensaio-placa" ou "criar")`)
  const r = { pasta: config, criados: completar(modelo, config), copia: null, aviso: null, semPlugins: false }
  r.semPlugins = !fs.existsSync(path.join(config, 'node_modules'))
  if (modo === 'ensaio' || modo === 'ensaio-placa') {
    paraOEnsaio(config, ensaio, modo === 'ensaio-placa')
    ligarPlugins(config, ensaio)
    r.pasta = ensaio
  } else if (modo === 'bordo') {
    // uma cópia que falhe (disco cheio, pasta sem acesso) não pode impedir o barco de arrancar
    try {
      const destino = copias || pastaDasCopias(lerJson(config, 'plugin-config-data/signalk-arlequin-caixanegra.json'), os.homedir(), AQUI)
      r.copia = guardarCopia(config, destino, agora)
    } catch (erro) {
      r.aviso = `não consegui guardar a cópia da configuração do barco: ${erro.message}`
    }
  }
  return r
}

if (require.main === module) {
  try {
    const modo = process.argv[2]
    const r = preparar(modo)
    if (modo === 'ensaio') {
      console.log('Modo de ENSAIO: a caixa a fingir, dados à parte e tudo marcado como simulado.')
      console.log('  Parte de uma cópia da configuração do barco (config → config-ensaio): o que mexeres no ensaio fica só no ensaio.')
    } else if (modo === 'ensaio-placa') {
      console.log('Modo de ENSAIO COM A PLACA: a caixa verdadeira, dados à parte e tudo marcado como simulado.')
      console.log('  A posição vem do GPS a fingir: é preciso o "npm run caixa-a-fingir" a correr noutra janela.')
    } else if (modo === 'bordo') {
      console.log('Modo de BORDO: a caixa verdadeira e os dados do barco.')
    } else {
      console.log('A pasta de configuração do barco (config) está pronta.')
    }
    for (const c of r.criados) console.log(`  veio do modelo: ${c}`)
    if (r.copia) console.log(`  cópia da configuração do barco guardada em ${r.copia}`)
    if (r.aviso) console.log(`  AVISO: ${r.aviso}`)
    if (modo !== 'criar' && r.semPlugins) {
      console.error('Faltam os plugins instalados. Corre primeiro: npm run instalar')
      process.exit(2)
    }
  } catch (erro) {
    console.error(`${erro.message}\nuso: node preparar.js bordo|ensaio|ensaio-placa|criar`)
    process.exit(2)
  }
}

module.exports = { preparar, pastaDasCopias }
