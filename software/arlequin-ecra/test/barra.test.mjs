// A barra de cima do ecrã (public/lib/barra.js): função pura, sem browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { barraHtml } from '../public/lib/barra.js'

const base = { agora: Date.parse('2026-09-29T14:32:00Z'), gps: true, pressao: 101600, tendencia: { sentido: 'desce', hpa3h: -2.4 }, piloto: 'standby', ligado: true }

test('a barra: nome, GPS, barómetro com a seta, piloto e, sem ligação, "SEM LIGAÇÃO AO SIGNALK"', () => {
  const html = barraHtml(base)
  assert.match(html, /ARLEQUIN/)
  assert.match(html, /class="chip bom">GPS/)
  assert.match(html, /1016 hPa ▼/)
  assert.match(html, /Piloto: standby/)
  assert.doesNotMatch(html, /SEM LIGAÇÃO/)
  assert.match(barraHtml({ ...base, ligado: false, gps: false, pressao: undefined, tendencia: null, piloto: undefined }), /class="chip off">GPS[\s\S]*— hPa[\s\S]*Piloto: manual[\s\S]*SEM LIGAÇÃO AO SIGNALK/)
})

test('auditoria K-11: a falha das janelas/modo noite do OpenCPN fica à vista na barra (antes calava-se), numa frase curta em pt-PT', async () => {
  const { falhaJanela } = await import('../public/lib/erros.js')
  const erro = (status, message = String(status)) => Object.assign(new Error(message), status ? { status } : {})
  assert.equal(falhaJanela(erro(401), { noite: true }), 'OpenCPN: sem permissão (entra no SignalK)')
  assert.equal(falhaJanela(erro(undefined, 'sem ligação ao SignalK'), { layout: 'carta' }), 'OpenCPN: sem ligação ao plugin do ecrã')
  assert.equal(falhaJanela(erro(500, 'o comando do modo noite do OpenCPN falhou (…)'), { noite: true }), 'OpenCPN: o modo noite não mudou')
  assert.equal(falhaJanela(erro(500), { noite: false }), 'OpenCPN: o modo noite não mudou')
  assert.equal(falhaJanela(erro(404), { layout: 'inteiro' }), 'OpenCPN: as janelas não mudaram')
  const html = barraHtml({ ...base, falhas: ['OpenCPN: o modo noite não mudou', '<b>'] })
  assert.match(html, /<span class="chip falha">⚠ OpenCPN: o modo noite não mudou<\/span>/)
  assert.match(html, /<span class="chip falha">⚠ &lt;b&gt;<\/span>/)
  assert.doesNotMatch(barraHtml(base), /chip falha/)
  // o app.js guarda a falha e já não a engole
  const { readFileSync } = await import('node:fs')
  // sem os \r: no Windows o git pode entregar o ficheiro com CRLF, e o fim da função não se achava
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r/g, '')
  const inicio = app.indexOf('function janela')
  const fim = app.indexOf('\n}\n', inicio)
  assert.ok(inicio >= 0 && fim > inicio, 'a função janela do app.js tem de se achar')
  const janela = app.slice(inicio, fim)
  assert.doesNotMatch(janela, /\.catch\(\(\) => \{\}\)/)
  assert.match(janela, /falhaJanela\(/)
})

test('auditoria K-04: o estado do piloto vem do SignalK e passa pelo esc', () => {
  const html = barraHtml({ ...base, piloto: '<!--<i id=x>' })
  assert.ok(!html.includes('<!--'))
  assert.ok(!html.includes('<i id=x>'))
  assert.match(html, /Piloto: &lt;!--&lt;i id=x&gt;/)
})
