// Ecrã da roda do Arlequin: arranque, barra de cima, botões, som e render 1 Hz.

import { criarStore, ligar, valor, idade, pedir } from './signalk.js'
import { barraHtml } from './lib/barra.js'
import { alvosAis } from './lib/ais.js'
import { lerPolar } from './lib/polar.js'
import { registarPressao, tendencia, lerBarometro } from './lib/barometro.js'
import { novaViagem, acumular, lerViagem } from './lib/viagem.js'
import { passoCiclo, desenharSeguro, escolherPagina, CAIXA_ERRO_DESENHO } from './lib/ciclo.js'
import { alarmeDaBarra, decidirSom, novaMemoriaSom, paginaDoAlarme, bipDeLigacao, chipAlarme, calar, calado } from './lib/alarmes.js'
import { podeRedesenhar, aoEnter, aoEscrever, guardarRolagem, reporRolagem, PAUSA_ROLAR_MS } from './lib/interacao.js'
import { NIVEIS, PADRAO as BRILHO_PADRAO, nivelValido, mudarNivel } from './lib/brilho.js'
import { criarAudio, retomar, comSom, chipSemSom } from './lib/som.js'
import { falhaJanela, falhaCalar } from './lib/erros.js'
import carta from './paginas/carta.js'
import instr from './paginas/instr.js'
import ais from './paginas/ais.js'
import motor from './paginas/motor.js'
import viagem from './paginas/viagem.js'
import diario, { gravarNoDiario } from './paginas/diario.js'
import melhor from './paginas/melhor.js'
import velas from './paginas/velas.js'
import { motorLigado } from './paginas/comum.js'

const PAGINAS = { carta, instr, ais, motor, viagem, diario, melhor, velas }
const FALHA_CALAR_MS = 15000 // a falha do silenciar/reconhecer fica 15 s na barra

const store = criarStore()
const parametros = new URLSearchParams(location.search)
const guardado = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def } catch { return def } }
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem armazenamento */ } }

const app = {
  // ?pagina=ais e ?noite=1 abrem direto numa página (atalhos e capturas).
  // (a pedida ou a guardada só valem se existirem: uma estragada impedia o ciclo de arrancar, auditoria I-06)
  pagina: escolherPagina(parametros.get('pagina'), guardado('arlequin.pagina', null), PAGINAS),
  noite: parametros.has('noite') ? parametros.get('noite') === '1' : guardado('arlequin.noite', false),
  // o brilho de noite, 1–5 (2 por omissão; ?brilho=1 abre direto num nível, para as capturas)
  brilho: nivelValido(parametros.has('brilho') ? parametros.get('brilho') : guardado('arlequin.brilho', BRILHO_PADRAO)),
  polar: null,
  // o guardado no browser valida-se ao ler (auditoria I-06): estragado, começa vazio
  baro: lerBarometro(guardado('arlequin.baro', null)),
  viagem: lerViagem(guardado('arlequin.viagem', null), Date.now()),
  estados: {}, // estado de cada página (seleções, passos…)
  // o som nasce já no arranque (auditoria K-03): no Pi o kiosk arranca com o autoplay; sem ele, o browser
  // deixa-o suspenso até ao 1.º toque e o ciclo tenta retomá-lo de segundo a segundo
  audio: criarAudio(),
  somMemoria: novaMemoriaSom(), // o que já deu o bip curto e a hora dos lembretes do fumo reconhecido (lib/alarmes.js)
  estavaLigado: null,
  sons: [], // últimos sons tocados (diagnóstico: window.arlequin.app.sons)
  premidoEm: null, // quando um dedo tocou no ecrã (do pointerdown ao pointerup; null: nenhum)
  roladoEm: null, // o último scroll de uma lista (revisão F3, Important 5); rolarDesde: o 1.º desta série
  rolarDesde: null,
  repostos: new WeakMap(), // lista → scrollTop que o render lhe repôs (esse scroll não é um dedo)
  falhaJanela: null, // a falha do último pedido das janelas/modo noite do OpenCPN (auditoria K-11), na barra
  falhaCalar: null, // { texto, ate }: a falha do último silenciar/reconhecer (auditoria I-08), na barra uns segundos
  erros: [] // registo dos últimos erros (diagnóstico: window.arlequin.app.erros); no ecrã só a frase em pt-PT
}

// ---------- contexto passado às páginas ----------
// O pedido comum (signalk.js: o erro já vem em pt-PT); o erro verdadeiro fica no registo (um 404 de uma
// leitura é normal, ex.: sem plano ativo, e não entra).
function pedirRegistado (url, o = {}) {
  return pedir(url, o).catch((err) => {
    if (!(err?.status === 404 && (o.method || 'GET') === 'GET')) registarErro(url, err)
    throw err
  })
}

function contexto () {
  if (!app.estados[app.pagina]) app.estados[app.pagina] = {}
  return {
    v: (p) => valor(store, p),
    idade: (p) => idade(store, p),
    store,
    polar: app.polar,
    baro: tendencia(app.baro, Date.now()),
    viagem: app.viagem,
    // os alvos AIS por ordem de perigo (lib/ais.js; "perigo" enquanto o alarme do plugin AIS estiver ativo)
    alvos: alvosAis({
      vessels: store.vessels.values(),
      eu: { position: valor(store, 'navigation.position'), cog: valor(store, 'navigation.courseOverGroundTrue'), sog: valor(store, 'navigation.speedOverGround') },
      notificacoes: [...store.notificacoes.values()],
      agora: Date.now()
    }),
    notificacoes: [...store.notificacoes.values()],
    estado: app.estados[app.pagina],
    demo: parametros.has('demo'),
    noite: app.noite,
    // armazenamento do ecrã (as marcas das precauções da melhor rota, por cálculo)
    guardado,
    guardar,
    pedir: pedirRegistado,
    // o diário pelo plugin do ecrã (contrato C3)
    logbook: (text, category = 'navigation') => gravarNoDiario(pedirRegistado, text, category),
    // "Nova viagem" (página Viagem): o resumo recomeça
    novaViagem: () => novaViagemAgora(),
    refrescar: () => render()
  }
}

// ---------- barra de cima (lib/barra.js) ----------
function barra (ctx) {
  return barraHtml({
    agora: Date.now(),
    gps: ctx.idade('navigation.position') < 10000,
    pressao: ctx.v('environment.outside.pressure'),
    tendencia: ctx.baro,
    somHtml: chipSemSom(app.audio),
    // o que está a apitar agora, com o botão dele (revisão F3, Important 4: antes, o mais grave, mesmo já calado)
    alarmeHtml: chipAlarme(alarmeDaBarra(ctx.notificacoes)),
    calarFalha: app.falhaCalar && app.falhaCalar.ate > Date.now() ? app.falhaCalar.texto : null,
    piloto: ctx.v('steering.autopilot.state'),
    ligado: store.ligado,
    falhas: [app.falhaJanela]
  })
}

// A notificação de um botão de calar (pelo id do servidor ou pelo caminho); já sem ela no store, a do botão.
function notificacaoDe (dados) {
  for (const n of store.notificacoes.values()) if ((dados.id && n.id === dados.id) || (!dados.id && dados.caminho && n.caminho === dados.caminho)) return n
  return { id: dados.id, caminho: dados.caminho }
}

// ---------- som ----------
function bip (duracao = 0.25, freq = 880, motivo = '') {
  const tocou = comSom(app.audio)
  app.sons = [...app.sons.slice(-9), { t: new Date().toISOString(), motivo, tocou }]
  // suspenso, os osciladores ficavam em fila e tocavam todos juntos ao retomar
  if (!tocou) return
  const o = app.audio.createOscillator()
  const g = app.audio.createGain()
  o.frequency.value = freq
  g.gain.value = 0.4
  o.connect(g).connect(app.audio.destination)
  o.start()
  o.stop(app.audio.currentTime + duracao)
}

// O som lê as notificações direto do store (nunca depende do contexto nem do desenho, auditoria I-06). O que tocar
// decide-o lib/alarmes.js (decidirSom, com a hora do ecrã): o contínuo a cada ciclo, o bip curto uma vez por alarme
// e, com o fumo reconhecido (Adenda 2 do dono), um bip curto de 2 em 2 minutos — um só, ainda que sejam vários.
function tocar (notificacoes) {
  const r = decidirSom(notificacoes, app.somMemoria, Date.now())
  for (const caminho of r.curtos) bip(0.35, 660, caminho)
  if (r.lembretes.length) bip(0.35, 660, `${r.lembretes.join(', ')} (lembrete)`)
  if (r.continuo) bip(0.4, 1000, 'alarme')
}

// ---------- render ----------
// Cada parte no seu try (auditoria I-06): uma página que rebenta mostra a caixa do erro e o resto continua.
const BARRA_ERRO = '<span class="nome">ARLEQUIN</span><span class="chip alarme">erro ao desenhar a barra</span>'
function contextoSeguro () {
  try { return contexto() } catch (e) { registarErro('contexto', e); return null }
}
function render (forcar = false) {
  const ctx = contextoSeguro()
  document.getElementById('barra').innerHTML = ctx ? desenharSeguro(() => barra(ctx), BARRA_ERRO, (e) => registarErro('barra', e)) : BARRA_ERRO
  const el = document.getElementById('pagina')
  const aEscrever = el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'
  const agora = Date.now()
  if (podeRedesenhar({ forcar, aEscrever, premidoHaMs: app.premidoEm == null ? null : agora - app.premidoEm, roladoHaMs: app.roladoEm == null ? null : agora - app.roladoEm, aRolarHaMs: app.rolarDesde == null ? null : agora - app.rolarDesde })) {
    // as listas que rolam ficam onde estavam (revisão F3, Important 5): o scrollTop de cada data-rolar passa
    // para a lista nova com a mesma chave
    const rolagem = guardarRolagem(el)
    el.innerHTML = ctx ? desenharSeguro(() => PAGINAS[app.pagina].render(ctx), CAIXA_ERRO_DESENHO, (e) => registarErro(`página ${app.pagina}`, e)) : CAIXA_ERRO_DESENHO
    try { for (const [lista, v] of reporRolagem(el, rolagem)) app.repostos.set(lista, v) } catch (e) { registarErro('rolagem', e) }
  }
  try {
    document.querySelectorAll('#botoes [data-pag]').forEach(b => {
      b.classList.toggle('on', b.dataset.pag === app.pagina)
      if (b.dataset.pag === 'ais' && ctx) {
        const n = ctx.alvos.filter(a => a.classe === 'perigo').length
        b.textContent = `AIS (${ctx.alvos.length})${n ? ' ⚠' : ''}`
      }
    })
    document.getElementById('b-noite').classList.toggle('on', app.noite)
    document.getElementById('b-noite').textContent = app.noite ? `Noite ${app.brilho}/${NIVEIS.length}` : 'Noite'
    document.getElementById('b-brilho-menos').disabled = app.brilho <= 1
    document.getElementById('b-brilho-mais').disabled = app.brilho >= NIVEIS.length
  } catch (e) { registarErro('botões', e) }
}

// o modo noite e o brilho no body (o estilo.css faz o resto)
function aplicarNoite () {
  document.body.classList.toggle('noite', app.noite)
  document.body.dataset.brilho = String(app.brilho)
}

// o registo dos erros (o erro verdadeiro; o ecrã só mostra a frase em pt-PT)
function registarErro (onde, err) {
  app.erros = [...app.erros.slice(-19), { t: new Date().toISOString(), onde, erro: String(err?.message ?? err), detalhe: err?.detalhe ?? null }]
}

// As janelas e o modo noite do OpenCPN (plugin do ecrã): a falha fica na barra até um pedido correr bem.
function janela (corpo) {
  pedir('/plugins/arlequin-ecra/janela', { method: 'POST', body: corpo })
    .then(() => { app.falhaJanela = null })
    .catch((err) => { app.falhaJanela = falhaJanela(err, corpo); registarErro('janela', err) })
}

function irPara (pag) {
  app.pagina = escolherPagina(pag, null, PAGINAS)
  guardar('arlequin.pagina', app.pagina)
  janela({ layout: app.pagina === 'carta' ? 'carta' : 'inteiro' })
  document.activeElement?.blur?.()
  // um aoEntrar que rebenta não impede a página nem o ciclo (auditoria I-06)
  try { PAGINAS[app.pagina].aoEntrar?.(contexto()) } catch (e) { registarErro(`entrar em ${app.pagina}`, e) }
  render(true)
}

// ---------- eventos ----------
document.addEventListener('pointerdown', () => {
  app.premidoEm = Date.now()
  if (!app.audio) app.audio = criarAudio()
  retomar(app.audio)
}, { capture: true })
for (const fim of ['pointerup', 'pointercancel']) document.addEventListener(fim, () => { app.premidoEm = null }, { capture: true })
// Um scroll de qualquer lista (o scroll não sobe na árvore: só se apanha em captura) pausa o desenho como um dedo
// (revisão F3, Important 5); o que o próprio render causa ao repor o scrollTop não conta.
document.addEventListener('scroll', (ev) => {
  const reposto = app.repostos.get(ev.target)
  if (reposto !== undefined && Math.abs((ev.target.scrollTop ?? 0) - reposto) < 1) return
  const t = Date.now()
  if (app.roladoEm == null || t - app.roladoEm >= PAUSA_ROLAR_MS) app.rolarDesde = t
  app.roladoEm = t
}, { capture: true, passive: true })

document.addEventListener('click', async (ev) => {
  const pag = ev.target.closest('[data-pag]')
  if (pag) return irPara(pag.dataset.pag)
  const a = ev.target.closest('[data-acao]')
  if (!a) return
  const acao = a.dataset.acao
  if (acao === 'noite') {
    app.noite = !app.noite
    guardar('arlequin.noite', app.noite)
    aplicarNoite()
    janela({ noite: app.noite })
    return render(true)
  }
  // o brilho de noite (decisão do Ivo de 01/10): − e +, 5 níveis, guardado no ecrã
  if (acao === 'brilho-menos' || acao === 'brilho-mais') {
    app.brilho = mudarNivel(app.brilho, acao === 'brilho-mais' ? 1 : -1)
    guardar('arlequin.brilho', app.brilho)
    aplicarNoite()
    return render(true)
  }
  if (acao === 'ligar-som') {
    retomar(app.audio)
    return render(true)
  }
  // calar o alarme (lib/alarmes.js, acaoCalar e calar): silenciar onde o servidor deixa; a emergência reconhece-se
  // (auditoria I-08); pelo id do servidor ou, sem ele, pelo caminho (revisão F3, Important 4); a recusa fica à
  // vista na barra, em pt-PT
  if (acao === 'silenciar' || acao === 'reconhecer') {
    ev.stopPropagation()
    try {
      const n = notificacaoDe(a.dataset)
      await calar(n, acao, pedir)
      // calado já no ecrã (o stream confirma até 1 s depois; a barra passa logo ao seguinte que apita)
      if (n.caminho && store.notificacoes.get(n.caminho) === n) store.notificacoes.set(n.caminho, calado(n, acao))
      app.falhaCalar = null
    } catch (err) {
      app.falhaCalar = { texto: falhaCalar(err, acao), ate: Date.now() + FALHA_CALAR_MS }
      registarErro(acao, err)
    }
    return render(true)
  }
  if (acao === 'ir-alarme') return irPara(paginaDoAlarme(a.dataset.caminho))
  // a ação da página e o desenho forçado: um scroll recente não atrasa a resposta ao toque (revisão F3, Important 5)
  try { await PAGINAS[app.pagina].acao?.(acao, a.dataset, contexto()) } catch (e) { registarErro(`ação ${acao}`, e) }
  render(true)
})

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return
  try { aoEnter(PAGINAS[app.pagina], contexto(), ev.target, render).catch((e) => registarErro('enter', e)) } catch (e) { registarErro('enter', e) }
})

// o que se escreve nos campos com data-campo fica no estado da página (um render não o apaga)
document.addEventListener('input', (ev) => {
  if (ev.target.tagName !== 'INPUT') return
  try { aoEscrever(PAGINAS[app.pagina], contexto(), ev.target) } catch (e) { registarErro('campo', e) }
})

// ---------- ciclo ----------
let segundos = 0
// os dados de cada segundo: o barómetro (de minuto a minuto) e o resumo da viagem
function registarDados () {
  const v = (p) => valor(store, p)
  const p = v('environment.outside.pressure')
  if (segundos % 60 === 0 && p) {
    app.baro = registarPressao(app.baro, p, Date.now())
    guardar('arlequin.baro', app.baro)
  }
  app.viagem = acumular(app.viagem, {
    t: Date.now(),
    sog: v('navigation.speedOverGround'),
    // true | false | null: sem leitura não conta nem para a vela nem para o motor (auditoria I-23)
    motor: motorLigado(v('propulsion.main.revolutions')),
    fuelRate: v('propulsion.main.fuel.rate'),
    ventoReal: v('environment.wind.speedTrue'),
    pressao: p
  })
  if (segundos % 30 === 0) guardar('arlequin.viagem', app.viagem)
}
// o apito primeiro, depois o desenho e os dados, cada um no seu try (auditoria I-06)
function ciclo () {
  retomar(app.audio)
  passoCiclo({
    tocar: () => tocar([...store.notificacoes.values()]),
    desenhar: () => render(),
    dados: () => registarDados()
  }, (parte, e) => registarErro(parte, e))
  segundos++
}

export function novaViagemAgora () {
  app.viagem = novaViagem(Date.now())
  guardar('arlequin.viagem', app.viagem)
}
window.arlequin = { novaViagemAgora, app, store }

aplicarNoite()
fetch('polar-arlequin.csv').then(r => r.text()).then(t => { app.polar = lerPolar(t) }).catch(() => {})
// Ligação caiu: dois bips curtos, uma só vez. A barra fica com "SEM LIGAÇÃO".
function aoMudarLigacao () {
  if (bipDeLigacao(app.estavaLigado, store.ligado)) {
    bip(0.18, 520, 'ligação perdida')
    setTimeout(() => bip(0.18, 520, 'ligação perdida'), 300)
  }
  app.estavaLigado = store.ligado
  render()
}

ligar(store, { aoMudar: aoMudarLigacao })
// o ciclo arranca antes da 1.ª página: nada no desenho o impede de começar (auditoria I-06)
setInterval(ciclo, 1000)
irPara(app.pagina)
