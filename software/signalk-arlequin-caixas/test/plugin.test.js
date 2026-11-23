'use strict'
// O plugin inteiro com um "app" falso e uma fonte a fingir: linhas da caixa 1 → SignalK.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const criar = require('..')
const { escrever, soma } = require('../lib/linhas')

// A linha do motor como a caixa a manda: com a soma de tudo o que está antes do "*".
const motor = (corpo) => `${corpo}*${soma(corpo)}`

const AGORA = 1_727_600_000_000
const SIMULADO = 'arlequin-simulador.caixas'
const GRAU = Math.PI / 180

function appFalso () {
  const app = new EventEmitter()
  app.valores = {}
  app.fontes = [] // o $source de cada atualização (undefined quando não leva)
  app.notificacoes = []
  app.estados = [] // o que foi para o setPluginStatus
  app.erros = [] // o que foi para o setPluginError
  app.registo = 0 // chamadas ao app.debug e ao app.error
  app.handleMessage = (id, d) => {
    assert.equal(id, 'signalk-arlequin-caixas')
    for (const u of d.updates) {
      app.fontes.push(u.$source)
      for (const v of u.values) {
        assert.notEqual(v.value, undefined, `${v.path} sem valor`)
        assert.ok(!(typeof v.value === 'number' && Number.isNaN(v.value)), `${v.path} é NaN`)
        if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
        else app.valores[v.path] = v.value
      }
    }
  }
  app.setPluginStatus = (s) => app.estados.push(s)
  app.setPluginError = (e) => app.erros.push(e)
  app.debug = () => { app.registo++ }
  app.error = () => { app.registo++ }
  return app
}

// Uma fonte a fingir: guarda o que o plugin lhe deu, para o teste lhe "mandar" linhas e estados.
function fonteAFingir () {
  const f = { abertas: 0, fechadas: 0, porta: null, aoLinha: null, aoEstado: null }
  f.abrirFonte = ({ porta, aoLinha, aoEstado }) => {
    f.abertas++
    f.porta = porta
    f.aoLinha = aoLinha
    f.aoEstado = aoEstado
    return { fechar () { f.fechadas++ } }
  }
  return f
}

// O plugin a correr com a porta COM7 aberta (os relógios do teste já têm de estar ligados).
function montar (opcoes = {}) {
  const app = appFalso()
  const f = fonteAFingir()
  const p = criar(app, { abrirFonte: f.abrirFonte })
  p.start(opcoes)
  f.aoEstado({ aberta: true, nome: 'COM7' })
  return { app, f, p }
}

function arrancar (t, opcoes = {}) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: AGORA })
  return montar(opcoes)
}

const batimento = (caixa, { sim = 0, perdidos = 0 } = {}) => escrever('B', [caixa, 1000, '0.1.0', sim, caixa === 1 ? 0 : -58, perdidos])
const log = (ms, impulsos) => escrever('L', [ms, impulsos, 100000])
const mov = (n, q = [0, 1736, 0, 9848]) => escrever('M', [n, 10, 512, -2980, 9320, -12, 35, 4, ...q, 349, 3])
const VENTO = '$IIMWV,35.0,R,14.0,N,A*3E'

// Um segundo do que a caixa manda com tudo a funcionar: a 10 impulsos por segundo, vento de 14 nós a
// 35° por estibordo e o barco adornado 20° (q roda 20° em torno do eixo que aponta à proa).
function umSegundoBom (f, { q, n0 = 1042, sim = 0 } = {}) {
  f.aoLinha(batimento(1, { sim }))
  f.aoLinha(batimento(2))
  for (let i = 0; i < 5; i++) f.aoLinha(log(1000 + 500 * i, 100 + 5 * i))
  f.aoLinha(VENTO)
  for (let i = 0; i < 10; i++) f.aoLinha(mov(n0 + i, q))
}

const perto = (v, esperado, folga = 1e-5) => assert.ok(typeof v === 'number' && Math.abs(v - esperado) < folga, `${v} não é ${esperado}`)

function estado (p) {
  const rotas = {}
  p.registerWithRouter({ get: (r, h) => { rotas[r] = h } })
  let e
  rotas['/estado']({}, { json: (j) => { e = j } })
  return e
}

test('linhas → valores, a 1 e a 2 por segundo', (t) => {
  const { app, f, p } = arrancar(t)
  assert.equal(f.porta, 'auto')
  umSegundoBom(f)
  t.mock.timers.tick(500)
  // ao meio segundo já saíram a atitude e a proa; o resto sai ao segundo
  perto(app.valores['navigation.attitude'].roll, 0.3490, 0.001)
  assert.equal('navigation.speedThroughWater' in app.valores, false)
  t.mock.timers.tick(500)
  perto(app.valores['navigation.speedThroughWater'], 1.028888)
  perto(app.valores['environment.wind.angleApparent'], 0.610865)
  perto(app.valores['environment.wind.speedApparent'], 7.202216)
  const a = app.valores['navigation.attitude']
  assert.deepEqual(Object.keys(a).sort(), ['pitch', 'roll', 'yaw'])
  perto(a.roll, 0.3490, 0.001)
  perto(a.pitch, 0, 0.001)
  const proa = app.valores['navigation.headingMagnetic']
  assert.ok(Math.min(proa, 2 * Math.PI - proa) < 1e-6, `proa ${proa}`)
  assert.equal(a.yaw, proa)
  assert.equal(app.valores['arlequin.caixas.log.impulsos'], 120)
  assert.equal(app.valores['arlequin.caixas.log.hz'], 10)
  assert.equal(app.valores['arlequin.caixas.vento.angulo'], 35)
  perto(app.valores['arlequin.caixas.vento.velocidade'], 7.202216)
  perto(app.valores['arlequin.caixas.atitude.precisao'], 0.0349)
  assert.equal(app.valores['arlequin.caixas.atitude.estado'], 3)
  assert.equal(app.valores['arlequin.caixas.1.estado'], 'a-receber')
  assert.equal(app.valores['arlequin.caixas.2.estado'], 'a-receber')
  assert.equal(app.valores['arlequin.caixas.1.fw'], '0.1.0')
  assert.equal(app.valores['arlequin.caixas.2.fw'], '0.1.0')
  assert.equal(app.valores['arlequin.caixas.1.perdidos'], 0)
  assert.equal(app.valores['arlequin.caixas.2.perdidos'], 0)
  assert.equal(app.valores['arlequin.caixas.2.rssi'], -58)
  const m = app.valores['arlequin.caixas.movimento']
  assert.deepEqual(m.n, [1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051])
  assert.deepEqual(m.q[0], [0, 1736, 0, 9848])
  assert.deepEqual(m.a[9], [512, -2980, 9320])
  assert.ok(app.fontes.length > 0 && app.fontes.every(s => s === undefined), 'nenhuma atualização marcada como simulada')
  assert.equal(app.estados.at(-1), 'COM7 · caixa 1 a receber · caixa 2 a receber · 18 linhas · 0 inválidas · 0 leituras em falta')
  assert.deepEqual(app.erros, [])
  assert.deepEqual(app.notificacoes, [])
  p.stop()
})

test('o bloco do movimento sai uma vez por segundo, só com as leituras desse segundo', (t) => {
  const { app, f, p } = arrancar(t)
  const blocos = []
  const handle = app.handleMessage
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) if (v.path === 'arlequin.caixas.movimento') blocos.push(v.value); handle(id, d) }
  umSegundoBom(f)
  t.mock.timers.tick(1000)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 3; i++) f.aoLinha(mov(1052 + i))
  t.mock.timers.tick(1000)
  f.aoLinha(batimento(1))
  t.mock.timers.tick(1000) // um segundo sem leituras: não sai bloco nenhum
  p.stop()
  assert.deepEqual(blocos.map(b => b.n.length), [10, 3])
  assert.deepEqual(blocos[1].n, [1052, 1053, 1054])
})

test('a montagem e os desvios vêm da configuração', (t) => {
  const { app, f, p } = arrancar(t, { eixoProa: '+x', desvioProa: 5, nosPorHz: 0.25, desvioVento: -5, fatorVento: 1.1, desvioAdorno: 2, desvioCaimento: -1 })
  umSegundoBom(f, { q: [0, 0, 7071, 7071] }) // o sensor rodado 90° para a esquerda: o eixo x a apontar a norte
  t.mock.timers.tick(1000)
  p.stop()
  perto(app.valores['navigation.headingMagnetic'], 5 * GRAU)
  perto(app.valores['navigation.speedThroughWater'], 1.28611)
  perto(app.valores['environment.wind.angleApparent'], 30 * GRAU)
  perto(app.valores['environment.wind.speedApparent'], 7.202216 * 1.1)
  perto(app.valores['navigation.attitude'].roll, -2 * GRAU, 0.001)
  perto(app.valores['navigation.attitude'].pitch, 1 * GRAU, 0.001)
  // em bruto, o que a caixa mandou: sem desvios nem fatores
  assert.equal(app.valores['arlequin.caixas.vento.angulo'], 35)
  perto(app.valores['arlequin.caixas.vento.velocidade'], 7.202216)
})

const MEDIDAS = ['navigation.speedThroughWater', 'environment.wind.angleApparent', 'environment.wind.speedApparent', 'navigation.attitude', 'navigation.headingMagnetic']
const BRUTAS = ['arlequin.caixas.log.impulsos', 'arlequin.caixas.log.hz', 'arlequin.caixas.vento.angulo', 'arlequin.caixas.vento.velocidade', 'arlequin.caixas.atitude.precisao', 'arlequin.caixas.atitude.estado']

test('Review Focus 5: um sensor cala-se e o valor passa a null; volta sozinho', (t) => {
  const { app, f, p } = arrancar(t)
  umSegundoBom(f)
  t.mock.timers.tick(1000)
  for (let s = 0; s < 4; s++) { // até aos 5 s, só com batimentos: ainda vale tudo
    f.aoLinha(batimento(1))
    f.aoLinha(batimento(2))
    t.mock.timers.tick(1000)
  }
  for (const c of MEDIDAS) assert.notEqual(app.valores[c], null, `${c} aos 5 s`)
  f.aoLinha(batimento(1))
  f.aoLinha(batimento(2))
  t.mock.timers.tick(1000) // 6 s
  for (const c of [...MEDIDAS, ...BRUTAS]) assert.equal(app.valores[c], null, c)
  assert.equal(app.valores['arlequin.caixas.1.estado'], 'a-receber')
  assert.deepEqual(app.notificacoes, [])
  f.aoLinha(batimento(1))
  f.aoLinha(VENTO) // o mostrador do vento voltou
  t.mock.timers.tick(1000)
  p.stop()
  perto(app.valores['environment.wind.angleApparent'], 0.610865)
  perto(app.valores['environment.wind.speedApparent'], 7.202216)
  assert.equal(app.valores['arlequin.caixas.vento.angulo'], 35)
  for (const c of ['navigation.speedThroughWater', 'navigation.attitude', 'navigation.headingMagnetic', 'arlequin.caixas.log.hz', 'arlequin.caixas.atitude.estado']) assert.equal(app.valores[c], null, c)
})

test('Review Focus 5: o portátil acorda horas depois', (t) => {
  const { app, f, p } = arrancar(t)
  umSegundoBom(f)
  t.mock.timers.tick(1000)
  assert.notEqual(app.valores['navigation.speedThroughWater'], null)
  t.mock.timers.setTime(Date.now() + 3 * 3600 * 1000)
  t.mock.timers.tick(1000) // sem linhas
  for (const c of [...MEDIDAS, ...BRUTAS, 'arlequin.caixas.1.fw', 'arlequin.caixas.1.perdidos', 'arlequin.caixas.2.fw', 'arlequin.caixas.2.rssi']) assert.equal(app.valores[c], null, c)
  assert.equal(app.valores['arlequin.caixas.1.estado'], 'sem-ligacao')
  assert.equal(app.valores['arlequin.caixas.2.estado'], 'sem-ligacao')
  assert.equal(app.notificacoes.length, 1)
  const n = app.notificacoes[0]
  assert.equal(n.path, 'notifications.arlequin.caixas.caixa1')
  assert.equal(n.state, 'warn')
  assert.deepEqual(n.method, ['visual', 'sound'])
  assert.equal(n.apito, 'curto')
  assert.match(n.message, /^A caixa dos instrumentos \(vento, velocidade, proa\) deixou de falar: a caixa não fala há \d+ s$/)
  assert.match(app.erros.at(-1), /a caixa não fala há \d+ s/)
  // a caixa volta a falar: os valores voltam e o aviso apaga-se, uma vez
  umSegundoBom(f, { n0: 5000 })
  t.mock.timers.tick(1000)
  p.stop()
  assert.notEqual(app.valores['navigation.speedThroughWater'], null)
  assert.deepEqual(app.notificacoes.map(x => x.state), ['warn', 'normal'])
  assert.equal('apito' in app.notificacoes[1], false)
})

test('sem o batimento da caixa 1 não se sabe se ela finge: nada sai como medição', (t) => {
  const { app, f, p } = arrancar(t)
  for (let i = 0; i < 5; i++) f.aoLinha(log(1000 + 500 * i, 100 + 5 * i))
  f.aoLinha(VENTO)
  for (let i = 0; i < 10; i++) f.aoLinha(mov(1042 + i))
  t.mock.timers.tick(1000)
  for (const c of [...MEDIDAS, ...BRUTAS]) assert.equal(app.valores[c], null, c)
  assert.equal('arlequin.caixas.movimento' in app.valores, false)
  assert.equal(app.valores['arlequin.caixas.1.estado'], 'sem-ligacao')
  f.aoLinha(batimento(1)) // fala: o que chegou há menos de 5 s passa a valer
  t.mock.timers.tick(1000)
  p.stop()
  perto(app.valores['navigation.speedThroughWater'], 1.028888)
  perto(app.valores['environment.wind.angleApparent'], 0.610865)
  assert.equal(app.valores['arlequin.caixas.1.estado'], 'a-receber')
})

test('a fingir: tudo sai marcado como simulado', (t) => {
  const { app, f, p } = arrancar(t)
  app.fontes.length = 0
  umSegundoBom(f, { sim: 1 })
  f.aoLinha(motor('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF'))
  t.mock.timers.tick(2000)
  assert.ok(app.fontes.length >= 4)
  assert.ok(app.fontes.every(s => s === SIMULADO), JSON.stringify(app.fontes))
  assert.match(app.estados.at(-1), / · A FINGIR$/)
  assert.equal(estado(p).sim, true)
  p.stop()

  // o ensaio em casa com a caixa verdadeira: ela não diz que finge, diz a configuração
  const b = montar({ ensaio: true })
  umSegundoBom(b.f)
  t.mock.timers.tick(6000) // a caixa cala-se: o aviso também sai marcado
  b.p.stop()
  assert.ok(b.app.fontes.length >= 8)
  assert.ok(b.app.fontes.every(s => s === SIMULADO), JSON.stringify(b.app.fontes))
  assert.deepEqual(b.app.notificacoes.map(x => x.state), ['warn', 'normal'])
})

// Revisão final (22/11/2026): a caixa do motor a fingir, com a dos instrumentos verdadeira.
test('a fingir: se só a caixa do motor finge, sai tudo marcado na mesma', (t) => {
  const { app, f, p } = arrancar(t)
  app.fontes.length = 0
  f.aoLinha(batimento(1))
  f.aoLinha(escrever('B', [2, 1000, '0.1.0', 1, -58, 0])) // a caixa 2 diz que finge
  f.aoLinha(motor('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF'))
  for (let i = 0; i < 5; i++) f.aoLinha(log(1000 + 500 * i, 100 + 5 * i))
  t.mock.timers.tick(1000)
  p.stop()
  assert.ok(app.fontes.length >= 2)
  assert.ok(app.fontes.every(s => s === SIMULADO), JSON.stringify(app.fontes))
  assert.match(app.estados.at(-1), / · A FINGIR$/)
})

// Revisão final (22/11/2026): a proa saía como boa com o chip a dizer que não era de fiar (na bancada,
// antes de a bússola dele se acertar, dava "erro estimado 180°" e confiança 0). O adornamento e o
// caimento vêm da gravidade e continuam a valer; a proa só sai com confiança e com o erro dentro do limite.
const movCom = (n, precisao, estado, q = [0, 1736, 0, 9848]) => escrever('M', [n, 10, 512, -2980, 9320, -12, 35, 4, ...q, precisao, estado])
function proaCom (t, opcoes, precisao, estado) {
  const { app, f, p } = arrancar(t, opcoes)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 10; i++) f.aoLinha(movCom(1 + i, precisao, estado))
  t.mock.timers.tick(1000)
  p.stop()
  return app
}

test('a proa não se publica quando o sensor diz que a bússola não é de fiar', (t) => {
  const app = proaCom(t, {}, 31416, 0) // erro estimado 180°, confiança 0
  const v = app.valores
  assert.equal(v['navigation.headingMagnetic'], null)
  perto(v['navigation.attitude'].roll, 0.3490, 0.001)
  perto(v['navigation.attitude'].pitch, 0, 0.001)
  assert.equal(v['navigation.attitude'].yaw, null)
  assert.equal(v['arlequin.caixas.atitude.estado'], 0) // o que o sensor disse continua à vista
  perto(v['arlequin.caixas.atitude.precisao'], 3.1416)
  // e diz-se porquê, para ninguém ficar a olhar para um ecrã sem proa sem saber a razão
  assert.match(app.estados.at(-1), / · sem proa: o sensor ainda não confia na bússola dele$/)
})

test('a proa não se publica com o erro estimado acima do limite, mesmo com alguma confiança', (t) => {
  const app = proaCom(t, {}, 5000, 2) // 0,5 rad = 28,6°, acima dos 20° por omissão
  assert.equal(app.valores['navigation.headingMagnetic'], null)
  assert.equal(app.valores['navigation.attitude'].yaw, null)
  assert.match(app.estados.at(-1), / · sem proa: o sensor estima 29° de erro \(o limite é 20°\)$/)
})

test('a proa publica-se no limite do erro, sem queixa no estado', (t) => {
  const app = proaCom(t, {}, 3490, 1) // 0,349 rad = 20,0°, confiança baixa mas não nula
  assert.notEqual(app.valores['navigation.headingMagnetic'], null)
  assert.equal(app.valores['navigation.attitude'].yaw, app.valores['navigation.headingMagnetic'])
  assert.doesNotMatch(app.estados.at(-1), /sem proa/)
})

test('o limite do erro da proa vem da configuração', (t) => {
  const app = proaCom(t, { erroMaxProa: 45 }, 5000, 2)
  assert.notEqual(app.valores['navigation.headingMagnetic'], null)
})

test('sem leituras do sensor não há queixa da bússola: a proa falta por outra razão', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  t.mock.timers.tick(1000)
  p.stop()
  assert.equal(app.valores['navigation.headingMagnetic'], null)
  assert.doesNotMatch(app.estados.at(-1), /sem proa/)
})

test('motor: a trama segue para o plugin do motor com a hora do portátil', (t) => {
  const { app, f, p } = arrancar(t)
  const tramas = []
  app.on('arlequin-j1939', (l) => tramas.push(l))
  f.aoLinha(motor('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF'))
  t.mock.timers.tick(250)
  f.aoLinha(motor('(12.445678) can1 18FEEE00#7AFFFFFFFFFFFFFF') + '\r')
  p.stop()
  assert.deepEqual(tramas, [
    '(1727600000.000000) can1 0CF00400#FFFFFF004BFFFFFF',
    '(1727600000.250000) can1 18FEEE00#7AFFFFFFFFFFFFFF'
  ])
})

test('motor: uma linha sem soma, ou com a soma errada, não segue para o plugin do motor', (t) => {
  const { app, f, p } = arrancar(t)
  const tramas = []
  app.on('arlequin-j1939', (l) => tramas.push(l))
  f.aoLinha('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF')
  f.aoLinha('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF*00')
  f.aoLinha(motor('(12.345678) can1 0CF00400#FFFFFF004BFFFFFF').replace('4B', '4C')) // um byte trocado no cabo
  assert.deepEqual(tramas, [])
  assert.equal(estado(p).invalidas, 3)
  p.stop()
})

test('Review Focus 3: a caixa reinicia', (t) => {
  const { f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 10; i++) f.aoLinha(mov(5000 + i))
  for (let i = 0; i < 10; i++) f.aoLinha(mov(i)) // recomeçou: o número de ordem volta a zero
  t.mock.timers.tick(1000)
  assert.equal(estado(p).emFalta, 0)
  for (const n of [10, 11, 15]) f.aoLinha(mov(n)) // faltaram a 12, a 13 e a 14
  t.mock.timers.tick(1000)
  assert.equal(estado(p).emFalta, 3)
  assert.match(estado(p).caixas[1].estado, /a-receber/)
  p.stop()
})

test('Review Focus 4: lixo conta-se e não rebenta', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 50; i++) f.aoLinha(i % 2 ? `rst:0x1 (POWERON_RESET),boot:0x${i}` : `$AQL,${i},x,3*00`)
  t.mock.timers.tick(1000)
  const e = estado(p)
  p.stop()
  assert.equal(e.invalidas, 50)
  assert.equal(e.linhas, 1)
  assert.ok(app.registo <= 1, `${app.registo} mensagens no registo`)
  assert.match(app.estados.at(-1), /1 linhas · 50 inválidas/)
  assert.equal(e.ultimas.length, 20)
  assert.equal(e.ultimas.at(-1), 'rst:0x1 (POWERON_RESET),boot:0x49')
  assert.deepEqual(e.porta, { pedida: 'auto', aberta: true, nome: 'COM7' })
})

test('eixos paralelos: erro claro e a fonte não se abre', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: AGORA })
  for (const eixos of [{ eixoProa: '+z', eixoCima: '-z' }, { eixoProa: '+y', eixoCima: '+y' }, { eixoProa: 'proa' }]) {
    const app = appFalso()
    const f = fonteAFingir()
    const p = criar(app, { abrirFonte: f.abrirFonte })
    p.start(eixos)
    t.mock.timers.tick(3000)
    p.stop()
    assert.deepEqual(app.erros, ['o eixo da proa e o eixo de cima têm de ser diferentes e perpendiculares'])
    assert.equal(f.abertas, 0)
    assert.deepEqual(app.fontes, [])
  }
})

test('stop: fecha a fonte e apaga o aviso aceso', (t) => {
  const { app, f, p } = arrancar(t)
  umSegundoBom(f)
  t.mock.timers.tick(1000)
  f.aoEstado({ aberta: false, nome: 'COM7', motivo: 'o cabo USB saiu ou a placa desligou-se' })
  t.mock.timers.tick(6000)
  assert.deepEqual(app.notificacoes.map(n => n.state), ['warn'])
  assert.equal(app.notificacoes[0].message, 'A caixa dos instrumentos (vento, velocidade, proa) deixou de falar: a porta COM7 não abre: o cabo USB saiu ou a placa desligou-se')
  assert.equal(app.erros.at(-1), 'Sem a caixa dos instrumentos: a porta COM7 não abre: o cabo USB saiu ou a placa desligou-se')
  p.stop()
  assert.equal(f.fechadas, 1)
  assert.deepEqual(app.notificacoes.map(n => `${n.path}:${n.state}`), ['notifications.arlequin.caixas.caixa1:warn', 'notifications.arlequin.caixas.caixa1:normal'])
  const quantas = app.fontes.length
  t.mock.timers.tick(5000)
  f.aoLinha(batimento(1)) // uma linha atrasada depois do stop não mexe em nada
  assert.equal(app.fontes.length, quantas)
  p.stop() // parar duas vezes não faz mal
  assert.equal(f.fechadas, 1)
})

test('arrancar outra vez começa do zero', (t) => {
  const { app, f, p } = arrancar(t)
  umSegundoBom(f)
  for (let i = 0; i < 3; i++) f.aoLinha('lixo')
  t.mock.timers.tick(1000)
  p.stop()
  p.start({ porta: 'COM9' })
  assert.equal(f.abertas, 2)
  assert.equal(f.porta, 'COM9')
  const e = estado(p)
  assert.deepEqual([e.linhas, e.invalidas, e.emFalta, e.ultimas.length], [0, 0, 0, 0])
  t.mock.timers.tick(1000)
  p.stop()
  assert.equal(app.valores['navigation.speedThroughWater'], null)
})

// Com a segurança do SignalK ligada (2.33), uma rota sem router.access só aceita admin; o ecrã entra
// com uma conta "read/write". Os GET pedem "readonly" (auditoria K-11, contrato C2).
test('K-11: o GET /estado regista-se readonly', () => {
  const direto = []
  const registos = []
  const router = {
    get: (k) => direto.push(`GET ${k}`),
    post: (k) => direto.push(`POST ${k}`),
    access: (nivel) => ({
      get: (k, h) => registos.push({ m: 'GET', k, nivel, h: typeof h }),
      post: (k, h) => registos.push({ m: 'POST', k, nivel, h: typeof h })
    })
  }
  const p = criar(appFalso())
  assert.equal(p.id, 'signalk-arlequin-caixas')
  p.registerWithRouter(router)
  assert.deepEqual(direto, [], 'nenhuma rota sem nível (ficava só para admin)')
  assert.deepEqual(registos, [{ m: 'GET', k: '/estado', nivel: 'readonly', h: 'function' }])
})

test('a configuração: os valores por omissão do desenho', () => {
  const s = criar(appFalso()).schema.properties
  const omissao = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.default]))
  assert.deepEqual(omissao, {
    porta: 'auto',
    ensaio: false,
    nosPorHz: 0.2,
    desvioVento: 0,
    fatorVento: 1,
    eixoProa: '+y',
    eixoCima: '+z',
    desvioProa: 0,
    desvioAdorno: 0,
    desvioCaimento: 0,
    erroMaxProa: 20,
    tabelaDesvios: [],
    posicaoSensor: { vante: 0, estibordo: 0, acima: 0 },
    acelerometro: { desvio: [0, 0, 0], escala: [1, 1, 1] }
  })
  assert.deepEqual(s.eixoProa.enum, ['+x', '-x', '+y', '-y', '+z', '-z'])
})

// --- O sensor de movimento dito pela caixa 1 (programa das caixas de 23/11) --------------------------
const batimentoComSensor = (sensor, { arranque = 1, rsts = 0 } = {}) => escrever('B', [1, 1000, '0.2.0', 0, 0, 0, sensor, arranque, rsts])

test('sensor: o estado, o motivo do arranque e os toques no RST vão para o SignalK', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimentoComSensor(0, { arranque: 6, rsts: 2 }))
  t.mock.timers.tick(1000)
  assert.equal(app.valores['arlequin.caixas.1.sensor'], 'a-medir')
  assert.equal(app.valores['arlequin.caixas.1.arranque'], 6)
  assert.equal(app.valores['arlequin.caixas.1.sensorRsts'], 2)
  assert.deepEqual(app.notificacoes, [])
  p.stop()
})

test('sensor: "não volta" acende o aviso no ecrã e apaga-se quando volta a medir', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimentoComSensor(3, { rsts: 5 }))
  t.mock.timers.tick(1000)
  assert.equal(app.valores['arlequin.caixas.1.sensor'], 'nao-volta')
  assert.deepEqual(app.notificacoes.map(n => [n.path, n.state]), [['notifications.arlequin.caixas.sensor', 'warn']])
  assert.match(app.notificacoes[0].message, /sensor de movimento não responde/)
  assert.equal(app.notificacoes[0].apito, 'curto')
  f.aoLinha(batimentoComSensor(0, { rsts: 6 }))
  t.mock.timers.tick(1000)
  assert.deepEqual(app.notificacoes.map(n => n.state), ['warn', 'normal'])
  p.stop()
})

test('sensor: uma caixa que não diz nada do sensor deixa os três caminhos a null, sem aviso', (t) => {
  const { app, f, p } = arrancar(t)
  umSegundoBom(f)
  t.mock.timers.tick(1000)
  assert.equal(app.valores['arlequin.caixas.1.sensor'], null)
  assert.equal(app.valores['arlequin.caixas.1.arranque'], null)
  assert.equal(app.valores['arlequin.caixas.1.sensorRsts'], null)
  assert.deepEqual(app.notificacoes, [])
  p.stop()
})

test('sensor: ao parar o plugin, um aviso do sensor aceso apaga-se', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimentoComSensor(3))
  t.mock.timers.tick(1000)
  p.stop()
  assert.deepEqual(app.notificacoes.filter(n => n.path.endsWith('.sensor')).map(n => n.state), ['warn', 'normal'])
})

// --- As cópias da ponte USB das placas ---------------------------------------------------------------
// Visto a 23/11/2026 neste portátil, com duas bibliotecas de porta série: ao abrir a porta depois de uns
// segundos fechada, com a caixa a mandar poucas linhas, chegam até 200 KB de cópias das últimas linhas no
// primeiro segundo, mais depressa do que o fio consegue levar. São linhas válidas, só que repetidas.
test('cópias da ponte USB: uma linha igual à anterior, chegada logo a seguir, não conta', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 3000; i++) f.aoLinha(log(1000, 100))
  for (let i = 0; i < 2000; i++) f.aoLinha(mov(1042))
  t.mock.timers.tick(1000)
  const e = estado(p)
  assert.equal(e.linhas, 3, 'o batimento, uma linha do log e uma do movimento')
  assert.equal(e.repetidas, 4998)
  assert.equal(e.invalidas, 0)
  assert.equal(e.emFalta, 0)
  assert.deepEqual(app.valores['arlequin.caixas.movimento'].n, [1042], 'o bloco do movimento leva a leitura uma vez só')
  assert.match(app.estados.at(-1), / · 4998 cópias deitadas fora/)
  p.stop()
})

test('cópias da ponte USB: as cópias podem chegar espalhadas por um segundo inteiro', (t) => {
  const { f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  for (let i = 0; i < 100; i++) { f.aoLinha(log(1000, 100)); t.mock.timers.tick(10) } // uma cópia de 10 em 10 ms
  assert.equal(estado(p).repetidas, 99)
  assert.equal(estado(p).linhas, 2)
  p.stop()
})

test('cópias da ponte USB: a mesma frase do vento um segundo depois é vento novo, não é cópia', (t) => {
  const { app, f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  f.aoLinha(VENTO)
  t.mock.timers.tick(1000)
  f.aoLinha(batimento(1))
  f.aoLinha(VENTO)
  t.mock.timers.tick(100)
  f.aoLinha(VENTO) // 100 ms depois, sem outra linha pelo meio: o mostrador pode mandar assim
  t.mock.timers.tick(900)
  const e = estado(p)
  assert.equal(e.repetidas, 0)
  assert.equal(e.linhas, 5)
  perto(app.valores['environment.wind.angleApparent'], 0.610865)
  assert.doesNotMatch(app.estados.at(-1), /cópias/)
  p.stop()
})

// Para se saber, no barco, que cara têm as linhas que chegam estragadas (ensaio geral de 23/11/2026: 6 em
// 22 000, em grupos de 3, sem se saber de que tipo eram).
test('as últimas linhas inválidas ficam guardadas, com a hora, para se verem no /estado', (t) => {
  const { f, p } = arrancar(t)
  f.aoLinha(batimento(1))
  assert.deepEqual(estado(p).ultimasInvalidas, [])
  for (let i = 0; i < 14; i++) {
    f.aoLinha(`$AQM,${i},estragada*00`)
    t.mock.timers.tick(100)
  }
  const e = estado(p)
  assert.equal(e.invalidas, 14)
  assert.equal(e.ultimasInvalidas.length, 10, 'ficam as últimas 10')
  assert.deepEqual(e.ultimasInvalidas[0], { hora: new Date(AGORA + 400).toISOString(), linha: '$AQM,4,estragada*00' })
  assert.equal(e.ultimasInvalidas.at(-1).linha, '$AQM,13,estragada*00')
  f.aoLinha('x'.repeat(300)) // uma linha enorme guarda-se cortada
  assert.equal(estado(p).ultimasInvalidas.at(-1).linha.length, 120)
  p.stop()
})
