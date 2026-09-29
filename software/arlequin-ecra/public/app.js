// Ecrã da roda do Arlequin: arranque, barra de cima, botões, som e render 1 Hz.

import { criarStore, ligar, valor, idade, pedir } from './signalk.js'
import { hora, num, hpa } from './lib/formato.js'
import { cpa, classificar } from './lib/cpa.js'
import { lerPolar } from './lib/polar.js'
import { criarBarometro, registarPressao, tendencia } from './lib/barometro.js'
import { novaViagem, acumular } from './lib/viagem.js'
import { maisGrave, deveTocar, paginaDoAlarme } from './lib/alarmes.js'
import carta from './paginas/carta.js'
import instr from './paginas/instr.js'
import ais from './paginas/ais.js'
import motor from './paginas/motor.js'
import viagem from './paginas/viagem.js'
import diario from './paginas/diario.js'
import melhor from './paginas/melhor.js'
import velas from './paginas/velas.js'

const PAGINAS = { carta, instr, ais, motor, viagem, diario, melhor, velas }
const ORDEM_CLASSE = { perigo: 0, atencao: 1, seguro: 2, afasta: 3, desconhecido: 4 }
const AIS_VELHO = 10 * 60 * 1000

const store = criarStore()
const parametros = new URLSearchParams(location.search)
const guardado = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def } catch { return def } }
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem armazenamento */ } }

const app = {
  pagina: guardado('arlequin.pagina', 'carta'),
  noite: guardado('arlequin.noite', false),
  polar: null,
  baro: guardado('arlequin.baro', criarBarometro()),
  viagem: guardado('arlequin.viagem', null) || novaViagem(Date.now()),
  estados: {}, // estado de cada página (seleções, passos…)
  audio: null,
  bipados: new Set()
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
    pedir,
    logbook: (text, category = 'navigation') => pedir('/plugins/signalk-logbook/logs', { method: 'POST', body: { text, category } }),
    refrescar: () => render()
  }
}

// ---------- barra de cima ----------
function barraHtml (ctx) {
  const gps = ctx.idade('navigation.position') < 10000
  const p = ctx.v('environment.outside.pressure')
  const t = ctx.baro
  const seta = !t ? '' : t.sentido === 'sobe' ? ' ▲' : t.sentido === 'desce' ? ' ▼' : ' ▬'
  const piloto = ctx.v('steering.autopilot.state') || 'manual'
  const al = maisGrave(ctx.notificacoes)
  const alarme = al
    ? `<span class="chip ${al.state === 'warn' || al.state === 'alert' ? 'aviso' : 'alarme'}" data-acao="ir-alarme" data-caminho="${al.caminho}">⚠ ${al.message || al.caminho}${al.id && !al.status?.silenced && al.method?.includes('sound') ? `<span class="x" data-acao="silenciar" data-id="${al.id}">silenciar</span>` : ''}</span>`
    : ''
  const som = app.audio ? '' : '<span class="chip off aviso-som" title="O browser só deixa tocar depois de um toque">🔇 toque para ligar o som</span>'
  return `<span class="nome">ARLEQUIN</span><span>${hora(new Date())}</span>
<span class="chip ${gps ? 'bom' : 'off'}">GPS</span><span class="chip off" title="Meshtastic: depois de validar o sistema">Mesh</span><span class="chip off" title="4G: a instalar">4G</span>
<span class="chip">${p ? num(hpa(p), 0) : '—'} hPa${seta}</span>${som}${alarme}
<span class="chip piloto">Piloto: ${piloto}</span>${store.ligado ? '' : '<span class="chip alarme">SEM LIGAÇÃO AO SIGNALK</span>'}`
}

// ---------- som ----------
function bip (duracao = 0.25, freq = 880) {
  if (!app.audio) return
  const o = app.audio.createOscillator()
  const g = app.audio.createGain()
  o.frequency.value = freq
  g.gain.value = 0.4
  o.connect(g).connect(app.audio.destination)
  o.start()
  o.stop(app.audio.currentTime + duracao)
}

function tocar (ctx) {
  let continuo = false
  for (const n of ctx.notificacoes) {
    const t = deveTocar(n)
    if (t === 'continuo') continuo = true
    const chave = `${n.caminho}@${n.timestamp}`
    if (t === 'curto' && !app.bipados.has(chave)) { app.bipados.add(chave); bip(0.35, 660) }
  }
  if (continuo) bip(0.4, 1000)
}

// ---------- render ----------
function render (forcar = false) {
  const ctx = contexto()
  document.getElementById('barra').innerHTML = barraHtml(ctx)
  const el = document.getElementById('pagina')
  const aEscrever = !forcar && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'
  if (!aEscrever) el.innerHTML = PAGINAS[app.pagina].render(ctx)
  document.querySelectorAll('#botoes [data-pag]').forEach(b => {
    b.classList.toggle('on', b.dataset.pag === app.pagina)
    if (b.dataset.pag === 'ais') {
      const n = ctx.alvos.filter(a => a.classe === 'perigo').length
      b.textContent = `AIS (${ctx.alvos.length})${n ? ' ⚠' : ''}`
    }
  })
  document.getElementById('b-noite').classList.toggle('on', app.noite)
  return ctx
}

function janela (corpo) {
  pedir('/plugins/arlequin-ecra/janela', { method: 'POST', body: corpo }).catch(() => {})
}

function irPara (pag) {
  app.pagina = pag
  guardar('arlequin.pagina', pag)
  janela({ layout: pag === 'carta' ? 'carta' : 'inteiro' })
  document.activeElement?.blur?.()
  const ctx = contexto()
  PAGINAS[pag].aoEntrar?.(ctx)
  render(true)
}

// ---------- eventos ----------
document.addEventListener('pointerdown', () => {
  if (!app.audio) {
    try { app.audio = new AudioContext() } catch { /* sem som */ }
  }
}, { capture: true })

document.addEventListener('click', async (ev) => {
  const pag = ev.target.closest('[data-pag]')
  if (pag) return irPara(pag.dataset.pag)
  const a = ev.target.closest('[data-acao]')
  if (!a) return
  const acao = a.dataset.acao
  if (acao === 'noite') {
    app.noite = !app.noite
    guardar('arlequin.noite', app.noite)
    document.body.classList.toggle('noite', app.noite)
    janela({ noite: app.noite })
    return render()
  }
  if (acao === 'silenciar') {
    ev.stopPropagation()
    await pedir(`/signalk/v2/api/notifications/${a.dataset.id}/silence`, { method: 'POST' }).catch(() => {})
    return render()
  }
  if (acao === 'ir-alarme') return irPara(paginaDoAlarme(a.dataset.caminho))
  const ctx = contexto()
  await PAGINAS[app.pagina].acao?.(acao, a.dataset, ctx)
  render()
})

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
    const ctx = contexto()
    PAGINAS[app.pagina].acao?.('enter', ev.target.dataset, ctx, ev.target)
  }
})

// ---------- ciclo ----------
let segundos = 0
function ciclo () {
  const ctx = render()
  tocar(ctx)
  const p = ctx.v('environment.outside.pressure')
  if (segundos % 60 === 0 && p) {
    app.baro = registarPressao(app.baro, p, Date.now())
    guardar('arlequin.baro', app.baro)
  }
  app.viagem = acumular(app.viagem, {
    t: Date.now(),
    sog: ctx.v('navigation.speedOverGround'),
    motor: (ctx.v('propulsion.main.revolutions') || 0) > 5,
    fuelRate: ctx.v('propulsion.main.fuel.rate'),
    ventoReal: ctx.v('environment.wind.speedTrue'),
    pressao: p
  })
  if (segundos % 30 === 0) guardar('arlequin.viagem', app.viagem)
  segundos++
}

export function novaViagemAgora () {
  app.viagem = novaViagem(Date.now())
  guardar('arlequin.viagem', app.viagem)
}
window.arlequin = { novaViagemAgora, app, store }

document.body.classList.toggle('noite', app.noite)
fetch('polar-arlequin.csv').then(r => r.text()).then(t => { app.polar = lerPolar(t) }).catch(() => {})
ligar(store, { aoMudar: () => render() })
irPara(app.pagina)
setInterval(ciclo, 1000)
