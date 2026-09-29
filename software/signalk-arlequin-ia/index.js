'use strict'
// Plugin SignalK: AI do Arlequin. Arquiva a previsão do tempo para a posição do
// barco (previsoes/), lança o treino em Python quando o barco está parado há 1 h
// depois de uma saída (ou com "Treinar agora"), e mostra ao ecrã o que a AI
// aprendeu. As previsões dos modelos fazem-se em JavaScript (lib/modelos.js),
// por isso a navegação nunca depende do Python.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const prev = require('./lib/previsao')
const { avaliarDisparo } = require('./lib/disparo')
const { lancarTreino } = require('./lib/processo')
const mod = require('./lib/modelos')

const NO = 1852 / 3600
const numeroOuNull = (x) => (Number.isFinite(x) ? x : null)
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

// O estado.json lido campo a campo: o que tiver a forma errada volta ao valor de origem.
function estadoValido (lido) {
  const e = eObjeto(lido) ? lido : {}
  const p = eObjeto(e.previsao) ? e.previsao : {}
  return {
    ultimoTreinoMs: Number.isFinite(e.ultimoTreinoMs) ? e.ultimoTreinoMs : 0,
    ultimoTreino: eObjeto(e.ultimoTreino) ? e.ultimoTreino : null,
    previsao: { okEm: numeroOuNull(p.okEm), tentativaEm: numeroOuNull(p.tentativaEm), erro: typeof p.erro === 'string' ? p.erro : null }
  }
}

// Escreve para f.tmp, força para o disco e só então troca: quem lê vê o ficheiro
// antigo ou o novo, nunca meio escrito (como o treino em Python faz).
function escreverAtomico (f, texto) {
  const tmp = f + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, texto)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, f)
}

module.exports = function (app, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a))
  const plugin = {
    id: 'signalk-arlequin-ia',
    name: 'Arlequin · AI',
    description: 'Arquiva a previsão do tempo, treina os modelos (Python/LightGBM) no porto e mostra o que a AI aprendeu'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      pasta: { type: 'string', title: 'Pasta dos dados (a mesma da caixa negra)', default: '~/arlequin-dados' },
      python: { type: 'string', title: 'Comando do Python (com lightgbm, pandas e numpy)', default: 'python3' },
      pastaIa: { type: 'string', title: 'Pasta do pacote arlequin-ia', default: path.join(__dirname, '..', 'arlequin-ia') },
      previsoes: { type: 'boolean', title: 'Arquivar a previsão do tempo (Open-Meteo)', default: true },
      treinoAutomatico: { type: 'boolean', title: 'Treinar sozinho no porto depois de cada saída', default: true }
    }
  }

  let o = {}
  let base
  let dirPlugin
  let temporizador = null
  let emTreino = null
  let aBuscar = false
  let disparo = {}
  let estado = estadoValido({})

  const pastaModelos = () => path.join(base, 'modelos')
  const ficheiroEstado = () => path.join(dirPlugin, 'estado.json')
  const guardarEstado = () => {
    try { escreverAtomico(ficheiroEstado(), JSON.stringify(estado)) } catch (e) { app.error(`não guardei o estado da AI: ${e.message}`) }
  }
  const v = (c) => app.getSelfPath?.(c)?.value

  function ultimaSaidaMs () {
    try {
      return Math.max(0, ...fs.readdirSync(path.join(base, 'saidas')).filter(n => n.endsWith('.json')).map(n => fs.statSync(path.join(base, 'saidas', n)).mtimeMs))
    } catch { return 0 }
  }

  function treinar (motivo) {
    if (emTreino) return false
    const comando = deps.comando || [o.python, '-m', 'arlequin_ia', 'treinar', '--dados', base]
    app.setPluginStatus(`A treinar (${motivo})…`)
    emTreino = lancarTreino({ comando, cwd: o.pastaIa, nice: deps.nice })
      .then(resultados => { estado.ultimoTreino = { em: new Date().toISOString(), motivo, resultados } })
      .catch(e => { estado.ultimoTreino = { em: new Date().toISOString(), motivo, erro: e.message }; app.error(`treino: ${e.message}`) })
      .finally(() => {
        estado.ultimoTreinoMs = Date.now()
        emTreino = null
        guardarEstado()
        try { app.setPluginStatus(resumo()) } catch (e) { app.error(`treino: ${e.message}`) }
      })
      .catch(e => app.error(`treino: ${e.message}`))
    return true
  }

  function arquivarPrevisao (agora) {
    const pos = v('navigation.position')
    if (!o.previsoes || aBuscar || !pos || !Number.isFinite(pos.latitude)) return
    const aNavegar = (v('navigation.speedOverGround') ?? 0) > 1 * NO
    if (!prev.precisaPrevisao({ agora, ...estado.previsao, aNavegar })) return
    aBuscar = true
    estado.previsao.tentativaEm = agora
    prev.descarregar(pos.latitude, pos.longitude, agora, fetchFn)
      .then(r => { prev.guardar(path.join(base, 'previsoes'), r); estado.previsao = { okEm: agora, tentativaEm: null, erro: null } })
      .catch(e => { estado.previsao.erro = e.message })
      .finally(() => { aBuscar = false; guardarEstado() })
  }

  function minuto () {
    const agora = Date.now()
    try { arquivarPrevisao(agora) } catch (e) { app.error(`previsão: ${e.message}`) }
    try {
      const r = avaliarDisparo(disparo, { agora, sog: v('navigation.speedOverGround'), rpm: v('propulsion.main.revolutions'), ultimaSaidaMs: ultimaSaidaMs(), ultimoTreinoMs: estado.ultimoTreinoMs })
      disparo = r.e
      if (r.treinar && o.treinoAutomatico) treinar('automático, depois de uma saída')
    } catch (e) { app.error(`disparo: ${e.message}`) }
  }

  // O resumo de cada modelo em uso, guardado por nome|versão|mtime: o /ia não
  // descomprime o modelo inteiro a cada pedido. Uma entrada por modelo.
  const cacheResumo = new Map()
  function resumoModelo (nome) {
    const versao = mod.versaoAtual(pastaModelos(), nome)
    const versoes = mod.versoes(pastaModelos(), nome)
    if (!versao) return { versao: null, versoes }
    let chave
    try { chave = `${nome}|${versao}|${fs.statSync(path.join(pastaModelos(), nome, `${versao}.json.gz`)).mtimeMs}` } catch (e) { return { versao, versoes, erro: e.message } }
    const guardado = cacheResumo.get(nome)
    if (guardado?.chave === chave) return { versao, versoes, ...guardado.dados }
    let dados
    try {
      const m = mod.lerVersao(pastaModelos(), nome, versao)
      dados = { criado: m.criado, horas: m.horas, mae: m.mae, maeBase: m.maeBase, frases: m.frases || [] }
    } catch (e) { dados = { erro: e.message } }
    cacheResumo.set(nome, { chave, dados })
    return { versao, versoes, ...dados }
  }

  function resumo () {
    const emUso = mod.NOMES.filter(n => mod.versaoAtual(pastaModelos(), n)).length
    return `${emUso} de ${mod.NOMES.length} modelos em uso · última previsão ${estado.previsao.okEm ? new Date(estado.previsao.okEm).toLocaleTimeString('pt-PT') : '—'}`
  }

  plugin.start = function (props) {
    o = { pasta: '~/arlequin-dados', python: 'python3', pastaIa: path.join(__dirname, '..', 'arlequin-ia'), previsoes: true, treinoAutomatico: true, ...props }
    base = path.resolve(o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta)
    dirPlugin = app.getDataDirPath()
    fs.mkdirSync(dirPlugin, { recursive: true })
    let texto = null
    try { texto = fs.readFileSync(ficheiroEstado(), 'utf8') } catch { /* primeiro arranque */ }
    if (texto !== null) {
      let lido = {}
      try { lido = JSON.parse(texto) } catch (e) { app.error(`o estado.json da AI está ilegível (${e.message}); começo do zero`) }
      estado = estadoValido(lido)
    }
    disparo = {}
    if (temporizador) clearInterval(temporizador)
    temporizador = setInterval(minuto, 60000)
    app.setPluginStatus(resumo())
  }

  // Um treino a correr não é parado: acaba sozinho (no máximo 30 min, lib/processo.js).
  // Como o emTreino continua ocupado, um start logo a seguir não lança um segundo.
  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  plugin.registerWithRouter = function (router) {
    const desligada = (res) => res.status(503).json({ ok: false, erro: 'a AI não está ligada' })
    router.get('/ia', (req, res) => {
      if (!base) return desligada(res)
      res.json({
        emTreino: !!emTreino,
        ultimoTreino: estado.ultimoTreino,
        previsao: estado.previsao,
        modelos: Object.fromEntries(mod.NOMES.map(n => [n, resumoModelo(n)]))
      })
    })
    router.post('/treinar', (req, res) => {
      if (!base) return desligada(res)
      if (!treinar('pedido no ecrã')) return res.status(409).json({ ok: false, erro: 'já está a treinar' })
      res.status(202).json({ ok: true })
    })
    router.post('/voltar', (req, res) => {
      if (!base) return desligada(res)
      // O Python escreve o atual e o registo.json no fim do treino: não mexer ao mesmo tempo.
      if (emTreino) return res.status(409).json({ ok: false, erro: 'está a treinar; tenta depois' })
      const nome = req.body?.modelo
      if (!mod.NOMES.includes(nome)) return res.status(400).json({ ok: false, erro: 'modelo desconhecido' })
      const atual = mod.versaoAtual(pastaModelos(), nome)
      const anteriores = mod.versoes(pastaModelos(), nome).filter(x => atual && x < atual).reverse()
      const alvo = anteriores.find(x => { try { return mod.lerVersao(pastaModelos(), nome, x).aceite } catch { return false } })
      if (!alvo) return res.status(409).json({ ok: false, erro: 'não há versão anterior que tenha estado em uso' })
      const registo = path.join(pastaModelos(), 'registo.json')
      // Sem registo começa-se um; ilegível fica como está (não se apaga o histórico).
      let lista = null
      try {
        lista = JSON.parse(fs.readFileSync(registo, 'utf8'))
        if (!Array.isArray(lista)) throw new Error('não é uma lista')
      } catch (e) {
        lista = e.code === 'ENOENT' ? [] : null
        if (!lista) app.error(`voltar atrás: o registo.json está ilegível (${e.message}); não foi alterado`)
      }
      escreverAtomico(path.join(pastaModelos(), nome, 'atual'), alvo)
      if (!lista) return res.json({ ok: true, versao: alvo, aviso: 'o registo.json está ilegível e não foi alterado' })
      lista.push({ modelo: nome, data: new Date().toISOString(), versao: alvo, aceite: true, motivo: `voltou atrás à mão (estava ${atual})` })
      escreverAtomico(registo, JSON.stringify(lista, null, 1))
      res.json({ ok: true, versao: alvo })
    })
  }

  return plugin
}
