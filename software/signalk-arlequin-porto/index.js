'use strict'
// Plugin SignalK: monitorização do Arlequin no porto. Sensores (porão, bomba,
// fumo, gaiuta, movimento, líquido debaixo do depósito) + GPS → alarmes; os
// alarmes de todos os plugins seguem para o Telegram; comandos pelo Telegram;
// batimento para um serviço externo (healthchecks.io). Sem portas abertas.
//
// Plano de navegação (desenho 3b-1): o plugin da rota emite 'arlequin:plano' { pedido, texto, gpx,
// nomeFicheiro }; aqui envia-se a mensagem e o GPX aos chatIds e aos contactosPlano, e responde-se
// com 'arlequin:plano-enviado' { pedido, entregues: [nome], contactos: [nome], chats: [chatId], falhas: [{ nome, erro }] }.
// contactos (e chats, os chatId deles, pela mesma ordem): os contactos em terra que o receberam (os
// contactosPlano entregues que não estão nos chatIds: um chat nas duas listas é do Ivo e comanda). Só
// eles têm a hora de alarme em terra.
// A navegar (desenho 3b-2), o plugin da rota manda também { pedido, tipo: 'plano' | 'chegada' | 'atraso' |
// 'terminado', texto, gpx?, nomeFicheiro?, destinatarios: 'contactos-do-plano', contactos: [nome],
// chats: [chatId] }: vai só aos contactosPlano com esses chatId (os que receberam o plano; escolhe-se
// pelo chatId, nunca pelo nome) e aos chatIds (o Ivo); um chat pedido que já não está nos
// contactosPlano vai para as falhas, com o nome do pedido. O GPX só no tipo 'plano'. Uma mensagem com
// tipo que não seja 'plano' é sempre assim, mesmo sem destinatarios (sem chats, só ao Ivo). Sem tipo e
// sem destinatarios, como na 3b-1: a todos. Uma nova tentativa (tentativa > 1) já não vai ao Ivo, só aos
// contactos indicados (re-revisão M-5: o Ivo não recebe a mesma mensagem de 2 em 2 min).
// Os contactosPlano só recebem: as mensagens deles são ignoradas (não comandam). Quem escreve sem
// estar em nenhuma das listas recebe o código para dar ao Ivo (uma vez por hora) e não fica autorizado.
// O estado do encaminhador dos alarmes fica em encaminhador.json (escrita atómica): um reinício não
// repete os avisos ativos nem o "✓ Resolvido".
// O plano vai a todos os destinatários em paralelo e cada chamada ao Telegram tem um limite de 10 s,
// para a resposta chegar bem antes dos 30 s que o plugin da rota espera; as falhas vão em pt-PT
// ("bloqueou o bot", "sem ligação ao Telegram", "erro do Telegram: …").

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec } = require('node:child_process')
const { novoEstado, passo, distancia } = require('./lib/regras')
const { novoEncaminhador, encaminhar, listarNotificacoes, alarmesAtivos } = require('./lib/mensagens')
const { resumo } = require('./lib/resumo')
const { criarTelegram, erroEmPortugues } = require('./lib/telegram')

const CAMINHOS = {
  agua: 'sensors.porao.agua',
  bomba: 'sensors.porao.bomba',
  fumo: 'sensors.fumo',
  liquidoGasoleo: 'sensors.gasoleo.liquido',
  gaiuta: 'sensors.gaiuta.aberta',
  movimento: 'sensors.movimento'
}

const UMA_HORA = 3600000

// Escrita atómica: escreve um .tmp ao lado, fsync, e rename por cima (um corte a meio deixa o antigo).
function escreverAtomico (ficheiro, texto) {
  const tmp = `${ficheiro}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, texto); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.renameSync(tmp, ficheiro) } catch (e) { try { fs.unlinkSync(tmp) } catch { /* já não existe */ } throw e }
}
const FORA_DA_LISTA = 'já não está nos "Contactos do plano" do plugin porto'
const MAX_CODIGOS = 500 // os desconhecidos de que se guarda a hora do código (os mais antigos saem)
const textoCodigo = (chatId) => `Para receberes os planos do ARLEQUIN, dá este código ao Ivo: ${chatId}`

const AJUDA = `Comandos do Arlequin:
/estado — baterias, depósitos, cabine, alarmes
/foto — fotografia do interior
/posicao — posição do barco
/armar · /desarmar — alarme de intrusão
/amarrar — grava aqui o ponto de amarração
/largar — apaga o ponto de amarração`

// deps (testes): agora() o relógio do anti-spam; maxCodigos; limiteTelegramMs o limite de cada chamada
module.exports = function (app, deps = {}) {
  const agora = deps.agora || (() => Date.now())
  const maxCodigos = deps.maxCodigos ?? MAX_CODIGOS
  const plugin = {
    id: 'signalk-arlequin-porto',
    name: 'Arlequin · porto',
    description: 'Monitorização no porto: porão, fumo, intrusão, deriva; alarmes e comandos pelo Telegram'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      telegramToken: { type: 'string', title: 'Token do bot do Telegram (criado no @BotFather)', default: '' },
      chatIds: { type: 'array', title: 'Chats autorizados (o teu; o plugin mostra o número de quem escrever)', default: [], items: { type: 'string' } },
      contactosPlano: {
        type: 'array',
        title: 'Contactos do plano: só recebem o plano de navegação, nunca comandam (o código vem do /start ao bot)',
        default: [],
        items: { type: 'object', properties: { nome: { type: 'string', title: 'Nome' }, chatId: { type: 'string', title: 'Código (chatId)' } } }
      },
      telegramBase: { type: 'string', title: 'Servidor do Telegram (não mudar; só para testes)', default: 'https://api.telegram.org' },
      pollTimeout: { type: 'number', title: 'Long polling (s)', default: 25 },
      batimentoUrl: { type: 'string', title: 'URL do batimento (healthchecks.io), de 5 em 5 min', default: '' },
      comandoFoto: { type: 'string', title: 'Comando da fotografia ({ficheiro} = JPEG a escrever), ex.: rpicam-still -n -o {ficheiro}', default: '' },
      caminhos: {
        type: 'object',
        title: 'Caminhos dos sensores (0/1)',
        properties: Object.fromEntries(Object.entries(CAMINHOS).map(([k, v]) => [k, { type: 'string', default: v }]))
      }
    }
  }

  let o = {}
  let estado = novoEstado()
  let enc = novoEncaminhador()
  let persist = { armado: false, ponto: null }
  let ficheiro
  let temporizadores = []
  let aCorrer = false
  let tg = null
  let offset = 0
  let codigoEnviado = new Map() // chatId desconhecido → quando recebeu o código (anti-spam: 1 por hora; por ordem)

  const val = (p) => app.getSelfPath?.(p)?.value
  const bool = (p) => { const x = val(p); return x === undefined || x === null ? undefined : !!x }
  const guardar = () => { try { fs.writeFileSync(ficheiro, JSON.stringify(persist)) } catch (e) { app.error(e.message) } }

  // os chats autorizados: sem espaços, sem vazios, sem repetir (o mesmo para enviar e para autorizar)
  const chatsAutorizados = () => [...new Set((Array.isArray(o.chatIds) ? o.chatIds : []).map(id => String(id ?? '').trim()).filter(Boolean))]

  async function enviarTodos (texto) {
    if (!tg) return
    for (const id of chatsAutorizados()) {
      try { await tg.sendMessage(id, texto) } catch (e) { app.error(`Telegram: ${e.message}`) }
    }
  }

  function tirarFoto () {
    return new Promise((resolve, reject) => {
      if (!o.comandoFoto) return reject(new Error('sem câmara configurada'))
      const f = path.join(os.tmpdir(), `arlequin-foto-${Date.now()}.jpg`)
      exec(o.comandoFoto.replace('{ficheiro}', f), { timeout: 20000 }, (e) => {
        if (e) return reject(new Error(`câmara: ${e.message}`))
        try { const b = fs.readFileSync(f); fs.unlink(f, () => {}); resolve(b) } catch (err) { reject(err) }
      })
    })
  }

  async function enviarFoto (legenda, paraId) {
    if (!tg) return
    const destinos = paraId ? [paraId] : chatsAutorizados()
    try {
      const jpeg = await tirarFoto()
      for (const id of destinos) await tg.sendPhoto(id, jpeg, legenda)
    } catch (e) {
      for (const id of destinos) await tg.sendMessage(id, `📷 ${e.message}`).catch(() => {})
    }
  }

  function textoEstado () {
    const pos = val('navigation.position')
    const alarmes = alarmesAtivos(listarNotificacoes(app.getSelfPath?.('notifications')))
    return resumo(val, {
      armado: persist.armado,
      amarracao: { ponto: estado.amarracao.ponto, distancia: estado.amarracao.ponto && pos ? distancia(estado.amarracao.ponto, pos) : null },
      alarmes
    })
  }

  async function comando (chatId, texto) {
    const c = (texto || '').trim().split(/\s+/)[0].toLowerCase().replace(/@.*/, '')
    const pos = val('navigation.position')
    if (c === '/estado') return tg.sendMessage(chatId, textoEstado())
    if (c === '/foto') return enviarFoto('📷 Arlequin agora', chatId)
    if (c === '/posicao') return pos ? tg.sendLocation(chatId, pos.latitude, pos.longitude) : tg.sendMessage(chatId, 'Sem posição do GPS')
    if (c === '/armar') { persist.armado = true; guardar(); return tg.sendMessage(chatId, '🔒 Alarme de intrusão ARMADO') }
    if (c === '/desarmar') { persist.armado = false; guardar(); return tg.sendMessage(chatId, '🔓 Alarme de intrusão desarmado') }
    if (c === '/amarrar') {
      if (!pos) return tg.sendMessage(chatId, 'Sem posição do GPS')
      estado = { ...estado, amarracao: { ...estado.amarracao, ponto: pos } }
      persist.ponto = pos; guardar()
      return tg.sendMessage(chatId, '⚓ Ponto de amarração gravado aqui (alarme a 30 m)')
    }
    if (c === '/largar') {
      estado = { ...estado, amarracao: { ...estado.amarracao, ponto: null } }
      persist.ponto = null; guardar()
      return tg.sendMessage(chatId, '⚓ Ponto de amarração apagado')
    }
    return tg.sendMessage(chatId, AJUDA)
  }

  // os contactos do plano válidos: [{ nome, chatId }]
  const contactosPlano = () => (Array.isArray(o.contactosPlano) ? o.contactosPlano : [])
    .filter(c => c && c.chatId != null && String(c.chatId).trim())
    .map(c => ({ nome: String(c.nome || '').trim() || `chat ${String(c.chatId).trim()}`, chatId: String(c.chatId).trim() }))

  // Só aos indicados: com destinatarios 'contactos-do-plano' ou com um tipo que não seja o plano
  // (chegada, atraso, terminado, ou um tipo desconhecido): nunca a todos os contactos.
  const restrito = (ev) => ev?.destinatarios === 'contactos-do-plano' || (ev?.tipo != null && ev.tipo !== 'plano')
  // os destinatários do plano: os chats autorizados e os contactos do plano (em terra), sem repetir;
  // restrito, só os contactos com os chatId pedidos. → { lista, faltam: [{ nome, erro }] } (os chats
  // pedidos que já não estão nos contactos do plano)
  function destinatariosPlano (ev) {
    const pedidos = restrito(ev) ? (Array.isArray(ev.chats) ? ev.chats : []).map(x => String(x ?? '').trim()) : null
    const so = pedidos ? new Set(pedidos) : null
    const ivo = chatsAutorizados()
    // as novas tentativas de uma mensagem para terra (re-revisão M-5) já não vão ao Ivo: só a 1.ª
    const comIvo = !(pedidos && Number(ev.tentativa) > 1)
    const out = []
    if (comIvo) for (const id of ivo) out.push({ nome: `chat ${id}`, chatId: id, emTerra: false })
    for (const c of contactosPlano()) if ((!so || so.has(c.chatId)) && !ivo.includes(c.chatId) && !out.some(d => d.chatId === c.chatId)) out.push({ ...c, emTerra: true })
    const nomes = Array.isArray(ev?.contactos) ? ev.contactos.map(String) : []
    const faltam = (pedidos || []).map((id, i) => ({ id, i })).filter(({ id }) => id && !contactosPlano().some(c => c.chatId === id))
      .map(({ id, i }) => ({ nome: nomes[i] || `chat ${id}`, erro: FORA_DA_LISTA }))
    return { lista: out, faltam }
  }

  async function enviarPlano (ev) {
    const pedido = ev?.pedido
    const responder = (entregues, falhas, contactos = [], chats = []) => app.emit('arlequin:plano-enviado', { pedido, entregues, contactos, chats, falhas })
    // o cliente do início: um stop() a meio (tg = null) não estraga o envio, que acaba sozinho
    const cliente = tg
    if (!cliente) return responder([], [{ nome: 'Telegram', erro: 'o plugin porto não tem o token do bot' }])
    // o GPX só no plano (sem tipo: o da 3b-1; ou o plano novo)
    const comGpx = ev?.tipo == null || ev.tipo === 'plano'
    const gpx = comGpx && typeof ev?.gpx === 'string' && ev.gpx ? Buffer.from(ev.gpx, 'utf8') : null
    // todos ao mesmo tempo; em cada um, a mensagem e depois o GPX
    const { lista, faltam } = destinatariosPlano(ev)
    const resultados = await Promise.all(lista.map(async (d) => {
      try {
        await cliente.sendMessage(d.chatId, String(ev?.texto ?? ''))
        if (gpx) await cliente.sendDocument(d.chatId, gpx, ev.nomeFicheiro || 'plano.gpx')
        return { nome: d.nome, chatId: d.chatId, emTerra: d.emTerra }
      } catch (e) { return { nome: d.nome, erro: erroEmPortugues(e) } }
    }))
    const ok = resultados.filter(x => !x.erro)
    const emTerra = ok.filter(x => x.emTerra)
    responder(ok.map(x => x.nome), [...resultados.filter(x => x.erro), ...faltam], emTerra.map(x => x.nome), emTerra.map(x => x.chatId))
  }
  const aoPlano = (ev) => { enviarPlano(ev).catch(e => app.error(`plano: ${e.message}`)) }

  // Quem escreve sem estar nas listas: o número no estado do plugin e, uma vez por hora, o código.
  async function desconhecido (chatId) {
    app.setPluginStatus(`Mensagem de um chat NÃO autorizado: ${chatId} (se for o teu, junta-o em "Chats autorizados"; para só receber os planos, em "Contactos do plano")`)
    if (!chatId) return
    const t = agora()
    const antes = codigoEnviado.get(chatId)
    if (antes != null && t - antes < UMA_HORA) return
    // a lista não cresce sem fim: saem os de há mais de 1 h e, acima do máximo, os mais antigos
    codigoEnviado.delete(chatId)
    for (const [id, quando] of codigoEnviado) if (t - quando >= UMA_HORA) codigoEnviado.delete(id)
    codigoEnviado.set(chatId, t)
    while (codigoEnviado.size > maxCodigos) codigoEnviado.delete(codigoEnviado.keys().next().value)
    // quem bloqueou o bot (ou a rede a falhar) não pode parar o ciclo dos comandos do Ivo
    const cliente = tg
    if (!cliente) return
    await cliente.sendMessage(chatId, textoCodigo(chatId)).catch(e => app.error(`Telegram (código para ${chatId}): ${erroEmPortugues(e)}`))
  }

  async function ouvirTelegram () {
    while (aCorrer && tg) {
      try {
        const updates = await tg.getUpdates(offset, o.pollTimeout)
        for (const u of updates) {
          offset = u.update_id + 1
          const chatId = String(u.message?.chat?.id ?? '')
          if (chatId && chatsAutorizados().includes(chatId)) { await comando(chatId, u.message?.text); continue }
          // os contactos do plano só recebem: os comandos deles ignoram-se
          if (contactosPlano().some(c => c.chatId === chatId)) continue
          await desconhecido(chatId)
        }
      } catch (e) {
        app.error(`Telegram: ${e.message}`)
        await new Promise(r => setTimeout(r, 10000))
      }
    }
  }

  function tick () {
    const c = { ...CAMINHOS, ...(o.caminhos || {}) }
    const rpm = val('propulsion.main.revolutions')
    const r = passo(estado, {
      posicao: val('navigation.position'),
      sog: val('navigation.speedOverGround'),
      motorLigado: typeof rpm === 'number' && rpm > 5,
      agua: bool(c.agua),
      bomba: bool(c.bomba),
      fumo: bool(c.fumo),
      liquidoGasoleo: bool(c.liquidoGasoleo),
      gaiuta: bool(c.gaiuta),
      movimento: bool(c.movimento),
      armado: persist.armado
    }, Date.now())
    estado = r.estado
    if (JSON.stringify(estado.amarracao.ponto) !== JSON.stringify(persist.ponto)) {
      persist.ponto = estado.amarracao.ponto
      guardar()
    }
    if (r.notificacoes.length) {
      app.handleMessage(plugin.id, {
        updates: [{ values: r.notificacoes.map(n => ({ path: `notifications.arlequin.porto.${n.id}`, value: { state: n.state, method: n.method, message: n.message } })) }]
      })
    }
    for (const a of r.acoes) {
      if (a.tipo === 'foto') enviarFoto('📷 Alarme de intrusão')
      if (a.tipo === 'lembrete') enviarTodos(`🔓 ${a.texto}`)
    }
    app.setPluginStatus(`${persist.armado ? '🔒 armado' : 'desarmado'} · ${estado.amarracao.ponto ? 'amarrado' : 'sem ponto'} · Telegram ${tg ? 'ligado' : 'sem token'}`)
  }

  // O estado do encaminhador em disco (Tarefa 8.3): depois de um reinício, um aviso ainda ativo não se
  // repete e o "✓ Resolvido" sai uma só vez. Escrita atómica (o .tmp, o fsync e o rename).
  let ficheiroEnc
  function lerEncaminhador () {
    try {
      const x = JSON.parse(fs.readFileSync(ficheiroEnc, 'utf8'))
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('não é um encaminhador')
      const base = novoEncaminhador()
      for (const k of Object.keys(base)) if (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k])) base[k] = x[k]
      return base
    } catch (e) {
      if (e.code !== 'ENOENT') app.error(`encaminhador.json ilegível (começa vazio): ${e.message}`)
      return novoEncaminhador()
    }
  }
  function gravarEncaminhador () {
    try { escreverAtomico(ficheiroEnc, JSON.stringify(enc)) } catch (e) { app.error(`não gravei o encaminhador: ${e.message}`) }
  }
  function encaminharAlarmes () {
    const lista = listarNotificacoes(app.getSelfPath?.('notifications'))
    const r = encaminhar(enc, lista, Date.now(), { amarrado: !!estado.amarracao.ponto })
    const mudou = JSON.stringify(r.enc) !== JSON.stringify(enc)
    enc = r.enc
    if (mudou) gravarEncaminhador()
    for (const m of r.mensagens) enviarTodos(m)
  }

  plugin.start = function (props) {
    o = { telegramToken: '', chatIds: [], contactosPlano: [], telegramBase: 'https://api.telegram.org', pollTimeout: 25, batimentoUrl: '', comandoFoto: '', ...props }
    codigoEnviado = new Map()
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiro = path.join(dir, 'porto.json')
    try { persist = { armado: false, ponto: null, ...JSON.parse(fs.readFileSync(ficheiro, 'utf8')) } } catch { persist = { armado: false, ponto: null } }
    estado = novoEstado()
    estado.amarracao.ponto = persist.ponto
    ficheiroEnc = path.join(dir, 'encaminhador.json')
    enc = lerEncaminhador()
    offset = 0
    aCorrer = true
    tg = o.telegramToken ? criarTelegram({ token: o.telegramToken, base: o.telegramBase, ...(deps.limiteTelegramMs ? { limiteMs: deps.limiteTelegramMs } : {}) }) : null
    temporizadores = [setInterval(tick, 1000), setInterval(encaminharAlarmes, 2000)]
    if (o.batimentoUrl) {
      const bater = () => fetch(o.batimentoUrl).catch(e => app.error(`batimento: ${e.message}`))
      bater()
      temporizadores.push(setInterval(bater, 5 * 60 * 1000))
    }
    app.removeListener?.('arlequin:plano', aoPlano)
    app.on?.('arlequin:plano', aoPlano)
    if (tg) ouvirTelegram()
  }

  plugin.stop = function () {
    app.removeListener?.('arlequin:plano', aoPlano)
    aCorrer = false
    temporizadores.forEach(clearInterval)
    temporizadores = []
    tg = null
  }

  return plugin
}
