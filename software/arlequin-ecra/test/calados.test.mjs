// O "silenciado" que sobrevive ao reinício de um plugin (F3b item 9, nota do SignalK 2.33): ao parar um plugin o
// servidor apaga-lhe os valores e ao arrancar o plugin repõe os alarmes que ainda são verdade — o ecrã vê normal →
// alarme com o estado reposto (sem silenciar) e voltava a apitar o que o Ivo já calara. O ecrã lembra-se, por
// caminho e mensagem, do que viu calado e, se o mesmo alarme volta dentro de uns minutos, fica calado: o alarme
// continua à vista, só não apita. Com o relógio injetado (lib/alarmes.js, reporCalados).
import test from 'node:test'
import assert from 'node:assert/strict'
import { lerFonte, funcao } from './ajuda-fonte.mjs'
import { reporCalados, novaMemoriaCalados, CALADO_VALE_MS, decidirSom, novaMemoriaSom, deveTocar, calado } from '../public/lib/alarmes.js'

const SOM = ['visual', 'sound']
const S = 1000
const T0 = Date.parse('2026-10-03T10:00:00.000Z')
const st = (x = {}) => ({ silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true, canClear: false, ...x })
const UUID = '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e'

// o que o servidor mostra de um alarme: ativo por calar, calado ou, depois de o plugin parar, normal
const ativo = (caminho, message, extra = {}) => ({ caminho, id: UUID, state: 'alarm', method: SOM, apito: 'continuo', message, status: st(), timestamp: '2026-10-03T10:00:00.000Z', ...extra })
const silenciado = (caminho, message, extra = {}) => ativo(caminho, message, { method: ['visual'], status: st({ silenced: true }), ...extra })
const normal = (caminho) => ({ caminho, state: 'normal', method: [], message: 'Normal', timestamp: '2026-10-03T10:01:00.000Z' })

const AIS = 'notifications.arlequin.ais.263000001'
const MSG = 'NORDIC STAR em rota de colisão · CPA 0,3 MN'

// Um ecrã: o store (caminho → notificação), a memória do calado e a do som. `entra(s)` põe no store o que o servidor
// mostra a cada segundo; `ciclo(s)` é o do app.js (reporCalados e depois o som). Devolve o que tocou.
function ecra () {
  const notificacoes = new Map()
  const memoria = novaMemoriaCalados()
  const som = novaMemoriaSom()
  const tocou = []
  return {
    notificacoes,
    memoria,
    poe: (n) => notificacoes.set(n.caminho, n),
    tira: (caminho) => notificacoes.delete(caminho),
    ciclo (s) {
      const agora = T0 + s * S
      reporCalados(notificacoes, memoria, agora)
      const r = decidirSom([...notificacoes.values()], som, agora)
      if (r.continuo) tocou.push([s, 'continuo'])
      for (const c of r.curtos) tocou.push([s, 'curto', c])
      return r
    },
    tocou
  }
}
const correr = (e, de, ate, f) => { for (let s = de; s <= ate; s++) { f?.(s); e.ciclo(s) } }

test('o alarme que o Ivo calou volta calado quando o plugin reinicia (normal → o mesmo alarme, com o estado reposto pelo servidor): não apita de novo, o alarme fica à vista', () => {
  const e = ecra()
  // 0–29 s a apitar; o Ivo cala aos 30 s; o servidor confirma; 30–59 s calado
  correr(e, 0, 59, (s) => e.poe(s < 30 ? ativo(AIS, MSG) : silenciado(AIS, MSG)))
  assert.deepEqual(e.tocou.filter(t => t[1] === 'continuo').map(t => t[0]), Array.from({ length: 30 }, (_, i) => i))
  e.tocou.length = 0
  // o plugin pára aos 60 s (normal), arranca aos 64 s e repõe o alarme com o status reposto (por calar)
  correr(e, 60, 63, () => e.poe(normal(AIS)))
  correr(e, 64, 400, () => e.poe(ativo(AIS, MSG, { timestamp: '2026-10-03T10:01:04.000Z' })))
  assert.deepEqual(e.tocou, [], 'nem um bip')
  const n = e.notificacoes.get(AIS)
  assert.equal(n.state, 'alarm', 'o alarme continua ativo e à vista')
  assert.equal(n.message, MSG)
  assert.equal(deveTocar(n), null)
  assert.equal(n.status.silenced, true)
})

test('o que não foi calado continua a apitar depois do reinício; outra mensagem (o CPA mudou), outro caminho ou uma gravidade maior não herdam o calado', () => {
  // nunca calado: depois do reinício apita (o contínuo)
  const a = ecra()
  correr(a, 0, 20, () => a.poe(ativo(AIS, MSG)))
  correr(a, 21, 23, () => a.poe(normal(AIS)))
  a.tocou.length = 0
  correr(a, 24, 30, () => a.poe(ativo(AIS, MSG)))
  assert.equal(a.tocou.filter(t => t[1] === 'continuo').length, 7)
  // calado, mas volta com outra mensagem
  const b = ecra()
  correr(b, 0, 30, () => b.poe(silenciado(AIS, MSG)))
  correr(b, 31, 33, () => b.poe(normal(AIS)))
  b.tocou.length = 0
  correr(b, 34, 40, () => b.poe(ativo(AIS, 'NORDIC STAR em rota de colisão · CPA 0,2 MN')))
  assert.equal(b.tocou.filter(t => t[1] === 'continuo').length, 7, 'outra mensagem = outro alarme')
  // calado um alarme; outro caminho com a mesma mensagem não é o mesmo
  const c = ecra()
  correr(c, 0, 30, () => c.poe(silenciado(AIS, MSG)))
  correr(c, 31, 33, () => c.poe(normal(AIS)))
  c.tocou.length = 0
  correr(c, 34, 36, () => c.poe(ativo('notifications.arlequin.ais.263000002', MSG)))
  assert.equal(c.tocou.length, 3, 'outro caminho')
  // um aviso calado que volta como alarme (a gravidade subiu: o servidor também repõe o estado): apita
  const d = ecra()
  correr(d, 0, 30, () => d.poe(silenciado(AIS, MSG, { state: 'warn' })))
  correr(d, 31, 33, () => d.poe(normal(AIS)))
  d.tocou.length = 0
  correr(d, 34, 36, () => d.poe(ativo(AIS, MSG, { state: 'alarm' })))
  assert.equal(d.tocou.filter(t => t[1] === 'continuo').length, 3, 'a gravidade subiu')
  // e o contrário (um alarme calado que volta como aviso) fica calado
  const f = ecra()
  correr(f, 0, 30, () => f.poe(silenciado(AIS, MSG, { state: 'alarm' })))
  correr(f, 31, 33, () => f.poe(normal(AIS)))
  f.tocou.length = 0
  correr(f, 34, 40, () => f.poe(ativo(AIS, MSG, { state: 'warn' })))
  assert.deepEqual(f.tocou, [])
})

test('o calado tem prazo: um alarme que falta mais de 3 minutos (passou de verdade, ou a ligação esteve em baixo) e volta é outro alarme e apita', () => {
  assert.equal(CALADO_VALE_MS, 3 * 60 * 1000)
  const volta = (faltaS) => {
    const e = ecra()
    correr(e, 0, 30, () => e.poe(silenciado(AIS, MSG)))
    correr(e, 31, 30 + faltaS, () => e.poe(normal(AIS)))
    e.tocou.length = 0
    correr(e, 31 + faltaS, 40 + faltaS, () => e.poe(ativo(AIS, MSG)))
    return e.tocou.filter(t => t[1] === 'continuo').length
  }
  assert.equal(volta(60), 0, 'um minuto: reinício')
  assert.equal(volta(170), 0, 'quase 3 minutos: ainda reinício')
  assert.equal(volta(181), 10, 'mais de 3 minutos: apita')
  assert.equal(volta(600), 10, '10 minutos: apita')
  // sem ligação ao SignalK o ecrã esquece os alarmes (perderLigacao limpa o store): ao voltar, dentro do prazo, fica calado
  const e = ecra()
  correr(e, 0, 30, () => e.poe(silenciado(AIS, MSG)))
  e.tira(AIS)
  correr(e, 31, 100, () => {})
  correr(e, 101, 120, () => e.poe(ativo(AIS, MSG)))
  assert.deepEqual(e.tocou, [])
  // a memória não cresce para sempre: o que passou do prazo esquece-se
  const g = ecra()
  correr(g, 0, 30, () => g.poe(silenciado(AIS, MSG)))
  assert.equal(g.memoria.size, 1)
  g.tira(AIS)
  correr(g, 31, 30 + 181, () => {})
  assert.equal(g.memoria.size, 0)
})

test('Adenda 2: o fumo (emergência) não herda o calado — reconhecido, se o fumo passar e voltar (ou o plugin reiniciar com fumo) apita contínuo outra vez', () => {
  const FUMO = 'notifications.arlequin.porto.fumo'
  const fumo = (extra = {}) => ({ caminho: FUMO, id: UUID, state: 'emergency', method: SOM, apito: 'continuo', message: 'FUMO a bordo!', status: st(), timestamp: '2026-10-03T10:00:00.000Z', ...extra })
  const reconhecido = fumo({ method: ['visual'], status: st({ acknowledged: true }) })
  const e = ecra()
  correr(e, 0, 30, () => e.poe(reconhecido))
  correr(e, 31, 33, () => e.poe(normal(FUMO)))
  e.tocou.length = 0
  correr(e, 34, 40, () => e.poe(fumo()))
  assert.equal(e.tocou.filter(t => t[1] === 'continuo').length, 7)
  assert.equal(e.memoria.size, 0, 'a emergência não entra na memória')
})

test('um alarme calado só pelo caminho (sem id do servidor, o plugin do porto) também se lembra; o calado local (calado()) conta como calado', () => {
  const PORAO = 'notifications.arlequin.porto.aguaPorao'
  const semId = { caminho: PORAO, state: 'alarm', method: SOM, apito: 'continuo', message: 'Água no porão!', timestamp: '2026-10-03T10:00:00.000Z' }
  const e = ecra()
  correr(e, 0, 10, () => e.poe(semId))
  assert.equal(e.tocou.length, 11)
  // o toque no "silenciar" (app.js): o ecrã põe-no calado já no store (calado(n, acao))
  e.poe(calado(e.notificacoes.get(PORAO), 'silenciar'))
  e.tocou.length = 0
  correr(e, 11, 40, () => {})
  assert.deepEqual(e.tocou, [])
  // o plugin do porto reinicia: normal e o alarme outra vez (sem id, sem status): continua calado
  correr(e, 41, 43, () => e.poe(normal(PORAO)))
  correr(e, 44, 100, () => e.poe({ ...semId, timestamp: '2026-10-03T10:00:44.000Z' }))
  assert.deepEqual(e.tocou, [])
  assert.equal(deveTocar(e.notificacoes.get(PORAO)), null)
  assert.equal(e.notificacoes.get(PORAO).state, 'alarm')
})

test('o app.js repõe o calado antes de decidir o som, a cada ciclo, com a hora do ecrã', () => {
  const app = lerFonte('app.js')
  assert.match(app, /calados:\s*novaMemoriaCalados\(\)/)
  const somDoCiclo = funcao(app, 'function somDoCiclo')
  assert.match(somDoCiclo, /reporCalados\(store\.notificacoes,\s*app\.calados,\s*Date\.now\(\)\)/)
  assert.ok(somDoCiclo.indexOf('reporCalados(') < somDoCiclo.indexOf('tocar('), 'antes de o som decidir')
  const ciclo = funcao(app, 'function ciclo')
  assert.match(ciclo, /tocar:\s*somDoCiclo/)
})
