'use strict'
// O preparar trata de três pastas, cada uma com o seu papel:
//   modelo         o que vai para o git: a configuração de fábrica, sem calibrações nem segredos;
//   config         a configuração do barco: nasce do modelo e depois é do barco (o servidor escreve lá
//                  as calibrações que se acertam no ecrã de administração, e o estado dos plugins);
//   config-ensaio  a do ensaio em casa: uma cópia da do barco com os valores do ensaio, e o estado do
//                  ensaio (diário, consumos, saídas a fingir), que assim nunca se mistura com o do barco.
// Revisão final de 22/11/2026: antes havia uma pasta só, e um ensaio deixava lá diário e consumos a fingir.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { preparar, pastaDasCopias } = require('../preparar')

const MODELO = path.join(__dirname, '..', 'modelo')

// Três pastas temporárias; a do modelo é uma cópia do modelo verdadeiro do git.
function pastas (t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-bordo-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const p = { modelo: path.join(base, 'modelo'), config: path.join(base, 'config'), ensaio: path.join(base, 'config-ensaio'), copias: path.join(base, 'copias') }
  fs.cpSync(MODELO, p.modelo, { recursive: true })
  return p
}
const ler = (pasta, nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'))
const gravar = (pasta, nome, json) => fs.writeFileSync(path.join(pasta, nome), JSON.stringify(json, null, 2) + '\n')
const plugin = (pasta, id) => ler(pasta, `plugin-config-data/${id}.json`)
const mexer = (pasta, id, muda) => { const j = plugin(pasta, id); muda(j.configuration); gravar(pasta, `plugin-config-data/${id}.json`, j) }
const fornecedor = (pasta, id) => ler(pasta, 'settings.json').pipedProviders.find(p => p.id === id)
// todos os ficheiros de uma pasta (e das de dentro), byte a byte: para ver o que foi e o que não foi escrito
function tudo (pasta, dentro = '') {
  const r = {}
  if (!fs.existsSync(path.join(pasta, dentro))) return r
  for (const e of fs.readdirSync(path.join(pasta, dentro), { withFileTypes: true })) {
    const nome = dentro ? `${dentro}/${e.name}` : e.name
    if (e.name === 'node_modules') continue
    if (e.isDirectory()) Object.assign(r, tudo(pasta, nome))
    else r[nome] = fs.readFileSync(path.join(pasta, nome), 'utf8')
  }
  return r
}

const DADOS = ['signalk-arlequin-caixanegra', 'signalk-arlequin-ia', 'signalk-arlequin-rota']
function chaves (pasta) {
  const caixas = plugin(pasta, 'signalk-arlequin-caixas').configuration
  return {
    porta: caixas.porta,
    ensaio: caixas.ensaio,
    pastas: DADOS.map(id => plugin(pasta, id).configuration.pasta),
    gpsAFingir: fornecedor(pasta, 'b330-a-fingir').enabled,
    b330: fornecedor(pasta, 'b330').enabled
  }
}
const BORDO = { porta: 'auto', ensaio: false, pastas: Array(3).fill('~/arlequin-dados'), gpsAFingir: false, b330: false }
const ENSAIO = { porta: 'tcp://localhost:8765', ensaio: true, pastas: Array(3).fill('arlequin-dados-ensaio'), gpsAFingir: true, b330: false }

test('a configuração do barco nasce do modelo, e cada modo diz ao servidor a sua pasta', (t) => {
  const p = pastas(t)
  const r = preparar('bordo', p)
  assert.equal(r.pasta, p.config)
  assert.deepEqual(tudo(p.config), tudo(p.modelo), 'à primeira é o modelo tal e qual')
  assert.deepEqual(chaves(p.config), BORDO)
  assert.ok(r.criados.includes('settings.json') && r.criados.includes('plugin-config-data/signalk-arlequin-caixas.json'), r.criados.join(' '))
  assert.equal(r.semPlugins, true, 'ainda ninguém instalou os plugins: quem chama tem de o saber')
  assert.equal(fs.existsSync(p.ensaio), false, 'o modo de bordo não cria a pasta do ensaio')
  assert.deepEqual(preparar('bordo', p).criados, [], 'à segunda já não há nada para criar')
  assert.equal(preparar('ensaio', p).pasta, p.ensaio)
})

test('o ensaio não escreve nada na configuração do barco', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  const antes = tudo(p.config)
  const r = preparar('ensaio', p)
  assert.deepEqual(tudo(p.config), antes, 'a configuração do barco fica igual, byte a byte')
  assert.deepEqual(chaves(p.ensaio), ENSAIO)
  assert.deepEqual(chaves(p.config), BORDO)
  assert.equal(r.pasta, p.ensaio)
  preparar('ensaio', p)
  preparar('bordo', p)
  assert.deepEqual(tudo(p.config), antes, 'nem com várias idas e voltas')
})

test('o estado que o ensaio deixa (diário, consumos, saídas) fica na pasta do ensaio e não na do barco', (t) => {
  const p = pastas(t)
  preparar('ensaio', p)
  // o que o servidor e os plugins escrevem enquanto correm com a pasta que o preparar lhes deu
  const diario = path.join(p.ensaio, 'plugin-config-data', 'signalk-logbook')
  fs.mkdirSync(diario, { recursive: true })
  fs.writeFileSync(path.join(diario, '2026-11-22.yml'), '- texto: entrada a fingir\n')
  fs.mkdirSync(path.join(p.ensaio, 'serverState'))
  fs.writeFileSync(path.join(p.ensaio, 'serverState', 'course.json'), '{}')
  const barco = tudo(p.config)
  preparar('ensaio', p) // outro ensaio: o estado do anterior continua lá
  assert.equal(fs.readFileSync(path.join(diario, '2026-11-22.yml'), 'utf8'), '- texto: entrada a fingir\n')
  preparar('bordo', p)
  assert.deepEqual(tudo(p.config), barco)
  assert.equal(fs.existsSync(path.join(p.config, 'plugin-config-data', 'signalk-logbook')), false)
  assert.equal(fs.existsSync(path.join(p.config, 'serverState')), false)
})

test('o que se acerta no barco fica no barco: nem o modo de bordo nem o modelo lhe mexem', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  mexer(p.config, 'signalk-arlequin-caixas', c => { c.porta = 'COM7'; c.nosPorHz = 0.23; c.desvioProa = 4; c.tabelaDesvios = [{ rumo: 90, desvio: -2 }] })
  mexer(p.config, 'signalk-arlequin-caixanegra', c => { c.limiteAviso = 70; c.pasta = 'D:/arlequin-dados' })
  const s = ler(p.config, 'settings.json')
  Object.assign(s.pipedProviders.find(x => x.id === 'b330'), { enabled: true })
  s.pipedProviders.find(x => x.id === 'b330').pipeElements[0].options.subOptions.device = 'COM5'
  gravar(p.config, 'settings.json', s)
  gravar(p.config, 'priorities.json', { priorityOverrides: { 'navigation.headingMagnetic': [{ sourceRef: 'piloto', timeout: 5000 }] } })
  const antes = tudo(p.config)
  assert.deepEqual(preparar('bordo', p).criados, [])
  assert.deepEqual(tudo(p.config), antes, 'a porta, as calibrações, a pasta dos dados, o B330 e as prioridades ficam como o barco as tem')
})

test('o ensaio ensaia a configuração do barco: leva as calibrações, e o que se mexer no ensaio não volta', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  mexer(p.config, 'signalk-arlequin-caixas', c => { c.porta = 'COM7'; c.nosPorHz = 0.23 })
  const s = ler(p.config, 'settings.json')
  Object.assign(s.pipedProviders.find(x => x.id === 'b330'), { enabled: true })
  s.pipedProviders.find(x => x.id === 'b330').pipeElements[0].options.subOptions.device = 'COM5'
  gravar(p.config, 'settings.json', s)
  preparar('ensaio', p)
  assert.equal(plugin(p.ensaio, 'signalk-arlequin-caixas').configuration.nosPorHz, 0.23)
  assert.deepEqual(chaves(p.ensaio), ENSAIO, 'com a porta, o GPS e o B330 do ensaio por cima')
  assert.equal(fornecedor(p.ensaio, 'b330').pipeElements[0].options.subOptions.device, 'COM5')
  mexer(p.ensaio, 'signalk-arlequin-caixas', c => { c.nosPorHz = 0.5 }) // alguém mexe no ecrã durante o ensaio
  preparar('ensaio', p)
  assert.equal(plugin(p.ensaio, 'signalk-arlequin-caixas').configuration.nosPorHz, 0.23, 'o ensaio seguinte parte outra vez da do barco')
  assert.equal(plugin(p.config, 'signalk-arlequin-caixas').configuration.nosPorHz, 0.23)
  assert.equal(plugin(p.config, 'signalk-arlequin-caixas').configuration.porta, 'COM7')
})

test('um ficheiro que falte na configuração do barco volta do modelo, sem tocar nos outros', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  mexer(p.config, 'signalk-arlequin-caixas', c => { c.nosPorHz = 0.23 })
  fs.rmSync(path.join(p.config, 'plugin-config-data', 'signalk-arlequin-rota.json'))
  fs.rmSync(path.join(p.config, 'priorities.json'))
  const r = preparar('ensaio', p)
  assert.deepEqual(r.criados.sort(), ['plugin-config-data/signalk-arlequin-rota.json', 'priorities.json'])
  assert.equal(plugin(p.config, 'signalk-arlequin-caixas').configuration.nosPorHz, 0.23)
  assert.deepEqual(ler(p.config, 'priorities.json'), ler(p.modelo, 'priorities.json'))
})

test('os plugins que o modelo ganhar entram na lista do barco; os que o barco tiver a mais ficam', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  const barco = ler(p.config, 'package.json')
  barco.dependencies['um-plugin-posto-a-mao'] = '1.0.0'
  barco.dependencies['signalk-derived-data'] = '1.40.0' // uma versão velha: a do modelo é que vale
  gravar(p.config, 'package.json', barco)
  const modelo = ler(p.modelo, 'package.json')
  modelo.dependencies['signalk-arlequin-novo'] = 'file:../../signalk-arlequin-novo'
  gravar(p.modelo, 'package.json', modelo)
  const r = preparar('bordo', p)
  assert.deepEqual(r.criados, ['package.json (lista de plugins atualizada pelo modelo)'])
  const d = ler(p.config, 'package.json').dependencies
  assert.equal(d['signalk-arlequin-novo'], 'file:../../signalk-arlequin-novo')
  assert.equal(d['um-plugin-posto-a-mao'], '1.0.0')
  assert.equal(d['signalk-derived-data'], modelo.dependencies['signalk-derived-data'])
  assert.deepEqual(preparar('bordo', p).criados, [])
})

test('a pasta do ensaio usa os plugins instalados na do barco, sem os copiar', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  fs.mkdirSync(path.join(p.config, 'node_modules', 'um-plugin'), { recursive: true })
  fs.writeFileSync(path.join(p.config, 'node_modules', 'um-plugin', 'package.json'), '{"name":"um-plugin"}')
  assert.equal(preparar('bordo', p).semPlugins, false)
  assert.equal(preparar('ensaio', p).semPlugins, false)
  const ligacao = path.join(p.ensaio, 'node_modules')
  assert.equal(fs.lstatSync(ligacao).isSymbolicLink(), true, 'é uma ligação para a pasta do barco, não uma cópia')
  assert.equal(fs.readFileSync(path.join(ligacao, 'um-plugin', 'package.json'), 'utf8'), '{"name":"um-plugin"}')
  preparar('ensaio', p) // outra vez: a ligação já lá está e não dá erro
  assert.equal(fs.existsSync(path.join(p.config, 'node_modules', 'um-plugin', 'package.json')), true)
})

test('um modo desconhecido dá erro e não escreve nada', (t) => {
  const p = pastas(t)
  assert.throws(() => preparar('festa', p), /modo/)
  assert.throws(() => preparar(undefined, p), /modo/)
  assert.equal(fs.existsSync(p.config), false)
  assert.equal(fs.existsSync(p.ensaio), false)
})

test('uma configuração do barco que não se percebe dá erro com o nome do ficheiro e não deixa o ensaio a meio', (t) => {
  const p = pastas(t)
  preparar('ensaio', p)
  const antes = tudo(p.ensaio)
  fs.writeFileSync(path.join(p.config, 'plugin-config-data', 'signalk-arlequin-rota.json'), '{ isto não é JSON')
  assert.throws(() => preparar('ensaio', p), /signalk-arlequin-rota\.json/)
  assert.deepEqual(tudo(p.ensaio), antes, 'nenhum ficheiro do ensaio mudou')
  const s = ler(p.config, 'settings.json')
  s.pipedProviders = s.pipedProviders.filter(x => x.id !== 'b330-a-fingir')
  gravar(p.config, 'settings.json', s)
  fs.copyFileSync(path.join(p.modelo, 'plugin-config-data', 'signalk-arlequin-rota.json'), path.join(p.config, 'plugin-config-data', 'signalk-arlequin-rota.json'))
  assert.throws(() => preparar('ensaio', p), /b330-a-fingir/)
  assert.deepEqual(tudo(p.ensaio), antes)
})

// As calibrações do barco deixaram de estar no git (o modelo tem de ficar de fábrica). Para não ficarem
// só numa pasta que um "git clean" apaga, o modo de bordo guarda uma cópia na pasta dos dados sempre que
// a configuração muda.
test('o modo de bordo guarda uma cópia da configuração do barco quando ela muda, e só então', (t) => {
  const p = pastas(t)
  const r1 = preparar('bordo', { ...p, agora: new Date(2026, 10, 23, 8, 0, 0) })
  assert.equal(path.basename(r1.copia), '2026-11-23_080000')
  assert.deepEqual(tudo(r1.copia), tudo(p.config), 'a cópia tem os mesmos ficheiros da configuração')
  assert.equal(preparar('bordo', { ...p, agora: new Date(2026, 10, 23, 9, 0, 0) }).copia, null, 'sem mudanças não se repete')
  mexer(p.config, 'signalk-arlequin-caixas', c => { c.desvioProa = 4 })
  const r3 = preparar('bordo', { ...p, agora: new Date(2026, 10, 24, 9, 30, 5) })
  assert.equal(path.basename(r3.copia), '2026-11-24_093005')
  assert.equal(plugin(r3.copia, 'signalk-arlequin-caixas').configuration.desvioProa, 4)
  assert.equal(plugin(r1.copia, 'signalk-arlequin-caixas').configuration.desvioProa, 0, 'a anterior fica como era')
  assert.equal(preparar('ensaio', { ...p, agora: new Date(2026, 10, 25) }).copia, null, 'o ensaio não guarda cópias')
  assert.deepEqual(fs.readdirSync(p.copias).sort(), ['2026-11-23_080000', '2026-11-24_093005'])
})

test('guardam-se as últimas 10 cópias; o estado dos plugins e a segurança do servidor não vão na cópia', (t) => {
  const p = pastas(t)
  preparar('bordo', { ...p, agora: new Date(2026, 0, 1) })
  fs.mkdirSync(path.join(p.config, 'plugin-config-data', 'signalk-logbook'), { recursive: true })
  fs.writeFileSync(path.join(p.config, 'plugin-config-data', 'signalk-logbook', '2026-11-22.yml'), 'x')
  fs.writeFileSync(path.join(p.config, 'security.json'), '{"secretKey":"x"}')
  fs.writeFileSync(path.join(p.copias, 'notas-minhas.txt'), 'não é uma cópia: não se apaga')
  for (let dia = 2; dia <= 13; dia++) {
    mexer(p.config, 'signalk-arlequin-caixas', c => { c.desvioProa = dia })
    preparar('bordo', { ...p, agora: new Date(2026, 0, dia) })
  }
  const copias = fs.readdirSync(p.copias).filter(n => /^\d{4}-/.test(n)).sort()
  assert.equal(copias.length, 10)
  assert.equal(copias[0], '2026-01-04_000000')
  assert.equal(copias.at(-1), '2026-01-13_000000')
  assert.equal(fs.existsSync(path.join(p.copias, 'notas-minhas.txt')), true)
  const ultima = tudo(path.join(p.copias, copias.at(-1)))
  assert.deepEqual(Object.keys(ultima).filter(n => /logbook\/|security/.test(n)), [])
  assert.ok('plugin-config-data/signalk-logbook.json' in ultima && 'settings.json' in ultima && 'package.json' in ultima)
})

test('se a cópia não se conseguir guardar, o barco arranca na mesma e fica o aviso', (t) => {
  const p = pastas(t)
  const impossivel = path.join(p.modelo, 'package.json', 'copias') // uma pasta dentro de um ficheiro: não se cria
  const r = preparar('bordo', { ...p, copias: impossivel })
  assert.equal(r.pasta, p.config)
  assert.equal(r.copia, null)
  assert.match(r.aviso, /não consegui guardar a cópia/)
  assert.deepEqual(chaves(p.config), BORDO)
  assert.equal(preparar('bordo', p).aviso, null)
})

test('a pasta das cópias é a pasta dos dados do barco, com o ~ trocado pela pasta de casa', () => {
  const casa = path.join('C:', 'Users', 'alguem')
  assert.equal(pastaDasCopias({ configuration: { pasta: '~/arlequin-dados' } }, casa, 'X:/bordo'), path.join(casa, 'arlequin-dados', 'copias-da-configuracao'))
  assert.equal(pastaDasCopias({ configuration: { pasta: 'D:/dados' } }, casa, 'X:/bordo'), path.join('D:/dados', 'copias-da-configuracao'))
  assert.equal(pastaDasCopias({ configuration: { pasta: 'dados-ao-lado' } }, casa, 'X:/bordo'), path.resolve('X:/bordo', 'dados-ao-lado', 'copias-da-configuracao'))
  assert.equal(pastaDasCopias({ configuration: {} }, casa, 'X:/bordo'), path.join(casa, 'arlequin-dados', 'copias-da-configuracao'))
})

test('os comandos do package.json dão a cada modo a sua pasta', () => {
  const s = require('../package.json').scripts
  assert.match(s.start, /^node preparar\.js bordo && node \S+signalk-server -c config$/)
  assert.match(s.ensaio, /^node preparar\.js ensaio && node \S+signalk-server -c config-ensaio$/)
  assert.match(s.instalar, /^node preparar\.js criar && cd config && npm install$/)
})

test('"criar" só cria a configuração do barco: não pede os plugins instalados nem guarda cópia', (t) => {
  const p = pastas(t)
  const r = preparar('criar', p)
  assert.equal(r.pasta, p.config)
  assert.deepEqual(tudo(p.config), tudo(p.modelo))
  assert.equal(r.copia, null)
  assert.equal(fs.existsSync(p.copias), false)
})

// --- O ensaio com a placa verdadeira (programa das caixas de 23/11) ---------------------------------
// Como o ensaio em casa (pasta do ensaio, dados do ensaio, tudo marcado como simulado, GPS a fingir),
// mas a ler a caixa verdadeira pela porta que o barco tiver escolhida (de fábrica, 'auto').
test('o ensaio com a placa: tudo como no ensaio, menos a porta, que é a do barco', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  const antes = tudo(p.config)
  const r = preparar('ensaio-placa', p)
  assert.equal(r.pasta, p.ensaio)
  assert.deepEqual(chaves(p.ensaio), { ...ENSAIO, porta: 'auto' })
  assert.deepEqual(tudo(p.config), antes, 'a configuração do barco fica igual, byte a byte')
  preparar('ensaio', p) // e volta-se ao ensaio com a caixa a fingir
  assert.deepEqual(chaves(p.ensaio), ENSAIO)
  preparar('ensaio-placa', p)
  assert.deepEqual(chaves(p.ensaio), { ...ENSAIO, porta: 'auto' })
})

test('o ensaio com a placa respeita uma porta escolhida à mão no barco', (t) => {
  const p = pastas(t)
  preparar('bordo', p)
  mexer(p.config, 'signalk-arlequin-caixas', c => { c.porta = 'COM7' })
  preparar('ensaio-placa', p)
  assert.equal(plugin(p.ensaio, 'signalk-arlequin-caixas').configuration.porta, 'COM7')
  assert.equal(plugin(p.ensaio, 'signalk-arlequin-caixas').configuration.ensaio, true)
})

test('o comando do ensaio com a placa usa a pasta do ensaio', () => {
  const s = require('../package.json').scripts
  assert.match(s['ensaio-placa'], /^node preparar\.js ensaio-placa && node \S+signalk-server -c config-ensaio$/)
})
