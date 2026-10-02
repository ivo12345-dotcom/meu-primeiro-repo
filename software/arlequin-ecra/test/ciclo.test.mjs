// O ciclo de 1 Hz do ecrã (auditoria I-06): o som nunca depende do desenho; o que vem guardado no browser
// (página, barómetro, viagem) valida-se ao ler.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { passoCiclo, desenharSeguro, escolherPagina, ERRO_DESENHO } from '../public/lib/ciclo.js'
import { lerBarometro, tendencia } from '../public/lib/barometro.js'
import { lerViagem, acumular } from '../public/lib/viagem.js'
import diario from '../public/paginas/diario.js'

test('auditoria I-06: o apito vem primeiro e uma página que rebenta não o cala (nem os dados do barómetro e da viagem)', () => {
  const ordem = []
  const erros = []
  passoCiclo({
    tocar: () => ordem.push('som'),
    desenhar: () => { ordem.push('desenho'); throw new TypeError("Cannot read properties of undefined (reading 'filter')") },
    dados: () => ordem.push('dados')
  }, (parte, e) => erros.push([parte, e.message]))
  assert.deepEqual(ordem, ['som', 'desenho', 'dados'])
  assert.deepEqual(erros, [['desenho', "Cannot read properties of undefined (reading 'filter')"]])
  // e um som que rebenta não impede o desenho
  const o2 = []
  passoCiclo({ tocar: () => { throw new Error('x') }, desenhar: () => o2.push('desenho'), dados: () => o2.push('dados') }, () => { throw new Error('o registo também falha') })
  assert.deepEqual(o2, ['desenho', 'dados'])
})

test('auditoria I-06: a página que rebenta dá a caixa "erro ao desenhar" (em pt-PT, sem o erro técnico); nunca lança', () => {
  const erros = []
  const html = desenharSeguro(() => { throw new Error('boom') }, `<div class="caixa-erro">${ERRO_DESENHO}</div>`, (e) => erros.push(e.message))
  assert.match(html, /Erro ao desenhar esta página: os alarmes continuam a tocar/)
  assert.doesNotMatch(html, /boom/)
  assert.deepEqual(erros, ['boom'])
  assert.equal(desenharSeguro(() => '<p>ok</p>', 'x'), '<p>ok</p>')
})

test('auditoria I-06: a página guardada (ou do ?pagina=) só vale se existir; senão a Carta (nunca "constructor" nem lixo)', () => {
  const PAGINAS = { carta: {}, ais: {}, melhor: {} }
  assert.equal(escolherPagina('ais', 'melhor', PAGINAS), 'ais')
  assert.equal(escolherPagina(null, 'melhor', PAGINAS), 'melhor')
  assert.equal(escolherPagina('xpto', 'melhor', PAGINAS), 'melhor')
  for (const lixo of ['xpto', 'constructor', '__proto__', 'toString', null, 7, {}, ['ais']]) assert.equal(escolherPagina(null, lixo, PAGINAS), 'carta', String(lixo))
})

test('auditoria I-06: o barómetro guardado estragado volta vazio (o tendencia() rebentava no contexto de cada segundo)', () => {
  for (const lixo of [null, 'x', 7, [], {}, { amostras: 'x' }, { amostras: null }]) {
    const b = lerBarometro(lixo)
    assert.deepEqual(b, { amostras: [] }, JSON.stringify(lixo))
    assert.doesNotThrow(() => tendencia(b, Date.now()))
  }
  // só ficam as amostras com números
  const b = lerBarometro({ amostras: [{ t: 1, pa: 101600 }, { t: 'x', pa: 1 }, null, { t: 2 }, { t: 3, pa: 101500 }] })
  assert.deepEqual(b, { amostras: [{ t: 1, pa: 101600 }, { t: 3, pa: 101500 }] })
})

test('auditoria I-06: a viagem guardada estragada começa outra; a que está boa fica (e os campos em falta voltam a zero, nunca NaN)', () => {
  const agora = Date.parse('2026-09-29T14:32:00Z')
  for (const lixo of [null, 'x', 7, [], {}, { inicio: 'ontem' }]) {
    const v = lerViagem(lixo, agora)
    assert.equal(v.inicio, agora, JSON.stringify(lixo))
    assert.equal(v.distancia, 0)
  }
  const boa = { inicio: agora - 3600e3, ultimo: agora - 1000, distancia: 9260, tempoVela: 3000, tempoMotor: 600, gasoleoL: 0.2, ventoMax: 8, pressaoInicial: 101600, pressaoFinal: 101520 }
  assert.deepEqual(lerViagem(boa, agora), { ...lerViagem(null, boa.inicio), ...boa })
  const parcial = lerViagem({ inicio: agora - 60000, distancia: 'muito' }, agora)
  assert.equal(parcial.distancia, 0)
  const depois = acumular(parcial, { t: agora, sog: 2, motor: false })
  assert.ok(Number.isFinite(depois.distancia) && Number.isFinite(depois.tempoVela))
})

test('auditoria I-06: o cartão da AI com um último treino sem resultados nem erro não rebenta o Diário', () => {
  const ctx = { v: () => undefined, idade: () => Infinity, estado: { ia: { modelos: {}, ultimoTreino: { em: '2026-09-29T20:00:00Z' } }, iaEm: Date.now(), em: Date.now(), entradas: [] }, pedir: () => new Promise(() => {}), refrescar: () => {}, logbook: async () => {} }
  let html
  assert.doesNotThrow(() => { html = diario.render(ctx) })
  assert.match(html, /último treino/)
  assert.doesNotMatch(html, /undefined|NaN/)
})

test('auditoria I-06: o app.js toca primeiro, desenha dentro do desenharSeguro e valida o que lê do armazenamento', () => {
  // o app.js é do browser (não se importa no node): confere-se o que ele chama
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const ciclo = app.slice(app.indexOf('function ciclo'), app.indexOf('\n}\n', app.indexOf('function ciclo')))
  assert.match(ciclo, /passoCiclo\(/)
  assert.ok(ciclo.indexOf('tocar:') < ciclo.indexOf('desenhar:'), 'o som antes do desenho')
  assert.match(app, /desenharSeguro\(\(\) => PAGINAS\[app\.pagina\]\.render\(ctx\)/)
  assert.match(app, /pagina:\s*escolherPagina\(/)
  assert.match(app, /baro:\s*lerBarometro\(/)
  assert.match(app, /viagem:\s*lerViagem\(/)
  // o ciclo arranca antes da 1.ª página (um aoEntrar que rebenta já não o impede)
  assert.ok(app.indexOf('setInterval(ciclo, 1000)') < app.lastIndexOf('irPara(app.pagina)'))
})
