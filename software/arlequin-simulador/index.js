'use strict'
// Plugin SignalK que finge o sistema elétrico do Arlequin (SmartShunt, MPPT,
// motor, GPS, dia/noite). Só para testes: no barco fica DESLIGADO.

const { criarModelo, avancar } = require('./lib/modelo')
const { CENARIOS, passoEm } = require('./lib/cenarios')
const { deltaDaLeitura } = require('./lib/delta')
const { criarNavegacao, avancarNav } = require('./lib/navegacao')

module.exports = function (app) {
  const plugin = {
    id: 'arlequin-simulador',
    name: 'Arlequin · simulador (só testes)',
    description: 'Finge baterias, painéis, motor e GPS para testar os plugins em casa. Desligar no barco.'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      cenario: { type: 'string', title: 'Cenário', enum: Object.keys(CENARIOS), default: 'navegar-demo' },
      msPorHora: { type: 'number', title: 'Milissegundos reais por hora simulada', default: 2000 },
      inicio: { type: 'string', title: 'Início da simulação (data/hora ISO)', default: '2026-01-10T08:00:00' },
      ventoDeGraus: { type: 'number', title: 'navegar-demo: de onde vem o vento real (graus)', default: 20 },
      cicloVelaMin: { type: 'number', title: 'navegar-demo: minutos à vela em cada ciclo', default: 20 },
      cicloMotorMin: { type: 'number', title: 'navegar-demo: minutos a motor em cada ciclo', default: 5 },
      servico: { type: 'string', title: 'ID do banco de serviço', default: 'servico' },
      motor: { type: 'string', title: 'ID do banco do motor', default: 'motor' }
    }
  }

  let temporizador = null

  plugin.start = function (props) {
    const o = { cenario: 'navegar-demo', msPorHora: 2000, inicio: '2026-01-10T08:00:00', servico: 'servico', motor: 'motor', ...props }
    const cenario = CENARIOS[o.cenario]
    if (!cenario) return app.setPluginError(`cenário desconhecido: ${o.cenario}`)

    if (cenario.tempoReal) return comecarTempoReal(o, cenario)

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

  // Navegação + energia ao ritmo do relógio (1 passo por segundo), para o ecrã.
  function comecarTempoReal (o, cenario) {
    let nav = criarNavegacao({
      ventoDir: (o.ventoDeGraus ?? 20) * Math.PI / 180,
      cicloVelaS: (o.cicloVelaMin ?? 20) * 60,
      cicloMotorS: (o.cicloMotorMin ?? 5) * 60
    }, Date.now())
    let m = criarModelo(cenario.opcoes, Date.now())
    let segundos = 0
    temporizador = setInterval(() => {
      const r = avancarNav(nav, 1000)
      nav = r.estado
      const en = avancar(m, 1000, { ...cenario.passos[0], motor: r.motor })
      m = en.modelo
      for (const d of r.deltas) app.handleMessage(plugin.id, d)
      app.handleMessage(plugin.id, deltaDaLeitura(en.leitura, o))
      if (++segundos % 30 === 0) {
        app.setPluginStatus(`${o.cenario} · ${r.motor ? 'a motor' : 'à vela'} · SOG ${(r.sog * 3600 / 1852).toFixed(1)} nós · serviço ${Math.round(en.leitura.soc * 100)}%`)
      }
    }, 1000)
    app.setPluginStatus(`A simular "${o.cenario}": ${cenario.descricao}`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  return plugin
}
