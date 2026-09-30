'use strict'
// Teste ao vivo do plugin da rota no SignalK local (npm start noutra janela):
//   node testar-rota.js [--destino peniche] [--tripulacao so] [--sair-agora] [--em alges] [--porta 3000] [--gravar resultado.json] [--ativar]
// --em <id>: antes de calcular, põe o barco no cais desse destino (e SoC 90%, 124 L de gasóleo)
//            por um delta no WebSocket. Com o arlequin-simulador ligado a posição volta a ser a
//            dele no segundo seguinte: para isto, desliga o simulador.
// --ativar:  ativa a melhor alternativa e confirma na API de rumo v2 que a rota ficou ativa.
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const arg = (nome, padrao) => { const i = args.indexOf(`--${nome}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao }
const tem = (nome) => args.includes(`--${nome}`)
const porta = Number(arg('porta', 3000))
const base = `http://localhost:${porta}`
const plugin = `${base}/plugins/signalk-arlequin-rota`

async function json (url, opcoes) {
  const r = await fetch(url, { ...opcoes, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) })
  const texto = await r.text()
  let corpo = null
  try { corpo = JSON.parse(texto) } catch { corpo = texto }
  return { status: r.status, corpo }
}

async function porNoCais (id) {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'signalk-arlequin-rota', 'dados', 'destinos.json'), 'utf8')).find(x => x.id === id)
  if (!d) throw new Error(`destino desconhecido: ${id}`)
  const [lat, lon] = d.aproximacao.at(-1)
  const ws = new WebSocket(`ws://localhost:${porta}/signalk/v1/stream?subscribe=none`)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket do SignalK')) })
  ws.send(JSON.stringify({
    context: 'vessels.self',
    updates: [{
      $source: 'testar-rota',
      timestamp: new Date().toISOString(),
      values: [
        { path: 'navigation.position', value: { latitude: lat, longitude: lon } },
        { path: 'electrical.batteries.servico.capacity.stateOfCharge', value: 0.9 },
        { path: 'tanks.fuel.0.currentVolume', value: 0.124 }
      ]
    }]
  }))
  await new Promise(resolve => setTimeout(resolve, 500))
  ws.close()
  const pos = await json(`${base}/signalk/v1/api/vessels/self/navigation/position/value`)
  console.log(`posição no SignalK: ${JSON.stringify(pos.corpo)} (${d.nome})`)
}

async function main () {
  if (arg('em')) await porNoCais(arg('em'))
  const pedido = { destino: arg('destino', 'peniche'), tripulacao: arg('tripulacao', 'so'), sairAgora: tem('sair-agora') }
  const a = await json(`${plugin}/calcular`, { method: 'POST', body: JSON.stringify(pedido) })
  if (a.status !== 202) throw new Error(`/calcular respondeu ${a.status}: ${JSON.stringify(a.corpo)}`)
  const id = a.corpo.id
  console.log(`a calcular ${JSON.stringify(pedido)} → ${id}`)
  const t0 = Date.now()
  let r
  for (;;) {
    r = await json(`${plugin}/resultado/${id}`)
    if (r.corpo.estado !== 'a calcular') break
    if (Date.now() - t0 > 300000) throw new Error('o cálculo demorou mais de 5 min')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  console.log(`estado: ${r.corpo.estado} em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  if (arg('gravar')) fs.writeFileSync(arg('gravar'), JSON.stringify(r.corpo, null, 1))
  if (r.corpo.estado !== 'pronto') throw new Error(r.corpo.erro)
  const res = r.corpo.resultado
  console.log(`veredicto: ${res.veredicto.texto}`)
  for (const p of res.veredicto.porque) console.log(`  · ${p}`)
  for (const [i, x] of res.alternativas.entries()) console.log(`${i + 1}. ${x.nome}: chegada ${x.chegada.p50} (${x.chegadaNoite ? 'noite' : 'dia'}), ${x.milhas} MN, custo ${x.custo.total}${x.naoRecomendada ? ', não recomendada' : ''}${x.motivos.length ? ` — ${x.motivos.join('; ')}` : ''}`)
  console.log(`desistência: ${res.desistenciaResumo}`)
  console.log(`previsão: obtida ${res.previsao.obtida} (${res.previsao.idadeH} h) · ${res.ia.nota}`)
  if (res.avisos.length) console.log(`avisos: ${res.avisos.join(' | ')}`)
  if (tem('ativar') && res.alternativas.length) {
    const at = await json(`${plugin}/ativar`, { method: 'POST', body: JSON.stringify({ id, alternativa: 0 }) })
    console.log(`/ativar: ${at.status} ${JSON.stringify(at.corpo)}`)
    const curso = await json(`${base}/signalk/v2/api/vessels/self/navigation/course`)
    console.log(`rumo: ${JSON.stringify({ activeRoute: curso.corpo.activeRoute, nextPoint: curso.corpo.nextPoint?.position })}`)
    if (curso.corpo.activeRoute?.href !== at.corpo.href) throw new Error('a rota não ficou ativa')
    console.log('rota ativa: confirmado')
  }
}

main().catch(e => { console.error(`falhou: ${e.message}`); process.exitCode = 1 })
