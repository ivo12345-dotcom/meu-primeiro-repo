'use strict'
// Ponta a ponta: plugin + Telegram falso + câmara falsa, com relógios reais.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const criar = require('..')
const { criarTelegramFalso } = require('../../dev/telegram-falso')

function appFalso () {
  const app = { arvore: {}, estado: '', erros: [] }
  app.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-porto-'))
  app.getDataDirPath = () => app.dir
  const pôr = (p, value) => { const ks = p.split('.'); let n = app.arvore; for (const k of ks) n = (n[k] = n[k] || {}); n.value = value; n.timestamp = new Date().toISOString() }
  app.pôr = pôr
  app.getSelfPath = (p) => p.split('.').reduce((n, k) => n?.[k], app.arvore)
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) pôr(v.path, v.value) }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = (e) => app.erros.push(e)
  return app
}
const esperar = (ms) => new Promise(r => setTimeout(r, ms))
async function ate (cond, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await esperar(100) } return false }

test('Telegram: autorização, comandos, alarme de intrusão com foto e "resolvido"', async () => {
  const tgf = await criarTelegramFalso()
  const app = appFalso()
  const p = criar(app)
  p.start({
    telegramToken: 'TESTE', chatIds: ['111'], telegramBase: tgf.url, pollTimeout: 1,
    comandoFoto: `node "${path.join(__dirname, 'camera-falsa.js')}" "{ficheiro}"`
  })
  try {
    app.pôr('navigation.position', { latitude: 39.353, longitude: -9.378 })
    app.pôr('electrical.batteries.servico.capacity.stateOfCharge', 0.81)

    // Um estranho escreve: não recebe nada e o número aparece no estado do plugin.
    tgf.escrever(999, '/estado')
    assert.ok(await ate(() => /NÃO autorizado: 999/.test(app.estado) || app.estado.includes('999')), app.estado)
    assert.equal(tgf.enviados.filter(m => m.chatId === '999').length, 0)

    tgf.escrever(111, '/armar')
    assert.ok(await ate(() => tgf.enviados.some(m => /ARMADO/.test(m.text || ''))))

    // A gaiuta abre com o alarme armado → mensagem de alarme + fotografia.
    app.pôr('sensors.gaiuta.aberta', 1)
    assert.ok(await ate(() => tgf.enviados.some(m => /🚨 Intrusão: a gaiuta abriu/.test(m.text || ''))), JSON.stringify(tgf.enviados))
    assert.ok(await ate(() => tgf.enviados.some(m => m.metodo === 'sendPhoto' && m.jpeg && /Alarme de intrusão/.test(m.caption))), JSON.stringify(tgf.enviados))

    tgf.escrever(111, '/estado')
    assert.ok(await ate(() => tgf.enviados.some(m => /Serviço 81%/.test(m.text || '') && /ARMADO/.test(m.text || ''))))

    tgf.escrever(111, '/posicao')
    assert.ok(await ate(() => tgf.enviados.some(m => m.metodo === 'sendLocation' && Math.abs(m.latitude - 39.353) < 1e-9)))

    // Desarmar limpa a intrusão → "resolvido".
    app.pôr('sensors.gaiuta.aberta', 0)
    tgf.escrever(111, '/desarmar')
    assert.ok(await ate(() => tgf.enviados.some(m => /✓ Resolvido: Intrusão/.test(m.text || ''))), JSON.stringify(tgf.enviados.map(m => m.text)))

    tgf.escrever(111, '/qualquercoisa')
    assert.ok(await ate(() => tgf.enviados.some(m => /Comandos do Arlequin/.test(m.text || ''))))
    assert.deepEqual(app.erros, [])
  } finally {
    p.stop()
    await tgf.fechar()
  }
})
