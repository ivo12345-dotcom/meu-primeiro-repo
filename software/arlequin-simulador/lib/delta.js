'use strict'
// Converte uma leitura do modelo numa delta SignalK com os mesmos caminhos
// que o plugin signalk-victron-ble e o J1939 vão entregar no barco.

function deltaDaLeitura (l, { servico = 'servico', motor = 'motor' } = {}) {
  const b = `electrical.batteries.${servico}.`
  return {
    updates: [{
      timestamp: new Date(l.t).toISOString(),
      values: [
        { path: b + 'capacity.stateOfCharge', value: l.soc },
        { path: b + 'voltage', value: l.tensao },
        { path: b + 'current', value: l.corrente },
        { path: `electrical.batteries.${motor}.voltage`, value: l.vMotor },
        { path: 'electrical.solar.mppt1.panelPower', value: l.pv[0] },
        { path: 'electrical.solar.mppt2.panelPower', value: l.pv[1] },
        { path: 'propulsion.main.revolutions', value: l.rpm },
        { path: 'navigation.speedOverGround', value: l.sog },
        { path: 'environment.mode', value: l.modo }
      ]
    }]
  }
}

module.exports = { deltaDaLeitura }
