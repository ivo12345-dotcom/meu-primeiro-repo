// Grava o ecrã da roda a sério (SignalK do dev a correr) num Chrome sem cabeça, pelo protocolo DevTools,
// a ~6 imagens por segundo, enquanto segue um guião de páginas e cliques. Saída: pasta com os JPEG das
// imagens e um `guiao-gravado.json` (imagem → instante → legenda) para o montar.py juntar com as legendas.
//
// node gravar.mjs guiao.json pasta-de-saida
// guiao.json: [{ nome, legenda, capitulo, url, esperar, passos: [{ clique | js, esperar, ate, maxMs }], segurar, slide, duracao }]
//   url: abre a página (opcional) · esperar: ms depois de abrir · passos: cliques (seletor CSS, com realce visual) ou js
//   ate: js que tem de devolver true (sondado de 500 em 500 ms até maxMs) · segurar: ms a filmar depois dos passos
//   slide: um cartão gerado pelo montar.py (sem filmar), com duracao em ms
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const WebSocket = createRequire(import.meta.url)('../../dev/node_modules/ws/index.js')

const [guiaoFicheiro, pasta] = process.argv.slice(2)
const guiao = JSON.parse(readFileSync(guiaoFicheiro, 'utf8'))
mkdirSync(pasta, { recursive: true })
const PORTA = 9334
const INTERVALO = 160 // ms entre imagens (~6/s)
const perfil = mkdtempSync(join(tmpdir(), 'arlequin-video-'))
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
      const p = (await r.json()).find(t => t.type === 'page')
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
// clique com realce: contorno laranja 700 ms antes de disparar os eventos (fica no vídeo). O ecrã redesenha as
// páginas a cada segundo, por isso o realce vai por uma regra CSS (sobrevive ao redesenho) e o botão procura-se
// outra vez no instante do toque.
const CLIQUE = (sel, obrigatorio) => `(async()=>{const S=${JSON.stringify(sel)};let e=document.querySelector(S);if(!e){if(${obrigatorio})throw new Error('não há '+S);return false}
e.scrollIntoView({block:'nearest'});let st=document.getElementById('realce-video');if(!st){st=document.createElement('style');st.id='realce-video';document.head.appendChild(st)}
st.textContent=S+'{outline:5px solid #ff9f1c !important;outline-offset:3px !important}';
await new Promise(r=>setTimeout(r,700));e=document.querySelector(S);if(!e){st.textContent='';if(${obrigatorio})throw new Error('desapareceu '+S);return false}
['pointerdown','pointerup','click'].forEach(t=>e.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'touch'})));
await new Promise(r=>setTimeout(r,250));st.textContent='';return true})()`

await enviar('Page.enable')
await enviar('Runtime.enable')
await enviar('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false })

// ---------- a filmagem: um laço que grava imagens enquanto o guião corre ----------
const registo = [] // { tipo: 'imagem', ficheiro, t, passo } | { tipo: 'slide', slide, duracao, passo }
let imagem = 0
let passoAtual = 0
let aFilmar = false
let ocupado = false
const t0 = Date.now()
const laco = setInterval(async () => {
  if (!aFilmar || ocupado) return
  ocupado = true
  try {
    const r = await enviar('Page.captureScreenshot', { format: 'jpeg', quality: 82 })
    const ficheiro = `img-${String(++imagem).padStart(5, '0')}.jpg`
    writeFileSync(join(pasta, ficheiro), Buffer.from(r.data, 'base64'))
    registo.push({ tipo: 'imagem', ficheiro, t: Date.now() - t0, passo: passoAtual })
  } catch (e) { console.log('  ! imagem falhou:', e.message) } finally { ocupado = false }
}, INTERVALO)

for (let i = 0; i < guiao.length; i++) {
  const p = guiao[i]; passoAtual = i
  if (p.slide) { registo.push({ tipo: 'slide', slide: p.slide, duracao: p.duracao ?? 6000, passo: i, t: Date.now() - t0 }); console.log(`▭ ${p.nome} (cartão ${p.slide})`); continue }
  if (p.url) { aFilmar = false; await enviar('Page.navigate', { url: p.url }); await dormir(Math.min(p.esperar ?? 6000, 1500)); aFilmar = true; await dormir(Math.max(0, (p.esperar ?? 6000) - 1500)) } else { aFilmar = true; if (p.esperar) await dormir(p.esperar) }
  for (const s of p.passos || []) {
    try {
      if (s.clique) { const ok = await avaliar(CLIQUE(s.clique, s.obrigatorio !== false)); if (!ok) console.log(`  · ${p.nome}: não há ${s.clique} (seguiu)`) }
      if (s.js) await avaliar(s.js)
    } catch (e) { console.log(`  ! ${p.nome}: ${e.message}`) }
    if (s.esperar) await dormir(s.esperar)
    if (s.ate) {
      const fim = Date.now() + (s.maxMs ?? 60000); let ok = false
      while (Date.now() < fim) { try { if (await avaliar(s.ate)) { ok = true; break } } catch {} await dormir(500) }
      if (!ok) console.log(`  ! ${p.nome}: a condição não se cumpriu em ${s.maxMs ?? 60000} ms: ${s.ate}`); else await dormir(s.depois ?? 800)
    }
  }
  if (p.segurar) await dormir(p.segurar)
  const texto = await avaliar('document.getElementById("barra") ? document.getElementById("barra").innerText.replace(/\\s+/g, " ").slice(0, 100) : ""').catch(() => '')
  console.log(`✓ ${p.nome}  [${texto}]  imagens até agora: ${imagem}`)
}
aFilmar = false
clearInterval(laco)
await dormir(400)
writeFileSync(join(pasta, 'guiao-gravado.json'), JSON.stringify({ guiao, registo, intervalo: INTERVALO }, null, 1))
console.log(`fim: ${imagem} imagens, ${registo.filter(r => r.tipo === 'slide').length} cartões`)
ws.close()
chrome.kill()
