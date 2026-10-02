'use strict'
// Plugin SignalK: caixa negra do Arlequin. Grava TUDO desde o primeiro dia em
// ~/arlequin-dados: bruto/ (todas as mensagens, 1 ficheiro por hora), tabela/
// (uma linha a cada 10 s para a AI), saidas/ (resumo de cada saída) e
// previsoes/ (escrita por dois plugins: o da AI, signalk-arlequin-ia, de hora a hora para a posição
// do barco, e o da rota, um ficheiro por ponto de cada cálculo). Só apaga do bruto o que o portátil
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
const { EXTRAS, DESTINOS_DA_ROTA, portosDaRota, juntarPortos, portoMaisPerto } = require('./lib/geo')
const { proaVerdadeira, DECLINACAO_MAX_MS } = require('./lib/proa')

const NOME_GRANDE = { 0: 'inteira', 1: '1 rizo', 2: '2 rizos', '-1': 'arriada' }
// As notificações do plugin: notifications.arlequin.caixanegra.<id>.
const NOTIFICACOES = ['disco', 'relogio', 'velas']

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
      // As saídas fecham nos destinos da rota (lidos do destinos.json dela) e nestes extras
      // (decisão n.º 25). Um extra com o nome de um destino da rota fica de fora.
      portos: {
        type: 'array',
        title: 'Portos e fundeadouros que não são destinos da rota (para detetar as saídas; os destinos da rota já contam)',
        default: EXTRAS,
        items: { type: 'object', properties: { nome: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } } }
      },
      destinos: { type: 'string', title: 'Ficheiro dos destinos da rota (só se lê)', default: DESTINOS_DA_ROTA }
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
  let portos = [] // os destinos da rota e os extras (lib/geo.js)
  let semPortosDaRota = null // o motivo, quando não se leu o destinos.json da rota

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
  // As notificações deste plugin que estão na árvore sem ser "normal" (id → state): o stop()
  // limpa-as e o start() retoma-as (auditoria I-21).
  let ativas = {}
  // `extra` vai no valor da notificação (ex.: { apito: 'curto' }, o contrato C1 com o ecrã).
  const notificar = (id, state, message, method = ['visual'], extra = {}) => {
    if (state === 'normal') delete ativas[id]
    else ativas[id] = state
    publicar([{ path: `notifications.arlequin.caixanegra.${id}`, value: { state, method: state === 'normal' ? [] : method, message, ...extra } }])
  }
  // Depois de um reinício do plugin (não do servidor) a árvore pode ainda ter um aviso dele:
  // retoma-se o estado, para a regra o limpar quando já não for verdade e não o repetir
  // enquanto for. (O SignalK 2.33 apaga da árvore o que o plugin publicou quando o pára; um
  // servidor mais antigo, ou um stop que não correu, deixa-os lá.)
  function retomarAvisos () {
    ativas = {}
    for (const id of NOTIFICACOES) {
      const state = app.getSelfPath?.(`notifications.arlequin.caixanegra.${id}`)?.value?.state
      if (typeof state === 'string' && state !== 'normal') ativas[id] = state
    }
  }
  const publicarVelas = () =>
    publicar([{ path: 'sails.grande.rizos', value: velas.grandeRizos }, { path: 'sails.genoa.percentagem', value: velas.genoaPct }])

  const ficheiroVelas = () => path.join(dirPlugin, 'velas.json')
  const ficheiroSaida = () => path.join(dirPlugin, 'saida-em-curso.json')
  // Sem ficheiro → a omissão (primeiro arranque). Ilegível, ou sem a forma de um objeto → a
  // omissão também, mas diz-se e o ficheiro fica à parte (<nome>.ilegivel-<hora>), senão o
  // próximo guardar escrevia-lhe por cima e uma saída em curso perdia-se calada.
  function ler (f, omissao) {
    let texto
    try { texto = fs.readFileSync(f, 'utf8') } catch (e) {
      if (e.code !== 'ENOENT') { erros++; app.error(`caixa negra: ${path.basename(f)} ilegível (${e.message}); começo do zero`) }
      return omissao
    }
    try {
      const x = JSON.parse(texto)
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('não é um objeto')
      return x
    } catch (e) {
      erros++
      let aParte = ''
      try {
        const novo = `${f}.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}`
        fs.renameSync(f, novo)
        aParte = `; ficou como ${path.basename(novo)}`
      } catch { /* fica onde está */ }
      app.error(`caixa negra: ${path.basename(f)} ilegível (${e.message}); começo do zero${aParte}`)
      return omissao
    }
  }
  // Escreve num .tmp, força-o para o disco (fsync) e só então muda o nome: um corte de energia
  // a meio nunca deixa o velas.json, o saida-em-curso.json ou uma saída cortados ou vazios (sem
  // o fsync, o nome novo podia chegar ao disco antes do conteúdo).
  function guardar (f, obj) {
    try {
      const tmp = f + '.tmp'
      const fd = fs.openSync(tmp, 'w')
      try {
        fs.writeSync(fd, JSON.stringify(obj))
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
      fs.renameSync(tmp, f)
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

  // A proa verdadeira: a headingTrue, ou a magnética das bússolas do barco + a declinação (lib/proa.js).
  const proa = (agora) => proaVerdadeira({
    headingTrue: est.valor(estado, 'navigation.headingTrue', agora),
    headingMagnetic: est.valor(estado, 'navigation.headingMagnetic', agora),
    magneticVariation: est.valor(estado, 'navigation.magneticVariation', agora, DECLINACAO_MAX_MS)
  })

  function segundo () {
    const agora = Date.now()
    const v = (c) => est.valor(estado, c, agora)
    estavel.juntar(janela, { t: agora, proa: proa(agora), stw: v('navigation.speedThroughWater'), tws: v('environment.wind.speedTrue') })
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
    const perto = portoMaisPerto(pos, portos)
    const simulado = est.simuladoRecente(estado, agora)
    const eEstavel = !est.simuladoRecente(estado, agora, estavel.JANELA_MS + 15000) &&
      estavel.estavel(janela, { longeDoPorto: !!perto && perto.mn > 0.5 })
    // As velas são estado do próprio plugin (só publicadas quando mudam), não
    // um sensor: não podem caducar pela regra dos 15 s do `v` normal. A coluna
    // proa é a proa verdadeira (a mesma da janela do "estável").
    const vLinha = (c) => c === 'sails.grande.rizos' ? velas.grandeRizos
      : c === 'sails.genoa.percentagem' ? velas.genoaPct
        : c === 'navigation.headingTrue' ? proa(agora)
          : v(c)
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
    }, portos)
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
      // Sempre a hora de Lisboa, seja qual for o fuso do Pi (decisão n.º 22).
      const hora = ultimaLinha ? new Date(ultimaLinha).toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' }) : '—'
      app.setPluginStatus(`${semPortosDaRota ? 'SEM OS PORTOS DA ROTA · ' : ''}${bruto.parado ? 'BRUTO PARADO · ' : ''}bruto ${mb.toFixed(1)} MB · disco ${Math.round(infoDisco?.usadoPct ?? 0)}% · última linha ${hora}`)
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
    o = { pasta: '~/arlequin-dados', limiteAviso: 80, limiteParar: 95, portos: EXTRAS, destinos: DESTINOS_DA_ROTA, ...props }
    base = path.resolve(o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta)
    for (const d of ['bruto', 'tabela', 'saidas', 'previsoes', 'entrada']) fs.mkdirSync(path.join(base, d), { recursive: true })
    dirPlugin = app.getDataDirPath()
    fs.mkdirSync(dirPlugin, { recursive: true })
    erros = 0
    ultimoErroDelta = -Infinity
    bruto = criarGravadorBruto(path.join(base, 'bruto'))
    estado = est.novoEstado()
    janela = estavel.novaJanela()
    saidas = ler(ficheiroSaida(), saidasLib.novaSaidas())
    velas = { ...velasLib.novoEstadoVelas(), ...ler(ficheiroVelas(), {}) }
    contador = 0
    ultimaLinha = null
    infoDisco = null
    retomarAvisos()
    avisoDisco = ativas.disco ?? 'normal'
    relogioErrado = ativas.relogio !== undefined
    mudados = new Set()
    // Os portos das saídas: os destinos da rota (lidos agora: uma atualização do repositório
    // conta no arranque seguinte) e os extras. Sem o ficheiro da rota, só os extras, e diz-se.
    let daRota = []
    semPortosDaRota = null
    try { daRota = portosDaRota(o.destinos) } catch (e) {
      semPortosDaRota = `não li os destinos da rota (${o.destinos}): ${e.message}`
      erros++
      app.error(`caixa negra: ${semPortosDaRota}; as saídas só fecham nos portos extra`)
    }
    portos = juntarPortos(daRota, Array.isArray(o.portos) ? o.portos : EXTRAS)
    isolarDanificados(Date.now())
    publicarVelas()
    app.signalk.on('unfilteredDelta', aoDelta)
    temporizador = setInterval(segundo, 1000)
    app.setPluginStatus(`${semPortosDaRota ? 'SEM OS PORTOS DA ROTA · ' : ''}A gravar em ${base}`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    app.signalk?.removeListener('unfilteredDelta', aoDelta)
    // Parado, o plugin já não vigia: um aviso deixado ativo ficava preso no ecrã (que só o
    // limpa quando recebe o "normal") e no /estado. Volta a disparar ao arrancar, se ainda for verdade.
    for (const id of Object.keys(ativas)) {
      try { notificar(id, 'normal', 'Normal') } catch (e) { app.error(`caixa negra: ${e.message}`) }
    }
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
        portos: portos.map(p => p.nome), // onde as saídas começam e acabam
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
