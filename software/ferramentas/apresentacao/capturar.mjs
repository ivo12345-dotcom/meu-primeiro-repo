// Captura o ecrã da roda a sério (SignalK do dev a correr) num Chrome sem cabeça, pelo protocolo DevTools.
// node capturar.mjs plano.json pasta-de-saida
// plano.json: [{ nome, url, esperar, passos: [{ js, esperar, ate, maxMs }], guardar }]
//   url: abre a página (opcional, continua na mesma se faltar) · esperar: ms antes de continuar
//   passos: js corre na página; `ate` é um js que tem de devolver true (sondado de 500 em 500 ms até maxMs)
//   guardar: false para não gravar PNG (só preparar)
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const WebSocket = createRequire(import.meta.url)('../../dev/node_modules/ws/index.js')

const [plano, pasta] = process.argv.slice(2)
const passos = JSON.parse(readFileSync(plano, 'utf8'))
mkdirSync(pasta, { recursive: true })
const PORTA = 9333
const perfil = mkdtempSync(join(tmpdir(), 'arlequin-cap-'))
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORTA}`, '--window-size=1024,600', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
  '--mute-audio', `--user-data-dir=${perfil}`, 'about:blank'
], { stdio: 'ignore' })
const dormir = (ms) => new Promise(r => setTimeout(r, ms))

async function alvo () {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/json`)
      const lista = await r.json()
      const p = lista.find(t => t.type === 'page')
      if (p) return p.webSocketDebuggerUrl
    } catch {}
    await dormir(500)
  }
  throw new Error('o Chrome não respondeu na porta de depuração')
}

const ws = new WebSocket(await alvo())
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let n = 0
const pendentes = new Map()
ws.on('message', (m) => {
  const msg = JSON.parse(m.toString())
  if (msg.id && pendentes.has(msg.id)) { const { res, rej } = pendentes.get(msg.id); pendentes.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result) }
})
const enviar = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pendentes.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const avaliar = async (js) => {
  const r = await enviar('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}

await enviar('Page.enable')
await enviar('Runtime.enable')
await enviar('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false })

for (const p of passos) {
  if (p.url) { await enviar('Page.navigate', { url: p.url }); await dormir(p.esperar ?? 6000) } else if (p.esperar) await dormir(p.esperar)
  for (const s of p.passos || []) {
    if (s.js) await avaliar(s.js)
    if (s.esperar) await dormir(s.esperar)
    if (s.ate) {
      const fim = Date.now() + (s.maxMs ?? 60000)
      let ok = false
      while (Date.now() < fim) { if (await avaliar(s.ate)) { ok = true; break }; await dormir(500) }
      if (!ok) console.log(`  ! ${p.nome}: a condição não se cumpriu em ${s.maxMs ?? 60000} ms: ${s.ate}`)
      else await dormir(s.depois ?? 800)
    }
  }
  if (p.guardar !== false) {
    const r = await enviar('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(pasta, p.nome + '.png'), Buffer.from(r.data, 'base64'))
    const texto = await avaliar('document.getElementById("barra") ? document.getElementById("barra").innerText.replace(/\\s+/g, " ").slice(0, 120) : ""')
    console.log(`✓ ${p.nome}  [${texto}]`)
  }
}
ws.close()
chrome.kill()
