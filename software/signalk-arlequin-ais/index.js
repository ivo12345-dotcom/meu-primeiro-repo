'use strict'
// Plugin SignalK: alarme de colisão AIS (CPA/TCPA) no servidor, para avisar
// mesmo com o ecrã desligado. Publica notifications.arlequin.ais.<mmsi>.

const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { avaliarAlvos } = require('./lib/vigia')

function caminhoCpa () {
  const aoLado = path.join(__dirname, '..', 'arlequin-ecra', 'public', 'lib', 'cpa.js')
  if (fs.existsSync(aoLado)) return aoLado
  return require.resolve('arlequin-ecra/public/lib/cpa.js')
}

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-ais',
    name: 'Arlequin · alarme AIS',
    description: 'Alarme de colisão AIS (CPA < 0,5 MN e TCPA < 20 min) com o mesmo cálculo do ecrã'
  }
  plugin.schema = { type: 'object', properties: {} }

  let temporizador = null
  let ativos = {}
  let memoria // distâncias de cada alvo e se estamos amarrados (lib/vigia.js), de avaliação em avaliação
  let geracao = 0 // cada start/stop muda-a: o cálculo que acabe de carregar depois de um stop não arma nada

  const valor = (no, p) => p.split('.').reduce((o, k) => o?.[k], no)?.value

  function publicar (notificacoes) {
    if (!notificacoes.length) return
    app.handleMessage(plugin.id, {
      updates: [{
        values: notificacoes.map(n => ({
          path: `notifications.arlequin.ais.${n.mmsi}`,
          value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) }
        }))
      }]
    })
  }

  // Um alarme não pode ficar preso na árvore (auditoria I-21): ao arrancar, os alarmes AIS que ficaram
  // ativos de antes passam a normal (se o perigo continuar, volta a dar o alarme no ciclo seguinte).
  function limparPresos () {
    const arvore = app.getSelfPath?.('notifications.arlequin.ais')
    const presos = Object.entries(arvore && typeof arvore === 'object' ? arvore : {})
      .filter(([, no]) => no?.value?.state && no.value.state !== 'normal')
      .map(([mmsi]) => ({ mmsi, state: 'normal', method: [], message: 'Normal' }))
    publicar(presos)
  }

  function alvosAis () {
    const vessels = app.getPath('vessels') || {}
    const lista = []
    for (const [id, v] of Object.entries(vessels)) {
      if (id === app.selfId || id === 'self') continue
      const pos = v.navigation?.position
      if (!pos?.value) continue
      lista.push({
        mmsi: v.mmsi || id.split(':').pop(),
        nome: v.name,
        position: pos.value,
        cog: valor(v, 'navigation.courseOverGroundTrue'),
        sog: valor(v, 'navigation.speedOverGround'),
        em: Date.parse(pos.timestamp)
      })
    }
    return lista
  }

  plugin.start = function () {
    const g = ++geracao
    ativos = {}
    memoria = undefined
    limparPresos()
    // o cálculo é um módulo ES (o do ecrã): carrega-se à parte; plugin.pronto acaba quando o vigia arranca
    plugin.pronto = import(pathToFileURL(caminhoCpa()).href).then((calc) => {
      if (g !== geracao) return // parou (ou voltou a arrancar) enquanto carregava: sem temporizador órfão
      temporizador = setInterval(() => {
        const eu = {
          position: app.getSelfPath('navigation.position')?.value,
          cog: app.getSelfPath('navigation.courseOverGroundTrue')?.value,
          sog: app.getSelfPath('navigation.speedOverGround')?.value
        }
        if (!eu.position) return
        // O relógio dos alvos: a hora da última posição (no simulador e no barco).
        const alvos = alvosAis()
        const agora = Math.max(Date.now(), ...alvos.map(a => a.em || 0))
        const r = avaliarAlvos(ativos, eu, alvos, agora, calc, memoria)
        ativos = r.ativos
        memoria = r.memoria
        publicar(r.notificacoes)
        for (const n of r.notificacoes) app.debug(`${n.mmsi} ${n.state}: ${n.message}`)
        app.setPluginStatus(`${alvos.length} alvos AIS · ${Object.keys(ativos).length} em perigo${memoria.amarrado ? ' · amarrado: os alvos parados não dão alarme' : ''}`)
      }, 2000)
    }, (e) => { if (g === geracao) app.setPluginError(`não encontrei o cálculo de CPA: ${e.message}`) })
  }

  plugin.stop = function () {
    geracao++
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    // os alarmes ativos passam a normal (auditoria I-21): um reinício pelo Admin UI não os deixa presos
    publicar(Object.keys(ativos).map(mmsi => ({ mmsi, state: 'normal', method: [], message: 'Normal' })))
    ativos = {}
  }

  return plugin
}
