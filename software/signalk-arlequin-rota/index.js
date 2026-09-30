'use strict'
// Plugin SignalK: melhor rota do Arlequin (desenho 3a). Calcula em segundo plano as
// alternativas até um destino (lib/calculo.js), serve o resultado por REST e ativa a
// rota escolhida no SignalK (API de recursos v2 + API de rumo v2), para o OpenCPN a mostrar.
//
// REST (/plugins/signalk-arlequin-rota):
//   POST /calcular { destino, tripulacao: 'so' | 'acompanhado', sairAgora } → 202 { id }
//        (409 se já houver um a calcular; 503 com o plugin parado)
//   GET  /resultado/:id → { estado: 'a calcular' | 'pronto' | 'erro', progresso, texto, resultado?, erro? }
//   GET  /destinos, POST /destinos { nome, lat, lon | posicaoAtual: true, conhecido, abrigo }
//   POST /ativar { id, alternativa } (alternativa: índice 0–2 ou o id) → grava e ativa a rota
//        → { ok, rota, href, via, alternativa, nota } (nota: a do canal, se a rota passar por um)
//
// O destino do /calcular: o id de um destino da lista (dados/destinos.json ou os do Ivo),
// 'rota-ativa' (o fim da rota ativa no SignalK/OpenCPN), ou { lat, lon, nome }.
// Nada aqui derruba o servidor: o cálculo corre dentro de try/catch (lib/calculo.js nunca
// lança) e todas as promessas acabam em .catch.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const c = require('./lib/costa')
const prev = require('./lib/previsao')
const base = require('./lib/base')
const calculo = require('./lib/calculo')
const modelosJs = require('signalk-arlequin-ia/lib/modelos')

const MAX_TRABALHOS = 20
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

function escreverAtomico (f, texto) {
  const tmp = f + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, texto)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, f)
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'destino'

module.exports = function (app, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a))
  const relogio = deps.relogio || (() => Date.now())
  const esperar = deps.esperar || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
  const plugin = {
    id: 'signalk-arlequin-rota',
    name: 'Arlequin · Melhor rota',
    description: 'Calcula as 3 melhores alternativas até um destino (previsão, maré, costa, AI) e ativa a rota escolhida'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      pasta: { type: 'string', title: 'Pasta dos dados da caixa negra (previsões e modelos da AI)', default: '~/arlequin-dados' },
      afastamentoMinimo: { type: 'number', title: 'Afastamento mínimo da costa fora das aproximações (MN)', default: 5 },
      rpmCruzeiro: { type: 'number', title: 'Rotação de cruzeiro do motor (rpm)', default: 2100 },
      polar: { type: 'string', title: 'Ficheiro da polar (CSV do ecrã)', default: base.POLAR_PADRAO },
      previsoes: { type: 'boolean', title: 'Descarregar a previsão (Open-Meteo); desligado usa só as guardadas', default: true },
      bateria: { type: 'string', title: 'ID do banco de serviço (electrical.batteries.<id>)', default: 'servico' },
      deposito: { type: 'string', title: 'Depósito de gasóleo (tanks.fuel.<id>)', default: '0' },
      socDesconhecido: { type: 'number', title: 'SoC a assumir sem leitura da bateria (0–1)', default: 0.8 },
      gasoleoDesconhecidoL: { type: 'number', title: 'Gasóleo a assumir sem leitura do depósito (L)', default: 100 },
      energia: {
        type: 'object',
        title: 'Bateria de serviço (planeamento)',
        properties: {
          capacidadeAh: { type: 'number', title: 'Capacidade (Ah)', default: 200 },
          consumoDiaA: { type: 'number', title: 'Consumo de dia (A)', default: 4.5 },
          consumoNoiteA: { type: 'number', title: 'Consumo de noite (A)', default: 6 },
          paineis: { type: 'number', title: 'Painéis solares', default: 2 },
          areaPainelM2: { type: 'number', title: 'Área de cada painel (m²)', default: 1.65 },
          rendimento: { type: 'number', title: 'Rendimento dos painéis', default: 0.2 },
          alternadorA: { type: 'number', title: 'Alternador com o motor ligado (A)', default: 45 }
        }
      },
      porta: { type: 'number', title: 'Porta do SignalK (só se a API interna faltar)', default: 3000 }
    }
  }

  let o = null
  let pastaBase = null
  let dirPlugin = null
  let costaBase = null
  let polar = null
  let erroArranque = null
  let aCorrer = null // id do cálculo em curso
  const trabalhos = new Map()

  const v = (p) => app.getSelfPath?.(p)?.value
  const ficheiroMeus = () => path.join(dirPlugin, 'destinos.json')

  function meusDestinos () {
    try {
      const l = JSON.parse(fs.readFileSync(ficheiroMeus(), 'utf8'))
      return Array.isArray(l) ? l.filter(d => eObjeto(d) && typeof d.id === 'string' && Array.isArray(d.largo)) : []
    } catch { return [] }
  }
  // A costa com os destinos da lista mais os do Ivo (estes marcados `meu`).
  function costaAtual () {
    return { ...costaBase, destinos: [...costaBase.destinos, ...meusDestinos().map(d => ({ ...d, meu: true }))] }
  }

  function instrumentos () {
    const pos = v('navigation.position')
    const soc = v(`electrical.batteries.${o.bateria}.capacity.stateOfCharge`)
    const vol = v(`tanks.fuel.${o.deposito}.currentVolume`)
    const nivel = v(`tanks.fuel.${o.deposito}.currentLevel`)
    const cap = v(`tanks.fuel.${o.deposito}.capacity`)
    const gasoleoL = Number.isFinite(vol) ? vol * 1000 : Number.isFinite(nivel) && Number.isFinite(cap) ? nivel * cap * 1000 : null
    return {
      posicao: pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude) ? { lat: pos.latitude, lon: pos.longitude } : null,
      socPct: Number.isFinite(soc) ? soc * 100 : null,
      gasoleoL,
      tendPressao3h: null // sem histórico do barómetro aqui: o modelo do vento recebe null
    }
  }

  // Os modelos da AI em uso (sem modelo ou ilegível: null, e fica a polar e a curva da Volvo).
  function modelosAi () {
    const pasta = path.join(pastaBase, 'modelos')
    const modelos = modelosJs.carregarModelos(pasta, (nome, e) => app.error(`modelo ${nome} ilegível: ${e.message}`))
    const versoes = Object.fromEntries(modelosJs.NOMES.map(n => [n, modelos[n] ? modelosJs.versaoAtual(pasta, n) : null]))
    return { modelos, versoes }
  }

  // A previsão: descarrega (e arquiva em previsoes/); sem rede, a guardada mais recente que cubra a rota.
  async function obterPrevisao ({ pontos, desde, ate, agora }) {
    const pasta = path.join(pastaBase, 'previsoes')
    let erroRede = null
    if (o.previsoes) {
      try {
        const p = await prev.obterPrevisao({ pontos, agora, fetch: fetchFn })
        try { prev.guardarArquivo(pasta, p) } catch (e) { app.error(`não arquivei a previsão: ${e.message}`) }
        return { previsao: p, obtida: p.obtida, idadeH: 0, aviso: null, texto: null }
      } catch (e) { erroRede = e.message }
    }
    const a = prev.lerArquivo(pasta, { pontos, desde, ate, agora })
    if (a.erro) return { erro: erroRede ? `sem rede (${erroRede}) e ${a.erro}` : a.erro }
    return a
  }

  // O fim da rota ativa no SignalK (API de rumo v2), para o destino 'rota-ativa'.
  async function pontosRotaAtiva () {
    const curso = typeof app.getCourse === 'function' ? await app.getCourse() : null
    const href = curso?.activeRoute?.href
    if (!href) return null
    const id = href.split('/').pop()
    const r = await app.resourcesApi?.getResource?.('routes', id)
    const coords = r?.feature?.geometry?.coordinates
    return Array.isArray(coords) && coords.length ? coords.map(([lon, lat]) => ({ lat, lon })) : null
  }

  function guardarTrabalho (id, t) {
    trabalhos.set(id, t)
    while (trabalhos.size > MAX_TRABALHOS) {
      const velho = [...trabalhos.keys()].find(k => k !== aCorrer)
      if (!velho) break
      trabalhos.delete(velho)
    }
  }

  async function executar (id, pedido) {
    const t = trabalhos.get(id)
    const { modelos, versoes } = modelosAi()
    let destino = pedido.destino
    if (destino === 'rota-ativa') {
      const pts = await pontosRotaAtiva()
      if (!pts) throw new Error('não há rota ativa no SignalK')
      destino = { rotaAtiva: pts }
    }
    const costa = costaAtual()
    const r = await calculo.calcular(
      { instrumentos: instrumentos(), destino, tripulacao: pedido.tripulacao, sairAgora: pedido.sairAgora, agora: relogio() },
      {
        costa, polar, modelos, versoes, obterPrevisao,
        opcoes: {
          afastamentoMinimo: o.afastamentoMinimo, rpmCruzeiro: o.rpmCruzeiro, energia: o.energia,
          socDesconhecido: o.socDesconhecido, gasoleoDesconhecidoL: o.gasoleoDesconhecidoL
        },
        progresso: (f, texto) => { t.progresso = Math.round(f * 100) / 100; t.texto = texto },
        // o registo dos erros de programação da geometria (lib/rotas.js: log(msg, erro))
        log: (msg, e) => app.error(e && e.message ? `${msg}: ${e.message}` : String(msg))
      })
    if (r.erro) { t.estado = 'erro'; t.erro = r.erro; return }
    t.estado = 'pronto'
    t.progresso = 1
    t.texto = 'pronto'
    t.resultado = r
  }

  // Grava a rota na API de recursos v2 e ativa-a na API de rumo v2. Primeiro a API dentro do
  // servidor (app.resourcesApi e app.activateRoute); sem ela, HTTP para o próprio servidor.
  // A rota direta (salto curto) não tem afastamento: diz "direta (salto curto)", nunca "null MN";
  // uma variante por um canal leva a nota do canal (terra dos dois lados, por confirmar na carta).
  async function ativarRota (alt, destinoNome) {
    const pts = alt.pontosRota
    const id = crypto.randomUUID()
    const href = `/resources/routes/${id}`
    const onde = alt.direto || !Number.isFinite(alt.afastamento) ? 'direta (salto curto)' : `${alt.afastamento} MN${alt.canal ? ` pelo ${alt.canal}` : ''}`
    const dados = {
      name: `Arlequin → ${destinoNome} (${alt.nome})`,
      description: `Melhor rota: ${onde}, ${alt.propulsao === 'motor' ? 'só motor' : 'vela e motor'}, partida ${alt.partida}, chegada prevista ${alt.chegada.p50}${alt.nota ? `. ${alt.nota}` : ''}`,
      ...(Number.isFinite(alt.milhas) ? { distance: Math.round(alt.milhas * 1852) } : {}),
      feature: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) },
        properties: { coordinatesMeta: pts.map((p, i) => ({ name: p.nome || `WP${i}` })) }
      }
    }
    // o barco está no primeiro ponto (o cais ou a posição): o próximo é o seguinte
    const destinoCurso = { href, pointIndex: pts.length > 1 ? 1 : 0 }
    if (app.resourcesApi && typeof app.resourcesApi.setResource === 'function' && typeof app.activateRoute === 'function') {
      await app.resourcesApi.setResource('routes', id, dados)
      // o setResource do servidor não espera pela escrita do fornecedor: esperar até se ler
      let lida = false
      for (let i = 0; i < 30 && !lida; i++) {
        try { lida = !!(await app.resourcesApi.getResource('routes', id)) } catch { lida = false }
        if (!lida) await esperar(100)
      }
      if (!lida) throw new Error('a rota foi gravada mas não se consegue ler de volta')
      await app.activateRoute(destinoCurso)
      return { rota: id, href, via: 'api interna' }
    }
    const url = `http://localhost:${o.porta || 3000}`
    const pedir = async (caminho, corpo) => {
      const r = await fetchFn(url + caminho, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) })
      if (!r.ok) throw new Error(`${caminho} respondeu ${r.status}`)
    }
    await pedir(`/signalk/v2/api/resources/routes/${id}`, dados)
    await pedir('/signalk/v2/api/vessels/self/navigation/course/activeRoute', destinoCurso)
    return { rota: id, href, via: 'http' }
  }

  plugin.start = function (props) {
    o = {
      pasta: '~/arlequin-dados', afastamentoMinimo: 5, rpmCruzeiro: 2100, polar: base.POLAR_PADRAO, previsoes: true,
      bateria: 'servico', deposito: '0', socDesconhecido: 0.8, gasoleoDesconhecidoL: 100, energia: {}, porta: 3000, ...props
    }
    pastaBase = path.resolve(o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta)
    dirPlugin = app.getDataDirPath()
    erroArranque = null
    try {
      fs.mkdirSync(dirPlugin, { recursive: true })
      costaBase = deps.costa || c.carregarCosta()
      polar = base.carregarPolar(path.resolve(o.polar || base.POLAR_PADRAO))
    } catch (e) {
      erroArranque = `não arrancou: ${e.message}`
      costaBase = null; polar = null
      app.setPluginError?.(erroArranque)
      return
    }
    app.setPluginStatus(`Pronto · ${costaBase.destinos.length + meusDestinos().length} destinos`)
  }

  plugin.stop = function () {
    // Um cálculo a correr acaba sozinho (é finito); o resultado fica no mapa.
    o = null
  }

  plugin.registerWithRouter = function (router) {
    const parado = (res) => res.status(503).json({ ok: false, erro: erroArranque || 'o plugin da rota não está ligado' })
    const ligado = () => o && costaBase && polar

    router.post('/calcular', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const tripulacao = b.tripulacao
      if (tripulacao !== 'so' && tripulacao !== 'acompanhado') return res.status(400).json({ ok: false, erro: 'tripulacao tem de ser "so" ou "acompanhado"' })
      const destino = b.destino
      const destinoOk = (typeof destino === 'string' && destino) || (eObjeto(destino) && Number.isFinite(destino.lat) && Number.isFinite(destino.lon))
      if (!destinoOk) return res.status(400).json({ ok: false, erro: 'falta o destino (id, "rota-ativa" ou { lat, lon, nome })' })
      if (b.sairAgora != null && typeof b.sairAgora !== 'boolean') return res.status(400).json({ ok: false, erro: 'sairAgora tem de ser true ou false' })
      if (aCorrer) return res.status(409).json({ ok: false, erro: 'já há um cálculo a correr', id: aCorrer })
      const id = crypto.randomUUID()
      aCorrer = id
      guardarTrabalho(id, { estado: 'a calcular', progresso: 0, texto: 'a começar', pedido: { destino, tripulacao, sairAgora: !!b.sairAgora }, criado: new Date(relogio()).toISOString() })
      app.setPluginStatus('A calcular a melhor rota…')
      executar(id, { destino, tripulacao, sairAgora: !!b.sairAgora })
        .catch(e => { const t = trabalhos.get(id); if (t) { t.estado = 'erro'; t.erro = e && e.message ? e.message : String(e) } })
        .finally(() => {
          aCorrer = null
          const t = trabalhos.get(id)
          try { app.setPluginStatus(t?.estado === 'pronto' ? `Última rota: ${t.resultado.veredicto.texto}` : `Último cálculo: ${t?.erro || 'erro'}`) } catch { /* só o estado */ }
        })
        .catch(e => app.error(`calcular: ${e.message}`))
      res.status(202).json({ id })
    })

    router.get('/resultado/:id', (req, res) => {
      if (!ligado()) return parado(res)
      const t = trabalhos.get(req.params.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      const out = { estado: t.estado, progresso: t.progresso, texto: t.texto }
      if (t.resultado) out.resultado = t.resultado
      if (t.erro) out.erro = t.erro
      res.json(out)
    })

    router.get('/destinos', (req, res) => {
      if (!ligado()) return parado(res)
      res.json({ destinos: costaAtual().destinos })
    })

    router.post('/destinos', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const nome = typeof b.nome === 'string' ? b.nome.trim() : ''
      if (!nome || nome.length > 40) return res.status(400).json({ ok: false, erro: 'o nome tem de ter 1 a 40 letras' })
      let p = null
      if (b.posicaoAtual === true) {
        p = instrumentos().posicao
        if (!p) return res.status(400).json({ ok: false, erro: 'sem GPS: não sei a posição atual' })
      } else if (Number.isFinite(b.lat) && Number.isFinite(b.lon) && Math.abs(b.lat) <= 90 && Math.abs(b.lon) <= 180) p = { lat: b.lat, lon: b.lon }
      else return res.status(400).json({ ok: false, erro: 'faltam as coordenadas (lat, lon) ou posicaoAtual: true' })
      if (typeof b.conhecido !== 'boolean' || typeof b.abrigo !== 'boolean') return res.status(400).json({ ok: false, erro: 'conhecido e abrigo têm de ser true ou false' })
      if (costaBase.emTerra(p)) return res.status(400).json({ ok: false, erro: 'essa posição fica em terra' })
      const meus = meusDestinos()
      const todos = costaAtual().destinos
      let id = `meu-${slug(nome)}`
      for (let n = 2; todos.some(d => d.id === id); n++) id = `meu-${slug(nome)}-${n}`
      const lat = Math.round(p.lat * 1e5) / 1e5; const lon = Math.round(p.lon * 1e5) / 1e5
      const d = { id, nome, abrigo: b.abrigo, conhecido: b.conhecido, largo: [lat, lon], aproximacao: [[lat, lon]], entrada: 0, notas: 'acrescentado no ecrã', confirmado: false, criado: new Date(relogio()).toISOString() }
      try { escreverAtomico(ficheiroMeus(), JSON.stringify([...meus, d], null, 1)) } catch (e) { return res.status(500).json({ ok: false, erro: `não gravei o destino: ${e.message}` }) }
      res.status(201).json({ ok: true, destino: { ...d, meu: true } })
    })

    router.post('/ativar', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const t = trabalhos.get(b.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      if (t.estado !== 'pronto') return res.status(409).json({ ok: false, erro: `o cálculo está "${t.estado}"` })
      const lista = t.resultado.alternativas
      const alt = Number.isInteger(b.alternativa) ? lista[b.alternativa] : lista.find(a => a.id === b.alternativa)
      if (!alt) return res.status(404).json({ ok: false, erro: 'alternativa desconhecida' })
      ativarRota(alt, t.resultado.destino.nome)
        .then(r => res.json({ ok: true, ...r, alternativa: alt.id, nota: alt.nota || null }))
        .catch(e => res.status(502).json({ ok: false, erro: `não ativei a rota: ${e.message}` }))
        .catch(e => app.error(`ativar: ${e.message}`))
    })
  }

  return plugin
}
