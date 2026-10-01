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

test('saída: a mais de 0,5 MN da partida em 2 amostras seguidas passa a "a navegar" e guarda a hora real de saída (a 1.ª); 0,49 MN ainda não', () => {
  let p = novo()
  let mem = pa.novaMemoria()
  let r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.49), 1.5), mem, AGORA + MIN)
  assert.equal(r.plano.estado, 'a espera de sair')
  assert.equal(r.mudou, null)
  p = r.plano; mem = r.mem
  r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.51), 1.5), mem, AGORA + 2 * MIN)
  assert.equal(r.plano.estado, 'a espera de sair', 'uma amostra só (um salto do GPS) não chega')
  p = r.plano; mem = r.mem
  r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.52), 1.5), mem, AGORA + 3 * MIN)
  assert.equal(r.plano.estado, 'a navegar')
  assert.equal(r.mudou, 'saiu')
  assert.equal(r.plano.saida, new Date(AGORA + 2 * MIN).toISOString())
  // o plano de entrada não muda (funções puras)
  assert.equal(p.estado, 'a espera de sair')
})

test('M1: um salto do GPS (uma amostra a mais de 0,5 MN e a seguinte de volta ao cais) não é a saída', () => {
  let p = novo()
  let mem = pa.novaMemoria()
  const passo = (min, posicao) => { const r = pa.avaliar(p, ler(posicao, 0), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(0, aNorte(PARTIDA, 0.05))
  passo(1, aNorte(PARTIDA, 3)) // o salto
  assert.equal(passo(2, aNorte(PARTIDA, 0.05)).plano.estado, 'a espera de sair')
  assert.equal(passo(3, aNorte(PARTIDA, 3)).plano.estado, 'a espera de sair', 'outra vez só uma amostra')
  assert.equal(passo(4, aNorte(PARTIDA, 0.05)).plano.estado, 'a espera de sair')
})

test('M2: as janelas "seguidos" só contam amostras com até 2 min entre elas; um salto do relógio (para a frente ou para trás) recomeça a janela', () => {
  // a saída pelo SOG: 0 e depois +6 min (o relógio saltou) não fazem 5 min seguidos
  const perto = aNorte(PARTIDA, 0.1)
  let p = novo()
  let mem = pa.novaMemoria()
  const passo = (min, posicao, sog) => { const r = pa.avaliar(p, ler(posicao, sog), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(0, perto, 3)
  assert.equal(passo(6, perto, 3).plano.estado, 'a espera de sair', 'uma amostra antes do salto e outra depois')
  for (const m of [8, 10]) passo(m, perto, 3) // de 2 em 2 min ainda conta
  assert.equal(passo(11, perto, 3).plano.estado, 'a navegar')
  assert.equal(p.saida, new Date(AGORA + 6 * MIN).toISOString())
  // a saída pela distância: 2 amostras a mais de 2 min uma da outra não são seguidas
  p = novo(); mem = pa.novaMemoria()
  passo(0, aNorte(PARTIDA, 0.6), 0)
  assert.equal(passo(3, aNorte(PARTIDA, 0.6), 0).plano.estado, 'a espera de sair')
  assert.equal(passo(4, aNorte(PARTIDA, 0.6), 0).plano.estado, 'a navegar')
  // a chegada: parado no cais às 600 min e outra amostra às 610 (o relógio saltou): ainda não
  p = { ...novo(), estado: 'a navegar', saida: new Date(AGORA).toISOString() }; mem = pa.novaMemoria()
  const noCais = (min) => { const r = pa.avaliar(p, { ...ler(aNorte(CAIS, 0.1), 0), milhas: 60 }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  noCais(600)
  assert.equal(noCais(610).plano.estado, 'a navegar', 'salto para a frente')
  noCais(611)
  assert.equal(noCais(605).plano.estado, 'a navegar', 'para trás')
  for (const m of [606, 607, 608, 609]) noCais(m)
  assert.equal(noCais(610).plano.estado, 'chegado')
  assert.equal(p.chegou, new Date(AGORA + 605 * MIN).toISOString())
})

test('saída: SOG > 2 nós durante 5 min seguidos (4 min não chegam; uma paragem a meio recomeça a contagem); a saída é o início dos 5 min', () => {
  const perto = aNorte(PARTIDA, 0.1)
  let p = novo()
  let mem = pa.novaMemoria()
  const passo = (min, sog) => { const r = pa.avaliar(p, ler(perto, sog), mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  passo(0, 2.5)
  passo(2, 2.5)
  passo(3, 2) // 2 nós não é mais de 2: recomeça
  for (let m = 4; m <= 7; m++) passo(m, 2.1)
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

test('chegada: a menos de 0,3 MN do cais e SOG < 0,5 nó durante 5 min seguidos (com o progresso na rota); 0,31 MN ou 0,5 nó não contam', () => {
  let p = { ...novo(), estado: 'a navegar', saida: new Date(AGORA).toISOString() }
  let mem = pa.novaMemoria()
  // as milhas feitas na rota: perto do fim (de minuto a minuto: as janelas pedem amostras seguidas)
  const passo = (min, posicao, sog) => { const r = pa.avaliar(p, { ...ler(posicao, sog), milhas: 60 }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  const seguidos = (de, ate, posicao, sog) => { let r; for (let m = de; m <= ate; m++) r = passo(m, posicao, sog); return r }
  assert.equal(seguidos(600, 606, aNorte(CAIS, 0.31), 0.2).plano.estado, 'a navegar', 'a 0,31 MN')
  assert.equal(seguidos(610, 616, aNorte(CAIS, 0.29), 0.5).plano.estado, 'a navegar', 'a 0,5 nó')
  passo(620, aNorte(CAIS, 0.29), 0.4)
  assert.equal(seguidos(621, 624, aNorte(CAIS, 0.2), 0.1).plano.estado, 'a navegar', '4 min')
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
  for (let m = 7; m <= 10; m++) passo(m, aNorte(PARTIDA, 0.2), 3)
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

// I1 (a sonda B1 da revisão): o cais a 0,15 MN da partida (uma ida e volta: a rota sai 3 MN e volta)
function idaEVolta () {
  const cais = c.deslocar(PARTIDA, 90, 0.15)
  const pts = [{ lat: PARTIDA.lat, lon: PARTIDA.lon }, aNorte(PARTIDA, 3), { lat: cais.lat, lon: cais.lon, nome: 'cais' }]
  const base = novo()
  return { ...base, alternativa: { ...base.alternativa, pontosRota: pts }, destino: { ...base.destino, aproximacao: [[cais.lat, cais.lon]], cais: { lat: cais.lat, lon: cais.lon } }, partida: { ...base.partida, lat: PARTIDA.lat, lon: PARTIDA.lon } }
}

test('I1 (sonda B1): a chegada pede progresso na rota (≥ 50 % das milhas): manobrar na marina (SOG > 2 nós 6 min) e parar 6 min no cais a 0,15 MN da partida não é "cheguei bem"', () => {
  let p = idaEVolta()
  let mem = pa.novaMemoria()
  const cais = p.destino.cais
  const passo = (min, posicao, sog, milhas) => { const r = pa.avaliar(p, { ...ler(posicao, sog), milhas }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  for (let m = 0; m <= 6; m++) passo(m, aNorte(PARTIDA, 0.05), 3, 0.02)
  assert.equal(p.estado, 'a navegar', 'saiu pelo SOG')
  const mudou = []
  for (let m = 7; m <= 13; m++) mudou.push(passo(m, cais, 0, 0.05).mudou)
  assert.equal(p.estado, 'a navegar')
  assert.ok(!mudou.includes('chegou'))
  // sem as milhas (null) também não
  for (let m = 14; m <= 20; m++) passo(m, cais, 0, null)
  assert.equal(p.estado, 'a navegar')
  // depois da volta (milhas ≥ 50 % de ~6 MN): chega
  for (let m = 60; m <= 64; m++) passo(m, cais, 0, 5.9)
  assert.equal(p.estado, 'a navegar', '4 min')
  assert.equal(passo(65, cais, 0, 5.9).mudou, 'chegou')
  assert.equal(p.chegou, new Date(AGORA + 60 * MIN).toISOString())
})

test('I1: numa rota com menos de 1 MN, sem 50 % das milhas, a chegada pede 5 min "a navegar" antes dos 5 min parado', () => {
  const base = novo()
  const cais = aNorte(PARTIDA, 0.6)
  let p = { ...base, estado: 'a navegar', saida: new Date(AGORA).toISOString(), navegarDesde: new Date(AGORA).toISOString(), alternativa: { ...base.alternativa, pontosRota: [{ lat: PARTIDA.lat, lon: PARTIDA.lon }, cais] }, destino: { ...base.destino, cais } }
  let mem = pa.novaMemoria()
  const passo = (min) => { const r = pa.avaliar(p, { ...ler(cais, 0), milhas: 0.1 }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  for (let m = 1; m <= 9; m++) passo(m)
  assert.equal(p.estado, 'a navegar', 'os 5 min parado só contam depois de 5 min a navegar')
  assert.equal(passo(10).mudou, 'chegou')
  assert.equal(p.chegou, new Date(AGORA + 5 * MIN).toISOString())
})

test('a saída guarda a hora em que passou a "a navegar" (navegarDesde)', () => {
  let p = novo()
  let mem = pa.novaMemoria()
  for (let m = 0; m <= 1; m++) { const r = pa.avaliar(p, ler(aNorte(PARTIDA, 0.6), 0), mem, AGORA + m * MIN); p = r.plano; mem = r.mem }
  assert.equal(p.estado, 'a navegar')
  assert.equal(p.navegarDesde, new Date(AGORA + MIN).toISOString())
})

test('decisão 5 (Ivo): em pausa no mar, a chegada ao cais do plano continua a contar (a mesma regra) e fecha o plano; em pausa antes de sair, não', () => {
  let p = { ...novo(), estado: 'pausado', pausadoDe: 'a navegar', saida: new Date(AGORA).toISOString() }
  let mem = pa.novaMemoria()
  const passo = (min, posicao, sog, milhas = 60) => { const r = pa.avaliar(p, { ...ler(posicao, sog, null), milhas }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  for (let m = 600; m <= 604; m++) passo(m, aNorte(CAIS, 0.1), 0)
  assert.equal(p.estado, 'pausado')
  const r = passo(605, aNorte(CAIS, 0.1), 0)
  assert.equal(r.mudou, 'chegou')
  assert.equal(p.estado, 'chegado')
  assert.equal(p.pausadoDe, null)
  assert.equal(p.chegou, new Date(AGORA + 600 * MIN).toISOString())
  // re-revisão I-1 (Ivo): em pausa, sem as milhas na rota (a rota foi limpa cedo), conta o afastamento real
  // da partida (o cais do destino fica a ~40 MN): chega na mesma
  p = { ...novo(), estado: 'pausado', pausadoDe: 'a navegar', saida: new Date(AGORA).toISOString() }; mem = pa.novaMemoria()
  for (let m = 600; m <= 605; m++) passo(m, aNorte(CAIS, 0.1), 0, 1)
  assert.equal(p.estado, 'chegado')
  // pausado antes de sair: nunca
  p = { ...novo(), estado: 'pausado', pausadoDe: 'a espera de sair' }; mem = pa.novaMemoria()
  for (let m = 600; m <= 610; m++) passo(m, aNorte(CAIS, 0.1), 0)
  assert.equal(p.estado, 'pausado')
})

test('re-revisão I-1 (Ivo): em pausa, o progresso também é o afastamento real da partida (o máximo, guardado no plano): pelo menos min(1 MN, 50 % da distância em linha reta partida → destino)', () => {
  // partida → cais em linha reta 0,4 MN (o limite fica em 0,2 MN), por uma rota com mais de 1 MN (a da rota curta não conta)
  const base = novo()
  const cais = aNorte(PARTIDA, 0.4)
  const pts = [{ lat: PARTIDA.lat, lon: PARTIDA.lon }, c.deslocar(PARTIDA, 90, 0.6), { lat: cais.lat, lon: cais.lon }]
  let p = { ...base, estado: 'a navegar', saida: new Date(AGORA).toISOString(), navegarDesde: new Date(AGORA).toISOString(), alternativa: { ...base.alternativa, pontosRota: pts }, destino: { ...base.destino, aproximacao: [[cais.lat, cais.lon]], cais }, partida: { ...base.partida, lat: PARTIDA.lat, lon: PARTIDA.lon } }
  assert.ok(pa.comprimentoRota(p) >= 1)
  let mem = pa.novaMemoria()
  const passo = (min, posicao, href = null) => { const r = pa.avaliar(p, { ...ler(posicao, 0, href), milhas: 0.1 }, mem, AGORA + min * MIN); p = r.plano; mem = r.mem; return r }
  // a navegar, a 0,15 MN da partida: o afastamento máximo fica no plano
  passo(1, aNorte(PARTIDA, 0.15), HREF)
  assert.equal(Math.round(p.afastamentoMaxMn * 100) / 100, 0.15)
  // a rota limpa: pausado; parado a 0,15 MN da partida (a 0,25 MN do cais): nunca se afastou 0,2 MN, não chega
  assert.equal(passo(2, aNorte(PARTIDA, 0.15)).mudou, 'pausado')
  for (let m = 3; m <= 15; m++) passo(m, aNorte(PARTIDA, 0.15))
  assert.equal(p.estado, 'pausado')
  // foi a 0,25 MN da partida e voltou: já houve progresso real; 5 min parado perto do cais → chegou
  passo(16, aNorte(PARTIDA, 0.25))
  assert.ok(p.afastamentoMaxMn >= 0.25 - 1e-9)
  for (let m = 17; m <= 20; m++) passo(m, aNorte(PARTIDA, 0.15))
  assert.equal(p.estado, 'pausado', '4 min')
  assert.equal(passo(21, aNorte(PARTIDA, 0.15)).mudou, 'chegou')
  // a navegar (na rota), o afastamento não substitui as milhas: só em pausa
  p = { ...p, estado: 'a navegar', pausadoDe: null, chegou: null, fechadoEm: null, afastamentoMaxMn: 5 }; mem = pa.novaMemoria()
  for (let m = 30; m <= 40; m++) passo(m, aNorte(PARTIDA, 0.15), HREF)
  assert.equal(p.estado, 'a navegar')
})

test('decisão 5 (Ivo): em pausa no mar, parado (SOG < 0,5 nó) 30 min a menos de 0,3 MN de OUTRO porto da lista → a sugestão "Chegaste a X?" (só sugere: o plano não muda)', () => {
  const cascais = { lat: 38.6929, lon: -9.4167 }
  const portos = [{ id: 'cascais', nome: 'Cascais', cais: cascais }, { id: 'peniche', nome: 'Peniche', cais: { lat: CAIS.lat, lon: CAIS.lon } }]
  let p = { ...novo(), estado: 'pausado', pausadoDe: 'a navegar', saida: new Date(AGORA).toISOString() }
  let mem = pa.novaMemoria()
  const passo = (min, posicao, sog) => { const r = pa.avaliar(p, { ...ler(posicao, sog, null), milhas: 3 }, mem, AGORA + min * MIN, { portos }); p = r.plano; mem = r.mem; return r }
  for (let m = 100; m <= 129; m++) assert.equal(passo(m, c.deslocar(cascais, 45, 0.29), 0.4).mem.sugestao, null, `${m}`)
  const r = passo(130, c.deslocar(cascais, 45, 0.29), 0.4)
  assert.deepEqual(r.mem.sugestao, { id: 'cascais', nome: 'Cascais', desde: AGORA + 100 * MIN })
  assert.equal(r.mudou, null)
  assert.equal(p.estado, 'pausado')
  // a andar outra vez (0,5 nó): a sugestão sai e a contagem recomeça
  assert.equal(passo(131, c.deslocar(cascais, 45, 0.29), 0.5).mem.sugestao, null)
  // a 0,31 MN, nunca
  mem = pa.novaMemoria()
  for (let m = 200; m <= 240; m++) passo(m, c.deslocar(cascais, 45, 0.31), 0)
  assert.equal(mem.sugestao, null)
  // o destino do plano não é "outro porto" (lá conta a chegada normal, com o progresso)
  mem = pa.novaMemoria()
  for (let m = 250; m <= 290; m++) passo(m, aNorte(CAIS, 0.1), 0)
  assert.equal(mem.sugestao, null)
  // pausado antes de sair (no porto de partida): nunca
  p = { ...novo(), estado: 'pausado', pausadoDe: 'a espera de sair' }; mem = pa.novaMemoria()
  for (let m = 300; m <= 340; m++) passo(m, c.deslocar(cascais, 45, 0.1), 0)
  assert.equal(mem.sugestao, null)
  // fora da pausa (a navegar), também não
  p = { ...novo(), estado: 'a navegar', saida: new Date(AGORA).toISOString() }; mem = pa.novaMemoria()
  for (let m = 400; m <= 440; m++) { const x = pa.avaliar(p, { ...ler(c.deslocar(cascais, 45, 0.1), 0), milhas: 3 }, mem, AGORA + m * MIN, { portos }); p = x.plano; mem = x.mem }
  assert.equal(mem.sugestao, null)
})

test('chegarA: fecha o plano como "chegado" a outro porto (o do botão "cheguei bem a X"), com a hora e o porto', () => {
  const p = { ...novo(), estado: 'pausado', pausadoDe: 'a navegar' }
  const q = pa.chegarA(p, { id: 'cascais', nome: 'Cascais' }, AGORA + 100 * MIN, AGORA + 131 * MIN)
  assert.equal(q.estado, 'chegado')
  assert.equal(q.pausadoDe, null)
  assert.equal(q.chegou, new Date(AGORA + 100 * MIN).toISOString())
  assert.equal(q.fechadoEm, new Date(AGORA + 131 * MIN).toISOString())
  assert.deepEqual(q.chegouA, { id: 'cascais', nome: 'Cascais' })
  assert.ok(!pa.aberto(q))
})

test('decisão 1 (Ivo): os planos substituídos vão para planos-fechados.json, só os 5 mais recentes (o plano-ativo.json não cresce)', () => {
  const dir = pasta()
  assert.deepEqual(pa.lerFechados(dir), [])
  for (let i = 1; i <= 7; i++) pa.arquivar(dir, { ...novo(), idCalculo: `calc-${i}` }, AGORA + i * MIN)
  const l = pa.lerFechados(dir)
  assert.deepEqual(l.map(x => x.idCalculo), ['calc-3', 'calc-4', 'calc-5', 'calc-6', 'calc-7'])
  assert.equal(l.at(-1).arquivadoEm, new Date(AGORA + 7 * MIN).toISOString())
  assert.deepEqual(fs.readdirSync(dir).sort(), ['planos-fechados.json'])
  // um ficheiro estragado recomeça a lista
  fs.writeFileSync(path.join(dir, pa.FECHADOS), '{')
  pa.arquivar(dir, novo(), AGORA)
  assert.equal(pa.lerFechados(dir).length, 1)
})
