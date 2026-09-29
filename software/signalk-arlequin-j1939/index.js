'use strict'
// Plugin SignalK: motor Volvo Penta D1-20B pelo J1939 do MDI (só escuta).
// Fonte: candump -L no Pi, ou o simulador (evento 'arlequin-j1939') no portátil.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { lerLinha, descodificar } = require('./lib/j1939')
const { litrosHora, m3s } = require('./lib/consumo')
const { novoEstadoMotor, avaliarMotor } = require('./lib/motor')
const { novaDescoberta, registar, alarmesDoMapa } = require('./lib/descoberta')

const RPM_VELHO = 5000 // sem EEC1 há 5 s = motor parado (ignição desligada)

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-j1939',
    name: 'Arlequin · motor J1939',
    description: 'Rotações, horas, temperatura, tensão e alarmes do MDI do Volvo Penta D1-20B (só escuta)'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      fonte: { type: 'string', title: 'Fonte das tramas', enum: ['candump', 'simulador'], default: 'candump' },
      interface: { type: 'string', title: 'Interface CAN do motor (NUNCA a da rede NMEA 2000)', default: 'can1' },
      estimarConsumo: { type: 'boolean', title: 'Estimar o consumo pelas rotações (curva Volvo Penta)', default: true },
      fatorConsumo: { type: 'number', title: 'Fator de calibração do consumo (medir com o depósito)', default: 1 },
      mapaAlarmes: {
        type: 'array',
        title: 'Alarmes do MDI (PGN 65417): byte e bit de cada alarme, depois da descoberta',
        default: [],
        items: {
          type: 'object',
          properties: {
            byte: { type: 'number', title: 'Byte (0–7)' },
            bit: { type: 'number', title: 'Bit (0–7)' },
            id: { type: 'string', title: 'ID SignalK (ex.: lowOilPressure)' },
            mensagem: { type: 'string', title: 'Mensagem' },
            estado: { type: 'string', enum: ['alarm', 'warn'], default: 'alarm' }
          }
        }
      }
    }
  }

  let o = {}
  let proc = null
  let religar = null
  let temporizador = null
  let ouvinte = null
  let valores = {} // caminho → valor (último)
  let estado, desc, ativosMapa, rpmEm, rpmAtual, ficheiroDesc, vistasTotal

  function aoReceber (linha) {
    const t = lerLinha(linha)
    if (!t) return
    vistasTotal++
    for (const v of descodificar(t.pgn, t.dados)) valores[v.path] = v.value
    if (t.pgn === 61444 && typeof valores['propulsion.main.revolutions'] === 'number') {
      rpmEm = Date.now()
      rpmAtual = valores['propulsion.main.revolutions'] * 60
    }
    const r = registar(desc, t, rpmAtual)
    desc = r.d
    if (r.mudou) {
      fs.appendFile(ficheiroDesc, JSON.stringify(r.mudou) + '\n', () => {})
      app.debug(`PGN ${r.mudou.pgn} mudou: ${r.mudou.bytes} ${r.mudou.bitsMudados.join(', ')}`)
    }
    if (t.pgn === 65417 && o.mapaAlarmes?.length) {
      const m = alarmesDoMapa(o.mapaAlarmes, t.dados, ativosMapa)
      ativosMapa = m.ativos
      publicarNotificacoes(m.notificacoes)
    }
  }

  function publicarNotificacoes (ns) {
    if (!ns.length) return
    app.handleMessage(plugin.id, {
      updates: [{ values: ns.map(n => ({ path: `notifications.propulsion.main.${n.id}`, value: { state: n.state, method: n.method, message: n.message } })) }]
    })
  }

  // A 1 Hz: publica os valores, o estado, o consumo estimado e os alarmes calculados.
  function publicar () {
    const agora = Date.now()
    if (agora - rpmEm > RPM_VELHO) { valores['propulsion.main.revolutions'] = 0; rpmAtual = 0 }
    const rpm = (valores['propulsion.main.revolutions'] ?? 0) * 60
    const r = avaliarMotor(estado, { rpm, temp: valores['propulsion.main.temperature'], volt: valores['propulsion.main.alternatorVoltage'] }, agora)
    estado = r.estado
    const vals = Object.entries(valores).map(([p, value]) => ({ path: p, value }))
    // Consumo: o real (PGN 65266) se o MDI o mandar; senão, a estimativa pelas rotações.
    if (o.estimarConsumo && !('propulsion.main.fuel.rate' in valores)) {
      vals.push({ path: 'propulsion.main.fuel.rate', value: m3s(litrosHora(rpm, o.fatorConsumo)) })
    }
    vals.push({ path: 'propulsion.main.state', value: estado.ligado ? 'started' : 'stopped' })
    app.handleMessage(plugin.id, { updates: [{ values: vals }] })
    publicarNotificacoes(r.notificacoes)
    app.setPluginStatus(`${o.fonte} · ${vistasTotal} tramas · ${estado.ligado ? Math.round(rpm) + ' rpm' : 'parado'} · ${Object.keys(desc.vistas).length} PGN`)
  }

  function arrancarCandump () {
    proc = spawn('candump', ['-L', o.interface])
    let resto = ''
    proc.stdout.on('data', (b) => {
      const linhas = (resto + b.toString()).split('\n')
      resto = linhas.pop()
      linhas.forEach(aoReceber)
    })
    proc.stderr.on('data', (b) => app.setPluginError(`candump: ${b.toString().trim()}`))
    proc.on('error', (e) => app.setPluginError(`candump não arrancou (${e.message}). Instalar can-utils e configurar o ${o.interface}.`))
    proc.on('close', () => {
      proc = null
      religar = setTimeout(arrancarCandump, 5000) // religa de 5 em 5 s
    })
  }

  plugin.start = function (props) {
    o = { fonte: 'candump', interface: 'can1', estimarConsumo: true, fatorConsumo: 1, mapaAlarmes: [], ...props }
    valores = {}
    estado = novoEstadoMotor()
    desc = novaDescoberta()
    ativosMapa = {}
    rpmEm = 0
    rpmAtual = 0
    vistasTotal = 0
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiroDesc = path.join(dir, 'descoberta-65417.jsonl')
    if (o.fonte === 'simulador') {
      ouvinte = aoReceber
      app.on('arlequin-j1939', ouvinte)
    } else {
      arrancarCandump()
    }
    temporizador = setInterval(publicar, 1000)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    if (religar) clearTimeout(religar)
    if (ouvinte) app.removeListener('arlequin-j1939', ouvinte)
    ouvinte = null
    if (proc) { proc.removeAllListeners('close'); proc.kill() }
    proc = null
  }

  // Diagnóstico: PGN vistas e mudanças da 65417 (JSON e página simples).
  // A página fica em /pagina porque o SignalK usa a raiz /plugins/<id>/ para si.
  plugin.registerWithRouter = function (router) {
    const diag = () => {
      let mudancas = []
      try { mudancas = fs.readFileSync(ficheiroDesc, 'utf8').trim().split('\n').filter(Boolean).slice(-50).map(l => JSON.parse(l)) } catch { }
      const vistas = Object.entries(desc?.vistas || {}).map(([pgn, v]) => ({ pgn: Number(pgn), n: v.n, origem: v.origem, bytes: v.bytes }))
      return { fonte: o.fonte, tramas: vistasTotal, rpm: Math.round(rpmAtual || 0), vistas, mudancas: mudancas.reverse() }
    }
    router.get('/diagnostico', (req, res) => res.json(diag()))
    router.get('/pagina', (req, res) => {
      const d = diag()
      const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      res.type('html').send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Arlequin · J1939</title>
<style>body{font:16px Arial;background:#0f1114;color:#e8eaed;margin:1rem}td,th{padding:.3rem .6rem;border-bottom:1px solid #333;text-align:left}code{color:#fac775}h2{margin-top:1.5rem}</style>
<h1>Motor · J1939 (${esc(d.fonte)})</h1><p>${d.tramas} tramas · ${d.rpm} rpm</p>
<h2>PGN vistas</h2><table><tr><th>PGN</th><th>Origem</th><th>N</th><th>Últimos bytes</th></tr>${d.vistas.map(v => `<tr><td>${v.pgn}</td><td>${v.origem}</td><td>${v.n}</td><td><code>${esc(v.bytes)}</code></td></tr>`).join('')}</table>
<h2>Mudanças nas PGN proprietárias (65417 = alarmes do MDI)</h2><p>Teste: ignição ligada com o motor parado acende os alarmes de óleo e de carga. Liga o motor e vê que bits apagam.</p>
<table><tr><th>Hora</th><th>PGN</th><th>rpm</th><th>Bytes</th><th>Bits que mudaram</th></tr>${d.mudancas.map(m => `<tr><td>${new Date(m.t).toLocaleTimeString('pt-PT')}</td><td>${m.pgn}</td><td>${m.rpm ?? ''}</td><td><code>${esc(m.bytes)}</code></td><td>${esc(m.bitsMudados.join(', '))}</td></tr>`).join('')}</table>`)
    })
  }

  return plugin
}
