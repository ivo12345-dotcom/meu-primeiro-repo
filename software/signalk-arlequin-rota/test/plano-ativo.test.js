'use strict'
// O plano ativo (desenho 3b-2, "Plano ativo"): o que se grava ao Ativar, a gravação atómica e a
// leitura ao arrancar, e os estados (à espera de sair → a navegar → chegado / terminado / pausado).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const pa = require('../lib/plano-ativo')
const c = require('../lib/costa')

const MIN = 60000
// Algés → Peniche, "sair agora" (29/09, previsão gravada): a fixture do ecrã, com o rasto e os eventos
const FUGA = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', '..', 'arlequin-ecra', 'test', 'fixtures', 'resultado-fuga.json.gz'))))
const AGORA = Date.parse('2026-09-29T14:30:00Z')
const HREF = '/resources/routes/aaaa'
const ALT = FUGA.alternativas[0]
const PARTIDA = ALT.pontosRota[0]
const CAIS = ALT.pontosRota.at(-1)
const APROX = [[39.34, -9.37], [39.35, -9.375], [CAIS.lat, CAIS.lon]]
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-plano-ativo-'))

const novo = (extra = {}) => pa.criarPlano({ idCalculo: 'calc-1', resultado: FUGA, indice: 0, href: HREF, aproximacao: APROX, agora: AGORA, ...extra })
// uma leitura dos instrumentos: a posição, o SOG em nós e o href da rota ativa (undefined: não se sabe)
const ler = (posicao, sogNos, href = HREF) => ({ posicao, sogNos, href })
// a d MN para norte de p
const aNorte = (p, d) => c.deslocar(p, 0, d)

test('criarPlano: guarda o cálculo, a alternativa (rota, rasto, eventos, chegada, partida), o destino com a aproximação e o cais, a desistência, a tripulação, o href e o estado "a espera de sair"', () => {
  const p = novo()
  assert.equal(p.versao, 1)
  assert.equal(p.idCalculo, 'calc-1')
  assert.equal(p.indice, 0)
  assert.equal(p.href, HREF)
  assert.equal(p.estado, 'a espera de sair')
  assert.equal(p.ativadoEm, new Date(AGORA).toISOString())
  assert.equal(p.saida, null)
  assert.equal(p.chegou, null)
  assert.equal(p.fechadoEm, null)
  assert.equal(p.tripulacao, 'so')
  assert.equal(p.alternativa.id, ALT.id)
  assert.equal(p.alternativa.nome, ALT.nome)
  assert.equal(p.alternativa.partida, ALT.partida)
  assert.deepEqual(p.alternativa.chegada, ALT.chegada)
  assert.deepEqual(p.alternativa.rasto, ALT.rasto)
  assert.deepEqual(p.alternativa.eventos, ALT.eventos)
  assert.deepEqual(p.alternativa.pontosRota, ALT.pontosRota)
  assert.equal(p.alternativa.propulsao, 'motor')
  assert.deepEqual(p.destino, { id: 'peniche', nome: 'Peniche', aproximacao: APROX, cais: { lat: CAIS.lat, lon: CAIS.lon } })
  assert.deepEqual(p.partida, { nome: 'Algés (CNA)', lat: PARTIDA.lat, lon: PARTIDA.lon })
  assert.equal(p.desistencia.length, FUGA.desistencia.length)
  assert.equal(p.desistenciaResumo, FUGA.desistenciaResumo)
  assert.equal(p.envio, null)
  // sem aproximação (um destino avulso): o cais é o último ponto da rota
  const q = novo({ aproximacao: null })
  assert.deepEqual(q.destino.aproximacao, [[CAIS.lat, CAIS.lon]])
  assert.deepEqual(q.destino.cais, { lat: CAIS.lat, lon: CAIS.lon })
  // a desistência só se calcula para a 1.ª alternativa: nas outras fica vazia
  const r = pa.criarPlano({ idCalculo: 'calc-1', resultado: FUGA, indice: 1, href: HREF, agora: AGORA })
  assert.deepEqual(r.desistencia, [])
  assert.equal(r.desistenciaResumo, null)
  // o envio: a quem e a hora de alarme
  const e = novo({ envio: { contactos: ['Mãe'], alarme: '2026-09-30T08:22:00.000Z', pedido: 'p1', enviadoEm: '2026-09-29T14:20:00.000Z' } })
  assert.deepEqual(e.envio, { contactos: ['Mãe'], alarme: '2026-09-30T08:22:00.000Z', pedido: 'p1', enviadoEm: '2026-09-29T14:20:00.000Z' })
  assert.throws(() => pa.criarPlano({ idCalculo: 'x', resultado: FUGA, indice: 7, href: HREF, agora: AGORA }), /alternativa desconhecida/)
})

test('gravar e ler: plano-ativo.json na pasta do plugin, escrita atómica (sem .tmp a sobrar); um ficheiro estragado lê-se como nenhum plano, com o erro', () => {
  const dir = pasta()
  assert.equal(pa.ler(dir).plano, null)
  assert.equal(pa.ler(dir).erro, null)
  const p = novo()
  pa.gravar(dir, p)
  assert.deepEqual(fs.readdirSync(dir), ['plano-ativo.json'])
  assert.deepEqual(pa.ler(dir).plano, p)
  // a gravação seguinte substitui
  pa.gravar(dir, { ...p, estado: 'a navegar' })
  assert.equal(pa.ler(dir).plano.estado, 'a navegar')
  fs.writeFileSync(path.join(dir, pa.FICHEIRO), '{"versao":1,"estado":')
  const x = pa.ler(dir)
  assert.equal(x.plano, null)
  assert.match(x.erro, /^plano-ativo\.json ilegível: /)
  // um JSON que não é um plano também não
  fs.writeFileSync(path.join(dir, pa.FICHEIRO), '[1,2]')
  assert.equal(pa.ler(dir).plano, null)
})

test('saída: a mais de 0,5 MN da partida passa a "a navegar" e guarda a hora real de saída (0,49 MN ainda não)', () => {
  let p = novo()
  let mem = pa.novaMemoria()
  let r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.49), 1.5), mem, AGORA + MIN)
  assert.equal(r.plano.estado, 'a espera de sair')
  assert.equal(r.mudou, null)
  p = r.plano; mem = r.mem
  r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.51), 1.5), mem, AGORA + 2 * MIN)
  assert.equal(r.plano.estado, 'a navegar')
  assert.equal(r.mudou, 'saiu')
  assert.equal(r.plano.saida, new Date(AGORA + 2 * MIN).toISOString())
  // o plano de entrada não muda (funções puras)
  assert.equal(p.estado, 'a espera de sair')
})

test('saída: SOG > 2 nós durante 5 min seguidos (4 min não chegam; uma paragem a meio recomeça a contagem); a saída é o início dos 5 min', () => {
  const perto = aNorte(PARTIDA, 0.1)
  let p = novo()
  let mem = pa.novaMemoria()
  const passo = (min, sog) => { const r = pa.avaliar(p, ler(perto, sog), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(0, 2.5)
  passo(2, 2.5)
  passo(3, 2) // 2 nós não é mais de 2: recomeça
  passo(4, 2.1)
  assert.equal(passo(8, 2.1).plano.estado, 'a espera de sair', '4 min seguidos')
  const r = passo(9, 2.1)
  assert.equal(r.plano.estado, 'a navegar')
  assert.equal(r.mudou, 'saiu')
  assert.equal(r.plano.saida, new Date(AGORA + 4 * MIN).toISOString())
  // sem SOG (null) também recomeça
  p = novo(); mem = pa.novaMemoria()
  passo(0, 3); passo(3, null); passo(5, 3)
  assert.equal(passo(9, 3).plano.estado, 'a espera de sair')
})

test('chegada: a menos de 0,3 MN do cais e SOG < 0,5 nó durante 5 min seguidos; 0,31 MN ou 0,5 nó não contam', () => {
  let p = { ...novo(), estado: 'a navegar', saida: new Date(AGORA).toISOString() }
  let mem = pa.novaMemoria()
  const passo = (min, posicao, sog) => { const r = pa.avaliar(p, ler(posicao, sog), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(600, aNorte(CAIS, 0.31), 0.2)
  assert.equal(passo(606, aNorte(CAIS, 0.31), 0.2).plano.estado, 'a navegar', 'a 0,31 MN')
  passo(610, aNorte(CAIS, 0.29), 0.5)
  assert.equal(passo(616, aNorte(CAIS, 0.29), 0.5).plano.estado, 'a navegar', 'a 0,5 nó')
  passo(620, aNorte(CAIS, 0.29), 0.4)
  assert.equal(passo(624, aNorte(CAIS, 0.2), 0.1).plano.estado, 'a navegar', '4 min')
  const r = passo(625, aNorte(CAIS, 0.2), 0)
  assert.equal(r.plano.estado, 'chegado')
  assert.equal(r.mudou, 'chegou')
  assert.equal(r.plano.chegou, new Date(AGORA + 620 * MIN).toISOString())
  assert.equal(r.plano.fechadoEm, new Date(AGORA + 625 * MIN).toISOString())
  // fechado: já nada muda
  const s = pa.avaliar(r.plano, ler(aNorte(PARTIDA, 5), 6, '/resources/routes/outra'), r.mem, AGORA + 700 * MIN)
  assert.equal(s.plano.estado, 'chegado')
  assert.equal(s.mudou, null)
})

test('à espera de sair, a chegada não conta (o cais de partida pode ser perto do destino)', () => {
  const p = novo()
  let mem = pa.novaMemoria()
  let r
  for (let m = 0; m <= 10; m++) { r = pa.avaliar(p, ler(CAIS, 0), mem, AGORA + m * MIN); mem = r.mem }
  assert.notEqual(r.plano.estado, 'chegado')
})

test('rota mudada: o href da rota ativa deixa de ser o do plano (outra rota ou nenhuma) → "pausado"; a mesma rota de volta → retoma o estado de antes; sem saber a rota (undefined) não muda', () => {
  const p = { ...novo(), estado: 'a navegar', saida: new Date(AGORA).toISOString() }
  const longe = aNorte(PARTIDA, 10)
  let r = pa.avaliar(p, ler(longe, 5, undefined), pa.novaMemoria(), AGORA + 60 * MIN)
  assert.equal(r.plano.estado, 'a navegar')
  r = pa.avaliar(p, ler(longe, 5, '/resources/routes/outra'), pa.novaMemoria(), AGORA + 61 * MIN)
  assert.equal(r.plano.estado, 'pausado')
  assert.equal(r.plano.pausadoDe, 'a navegar')
  assert.equal(r.mudou, 'pausado')
  const nenhuma = pa.avaliar(p, ler(longe, 5, null), pa.novaMemoria(), AGORA + 61 * MIN)
  assert.equal(nenhuma.plano.estado, 'pausado')
  // pausado: nem saída nem chegada; continua pausado com a outra rota
  let s = pa.avaliar(r.plano, ler(CAIS, 0, '/resources/routes/outra'), r.mem, AGORA + 62 * MIN)
  assert.equal(s.plano.estado, 'pausado')
  assert.equal(s.mudou, null)
  s = pa.avaliar(s.plano, ler(longe, 5, HREF), s.mem, AGORA + 63 * MIN)
  assert.equal(s.plano.estado, 'a navegar')
  assert.equal(s.plano.pausadoDe, null)
  assert.equal(s.mudou, 'retomado')
  // à espera de sair também pausa, e retoma "a espera de sair"
  const e = pa.avaliar(novo(), ler(PARTIDA, 0, null), pa.novaMemoria(), AGORA)
  assert.equal(e.plano.estado, 'pausado')
  assert.equal(pa.avaliar(e.plano, ler(PARTIDA, 0, HREF), e.mem, AGORA + MIN).plano.estado, 'a espera de sair')
})

test('sem GPS (posição null): nem saída nem chegada, e a contagem dos 5 min recomeça', () => {
  let p = novo()
  let mem = pa.novaMemoria()
  const passo = (min, posicao, sog) => { const r = pa.avaliar(p, ler(posicao, sog), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(0, aNorte(PARTIDA, 0.1), 3)
  passo(3, null, 3)
  assert.equal(passo(6, aNorte(PARTIDA, 0.2), 3).plano.estado, 'a espera de sair')
  assert.equal(passo(11, aNorte(PARTIDA, 0.2), 3).plano.estado, 'a navegar')
})

test('terminar: fecha o plano ("terminado", com a hora); continuar: volta ao estado de antes da pausa; os abertos e os fechados', () => {
  const p = { ...novo(), estado: 'pausado', pausadoDe: 'a navegar' }
  const t = pa.terminar(p, AGORA + 90 * MIN)
  assert.equal(t.estado, 'terminado')
  assert.equal(t.fechadoEm, new Date(AGORA + 90 * MIN).toISOString())
  const k = pa.continuar(p)
  assert.equal(k.estado, 'a navegar')
  assert.equal(k.pausadoDe, null)
  assert.equal(pa.continuar(novo()).estado, 'a espera de sair', 'sem pausa fica como está')
  assert.ok(pa.aberto(novo()))
  assert.ok(pa.aberto(p))
  assert.ok(!pa.aberto(t))
  assert.ok(!pa.aberto({ ...novo(), estado: 'chegado' }))
  assert.ok(!pa.aberto(null))
})
