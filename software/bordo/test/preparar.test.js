'use strict'
// O preparar muda só as cinco coisas que distinguem o modo de bordo do modo de ensaio, e guarda o resto
// como estiver (as calibrações que se forem acertando no barco).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { preparar } = require('../preparar')

const CONFIG = path.join(__dirname, '..', 'config')

// Uma cópia da configuração do git numa pasta temporária (o que o preparar lê e escreve).
function copia (t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-bordo-'))
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }))
  fs.copyFileSync(path.join(CONFIG, 'settings.json'), path.join(pasta, 'settings.json'))
  fs.mkdirSync(path.join(pasta, 'plugin-config-data'))
  for (const n of fs.readdirSync(path.join(CONFIG, 'plugin-config-data'))) {
    if (n.endsWith('.json')) fs.copyFileSync(path.join(CONFIG, 'plugin-config-data', n), path.join(pasta, 'plugin-config-data', n))
  }
  return pasta
}
const ler = (pasta, nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'))
const gravar = (pasta, nome, json) => fs.writeFileSync(path.join(pasta, nome), JSON.stringify(json, null, 2) + '\n')
const plugin = (pasta, id) => ler(pasta, `plugin-config-data/${id}.json`)
const mexer = (pasta, id, muda) => { const j = plugin(pasta, id); muda(j.configuration); gravar(pasta, `plugin-config-data/${id}.json`, j) }
const fornecedor = (pasta, id) => ler(pasta, 'settings.json').pipedProviders.find(p => p.id === id)
// todos os ficheiros da pasta, byte a byte: para ver o que foi (e o que não foi) escrito
const tudo = (pasta) => Object.fromEntries(['settings.json', ...fs.readdirSync(path.join(pasta, 'plugin-config-data')).map(n => `plugin-config-data/${n}`)]
  .map(n => [n, fs.readFileSync(path.join(pasta, n), 'utf8')]))

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

test('ensaio põe os valores do ensaio e diz o que mudou; bordo a seguir repõe-nos', (t) => {
  const pasta = copia(t)
  assert.deepEqual(chaves(pasta), BORDO, 'o que está no git é o modo de bordo')
  const mudou = preparar('ensaio', pasta)
  assert.deepEqual(chaves(pasta), ENSAIO)
  assert.equal(mudou.length, 6, mudou.join(' | ')) // a porta, o ensaio, as três pastas e o GPS a fingir
  assert.ok(mudou.every(m => typeof m === 'string' && m.length > 10))
  assert.ok(mudou.some(m => m.includes('tcp://localhost:8765')), mudou.join(' | '))
  assert.deepEqual(preparar('ensaio', pasta), [], 'outra vez no mesmo modo não muda nada')
  const volta = preparar('bordo', pasta)
  assert.deepEqual(chaves(pasta), BORDO)
  assert.equal(volta.length, 6, volta.join(' | '))
  assert.deepEqual(preparar('bordo', pasta), [])
})

test('uma calibração escrita à mão sobrevive ao ensaio e ao regresso; o que não é do preparar nem se reescreve', (t) => {
  const pasta = copia(t)
  mexer(pasta, 'signalk-arlequin-caixas', c => { c.nosPorHz = 0.23; c.desvioProa = 4; c.tabelaDesvios = [{ rumo: 90, desvio: -2 }] })
  mexer(pasta, 'signalk-arlequin-caixanegra', c => { c.limiteAviso = 70 })
  const antes = tudo(pasta)
  preparar('ensaio', pasta)
  const noEnsaio = tudo(pasta)
  preparar('bordo', pasta)
  const c = plugin(pasta, 'signalk-arlequin-caixas').configuration
  assert.deepEqual([c.nosPorHz, c.desvioProa, c.tabelaDesvios], [0.23, 4, [{ rumo: 90, desvio: -2 }]])
  assert.equal(plugin(pasta, 'signalk-arlequin-caixanegra').configuration.limiteAviso, 70)
  assert.deepEqual(tudo(pasta), antes, 'depois de ir e voltar fica tudo como estava, byte a byte')
  const mexidos = Object.keys(antes).filter(n => antes[n] !== noEnsaio[n]).sort()
  assert.deepEqual(mexidos, ['plugin-config-data/signalk-arlequin-caixanegra.json', 'plugin-config-data/signalk-arlequin-caixas.json',
    'plugin-config-data/signalk-arlequin-ia.json', 'plugin-config-data/signalk-arlequin-rota.json', 'settings.json'])
})

test('uma porta escrita à mão fica em bordo enquanto não se passar pelo ensaio; depois do ensaio volta a "auto"', (t) => {
  const pasta = copia(t)
  mexer(pasta, 'signalk-arlequin-caixas', c => { c.porta = 'COM7' })
  assert.deepEqual(preparar('bordo', pasta), [])
  assert.equal(chaves(pasta).porta, 'COM7')
  preparar('ensaio', pasta)
  assert.equal(chaves(pasta).porta, 'tcp://localhost:8765')
  preparar('bordo', pasta)
  assert.equal(chaves(pasta).porta, 'auto')
})

test('o B330 com a porta escrita fica ligado em bordo e desligado em ensaio', (t) => {
  const pasta = copia(t)
  const s = ler(pasta, 'settings.json')
  s.pipedProviders.find(p => p.id === 'b330').pipeElements[0].options.subOptions.device = 'COM5'
  gravar(pasta, 'settings.json', s)
  const mudou = preparar('bordo', pasta)
  assert.equal(chaves(pasta).b330, true)
  assert.equal(mudou.length, 1)
  preparar('ensaio', pasta)
  assert.deepEqual([chaves(pasta).b330, chaves(pasta).gpsAFingir], [false, true])
  preparar('bordo', pasta)
  assert.deepEqual([chaves(pasta).b330, chaves(pasta).gpsAFingir], [true, false])
  assert.equal(fornecedor(pasta, 'b330').pipeElements[0].options.subOptions.device, 'COM5')
})

test('um modo desconhecido dá erro e não escreve nada', (t) => {
  const pasta = copia(t)
  const antes = tudo(pasta)
  assert.throws(() => preparar('festa', pasta), /modo/)
  assert.throws(() => preparar(undefined, pasta), /modo/)
  assert.deepEqual(tudo(pasta), antes)
})

test('se faltar um ficheiro da configuração, diz qual e não deixa a pasta a meio', (t) => {
  const pasta = copia(t)
  fs.rmSync(path.join(pasta, 'plugin-config-data', 'signalk-arlequin-rota.json'))
  const antes = tudo(pasta)
  assert.throws(() => preparar('ensaio', pasta), /signalk-arlequin-rota\.json/)
  assert.deepEqual(tudo(pasta), antes, 'nenhum ficheiro mudou')
})
