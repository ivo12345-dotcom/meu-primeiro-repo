'use strict'
// Plugin SignalK: nível do gasóleo do Arlequin (sonda original + ADS1115).
// Razão sonda/alimentação, tabela de calibração, mediana sem adorno, fusão com
// o consumo do J1939, alarmes de reserva e fuga, abastecimentos no diário.

const fs = require('node:fs')
const path = require('node:path')
const { novoEstado, passo } = require('./lib/nivel')
const { acrescentarPonto } = require('./lib/tabela')

const DUAS_HORAS = 2 * 3600 * 1000

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-gasoleo',
    name: 'Arlequin · gasóleo',
    description: 'Nível do depósito de 200 L pela sonda original (ADS1115), com calibração, alarmes de reserva e de fuga'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      caminhoSonda: { type: 'string', title: 'Caminho da tensão da sonda (ADS1115 A0, pelo OpenPlotter)', default: 'tanks.fuel.0.senderVoltage' },
      caminhoAlimentacao: { type: 'string', title: 'Caminho da tensão de alimentação do medidor (ADS1115 A1)', default: 'tanks.fuel.0.supplyVoltage' },
      capacidadeL: { type: 'number', title: 'Capacidade do depósito (L)', default: 200 },
      tabela: {
        type: 'array',
        title: 'Tabela de calibração (razão sonda/alimentação → litros); preenche-se com "Calibrar" e "Abasteci" no ecrã',
        default: [],
        items: { type: 'object', properties: { razao: { type: 'number' }, litros: { type: 'number' } } }
      },
      logbook: { type: 'boolean', title: 'Escrever os abastecimentos no diário (signalk-logbook)', default: false },
      logbookUrl: { type: 'string', title: 'URL do logbook', default: 'http://localhost:3000/plugins/signalk-logbook/logs' },
      token: { type: 'string', title: 'Token de acesso (se a segurança estiver ligada)', default: '' }
    }
  }

  let o = {}
  let estado = novoEstado()
  let temporizador = null
  let ultimoAbastecimento = null
  let ficheiroAbast, ficheiroNivel
  let ultimaGravacao = 0

  const numero = (p) => { const x = app.getSelfPath?.(p)?.value; return typeof x === 'number' ? x : null }

  function publicar (values) {
    app.handleMessage(plugin.id, { updates: [{ values }] })
  }

  async function diario (texto) {
    if (!o.logbook) return
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (o.token) headers.Authorization = `Bearer ${o.token}`
      const r = await fetch(o.logbookUrl, { method: 'POST', headers, body: JSON.stringify({ text: texto, category: 'engine', origin: 'auto' }) })
      if (!r.ok) app.error(`logbook respondeu ${r.status}`)
    } catch (e) { app.error(`logbook inacessível: ${e.message}`) }
  }

  function tick () {
    const sonda = numero(o.caminhoSonda)
    const alimentacao = numero(o.caminhoAlimentacao)
    if (sonda === null || alimentacao === null) {
      app.setPluginStatus('À espera das tensões do ADS1115 (app I2C do OpenPlotter)')
      return
    }
    const rpm = numero('propulsion.main.revolutions')
    const r = passo(estado, {
      t: Date.now(),
      sonda,
      alimentacao,
      roll: app.getSelfPath?.('navigation.attitude')?.value?.roll ?? null,
      fuelRate: numero('propulsion.main.fuel.rate'),
      motorLigado: typeof rpm === 'number' && rpm > 5
    }, o.tabela)
    estado = r.estado
    // Guarda o nível de minuto a minuto: num arranque com o barco adornado, parte daqui.
    if (estado.litros !== null && Date.now() - ultimaGravacao > 60000) {
      ultimaGravacao = Date.now()
      fs.writeFile(ficheiroNivel, JSON.stringify({ litros: estado.litros, t: new Date().toISOString() }), () => {})
    }
    if (estado.litros !== null) {
      const cap = o.capacidadeL / 1000
      publicar([
        { path: 'tanks.fuel.0.currentVolume', value: estado.litros / 1000 },
        { path: 'tanks.fuel.0.currentLevel', value: Math.min(1, estado.litros / o.capacidadeL) },
        { path: 'tanks.fuel.0.capacity', value: cap }
      ])
    }
    if (r.notificacoes.length) {
      publicar(r.notificacoes.map(n => ({ path: `notifications.tanks.fuel.0.${n.id}`, value: { state: n.state, method: n.method, message: n.message } })))
    }
    if (r.abastecimento) {
      const a = r.abastecimento
      ultimoAbastecimento = { ...a, t: Date.now() }
      const texto = `Abastecimento: +${Math.round(a.delta)} L (${Math.round(a.antes)} → ${Math.round(a.depois)} L)`
      fs.appendFile(ficheiroAbast, JSON.stringify({ t: new Date().toISOString(), ...a }) + '\n', () => {})
      diario(texto)
      app.setPluginStatus(texto)
      return
    }
    const roll = app.getSelfPath?.('navigation.attitude')?.value?.roll
    const adornado = typeof roll === 'number' && Math.abs(roll) >= 5 * Math.PI / 180
    app.setPluginStatus(o.tabela?.length >= 2
      ? `${estado.litros === null ? 'a medir…' : Math.round(estado.litros) + ' L'}${adornado ? ` · adornado ${Math.round(Math.abs(roll) * 180 / Math.PI)}°: a sonda não conta` : ''} · razão ${estado.razao?.toFixed(3)} · ${o.tabela.length} pontos de calibração`
      : `Falta calibrar (${o.tabela?.length || 0} pontos) · razão ${estado.razao?.toFixed(3)}`)
  }

  function guardarTabela (tabela) {
    o = { ...o, tabela }
    app.savePluginOptions?.(o, (e) => { if (e) app.error(`não guardei a tabela: ${e.message || e}`) })
  }

  plugin.start = function (props) {
    o = { caminhoSonda: 'tanks.fuel.0.senderVoltage', caminhoAlimentacao: 'tanks.fuel.0.supplyVoltage', capacidadeL: 200, tabela: [], logbook: false, token: '', ...props }
    estado = novoEstado()
    ultimoAbastecimento = null
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiroAbast = path.join(dir, 'abastecimentos.jsonl')
    ficheiroNivel = path.join(dir, 'nivel.json')
    ultimaGravacao = 0
    try {
      const guardado = JSON.parse(fs.readFileSync(ficheiroNivel, 'utf8'))
      if (typeof guardado.litros === 'number') estado.litros = guardado.litros
    } catch { /* primeira vez */ }
    temporizador = setInterval(tick, 1000)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  plugin.registerWithRouter = function (router) {
    const litrosDoPedido = (req) => Number(String(req.body?.litros ?? '').replace(',', '.'))

    router.get('/estado', (req, res) => res.json({
      litros: estado.litros, mediana: estado.mediana, razao: estado.razao, razaoMediana: estado.razaoMediana,
      tabela: o.tabela, capacidadeL: o.capacidadeL, alarmes: Object.keys(estado.ativos), ultimoAbastecimento,
      ultimaSessao: estado.ultimaSessao // última saída a motor: medido pela sonda, esperado pelo J1939, fator sugerido
    }))

    // "O depósito tem agora X litros" (cheio = 200, ou uma marca do desenho do dono anterior).
    router.post('/calibrar', (req, res) => {
      const litros = litrosDoPedido(req)
      if (!(litros >= 0 && litros <= o.capacidadeL)) return res.status(400).json({ ok: false, erro: `litros entre 0 e ${o.capacidadeL}` })
      if (estado.razaoMediana === null) return res.status(409).json({ ok: false, erro: 'ainda a medir (3 min com o barco direito)' })
      const r = acrescentarPonto(o.tabela, { razao: estado.razaoMediana, litros })
      if (r.erro) return res.status(422).json({ ok: false, erro: r.erro })
      guardarTabela(r.tabela)
      res.json({ ok: true, tabela: o.tabela })
    })

    // "Meti X litros": o ponto é (razão agora, litros antes + X).
    router.post('/abastecimento', (req, res) => {
      const litros = litrosDoPedido(req)
      if (!(litros > 0 && litros <= o.capacidadeL)) return res.status(400).json({ ok: false, erro: 'litros inválidos' })
      if (estado.razaoMediana === null) return res.status(409).json({ ok: false, erro: 'ainda a medir (3 min com o barco direito)' })
      const recente = ultimoAbastecimento && Date.now() - ultimoAbastecimento.t < DUAS_HORAS
      const antes = recente ? ultimoAbastecimento.antes : estado.litros
      if (antes === null) return res.status(409).json({ ok: false, erro: 'sem nível anterior: usa "Calibrar" com os litros que tens' })
      const depois = Math.min(o.capacidadeL, antes + litros)
      const r = acrescentarPonto(o.tabela, { razao: estado.razaoMediana, litros: depois })
      if (r.erro) return res.status(422).json({ ok: false, erro: r.erro })
      guardarTabela(r.tabela)
      estado = { ...estado, litros: depois }
      if (!recente) diario(`Abastecimento: +${Math.round(litros)} L (${Math.round(antes)} → ${Math.round(depois)} L)`)
      res.json({ ok: true, antes, depois, tabela: o.tabela })
    })
  }

  return plugin
}
