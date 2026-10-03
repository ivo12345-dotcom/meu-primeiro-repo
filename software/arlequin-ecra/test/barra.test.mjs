// A barra de cima do ecrã (public/lib/barra.js): função pura, sem browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { barraHtml } from '../public/lib/barra.js'
import { lerFonte, funcao } from './ajuda-fonte.mjs'

const base = { agora: Date.parse('2026-09-29T14:32:00Z'), gps: true, pressao: 101600, tendencia: { sentido: 'desce', hpa3h: -2.4 }, piloto: 'standby', ligado: true }

test('a barra: nome, GPS, barómetro com a seta, piloto e, sem ligação, "SEM LIGAÇÃO AO SIGNALK"', () => {
  const html = barraHtml(base)
  assert.match(html, /ARLEQUIN/)
  assert.match(html, /class="chip info bom">GPS/)
  assert.match(html, /1016 hPa ▼/)
  assert.match(html, /Piloto: standby/)
  assert.doesNotMatch(html, /SEM LIGAÇÃO/)
  // (revisão F3, Important 1: o "sem ligação" passou para antes do GPS, junto dos avisos)
  assert.match(barraHtml({ ...base, ligado: false, gps: false, pressao: undefined, tendencia: null, piloto: undefined }), /SEM LIGAÇÃO AO SIGNALK[\s\S]*class="chip info off">GPS[\s\S]*— hPa[\s\S]*Piloto: manual/)
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
  // (sem depender dos fins de linha — no Windows o git entrega o ficheiro com CRLF — e a função tem de se achar)
  const janela = funcao(lerFonte('app.js'), 'function janela')
  assert.doesNotMatch(janela, /\.catch\(\(\) => \{\}\)/)
  assert.match(janela, /falhaJanela\(/)
})

test('revisão F3, Important 1: na barra o alarme e o botão de calar vêm logo a seguir ao nome e à hora, depois o "sem som", as falhas e o "sem ligação"; o GPS, Mesh, 4G, barómetro e piloto ficam no fim (são os que encolhem primeiro)', async () => {
  const { chipAlarme } = await import('../public/lib/alarmes.js')
  const { chipSemSom } = await import('../public/lib/som.js')
  const alarme = { caminho: 'notifications.tanks.fuel.0.fuga', id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', state: 'alarm', method: ['visual', 'sound'], apito: 'continuo', message: 'Possível fuga de gasóleo: −6,0 L em 2 h com o motor parado!!', status: { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true } }
  const html = barraHtml({ ...base, ligado: false, somHtml: chipSemSom({ state: 'suspended' }), alarmeHtml: chipAlarme(alarme), falhas: ['OpenCPN: as janelas não mudaram'] })
  const onde = (t) => { const i = html.indexOf(t); assert.ok(i >= 0, `falta ${t}`); return i }
  const ordem = ['class="nome"', 'class="hora"', 'data-acao="ir-alarme"', 'class="silenciar"', 'class="chip sem-som"', 'class="chip falha"', 'SEM LIGAÇÃO AO SIGNALK', '>GPS<', '>Mesh<', '>4G<', 'hPa', 'Piloto:']
  for (let k = 1; k < ordem.length; k++) assert.ok(onde(ordem[k - 1]) < onde(ordem[k]), `${ordem[k - 1]} antes de ${ordem[k]}`)
  // os de informação levam a classe que os faz encolher primeiro (estilo.css)
  for (const t of ['>GPS<', '>Mesh<', '>4G<', 'hPa', 'Piloto:']) assert.match(html.slice(html.lastIndexOf('<span', onde(t)), onde(t)), /class="chip info\b/, t)
  // sem alarme nem avisos a barra continua igual no resto
  const calma = barraHtml(base)
  assert.match(calma, /<span class="nome">ARLEQUIN<\/span><span class="hora">15:32<\/span>/)
  assert.doesNotMatch(calma, /chip falha|sem-som|SEM LIGAÇÃO/)
})

test('auditoria K-04: o estado do piloto vem do SignalK e passa pelo esc', () => {
  const html = barraHtml({ ...base, piloto: '<!--<i id=x>' })
  assert.ok(!html.includes('<!--'))
  assert.ok(!html.includes('<i id=x>'))
  assert.match(html, /Piloto: &lt;!--&lt;i id=x&gt;/)
})
