'use strict'
// Plugin SignalK que finge o sistema elétrico do Arlequin (SmartShunt, MPPT,
// motor, GPS, dia/noite). Só para testes: no barco fica DESLIGADO.

const { criarModelo, avancar, PADRAO } = require('./lib/modelo')
const { CENARIOS, passoEm } = require('./lib/cenarios')
const { deltaDaLeitura } = require('./lib/delta')
const { criarNavegacao, avancarNav, motorLigado } = require('./lib/navegacao')
const { tramasMotor } = require('./lib/j1939sim')
const { tensoesSonda, razaoSimulada } = require('./lib/sonda')
const { pontoMaisPerto, deltaDoPonto } = require('./lib/replay')
const path = require('node:path')
const fs = require('node:fs')

// As horas dos textos na hora de Lisboa, seja qual for o fuso do sistema (decisão n.º 22; revisão F6, Menor 12).
const horaLisboa = (t) => new Date(t).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })
// O motor por J1939 como o MDI verdadeiro (revisão F6, Importante 3; contrato C11): com a ignição desligada o
// MDI cala-se — à vela não há tramas. A ignição liga-se IGNICAO_MS antes de arrancar (pré-aquecimento) e
// desliga-se IGNICAO_MS depois de parar: aí as tramas vão a 0 rpm, com o padrão da 65417 da ignição ligada.
const IGNICAO_MS = 10 * 1000
const RPM_CRUZEIRO = PADRAO.rpmMotorHz * 60 // 2100 rpm, as da rota e do modelo de energia (auditoria M-69)

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
      instantePassagem: { type: 'string', title: 'Passagem simulada: congelar neste instante (ISO local, ex.: 2026-09-29T21:00)', default: '' },
      gasoleoPorSonda: { type: 'boolean', title: 'navegar-demo: o gasóleo chega pela sonda (para o plugin signalk-arlequin-gasoleo)', default: true },
      motorJ1939: { type: 'boolean', title: 'navegar-demo: o motor fala J1939 (para o plugin signalk-arlequin-j1939)', default: true },
      ventoDeGraus: { type: 'number', title: 'navegar-demo: de onde vem o vento real (graus)', default: 20 },
      colisaoRepeteMin: { type: 'number', title: 'navegar-demo: repetir o navio em colisão de N em N min (0 = só uma vez)', default: 0 },
      cicloVelaMin: { type: 'number', title: 'navegar-demo: minutos à vela em cada ciclo', default: 20 },
      cicloMotorMin: { type: 'number', title: 'navegar-demo: minutos a motor em cada ciclo', default: 5 },
      servico: { type: 'string', title: 'ID do banco de serviço', default: 'servico' },
      motor: { type: 'string', title: 'ID do banco do motor', default: 'motor' },
      pastaPassagem: { type: 'string', title: 'Passagem simulada: a pasta do passagem.json e do rota.json (vazio = software/ferramentas/passagem)', default: '' }
    }
  }

  let temporizador = null

  plugin.start = function (props) {
    const o = { cenario: 'navegar-demo', msPorHora: 2000, inicio: '2026-01-10T08:00:00', servico: 'servico', motor: 'motor', ...props }
    const cenario = CENARIOS[o.cenario]
    if (!cenario) return app.setPluginError(`cenário desconhecido: ${o.cenario}`)

    if (o.instantePassagem) return comecarPassagem(o)
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
        app.setPluginStatus(`${o.cenario} · ${horaLisboa(l.t)} · serviço ${Math.round(l.soc * 100)}%`)
      }
    }, o.msPorHora / 60 * PASSO_MIN)

    app.setPluginStatus(`A simular "${o.cenario}": ${cenario.descricao}`)
  }

  // Navegação + energia ao ritmo do relógio (1 passo por segundo), para o ecrã.
  function comecarTempoReal (o, cenario) {
    let m = criarModelo(cenario.opcoes, Date.now())
    let nav = criarNavegacao({
      ventoDir: (o.ventoDeGraus ?? 20) * Math.PI / 180,
      colisaoRepeteMin: o.colisaoRepeteMin ?? 0,
      cicloVelaS: (o.cicloVelaMin ?? 20) * 60,
      cicloMotorS: (o.cicloMotorMin ?? 5) * 60,
      rpmMotor: m.c.rpmMotorHz * 60 // o consumo da sonda pelas mesmas rotações que o J1939 (M-69)
    }, Date.now())
    const destino = vigiarDestino()
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
      const tirar = (p) => (j1939 && p.startsWith('propulsion.main.')) || (porSonda && p.startsWith('tanks.fuel.0.')) ||
        (destino.externo && p.startsWith('navigation.course.'))
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
      // a ignição ligada: a motor, ou até IGNICAO_MS antes de arrancar e depois de parar (o ciclo é fixo)
      const ignicao = r.motor || motorLigado({ ...nav, t: nav.t + IGNICAO_MS }) || motorLigado({ ...nav, t: nav.t - IGNICAO_MS })
      if (j1939 && ignicao) {
        if (r.motor) horasMotorS += 1
        const volt = r.motor ? 14.2 : en.leitura.vMotor
        for (const l of tramasMotor({ t: Date.now(), rpm: en.leitura.rpm * 60, tempK: nav.tempMotor, volt, horasS: horasMotorS })) app.emit('arlequin-j1939', l)
      }
      if (segundos % 5 === 4) destino.ver()
      if (++segundos % 30 === 0) {
        app.setPluginStatus(`${o.cenario} · ${r.motor ? 'a motor' : 'à vela'} · SOG ${(r.sog * 3600 / 1852).toFixed(1)} nós · serviço ${Math.round(en.leitura.soc * 100)}%`)
      }
    }, 1000)
    app.setPluginStatus(`A simular "${o.cenario}": ${cenario.descricao}`)
  }

  // Duas fontes de rumo no dev (auditoria M-49): com um destino na API de rumo (a rota ativada pelo
  // plugin da rota) o course-provider calcula navigation.course.*, e o simulador deixa de publicar os do
  // seu WP (o do demo ou o da passagem); sem destino nenhum publica-os (o ecrã mostra o WP). Vê-se no
  // arranque e depois de 5 em 5 s (quem chama faz o ver()).
  function vigiarDestino () {
    const d = { externo: false }
    d.ver = () => Promise.resolve()
      .then(() => (typeof app.getCourse === 'function' ? app.getCourse() : null))
      .then((c) => { d.externo = !!(c?.activeRoute?.href || c?.nextPoint?.position) }, () => {})
    d.ver()
    return d
  }

  // Passagem simulada (ferramentas/passagem): o sistema "vive" um instante dela. Sem os ficheiros (não
  // estão no git: gera-os o simular.mjs) diz o que falta em vez de rebentar no start (auditoria M-69).
  // Como no demo: sem navigation.course.* por cima do course-provider (revisão F6, Menor 11) e o motor por
  // J1939 só com a ignição ligada, às rotações de cruzeiro.
  function comecarPassagem (o) {
    const dir = o.pastaPassagem || path.join(__dirname, '..', 'ferramentas', 'passagem')
    let pontos, ROTA
    try {
      pontos = JSON.parse(fs.readFileSync(path.join(dir, 'passagem.json'), 'utf8'))
      ROTA = JSON.parse(fs.readFileSync(path.join(dir, 'rota.json'), 'utf8')).ROTA
      if (!Array.isArray(pontos) || !pontos.length || !Array.isArray(ROTA)) throw new Error('ficheiros sem pontos ou sem rota')
    } catch (e) {
      return app.setPluginError(`a passagem simulada precisa do passagem.json e do rota.json em ${dir} (gera-os com node software/ferramentas/passagem/simular.mjs): ${e.message}`)
    }
    const p = pontoMaisPerto(pontos, new Date(o.instantePassagem).getTime())
    const horas = 3276.5 * 3600
    const destino = vigiarDestino()
    let segundos = 0
    temporizador = setInterval(() => {
      const d = deltaDoPonto(p, ROTA)
      if (destino.externo) d.updates = d.updates.map(u => ({ ...u, values: u.values.filter(v => !v.path.startsWith('navigation.course.')) }))
      app.handleMessage(plugin.id, d)
      const razao = razaoSimulada(p.gasoleo)
      const v = p.motor ? 14.2 : 12.7
      app.handleMessage(plugin.id, { updates: [{ values: [
        { path: 'tanks.fuel.0.senderVoltage', value: razao * v }, { path: 'tanks.fuel.0.supplyVoltage', value: v },
        { path: 'tanks.freshWater.0.pedaladas', value: 0 }, { path: 'tanks.freshWater.1.pedaladas', value: 0 }
      ] }] })
      // à vela (o instante está congelado) a ignição fica desligada: o MDI não fala
      if (p.motor) for (const l of tramasMotor({ t: Date.now(), rpm: RPM_CRUZEIRO, tempK: 355, volt: v, horasS: horas })) app.emit('arlequin-j1939', l)
      if (++segundos % 5 === 0) destino.ver()
    }, 1000)
    app.setPluginStatus(`Passagem: ${horaLisboa(p.t)} · ${p.wp} · ${p.motor ? 'motor' : 'vela'} · vento ${Math.round(p.tws)} nós`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  return plugin
}
