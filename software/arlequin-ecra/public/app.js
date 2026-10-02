// Ecrã da roda do Arlequin: arranque, barra de cima, botões, som e render 1 Hz.

import { criarStore, ligar, valor, idade, pedir } from './signalk.js'
import { barraHtml } from './lib/barra.js'
import { cpa, classificar } from './lib/cpa.js'
import { lerPolar } from './lib/polar.js'
import { registarPressao, tendencia, lerBarometro } from './lib/barometro.js'
import { novaViagem, acumular, lerViagem } from './lib/viagem.js'
import { passoCiclo, desenharSeguro, escolherPagina, CAIXA_ERRO_DESENHO } from './lib/ciclo.js'
import { maisGrave, deveTocar, paginaDoAlarme, bipDeLigacao, chipAlarme } from './lib/alarmes.js'
import { podeRedesenhar, aoEnter, aoEscrever } from './lib/interacao.js'
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

const PAGINAS = { carta, instr, ais, motor, viagem, diario, melhor, velas }
const ORDEM_CLASSE = { perigo: 0, atencao: 1, seguro: 2, afasta: 3, desconhecido: 4 }
const AIS_VELHO = 10 * 60 * 1000
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
  bipados: new Set(),
  estavaLigado: null,
  sons: [], // últimos sons tocados (diagnóstico: window.arlequin.app.sons)
  premidoEm: null, // quando um dedo tocou no ecrã (do pointerdown ao pointerup; null: nenhum)
  falhaJanela: null, // a falha do último pedido das janelas/modo noite do OpenCPN (auditoria K-11), na barra
  falhaCalar: null, // { texto, ate }: a falha do último silenciar/reconhecer (auditoria I-08), na barra uns segundos
  erros: [] // registo dos últimos erros (diagnóstico: window.arlequin.app.erros); no ecrã só a frase em pt-PT
}

// ---------- contexto passado às páginas ----------
function alvosAis () {
  const eu = {
    position: valor(store, 'navigation.position'),
    cog: valor(store, 'navigation.courseOverGroundTrue'),
    sog: valor(store, 'navigation.speedOverGround')
  }
  const lista = []
  for (const a of store.vessels.values()) {
    if (!a.position || Date.now() - a.em > AIS_VELHO) continue
    const r = cpa(eu, a)
    lista.push({ ...a, r, classe: classificar(r) })
  }
  return lista.sort((x, y) => (ORDEM_CLASSE[x.classe] - ORDEM_CLASSE[y.classe]) || ((x.r?.distancia ?? 1e9) - (y.r?.distancia ?? 1e9)))
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
    alvos: alvosAis(),
    notificacoes: [...store.notificacoes.values()],
    estado: app.estados[app.pagina],
    demo: parametros.has('demo'),
    noite: app.noite,
    // armazenamento do ecrã (as marcas das precauções da melhor rota, por cálculo)
    guardado,
    guardar,
    // o pedido comum (signalk.js: o erro já vem em pt-PT); o erro verdadeiro fica no registo (um 404 de uma
    // leitura é normal, ex.: sem plano ativo, e não entra)
    pedir: (url, o = {}) => pedir(url, o).catch((err) => {
      if (!(err?.status === 404 && (o.method || 'GET') === 'GET')) registarErro(url, err)
      throw err
    }),
    // o diário pelo plugin do ecrã (contrato C3)
    logbook: (text, category = 'navigation') => gravarNoDiario(pedir, text, category),
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
    alarmeHtml: chipAlarme(maisGrave(ctx.notificacoes)),
    piloto: ctx.v('steering.autopilot.state'),
    ligado: store.ligado,
    falhas: [app.falhaJanela, app.falhaCalar && app.falhaCalar.ate > Date.now() ? app.falhaCalar.texto : null]
  })
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

// O som lê as notificações direto do store (nunca depende do contexto nem do desenho, auditoria I-06).
function tocar (notificacoes) {
  let continuo = false
  for (const n of notificacoes) {
    const t = deveTocar(n)
    if (t === 'continuo') continuo = true
    const chave = `${n.caminho}@${n.timestamp}`
    if (t === 'curto' && !app.bipados.has(chave)) { app.bipados.add(chave); bip(0.35, 660, n.caminho) }
  }
  if (continuo) bip(0.4, 1000, 'alarme')
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
  if (podeRedesenhar({ forcar, aEscrever, premidoHaMs: app.premidoEm == null ? null : Date.now() - app.premidoEm })) {
    el.innerHTML = ctx ? desenharSeguro(() => PAGINAS[app.pagina].render(ctx), CAIXA_ERRO_DESENHO, (e) => registarErro(`página ${app.pagina}`, e)) : CAIXA_ERRO_DESENHO
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
    return render()
  }
  // o brilho de noite (decisão do Ivo de 01/10): − e +, 5 níveis, guardado no ecrã
  if (acao === 'brilho-menos' || acao === 'brilho-mais') {
    app.brilho = mudarNivel(app.brilho, acao === 'brilho-mais' ? 1 : -1)
    guardar('arlequin.brilho', app.brilho)
    aplicarNoite()
    return render()
  }
  if (acao === 'ligar-som') {
    retomar(app.audio)
    return render()
  }
  // calar o alarme (lib/alarmes.js, acaoCalar): silenciar onde o servidor deixa; a emergência reconhece-se
  // (auditoria I-08); a falha fica à vista na barra
  if (acao === 'silenciar' || acao === 'reconhecer') {
    ev.stopPropagation()
    try {
      await pedir(`/signalk/v2/api/notifications/${encodeURIComponent(a.dataset.id)}${acao === 'reconhecer' ? '/acknowledge' : '/silence'}`, { method: 'POST' })
      app.falhaCalar = null
    } catch (err) {
      app.falhaCalar = { texto: falhaCalar(err, acao), ate: Date.now() + FALHA_CALAR_MS }
      registarErro(acao, err)
    }
    return render()
  }
  if (acao === 'ir-alarme') return irPara(paginaDoAlarme(a.dataset.caminho))
  try { await PAGINAS[app.pagina].acao?.(acao, a.dataset, contexto()) } catch (e) { registarErro(`ação ${acao}`, e) }
  render()
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
    motor: (v('propulsion.main.revolutions') || 0) > 5,
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
