'use strict'
// F6b (revisão F6, Importante 3; contrato C11): o estado da ligação do motor.
// propulsion.main.ligacao = 'a-receber' (uma trama há menos de 5 s) | 'calado' (a interface CAN de pé, o
// candump a correr e nenhuma trama há mais de 5 s: a ignição desligada) | 'sem-ligacao' (a interface em
// baixo ou que não existe, ou o candump parado/a falhar). A interface vê-se pelo Linux
// (/sys/class/net/<if>/operstate); nos testes, um candump e uma interface falsos.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { linhaCandump } = require('../lib/j1939')

const hex = (s) => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)))

function appFalso () {
  const app = new EventEmitter()
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-j1939-lig-'))
  app.valores = {}
  app.notificacoes = []
  app.ligacoes = []
  app.erros = []
  app.estados = []
  app.getDataDirPath = () => app.dir
  app.handleMessage = (id, d) => {
    for (const u of d.updates) {
      for (const v of u.values) {
        if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value })
        else app.valores[v.path] = v.value
        if (v.path === 'propulsion.main.ligacao') app.ligacoes.push(v.value)
      }
    }
  }
  app.setPluginStatus = (s) => { app.estados.push(s) }
  app.setPluginError = (e) => { app.erros.push(e) }
  app.debug = () => {}
  return app
}
const enviar = (app, pgn, dados) => app.emit('arlequin-j1939', linhaCandump({ t: Date.now(), pgn, dados: hex(dados) }))
const segundos = (t, n) => { for (let s = 0; s < n; s++) t.mock.timers.tick(1000) }
const semLigacao = (app) => app.notificacoes.filter(n => n.path === 'notifications.propulsion.main.semLigacao')

// Um candump falso: lancar (o spawn), procs (os lançados), trama (manda uma linha pelo stdout do último)
function candumpFalso () {
  const procs = []
  const lancar = (cmd, args) => {
    const proc = new EventEmitter()
    proc.cmd = cmd
    proc.args = args
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = () => { proc.morto = true }
    procs.push(proc)
    return proc
  }
  const ultimo = () => procs.at(-1)
  const trama = (pgn, dados) => ultimo().stdout.emit('data', Buffer.from(linhaCandump({ t: Date.now(), pgn, dados: hex(dados) }) + '\n'))
  return { lancar, procs, ultimo, trama }
}
// A interface CAN como o Linux a mostra; muda-se a meio do teste.
function interfaceFalsa (estado = { existe: true, ativa: true }) {
  const i = { estado }
  i.ler = (nome) => { i.lida = nome; return i.estado }
  return i
}
function comCandump (t, estadoInterface) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const c = candumpFalso()
  const i = interfaceFalsa(estadoInterface)
  const p = criar(app, { spawn: c.lancar, lerInterface: i.ler })
  p.start({ fonte: 'candump', interface: 'can1' })
  return { app, c, i, p }
}

test('C11 (simulador): com tramas "a-receber"; sem tramas há 5 s "calado"; nos primeiros 5 s sem tramas ainda não se diz', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  segundos(t, 4)
  assert.deepEqual(app.ligacoes, [], 'sem tramas desde o arranque, os primeiros 5 s não dizem nada')
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  segundos(t, 1)
  assert.equal(app.valores['propulsion.main.ligacao'], 'a-receber')
  segundos(t, 6)
  p.stop()
  assert.equal(app.valores['propulsion.main.ligacao'], 'calado')
  assert.equal(app.valores['propulsion.main.revolutions'], null)
  assert.deepEqual(semLigacao(app), [], 'no simulador nunca há "sem ligação"')
})

test('C11 (candump): a interface de pé, o candump a correr e sem tramas há 5 s: "calado" (ignição desligada), sem aviso', (t) => {
  const { app, c, i, p } = comCandump(t)
  assert.deepEqual([c.procs[0].cmd, c.procs[0].args], ['candump', ['-L', 'can1']])
  c.trama(61444, 'FFFFFF004BFFFFFF')
  segundos(t, 1)
  assert.equal(app.valores['propulsion.main.ligacao'], 'a-receber')
  segundos(t, 7)
  p.stop()
  assert.equal(app.valores['propulsion.main.ligacao'], 'calado')
  assert.equal(i.lida, 'can1')
  assert.deepEqual(semLigacao(app), [])
  assert.deepEqual(app.erros, [])
  assert.equal(app.valores['propulsion.main.state'], 'stopped')
  assert.match(app.estados.at(-1), /calado \(ignição desligada\)/)
})

test('C11 (candump): a interface que não existe ou em baixo: "sem-ligacao", aviso .semLigacao (warn, apito curto) e o estado do plugin diz porquê', (t) => {
  const { app, c, i, p } = comCandump(t)
  c.trama(61444, 'FFFFFF004BFFFFFF')
  segundos(t, 1)
  i.estado = { existe: false, ativa: false } // o adaptador USB-CAN soltou-se
  segundos(t, 7)
  assert.equal(app.valores['propulsion.main.ligacao'], 'sem-ligacao')
  const aviso = semLigacao(app)
  assert.deepEqual(aviso.map(n => n.state), ['warn'])
  assert.equal(aviso[0].apito, 'curto')
  assert.deepEqual(aviso[0].method, ['visual', 'sound'])
  assert.match(aviso[0].message, /^Sem leitura do motor \(J1939\): a interface can1 não existe/)
  assert.match(app.erros.at(-1), /can1 não existe \(adaptador USB-CAN solto\?\)/)
  // a interface volta, mas em baixo (ip link set can1 down): continua sem ligação, com o outro motivo
  i.estado = { existe: true, ativa: false }
  segundos(t, 1)
  assert.match(app.erros.at(-1), /can1 está em baixo/)
  p.stop()
  assert.equal(app.valores['propulsion.main.revolutions'], null)
})

test('C11 (candump): o candump a sair ou a não arrancar: "sem-ligacao" com o erro dele (o estado de cada segundo já não o apaga); religa e, com tramas, o aviso passa a normal', (t) => {
  const { app, c, p } = comCandump(t)
  c.ultimo().stderr.emit('data', Buffer.from('read: Network is down\n'))
  c.ultimo().emit('close', 1)
  segundos(t, 6)
  assert.equal(app.valores['propulsion.main.ligacao'], 'sem-ligacao')
  assert.match(app.erros.at(-1), /candump: read: Network is down/)
  assert.ok(c.procs.length >= 2, 'religou de 5 em 5 s')
  c.ultimo().emit('error', new Error('spawn candump ENOENT'))
  segundos(t, 1)
  assert.match(app.erros.at(-1), /candump não arrancou \(spawn candump ENOENT\)/)
  segundos(t, 5)
  assert.ok(c.procs.length >= 3, 'também religa depois de não arrancar')
  c.trama(61444, 'FFFFFF004BFFFFFF')
  segundos(t, 1)
  p.stop()
  assert.equal(app.valores['propulsion.main.ligacao'], 'a-receber')
  assert.deepEqual(semLigacao(app).map(n => n.state), ['warn', 'normal'])
  assert.ok(c.procs.every(x => x.morto || x !== c.ultimo()), 'o stop() mata o candump')
})

test('C11: o aviso .semLigacao não oscila — com a interface de volta e sem tramas, só limpa com 30 s seguidos de "calado"', (t) => {
  const { app, i, p } = comCandump(t, { existe: true, ativa: false })
  segundos(t, 7)
  assert.deepEqual(semLigacao(app).map(n => n.state), ['warn'])
  i.estado = { existe: true, ativa: true } // a interface volta, mas o motor está desligado (sem tramas)
  segundos(t, 20)
  assert.deepEqual(semLigacao(app).map(n => n.state), ['warn'], '20 s de "calado" ainda não chegam')
  segundos(t, 11)
  p.stop()
  assert.deepEqual(semLigacao(app).map(n => n.state), ['warn', 'normal'])
})

test('C11: sem ligação, o sobreaquecimento ativo fica (não se sabe) e o consumo estimado é desconhecido (null, não 0)', (t) => {
  const { app, c, i, p } = comCandump(t)
  c.trama(61444, 'FFFFFF004BFFFFFF') // 2400 rpm
  c.trama(65262, '87FFFFFFFFFFFFFF') // 95 °C
  segundos(t, 1)
  i.estado = { existe: false, ativa: false }
  segundos(t, 7)
  const sobre = app.notificacoes.filter(n => n.path.endsWith('.overTemperature')).map(n => n.state)
  p.stop()
  assert.deepEqual(sobre, ['alarm'], 'ficou ativo')
  assert.equal(app.valores['propulsion.main.fuel.rate'], null)
  assert.equal(app.valores['propulsion.main.fuel.rateOrigem'], 'estimado')
})

test('C11: com o MDI calado (ignição desligada) o consumo estimado é 0 e o sobreaquecimento volta a normal', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_727_600_000_000 })
  const app = appFalso()
  const p = criar(app)
  p.start({ fonte: 'simulador' })
  enviar(app, 61444, 'FFFFFF004BFFFFFF')
  enviar(app, 65262, '87FFFFFFFFFFFFFF') // 95 °C
  segundos(t, 8)
  const sobre = app.notificacoes.filter(n => n.path.endsWith('.overTemperature')).map(n => n.state)
  p.stop()
  assert.equal(app.valores['propulsion.main.ligacao'], 'calado')
  assert.equal(app.valores['propulsion.main.fuel.rate'], 0)
  assert.deepEqual(sobre, ['alarm', 'normal'])
})

// A interface como o Linux a mostra (/sys/class/net/<if>/operstate e flags): numa pasta falsa.
function sysFalso (interfaces) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-j1939-sys-'))
  for (const [nome, { operstate, flags }] of Object.entries(interfaces)) {
    fs.mkdirSync(path.join(base, nome))
    fs.writeFileSync(path.join(base, nome, 'operstate'), operstate + '\n')
    if (flags !== undefined) fs.writeFileSync(path.join(base, nome, 'flags'), flags + '\n')
  }
  return base
}

test('C11: a interface pelo Linux — não existe, em baixo (desligada ou bus-off), de pé ("up", ou "unknown" com IFF_UP)', () => {
  const { lerInterface } = require('../lib/ligacao')
  const base = sysFalso({
    can1: { operstate: 'up', flags: '0x40081' },
    can2: { operstate: 'down', flags: '0x40080' }, // ip link set can2 down
    can3: { operstate: 'down', flags: '0x40081' }, // de pé mas sem "carrier" (bus-off)
    vcan0: { operstate: 'unknown', flags: '0xc1' }, // virtual, de pé
    vcan1: { operstate: 'unknown', flags: '0xc0' }, // virtual, em baixo
    can4: { operstate: 'up' } // sem o ficheiro das flags: só o operstate
  })
  assert.deepEqual(lerInterface('can1', base), { existe: true, ativa: true, estado: 'up' })
  assert.deepEqual(lerInterface('can2', base), { existe: true, ativa: false, estado: 'down' })
  assert.deepEqual(lerInterface('can3', base), { existe: true, ativa: false, estado: 'down' })
  assert.deepEqual(lerInterface('vcan0', base), { existe: true, ativa: true, estado: 'unknown' })
  assert.deepEqual(lerInterface('vcan1', base), { existe: true, ativa: false, estado: 'unknown' })
  assert.deepEqual(lerInterface('can4', base), { existe: true, ativa: true, estado: 'up' })
  assert.deepEqual(lerInterface('can9', base), { existe: false, ativa: false, estado: null })
  // um nome que não é de interface nunca vira um caminho
  for (const mau of ['../can1', '..', 'can1/../can1', '', null]) assert.equal(lerInterface(mau, base).existe, false, String(mau))
})

test('C11: as tramas valem mais do que a interface; um candump acabado de relançar só confirma "calado" aos 5 s', () => {
  const { avaliarLigacao } = require('../lib/ligacao')
  const de = { existe: true, ativa: true, estado: 'up' }
  const s = (o) => ({ agora: 100_000, ultimaTrama: -Infinity, simulador: false, ouvirDesde: 0, candumpVivo: true, lerInterface: () => de, anterior: null, motivoCandump: null, nome: 'can1', ...o })
  // uma trama há 3 s: a receber, mesmo com o Linux a dizer que a interface está em baixo
  assert.equal(avaliarLigacao(s({ ultimaTrama: 97_000, lerInterface: () => ({ existe: true, ativa: false, estado: 'down' }) })).ligacao, 'a-receber')
  assert.equal(avaliarLigacao(s({})).ligacao, 'calado')
  assert.deepEqual(avaliarLigacao(s({ candumpVivo: false, motivoCandump: 'candump: read: Network is down' })), { ligacao: 'sem-ligacao', motivo: 'candump: read: Network is down' })
  // relançado há 2 s: quem estava sem ligação continua; no arranque ainda não se sabe
  assert.equal(avaliarLigacao(s({ ouvirDesde: 98_000, anterior: 'sem-ligacao' })).ligacao, 'sem-ligacao')
  assert.equal(avaliarLigacao(s({ ouvirDesde: 98_000, anterior: null })).ligacao, null)
  // no simulador nunca há "sem ligação" (nem se lê a interface)
  assert.equal(avaliarLigacao(s({ simulador: true, candumpVivo: false, lerInterface: () => { throw new Error('não se lê') } })).ligacao, 'calado')
  assert.equal(avaliarLigacao(s({ simulador: true, ouvirDesde: 97_000 })).ligacao, null)
})
