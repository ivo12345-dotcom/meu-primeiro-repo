'use strict'
// Plugin SignalK: alarmes de energia e registo das cargas pelo motor do Arlequin.

const fs = require('node:fs')
const path = require('node:path')
const { novoEstado, avaliar, LIMITES, IDS } = require('./lib/regras')
const { novaSessao, passoSessao } = require('./lib/sessao')
const { registar, textoSessao } = require('./lib/diario')
const { criarAtivos } = require('./lib/ativos')

const RPM_VELHO = 2 * 60 * 1000 // sem rotação há 2 min = motor considerado parado
// A corrente sem atualizar há mais disto não entra nos Ah da sessão (o SmartShunt calou-se com o motor
// a trabalhar: antes integrava-se a última corrente e os Ah eram inventados — auditoria M-65).
const CORRENTE_VELHA = 2 * 60 * 1000
const PREFIXO = 'notifications.arlequin.energia.'
// Nota do SignalK 2.33 (adenda 2): ao parar o plugin o servidor apaga da árvore os valores dele. Os alarmes
// ativos ficam em alarmes-ativos.json (lib/ativos.js), com o estado das regras (os ativos, o navegar e o
// motor) e as últimas rotações; o arranque seguinte volta a publicá-los e continua a partir daí: a
// histerese do crítico, o "já podes desligar" com o motor ainda a trabalhar (as rotações de antes contam
// como recentes até chegarem outras, no máximo 2 min), o "sem dados do SmartShunt" até chegar um SoC.
// O stop() continua a pôr a árvore a normal (auditoria I-21).

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
  let ativosArq = null // os alarmes ativos no ficheiro (lib/ativos.js)

  // Hora "dos dados": o relógio do sistema corrigido pelo carimbo do último SoC
  // do SmartShunt (ver aoReceber). No barco dá o mesmo; com o simulador acelerado
  // segue o tempo simulado.
  const agora = () => Date.now() + desvio

  // registar: o ficheiro dos ativos segue as notificações publicadas (o "normal" do stop() não)
  function publicar (values, { registar = true } = {}) {
    app.handleMessage(plugin.id, { updates: [{ timestamp: new Date(agora()).toISOString(), values }] })
    if (registar) ativosArq?.registar(values)
  }

  // Um alarme não pode ficar preso na árvore (auditoria I-21): no stop() os ativos passam a normal; no
  // start() também os que ficaram de antes e não se repuseram (a regra volta a dar o alarme se ainda for
  // verdade).
  function normal (ids, o = {}) {
    if (ids.length) publicar(ids.map(id => ({ path: PREFIXO + id, value: { state: 'normal', method: [], message: 'Normal' } })), o)
  }
  const gravarAtivos = (o = {}) => estado && ativosArq?.gravar({ estado: { regras: estado, rpm: leitura.rpm }, ...o })

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

    // A sessão só com a corrente e o SoC recentes (sem eles: 0 Ah e "—" no diário, auditoria M-65).
    const corrente = t - leitura.correnteEm <= CORRENTE_VELHA ? leitura.corrente : null
    const soc = typeof leitura.soc === 'number' && t - leitura.socEm <= LIMITES.dadosVelhos ? leitura.soc : null
    const s = passoSessao(sessao, { motorLigado, corrente, soc }, t)
    const minutoAntes = Math.floor(sessao.runTimeS / 60)
    sessao = s.sessao
    const outroMinuto = Math.floor(sessao.runTimeS / 60) !== minutoAntes
    // As horas de motor gravam-se de minuto a minuto: um corte de energia a meio de horas a motor já
    // não as perde (antes só se gravavam ao fechar a sessão ou no stop — auditoria M-65).
    if (outroMinuto) guardarRunTime()
    if ((outroMinuto || !runTimePublicado) && !outraFonteDeHoras(t)) {
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
    gravarAtivos()
  }

  function aoReceber (delta) {
    const b = `electrical.batteries.${opcoes.servico}.`
    const caminhoSoc = b + 'capacity.stateOfCharge'
    for (const u of delta.updates ?? []) {
      const ts = u.timestamp ? Date.parse(u.timestamp) : Date.now()
      const valores = u.values ?? []
      // O relógio dos dados segue só o carimbo do SmartShunt (o SoC): com o simulador acelerado é o
      // tempo simulado; outra fonte noutro relógio (no dev, o J1939 em hora real; com o Pi
      // desacertado, um GPS com a hora dele) já não o faz saltar (auditoria M-60). As horas de cada
      // leitura ficam nesse relógio.
      if (!Number.isNaN(ts) && valores.some(v => v.path === caminhoSoc)) desvio = ts - Date.now()
      const t = agora()
      for (const { path: p, value } of valores) {
        if (p === caminhoSoc) { leitura.soc = value; if (typeof value === 'number') leitura.socEm = t }
        else if (p === b + 'current') { leitura.corrente = value; leitura.correnteEm = t }
        else if (p === `electrical.batteries.${opcoes.motor}.voltage`) leitura.vMotor = value
        else if (p === `propulsion.${opcoes.propulsao}.revolutions`) {
          // null = rotações desconhecidas (o J1939 sem EEC1 há 5 s): não apaga as últimas; sem um número
          // há 2 min (RPM_VELHO) o motor conta como parado — uma falha curta não parte a sessão (M-65)
          if (typeof value === 'number') { leitura.rpm = value; leitura.rpmEm = t }
        } else if (p === 'navigation.speedOverGround') leitura.sog = value
        else if (p === 'environment.mode') leitura.modo = value
      }
    }
    tick()
  }

  plugin.start = function (props) {
    opcoes = { servico: 'servico', motor: 'motor', propulsao: 'main', logbook: false, token: '', ...props }
    estado = novoEstado()
    desvio = 0
    // socEm começa na hora do arranque: o sensor perdido conta 5 min a partir daqui (auditoria M-59)
    leitura = { soc: null, socEm: agora(), corrente: 0, correnteEm: -Infinity, vMotor: null, rpm: null, rpmEm: 0, sog: 0, modo: 'day' }
    runTimePublicado = false
    inicioDados = null

    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    // Os alarmes que estavam ativos antes do reinício (nota do SignalK 2.33): voltam a publicar-se, com o
    // mesmo valor, e as regras continuam do estado em que estavam.
    ativosArq = criarAtivos(path.join(dir, 'alarmes-ativos.json'), { erro: (e) => app.error(e) })
    const r = ativosArq.repor()
    const repostos = Object.entries(r.ativos)
      .filter(([caminho]) => caminho.startsWith(PREFIXO) && IDS.includes(caminho.slice(PREFIXO.length)))
      .map(([caminho, valor]) => ({ path: caminho, value: valor }))
    if (repostos.length) {
      const regras = r.estado?.regras
      const ids = repostos.map(x => x.path.slice(PREFIXO.length))
      const t = agora()
      const antes = regras?.ativos && typeof regras.ativos === 'object' ? regras.ativos : {}
      estado = {
        ...novoEstado(),
        ...(regras?.navegar && typeof regras.navegar === 'object' ? { navegar: regras.navegar } : {}),
        ...(regras?.motor && typeof regras.motor === 'object' ? { motor: regras.motor } : {}),
        ativos: Object.fromEntries(ids.map(id => [id, { desde: antes[id]?.desde ?? t, ultimoEnvio: antes[id]?.ultimoEnvio ?? t }]))
      }
      // as rotações de antes contam como recentes (até chegarem outras, ou 2 min: RPM_VELHO)
      if (typeof r.estado?.rpm === 'number') { leitura.rpm = r.estado.rpm; leitura.rpmEm = t }
      // sem dados do SmartShunt antes do reinício: continua sem, até chegar um SoC (não 5 min depois)
      if (ids.includes('sensorPerdido')) leitura.socEm = -Infinity
      publicar(repostos)
    }
    normal(IDS.filter(id => !repostos.some(x => x.path === PREFIXO + id)).filter(id => { const s = app.getSelfPath?.(PREFIXO + id)?.value?.state; return s && s !== 'normal' }))
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
      // uma linha cortada (corte de energia a meio de uma escrita) salta-se: não parte a página Motor (M-66)
      const sessoes = linhas.flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
      res.json({
        runTimeS: sessao ? Math.round(sessao.runTimeS) : 0,
        sessoes: sessoes.slice(-n).reverse()
      })
    })
  }

  plugin.stop = function () {
    unsubscribes.forEach(f => f())
    unsubscribes = []
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (sessao) guardarRunTime()
    // o ficheiro fica com os ativos (o arranque seguinte repõe-nos); a árvore passa a normal (I-21)
    gravarAtivos({ forcar: true })
    if (estado) normal(Object.keys(estado.ativos), { registar: false })
    estado = null
  }

  return plugin
}
