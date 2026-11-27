'use strict'
// A regra do projeto: a caixa 2 só ouve a linha de dados do motor; nunca escreve nela.
// Esta guarda lê o código que vai para a caixa 2 e diz o que nele podia pôr o chip a escrever.
// Não precisa de placa nenhuma: corre sempre (ensaio/caixa2.test.js e ensaio/so-escuta.test.js).
//
// Em vez de uma lista do que é proibido (que só conhece os nomes de hoje), a guarda tem a lista do que
// se admite. Das coisas que o chip dá para a linha do motor (tudo o que começa por twai_ ou TWAI_, na
// interface antiga, na nova de esp_twai.h e nas camadas de baixo), o programa só pode usar as de ligar
// o controlador em escuta e de ler. Qualquer outro nome, de hoje ou que venha a existir, conta como
// achado, e quem o quiser usar tem de o vir pôr aqui à mão, a saber o que faz.
const fs = require('node:fs')
const path = require('node:path')

// O que o programa da caixa 2 usa hoje (caixa2/motor.h): pedir o controlador, ligá-lo e ler.
const ADMITIDAS = [
  'twai_general_config_t', 'TWAI_GENERAL_CONFIG_DEFAULT', 'TWAI_MODE_LISTEN_ONLY',
  'twai_timing_config_t', 'TWAI_TIMING_CONFIG_250KBITS',
  'twai_filter_config_t', 'TWAI_FILTER_CONFIG_ACCEPT_ALL',
  'twai_driver_install', 'twai_start',
  'twai_message_t', 'twai_receive'
]

// O único ficheiro do chip para a linha do motor que se pode incluir: o da interface antiga.
const INCLUIDOS = ['driver/twai.h']

// O código sem os comentários: o que lá se escreve para explicar não é programa.
const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')

// O que há num pedaço de código que podia escrever na linha do motor: uma frase por achado.
function escritas (codigo) {
  const limpo = semComentarios(codigo)
  const achados = new Set()
  for (const palavra of limpo.match(/\btwai_\w+/gi) || []) {
    if (!ADMITIDAS.includes(palavra)) achados.add(`usa ${palavra}`)
  }
  // "TWAI" sozinho é o nome dos registos do controlador: mexer-lhes é passar por baixo de tudo.
  if (/\bTWAI\b/.test(limpo)) achados.add('mexe nos registos do controlador (TWAI)')
  for (const [, nome] of limpo.matchAll(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"]+)[>"]/gm)) {
    if (/can|twai/i.test(nome) && !INCLUIDOS.includes(nome)) achados.add(`inclui ${nome}`)
  }
  for (const [, pedido] of limpo.matchAll(/TWAI_GENERAL_CONFIG_DEFAULT\s*\(([^;]*)/g)) {
    if (!pedido.includes('TWAI_MODE_LISTEN_ONLY')) achados.add('pede o controlador sem o modo de só escuta')
  }
  if (/\.\s*mode\s*=[^=]/.test(limpo)) achados.add('muda o modo do controlador')
  return [...achados]
}

// O programa todo, ficheiro a ficheiro: [{ nome, codigo }] → frases "ficheiro: achado". Lista vazia se
// nada nele pode escrever na linha do motor e se o controlador é pedido em modo de só escuta.
function examinar (ficheiros) {
  const achados = ficheiros.flatMap(f => escritas(f.codigo).map(a => `${f.nome}: ${a}`))
  if (!ficheiros.some(f => /TWAI_MODE_LISTEN_ONLY/.test(semComentarios(f.codigo)))) {
    achados.push('o controlador do motor não é pedido em modo de só escuta')
  }
  return achados
}

// Os ficheiros nossos que entram no programa da caixa 2: os dela e os comuns às duas caixas.
function ficheirosDaCaixa2 (raiz = path.join(__dirname, '..')) {
  return ['caixa2', 'comum/src'].flatMap(pasta =>
    fs.readdirSync(path.join(raiz, pasta))
      .filter(n => /\.(ino|h|hpp|c|cpp)$/.test(n))
      .sort()
      .map(n => ({ nome: `${pasta}/${n}`, codigo: fs.readFileSync(path.join(raiz, pasta, n), 'utf8') })))
}

module.exports = { ADMITIDAS, examinar, ficheirosDaCaixa2 }
