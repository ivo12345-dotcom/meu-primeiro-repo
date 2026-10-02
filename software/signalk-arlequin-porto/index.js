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
// O estado do encaminhador dos alarmes fica em encaminhador.json (escrita atómica): um reinício do plugin
// não repete os avisos ativos nem o "✓ Resolvido"; depois de um reinício do servidor (a árvore das
// notificações vem vazia), um aviso ainda ativo volta a seguir uma vez (lib/mensagens.js).
// As mensagens dos alarmes vão para o Telegram por uma fila, gravada no mesmo encaminhador.json
// (auditoria K-09, decisão n.º 17): uma que o Telegram não aceitou fica lá e tenta-se outra vez, com
// recuo até 1 min, até ser entregue a pelo menos um chat autorizado; chega com "(atrasado N min)". Os
// alarmes passam à frente dos avisos e dos "Resolvido" (cada caminho pela sua ordem) e uma que o Telegram
// recusa sempre sai ao fim de 3 tentativas, com registo e um aviso ao Ivo (auditoria F4b).
// O plano com o texto entregue conta como entregue mesmo que o GPX falhe (o GPX vai para as falhas, "GPX: …").
// O plano vai a todos os destinatários em paralelo e cada chamada ao Telegram tem um limite de 10 s,
// para a resposta chegar bem antes dos 30 s que o plugin da rota espera; as falhas vão em pt-PT
// ("bloqueou o bot", "sem ligação ao Telegram", "erro do Telegram (código N)"; o pormenor de um erro
// que não se conhece fica no registo: auditoria I-32).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec } = require('node:child_process')
const { ALARMES, APITO, novoEstado, passo, distancia } = require('./lib/regras')
const { novoEncaminhador, encaminhar, listarNotificacoes, alarmesAtivos } = require('./lib/mensagens')
const { porNaFila, proximo, textoAEnviar, recuoMs, filaValida, excerto, avisoDeRecusa, MAX_FILA, MAX_RECUSAS } = require('./lib/fila')
const { EXTRAS, lerDestinosDaRota, lugaresDaConfiguracao, lugarPerto } = require('./lib/lugares')
const { resumo } = require('./lib/resumo')
const { criarTelegram, erroEmPortugues, erroConhecido, recusaDoTelegram } = require('./lib/telegram')

const CAMINHOS = {
  agua: 'sensors.porao.agua',
  bomba: 'sensors.porao.bomba',
  fumo: 'sensors.fumo',
  liquidoGasoleo: 'sensors.gasoleo.liquido',
  gaiuta: 'sensors.gaiuta.aberta',
  movimento: 'sensors.movimento'
}

const UMA_HORA = 3600000
const ATIVO = new Set(['warn', 'alert', 'alarm', 'emergency'])

// Escrita atómica: escreve um .tmp ao lado, fsync, e rename por cima (um corte a meio deixa o antigo;
// uma escrita que falha não deixa o .tmp).
function escreverAtomico (ficheiro, texto) {
  const tmp = `${ficheiro}.${process.pid}.tmp`
  try {
    const fd = fs.openSync(tmp, 'w')
    try { fs.writeSync(fd, texto); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, ficheiro)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* já não existe */ }
    throw e
  }
}
const FORA_DA_LISTA = 'já não está nos "Contactos do plano" do plugin porto'
const AVISO_PORTO_ILEGIVEL = '⚠️ Perdi o estado do porto (porto.json ilegível): o alarme de intrusão ficou desarmado e sem ponto de amarração. Arma outra vez com /armar.'
const MAX_CODIGOS = 500 // os desconhecidos de que se guarda a hora do código (os mais antigos saem)
const textoCodigo = (chatId) => `Para receberes os planos do ARLEQUIN, dá este código ao Ivo: ${chatId}`

const AJUDA = `Comandos do Arlequin:
/estado — baterias, depósitos, cabine, alarmes
/foto — fotografia do interior
/posicao — posição do barco
/armar · /desarmar — alarme de intrusão
/amarrar — grava aqui o ponto de amarração
/largar — apaga o ponto de amarração
/ajuda — esta lista`

// O erro de uma chamada ao Telegram para o registo, com um só prefixo (auditoria M-53: era "Telegram:
// Telegram sendMessage: …"): os do cliente já começam por "Telegram <método>:".
const registoTelegram = (e) => { const m = String(e?.message ?? e); return /^Telegram\b/.test(m) ? m : `Telegram: ${m}` }

// deps (testes): agora() o relógio (anti-spam, regras, encaminhador e fila); maxCodigos; limiteTelegramMs
// o limite de cada chamada; tickMs, encaminharMs os ciclos (1 s e 2 s); pausaFilaMs entre duas
// mensagens da fila (1 s: o Telegram não quer mais do que uma por segundo no mesmo chat); maxFila o
// limite da fila (100)
module.exports = function (app, deps = {}) {
  const agora = deps.agora || (() => Date.now())
  const maxCodigos = deps.maxCodigos ?? MAX_CODIGOS
  const tickMs = deps.tickMs ?? 1000
  const encaminharMs = deps.encaminharMs ?? 2000
  const pausaFilaMs = deps.pausaFilaMs ?? 1000
  const maxFila = deps.maxFila ?? MAX_FILA
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
      lugares: {
        type: 'array',
        title: 'Fundeadouros e portos, além dos destinos da rota: o ponto de amarração só se grava sozinho a menos de 1 km de um deles (no mar nunca; o /amarrar grava em qualquer sítio)',
        default: EXTRAS.map(x => ({ ...x })),
        items: { type: 'object', properties: { nome: { type: 'string', title: 'Nome' }, latitude: { type: 'number', title: 'Latitude (graus, N +)' }, longitude: { type: 'number', title: 'Longitude (graus, W −)' } } }
      },
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
  let persist = { armado: false, ponto: null, ativos: {} }
  let ficheiro
  let temporizadores = []
  let aCorrer = false
  let tg = null
  let offset = 0
  let codigoEnviado = new Map() // chatId desconhecido → quando recebeu o código (anti-spam: 1 por hora; por ordem)
  let lugares = [] // os portos e fundeadouros conhecidos (lib/lugares.js): só junto a eles o ponto se grava sozinho

  const val = (p) => app.getSelfPath?.(p)?.value
  const bool = (p) => { const x = val(p); return x === undefined || x === null ? undefined : !!x }
  // o porto.json (armado, ponto, alarmes ativos) com escrita atómica: um corte a meio não o estraga
  // (auditoria M-52; antes um porto.json estragado desarmava a intrusão em silêncio)
  const guardar = () => { try { escreverAtomico(ficheiro, JSON.stringify(persist)) } catch (e) { app.error(`não gravei o porto.json: ${e.message}`) } }
  const PORTO_VAZIO = () => ({ armado: false, ponto: null, ativos: {} })
  const pontoValido = (p) => p && typeof p === 'object' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  // → { persist, erro } (erro: o ficheiro existe mas não se lê; sem ficheiro, começa vazio em silêncio)
  function lerPorto () {
    let x
    try { x = JSON.parse(fs.readFileSync(ficheiro, 'utf8')) } catch (e) {
      return { persist: PORTO_VAZIO(), erro: e.code === 'ENOENT' ? null : e.message }
    }
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { persist: PORTO_VAZIO(), erro: 'não é o estado do porto' }
    return {
      persist: { armado: x.armado === true, ponto: pontoValido(x.ponto) ? { ...x.ponto } : null, ativos: x.ativos && typeof x.ativos === 'object' && !Array.isArray(x.ativos) ? x.ativos : {} },
      erro: null
    }
  }

  // os chats autorizados: sem espaços, sem vazios, sem repetir (o mesmo para enviar e para autorizar)
  const chatsAutorizados = () => [...new Set((Array.isArray(o.chatIds) ? o.chatIds : []).map(id => String(id ?? '').trim()).filter(Boolean))]

  // (só o lembrete de armar: os alarmes vão pela fila)
  async function enviarTodos (texto) {
    const cliente = tg
    if (!cliente) return
    for (const id of chatsAutorizados()) {
      try { await cliente.sendMessage(id, texto) } catch (e) { app.error(registoTelegram(e)) }
    }
  }

  function tirarFoto () {
    return new Promise((resolve, reject) => {
      if (!o.comandoFoto) return reject(Object.assign(new Error('sem câmara configurada'), { semCamara: true }))
      const f = path.join(os.tmpdir(), `arlequin-foto-${Date.now()}.jpg`)
      exec(o.comandoFoto.replace('{ficheiro}', f), { timeout: 20000 }, (e) => {
        if (e) return reject(new Error(`câmara: ${e.message}`))
        try { const b = fs.readFileSync(f); fs.unlink(f, () => {}); resolve(b) } catch (err) { reject(new Error(`câmara: ${err.message}`)) }
      })
    })
  }

  // Ao Telegram vai uma frase em pt-PT; o erro da linha de comandos ou do Telegram fica só no registo
  // (auditoria I-32: antes chegava "📷 câmara: Command failed: rpicam-still …").
  async function enviarFoto (legenda, paraId) {
    const cliente = tg
    if (!cliente) return
    const destinos = paraId ? [paraId] : chatsAutorizados()
    let jpeg
    try {
      jpeg = await tirarFoto()
    } catch (e) {
      if (!e.semCamara) app.error(`foto: ${e.message}`)
      for (const id of destinos) await cliente.sendMessage(id, e.semCamara ? '📷 sem câmara configurada' : '📷 a câmara falhou').catch(() => {})
      return
    }
    for (const id of destinos) {
      try {
        await cliente.sendPhoto(id, jpeg, legenda)
      } catch (e) {
        app.error(`foto: ${registoTelegram(e)}`)
        await cliente.sendMessage(id, `📷 não consegui enviar a fotografia: ${erroEmPortugues(e)}`).catch(() => {})
      }
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
      // e a contagem dos 30 min parado recomeça: com o barco ainda parado, o ponto não volta logo
      estado = { ...estado, amarracao: { ...estado.amarracao, ponto: null, paradoDesde: null, largouDesde: null } }
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
    // um erro que não se conhece vai ao ecrã como "erro do Telegram (código N)" e o pormenor fica aqui
    const falhou = (nome, e) => { if (erroConhecido(e) === null) app.error(`Telegram (plano para ${nome}): ${e?.message ?? e}`); return erroEmPortugues(e) }
    const resultados = await Promise.all(lista.map(async (d) => {
      try {
        await cliente.sendMessage(d.chatId, String(ev?.texto ?? ''))
      } catch (e) { return { nome: d.nome, erro: falhou(d.nome, e) } }
      // o texto chegou: conta como entregue mesmo que o GPX falhe (revisão final M4: a mensagem não
      // fica a repetir-se nem prende a fila); o GPX que falhou vai para as falhas
      let erroGpx = null
      if (gpx) {
        try { await cliente.sendDocument(d.chatId, gpx, ev.nomeFicheiro || 'plano.gpx') } catch (e) { erroGpx = `GPX: ${falhou(d.nome, e)}` }
      }
      return { nome: d.nome, chatId: d.chatId, emTerra: d.emTerra, erroGpx }
    }))
    const ok = resultados.filter(x => !x.erro)
    const emTerra = ok.filter(x => x.emTerra)
    const falhasGpx = ok.filter(x => x.erroGpx).map(x => ({ nome: x.nome, erro: x.erroGpx }))
    responder(ok.map(x => x.nome), [...resultados.filter(x => x.erro), ...falhasGpx, ...faltam], emTerra.map(x => x.nome), emTerra.map(x => x.chatId))
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

  // Um só ciclo de long polling (auditoria I-22): cada start() abre uma geração nova e o ciclo só
  // continua enquanto for o da geração atual; o stop() corta o pedido pendente (e a pausa de 10 s
  // depois de um erro). Antes, um stop() e start() seguidos (gravar a configuração) deixavam o ciclo
  // antigo vivo: dois getUpdates ao mesmo tempo (o Telegram verdadeiro dá 409 Conflict) e os comandos
  // do Ivo feitos duas vezes.
  let geracao = 0
  let escuta = null // o AbortController do ciclo atual
  const dormir = (ms, sinal) => new Promise(resolve => {
    if (sinal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    sinal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
  async function ouvirTelegram (g) {
    const ctl = new AbortController()
    escuta = ctl
    const cliente = tg
    while (aCorrer && tg === cliente && g === geracao) {
      try {
        const updates = await cliente.getUpdates(offset, o.pollTimeout, ctl.signal)
        for (const u of updates) {
          if (g !== geracao) return // reiniciou a meio: o ciclo novo volta a pedir estas
          offset = u.update_id + 1
          const chatId = String(u.message?.chat?.id ?? '')
          if (chatId && chatsAutorizados().includes(chatId)) { await comando(chatId, u.message?.text); continue }
          // os contactos do plano só recebem: os comandos deles ignoram-se
          if (contactosPlano().some(c => c.chatId === chatId)) continue
          await desconhecido(chatId)
        }
      } catch (e) {
        if (g !== geracao || e?.cancelado) return
        app.error(registoTelegram(e))
        await dormir(10000, ctl.signal)
      }
    }
  }

  // notificacoes: [{ id, state, method, message, apito? }] → notifications.arlequin.porto.<id> (o apito do
  // ecrã vai no valor: contrato C1)
  function publicar (notificacoes) {
    if (!notificacoes.length) return
    app.handleMessage(plugin.id, {
      updates: [{ values: notificacoes.map(n => ({ path: `notifications.arlequin.porto.${n.id}`, value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) } })) }]
    })
  }

  // Os alarmes do porto atravessam os reinícios (auditoria I-21). No arranque repõem-se os que estavam
  // ativos (os do porto.json e, de uma versão antiga, os que ainda estão na árvore) e publicam-se outra
  // vez: as regras continuam a partir deles e mandam o "normal" (e o encaminhador o "✓ Resolvido") quando
  // o sensor o diz; a intrusão fica até desarmar. Antes, o plugin arrancava a julgar que estava tudo
  // normal e um alarme que limpou ficava preso na árvore, sem o "Resolvido". No stop() os ativos passam a
  // normal (um plugin desligado não deixa um alarme a apitar no ecrã) e ficam no porto.json.
  function ativosNoArranque () {
    const out = {}
    const arvore = app.getSelfPath?.('notifications.arlequin.porto')
    for (const id of ALARMES) {
      const guardado = persist.ativos?.[id]
      const naArvore = arvore?.[id]?.value
      const x = guardado && ATIVO.has(guardado.state) ? guardado : naArvore && ATIVO.has(naArvore.state) ? naArvore : null
      if (x) out[id] = { state: x.state, message: typeof x.message === 'string' ? x.message : '' }
    }
    return out
  }
  const comoNotificacao = (ativos, normal = false) => Object.entries(ativos).map(([id, a]) => normal
    ? { id, state: 'normal', method: [], message: 'Normal' }
    : { id, state: a.state, method: ['visual', 'sound'], message: a.message, apito: APITO[id] })

  function tick () {
    const c = { ...CAMINHOS, ...(o.caminhos || {}) }
    const rpm = val('propulsion.main.revolutions')
    const pos = val('navigation.position')
    const r = passo(estado, {
      posicao: pos,
      sog: val('navigation.speedOverGround'),
      motorLigado: typeof rpm === 'number' && rpm > 5,
      juntoAPorto: lugarPerto(pos, lugares) !== null,
      agua: bool(c.agua),
      bomba: bool(c.bomba),
      fumo: bool(c.fumo),
      liquidoGasoleo: bool(c.liquidoGasoleo),
      gaiuta: bool(c.gaiuta),
      movimento: bool(c.movimento),
      armado: persist.armado
    }, agora())
    estado = r.estado
    // o ponto e os alarmes ativos ficam no porto.json (estes para os repor depois de um reinício: I-21)
    if (JSON.stringify(estado.amarracao.ponto) !== JSON.stringify(persist.ponto) || JSON.stringify(estado.ativos) !== JSON.stringify(persist.ativos)) {
      persist.ponto = estado.amarracao.ponto
      persist.ativos = { ...estado.ativos }
      guardar()
    }
    publicar(r.notificacoes)
    for (const a of r.acoes) {
      if (a.tipo === 'foto') enviarFoto('📷 Alarme de intrusão')
      if (a.tipo === 'lembrete') enviarTodos(`🔓 ${a.texto}`)
    }
    const porEntregar = enc.porEnviar.length
    const fila = porEntregar ? ` · ${porEntregar} por entregar${falhasFila ? ` (${falhasFila} ${falhasFila === 1 ? 'tentativa falhada' : 'tentativas falhadas'})` : ''}` : ''
    const recusadas = recusadasFila ? ` · ${recusadasFila} ${recusadasFila === 1 ? 'recusada' : 'recusadas'} pelo Telegram` : ''
    app.setPluginStatus(`${persist.armado ? '🔒 armado' : 'desarmado'} · ${estado.amarracao.ponto ? 'amarrado' : 'sem ponto'} · Telegram ${tg ? 'ligado' : 'sem token'}${fila}${recusadas}`)
  }

  // O estado do encaminhador em disco (Tarefa 8.3): depois de um reinício do plugin, um aviso ainda ativo
  // não se repete e o "✓ Resolvido" sai uma só vez; depois de um reinício do servidor (a árvore vazia), o
  // que desapareceu passa a normal e um alarme que volte segue (revisão final C2). Escrita atómica (o
  // .tmp, o fsync e o rename).
  let ficheiroEnc
  function lerEncaminhador () {
    try {
      const x = JSON.parse(fs.readFileSync(ficheiroEnc, 'utf8'))
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('não é um encaminhador')
      const base = novoEncaminhador()
      for (const k of Object.keys(base)) if (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k])) base[k] = x[k]
      base.porEnviar = filaValida(x.porEnviar)
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
    const r = encaminhar(enc, lista, agora(), { amarrado: !!estado.amarracao.ponto })
    let novo = r.enc
    // as mensagens novas entram na fila (gravada antes de enviar); sem token ou sem chats autorizados
    // não há a quem as entregar e não se guardam (como antes)
    if (r.itens.length && tg && chatsAutorizados().length) novo = { ...novo, porEnviar: naFila(novo.porEnviar, r.itens) }
    const mudou = JSON.stringify(novo) !== JSON.stringify(enc)
    enc = novo
    if (mudou) gravarEncaminhador()
    enviarFila().catch(e => app.error(`fila do Telegram: ${e.message}`))
  }
  // fila + mensagens novas, dentro do limite (o que sair fica no registo)
  function naFila (fila, novos) {
    const f = porNaFila(fila, novos, agora(), { max: maxFila })
    for (const x of f.perdidas) app.error(`fila do Telegram cheia: já não vou entregar "${x.texto}"`)
    return f.fila
  }

  // A fila dos alarmes (auditoria K-09): a mensagem mais urgente (lib/fila.js, proximo: os alarmes à
  // frente, cada caminho pela sua ordem — o "Resolvido" nunca chega antes do seu alarme) vai a todos os
  // chats autorizados ao mesmo tempo e sai da fila quando pelo menos um a aceitou; se nenhum aceitou,
  // espera o recuo (2 s … 1 min, ou o retry_after do Telegram) e tenta outra vez. Uma que o Telegram
  // recusa em todos os chats sem remédio (recusaDoTelegram) sai ao fim de MAX_RECUSAS tentativas, com
  // registo e um aviso ao Ivo (se algum chat a recusou por ser essa mensagem: com todos os chats
  // recusados, o aviso não tinha a quem chegar); antes, uma assim prendia a fila para sempre (auditoria
  // F4b, revisão da F4, Importante 1). Nunca vai aos contactos do plano.
  let falhasFila = 0 // tentativas falhadas seguidas da fila
  let recusadasFila = 0 // mensagens que o Telegram recusou sempre e saíram da fila (desde o arranque)
  let proximaTentativa = 0 // agora() a partir do qual se tenta outra vez
  let envioFila = null // o envio da fila em curso (um de cada vez)
  let ultimoErroFila = null // o registo não repete o mesmo erro a cada recuo
  async function enviarFila () {
    if (envioFila || !tg || !enc.porEnviar.length || agora() < proximaTentativa) return
    const chats = chatsAutorizados()
    if (!chats.length) return
    const este = {}
    envioFila = este
    const cliente = tg
    try {
      while (cliente === tg && enc.porEnviar.length) {
        const item = enc.porEnviar[proximo(enc.porEnviar)]
        const texto = textoAEnviar(item, agora())
        const erros = await Promise.all(chats.map(id => cliente.sendMessage(id, texto).then(() => null, e => e)))
        const falhados = erros.filter(Boolean)
        if (cliente !== tg) {
          // stop() (e start()) a meio: a fila fica gravada e o arranque trata dela; se esta chegou, sai
          // já da fila (o arranque pode tê-la lido do disco: tira-se pelo texto e pela hora)
          if (falhados.length < chats.length) tirarDaFila(item)
          return
        }
        if (falhados.length) {
          const msg = registoTelegram(falhados[0])
          if (msg !== ultimoErroFila) { ultimoErroFila = msg; app.error(msg) }
        } else ultimoErroFila = null
        if (falhados.length === chats.length) {
          const recusas = falhados.map(recusaDoTelegram)
          if (recusas.every(Boolean)) {
            const n = (item.recusas || 0) + 1
            if (n >= MAX_RECUSAS) {
              desistir(item, falhados, recusas.includes('mensagem'))
              if (enc.porEnviar.length && pausaFilaMs > 0) await new Promise(resolve => setTimeout(resolve, pausaFilaMs))
              continue
            }
            trocarNaFila(item, { ...item, recusas: n })
          }
          falhasFila++
          proximaTentativa = agora() + recuoMs(falhasFila, Math.max(0, ...falhados.map(e => e?.esperarS ?? 0)))
          return
        }
        falhasFila = 0
        proximaTentativa = 0
        tirarDaFila(item)
        if (enc.porEnviar.length && pausaFilaMs > 0) await new Promise(resolve => setTimeout(resolve, pausaFilaMs))
      }
    } finally {
      if (envioFila === este) envioFila = null
    }
  }
  // a mensagem que o Telegram recusou MAX_RECUSAS vezes sai da fila: o registo diz qual e porquê; o Ivo
  // recebe um aviso curto (comAviso: algum chat a recusou por ser essa mensagem; nunca de um aviso destes)
  function desistir (item, falhados, comAviso) {
    tirarDaFila(item)
    falhasFila = 0
    proximaTentativa = 0
    recusadasFila++
    app.error(`fila do Telegram: desisti de "${excerto(item.texto, 80)}" ao fim de ${MAX_RECUSAS} recusas (${falhados[0]?.message ?? falhados[0]})`)
    const porMensagem = falhados.find(e => recusaDoTelegram(e) === 'mensagem')
    if (comAviso && !item.sistema) {
      enc = { ...enc, porEnviar: naFila(enc.porEnviar, [avisoDeRecusa(item, erroEmPortugues(porMensagem))]) }
      gravarEncaminhador()
    }
  }
  // tira da fila a mensagem entregue (a primeira igual: o mesmo objeto, ou o mesmo texto e hora) e grava
  function tirarDaFila (item) {
    const i = enc.porEnviar.findIndex(x => x === item || (x.texto === item.texto && x.desde === item.desde))
    if (i < 0) return
    enc = { ...enc, porEnviar: [...enc.porEnviar.slice(0, i), ...enc.porEnviar.slice(i + 1)] }
    gravarEncaminhador()
  }
  function trocarNaFila (item, novo) {
    const i = enc.porEnviar.indexOf(item)
    if (i < 0) return
    enc = { ...enc, porEnviar: enc.porEnviar.map((x, k) => (k === i ? novo : x)) }
    gravarEncaminhador()
  }

  plugin.start = function (props) {
    o = { telegramToken: '', chatIds: [], contactosPlano: [], telegramBase: 'https://api.telegram.org', pollTimeout: 25, batimentoUrl: '', comandoFoto: '', lugares: EXTRAS, ...props }
    codigoEnviado = new Map()
    const rota = lerDestinosDaRota()
    if (rota.erro) app.error(`${rota.erro}: o ponto de amarração só se grava sozinho junto aos lugares da configuração`)
    lugares = [...rota.lugares, ...lugaresDaConfiguracao(o.lugares)]
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiro = path.join(dir, 'porto.json')
    const lido = lerPorto()
    persist = lido.persist
    if (lido.erro) app.error(`porto.json ilegível (começa desarmado e sem ponto de amarração): ${lido.erro}`)
    estado = novoEstado()
    estado.amarracao.ponto = persist.ponto
    estado.ativos = ativosNoArranque()
    persist.ativos = { ...estado.ativos }
    publicar(comoNotificacao(estado.ativos))
    ficheiroEnc = path.join(dir, 'encaminhador.json')
    enc = lerEncaminhador()
    falhasFila = 0
    recusadasFila = 0
    proximaTentativa = 0
    envioFila = null
    ultimoErroFila = null
    offset = 0
    aCorrer = true
    tg = o.telegramToken ? criarTelegram({ token: o.telegramToken, base: o.telegramBase, ...(deps.limiteTelegramMs ? { limiteMs: deps.limiteTelegramMs } : {}) }) : null
    // o Ivo sabe que o alarme ficou desarmado (pela fila: depois de um corte de energia o router do 4G
    // arranca depois do Pi)
    if (lido.erro && tg && chatsAutorizados().length) {
      enc = { ...enc, porEnviar: naFila(enc.porEnviar, [AVISO_PORTO_ILEGIVEL]) }
      gravarEncaminhador()
    }
    temporizadores = [setInterval(tick, tickMs), setInterval(encaminharAlarmes, encaminharMs)]
    if (o.batimentoUrl) {
      const bater = () => fetch(o.batimentoUrl).catch(e => app.error(`batimento: ${e.message}`))
      bater()
      temporizadores.push(setInterval(bater, 5 * 60 * 1000))
    }
    app.removeListener?.('arlequin:plano', aoPlano)
    app.on?.('arlequin:plano', aoPlano)
    const g = ++geracao
    if (tg) ouvirTelegram(g)
  }

  plugin.stop = function () {
    app.removeListener?.('arlequin:plano', aoPlano)
    aCorrer = false
    geracao++
    escuta?.abort()
    escuta = null
    temporizadores.forEach(clearInterval)
    temporizadores = []
    tg = null
    // os alarmes ativos passam a normal na árvore e ficam no porto.json para o arranque seguinte (I-21)
    try { publicar(comoNotificacao(estado.ativos, true)) } catch (e) { app.error(`não pus a normal os alarmes do porto: ${e.message}`) }
  }

  return plugin
}
