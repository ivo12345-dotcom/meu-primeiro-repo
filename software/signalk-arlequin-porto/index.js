'use strict'
// Plugin SignalK: monitorização do Arlequin no porto. Sensores (porão, bomba,
// fumo, gaiuta, movimento, líquido debaixo do depósito) + GPS → alarmes; os
// alarmes de todos os plugins seguem para o Telegram; comandos pelo Telegram;
// batimento para um serviço externo (healthchecks.io). Sem portas abertas.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec } = require('node:child_process')
const { novoEstado, passo, distancia } = require('./lib/regras')
const { novoEncaminhador, encaminhar, listarNotificacoes } = require('./lib/mensagens')
const { resumo } = require('./lib/resumo')
const { criarTelegram } = require('./lib/telegram')

const CAMINHOS = {
  agua: 'sensors.porao.agua',
  bomba: 'sensors.porao.bomba',
  fumo: 'sensors.fumo',
  liquidoGasoleo: 'sensors.gasoleo.liquido',
  gaiuta: 'sensors.gaiuta.aberta',
  movimento: 'sensors.movimento'
}

const AJUDA = `Comandos do Arlequin:
/estado — baterias, depósitos, cabine, alarmes
/foto — fotografia do interior
/posicao — posição do barco
/armar · /desarmar — alarme de intrusão
/amarrar — grava aqui o ponto de amarração
/largar — apaga o ponto de amarração`

module.exports = function (app) {
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

  const val = (p) => app.getSelfPath?.(p)?.value
  const bool = (p) => { const x = val(p); return x === undefined || x === null ? undefined : !!x }
  const guardar = () => { try { fs.writeFileSync(ficheiro, JSON.stringify(persist)) } catch (e) { app.error(e.message) } }

  async function enviarTodos (texto) {
    if (!tg) return
    for (const id of o.chatIds) {
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
    const destinos = paraId ? [paraId] : o.chatIds
    try {
      const jpeg = await tirarFoto()
      for (const id of destinos) await tg.sendPhoto(id, jpeg, legenda)
    } catch (e) {
      for (const id of destinos) await tg.sendMessage(id, `📷 ${e.message}`).catch(() => {})
    }
  }

  function textoEstado () {
    const pos = val('navigation.position')
    const alarmes = listarNotificacoes(app.getSelfPath?.('notifications'))
      .filter(n => ['alarm', 'emergency', 'warn'].includes(n.state)).map(n => n.message || n.caminho)
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

  async function ouvirTelegram () {
    while (aCorrer && tg) {
      try {
        const updates = await tg.getUpdates(offset, o.pollTimeout)
        for (const u of updates) {
          offset = u.update_id + 1
          const chatId = String(u.message?.chat?.id ?? '')
          if (!o.chatIds.map(String).includes(chatId)) {
            app.setPluginStatus(`Mensagem de um chat NÃO autorizado: ${chatId} (se for o teu, junta-o em "Chats autorizados")`)
            continue
          }
          await comando(chatId, u.message?.text)
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

  function encaminharAlarmes () {
    const lista = listarNotificacoes(app.getSelfPath?.('notifications'))
    const r = encaminhar(enc, lista, Date.now(), { amarrado: !!estado.amarracao.ponto })
    enc = r.enc
    for (const m of r.mensagens) enviarTodos(m)
  }

  plugin.start = function (props) {
    o = { telegramToken: '', chatIds: [], telegramBase: 'https://api.telegram.org', pollTimeout: 25, batimentoUrl: '', comandoFoto: '', ...props }
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiro = path.join(dir, 'porto.json')
    try { persist = { armado: false, ponto: null, ...JSON.parse(fs.readFileSync(ficheiro, 'utf8')) } } catch { persist = { armado: false, ponto: null } }
    estado = novoEstado()
    estado.amarracao.ponto = persist.ponto
    enc = novoEncaminhador()
    offset = 0
    aCorrer = true
    tg = o.telegramToken ? criarTelegram({ token: o.telegramToken, base: o.telegramBase }) : null
    temporizadores = [setInterval(tick, 1000), setInterval(encaminharAlarmes, 2000)]
    if (o.batimentoUrl) {
      const bater = () => fetch(o.batimentoUrl).catch(e => app.error(`batimento: ${e.message}`))
      bater()
      temporizadores.push(setInterval(bater, 5 * 60 * 1000))
    }
    if (tg) ouvirTelegram()
  }

  plugin.stop = function () {
    aCorrer = false
    temporizadores.forEach(clearInterval)
    temporizadores = []
    tg = null
  }

  return plugin
}
