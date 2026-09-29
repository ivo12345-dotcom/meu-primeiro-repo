'use strict'
// Plugin SignalK: caixa negra do Arlequin. Grava TUDO desde o primeiro dia em
// ~/arlequin-dados: bruto/ (todas as mensagens, 1 ficheiro por hora), tabela/
// (uma linha a cada 10 s para a AI), saidas/ (resumo de cada saída) e
// previsoes/ (escrita pelo plugin da rota). Só apaga do bruto o que o portátil
// já confirmou, e só quando o disco passa os 80%. Guarda o estado das velas.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarGravadorBruto } = require('./lib/bruto')
const est = require('./lib/estado')
const estavel = require('./lib/estavel')
const tabela = require('./lib/tabela')
const saidasLib = require('./lib/saidas')
const confirmados = require('./lib/confirmados')
const disco = require('./lib/disco')
const velasLib = require('./lib/velas')
const { PORTOS, portoMaisPerto } = require('./lib/geo')

const NOME_GRANDE = { 0: 'inteira', 1: '1 rizo', 2: '2 rizos', '-1': 'arriada' }

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-caixanegra',
    name: 'Arlequin · caixa negra',
    description: 'Grava todos os dados desde o primeiro dia (bruto, tabela de 10 s para a AI, saídas) e o estado das velas'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      pasta: { type: 'string', title: 'Pasta dos dados', default: '~/arlequin-dados' },
      limiteAviso: { type: 'number', title: 'Aviso e arquivo a partir de (% do disco)', default: 80 },
      limiteParar: { type: 'number', title: 'Parar o bruto a partir de (% do disco)', default: 95 },
      portos: {
        type: 'array',
        title: 'Portos (para detetar as saídas)',
        default: PORTOS,
        items: { type: 'object', properties: { nome: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } } }
      }
    }
  }

  let o = {}
  let base
  let dirPlugin
  let bruto
  let estado
  let janela
  let saidas
  let velas
  let temporizador = null
  let contador = 0
  let ultimaLinha = null
  let infoDisco = null
  let avisoDisco = 'normal'
  let erros = 0

  const aoDelta = (delta) => {
    const agora = Date.now()
    bruto.escrever(delta, agora)
    est.aplicar(estado, delta, app.selfContext, agora)
  }

  const publicar = (values) => app.handleMessage(plugin.id, { updates: [{ values }] })
  const notificar = (id, state, message, method = ['visual']) =>
    publicar([{ path: `notifications.arlequin.caixanegra.${id}`, value: { state, method: state === 'normal' ? [] : method, message } }])
  const publicarVelas = () =>
    publicar([{ path: 'sails.grande.rizos', value: velas.grandeRizos }, { path: 'sails.genoa.percentagem', value: velas.genoaPct }])

  const ficheiroVelas = () => path.join(dirPlugin, 'velas.json')
  const ficheiroSaida = () => path.join(dirPlugin, 'saida-em-curso.json')
  const ler = (f, omissao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return omissao } }
  function guardar (f, obj) {
    try { fs.writeFileSync(f, JSON.stringify(obj)) } catch (e) { erros++; app.error(`não guardei ${path.basename(f)}: ${e.message}`) }
  }

  function twsMedio () {
    const xs = janela.map(a => a.tws).filter(Number.isFinite)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined
  }

  function listarBruto () {
    const dir = path.join(base, 'bruto')
    return fs.readdirSync(dir).filter(n => n.endsWith('.gz')).map(n => ({ ficheiro: `bruto/${n}`, bytes: fs.statSync(path.join(dir, n)).size }))
  }

  function segundo () {
    const agora = Date.now()
    const v = (c) => est.valor(estado, c, agora)
    estavel.juntar(janela, { t: agora, proa: v('navigation.headingTrue'), stw: v('navigation.speedThroughWater'), tws: v('environment.wind.speedTrue') })
    contador++
    if (contador % 10 === 0) dezSegundos(agora, v)
    if (contador % 60 === 0) minuto()
  }

  function dezSegundos (agora, v) {
    try { bruto.despejar() } catch (e) { erros++; app.error(`bruto: ${e.message}`) }
    const pos = v('navigation.position')
    const perto = portoMaisPerto(pos, o.portos)
    const simulado = est.simuladoRecente(estado, agora)
    const eEstavel = !simulado && estavel.estavel(janela, { longeDoPorto: !!perto && perto.mn > 0.5 })
    try {
      tabela.escrever(path.join(base, 'tabela'), agora, tabela.linha({ v, agora, rajadaMs: estavel.rajada(janela), simulado, estavel: eEstavel }))
      ultimaLinha = agora
    } catch (e) { erros++; app.error(`tabela: ${e.message}`) }
    const rps = v('propulsion.main.revolutions')
    const caudal = v('propulsion.main.fuel.rate')
    const r = saidasLib.atualizar(saidas, {
      t: agora,
      pos,
      sog: v('navigation.speedOverGround'),
      motor: Number.isFinite(rps) && rps > 5,
      litrosHora: Number.isFinite(caudal) ? caudal * 3.6e6 : undefined,
      soc: v('electrical.batteries.servico.capacity.stateOfCharge'),
      simulado
    }, o.portos)
    saidas = r.s
    if (r.terminada) guardar(path.join(base, 'saidas', r.terminada.inicio.slice(0, 16).replace(':', '-') + '.json'), r.terminada)
    if (velasLib.precisaLembrete(velas, agora, twsMedio())) {
      velas = { ...velas, lembradoEm: agora }
      guardar(ficheiroVelas(), velas)
      notificar('velas', 'warn', `As velas continuam assim? Grande ${NOME_GRANDE[velas.grandeRizos]}, genoa ${velas.genoaPct}%`)
    }
  }

  function verificarDisco () {
    const u = disco.usoDisco(base)
    const plano = disco.planear({ ...u, ficheiros: listarBruto(), confirmados: confirmados.lerConfirmados(base), limiteAviso: o.limiteAviso, limiteParar: o.limiteParar })
    const apagados = plano.apagar.length ? confirmados.apagarConfirmados(base, plano.apagar) : []
    infoDisco = { ...u, aviso: plano.aviso, apagados: apagados.length }
    const pct = Math.round(u.usadoPct)
    if (plano.pararBruto) {
      if (!bruto.parado) bruto.parar()
      if (avisoDisco !== 'alarm') {
        avisoDisco = 'alarm'
        notificar('disco', 'alarm', `Disco a ${pct}%: parei de gravar o bruto (a tabela continua). Liga o portátil para copiar os dados.`, ['visual', 'sound'])
      }
      return
    }
    if (bruto.parado && u.usadoPct < o.limiteParar - 5) bruto.retomar()
    if (bruto.parado) return
    const novo = plano.aviso ? 'warn' : 'normal'
    if (novo !== avisoDisco) {
      avisoDisco = novo
      notificar('disco', novo, novo === 'warn' ? `Disco a ${pct}%: copia os dados para o portátil` : 'Normal')
    }
  }

  function minuto () {
    try {
      const r = confirmados.processarEntrada(base)
      if (r.rejeitados.length) app.error(`confirmações rejeitadas: ${r.rejeitados.map(x => `${x.ficheiro} (${x.motivo})`).join(', ')}`)
    } catch (e) { erros++; app.error(`entrada: ${e.message}`) }
    guardar(ficheiroSaida(), saidas)
    try { verificarDisco() } catch (e) { erros++; app.error(`disco: ${e.message}`) }
    const mb = listarBruto().reduce((s, f) => s + f.bytes, 0) / 1e6
    const hora = ultimaLinha ? new Date(ultimaLinha).toLocaleTimeString('pt-PT') : '—'
    app.setPluginStatus(`${bruto.parado ? 'BRUTO PARADO · ' : ''}bruto ${mb.toFixed(1)} MB · disco ${Math.round(infoDisco?.usadoPct ?? 0)}% · última linha ${hora}`)
  }

  plugin.start = function (props) {
    o = { pasta: '~/arlequin-dados', limiteAviso: 80, limiteParar: 95, portos: PORTOS, ...props }
    base = o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta
    for (const d of ['bruto', 'tabela', 'saidas', 'previsoes', 'entrada']) fs.mkdirSync(path.join(base, d), { recursive: true })
    dirPlugin = app.getDataDirPath()
    fs.mkdirSync(dirPlugin, { recursive: true })
    bruto = criarGravadorBruto(path.join(base, 'bruto'))
    estado = est.novoEstado()
    janela = estavel.novaJanela()
    saidas = ler(ficheiroSaida(), saidasLib.novaSaidas())
    velas = { ...velasLib.novoEstadoVelas(), ...ler(ficheiroVelas(), {}) }
    contador = 0
    ultimaLinha = null
    infoDisco = null
    avisoDisco = 'normal'
    erros = 0
    publicarVelas()
    app.signalk.on('unfilteredDelta', aoDelta)
    temporizador = setInterval(segundo, 1000)
    app.setPluginStatus(`A gravar em ${base}`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    app.signalk?.removeListener('unfilteredDelta', aoDelta)
    if (bruto) { try { bruto.despejar() } catch (e) { app.error(`bruto: ${e.message}`) } }
    if (saidas && dirPlugin) guardar(ficheiroSaida(), saidas)
  }

  plugin.registerWithRouter = function (router) {
    router.get('/estado', (req, res) => {
      res.json({
        pasta: base,
        disco: infoDisco,
        bruto: { parado: bruto.parado, ficheiros: listarBruto().length },
        ultimaLinha: ultimaLinha ? new Date(ultimaLinha).toISOString() : null,
        erros,
        velas: { grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct },
        saidaEmCurso: saidas.emCurso
          ? { inicio: new Date(saidas.emCurso.inicio).toISOString(), de: saidas.emCurso.de, milhas: Math.round(saidas.emCurso.milhas * 10) / 10 }
          : null
      })
    })
    router.get('/ficheiros', (req, res) => {
      const desde = req.query?.desde ? Date.parse(req.query.desde) : 0
      const lista = []
      for (const d of ['bruto', 'tabela', 'saidas', 'previsoes']) {
        for (const n of fs.readdirSync(path.join(base, d))) {
          const s = fs.statSync(path.join(base, d, n))
          if (s.mtimeMs >= desde) lista.push({ ficheiro: `${d}/${n}`, bytes: s.size, alterado: s.mtime.toISOString() })
        }
      }
      res.json({ ficheiros: lista })
    })
    router.get('/velas', (req, res) => res.json({ grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct }))
    router.post('/velas', (req, res) => {
      const pedido = {}
      if (req.body?.grandeRizos !== undefined) pedido.grandeRizos = Number(req.body.grandeRizos)
      if (req.body?.genoaPct !== undefined) pedido.genoaPct = Number(req.body.genoaPct)
      try { velas = velasLib.mudar(velas, pedido, Date.now(), twsMedio()) } catch (e) { return res.status(400).json({ ok: false, erro: e.message }) }
      guardar(ficheiroVelas(), velas)
      publicarVelas()
      notificar('velas', 'normal', 'Normal')
      res.json({ ok: true, grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct })
    })
  }

  return plugin
}
