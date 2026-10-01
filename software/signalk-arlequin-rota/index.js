'use strict'
// Plugin SignalK: melhor rota do Arlequin (desenho 3a). Calcula em segundo plano as
// alternativas até um destino (lib/calculo.js), serve o resultado por REST e ativa a
// rota escolhida no SignalK (API de recursos v2 + API de rumo v2), para o OpenCPN a mostrar.
//
// REST (/plugins/signalk-arlequin-rota), com a segurança do SignalK ligada: os GET pedem uma sessão
// (readonly) e os POST um utilizador "read/write" (router.access; sem ele, só admin):
//   POST /calcular { destino, tripulacao: 'so' | 'acompanhado', sairAgora } → 202 { id }
//        (409 se já houver um a calcular; 503 com o plugin parado)
//   GET  /resultado/:id → { estado: 'a calcular' | 'pronto' | 'erro', progresso, texto, resultado?, erro? }
//   GET  /destinos, POST /destinos { nome, lat, lon | posicaoAtual: true, conhecido, abrigo? (false) }
//   POST /ativar { id, alternativa } (alternativa: índice 0–2 ou o id) → grava e ativa a rota
//        → { ok, rota, href, via, alternativa, nota, planoAtivo: { estado } } (nota: a do canal, se a
//        rota passar por um). Cria ou substitui o plano ativo (desenho 3b-2, lib/plano-ativo.js),
//        gravado em plano-ativo.json na pasta do plugin, com o envio do plano se já foi enviado.
//   POST /plano-telegram { id, alternativa } → 202 { pedido, avisos: [texto] } (404 cálculo ou
//        alternativa desconhecidos; 409 se o cálculo não estiver pronto; 422 sem a chegada mais
//        tarde (não há hora de alarme) ou com um cálculo antigo (a hora de alarme já passou, ou a
//        partida foi há mais de 1 h); 503 sem eventos no servidor ou sem o plugin porto a ouvir)
//   GET  /plano-telegram/:pedido → { estado: 'a enviar' | 'enviado' | 'falhou', entregues: [nome],
//        contactos: [nome], falhas: [{ nome, erro }], avisos: [texto], motivo? }
//        contactos: os contactos em terra que o receberam (o chat do Ivo não conta; sem eles, ninguém
//        em terra tem a hora de alarme e o ecrã não marca a precaução)
//   avisos: o que o Ivo deve saber mas não impede o envio (sem o telefone dele na configuração, o
//   plano diz só "liga ao Ivo").
//   GET  /plano-ativo → 404 sem plano; { estado, destino: { id, nome }, tripulacao, idCalculo, indice,
//        alternativa: { id, nome }, partida, saida, chegou, atrasoMin, proximo: { texto, hora } | null,
//        chegadaAgora, chegadaPlano, chegadaNoite, recursos: { gasoleoChegadaL, bateriaChegadaPct,
//        semLeitura, aviso }, semGps, barometro: { semLeitura, quedaHpa }, previsaoIdadeH,
//        avisos: [{ caminho, state, message }], envio: { contactos, alarme, alarmePlano } | null,
//        filaContactos: [{ tipo, criada, tentativas, proxima, estado, erro }], enviadas: [{ tipo, enviadaEm, contactos }] }
//   POST /plano-ativo/terminar → { ok, estado: 'terminado', contactos } (409 sem plano aberto): fecha o
//        plano, os avisos voltam a normal e os contactos recebem "viagem terminada" (contactos: true)
//   POST /plano-ativo/continuar → { ok, estado } (409 se não estiver "pausado"; 502 se a API de rumo
//        falhar): volta a ativar a rota do plano, no ponto seguinte ao da posição na rota
//
// Os contactos em terra a navegar (lib/contactos.js): só com o plano enviado a contactos em terra.
// "Cheguei bem" na chegada, o atraso quando a chegada prevista passa da "mais tarde" do plano (no
// máximo 1× por hora), "viagem terminada" no Terminar, e o plano novo ao Ativar outra alternativa com
// um plano enviado aberto (o 422 de um cálculo antigo não ativa nada e o plano antigo fica). Pelo
// mesmo evento 'arlequin:plano' { pedido, tipo, texto, gpx? (só no tipo 'plano'), nomeFicheiro?,
// destinatarios: 'contactos-do-plano', contactos }, uma mensagem de cada vez; a fila fica no plano
// ativo (sem resposta em 30 s ou sem o porto, nova tentativa daqui a 2 min).
//
// O plano (desenho 3b-1): monta o texto e o GPX (lib/plano.js) e emite no servidor o evento
// 'arlequin:plano' { pedido, texto, gpx, nomeFicheiro }; o plugin porto (que tem o bot do Telegram)
// envia-o e responde com 'arlequin:plano-enviado' { pedido, entregues, contactos, falhas }. Sem resposta em
// 30 s, "falhou": o plugin porto não respondeu. Um plano enviado com pelo menos um contacto em terra
// fica no plano ativo (envio: a quem e a hora de alarme), antes ou depois de Ativar a mesma alternativa. Um stop() (o SignalK reinicia o plugin sempre que se
// grava a configuração) com planos "a enviar" deixa-os "falhou": a resposta do porto já não chegaria.
// A lista dos planos guarda os 20 mais recentes, mas nunca tira um que ainda está "a enviar".
//
// A navegar (desenho 3b-2): um ciclo de minuto a minuto (setInterval) lê do SignalK a posição (com a
// hora: mais de 2 min sem posição nova é "sem GPS"), o SOG, o vento real, a pressão, o gasóleo, o SoC
// e a rota ativa (API de rumo v2); segue o plano ativo (lib/plano-ativo.js: saída, chegada, rota
// mudada), o acompanhamento (lib/acompanhamento.js) com a previsão mais recente arquivada que cubra
// a posição (previsoes/ da pasta dos dados), e publica os avisos (lib/avisos-navegar.js) em
// notifications.rota.* por delta, só nas mudanças. As amostras da pressão (de minuto a minuto, 3 h)
// ficam em barometro.json; a posição na rota fica no plano ativo (seguimento), para um reinício não
// a perder.
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
const decisao = require('./lib/decisao')
const plano = require('./lib/plano')
const pa = require('./lib/plano-ativo')
const ac = require('./lib/acompanhamento')
const av = require('./lib/avisos-navegar')
const ct = require('./lib/contactos')
const { criarCorrecaoVento } = require('./lib/cenarios')
const { slug } = require('./lib/slug')
const modelosJs = require('signalk-arlequin-ia/lib/modelos')

const MAX_TRABALHOS = 20
const MAX_PLANOS = 20
const LIMITE_PORTO_MS = 30000 // sem resposta do plugin porto em 30 s: "falhou"
const MOTIVO_PORTO = 'o plugin porto não respondeu (está ligado? tem o token?)'
const PORTO_DESLIGADO = 'o plugin porto está desligado: liga-o em Plugin Config'
const SEM_DESTINATARIOS = 'não há destinatários: junta os chats em "Chats autorizados" ou em "Contactos do plano" no plugin porto'
const MOTIVO_REINICIO = 'o plugin da rota foi reiniciado durante o envio: confirma com os contactos se receberam'
const AVISO_SEM_TELEFONE = 'o teu telefone não está na configuração: o plano diz só "liga ao Ivo"'
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const MIN = 60000
const CICLO_MS = 60000 // a navegar: de minuto a minuto
const GPS_VELHO_MS = 2 * MIN // sem posição nova há mais de 2 min: sem GPS
const NOS = 3600 / 1852 // m/s → nós
const SEGUIMENTO_MN = 0.1 // a posição na rota grava-se no plano ativo quando anda isto

function escreverAtomico (f, texto) {
  const tmp = f + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, texto)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, f)
}

// A aproximação de um destino avulso (um ponto): 2 pontos iguais e entrada 1, como o costa.js exige
// (o lib/rotas.js junta os pontos repetidos). Os destinos com uma aproximação válida ficam como estão.
const aproximacaoAvulsa = (lat, lon) => ({ aproximacao: [[lat, lon], [lat, lon]], entrada: 1 })
function corrigirAproximacao (d) {
  const ap = d.aproximacao
  const valida = Array.isArray(ap) && ap.length >= 2 && Number.isInteger(d.entrada) && d.entrada >= 1 && d.entrada <= ap.length - 1
  return valida ? d : { ...d, ...aproximacaoAvulsa(d.largo[0], d.largo[1]) }
}

// Os valores por defeito de um objeto do schema ({ chave: default }).
const padroes = (esquema) => Object.fromEntries(Object.entries(esquema.properties).map(([k, x]) => [k, x.default]))

// o id de um destino do Ivo: "meu-<slug>"
const slugDestino = (nome) => slug(nome, 30) || 'destino'

module.exports = function (app, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a))
  const relogio = deps.relogio || (() => Date.now())
  const esperar = deps.esperar || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
  // o relógio do limite do porto (injetável nos testes)
  const agendar = deps.agendar || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t })
  const cancelar = deps.cancelar || ((t) => clearTimeout(t))
  // o ciclo a navegar (injetável nos testes, que o chamam à mão com plugin.cicloNavegar)
  const agendarCiclo = deps.agendarCiclo || ((fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t })
  const pararCiclo = deps.pararCiclo || ((t) => clearInterval(t))
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
      porta: { type: 'number', title: 'Porta do SignalK (só se a API interna faltar)', default: 3000 },
      // o plano de navegação pelo Telegram (desenho 3b-1): os campos vazios ficam de fora do texto
      barco: {
        type: 'object',
        title: 'O barco (para o plano de navegação)',
        properties: {
          nome: { type: 'string', title: 'Nome', default: 'ARLEQUIN' },
          modelo: { type: 'string', title: 'Modelo', default: 'Jeanneau Melody 34' },
          corCasco: { type: 'string', title: 'Cor do casco', default: '' },
          mmsi: { type: 'string', title: 'MMSI', default: '' },
          indicativo: { type: 'string', title: 'Indicativo de chamada', default: '' }
        }
      },
      telefones: {
        type: 'object',
        title: 'Telefones do plano (hora de alarme)',
        properties: {
          ivo: { type: 'string', title: 'Telefone do Ivo', default: '' },
          emergencia: { type: 'string', title: 'Emergência', default: plano.EMERGENCIA_PADRAO }
        }
      }
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
  const planos = new Map() // pedido → { id, indice, estado, entregues, contactos, falhas, avisos, motivo?, criado, enviadoEm?, temporizador }
  let planoAtivo = null // o plano ativo (lib/plano-ativo.js), também em plano-ativo.json
  // a navegar: os estados do ciclo (em memória; num reinício os temporizadores recomeçam)
  let memPlano = pa.novaMemoria()
  let estAcomp = ac.novoEstado()
  let estAvisos = av.novoEstado()
  let publicados = {} // caminho → { state, chave } do que está publicado em notifications.rota.*
  let pressoes = [] // [{ t, hPa }] de minuto a minuto (barometro.json)
  let ventos = [] // [{ t, medido, previsto }] (10 min)
  let ultimaPosicao = null
  let ultimo = null // o último resultado do acompanhamento
  let cicloTimer = null
  let aCorrerCiclo = false
  let modelosVento = {}
  const pedidosContactos = new Map() // pedido → temporizador dos 30 s (as mensagens para terra)

  function gravarPlanoAtivo () {
    try { pa.gravar(dirPlugin, planoAtivo) } catch (e) { app.error(`não gravei o plano ativo: ${e.message}`) }
  }
  // O envio de uma alternativa (o mais recente com contactos em terra): { contactos, alarme, pedido, enviadoEm } ou null.
  function envioDe (id, indice, alt) {
    const enviados = [...planos].filter(([, x]) => x.id === id && x.indice === indice && x.estado === 'enviado' && x.contactos.length)
    const ultimo = enviados.at(-1)
    if (!ultimo) return null
    const alarme = plano.horaAlarme(alt)
    return { contactos: [...ultimo[1].contactos], alarme: alarme == null ? null : new Date(alarme).toISOString(), pedido: ultimo[0], enviadoEm: ultimo[1].enviadoEm }
  }

  // A resposta do plugin porto a um plano: "enviado" com pelo menos uma entrega; sem nenhuma,
  // "falhou" com as falhas (ou sem destinatários). Uma resposta depois do limite já não conta.
  function aoPlanoEnviado (m) {
    if (eObjeto(m) && pedidosContactos.has(m.pedido)) return respostaContactos(m)
    const p = eObjeto(m) ? planos.get(m.pedido) : null
    if (!p || p.estado !== 'a enviar') return
    cancelar(p.temporizador)
    p.entregues = Array.isArray(m.entregues) ? m.entregues.map(String) : []
    // um porto antigo não manda os contactos: nenhum em terra (o ecrã avisa)
    p.contactos = Array.isArray(m.contactos) ? m.contactos.map(String) : []
    p.falhas = Array.isArray(m.falhas) ? m.falhas.filter(eObjeto).map(f => ({ nome: String(f.nome ?? ''), erro: String(f.erro ?? '') })) : []
    p.estado = p.entregues.length ? 'enviado' : 'falhou'
    p.enviadoEm = new Date(relogio()).toISOString()
    if (!p.entregues.length) p.motivo = p.falhas.length ? p.falhas.map(f => `${f.nome}: ${f.erro}`).join('; ') : SEM_DESTINATARIOS
    // enviado depois de Ativar a mesma alternativa: fica no plano ativo
    if (pa.aberto(planoAtivo) && p.contactos.length && p.id === planoAtivo.idCalculo && p.indice === planoAtivo.indice) {
      const alt = trabalhos.get(p.id)?.resultado?.alternativas?.[p.indice]
      const envio = alt && envioDe(p.id, p.indice, alt)
      if (envio) { planoAtivo = { ...planoAtivo, envio }; gravarPlanoAtivo() }
    }
  }
  // Os mais antigos saem primeiro, mas nunca um "a enviar" (o ecrã ainda o está a seguir).
  function guardarPlano (pedido, p) {
    planos.set(pedido, p)
    while (planos.size > MAX_PLANOS) {
      const velho = [...planos].find(([, x]) => x.estado !== 'a enviar')
      if (!velho) break
      planos.delete(velho[0])
    }
  }

  const v = (p) => app.getSelfPath?.(p)?.value
  const ficheiroMeus = () => path.join(dirPlugin, 'destinos.json')

  // Os destinos do Ivo. Os gravados antes da revisão final (aproximação de 1 ponto, entrada 0) não
  // passavam no costa.verificarAproximacao ("entrada mal definida"): corrigem-se ao ler, com a
  // aproximação do destino avulso (2 pontos iguais no largo, entrada 1).
  function meusDestinos () {
    try {
      const l = JSON.parse(fs.readFileSync(ficheiroMeus(), 'utf8'))
      return Array.isArray(l) ? l.filter(d => eObjeto(d) && typeof d.id === 'string' && Array.isArray(d.largo)).map(corrigirAproximacao) : []
    } catch { return [] }
  }
  // A costa com os destinos da lista mais os do Ivo (estes marcados `meu`).
  function costaAtual () {
    return { ...costaBase, destinos: [...costaBase.destinos, ...meusDestinos().map(d => ({ ...d, meu: true }))] }
  }

  // oo: as opções com que se lê (um cálculo a correr fica com as do início, mesmo que o plugin pare)
  function instrumentos (oo = o) {
    const pos = v('navigation.position')
    const soc = v(`electrical.batteries.${oo.bateria}.capacity.stateOfCharge`)
    const vol = v(`tanks.fuel.${oo.deposito}.currentVolume`)
    const nivel = v(`tanks.fuel.${oo.deposito}.currentLevel`)
    const cap = v(`tanks.fuel.${oo.deposito}.capacity`)
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
  // Com as opções e a pasta do início do cálculo (oo, pasta): stop() a meio não as apaga.
  const obterPrevisaoCom = (oo, pastaDados) => async function obterPrevisao ({ pontos, desde, ate, agora }) {
    const pasta = path.join(pastaDados, 'previsoes')
    let erroRede = null
    if (oo.previsoes) {
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

  // ---------- os contactos em terra ----------
  // Uma mensagem para a fila do plano ativo, aos contactos entregues do plano (sem eles, nada).
  function porMensagem (tipo, texto, agora, extra = {}) {
    const contactos = planoAtivo?.envio?.contactos
    if (!contactos?.length) return false
    planoAtivo = { ...planoAtivo, contactos: ct.porNaFila(planoAtivo.contactos || ct.novaFila(), { tipo, texto, contactos, ...extra }, agora) }
    return true
  }
  function falharContactos (pedido, motivo) {
    if (!planoAtivo?.contactos) return
    planoAtivo = { ...planoAtivo, contactos: ct.falhou(planoAtivo.contactos, pedido, motivo, relogio()) }
    gravarPlanoAtivo()
  }
  // A próxima mensagem da fila, se for a hora dela (uma de cada vez).
  function enviarFila (agora) {
    if (!planoAtivo?.contactos) return
    const m = ct.proxima(planoAtivo.contactos, agora)
    if (!m) return
    const pedido = crypto.randomUUID()
    planoAtivo = { ...planoAtivo, contactos: ct.marcarAEnviar(planoAtivo.contactos, m.id, pedido, agora) }
    gravarPlanoAtivo()
    if (typeof app.emit !== 'function' || app.listenerCount?.('arlequin:plano') === 0) return falharContactos(pedido, PORTO_DESLIGADO)
    const t = agendar(() => {
      pedidosContactos.delete(pedido)
      if (planoAtivo?.contactos?.fila?.some(x => x.pedido === pedido)) falharContactos(pedido, MOTIVO_PORTO)
    }, LIMITE_PORTO_MS)
    pedidosContactos.set(pedido, t)
    try { app.emit('arlequin:plano', ct.evento(m, pedido)) } catch (e) {
      cancelar(t)
      pedidosContactos.delete(pedido)
      falharContactos(pedido, `não foi possível enviar: ${e.message}`)
    }
  }
  function respostaContactos (m) {
    cancelar(pedidosContactos.get(m.pedido))
    pedidosContactos.delete(m.pedido)
    if (!planoAtivo?.contactos) return
    const agora = relogio()
    const msg = planoAtivo.contactos.fila.find(x => x.pedido === m.pedido)
    planoAtivo = { ...planoAtivo, contactos: ct.resposta(planoAtivo.contactos, m.pedido, m, agora) }
    // o plano novo entregue: o envio passa a ser este (a quem chegou)
    const enviada = planoAtivo.contactos.enviadas.at(-1)
    if (msg?.tipo === 'plano' && enviada?.id === msg.id && planoAtivo.envio) planoAtivo = { ...planoAtivo, envio: { ...planoAtivo.envio, contactos: [...enviada.contactos], pedido: m.pedido, enviadoEm: enviada.enviadaEm } }
    gravarPlanoAtivo()
    enviarFila(agora)
  }
  // O atraso para terra (só a navegar, com GPS e o plano enviado).
  function atrasoParaTerra (res, agora) {
    const envio = planoAtivo.envio
    if (!envio?.contactos?.length || res.semGps) return
    const d = ct.decidirAtraso(planoAtivo.atrasoEnviado || null, {
      chegadaAgora: Date.parse(res.chegadaAgora), p90: Date.parse(planoAtivo.alternativa.chegada?.p90), alarmePlano: Date.parse(envio.alarme), agora
    })
    if (!d) return
    porMensagem('atraso', ct.textoAtraso({ ...d, agora }), agora)
    planoAtivo = { ...planoAtivo, atrasoEnviado: { ultimoEm: agora, chegada: d.chegada, alarme: d.alarme } }
    gravarPlanoAtivo()
  }

  // ---------- a navegar ----------
  const ficheiroPressoes = () => path.join(dirPlugin, 'barometro.json')
  function lerPressoes () {
    try { const l = JSON.parse(fs.readFileSync(ficheiroPressoes(), 'utf8')); return Array.isArray(l) ? l.filter(x => Number.isFinite(x?.t) && Number.isFinite(x?.hPa)) : [] } catch { return [] }
  }
  function publicarAvisos (avisos) {
    const r = av.publicar(publicados, avisos)
    publicados = r.publicados
    if (r.deltas.length) app.handleMessage(plugin.id, { updates: [{ values: r.deltas }] })
  }
  // A rota ativa: o href, null sem nenhuma, undefined se não se sabe (a API de rumo falhou).
  async function hrefAtivo () {
    if (typeof app.getCourse === 'function') {
      try { return (await app.getCourse())?.activeRoute?.href ?? null } catch { return undefined }
    }
    const ar = v('navigation.course.activeRoute')
    return ar === undefined ? undefined : ar?.href ?? null
  }
  function leituraPosicao (agora) {
    const x = app.getSelfPath?.('navigation.position')
    const p = x?.value
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
    const hora = Date.parse(x.timestamp)
    if (Number.isFinite(hora) && agora - hora > GPS_VELHO_MS) return null
    return { lat: p.latitude, lon: p.longitude }
  }
  // A previsão mais recente arquivada que cubra a posição agora: { previsao, obtida, idadeH } ou null.
  function previsaoAgora (pos, agora) {
    if (!pos) return null
    const a = prev.lerArquivo(path.join(pastaBase, 'previsoes'), { pontos: [pos], desde: agora, ate: agora, agora, maxIdadeH: Infinity })
    return a.erro ? null : a
  }

  async function passoNavegar () {
    const agora = relogio()
    const hPa = v('environment.outside.pressure')
    const comPressao = Number.isFinite(hPa)
    if (comPressao) {
      pressoes = av.juntarPressao(pressoes, { t: agora, hPa: hPa / 100 }, agora)
      try { prev.escreverAtomico(ficheiroPressoes(), JSON.stringify(pressoes)) } catch (e) { app.error(`não gravei o barómetro: ${e.message}`) }
    }
    if (!pa.aberto(planoAtivo)) { ultimo = null; publicarAvisos({}); if (planoAtivo) enviarFila(agora); return }
    const sog = v('navigation.speedOverGround')
    const leitura = { posicao: leituraPosicao(agora), sogNos: Number.isFinite(sog) ? sog * NOS : null, href: await hrefAtivo() }
    if (leitura.posicao) ultimaPosicao = leitura.posicao
    const r = pa.avaliar(planoAtivo, leitura, memPlano, agora)
    planoAtivo = r.plano
    memPlano = r.mem
    // a chegada: "cheguei bem" aos contactos (uma vez: o plano fica fechado)
    if (r.mudou === 'chegou') porMensagem('chegada', ct.textoChegada({ destino: planoAtivo.destino?.nome, chegou: Date.parse(planoAtivo.chegou), agora }), agora)
    if (r.mudou) gravarPlanoAtivo()
    if (!pa.aberto(planoAtivo) || planoAtivo.estado === 'pausado') {
      ultimo = null
      estAvisos = av.novoEstado()
      publicarAvisos({})
      enviarFila(agora)
      return
    }
    const ins = instrumentos()
    const pv = previsaoAgora(leitura.posicao || ultimaPosicao || planoAtivo.partida, agora)
    const tempo = pv ? prev.criarTempo(pv.previsao) : null
    const a = ac.acompanhar(estAcomp, {
      plano: planoAtivo, posicao: leitura.posicao, agora, gasoleoL: ins.gasoleoL, socPct: ins.socPct, energia: o.energia, rpm: o.rpmCruzeiro,
      radiacao: tempo ? (lat, lon, t) => tempo(lat, lon, t).radiacao : null
    })
    estAcomp = a.estado
    // o vento medido contra o previsto P50 (a correção da AI, se houver modelo) naquele sítio e hora
    const medido = v('environment.wind.speedTrue')
    let previsto = null
    if (tempo && leitura.posicao) {
      const k = criarCorrecaoVento({ tempoBruto: tempo, modelos: modelosVento, obtida: Date.parse(pv.obtida) })(leitura.posicao.lat, leitura.posicao.lon, agora)
      previsto = Number.isFinite(k.w.tws) ? k.w.tws * k.razao.p50 : null
    }
    ventos = Number.isFinite(medido) && leitura.posicao ? ac.juntarAmostra(ventos, { t: agora, medido: medido * NOS, previsto }, agora) : ventos.filter(x => x.t >= agora - 10 * MIN)
    const vento = ac.desvioVento(ventos)
    const res = a.resultado
    const navegar = planoAtivo.estado === 'a navegar'
    const x = av.avaliar(estAvisos, {
      navegar, tripulacao: planoAtivo.tripulacao, saida: Date.parse(planoAtivo.saida), destino: planoAtivo.destino?.nome, semGps: !leitura.posicao,
      atrasoMin: res.atrasoMin, vento, previsaoIdadeH: pv ? pv.idadeH : null, barometro: pressoes, recursos: res.recursos, eventos: res.eventos, chegadaNoite: res.chegadaNoite
    }, agora)
    estAvisos = x.estado
    publicarAvisos(x.avisos)
    ultimo = { ...res, agora, vento, previsaoIdadeH: pv ? pv.idadeH : null, barometroSemLeitura: !comPressao, quedaBarometro: av.quedaEm3h(pressoes, agora), avisos: x.avisos }
    // a posição na rota: no plano ativo, para um reinício continuar dali
    const ant = estAcomp.anterior
    if (navegar && ant && (!planoAtivo.seguimento || Math.abs(planoAtivo.seguimento.s - ant.s) >= SEGUIMENTO_MN)) {
      planoAtivo = { ...planoAtivo, seguimento: { s: ant.s, t: new Date(ant.t).toISOString() } }
      gravarPlanoAtivo()
    }
    if (navegar) atrasoParaTerra(res, agora)
    enviarFila(agora)
  }

  // O que o GET /plano-ativo devolve (o ecrã lê-o de 10 em 10 s).
  function estadoPlanoAtivo () {
    const p = planoAtivo
    const u = ultimo
    const rec = u?.recursos || {}
    const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null)
    const ativos = Object.entries(u?.avisos || {}).filter(([, a]) => a.state !== 'normal').map(([caminho, a]) => ({ caminho, state: a.state, message: a.message }))
    const recursosAviso = ativos.find(a => a.caminho === `${av.PREFIXO}.recursos`)
    const c = p.contactos || ct.novaFila()
    return {
      estado: p.estado,
      // o cais (para o Recalcular de um destino avulso, sem id)
      destino: { id: p.destino?.id ?? null, nome: p.destino?.nome ?? null, lat: p.destino?.cais?.lat ?? null, lon: p.destino?.cais?.lon ?? null },
      tripulacao: p.tripulacao,
      idCalculo: p.idCalculo,
      indice: p.indice,
      alternativa: { id: p.alternativa.id, nome: p.alternativa.nome },
      partida: p.alternativa.partida ?? null,
      saida: p.saida,
      chegou: p.chegou,
      atrasoMin: u && u.estado === 'a navegar' ? r0(u.atrasoMin) : null,
      proximo: u?.proximo ? { texto: u.proximo.texto, hora: u.proximo.hora } : null,
      chegadaAgora: u?.chegadaAgora ?? p.alternativa.chegada?.p50 ?? null,
      chegadaPlano: p.alternativa.chegada?.p50 ?? null,
      chegadaNoite: u?.chegadaNoite ?? null,
      recursos: {
        gasoleoChegadaL: r0(rec.gasoleoChegadaL),
        bateriaChegadaPct: r0(rec.bateriaChegadaPct),
        semLeitura: !!u && rec.gasoleoChegadaL == null && rec.bateriaChegadaPct == null,
        aviso: recursosAviso ? recursosAviso.message : null
      },
      semGps: !!u?.semGps,
      barometro: { semLeitura: u ? !!u.barometroSemLeitura : true, quedaHpa: Number.isFinite(u?.quedaBarometro) ? Math.round(u.quedaBarometro * 10) / 10 : null },
      previsaoIdadeH: Number.isFinite(u?.previsaoIdadeH) ? Math.round(u.previsaoIdadeH * 10) / 10 : null,
      avisos: ativos,
      envio: p.envio ? { contactos: p.envio.contactos, alarme: p.atrasoEnviado ? new Date(p.atrasoEnviado.alarme).toISOString() : p.envio.alarme, alarmePlano: p.envio.alarme } : null,
      filaContactos: c.fila.map(m => ({ tipo: m.tipo, criada: m.criada, tentativas: m.tentativas, proxima: m.proxima, estado: m.estado, erro: m.erro })),
      enviadas: c.enviadas.map(m => ({ tipo: m.tipo, enviadaEm: m.enviadaEm, contactos: m.contactos }))
    }
  }

  // Ativar um href na API de rumo (Continuar): a API do servidor, ou HTTP para o próprio servidor.
  async function ativarHref (href, pointIndex) {
    if (typeof app.activateRoute === 'function') return app.activateRoute({ href, pointIndex })
    const r = await fetchFn(`http://localhost:${o.porta || 3000}/signalk/v2/api/vessels/self/navigation/course/activeRoute`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ href, pointIndex }), signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw new Error(`a API de rumo respondeu ${r.status}`)
  }
  // O ponto da rota a seguir à posição na rota (seguimento); sem ela, o 1.
  function pontoSeguinte (p) {
    const s = estAcomp.anterior?.s ?? p.seguimento?.s
    if (!Number.isFinite(s)) return 1
    const { linha } = ac.prepararRota(p)
    const i = linha.s.findIndex(x => x > s + 1e-9)
    return i < 1 ? Math.max(1, linha.s.length - 1) : i
  }
  async function cicloNavegar () {
    if (!o || !dirPlugin || aCorrerCiclo) return
    aCorrerCiclo = true
    try { await passoNavegar() } catch (e) { app.error(`a navegar: ${e.message}`) } finally { aCorrerCiclo = false }
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
    // as opções do início: um stop() a meio (o = null) não estraga o cálculo, que acaba sozinho
    const oo = o
    const pastaDados = pastaBase
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
      { instrumentos: instrumentos(oo), destino, tripulacao: pedido.tripulacao, sairAgora: pedido.sairAgora, agora: relogio() },
      {
        costa, polar, modelos, versoes, obterPrevisao: obterPrevisaoCom(oo, pastaDados),
        opcoes: {
          afastamentoMinimo: oo.afastamentoMinimo, rpmCruzeiro: oo.rpmCruzeiro, energia: oo.energia,
          socDesconhecido: oo.socDesconhecido, gasoleoDesconhecidoL: oo.gasoleoDesconhecidoL
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
    const quando = (iso) => decisao.quando(Date.parse(iso), relogio(), 'Europe/Lisbon')
    const pts = alt.pontosRota
    const id = crypto.randomUUID()
    const href = `/resources/routes/${id}`
    const onde = alt.direto || !Number.isFinite(alt.afastamento) ? 'direta (salto curto)' : `${alt.afastamento} MN${alt.canal ? ` pelo ${alt.canal}` : ''}`
    const dados = {
      name: `Arlequin → ${destinoNome} (${alt.nome})`,
      // as horas em hora de Lisboa (HH:MM), não o UTC em bruto: o OpenCPN mostra o texto tal e qual
      // a propulsão como no ecrã e no plano: "a motor (sem vento para vela)" quando vai toda a motor
      description: `Melhor rota: ${onde}, ${plano.propulsaoTexto(alt)}, partida ${quando(alt.partida)}, chegada prevista ${quando(alt.chegada.p50)} (hora de Lisboa)${alt.nota ? `. ${alt.nota}` : ''}`,
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
    o.barco = { ...padroes(plugin.schema.properties.barco), ...(eObjeto(props?.barco) ? props.barco : {}) }
    o.telefones = { ...padroes(plugin.schema.properties.telefones), ...(eObjeto(props?.telefones) ? props.telefones : {}) }
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
    const lido = pa.ler(dirPlugin)
    planoAtivo = lido.plano
    if (lido.erro) app.error(lido.erro)
    // a mensagem para terra que estava a enviar já não tem resposta: volta à fila
    if (planoAtivo?.contactos) planoAtivo = { ...planoAtivo, contactos: ct.aoArrancar(planoAtivo.contactos, relogio()) }
    // a navegar: os temporizadores recomeçam; a posição na rota e o barómetro vêm dos ficheiros, e o
    // que já está publicado lê-se do SignalK (não se publica outra vez)
    memPlano = pa.novaMemoria()
    const seg = planoAtivo?.seguimento
    estAcomp = { ...ac.novoEstado(), anterior: seg && Number.isFinite(seg.s) ? { s: seg.s, t: Date.parse(seg.t) } : null }
    estAvisos = av.novoEstado()
    ventos = []
    ultimo = null
    pressoes = lerPressoes()
    try { publicados = av.publicadosDaArvore(app.getSelfPath?.(av.PREFIXO)) } catch { publicados = {} }
    try { modelosVento = modelosAi().modelos } catch { modelosVento = {} }
    if (cicloTimer) pararCiclo(cicloTimer)
    cicloTimer = agendarCiclo(() => { cicloNavegar() }, CICLO_MS)
    app.removeListener?.('arlequin:plano-enviado', aoPlanoEnviado)
    app.on?.('arlequin:plano-enviado', aoPlanoEnviado)
    app.setPluginStatus(`Pronto · ${costaBase.destinos.length + meusDestinos().length} destinos`)
  }

  plugin.stop = function () {
    // Um cálculo a correr acaba sozinho (é finito), com as opções do início (executar); o resultado
    // fica no mapa.
    o = null
    if (cicloTimer) pararCiclo(cicloTimer)
    cicloTimer = null
    app.removeListener?.('arlequin:plano-enviado', aoPlanoEnviado)
    for (const t of pedidosContactos.values()) cancelar(t)
    pedidosContactos.clear()
    for (const p of planos.values()) {
      cancelar(p.temporizador)
      if (p.estado === 'a enviar') { p.estado = 'falhou'; p.motivo = MOTIVO_REINICIO }
    }
  }

  plugin.registerWithRouter = function (router) {
    const parado = (res) => res.status(503).json({ ok: false, erro: erroArranque || 'o plugin da rota não está ligado' })
    const ligado = () => o && costaBase && polar
    // Com a segurança ligada, o SignalK 2.33 só deixa um utilizador admin chamar as rotas registadas
    // com router.get/post simples (tokensecurity.js, pluginAuthenticationMiddleware). Com o
    // router.access(nível) (interfaces/plugins.js, asPluginRouter), as leituras pedem uma sessão
    // (readonly) e as escritas um utilizador "read/write". Sem o router.access (versões antigas): as simples.
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escrever = comNivel ? router.access('readwrite') : router

    escrever.post('/calcular', (req, res) => {
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

    ler.get('/resultado/:id', (req, res) => {
      if (!ligado()) return parado(res)
      const t = trabalhos.get(req.params.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      const out = { estado: t.estado, progresso: t.progresso, texto: t.texto }
      if (t.resultado) out.resultado = t.resultado
      if (t.erro) out.erro = t.erro
      res.json(out)
    })

    ler.get('/destinos', (req, res) => {
      if (!ligado()) return parado(res)
      res.json({ destinos: costaAtual().destinos })
    })

    escrever.post('/destinos', (req, res) => {
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
      // abrigo: só se o Ivo o marcar (por omissão false — um "meu" não gasta os candidatos de abrigo da desistência)
      if (typeof b.conhecido !== 'boolean' || (b.abrigo != null && typeof b.abrigo !== 'boolean')) return res.status(400).json({ ok: false, erro: 'conhecido e abrigo têm de ser true ou false' })
      if (costaBase.emTerra(p)) return res.status(400).json({ ok: false, erro: 'essa posição fica em terra' })
      const meus = meusDestinos()
      const todos = costaAtual().destinos
      let id = `meu-${slugDestino(nome)}`
      for (let n = 2; todos.some(d => d.id === id); n++) id = `meu-${slugDestino(nome)}-${n}`
      const lat = Math.round(p.lat * 1e5) / 1e5; const lon = Math.round(p.lon * 1e5) / 1e5
      const d = { id, nome, abrigo: b.abrigo === true, conhecido: b.conhecido, largo: [lat, lon], ...aproximacaoAvulsa(lat, lon), notas: 'acrescentado no ecrã', confirmado: false, criado: new Date(relogio()).toISOString() }
      try { escreverAtomico(ficheiroMeus(), JSON.stringify([...meus, d], null, 1)) } catch (e) { return res.status(500).json({ ok: false, erro: `não gravei o destino: ${e.message}` }) }
      res.status(201).json({ ok: true, destino: { ...d, meu: true } })
    })

    escrever.post('/ativar', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const t = trabalhos.get(b.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      if (t.estado !== 'pronto') return res.status(409).json({ ok: false, erro: `o cálculo está "${t.estado}"` })
      const lista = t.resultado.alternativas
      const indice = Number.isInteger(b.alternativa) ? b.alternativa : lista.findIndex(a => a.id === b.alternativa)
      const alt = lista[indice]
      if (!alt) return res.status(404).json({ ok: false, erro: 'alternativa desconhecida' })
      const id = b.id
      // Recalcular → Ativar (desenho 3b-2): com um plano aberto já enviado a contactos em terra, o plano
      // novo segue para os mesmos contactos ("Este plano substitui o anterior"). Monta-se antes de
      // ativar: um cálculo antigo (422) não ativa nada e o plano antigo fica.
      const antigo = pa.aberto(planoAtivo) ? planoAtivo : null
      const mesmo = !!antigo && antigo.idCalculo === id && antigo.indice === indice
      // (a alternativa nova já enviada pelo Ivo depois de ativar o plano antigo não se reenvia)
      const envioNovo = envioDe(id, indice, alt)
      const novoJaEnviado = !!envioNovo && !!antigo && Date.parse(envioNovo.enviadoEm) >= Date.parse(antigo.ativadoEm)
      const reenviar = !!antigo && !mesmo && !novoJaEnviado && !!antigo.envio?.contactos?.length
      let novoTexto = null
      if (reenviar) {
        try {
          novoTexto = plano.montarPlano({ resultado: t.resultado, indice, barco: o.barco, telefones: o.telefones, agora: relogio() })
        } catch (e) {
          if (e.status === 422) return res.status(422).json({ ok: false, erro: e.message })
          return res.status(500).json({ ok: false, erro: `não montei o plano: ${e.message}` })
        }
      }
      ativarRota(alt, t.resultado.destino.nome)
        .then(r => {
          const agora = relogio()
          // o plano ativo (desenho 3b-2): cria ou substitui
          const aproximacao = costaAtual().destinos.find(d => d.id && d.id === t.resultado.destino.id)?.aproximacao || null
          const anterior = planoAtivo
          let envio = envioNovo
          if (mesmo) envio = antigo.envio
          if (reenviar) {
            const alarme = plano.horaAlarme(alt)
            envio = { contactos: [...antigo.envio.contactos], alarme: alarme == null ? null : new Date(alarme).toISOString(), pedido: null, enviadoEm: null, substitui: true }
          }
          planoAtivo = mesmo
            ? { ...antigo, href: r.href, estado: antigo.estado === 'pausado' ? antigo.pausadoDe || pa.ESTADOS.ESPERA : antigo.estado, pausadoDe: null }
            : pa.criarPlano({ idCalculo: id, resultado: t.resultado, indice, href: r.href, aproximacao, envio, agora })
          // a fila dos contactos continua (sem os atrasos do plano antigo, que deixam de interessar)
          if (!mesmo && anterior?.contactos) planoAtivo.contactos = { ...anterior.contactos, fila: anterior.contactos.fila.filter(m => m.tipo !== 'atraso' || m.estado === 'a enviar') }
          if (reenviar) porMensagem('plano', ct.textoSubstitui(novoTexto.texto), agora, { gpx: novoTexto.gpx, nomeFicheiro: novoTexto.nomeFicheiro })
          if (!mesmo) { memPlano = pa.novaMemoria(); estAcomp = ac.novoEstado(); estAvisos = av.novoEstado(); ventos = []; ultimo = null }
          gravarPlanoAtivo()
          enviarFila(agora)
          res.json({ ok: true, ...r, alternativa: alt.id, nota: alt.nota || null, planoAtivo: { estado: planoAtivo.estado } })
        })
        .catch(e => res.status(502).json({ ok: false, erro: `não ativei a rota: ${e.message}` }))
        .catch(e => app.error(`ativar: ${e.message}`))
    })

    escrever.post('/plano-telegram', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const t = trabalhos.get(b.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      if (t.estado !== 'pronto') return res.status(409).json({ ok: false, erro: `o cálculo está "${t.estado}"` })
      const lista = t.resultado.alternativas
      const indice = Number.isInteger(b.alternativa) ? b.alternativa : lista.findIndex(a => a.id === b.alternativa)
      if (!lista[indice]) return res.status(404).json({ ok: false, erro: 'alternativa desconhecida' })
      if (typeof app.emit !== 'function') return res.status(503).json({ ok: false, erro: 'o servidor não tem eventos: não dá para enviar o plano ao plugin porto' })
      // ninguém a ouvir (o plugin porto desligado, o padrão no dev): diz logo, sem esperar os 30 s
      if (app.listenerCount?.('arlequin:plano') === 0) return res.status(503).json({ ok: false, erro: PORTO_DESLIGADO })
      let p
      try {
        p = plano.montarPlano({ resultado: t.resultado, indice, barco: o.barco, telefones: o.telefones, agora: relogio() })
      } catch (e) {
        // 422: falta o que o plano precisa (a hora de alarme), com o motivo; 500: um erro de programação
        if (e.status === 422) return res.status(422).json({ ok: false, erro: e.message })
        return res.status(500).json({ ok: false, erro: `não montei o plano: ${e.message}` })
      }
      const pedido = crypto.randomUUID()
      const avisos = typeof o.telefones.ivo === 'string' && o.telefones.ivo.trim() ? [] : [AVISO_SEM_TELEFONE]
      const estado = { id: b.id, indice, estado: 'a enviar', entregues: [], contactos: [], falhas: [], avisos, criado: new Date(relogio()).toISOString() }
      estado.temporizador = agendar(() => {
        if (estado.estado === 'a enviar') { estado.estado = 'falhou'; estado.motivo = MOTIVO_PORTO }
      }, LIMITE_PORTO_MS)
      guardarPlano(pedido, estado)
      try {
        app.emit('arlequin:plano', { pedido, texto: p.texto, gpx: p.gpx, nomeFicheiro: p.nomeFicheiro })
      } catch (e) {
        // um ouvinte que lança não derruba o pedido: fica "falhou" com o motivo
        cancelar(estado.temporizador)
        estado.estado = 'falhou'
        estado.motivo = `não foi possível enviar: ${e.message}`
      }
      res.status(202).json({ pedido, avisos })
    })

    ler.get('/plano-ativo', (req, res) => {
      if (!ligado()) return parado(res)
      if (!planoAtivo) return res.status(404).json({ ok: false, erro: 'não há plano ativo' })
      res.json(estadoPlanoAtivo())
    })

    escrever.post('/plano-ativo/terminar', (req, res) => {
      if (!ligado()) return parado(res)
      if (!pa.aberto(planoAtivo)) return res.status(409).json({ ok: false, erro: 'não há um plano ativo aberto' })
      const agora = relogio()
      const posicao = leituraPosicao(agora) || ultimaPosicao
      planoAtivo = pa.terminar(planoAtivo, agora)
      const contactos = porMensagem('terminado', ct.textoTerminado({ posicao, agora }), agora)
      estAvisos = av.novoEstado()
      ultimo = null
      publicarAvisos({})
      gravarPlanoAtivo()
      enviarFila(agora)
      res.json({ ok: true, estado: planoAtivo.estado, contactos })
    })

    escrever.post('/plano-ativo/continuar', (req, res) => {
      if (!ligado()) return parado(res)
      if (planoAtivo?.estado !== 'pausado') return res.status(409).json({ ok: false, erro: 'o plano não está pausado' })
      const p = planoAtivo
      ativarHref(p.href, pontoSeguinte(p))
        .then(() => {
          if (planoAtivo !== p) return res.status(409).json({ ok: false, erro: 'o plano mudou entretanto' })
          planoAtivo = pa.continuar(p)
          memPlano = pa.novaMemoria()
          gravarPlanoAtivo()
          res.json({ ok: true, estado: planoAtivo.estado })
        })
        .catch(e => res.status(502).json({ ok: false, erro: `não ativei a rota: ${e.message}` }))
        .catch(e => app.error(`continuar: ${e.message}`))
    })

    ler.get('/plano-telegram/:pedido', (req, res) => {
      if (!ligado()) return parado(res)
      const p = planos.get(req.params.pedido)
      if (!p) return res.status(404).json({ ok: false, erro: 'pedido desconhecido' })
      const out = { estado: p.estado, entregues: p.entregues, contactos: p.contactos, falhas: p.falhas, avisos: p.avisos, criado: p.criado }
      if (p.motivo) out.motivo = p.motivo
      res.json(out)
    })
  }

  // o plano ativo em memória, o último acompanhamento e o ciclo (diagnóstico e testes)
  plugin.planoAtivo = () => planoAtivo
  plugin.acompanhamento = () => ultimo
  plugin.cicloNavegar = cicloNavegar

  return plugin
}
