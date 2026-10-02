'use strict'
// Plugin SignalK: caixa negra do Arlequin. Grava TUDO desde o primeiro dia em
// ~/arlequin-dados: bruto/ (todas as mensagens, 1 ficheiro por hora), tabela/
// (uma linha a cada 10 s para a AI), saidas/ (resumo de cada saída) e
// previsoes/ (escrita pelo plugin da AI, signalk-arlequin-ia). Só apaga do bruto o que o portátil
// já confirmou, e só quando o disco passa os 80%. Guarda o estado das velas.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarGravadorBruto, nomeHora, isolarSeDanificado } = require('./lib/bruto')
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
  let relogioErrado = false
  let erros = 0

  // Corre dentro do emit do SignalK: se rebentasse aqui, a mensagem perdia-se
  // para o servidor todo. Conta sempre o erro, mas só o regista 1 vez por minuto.
  let ultimoErroDelta = -Infinity
  const falhouDelta = (e, agora) => {
    erros++
    if (agora - ultimoErroDelta >= 60000) {
      ultimoErroDelta = agora
      app.error(`caixa negra: mensagem não gravada: ${e.message}`)
    }
  }
  const aoDelta = (delta) => {
    const agora = Date.now()
    // Separados: se o bruto não a consegue gravar, os valores contam na mesma para a tabela.
    try { bruto.escrever(delta, agora) } catch (e) { falhouDelta(e, agora) }
    try { est.aplicar(estado, delta, app.selfContext, agora) } catch (e) { falhouDelta(e, agora) }
  }

  const publicar = (values) => app.handleMessage(plugin.id, { updates: [{ values }] })
  // `extra` vai no valor da notificação (ex.: { apito: 'curto' }, o contrato C1 com o ecrã).
  const notificar = (id, state, message, method = ['visual'], extra = {}) =>
    publicar([{ path: `notifications.arlequin.caixanegra.${id}`, value: { state, method: state === 'normal' ? [] : method, message, ...extra } }])
  const publicarVelas = () =>
    publicar([{ path: 'sails.grande.rizos', value: velas.grandeRizos }, { path: 'sails.genoa.percentagem', value: velas.genoaPct }])

  const ficheiroVelas = () => path.join(dirPlugin, 'velas.json')
  const ficheiroSaida = () => path.join(dirPlugin, 'saida-em-curso.json')
  const ler = (f, omissao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return omissao } }
  // Escreve num .tmp e muda o nome no fim: um corte de energia a meio nunca
  // deixa o velas.json ou o saida-em-curso.json cortado.
  function guardar (f, obj) {
    try {
      fs.writeFileSync(f + '.tmp', JSON.stringify(obj))
      fs.renameSync(f + '.tmp', f)
    } catch (e) { erros++; app.error(`não guardei ${path.basename(f)}: ${e.message}`) }
  }

  function twsMedio () {
    const xs = janela.map(a => a.tws).filter(Number.isFinite)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined
  }

  function listarBruto () {
    const dir = path.join(base, 'bruto')
    try {
      return fs.readdirSync(dir).filter(n => n.endsWith('.gz')).map(n => ({ ficheiro: `bruto/${n}`, bytes: fs.statSync(path.join(dir, n)).size }))
    } catch (e) {
      erros++
      app.error(`bruto: ${e.message}`)
      return []
    }
  }

  function segundo () {
    const agora = Date.now()
    const v = (c) => est.valor(estado, c, agora)
    estavel.juntar(janela, { t: agora, proa: v('navigation.headingTrue'), stw: v('navigation.speedThroughWater'), tws: v('environment.wind.speedTrue') })
    contador++
    if (contador % 10 === 0) {
      try { dezSegundos(agora, v) } catch (e) { erros++; app.error(`caixa negra: ${e.message}`) }
      try { verificarRelogio(agora) } catch (e) { erros++; app.error(`relógio: ${e.message}`) }
    }
    if (contador % 60 === 0) {
      try { minuto() } catch (e) { erros++; app.error(`caixa negra: ${e.message}`) }
    }
  }

  function dezSegundos (agora, v) {
    try { bruto.despejar() } catch (e) { erros++; app.error(`bruto: ${e.message}`) }
    const pos = v('navigation.position')
    const perto = portoMaisPerto(pos, o.portos)
    const simulado = est.simuladoRecente(estado, agora)
    const eEstavel = !est.simuladoRecente(estado, agora, estavel.JANELA_MS + 15000) &&
      estavel.estavel(janela, { longeDoPorto: !!perto && perto.mn > 0.5 })
    // As velas são estado do próprio plugin (só publicadas quando mudam), não
    // um sensor: não podem caducar pela regra dos 15 s do `v` normal.
    const vLinha = (c) => c === 'sails.grande.rizos' ? velas.grandeRizos : c === 'sails.genoa.percentagem' ? velas.genoaPct : v(c)
    try {
      tabela.escrever(path.join(base, 'tabela'), agora, tabela.linha({ v: vLinha, agora, rajadaMs: estavel.rajada(janela), simulado, estavel: eEstavel }))
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
      const textoGenoa = velas.genoaPct === 0 ? 'enrolada' : `${velas.genoaPct}%`
      notificar('velas', 'warn', `As velas continuam assim? Grande ${NOME_GRANDE[velas.grandeRizos]}, genoa ${textoGenoa}`)
    }
  }

  // Um confirmados.json estragado não pára nada (conta como vazio), mas tem de se ver.
  const erroConfirmados = (e) => { erros++; app.error(e.message) }

  // Os nomes dos ficheiros e as junções da AI (previsões, saídas) dependem da
  // hora do Pi. Se a hora do GPS (navigation.datetime) diferir mais de 60 s,
  // aviso só no ecrã; limpa quando voltar a menos de 30 s.
  function verificarRelogio (agora) {
    const g = estado.valores['navigation.datetime']
    if (!g || agora - g.t > 15000) return
    const gps = Date.parse(g.value)
    if (!Number.isFinite(gps)) return
    const desvio = Math.abs(g.t - gps) // hora do Pi quando chegou a mensagem − hora que o GPS lá pôs
    if (!relogioErrado && desvio > 60000) {
      relogioErrado = true
      notificar('relogio', 'warn', `Relógio do Pi desacertado ${Math.round(desvio / 60000)} min — os dados ficam com a hora errada`)
    } else if (relogioErrado && desvio < 30000) {
      relogioErrado = false
      notificar('relogio', 'normal', 'Normal')
    }
  }

  // Confirmados que mudaram depois de confirmados (o sha256 já não bate certo):
  // nunca se apagam, por isso não podem contar como espaço a libertar, senão
  // escondiam o aviso dos 80% e o alarme dos 95% para sempre. Ficam no
  // confirmados.json; a chave leva o hash, para que uma nova confirmação do
  // portátil (hash novo) os volte a tornar apagáveis.
  let mudados = new Set()
  const chaveMudado = (f, h) => `${f} ${h}`

  function verificarDisco (gastos) {
    const u = disco.usoDisco(base)
    const ficheiros = listarBruto()
    const conf = confirmados.lerConfirmados(base, erroConfirmados)
    mudados = new Set(Object.entries(conf).map(([f, h]) => chaveMudado(f, h)).filter(k => mudados.has(k)))
    const planear = () => disco.planear({
      ...u,
      ficheiros,
      confirmados: Object.fromEntries(Object.entries(conf).filter(([f, h]) => !mudados.has(chaveMudado(f, h)))),
      limiteAviso: o.limiteAviso,
      limiteParar: o.limiteParar
    })
    let plano = planear()
    const r = plano.apagar.length ? confirmados.apagarConfirmados(base, plano.apagar, { orcamentoBytes: confirmados.ORCAMENTO_BYTES, gastos, aoErro: erroConfirmados }) : { apagados: [], mudados: [] }
    if (r.mudados.length) {
      for (const f of r.mudados) mudados.add(chaveMudado(f, conf[f]))
      plano = planear() // o aviso e o parar só contam com o que se pode mesmo apagar
    }
    infoDisco = { ...u, aviso: plano.aviso, apagados: r.apagados.length }
    const pct = Math.round(u.usadoPct)
    if (plano.pararBruto) {
      if (!bruto.parado) bruto.parar()
      if (avisoDisco !== 'alarm') {
        avisoDisco = 'alarm'
        // Apito curto (decisão n.º 2, contrato C1): o contínuo fica para o perigo imediato
        // (colisão, fumo, água no porão, gasóleo, motor); um disco cheio não é "levanta-te já".
        notificar('disco', 'alarm', `Disco a ${pct}%: parei de gravar o bruto (a tabela continua). Liga o portátil para copiar os dados.`, ['visual', 'sound'], { apito: 'curto' })
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
    // Um só orçamento de sha256 por minuto: o apagar só usa o que a entrada deixou.
    let gastos = 0
    try {
      const r = confirmados.processarEntrada(base, { orcamentoBytes: confirmados.ORCAMENTO_BYTES, aoErro: erroConfirmados })
      gastos = r.bytes
      if (r.rejeitados.length) app.error(`confirmações rejeitadas: ${r.rejeitados.map(x => `${x.ficheiro} (${x.motivo})`).join(', ')}`)
    } catch (e) { erros++; app.error(`entrada: ${e.message}`) }
    guardar(ficheiroSaida(), saidas)
    try { verificarDisco(gastos) } catch (e) { erros++; app.error(`disco: ${e.message}`) }
    try {
      const mb = listarBruto().reduce((s, f) => s + f.bytes, 0) / 1e6
      const hora = ultimaLinha ? new Date(ultimaLinha).toLocaleTimeString('pt-PT') : '—'
      app.setPluginStatus(`${bruto.parado ? 'BRUTO PARADO · ' : ''}bruto ${mb.toFixed(1)} MB · disco ${Math.round(infoDisco?.usadoPct ?? 0)}% · última linha ${hora}`)
    } catch (e) { erros++; app.error(`estado: ${e.message}`) }
  }

  // Os ficheiros onde se vai continuar a escrever (hora e dia atuais) têm de se
  // ler inteiros; um bloco cortado por um corte de energia estragava o resto.
  function isolarDanificados (agora) {
    for (const f of [path.join(base, 'bruto', nomeHora(agora)), path.join(base, 'tabela', tabela.nomeDia(agora))]) {
      try {
        const novo = isolarSeDanificado(f, agora)
        if (novo) { erros++; app.error(`caixa negra: ${path.basename(f)} estava danificado (corte de energia?); ficou como ${path.basename(novo)} e começa um novo`) }
      } catch (e) { erros++; app.error(`caixa negra: ${path.basename(f)}: ${e.message}`) }
    }
  }

  plugin.start = function (props) {
    o = { pasta: '~/arlequin-dados', limiteAviso: 80, limiteParar: 95, portos: PORTOS, ...props }
    base = path.resolve(o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta)
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
    relogioErrado = false
    mudados = new Set()
    erros = 0
    ultimoErroDelta = -Infinity
    isolarDanificados(Date.now())
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
    // Com a segurança ligada, o SignalK 2.33 só deixa um utilizador admin chamar as rotas registadas
    // com router.get/post simples (tokensecurity.js, pluginAuthenticationMiddleware). Com o
    // router.access(nível) (interfaces/plugins.js, asPluginRouter), as leituras pedem uma sessão
    // (readonly) e as escritas um utilizador "read/write" (o do ecrã: a página Velas grava aqui).
    // Sem o router.access (versões antigas): as simples. O mesmo padrão do plugin da rota.
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escrever = comNivel ? router.access('readwrite') : router
    ler.get('/estado', (req, res) => {
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
    ler.get('/ficheiros', (req, res) => {
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
    ler.get('/velas', (req, res) => res.json({ grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct }))
    escrever.post('/velas', (req, res) => {
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
