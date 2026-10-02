'use strict'
// Plugin SignalK: nível do gasóleo do Arlequin (sonda original + ADS1115).
// Razão sonda/alimentação, tabela de calibração, mediana sem adorno, fusão com
// o consumo do J1939, alarmes de reserva e fuga, abastecimentos no diário.

const fs = require('node:fs')
const path = require('node:path')
const { novoEstado, descontar, passo } = require('./lib/nivel')
const { acrescentarPonto, monotona } = require('./lib/tabela')
const calibracao = require('./lib/calibracao')

const DUAS_HORAS = 2 * 3600 * 1000
// Valores da árvore só contam com a hora recente (auditoria I-12, E-M15): as rotações e o consumo do
// J1939 com menos de 10 s (com o plugin do motor parado ficavam lá as últimas rotações, o gasóleo
// continuava a descontar e a janela da fuga nunca recomeçava); as tensões da sonda com menos de 60 s
// (com a app I2C parada ficavam lá as últimas e o nível ficava preso nelas).
const SENSOR_VELHO = 10 * 1000
const SONDA_VELHA = 60 * 1000
const SONDA_PERDIDA = 5 * 60 * 1000 // sem a sonda há tanto tempo: aviso sondaPerdida, só no ecrã

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
      token: { type: 'string', title: 'Token de admin do SignalK para escrever no diário (com a segurança ligada o signalk-logbook só aceita admin; fica só aqui, nunca no ecrã)', default: '' }
    }
  }

  let o = {}
  let estado = novoEstado()
  let temporizador = null
  let ultimoAbastecimento = null
  let calib = null // sessão de calibração completa (depósito vazio, +5 L de cada vez)
  let ficheiroAbast, ficheiroNivel
  let ultimaGravacao = 0
  let semSondaDesde = null // desde quando faltam (ou estão velhas) as tensões da sonda
  let avisoSonda = false // o aviso sondaPerdida está publicado

  // Um número da árvore com a hora há menos de maxIdade ms; sem hora não se sabe a idade: não conta.
  const fresco = (p, maxIdade) => {
    const v = app.getSelfPath?.(p)
    return typeof v?.value === 'number' && Date.now() - Date.parse(v.timestamp) <= maxIdade ? v.value : null
  }

  function publicar (values) {
    app.handleMessage(plugin.id, { updates: [{ values }] })
  }

  // Guarda o nível de minuto a minuto: num arranque com o barco adornado (ou sem a sonda), parte daqui.
  function guardarNivel () {
    if (estado.litros === null || Date.now() - ultimaGravacao <= 60000) return
    ultimaGravacao = Date.now()
    fs.writeFile(ficheiroNivel, JSON.stringify({ litros: estado.litros, t: new Date().toISOString() }), () => {})
  }

  function publicarNivel () {
    if (estado.litros === null) return
    publicar([
      { path: 'tanks.fuel.0.currentVolume', value: estado.litros / 1000 },
      { path: 'tanks.fuel.0.currentLevel', value: Math.min(1, estado.litros / o.capacidadeL) },
      { path: 'tanks.fuel.0.capacity', value: o.capacidadeL / 1000 }
    ])
  }

  function avisarSonda (perdida) {
    if (perdida === avisoSonda) return
    avisoSonda = perdida
    const texto = `Sonda do gasóleo sem leitura há mais de 5 min (ADS1115, app I2C do OpenPlotter): ${estado.litros !== null ? `os ${Math.round(estado.litros)} L vêm só do consumo do motor` : 'nível desconhecido'}`
    publicar([{ path: 'notifications.tanks.fuel.0.sondaPerdida', value: perdida ? { state: 'warn', method: ['visual'], message: texto } : { state: 'normal', method: [], message: 'Normal' } }])
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
    const agora = Date.now()
    const sonda = fresco(o.caminhoSonda, SONDA_VELHA)
    const alimentacao = fresco(o.caminhoAlimentacao, SONDA_VELHA)
    const rpm = fresco('propulsion.main.revolutions', SENSOR_VELHO)
    const motor = { t: agora, fuelRate: fresco('propulsion.main.fuel.rate', SENSOR_VELHO), motorLigado: typeof rpm === 'number' && rpm > 5 }
    if (sonda === null || alimentacao === null) {
      // Sem a sonda (auditoria I-12): os litros continuam a descer com o consumo do motor e continuam
      // a ser publicados; aos 5 min, o aviso sondaPerdida (só no ecrã).
      if (semSondaDesde === null) semSondaDesde = agora
      if (!calib) {
        estado = descontar(estado, motor)
        guardarNivel()
        publicarNivel()
      }
      if (agora - semSondaDesde >= SONDA_PERDIDA) avisarSonda(true)
      app.setPluginStatus(`À espera das tensões do ADS1115 (app I2C do OpenPlotter)${estado.litros !== null ? ` · ${Math.round(estado.litros)} L pelo consumo do motor` : ''}`)
      return
    }
    semSondaDesde = null
    avisarSonda(false)
    // Calibração em curso: só se juntam leituras (barco direito); nada de alarmes nem abastecimentos.
    if (calib) {
      const roll = app.getSelfPath?.('navigation.attitude')?.value?.roll
      if (!(typeof roll === 'number' && Math.abs(roll) >= 5 * Math.PI / 180)) {
        calib = calibracao.amostra(calib, { t: Date.now(), razao: alimentacao > 1 ? sonda / alimentacao : null })
      }
      app.setPluginStatus(`Calibração: ${calib.total} L no depósito · ${calib.pontos.length} pontos${calib.pendente ? ' · a estabilizar…' : ''}`)
      return
    }
    const r = passo(estado, {
      ...motor,
      sonda,
      alimentacao,
      roll: app.getSelfPath?.('navigation.attitude')?.value?.roll ?? null
    }, o.tabela)
    estado = r.estado
    guardarNivel()
    publicarNivel()
    if (r.notificacoes.length) {
      publicar(r.notificacoes.map(n => ({ path: `notifications.tanks.fuel.0.${n.id}`, value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) } })))
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
    semSondaDesde = null
    avisoSonda = false
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
    // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin
    // (tokensecurity.js); com o router.access os GET pedem uma sessão ("readonly") e os POST um utilizador
    // "read/write", como a conta do ecrã (auditoria K-11, contrato C2). Sem o router.access: os simples.
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escrever = comNivel ? router.access('readwrite') : router
    const litrosDoPedido = (req) => Number(String(req.body?.litros ?? '').replace(',', '.'))

    // ---- Calibração completa (depósito vazio e limpo, gasóleo aos 5 L) ----
    const vistaCalib = () => calib && {
      ativa: true, total: calib.total, pontos: calib.pontos, boiaParada: calib.boiaParada,
      pendente: calib.pendente && { litros: calib.pendente.litros }, razaoAtual: estado.razao
    }
    const aplicarTabela = (tabela, capacidadeL) => {
      o = { ...o, tabela, ...(capacidadeL ? { capacidadeL } : {}) }
      app.savePluginOptions?.(o, (e) => { if (e) app.error(`não guardei a tabela: ${e.message || e}`) })
      estado = novoEstado() // o nível volta a sair da tabela nova
      try { fs.unlinkSync(ficheiroNivel) } catch { }
    }
    ler.get('/calibracao', (req, res) => res.json(vistaCalib() || { ativa: false, tabela: o.tabela, capacidadeL: o.capacidadeL }))
    escrever.post('/calibracao/iniciar', (req, res) => {
      const litros = req.body?.litros === undefined ? 0 : litrosDoPedido(req)
      if (!(litros >= 0)) return res.status(400).json({ ok: false, erro: 'litros inválidos' })
      calib = calibracao.iniciar(litros)
      res.json({ ok: true, ...vistaCalib() })
    })
    escrever.post('/calibracao/adicionar', (req, res) => {
      if (!calib) return res.status(409).json({ ok: false, erro: 'não há calibração em curso' })
      try { calib = calibracao.adicionar(calib, litrosDoPedido(req), Date.now()) } catch (e) { return res.status(409).json({ ok: false, erro: e.message }) }
      res.json({ ok: true, ...vistaCalib() })
    })
    escrever.post('/calibracao/desfazer', (req, res) => {
      if (!calib) return res.status(409).json({ ok: false, erro: 'não há calibração em curso' })
      calib = calibracao.desfazer(calib)
      res.json({ ok: true, ...vistaCalib() })
    })
    escrever.post('/calibracao/cancelar', (req, res) => { calib = null; res.json({ ok: true, ativa: false }) })
    escrever.post('/calibracao/terminar', (req, res) => {
      if (!calib) return res.status(409).json({ ok: false, erro: 'não há calibração em curso' })
      let r
      try { r = calibracao.terminar(calib, { cheio: !!req.body?.cheio }) } catch (e) { return res.status(409).json({ ok: false, erro: e.message }) }
      if (!monotona(r.tabela)) return res.status(422).json({ ok: false, erro: 'a tabela não é coerente: rever os pontos (desfazer)' })
      aplicarTabela(r.tabela, r.capacidadeL)
      calib = null
      res.json({ ok: true, ...r })
    })
    // Folha do multímetro: { linhas: [{ litros, sonda, alimentacao }], cheio }
    escrever.post('/calibracao/importar', (req, res) => {
      let r
      try { r = calibracao.importar(req.body?.linhas || []) } catch (e) { return res.status(400).json({ ok: false, erro: e.message }) }
      if (r.tabela.length < 2 || !monotona(r.tabela)) return res.status(422).json({ ok: false, erro: 'a folha não dá uma tabela coerente' })
      const cap = req.body?.cheio ? Math.max(...(req.body.linhas || []).map(l => l.litros)) : null
      aplicarTabela(r.tabela, cap)
      res.json({ ok: true, ...r, capacidadeL: cap || o.capacidadeL })
    })

    ler.get('/estado', (req, res) => res.json({
      litros: estado.litros, mediana: estado.mediana, razao: estado.razao, razaoMediana: estado.razaoMediana,
      tabela: o.tabela, capacidadeL: o.capacidadeL, alarmes: Object.keys(estado.ativos), ultimoAbastecimento,
      ultimaSessao: estado.ultimaSessao // última saída a motor: medido pela sonda, esperado pelo J1939, fator sugerido
    }))

    // "O depósito tem agora X litros" (cheio = 200, ou uma marca do desenho do dono anterior).
    escrever.post('/calibrar', (req, res) => {
      const litros = litrosDoPedido(req)
      if (!(litros >= 0 && litros <= o.capacidadeL)) return res.status(400).json({ ok: false, erro: `litros entre 0 e ${o.capacidadeL}` })
      if (estado.razaoMediana === null) return res.status(409).json({ ok: false, erro: 'ainda a medir (3 min com o barco direito)' })
      const r = acrescentarPonto(o.tabela, { razao: estado.razaoMediana, litros })
      if (r.erro) return res.status(422).json({ ok: false, erro: r.erro })
      guardarTabela(r.tabela)
      res.json({ ok: true, tabela: o.tabela })
    })

    // "Meti X litros": o ponto é (razão agora, litros antes + X).
    escrever.post('/abastecimento', (req, res) => {
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
