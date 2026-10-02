'use strict'
// Plugin SignalK: água doce do Arlequin (bombas de pé, pedaladas contadas).
// Publica tanks.freshWater.<id>.*, avisa com ≤ 20% e dá o ritmo (litros/dia e
// dias que faltam). "Enchi", nível à mão e calibração da bomba com uma jarra.

const fs = require('node:fs')
const path = require('node:path')
const agua = require('./lib/agua')

const TANQUES = [
  { id: 0, nome: 'Cozinha (BB)', capacidadeL: 80, caminhoPedaladas: 'tanks.freshWater.0.pedaladas', litrosPorPedalada: 0.35 },
  { id: 1, nome: 'WC (EB)', capacidadeL: 80, caminhoPedaladas: 'tanks.freshWater.1.pedaladas', litrosPorPedalada: 0.35 }
]

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-agua',
    name: 'Arlequin · água doce',
    description: 'Depósitos de água doce pelas pedaladas das bombas de pé (a bomba de água do mar não conta)'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      tanques: {
        type: 'array',
        title: 'Depósitos (capacidades a confirmar no barco)',
        default: TANQUES,
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', title: 'Nº (tanks.freshWater.<n>)' },
            nome: { type: 'string', title: 'Nome' },
            capacidadeL: { type: 'number', title: 'Capacidade (L)' },
            caminhoPedaladas: { type: 'string', title: 'Caminho do contador de pedaladas (ESP32 ou GPIO)' },
            litrosPorPedalada: { type: 'number', title: 'Litros por pedalada (calibrar com uma jarra de 1 L)' }
          }
        }
      },
      avisoPct: { type: 'number', title: 'Aviso de água a acabar (%)', default: 20 },
      logbook: { type: 'boolean', title: 'Escrever os enchimentos no diário (signalk-logbook)', default: false },
      logbookUrl: { type: 'string', title: 'URL do logbook', default: 'http://localhost:3000/plugins/signalk-logbook/logs' },
      token: { type: 'string', title: 'Token de admin do SignalK para escrever no diário (com a segurança ligada o signalk-logbook só aceita admin; fica só aqui, nunca no ecrã)', default: '' }
    }
  }

  let o = {}
  let estados = {} // id → estado do tanque (lib/agua)
  let alarmes = {} // id → ativo
  let temporizador = null
  let ficheiro
  let ultimaGravacao = 0

  const cfgDe = (id) => o.tanques.find(t => t.id === id)

  function guardar () {
    try { fs.writeFileSync(ficheiro, JSON.stringify(estados)) } catch (e) { app.error(`não guardei a água: ${e.message}`) }
  }

  async function diario (texto) {
    if (!o.logbook) return
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (o.token) headers.Authorization = `Bearer ${o.token}`
      await fetch(o.logbookUrl, { method: 'POST', headers, body: JSON.stringify({ text: texto, category: 'maintenance', origin: 'auto' }) })
    } catch (e) { app.error(`logbook: ${e.message}`) }
  }

  function tick () {
    const agora = Date.now()
    const values = []
    const notif = []
    const resumo = []
    for (const cfg of o.tanques) {
      const contador = app.getSelfPath?.(cfg.caminhoPedaladas)?.value
      let t = estados[cfg.id] || agua.novoTanque()
      t = agua.contagem(t, contador, agora, cfg)
      estados[cfg.id] = t
      const n = agua.nivel(t, cfg)
      const b = `tanks.freshWater.${cfg.id}.`
      values.push(
        { path: b + 'currentLevel', value: n.fracao },
        { path: b + 'currentVolume', value: n.litros / 1000 },
        { path: b + 'capacity', value: cfg.capacidadeL / 1000 },
        { path: b + 'name', value: cfg.nome }
      )
      const a = agua.avaliarAlarme(!!alarmes[cfg.id], n.fracao, (o.avisoPct ?? 20) / 100, ((o.avisoPct ?? 20) + 5) / 100)
      alarmes[cfg.id] = a.ativo
      if (a.mudou) {
        notif.push({
          path: `notifications.tanks.freshWater.${cfg.id}.baixo`,
          value: a.ativo
            ? { state: 'warn', method: ['visual', 'sound'], message: `Água a acabar: ${cfg.nome} com ${Math.round(n.litros)} L` }
            : { state: 'normal', method: [], message: 'Normal' }
        })
      }
      resumo.push(`${cfg.nome} ${Math.round(n.litros)} L`)
    }
    app.handleMessage(plugin.id, { updates: [{ values: [...values, ...notif] }] })
    app.setPluginStatus(resumo.join(' · '))
    if (agora - ultimaGravacao > 30000) { ultimaGravacao = agora; guardar() }
  }

  plugin.start = function (props) {
    o = { tanques: TANQUES, avisoPct: 20, logbook: false, token: '', ...props }
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiro = path.join(dir, 'agua.json')
    try { estados = JSON.parse(fs.readFileSync(ficheiro, 'utf8')) } catch { estados = {} }
    alarmes = {}
    ultimaGravacao = 0
    temporizador = setInterval(tick, 1000)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (ficheiro) guardar()
  }

  plugin.registerWithRouter = function (router) {
    // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin
    // (tokensecurity.js); com o router.access os GET pedem uma sessão ("readonly") e os POST um utilizador
    // "read/write", como a conta do ecrã (auditoria K-11, contrato C2). Sem o router.access: os simples.
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escrever = comNivel ? router.access('readwrite') : router
    const tanque = (req, res) => {
      const cfg = cfgDe(Number(req.body?.id))
      if (!cfg) { res.status(404).json({ ok: false, erro: 'depósito desconhecido' }); return null }
      return cfg
    }
    const numero = (x) => Number(String(x ?? '').replace(',', '.'))

    ler.get('/estado', (req, res) => {
      const agora = Date.now()
      res.json({
        tanques: o.tanques.map(cfg => {
          const t = estados[cfg.id] || agua.novoTanque()
          const n = agua.nivel(t, cfg)
          return {
            id: cfg.id, nome: cfg.nome, capacidadeL: cfg.capacidadeL, litrosPorPedalada: cfg.litrosPorPedalada,
            litros: n.litros, fracao: n.fracao, ritmo: agua.ritmoDiario(t, agora, cfg),
            calibrando: !!t.calibracao, pedaladasCalibracao: t.calibracao?.pedaladas ?? null
          }
        })
      })
    })
    escrever.post('/encher', (req, res) => {
      const cfg = tanque(req, res); if (!cfg) return
      estados[cfg.id] = agua.encher(estados[cfg.id] || agua.novoTanque(), Date.now())
      guardar()
      diario(`Enchi a água: ${cfg.nome} (${cfg.capacidadeL} L)`)
      res.json({ ok: true })
    })
    escrever.post('/nivel', (req, res) => {
      const cfg = tanque(req, res); if (!cfg) return
      const litros = numero(req.body?.litros)
      if (!(litros >= 0 && litros <= cfg.capacidadeL)) return res.status(400).json({ ok: false, erro: `litros entre 0 e ${cfg.capacidadeL}` })
      estados[cfg.id] = agua.definirNivel(estados[cfg.id] || agua.novoTanque(), litros, Date.now())
      guardar()
      res.json({ ok: true })
    })
    escrever.post('/calibrar-bomba/iniciar', (req, res) => {
      const cfg = tanque(req, res); if (!cfg) return
      estados[cfg.id] = agua.iniciarCalibracao(estados[cfg.id] || agua.novoTanque())
      res.json({ ok: true })
    })
    escrever.post('/calibrar-bomba/cancelar', (req, res) => {
      const cfg = tanque(req, res); if (!cfg) return
      estados[cfg.id] = { ...(estados[cfg.id] || agua.novoTanque()), calibracao: null }
      res.json({ ok: true })
    })
    escrever.post('/calibrar-bomba/terminar', (req, res) => {
      const cfg = tanque(req, res); if (!cfg) return
      let r
      try { r = agua.terminarCalibracao(estados[cfg.id] || agua.novoTanque(), numero(req.body?.litros ?? 1)) } catch (e) { return res.status(409).json({ ok: false, erro: e.message }) }
      estados[cfg.id] = { ...estados[cfg.id], calibracao: null }
      o = { ...o, tanques: o.tanques.map(t => t.id === cfg.id ? { ...t, litrosPorPedalada: Math.round(r.litrosPorPedalada * 1000) / 1000 } : t) }
      app.savePluginOptions?.(o, (e) => { if (e) app.error(`não guardei a calibração: ${e.message || e}`) })
      res.json({ ok: true, ...r })
    })
  }

  return plugin
}
