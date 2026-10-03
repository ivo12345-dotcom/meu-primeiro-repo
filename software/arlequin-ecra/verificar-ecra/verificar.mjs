#!/usr/bin/env node
// npm run verificar-ecra — desenha cada página/estado do ecrã (estados.mjs: os módulos e o estilo verdadeiros)
// num Chromium sem cabeça a 1024×600 (o LAFVIN 7" da roda) e confirma que nenhum alvo de toque fica fora do
// ecrã, tapado pelos botões de baixo ou cortado, que as listas que rolam têm a chave data-rolar, que a barra
// de cima cabe e que nenhum mosaico fica cortado sem rolar (problemas.mjs). Sai com 1 se houver problemas.
// Não corre no npm test (precisa de um Chromium): no portátil usa o Chrome ou o Edge; no Pi o chromium. O que não
// precisa dele (o que conta como problema, os estados) tem testes no npm test (test/verificar-ecra.test.mjs).
// Saída: 0 sem problemas · 1 com problemas · 2 sem browser ou um erro do próprio verificador.
//
//   npm run verificar-ecra -- [opções]     ou     node verificar-ecra/verificar.mjs [opções]
//     [--so=texto] [--letra=Verdana] [--largura=430] [--altura=600] [--json=ficheiro] [--capturas=pasta]
//     [--procurar="texto|outro"] [--rolagem] [--sem-repor] [--sem-falhar]
//   --so: só os estados com esse texto no nome · --letra: outra letra (Verdana ≈ a DejaVu Sans do Pi, mais
//   larga do que a Arial) · --largura/--altura: outro tamanho (ex.: 430 para a janela da Carta, ~42% do ecrã) ·
//   --json: grava as medidas em bruto · --capturas: um PNG por estado ·
//   --procurar: diz onde fica (e se está à vista) o elemento com esse texto · --rolagem: mostra a prova da
//   rolagem (cada lista que rola vai a 150 px, a página refaz-se como no app.js e o scrollTop tem de ficar) ·
//   --sem-repor: a mesma prova sem guardar/repor (o app.js de antes) · CHROME=… para outro browser.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { estados } from './estados.mjs'
import { recolher } from './recolher.mjs'
import { problemas } from './problemas.mjs'
import { guardarRolagem, reporRolagem } from '../public/lib/interacao.js'

// A prova da rolagem no DOM verdadeiro: cada lista com data-rolar que rola vai a 150 px (ou ao fundo), a página
// refaz-se como no app.js (guardar → innerHTML → repor) e o scrollTop tem de ficar onde estava.
// (--sem-repor: como o app.js de antes da revisão F3, que só refazia o innerHTML)
const PROVA_ROLAGEM = (semRepor) => `(() => {
  const guardar = ${semRepor ? '() => ({})' : guardarRolagem.toString()};
  const repor = ${semRepor ? '() => {}' : reporRolagem.toString()};
  const pagina = document.getElementById('pagina');
  const pedido = {};
  for (const l of pagina.querySelectorAll('[data-rolar]')) {
    if (l.scrollHeight <= l.clientHeight + 1) continue;
    l.scrollTop = Math.min(150, l.scrollHeight - l.clientHeight);
    pedido[l.dataset.rolar] = l.scrollTop;
  }
  const mapa = guardar(pagina);
  pagina.innerHTML = pagina.innerHTML;
  repor(pagina, mapa);
  return Object.entries(pedido).map(([chave, antes]) => ({ chave, antes, depois: pagina.querySelector('[data-rolar="' + chave + '"]').scrollTop }));
})()`

const PUBLICO = fileURLToPath(new URL('../public/', import.meta.url))

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
// o ecrã da roda: o LAFVIN 7" (1024×600); --largura e --altura medem outro tamanho (ex.: a janela da Carta, ~42% da largura)
const LARGURA = Number(args.largura) > 0 ? Number(args.largura) : 1024
const ALTURA = Number(args.altura) > 0 ? Number(args.altura) : 600

function acharBrowser () {
  const candidatos = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)
  return candidatos.find(c => existsSync(c)) || null
}

// O HTML de um estado: o index.html do ecrã com a barra e a página já desenhadas, sem o app.js (não há
// SignalK) e com o estilo.css verdadeiro.
function paginaHtml (e, letra) {
  const base = readFileSync(join(PUBLICO, 'index.html'), 'utf8')
  const estilo = pathToFileURL(join(PUBLICO, 'estilo.css')).href
  return base
    .replace('<link rel="stylesheet" href="estilo.css">', () => `<link rel="stylesheet" href="${estilo}">${letra ? `<style>html, body { font-family: ${letra}, sans-serif; }</style>` : ''}`)
    .replace('<header id="barra"></header>', () => `<header id="barra">${e.barra}</header>`)
    .replace('<main id="pagina"></main>', () => `<main id="pagina">${e.pagina}</main>`)
    .replace('<script type="module" src="app.js"></script>', '')
}

// Um cliente mínimo do protocolo do DevTools (o WebSocket do Node 22+).
function cdp (url) {
  const ws = new WebSocket(url)
  let id = 0
  const pendentes = new Map()
  const ouvintes = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pendentes.has(m.id)) {
      const { resolve, reject } = pendentes.get(m.id)
      pendentes.delete(m.id)
      if (m.error) reject(new Error(`${m.error.message} (${m.error.code})`))
      else resolve(m.result)
    } else if (m.method) {
      for (const o of [...ouvintes]) o(m)
    }
  }
  return {
    aberto: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('não liguei ao DevTools')) }),
    enviar (method, params = {}, sessionId) {
      const n = ++id
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
      return new Promise((resolve, reject) => pendentes.set(n, { resolve, reject }))
    },
    esperar (method, sessionId, ms = 15000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { tirar(); reject(new Error(`sem ${method} em ${ms} ms`)) }, ms)
        const o = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) { clearTimeout(t); tirar(); resolve(m.params) } }
        const tirar = () => { const i = ouvintes.indexOf(o); if (i >= 0) ouvintes.splice(i, 1) }
        ouvintes.push(o)
      })
    },
    fechar () { try { ws.close() } catch { /* já fechado */ } }
  }
}

async function main () {
  const exe = acharBrowser()
  if (!exe) {
    console.error('Não achei o Chrome/Chromium/Edge: põe o caminho em CHROME=… (no Pi: sudo apt install chromium-browser).')
    process.exit(2)
  }
  const pasta = mkdtempSync(join(tmpdir(), 'arlequin-verificar-'))
  const perfil = join(pasta, 'perfil')
  const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, `--window-size=${LARGURA},${ALTURA}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let cliente
  const fim = () => {
    cliente?.fechar()
    if (browser.exitCode === null) browser.kill()
  }
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let texto = ''
      const t = setTimeout(() => reject(new Error(`o browser não abriu o DevTools: ${texto.slice(0, 300)}`)), 20000)
      browser.stderr.on('data', (b) => {
        texto += b
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(texto)
        if (m) { clearTimeout(t); resolve(m[1]) }
      })
      browser.on('exit', (c) => { clearTimeout(t); reject(new Error(`o browser saiu (${c}) antes de abrir o DevTools`)) })
    })
    cliente = cdp(wsUrl)
    await cliente.aberto
    const { targetId } = await cliente.enviar('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cliente.enviar('Target.attachToTarget', { targetId, flatten: true })
    const s = (m, p) => cliente.enviar(m, p, sessionId)
    await s('Page.enable')
    await s('Emulation.setDeviceMetricsOverride', { width: LARGURA, height: ALTURA, deviceScaleFactor: 1, mobile: false })

    const procurar = typeof args.procurar === 'string' ? args.procurar.split('|') : []
    const lista = estados().filter(e => !args.so || e.nome.includes(args.so))
    const todos = []
    let total = 0
    if (args.capturas) mkdirSync(args.capturas, { recursive: true })
    for (const e of lista) {
      const ficheiro = join(pasta, `${e.nome}.html`)
      writeFileSync(ficheiro, paginaHtml(e, typeof args.letra === 'string' ? args.letra : null))
      const carregou = cliente.esperar('Page.loadEventFired', sessionId)
      await s('Page.navigate', { url: pathToFileURL(ficheiro).href + (e.noite ? '?noite=1&brilho=2' : '') })
      await carregou
      const r = await s('Runtime.evaluate', { expression: `document.fonts.ready.then(() => (${recolher.toString()})(${JSON.stringify(procurar)}))`, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(`${e.nome}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
      const dados = r.result.value
      if (args.capturas) {
        const c = await s('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(args.capturas, `${e.nome}.png`), Buffer.from(c.data, 'base64'))
      }
      // (depois das medidas e da captura: a prova mexe no scroll e refaz a página)
      const rr = await s('Runtime.evaluate', { expression: PROVA_ROLAGEM(!!args['sem-repor']), returnByValue: true })
      dados.rolagem = rr.exceptionDetails ? [{ chave: 'erro', antes: 0, depois: rr.exceptionDetails.text }] : rr.result.value
      const p = problemas(dados)
      total += p.length
      todos.push({ estado: e.nome, noite: e.noite, dados, problemas: p })
      const listas = dados.rolar.filter(x => x.scrollH > x.clientH + 1).map(x => `${x.chave || x.nome} ${x.scrollH}/${x.clientH}`)
      console.log(`${p.length ? '✗' : '✓'} ${e.nome.padEnd(38)} ${String(dados.alvos.length).padStart(3)} alvos · ${dados.vw}×${dados.vh}${listas.length ? ` · rolam: ${listas.join(', ')}` : ''}`)
      for (const x of p) console.log(`    ${x.tipo}: ${x.alvo} — ${x.detalhe}`)
      for (const a of dados.achados) console.log(`    procurar "${a.texto}": ${!a.achado ? 'não está' : `y ${a.caixa.t}–${a.caixa.b}, à vista ${a.vis.w}×${a.vis.h} de ${a.caixa.w}×${a.caixa.h}${a.lista ? ` (na lista que rola ${a.lista.nome})` : ''}`}`)
      if (args.rolagem && dados.rolagem.length) console.log(`    rolagem depois de refazer: ${dados.rolagem.map(x => `${x.chave} ${x.antes}→${x.depois}`).join(', ')}`)
    }
    if (typeof args.json === 'string') writeFileSync(args.json, JSON.stringify(todos, null, 1))
    console.log(`\n${lista.length} estados a ${LARGURA}×${ALTURA}${args.letra ? ` (letra ${args.letra})` : ''}: ${total ? `${total} problemas` : 'sem problemas'}`)
    fim()
    process.exitCode = total && !args['sem-falhar'] ? 1 : 0
  } catch (e) {
    fim()
    console.error(`verificar-ecra: ${e.message}`)
    process.exitCode = 2
  } finally {
    // o perfil do browser fica preso uns instantes depois de ele sair (Windows)
    setTimeout(() => { try { rmSync(pasta, { recursive: true, force: true }) } catch { /* fica no temporário */ } }, 500)
  }
}

main()
