'use strict'
// Plugin SignalK que finge o sistema elétrico do Arlequin (SmartShunt, MPPT,
// motor, GPS, dia/noite). Só para testes: no barco fica DESLIGADO.

const { criarModelo, avancar } = require('./lib/modelo')
const { CENARIOS, passoEm } = require('./lib/cenarios')
const { deltaDaLeitura } = require('./lib/delta')
const { criarNavegacao, avancarNav } = require('./lib/navegacao')
const { tramasMotor } = require('./lib/j1939sim')
const { tensoesSonda } = require('./lib/sonda')

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
      gasoleoPorSonda: { type: 'boolean', title: 'navegar-demo: o gasóleo chega pela sonda (para o plugin signalk-arlequin-gasoleo)', default: true },
      motorJ1939: { type: 'boolean', title: 'navegar-demo: o motor fala J1939 (para o plugin signalk-arlequin-j1939)', default: true },
      ventoDeGraus: { type: 'number', title: 'navegar-demo: de onde vem o vento real (graus)', default: 20 },
      colisaoRepeteMin: { type: 'number', title: 'navegar-demo: repetir o navio em colisão de N em N min (0 = só uma vez)', default: 0 },
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
      colisaoRepeteMin: o.colisaoRepeteMin ?? 0,
      cicloVelaS: (o.cicloVelaMin ?? 20) * 60,
      cicloMotorS: (o.cicloMotorMin ?? 5) * 60
    }, Date.now())
    let m = criarModelo(cenario.opcoes, Date.now())
    let segundos = 0
    // O D1-20B do Arlequin tem ~3200–3300 h (Ivo, 29/09): começa mesmo antes do
    // limite dos 2 bytes (3276,75 h) para o demo o atravessar.
    let horasMotorS = 3276.5 * 3600
    const pedaladas = [0, 0] // contadores das bombas de pé (como o ESP32 os daria)
    temporizador = setInterval(() => {
      const r = avancarNav(nav, 1000)
      nav = r.estado
      const en = avancar(m, 1000, { ...cenario.passos[0], motor: r.motor })
      m = en.modelo
      const j1939 = o.motorJ1939 !== false
      const porSonda = o.gasoleoPorSonda !== false
      // Com J1939 e com a sonda, os propulsion.main.* e o nível do depósito vêm
      // dos plugins do motor e do gasóleo, não daqui.
      const tirar = (p) => (j1939 && p.startsWith('propulsion.main.')) || (porSonda && p.startsWith('tanks.fuel.0.'))
      const semMotor = (d) => !d.context
        ? { ...d, updates: d.updates.map(u => ({ ...u, values: u.values.filter(v => !tirar(v.path)) })) }
        : d
      for (const d of r.deltas) app.handleMessage(plugin.id, semMotor(d))
      app.handleMessage(plugin.id, semMotor(deltaDaLeitura(en.leitura, o)))
      // Água doce: pedaladas nas bombas de pé (cozinha ~1 a cada 2 min, WC ~1 a cada 3 min).
      if (Math.random() < 1 / 120) pedaladas[0] += 1 + Math.floor(Math.random() * 3)
      if (Math.random() < 1 / 180) pedaladas[1] += 1 + Math.floor(Math.random() * 2)
      app.handleMessage(plugin.id, { updates: [{ values: [
        { path: 'tanks.freshWater.0.pedaladas', value: pedaladas[0] },
        { path: 'tanks.freshWater.1.pedaladas', value: pedaladas[1] }
      ] }] })
      if (porSonda) {
        const roll = r.deltas[0].updates[0].values.find(x => x.path === 'navigation.attitude')?.value?.roll ?? 0
        const t = tensoesSonda({ litros: nav.combustivel * 1000, alimentacao: r.motor ? 14.2 : en.leitura.tensao, roll, sog: r.sog })
        app.handleMessage(plugin.id, { updates: [{ values: [
          { path: 'tanks.fuel.0.senderVoltage', value: t.sonda },
          { path: 'tanks.fuel.0.supplyVoltage', value: t.alimentacao }
        ] }] })
      }
      if (j1939) {
        if (r.motor) horasMotorS += 1
        const volt = r.motor ? 14.2 : en.leitura.vMotor
        for (const l of tramasMotor({ t: Date.now(), rpm: en.leitura.rpm * 60, tempK: nav.tempMotor, volt, horasS: horasMotorS })) app.emit('arlequin-j1939', l)
      }
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
