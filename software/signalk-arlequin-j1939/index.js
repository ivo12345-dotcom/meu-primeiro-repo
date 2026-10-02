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
const { criarDetetor, estavel, novaCurva, amostra, resumo } = require('./lib/curva')

// Cada caminho guarda a hora da última trama que o trouxe com um valor (vistoEm). Sem ele há mais de
// 5 s — a PGN deixou de chegar ou chega com o campo "sem dado" — o caminho passa a desconhecido (null),
// nunca um valor velho como se fosse atual (auditoria K-07). Tanto pode ser a ignição desligada (a ECU
// cala-se) como o adaptador USB-CAN solto ou o candump em baixo.
//   - Rotações: null, nunca 0; quem lê trata null como "motor não está a trabalhar", mas a AI não pode
//     ler isto como "à vela" (ver arlequin-ia/treino.py). O estado do motor fica "stopped".
//   - Consumo medido (PGN 65266): deixa de ser "medido" e passa a "estimado" pela curva, como sem
//     medição nenhuma.
//   - Horas do motor (PGN 65253): não passam a null nem se republicam; o valor não muda com o motor
//     parado e a hora dele na árvore envelhece (assim o contador da energia não as substitui).
//   - Alarmes do mapa do MDI (PGN 65417): limpam (o MDI deixou de os dizer). O sobreaquecimento
//     calculado aqui não limpa só por faltar a temperatura (fica até haver uma leitura normal).
const VELHO = 5000
const REV = 'propulsion.main.revolutions'
const CONSUMO = 'propulsion.main.fuel.rate'
const HORAS = 'propulsion.main.runTime'
const MAPA = 'pgn:65417'

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
  let vistoEm = {} // caminho → hora da última trama que o trouxe com valor; MAPA → a da última 65417
  let estado, desc, ativosMapa, rpmAtual, ficheiroDesc, vistasTotal
  let detetor, curva, ficheiroCurva, ultimaGravacao
  let mudancas = [] // últimas 50 mudanças das PGN proprietárias (o ficheiro guarda todas)

  const fresco = (p, agora) => agora - (vistoEm[p] ?? -Infinity) <= VELHO

  function aoReceber (linha) {
    const t = lerLinha(linha)
    if (!t) return
    vistasTotal++
    const agora = Date.now()
    for (const v of descodificar(t.pgn, t.dados)) {
      valores[v.path] = v.value
      vistoEm[v.path] = agora
      if (v.path === REV) rpmAtual = v.value * 60
    }
    if (t.pgn === 65417) vistoEm[MAPA] = agora
    const r = registar(desc, t, rpmAtual)
    desc = r.d
    if (r.mudou) {
      mudancas = [...mudancas.slice(-49), r.mudou]
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
      updates: [{ values: ns.map(n => ({ path: `notifications.propulsion.main.${n.id}`, value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) } })) }]
    })
  }

  // A 1 Hz: publica os valores, o estado, o consumo estimado e os alarmes calculados.
  function publicar () {
    const agora = Date.now()
    // os caminhos velhos (sem trama com valor há mais de 5 s): ver o cabeçalho (auditoria K-07)
    for (const p of Object.keys(valores)) {
      if (fresco(p, agora)) continue
      if (p === CONSUMO) delete valores[p]
      else if (p !== HORAS) valores[p] = null
    }
    if (!fresco(REV, agora)) { valores[REV] = null; rpmAtual = 0 } // também desde o arranque: null, nunca 0
    if (Object.keys(ativosMapa).length && !fresco(MAPA, agora)) {
      publicarNotificacoes(Object.keys(ativosMapa).map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
      ativosMapa = {}
    }
    const rpm = (valores[REV] ?? 0) * 60
    const r = avaliarMotor(estado, { rpm, temp: valores['propulsion.main.temperature'], volt: valores['propulsion.main.alternatorVoltage'] }, agora)
    estado = r.estado
    const vals = Object.entries(valores)
      .filter(([p]) => p !== HORAS || fresco(p, agora))
      .map(([p, value]) => ({ path: p, value }))
    // Consumo: o real (PGN 65266) se o MDI o mandar; senão, a estimativa pelas rotações.
    // A origem vai em propulsion.main.fuel.rateOrigem ('medido' | 'estimado'): a AI só
    // aprende o consumo com o medido (a estimativa é a própria curva da Volvo × fator).
    if (CONSUMO in valores) {
      vals.push({ path: 'propulsion.main.fuel.rateOrigem', value: 'medido' })
    } else if (o.estimarConsumo) {
      vals.push({ path: CONSUMO, value: m3s(litrosHora(rpm, o.fatorConsumo)) })
      vals.push({ path: 'propulsion.main.fuel.rateOrigem', value: 'estimado' })
    }
    vals.push({ path: 'propulsion.main.state', value: estado.ligado ? 'started' : 'stopped' })

    // Curva aprendida: em regime estável, velocidade (na água, se houver) e consumo por faixa.
    const lh = CONSUMO in valores
      ? valores[CONSUMO] * 3600 * 1000
      : (o.estimarConsumo ? litrosHora(rpm, o.fatorConsumo) : null)
    const e = estavel(detetor, estado.ligado ? rpm : 0, agora)
    detetor = e.d
    const vel = velocidade()
    if (estado.ligado && e.estavel && typeof lh === 'number' && vel > 0.5) {
      curva = amostra(curva, { rpm, lh, vel })
      if (agora - ultimaGravacao > 60000) {
        ultimaGravacao = agora
        fs.writeFile(ficheiroCurva, JSON.stringify(curva), () => {})
      }
    }
    app.handleMessage(plugin.id, { updates: [{ values: vals }] })
    publicarNotificacoes(r.notificacoes)
    app.setPluginStatus(`${o.fonte} · ${vistasTotal} tramas · ${estado.ligado ? Math.round(rpm) + ' rpm' : 'parado'} · ${Object.keys(desc.vistas).length} PGN`)
  }

  // Velocidade na água se for recente; senão a velocidade no fundo.
  function velocidade () {
    for (const p of ['navigation.speedThroughWater', 'navigation.speedOverGround']) {
      const v = app.getSelfPath?.(p)
      if (typeof v?.value === 'number' && Date.now() - Date.parse(v.timestamp) < 10000) return v.value
    }
    return null
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
    vistoEm = {}
    estado = novoEstadoMotor()
    desc = novaDescoberta()
    ativosMapa = {}
    rpmAtual = 0
    vistasTotal = 0
    // Um alarme não pode ficar preso na árvore (auditoria I-21): os deste plugin que ficaram ativos de
    // antes passam a normal (a regra volta a dar o alarme se ainda for verdade); no stop(), os ativos.
    const ids = ['overTemperature', 'alternadorNaoCarrega', ...(o.mapaAlarmes || []).map(m => m.id)]
    publicarNotificacoes([...new Set(ids)]
      .filter(id => { const s = app.getSelfPath?.(`notifications.propulsion.main.${id}`)?.value?.state; return s && s !== 'normal' })
      .map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiroDesc = path.join(dir, 'descoberta-65417.jsonl')
    try { mudancas = fs.readFileSync(ficheiroDesc, 'utf8').trim().split('\n').filter(Boolean).slice(-50).map(l => JSON.parse(l)) } catch { mudancas = [] }
    ficheiroCurva = path.join(dir, 'curva-consumo.json')
    detetor = criarDetetor()
    ultimaGravacao = 0
    try { curva = JSON.parse(fs.readFileSync(ficheiroCurva, 'utf8')) } catch { curva = novaCurva() }
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
    const ativos = [...Object.keys(estado?.ativos || {}), ...Object.keys(ativosMapa || {})]
    publicarNotificacoes([...new Set(ativos)].map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
    if (estado) estado = { ...estado, ativos: {} }
    ativosMapa = {}
  }

  // Diagnóstico: PGN vistas e mudanças da 65417 (JSON e página simples).
  // A página fica em /pagina porque o SignalK usa a raiz /plugins/<id>/ para si.
  // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin
  // (tokensecurity.js); com o router.access a leitura pede só uma sessão ("readonly"), como a conta
  // "read/write" do ecrã (auditoria K-11, contrato C2). Sem o router.access (versões antigas): o simples.
  plugin.registerWithRouter = function (router) {
    const ler = typeof router.access === 'function' ? router.access('readonly') : router
    const diag = () => {
      const vistas = Object.entries(desc?.vistas || {}).map(([pgn, v]) => ({ pgn: Number(pgn), n: v.n, origem: v.origem, bytes: v.bytes }))
      return { fonte: o.fonte, tramas: vistasTotal, rpm: Math.round(rpmAtual || 0), vistas, mudancas: [...mudancas].reverse() }
    }
    ler.get('/diagnostico', (req, res) => res.json(diag()))
    // Curva de consumo aprendida no barco (para a página Motor).
    ler.get('/consumo', (req, res) => res.json({
      ...resumo(curva || novaCurva()),
      consumo: CONSUMO in valores ? 'medido pelo MDI' : `estimado (curva Volvo × ${o.fatorConsumo})`
    }))
    ler.get('/pagina', (req, res) => {
      const d = diag()
      const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      res.type('html').send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Arlequin · J1939</title>
<style>body{font:16px Arial;background:#0f1114;color:#e8eaed;margin:1rem}td,th{padding:.3rem .6rem;border-bottom:1px solid #333;text-align:left}code{color:#fac775}h2{margin-top:1.5rem}</style>
<h1>Motor · J1939 (${esc(d.fonte)})</h1><p>${d.tramas} tramas · ${d.rpm} rpm</p>
<h2>PGN vistas</h2><table><tr><th>PGN</th><th>Origem</th><th>N</th><th>Últimos bytes</th></tr>${d.vistas.map(v => `<tr><td>${v.pgn}</td><td>${v.origem}</td><td>${v.n}</td><td><code>${esc(v.bytes)}</code></td></tr>`).join('')}</table>
<h2>Mudanças nas PGN proprietárias (65417 = alarmes do MDI)</h2><p>Teste: ignição ligada com o motor parado acende os alarmes de óleo e de carga. Liga o motor e vê que bits apagam.</p>
<table><tr><th>Hora</th><th>PGN</th><th>rpm</th><th>Bytes</th><th>Bits que mudaram</th></tr>${d.mudancas.map(m => `<tr><td>${new Date(m.t).toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' })}</td><td>${m.pgn}</td><td>${m.rpm ?? ''}</td><td><code>${esc(m.bytes)}</code></td><td>${esc(m.bitsMudados.join(', '))}</td></tr>`).join('')}</table>`)
    })
  }

  return plugin
}
