'use strict'
// Plugin do ecrã: recebe do painel web os pedidos de disposição das janelas
// (Carta = OpenCPN 58% + painel; resto = painel em ecrã inteiro) e de modo
// noite, e corre os comandos configurados no Pi (ex.: wmctrl, xdotool).
// No portátil os comandos ficam vazios e só se regista o pedido.

const { exec } = require('node:child_process')

module.exports = function (app) {
  const plugin = {
    id: 'arlequin-ecra',
    name: 'Arlequin · ecrã',
    description: 'Painel da roda (webapp em /arlequin-ecra/) e controlo das janelas OpenCPN/painel'
  }

  plugin.schema = {
    type: 'object',
    description: 'Comandos de shell corridos no Pi. Vazio = não faz nada (portátil).',
    properties: {
      layoutCarta: { type: 'string', title: 'Comando: Carta (OpenCPN à esquerda 58%, painel à direita)', default: '' },
      layoutInteiro: { type: 'string', title: 'Comando: painel em ecrã inteiro', default: '' },
      noiteOn: { type: 'string', title: 'Comando: OpenCPN em modo noite', default: '' },
      noiteOff: { type: 'string', title: 'Comando: OpenCPN em modo dia', default: '' }
    }
  }

  let opcoes = {}
  let ultimo = null

  function correr (nome, comando, res) {
    ultimo = { nome, em: new Date().toISOString() }
    if (!comando) {
      app.setPluginStatus(`Pedido "${nome}" (sem comando configurado)`)
      return res.json({ ok: true, corrido: false })
    }
    exec(comando, { timeout: 5000 }, (erro, out, errOut) => {
      if (erro) {
        app.setPluginError(`"${nome}" falhou: ${errOut || erro.message}`)
        return res.status(500).json({ ok: false, erro: String(errOut || erro.message) })
      }
      app.setPluginStatus(`"${nome}" feito`)
      res.json({ ok: true, corrido: true })
    })
  }

  plugin.registerWithRouter = function (router) {
    router.post('/janela', (req, res) => {
      const b = req.body || {}
      if (b.layout === 'carta') return correr('carta', opcoes.layoutCarta, res)
      if (b.layout === 'inteiro') return correr('inteiro', opcoes.layoutInteiro, res)
      if (b.noite === true) return correr('noite', opcoes.noiteOn, res)
      if (b.noite === false) return correr('dia', opcoes.noiteOff, res)
      res.status(400).json({ ok: false, erro: 'pedido desconhecido' })
    })
    router.get('/janela', (req, res) => res.json({ ultimo }))
  }

  plugin.start = function (props) {
    opcoes = { ...props }
    app.setPluginStatus('Pronto · painel em /arlequin-ecra/')
  }
  plugin.stop = function () {}

  return plugin
}
