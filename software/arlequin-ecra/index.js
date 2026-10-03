'use strict'
// Plugin do ecrã: recebe do painel web os pedidos de disposição das janelas
// (Carta = OpenCPN 58% + painel; resto = painel em ecrã inteiro) e de modo
// noite, e corre os comandos configurados no Pi (ex.: wmctrl, xdotool).
// No portátil os comandos ficam vazios e só se regista o pedido.
//
// REST (/plugins/arlequin-ecra). Com a segurança do SignalK ligada, o ecrã entra com uma conta "read/write",
// nunca admin (auditoria K-11, decisão do Ivo n.º 20): os GET pedem uma sessão (readonly) e os POST um
// utilizador "read/write" (router.access; sem ele, nas versões antigas do SignalK, as rotas simples):
//   POST /janela { layout: 'carta' | 'inteiro' } | { noite: true | false } → { ok, corrido } (500 se o comando
//        falhar: uma frase em pt-PT; o erro do shell fica no estado do plugin)
//   GET  /janela → { ultimo }
//   GET  /diario/:dia (AAAA-MM-DD, o dia de Lisboa) → { dia, entradas: [{ datetime, text, category, origin, author }] }
//   POST /diario { text, category } → 201 { ok }
// O diário (contrato C3): o signalk-logbook (de terceiros) só aceita admin nas rotas dele. As leituras e as
// escritas do ecrã passam por aqui e seguem para o logbook por HTTP local, com o token de admin posto só na
// configuração deste plugin (nunca no browser). O logbook guarda um ficheiro por dia UTC: o dia de Lisboa
// junta os dois dias UTC que lhe tocam (Lisboa está em UTC+0 ou UTC+1). Um logbook que falha dá 502 com o
// motivo em pt-PT; o erro verdadeiro fica no registo do servidor. O 404 de um dia é "sem entradas" só se o logbook
// estiver lá: com os dois dias a 404 pergunta-se a lista dos dias (GET /logs, que responde sempre) e, sem ela,
// "o plugin do diário (signalk-logbook) não está instalado ou ligado" (502).

const { exec: execPadrao } = require('node:child_process')

const LOGBOOK = 'http://localhost:3000/plugins/signalk-logbook/logs'
const CATEGORIAS = ['navigation', 'engine', 'radio', 'maintenance']
const MAX_TEXTO = 1000
const PRAZO_MS = 10000
const NOMES = { carta: 'das janelas (Carta)', inteiro: 'das janelas (ecrã inteiro)', noite: 'do modo noite do OpenCPN', dia: 'do modo dia do OpenCPN' }

const lisboa = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' })
const diaDeLisboa = (t) => lisboa.format(new Date(t))
const diaValido = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d
// o dia UTC anterior: o dia de Lisboa d começa às 23:00 UTC da véspera (no verão) ou às 00:00 UTC (no inverno)
const vespera = (d) => new Date(Date.parse(`${d}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)

module.exports = function (app, { fetch: fetchFn = globalThis.fetch, exec = execPadrao } = {}) {
  const plugin = {
    id: 'arlequin-ecra',
    name: 'Arlequin · ecrã',
    description: 'Painel da roda (webapp em /arlequin-ecra/), controlo das janelas OpenCPN/painel e o diário do ecrã'
  }

  plugin.schema = {
    type: 'object',
    description: 'Comandos de shell corridos no Pi. Vazio = não faz nada (portátil).',
    properties: {
      layoutCarta: { type: 'string', title: 'Comando: Carta (OpenCPN à esquerda 58%, painel à direita)', default: '' },
      layoutInteiro: { type: 'string', title: 'Comando: painel em ecrã inteiro', default: '' },
      noiteOn: { type: 'string', title: 'Comando: OpenCPN em modo noite', default: '' },
      noiteOff: { type: 'string', title: 'Comando: OpenCPN em modo dia', default: '' },
      logbookUrl: { type: 'string', title: 'Diário: URL das entradas do signalk-logbook (no próprio Pi)', default: LOGBOOK },
      token: { type: 'string', title: 'Diário: token de admin para o signalk-logbook (fica só aqui, nunca no browser do ecrã)', default: '' }
    }
  }

  let opcoes = {}
  let ultimo = null

  function correr (nome, comando, res) {
    ultimo = { nome, em: new Date().toISOString() }
    if (!comando) {
      app.setPluginStatus(`Pedido "${nome}" (sem comando configurado)`)
      return res.json({ ok: true, corrido: false })
    }
    exec(comando, { timeout: 5000 }, (erro, out, errOut) => {
      if (erro) {
        app.setPluginError(`"${nome}" falhou: ${errOut || erro.message}`)
        return res.status(500).json({ ok: false, erro: `o comando ${NOMES[nome] || nome} falhou (o motivo está no estado do plugin do ecrã)` })
      }
      app.setPluginStatus(`"${nome}" feito`)
      res.json({ ok: true, corrido: true })
    })
  }

  // ---------- o diário (contrato C3) ----------
  const url = () => (typeof opcoes.logbookUrl === 'string' && opcoes.logbookUrl.trim() ? opcoes.logbookUrl.trim().replace(/\/+$/, '') : LOGBOOK)
  const cabecalhos = (extra = {}) => (opcoes.token ? { ...extra, Authorization: `Bearer ${opcoes.token}` } : extra)
  // o motivo de uma resposta do logbook que não é ok (em pt-PT)
  function motivoLogbook (status) {
    if (status === 401 || status === 403) {
      return opcoes.token
        ? 'o diário (signalk-logbook) recusou o token de admin da configuração do plugin do ecrã: põe um token novo'
        : 'o diário (signalk-logbook) só aceita admin: põe um token de admin na configuração do plugin do ecrã'
    }
    if (status === 404) return 'o plugin do diário (signalk-logbook) não está instalado ou ligado'
    return `o diário (signalk-logbook) deu um erro (HTTP ${status})`
  }
  class FalhaLogbook extends Error {}
  async function pedirLogbook (caminho, o = {}) {
    let r
    try {
      r = await fetchFn(`${url()}${caminho}`, { ...o, headers: cabecalhos(o.headers), signal: AbortSignal.timeout(PRAZO_MS) })
    } catch (e) {
      app.error(`diário: o signalk-logbook não respondeu: ${e && e.message ? e.message : e}`)
      throw new FalhaLogbook('o diário (signalk-logbook) não responde')
    }
    return r
  }

  // As entradas de um dia UTC; null se o logbook respondeu 404. O 404 quer dizer duas coisas: o logbook não tem
  // ficheiro desse dia (nenhuma entrada) ou o servidor não tem a rota (o logbook não está instalado ou ligado);
  // quem chama distingue (confirmarLogbook).
  async function lerDia (diaUtc) {
    const r = await pedirLogbook(`/${diaUtc}`)
    if (r.status === 404) return null
    if (!r.ok) {
      app.error(`diário: GET ${diaUtc} respondeu ${r.status}`)
      throw new FalhaLogbook(motivoLogbook(r.status))
    }
    const lista = await r.json().catch(() => null)
    return Array.isArray(lista) ? lista : []
  }

  // O logbook está lá? A lista dos dias dele (GET /logs) responde sempre, mesmo vazia (o servidor cria a pasta do
  // plugin ao arrancá-lo); um 404 aí é o servidor sem a rota (revisão F3, Minor 10: antes um logbook em falta dava
  // "ainda não há entradas hoje").
  async function confirmarLogbook () {
    const r = await pedirLogbook('')
    if (r.ok) return
    app.error(`diário: GET /logs respondeu ${r.status}`)
    throw new FalhaLogbook(motivoLogbook(r.status))
  }

  async function diario (req, res) {
    const dia = req.params?.dia
    if (!diaValido(dia)) return res.status(400).json({ ok: false, erro: 'o dia tem de ser AAAA-MM-DD' })
    try {
      const antes = await lerDia(vespera(dia))
      const hoje = await lerDia(dia)
      // os dois dias a 404: um dia sem entradas, ou um logbook que não está lá — a lista dos dias diz qual
      if (antes === null && hoje === null) await confirmarLogbook()
      const todas = [...(antes || []), ...(hoje || [])]
      const entradas = todas
        .filter(x => x && typeof x === 'object' && Number.isFinite(Date.parse(x.datetime)) && diaDeLisboa(Date.parse(x.datetime)) === dia)
        .map(x => ({ datetime: new Date(Date.parse(x.datetime)).toISOString(), text: typeof x.text === 'string' ? x.text : '', category: typeof x.category === 'string' ? x.category : 'navigation', origin: typeof x.origin === 'string' ? x.origin : '', author: typeof x.author === 'string' ? x.author : '' }))
        .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))
      res.json({ dia, entradas })
    } catch (e) {
      if (!(e instanceof FalhaLogbook)) app.error(`diário: ${e && e.message ? e.message : e}`)
      res.status(502).json({ ok: false, erro: e instanceof FalhaLogbook ? e.message : 'o diário (signalk-logbook) deu um erro' })
    }
  }

  async function escrever (req, res) {
    const b = req.body && typeof req.body === 'object' ? req.body : {}
    const text = typeof b.text === 'string' ? b.text.trim() : ''
    if (!text || text.length > MAX_TEXTO) return res.status(400).json({ ok: false, erro: `o texto do diário tem de ter 1 a ${MAX_TEXTO} letras` })
    const category = b.category == null ? 'navigation' : b.category
    if (!CATEGORIAS.includes(category)) return res.status(400).json({ ok: false, erro: 'categoria do diário desconhecida' })
    // entrada manual, em nome de quem está no ecrã (o logbook põe a posição, o rumo e o resto do momento)
    const autor = typeof req.skPrincipal?.identifier === 'string' && req.skPrincipal.identifier ? { author: req.skPrincipal.identifier } : {}
    try {
      const r = await pedirLogbook('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, category, origin: 'manual', ...autor }) })
      if (!r.ok) {
        app.error(`diário: POST respondeu ${r.status}`)
        return res.status(502).json({ ok: false, erro: motivoLogbook(r.status) })
      }
      res.status(201).json({ ok: true })
    } catch (e) {
      if (!(e instanceof FalhaLogbook)) app.error(`diário: ${e && e.message ? e.message : e}`)
      res.status(502).json({ ok: false, erro: e instanceof FalhaLogbook ? e.message : 'o diário (signalk-logbook) deu um erro' })
    }
  }

  plugin.registerWithRouter = function (router) {
    // Com a segurança ligada, o SignalK 2.33 só deixa um admin chamar as rotas registadas com router.get/post
    // simples (tokensecurity.js, pluginAuthenticationMiddleware); com o router.access(nível)
    // (interfaces/plugins.js, asPluginRouter) as leituras pedem uma sessão e as escritas "read/write".
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escreverR = comNivel ? router.access('readwrite') : router
    escreverR.post('/janela', (req, res) => {
      const b = req.body || {}
      if (b.layout === 'carta') return correr('carta', opcoes.layoutCarta, res)
      if (b.layout === 'inteiro') return correr('inteiro', opcoes.layoutInteiro, res)
      if (b.noite === true) return correr('noite', opcoes.noiteOn, res)
      if (b.noite === false) return correr('dia', opcoes.noiteOff, res)
      res.status(400).json({ ok: false, erro: 'pedido desconhecido' })
    })
    ler.get('/janela', (req, res) => res.json({ ultimo }))
    ler.get('/diario/:dia', (req, res) => { diario(req, res) })
    escreverR.post('/diario', (req, res) => { escrever(req, res) })
  }

  plugin.start = function (props) {
    opcoes = { ...props }
    app.setPluginStatus(`Pronto · painel em /arlequin-ecra/${opcoes.token ? '' : ' · diário sem o token de admin (configuração)'}`)
  }
  plugin.stop = function () {}

  return plugin
}
