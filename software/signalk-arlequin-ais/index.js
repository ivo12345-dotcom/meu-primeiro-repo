'use strict'
// Plugin SignalK: alarme de colisão AIS (CPA/TCPA) no servidor, para avisar mesmo com o ecrã desligado.
// Publica notifications.arlequin.ais.<mmsi> e navigation.arlequin.emPorto (contrato C12: true a menos de
// 0,5 MN de um porto conhecido com o nosso SOG abaixo de 4 nós; null sem a nossa posição). As regras
// estão em lib/vigia.js; o cálculo e a classificação são os do ecrã (arlequin-ecra/public/lib/cpa.js).
//
// As idades (revisão F6, Menor 8): a nossa posição, o SOG e o COG contam pelo relógio do Pi desde a
// última vez que mudaram na árvore (nunca pela hora do GPS: um Pi desacertado não pode parar o vigia).
// Sem a nossa posição há mais de 10 s o vigia não julga nada (os alarmes ativos ficam). O SOG/COG de cada
// alvo levam a hora deles, comparada com a da posição do alvo (lib/vigia.js).
//
// Os portos conhecidos (contrato C12): os destinos da rota (signalk-arlequin-rota/dados/destinos.json,
// só se lê; o sítio de cada um é o cais, o último ponto da aproximação) e os extras da configuração.
//
// Nota do SignalK 2.33 (adenda 2): ao parar o plugin o servidor apaga da árvore os valores dele. Os
// alarmes ativos ficam no ficheiro alarmes-ativos.json da pasta de dados e o arranque volta a
// publicá-los (com a mesma mensagem; se o alvo não aparecer em 10 min, "Alvo perdido"); depois a regra
// decide se continuam.

const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { avaliarAlvos, novaMemoria, VELHO } = require('./lib/vigia')

const DESTINOS_DA_ROTA = path.join(__dirname, '..', 'signalk-arlequin-rota', 'dados', 'destinos.json')
// Portos e fundeadouros que não são destinos da rota (os mesmos extras da caixa negra, decisão n.º 25).
const EXTRAS = [{ nome: 'Ericeira', lat: 38.9630, lon: -9.4180 }]
const EU_VELHO = 10 * 1000 // a nossa posição sem mudar há mais disto: o GPS calou-se
const GRAVAR = 60 * 1000 // com alarmes ativos, o ficheiro deles atualiza-se (a hora em que se viu o alvo) de tanto em tanto

function caminhoCpa () {
  const aoLado = path.join(__dirname, '..', 'arlequin-ecra', 'public', 'lib', 'cpa.js')
  if (fs.existsSync(aoLado)) return aoLado
  return require.resolve('arlequin-ecra/public/lib/cpa.js')
}

const parValido = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])

// [{ nome, lat, lon }] dos destinos da rota: o cais (o último ponto da aproximação); sem ela, o largo.
// Rebenta se o ficheiro falta ou não é uma lista: quem chama avisa.
function portosDaRota (ficheiro) {
  const lista = JSON.parse(fs.readFileSync(ficheiro, 'utf8'))
  if (!Array.isArray(lista)) throw new Error('não é uma lista de destinos')
  const out = []
  for (const d of lista) {
    const ap = d?.aproximacao
    const p = Array.isArray(ap) && ap.length && parValido(ap.at(-1)) ? ap.at(-1) : parValido(d?.largo) ? d.largo : null
    if (p && typeof d.nome === 'string' && d.nome.trim()) out.push({ nome: d.nome, lat: p[0], lon: p[1] })
  }
  return out
}

// Os da rota e os extras; um extra com o nome de um porto da rota fica de fora.
function juntarPortos (daRota, extras) {
  const chave = (n) => String(n ?? '').trim().toLowerCase()
  const nomes = new Set(daRota.map(p => chave(p.nome)))
  const out = [...daRota]
  for (const p of extras || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || nomes.has(chave(p.nome))) continue
    nomes.add(chave(p.nome))
    out.push({ nome: p.nome, lat: p.lat, lon: p.lon })
  }
  return out
}

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-ais',
    name: 'Arlequin · alarme AIS',
    description: 'Alarme de colisão AIS (CPA < 0,5 MN e TCPA < 20 min) com o mesmo cálculo do ecrã'
  }
  plugin.schema = {
    type: 'object',
    properties: {
      portos: {
        type: 'array',
        title: 'Portos e fundeadouros que não são destinos da rota (o "em porto" do AIS; os destinos da rota já contam)',
        default: EXTRAS,
        items: { type: 'object', properties: { nome: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } } }
      },
      destinos: { type: 'string', title: 'Ficheiro dos destinos da rota (só se lê)', default: DESTINOS_DA_ROTA }
    }
  }

  let temporizador = null
  let ativos = {}
  let memoria // o rasto e a memória de cada alvo, se estamos amarrados e em porto (lib/vigia.js), de avaliação em avaliação
  let geracao = 0 // cada start/stop muda-a: o cálculo que acabe de carregar depois de um stop não arma nada
  let portos = []
  let semPortosDaRota = null
  let ficheiro = null
  let gravadoEm = 0
  let gravado = '{}'
  let vistos = {} // caminho nosso → { ts, em }: a hora (do Pi) em que o valor mudou pela última vez

  const valor = (no, p) => p.split('.').reduce((o, k) => o?.[k], no)?.value
  const hora = (no, p) => { const ts = p.split('.').reduce((o, k) => o?.[k], no)?.timestamp; return ts ? Date.parse(ts) : undefined }

  function publicar (notificacoes) {
    if (!notificacoes.length) return
    app.handleMessage(plugin.id, {
      updates: [{
        values: notificacoes.map(n => ({
          path: `notifications.arlequin.ais.${n.mmsi}`,
          value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) }
        }))
      }]
    })
  }

  // Os alarmes ativos no ficheiro: { mmsi: { message, desde, vistoEm } }. Grava quando mudam e, com
  // alarmes, de GRAVAR em GRAVAR (a hora em que se viu cada alvo); escrita atómica (tmp + rename).
  function lerAtivos () {
    if (!ficheiro) return {}
    try {
      const j = JSON.parse(fs.readFileSync(ficheiro, 'utf8'))
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
    } catch { return {} }
  }
  function gravarAtivos (agora, { sempre = false } = {}) {
    if (!ficheiro) return
    const conteudo = JSON.stringify(Object.fromEntries(Object.keys(ativos).map(mmsi => {
      const a = memoria?.alarmes?.[mmsi] || {}
      return [mmsi, { message: a.message, desde: a.desde, vistoEm: a.vistoEm }]
    })))
    const mudou = JSON.stringify(Object.keys(JSON.parse(conteudo)).sort()) !== JSON.stringify(Object.keys(JSON.parse(gravado)).sort())
    if (!sempre && !mudou && !(conteudo !== '{}' && agora - gravadoEm >= GRAVAR)) return
    try {
      fs.writeFileSync(ficheiro + '.tmp', conteudo)
      fs.renameSync(ficheiro + '.tmp', ficheiro)
      gravado = conteudo
      gravadoEm = agora
    } catch (e) { app.error(`não gravei os alarmes AIS ativos: ${e.message}`) }
  }

  // No arranque (adenda 2, SignalK 2.33; auditoria I-21): os alarmes do ficheiro com o alvo visto há
  // menos de 10 min voltam a publicar-se; os que estiverem na árvore e não se repuseram (um servidor
  // que não apaga os valores do plugin ao pará-lo) passam a normal.
  function reporAtivos () {
    const agora = Date.now()
    const repor = Object.entries(lerAtivos()).filter(([, a]) => typeof a?.message === 'string' && Number.isFinite(a.vistoEm) && agora - a.vistoEm <= VELHO)
    for (const [mmsi, a] of repor) {
      ativos[mmsi] = true
      memoria.alarmes[mmsi] = { message: a.message, desde: a.desde ?? agora, vistoEm: a.vistoEm, dMin: Infinity, seguroDesde: null }
    }
    publicar(repor.map(([mmsi, a]) => ({ mmsi, state: 'alarm', method: ['visual', 'sound'], apito: 'continuo', message: a.message })))
    const arvore = app.getSelfPath?.('notifications.arlequin.ais')
    publicar(Object.entries(arvore && typeof arvore === 'object' ? arvore : {})
      .filter(([mmsi, no]) => no?.value?.state && no.value.state !== 'normal' && !ativos[mmsi])
      .map(([mmsi]) => ({ mmsi, state: 'normal', method: [], message: 'Normal' })))
    gravarAtivos(agora, { sempre: true })
  }

  function alvosAis () {
    const vessels = app.getPath('vessels') || {}
    const lista = []
    for (const [id, v] of Object.entries(vessels)) {
      if (id === app.selfId || id === 'self') continue
      const pos = v.navigation?.position
      if (!pos?.value) continue
      lista.push({
        mmsi: v.mmsi || id.split(':').pop(),
        nome: v.name,
        position: pos.value,
        cog: valor(v, 'navigation.courseOverGroundTrue'),
        cogEm: hora(v, 'navigation.courseOverGroundTrue'),
        sog: valor(v, 'navigation.speedOverGround'),
        sogEm: hora(v, 'navigation.speedOverGround'),
        em: Date.parse(pos.timestamp)
      })
    }
    return lista
  }

  // Um valor nosso e a hora (no relógio do vigia) em que mudou pela última vez: a hora dele na árvore
  // só serve para ver se mudou. Sem hora na árvore conta como novo.
  function lerNosso (p, agora) {
    const v = app.getSelfPath(p)
    if (!v) return { value: undefined, em: undefined }
    const ts = v.timestamp
    if (ts === undefined || vistos[p]?.ts !== ts) vistos[p] = { ts, em: agora }
    return { value: v.value, em: vistos[p].em }
  }

  function ciclo (calc) {
    // O relógio dos alvos: a hora da última posição (no simulador e no barco).
    const alvos = alvosAis()
    const agora = Math.max(Date.now(), ...alvos.map(a => a.em || 0))
    const pos = lerNosso('navigation.position', agora)
    const temPos = pos.value && Number.isFinite(pos.value.latitude) && Number.isFinite(pos.value.longitude)
    if (!temPos || agora - pos.em > EU_VELHO) {
      app.handleMessage(plugin.id, { updates: [{ values: [{ path: 'navigation.arlequin.emPorto', value: null }] }] })
      app.setPluginStatus(`Sem a nossa posição (GPS) há mais de 10 s: o vigia AIS não julga nada · ${Object.keys(ativos).length} alarmes ativos`)
      return
    }
    const sog = lerNosso('navigation.speedOverGround', agora)
    const cog = lerNosso('navigation.courseOverGroundTrue', agora)
    const eu = { position: pos.value, posEm: pos.em, sog: sog.value, sogEm: sog.em, cog: cog.value, cogEm: cog.em }
    const r = avaliarAlvos(ativos, eu, alvos, agora, calc, memoria, { portos })
    ativos = r.ativos
    memoria = r.memoria
    publicar(r.notificacoes)
    app.handleMessage(plugin.id, { updates: [{ values: [{ path: 'navigation.arlequin.emPorto', value: r.emPorto }] }] })
    gravarAtivos(agora)
    for (const n of r.notificacoes) app.debug(`${n.mmsi} ${n.state}: ${n.message}`)
    app.setPluginStatus(`${alvos.length} alvos AIS · ${Object.keys(ativos).length} em perigo` +
      (r.emPorto ? ` · em porto (${memoria.porto?.nome || '?'}): os alvos parados não apitam` : '') +
      (memoria.amarrado ? ' · amarrado: os alvos parados não dão alarme' : '') +
      (semPortosDaRota ? ' · SEM OS PORTOS DA ROTA' : ''))
  }

  plugin.start = function (props = {}) {
    const g = ++geracao
    const o = { portos: EXTRAS, destinos: DESTINOS_DA_ROTA, ...props }
    ativos = {}
    memoria = novaMemoria()
    vistos = {}
    // os portos conhecidos: os destinos da rota (lidos agora: uma atualização conta no arranque seguinte)
    // e os extras; sem o ficheiro da rota, só os extras, e diz-se
    let daRota = []
    semPortosDaRota = null
    try { daRota = portosDaRota(o.destinos) } catch (e) {
      semPortosDaRota = `não li os destinos da rota (${o.destinos}): ${e.message}`
      app.error(`alarme AIS: ${semPortosDaRota}; o "em porto" só conta com os portos extra`)
    }
    portos = juntarPortos(daRota, Array.isArray(o.portos) ? o.portos : EXTRAS)
    const dir = app.getDataDirPath?.()
    ficheiro = null
    if (dir) {
      try { fs.mkdirSync(dir, { recursive: true }); ficheiro = path.join(dir, 'alarmes-ativos.json') } catch (e) { app.error(`alarme AIS: sem a pasta de dados (${e.message})`) }
    }
    gravado = '{}'
    gravadoEm = 0
    reporAtivos()
    // o cálculo é um módulo ES (o do ecrã): carrega-se à parte; plugin.pronto acaba quando o vigia arranca
    plugin.pronto = import(pathToFileURL(caminhoCpa()).href).then((calc) => {
      if (g !== geracao) return // parou (ou voltou a arrancar) enquanto carregava: sem temporizador órfão
      temporizador = setInterval(() => ciclo(calc), 2000)
    }, (e) => { if (g === geracao) app.setPluginError(`não encontrei o cálculo de CPA: ${e.message}`) })
  }

  plugin.stop = function () {
    geracao++
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    // o ficheiro fica com os ativos (o arranque seguinte repõe-nos); a árvore passa a normal (auditoria
    // I-21): um plugin desligado pelo Admin UI não deixa o ecrã a apitar
    gravarAtivos(Date.now(), { sempre: true })
    publicar(Object.keys(ativos).map(mmsi => ({ mmsi, state: 'normal', method: [], message: 'Normal' })))
    ativos = {}
  }

  return plugin
}
