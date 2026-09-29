'use strict'
// Plugin SignalK que finge o sistema elétrico do Arlequin (SmartShunt, MPPT,
// motor, GPS, dia/noite). Só para testes: no barco fica DESLIGADO.

const { criarModelo, avancar } = require('./lib/modelo')
const { CENARIOS, passoEm } = require('./lib/cenarios')
const { deltaDaLeitura } = require('./lib/delta')

module.exports = function (app) {
  const plugin = {
    id: 'arlequin-simulador',
    name: 'Arlequin · simulador (só testes)',
    description: 'Finge baterias, painéis, motor e GPS para testar os plugins em casa. Desligar no barco.'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      cenario: { type: 'string', title: 'Cenário', enum: Object.keys(CENARIOS), default: 'inverno-navegar' },
      msPorHora: { type: 'number', title: 'Milissegundos reais por hora simulada', default: 2000 },
      inicio: { type: 'string', title: 'Início da simulação (data/hora ISO)', default: '2026-01-10T08:00:00' },
      servico: { type: 'string', title: 'ID do banco de serviço', default: 'servico' },
      motor: { type: 'string', title: 'ID do banco do motor', default: 'motor' }
    }
  }

  let temporizador = null

  plugin.start = function (props) {
    const o = { cenario: 'inverno-navegar', msPorHora: 2000, inicio: '2026-01-10T08:00:00', servico: 'servico', motor: 'motor', ...props }
    const cenario = CENARIOS[o.cenario]
    if (!cenario) return app.setPluginError(`cenário desconhecido: ${o.cenario}`)

    const PASSO_MIN = 1
    let m = criarModelo(cenario.opcoes, new Date(o.inicio).getTime())
    let minuto = 0

    temporizador = setInterval(() => {
      const passo = passoEm(cenario, minuto)
      if (!passo) {
        clearInterval(temporizador)
        temporizador = null
        app.setPluginStatus(`Cenário "${o.cenario}" terminado`)
        return
      }
      const r = avancar(m, PASSO_MIN * 60 * 1000, passo)
      m = r.modelo
      minuto += PASSO_MIN
      const l = r.leitura
      app.handleMessage(plugin.id, deltaDaLeitura(l, o))
      if (minuto % 60 === 0) {
        app.setPluginStatus(`${o.cenario} · ${new Date(l.t).toLocaleString('pt-PT')} · serviço ${Math.round(l.soc * 100)}%`)
      }
    }, o.msPorHora / 60 * PASSO_MIN)

    app.setPluginStatus(`A simular "${o.cenario}": ${cenario.descricao}`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  return plugin
}
