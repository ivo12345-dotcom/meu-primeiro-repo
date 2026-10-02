'use strict'
// Plugin SignalK: alarmes de energia e registo das cargas pelo motor do Arlequin.

const fs = require('node:fs')
const path = require('node:path')
const { novoEstado, avaliar, LIMITES, IDS } = require('./lib/regras')
const { novaSessao, passoSessao } = require('./lib/sessao')
const { registar, textoSessao } = require('./lib/diario')

const RPM_VELHO = 2 * 60 * 1000 // sem rotação há 2 min = motor considerado parado
const PREFIXO = 'notifications.arlequin.energia.'

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-energia',
    name: 'Arlequin · energia',
    description: 'Alarmes das baterias AGM (55% / 85% / 50% / motor) e registo das cargas pelo motor'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      servico: { type: 'string', title: 'ID do banco de serviço (SmartShunt)', default: 'servico' },
      motor: { type: 'string', title: 'ID do banco do motor (aux do SmartShunt)', default: 'motor' },
      propulsao: { type: 'string', title: 'ID do motor em propulsion.*', default: 'main' },
      logbook: { type: 'boolean', title: 'Escrever as cargas no diário de bordo (signalk-logbook)', default: false },
      logbookUrl: { type: 'string', title: 'URL do logbook', default: 'http://localhost:3000/plugins/signalk-logbook/logs' },
      token: { type: 'string', title: 'Token de admin do SignalK para escrever no diário (com a segurança ligada o signalk-logbook só aceita admin; fica só aqui, nunca no ecrã)', default: '' }
    }
  }

  let unsubscribes = []
  let temporizador = null
  let estado, sessao, leitura, desvio, ficheiroRunTime, ficheiroSessoes, opcoes
  let runTimePublicado = false
  let inicioDados = null

  // Hora "dos dados": o relógio do sistema corrigido pelo carimbo da última
  // delta. No barco dá o mesmo; com o simulador acelerado segue o tempo simulado.
  const agora = () => Date.now() + desvio

  function publicar (values) {
    app.handleMessage(plugin.id, { updates: [{ timestamp: new Date(agora()).toISOString(), values }] })
  }

  // Um alarme não pode ficar preso na árvore (auditoria I-21): no stop() os ativos passam a normal; no
  // start() também os que ficaram de antes (a regra volta a dar o alarme se ainda for verdade).
  function normal (ids) {
    if (ids.length) publicar(ids.map(id => ({ path: PREFIXO + id, value: { state: 'normal', method: [], message: 'Normal' } })))
  }

  function guardarRunTime () {
    try {
      fs.writeFileSync(ficheiroRunTime, JSON.stringify({ runTimeS: sessao.runTimeS }))
    } catch (e) {
      app.error(`não consegui guardar as horas de motor: ${e.message}`)
    }
  }

  // As horas do MDI (plugin J1939) valem mais: se outra fonte já publicou as horas
  // de motor (um número) desde que o servidor arrancou, este contador fica só para
  // as sessões de carga. Com a ignição desligada o J1939 deixa de as republicar
  // (auditoria K-07): a hora delas na árvore envelhece, mas continuam a ser as
  // horas certas — trocá-las por este contador mostrava dois números diferentes.
  // Nos primeiros 30 s (tempo dos dados) espera, para dar tempo ao J1939 de arrancar.
  function outraFonteDeHoras (t) {
    if (inicioDados === null) inicioDados = t
    if (t - inicioDados < 30 * 1000) return true
    const p = app.getSelfPath?.(`propulsion.${opcoes.propulsao}.runTime`)
    if (!p) return false
    const fontes = p.values ? Object.entries(p.values).map(([src, v]) => ({ src, value: v.value })) : [{ src: p.$source, value: p.value }]
    return fontes.some(f => f.src && !String(f.src).startsWith(plugin.id) && typeof f.value === 'number')
  }

  function tick () {
    const t = agora()
    const motorLigado = typeof leitura.rpm === 'number' && t - leitura.rpmEm <= RPM_VELHO && leitura.rpm > LIMITES.rpmLigado
    const l = { ...leitura, rpm: motorLigado ? leitura.rpm : 0 }

    const r = avaliar(estado, l, t)
    estado = r.estado
    if (r.notificacoes.length) {
      publicar(r.notificacoes.map(n => ({
        path: PREFIXO + n.id,
        value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) }
      })))
      for (const n of r.notificacoes) app.debug(`${n.id} ${n.state}: ${n.message}`)
    }

    const s = passoSessao(sessao, { motorLigado, corrente: leitura.corrente, soc: leitura.soc }, t)
    const minutoAntes = Math.floor(sessao.runTimeS / 60)
    sessao = s.sessao
    if ((Math.floor(sessao.runTimeS / 60) !== minutoAntes || !runTimePublicado) && !outraFonteDeHoras(t)) {
      runTimePublicado = true
      publicar([{ path: `propulsion.${opcoes.propulsao}.runTime`, value: Math.round(sessao.runTimeS) }])
    }
    if (s.fechada) {
      guardarRunTime()
      app.setPluginStatus(textoSessao(s.fechada))
      registar(s.fechada, {
        ficheiro: ficheiroSessoes,
        logbookUrl: opcoes.logbook ? opcoes.logbookUrl : null,
        token: opcoes.token
      }).then(r => { if (r.erro) app.error(r.erro) }, e => app.error(e.message))
    }
  }

  function aoReceber (delta) {
    for (const u of delta.updates ?? []) {
      const ts = u.timestamp ? Date.parse(u.timestamp) : Date.now()
      if (!Number.isNaN(ts)) desvio = ts - Date.now()
      for (const { path: p, value } of u.values ?? []) {
        const b = `electrical.batteries.${opcoes.servico}.`
        if (p === b + 'capacity.stateOfCharge') { leitura.soc = value; leitura.socEm = ts }
        else if (p === b + 'current') leitura.corrente = value
        else if (p === `electrical.batteries.${opcoes.motor}.voltage`) leitura.vMotor = value
        else if (p === `propulsion.${opcoes.propulsao}.revolutions`) { leitura.rpm = value; leitura.rpmEm = ts }
        else if (p === 'navigation.speedOverGround') leitura.sog = value
        else if (p === 'environment.mode') leitura.modo = value
      }
    }
    tick()
  }

  plugin.start = function (props) {
    opcoes = { servico: 'servico', motor: 'motor', propulsao: 'main', logbook: false, token: '', ...props }
    estado = novoEstado()
    leitura = { soc: null, socEm: 0, corrente: 0, vMotor: null, rpm: null, rpmEm: 0, sog: 0, modo: 'day' }
    desvio = 0
    runTimePublicado = false
    inicioDados = null
    normal(IDS.filter(id => { const s = app.getSelfPath?.(PREFIXO + id)?.value?.state; return s && s !== 'normal' }))

    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiroRunTime = path.join(dir, 'runtime.json')
    ficheiroSessoes = path.join(dir, 'sessoes-carga.jsonl')
    sessao = novaSessao()
    try {
      sessao.runTimeS = JSON.parse(fs.readFileSync(ficheiroRunTime, 'utf8')).runTimeS || 0
    } catch { /* primeira vez: começa do zero */ }

    const caminhos = [
      `electrical.batteries.${opcoes.servico}.capacity.stateOfCharge`,
      `electrical.batteries.${opcoes.servico}.current`,
      `electrical.batteries.${opcoes.motor}.voltage`,
      `propulsion.${opcoes.propulsao}.revolutions`,
      'navigation.speedOverGround',
      'environment.mode'
    ]
    app.subscriptionmanager.subscribe(
      { context: 'vessels.self', subscribe: caminhos.map(p => ({ path: p, policy: 'instant' })) },
      unsubscribes,
      (e) => app.setPluginError(`subscrição: ${e}`),
      aoReceber
    )
    // Sem dados nenhuns o tick também tem de correr, para dar o sensor perdido.
    temporizador = setInterval(tick, 10 * 1000)
    app.setPluginStatus(`A vigiar o banco "${opcoes.servico}" · ${Math.round(sessao.runTimeS / 3600)} h de motor`)
  }

  // Para o ecrã: as últimas sessões de carga (mais recente primeiro).
  // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin
  // (tokensecurity.js); com o router.access a leitura pede só uma sessão ("readonly"), como a conta
  // "read/write" do ecrã (auditoria K-11, contrato C2). Sem o router.access (versões antigas): o simples.
  plugin.registerWithRouter = function (router) {
    const ler = typeof router.access === 'function' ? router.access('readonly') : router
    ler.get('/sessoes', (req, res) => {
      let linhas = []
      try {
        linhas = fs.readFileSync(ficheiroSessoes, 'utf8').trim().split('\n').filter(Boolean)
      } catch { /* ainda não há sessões */ }
      const n = Math.min(Number(req.query?.n) || 10, 100)
      res.json({
        runTimeS: sessao ? Math.round(sessao.runTimeS) : 0,
        sessoes: linhas.slice(-n).reverse().map(l => JSON.parse(l))
      })
    })
  }

  plugin.stop = function () {
    unsubscribes.forEach(f => f())
    unsubscribes = []
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (sessao) guardarRunTime()
    if (estado) normal(Object.keys(estado.ativos))
    estado = null
  }

  return plugin
}
