'use strict'
// Plugin SignalK: água doce do Arlequin (bombas de pé, pedaladas contadas).
// Publica tanks.freshWater.<id>.*, avisa com ≤ 20% e dá o ritmo (litros/dia e
// dias que faltam). "Enchi", nível à mão e calibração da bomba com uma jarra.

const fs = require('node:fs')
const path = require('node:path')
const agua = require('./lib/agua')
const { criarAtivos } = require('./lib/ativos')

const SEM_SENSOR = 10 * 60 * 1000 // contador sem atualizar há mais disto = sem sensor
// Nota do SignalK 2.33 (adenda 2): ao parar o plugin o servidor apaga da árvore os valores dele. Os avisos
// ativos ficam em alarmes-ativos.json (lib/ativos.js) e o arranque seguinte volta a publicá-los e a pô-los
// ativos na regra (a histerese dos 20/25 % continua); o stop() continua a pôr a árvore a normal (I-21).

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
  let ativosArq = null // os avisos ativos no ficheiro (lib/ativos.js)

  const cfgDe = (id) => o.tanques.find(t => t.id === id)

  // O contador de pedaladas de um depósito, se o sensor (ESP32) o publicou há menos de 10 min; senão
  // undefined: "sem sensor" (auditoria I-29). O ESP32 tem de o mandar de tempos a tempos, mesmo parado.
  function contadorDe (cfg, agora) {
    const v = app.getSelfPath?.(cfg.caminhoPedaladas)
    return typeof v?.value === 'number' && agora - Date.parse(v.timestamp) <= SEM_SENSOR ? v.value : undefined
  }

  // O nível publicado: sem sensor, ou sem nunca "Enchi" nem nível à mão, vai sem valor (null) — nunca
  // "cheio" por omissão (decisão n.º 23 do Ivo).
  function nivelDe (t, cfg, comSensor) {
    return comSensor ? agua.nivel(t, cfg) : { litros: null, fracao: null }
  }

  function textoNivel (cfg, t, comSensor, n) {
    if (!comSensor) return `${cfg.nome} sem sensor`
    if (n.litros === null) return `${cfg.nome} sem nível (carrega em "Enchi" ou põe o nível à mão)`
    return `${cfg.nome} ${Math.round(n.litros)} L`
  }

  function guardar () {
    try { fs.writeFileSync(ficheiro, JSON.stringify(estados)) } catch (e) { app.error(`não guardei a água: ${e.message}`) }
  }

  async function diario (texto) {
    if (!o.logbook) return
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (o.token) headers.Authorization = `Bearer ${o.token}`
      const r = await fetch(o.logbookUrl, { method: 'POST', headers, body: JSON.stringify({ text: texto, category: 'maintenance', origin: 'auto' }) })
      // com a segurança ligada, sem token de admin, o logbook dá 401/403: fica no registo (auditoria M-63)
      if (!r.ok) app.error(`logbook respondeu ${r.status}`)
    } catch (e) { app.error(`logbook inacessível: ${e.message}`) }
  }

  function tick () {
    const agora = Date.now()
    const values = []
    const notif = []
    const resumo = []
    for (const cfg of o.tanques) {
      const contador = contadorDe(cfg, agora)
      let t = estados[cfg.id] || agua.novoTanque()
      t = agua.contagem(t, contador, agora, cfg)
      estados[cfg.id] = t
      const n = nivelDe(t, cfg, contador !== undefined)
      const b = `tanks.freshWater.${cfg.id}.`
      values.push(
        { path: b + 'currentLevel', value: n.fracao },
        { path: b + 'currentVolume', value: n.litros === null ? null : n.litros / 1000 },
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
      resumo.push(textoNivel(cfg, t, contador !== undefined, n))
    }
    app.handleMessage(plugin.id, { updates: [{ values: [...values, ...notif] }] })
    ativosArq?.registar(notif)
    ativosArq?.gravar()
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
    // Os avisos que estavam ativos antes do reinício (nota do SignalK 2.33): voltam a publicar-se, com o
    // mesmo valor, e ficam ativos na regra (um depósito que já não está na configuração fica de fora).
    ativosArq = criarAtivos(path.join(dir, 'alarmes-ativos.json'), { erro: (e) => app.error(e) })
    const repostos = []
    for (const [caminho, valor] of Object.entries(ativosArq.repor().ativos)) {
      const cfg = o.tanques.find(t => caminho === baixo(t.id))
      if (!cfg) continue
      alarmes[cfg.id] = true
      repostos.push({ path: caminho, value: valor })
    }
    if (repostos.length) {
      app.handleMessage(plugin.id, { updates: [{ values: repostos }] })
      ativosArq.registar(repostos)
    }
    // Um aviso não pode ficar preso na árvore (auditoria I-21): os deste plugin que ficaram ativos de
    // antes e não se repuseram passam a normal (a regra volta a avisar se ainda for verdade); no stop(),
    // os ativos.
    normal(o.tanques.map(t => t.id).filter(id => !alarmes[id]).filter(id => { const s = app.getSelfPath?.(baixo(id))?.value?.state; return s && s !== 'normal' }))
    temporizador = setInterval(tick, 1000)
  }

  const baixo = (id) => `notifications.tanks.freshWater.${id}.baixo`
  function normal (ids, { registar = true } = {}) {
    if (!ids.length) return
    const values = ids.map(id => ({ path: baixo(id), value: { state: 'normal', method: [], message: 'Normal' } }))
    app.handleMessage(plugin.id, { updates: [{ values }] })
    if (registar) ativosArq?.registar(values)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (ficheiro) guardar()
    // o ficheiro fica com os ativos (o arranque seguinte repõe-nos); a árvore passa a normal (I-21)
    ativosArq?.gravar({ forcar: true })
    normal(Object.keys(alarmes).filter(id => alarmes[id]), { registar: false })
    alarmes = {}
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
        // semSensor: o contador não chegou há 10 min (ou nunca); nivelConhecido: já houve um "Enchi" ou
        // um nível posto à mão (sem isso, ou sem sensor, litros e fracao vêm null)
        tanques: o.tanques.map(cfg => {
          const t = estados[cfg.id] || agua.novoTanque()
          const comSensor = contadorDe(cfg, agora) !== undefined
          const n = nivelDe(t, cfg, comSensor)
          return {
            id: cfg.id, nome: cfg.nome, capacidadeL: cfg.capacidadeL, litrosPorPedalada: cfg.litrosPorPedalada,
            litros: n.litros, fracao: n.fracao, ritmo: comSensor ? agua.ritmoDiario(t, agora, cfg) : null,
            semSensor: !comSensor, nivelConhecido: !!t.nivelConhecido,
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
      // a jarra: mais de 0 e até 20 L; litros ilegíveis gravavam NaN e 0 gravava 0 L por pedalada (M-62)
      const litros = numero(req.body?.litros ?? 1)
      if (!(litros > 0 && litros <= 20)) return res.status(400).json({ ok: false, erro: 'litros da jarra entre 0 e 20 (ex.: 1)' })
      let r
      try { r = agua.terminarCalibracao(estados[cfg.id] || agua.novoTanque(), litros) } catch (e) { return res.status(409).json({ ok: false, erro: e.message }) }
      estados[cfg.id] = { ...estados[cfg.id], calibracao: null }
      o = { ...o, tanques: o.tanques.map(t => t.id === cfg.id ? { ...t, litrosPorPedalada: Math.round(r.litrosPorPedalada * 1000) / 1000 } : t) }
      app.savePluginOptions?.(o, (e) => { if (e) app.error(`não guardei a calibração: ${e.message || e}`) })
      res.json({ ok: true, ...r })
    })
  }

  return plugin
}
