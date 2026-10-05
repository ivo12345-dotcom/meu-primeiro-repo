// Mede a altura de cada <section class="pag"> de um HTML num Chrome sem cabeça, à largura útil de uma A4
// deitada (1047 px) — para ver que páginas passam dos 718 px e iam partir em duas ao imprimir.
// node medir.mjs ficheiro.html [largura] [alturaLimite]
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const WebSocket = createRequire(import.meta.url)('../../dev/node_modules/ws/index.js')

const [ficheiro, larguraArg, limiteArg] = process.argv.slice(2)
const LARGURA = Number(larguraArg) || 1047
const LIMITE = Number(limiteArg) || 718
const PORTA = 9334
const perfil = mkdtempSync(join(tmpdir(), 'arlequin-medir-'))
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORTA}`, `--window-size=${LARGURA},900`, '--hide-scrollbars', '--no-first-run',
  '--disable-gpu', `--user-data-dir=${perfil}`, 'about:blank'
], { stdio: 'ignore' })
const dormir = (ms) => new Promise(r => setTimeout(r, ms))
async function alvo () {
  for (let i = 0; i < 40; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl } catch {}
    await dormir(500)
  }
  throw new Error('sem Chrome')
}
const ws = new WebSocket(await alvo())
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let n = 0; const pend = new Map()
ws.on('message', (m) => { const msg = JSON.parse(m.toString()); if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result) } })
const enviar = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
await enviar('Page.enable')
await enviar('Emulation.setDeviceMetricsOverride', { width: LARGURA, height: 900, deviceScaleFactor: 1, mobile: false })
await enviar('Emulation.setEmulatedMedia', { media: 'print' })
await enviar('Page.navigate', { url: pathToFileURL(ficheiro).href })
await dormir(2500)
const r = await enviar('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('section.pag')].map((s, i) => ({ i: i + 1, id: s.id || '', h: Math.round(s.getBoundingClientRect().height), titulo: (s.querySelector('h1') || {}).textContent || '' })))`, returnByValue: true })
const lista = JSON.parse(r.result.value)
for (const p of lista) console.log(`${p.h > LIMITE ? '!!' : 'ok'} ${String(p.i).padStart(2)}  ${String(p.h).padStart(4)} px  ${p.titulo.trim().slice(0, 70)}`)
console.log(`${lista.length} páginas · limite ${LIMITE} px · ${lista.filter(p => p.h > LIMITE).length} a passar`)
ws.close(); chrome.kill()
