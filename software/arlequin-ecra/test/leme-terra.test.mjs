// Os contactos em terra no Leme e no Pedir (F3b item 1; o contrato da F2, GET /plugins/signalk-arlequin-rota/plano-ativo):
//   I-01  envio.alarme é a hora de alarme MAIS CEDO que algum contacto ainda à espera tem (decisão n.º 14) e
//         envio.porContacto [{ nome, alarme, fechado }] a de cada um: com horas diferentes, "Pai: alarme HH:MM";
//   K-12  fechoPorEntregar { tipo: 'chegada' | 'terminado', contactos, tentativas, erro }: o «cheguei bem» deste
//         plano ainda por entregar, mesmo com o plano fechado → "o «cheguei bem» ainda não chegou a terra: liga-lhes";
//   I-02  envioEmTerra { idCalculo, indice, contactos, alarme }: terra tem um plano que NÃO é o do plano ativo (também no
//         corpo do 404) → sem plano ativo, "Os contactos em terra têm um plano com alarme HH:MM e não há plano ativo:
//         ativa-o ou avisa-os"; com outro plano ativo, "…têm o plano de outra alternativa, com alarme HH:MM: avisa-os";
//   D19   relogioDesacertadoS (também no 404): "Relógio do Pi desacertado N min da hora do GPS: …";
//   I-05  desistencias [{ tipo, ref, contactos, em, alarme }]: "Pai não recebeu o «cheguei bem»: liga-lhe".
// Sem browser (como o navegar.test.mjs), de dia e de noite, sem null/NaN/undefined.
import test from 'node:test'
import assert from 'node:assert/strict'
import melhor from '../public/paginas/melhor.js'
import { buscarPlanoAtivo } from '../public/paginas/melhor/navegar.js'
import { lerFonte } from './ajuda-fonte.mjs'

const AGORA = Date.parse('2026-09-29T14:32:00Z') // 15:32 em Lisboa
const MIN = 60000
const H = 3600000
const iso = (t) => new Date(t).toISOString()
const ROTA = '/plugins/signalk-arlequin-rota'
const proibido = /null|NaN|undefined|\[object/
const limpo = (html, nome) => assert.doesNotMatch(html, proibido, `${nome}: ${html.match(/.{60}(null|NaN|undefined).{20}/)?.[0]}`)
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ROTA_ATIVA = { 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 1, 'navigation.course.nextPoint': { name: 'WP3' }, 'navigation.headingTrue': 1, 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche' } }

// o GET /plano-ativo a navegar com os campos da F2
const ALARME_PAI = iso(AGORA + 3 * H) // 18:32
const ALARME_MAE = iso(AGORA + 5 * H) // 20:32
const PLANO = {
  estado: 'a navegar', pausadoDe: null, agora: iso(AGORA), ativadoEm: iso(AGORA - 4 * H), chegadaOutro: null,
  destino: { id: 'peniche', nome: 'Peniche', lat: 39.3522, lon: -9.376 }, tripulacao: 'so', idCalculo: 'calc-1', indice: 0,
  alternativa: { id: 'x', nome: 'Agora, 5 MN, só motor' }, partida: iso(AGORA - 3 * H), saida: iso(AGORA - 3 * H + 20 * MIN), chegou: null, atrasoMin: 20,
  proximo: { texto: 'rizar', hora: iso(AGORA + 25 * MIN) }, chegadaAgora: iso(AGORA + 8 * H), chegadaPlano: iso(AGORA + 7.6 * H), chegadaNoite: true,
  recursos: { gasoleoChegadaL: 34, bateriaChegadaPct: 70, semLeitura: false, aviso: null }, semGps: false, barometro: { semLeitura: false, quedaHpa: 1.2 }, previsaoIdadeH: 2,
  avisos: [], envio: { contactos: ['Pai', 'Mãe'], alarme: ALARME_PAI, alarmePlano: ALARME_MAE, porContacto: [{ nome: 'Pai', alarme: ALARME_PAI, fechado: false }, { nome: 'Mãe', alarme: ALARME_MAE, fechado: false }] },
  atrasoRetido: null, fechoPorEntregar: null, relogioDesacertadoS: null, envioEmTerra: null, filaContactos: [], enviadas: [], desistencias: []
}
const FECHADO = { ...PLANO, estado: 'chegado', chegou: iso(AGORA - 10 * MIN), proximo: null, chegadaAgora: null, chegadaPlano: null, atrasoMin: null }
const EM_TERRA = { idCalculo: 'calc-0', indice: 1, contactos: ['Mãe'], alarme: iso(AGORA + 6 * H) } // 21:32

function contexto ({ valores = ROTA_ATIVA, respostas = {}, estado = {}, noite = false } = {}) {
  const pedidos = []
  return {
    v: (p) => ({ 'navigation.position': { latitude: 38.9, longitude: -9.6 }, ...valores })[p],
    idade: () => 0,
    polar: null,
    estado,
    noite,
    agora: AGORA,
    pedidos,
    agendar: () => {},
    guardado: (k, def) => def,
    guardar: () => {},
    refrescar: () => {},
    pedir: async (url, o = {}) => {
      const chave = `${o.method || 'GET'} ${url}`
      pedidos.push({ url, method: o.method || 'GET', body: o.body })
      let r = respostas[chave]
      if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0]
      if (r instanceof Error) throw r
      if (r === undefined) throw Object.assign(new Error('404'), { status: 404 })
      return structuredClone(r)
    }
  }
}
// o 404 do plugin sem plano ativo, com o corpo que a F2 lhe pôs ({ ok: false, erro, envioEmTerra, relogioDesacertadoS })
const sem404 = (extra = {}) => Object.assign(new Error('não há plano ativo'), { status: 404, corpo: { ok: false, erro: 'não há plano ativo', envioEmTerra: null, relogioDesacertadoS: null, ...extra } })
const esperar = () => new Promise(resolve => setTimeout(resolve, 0))
// a página (Melhor rota) depois do GET /plano-ativo; plano = um objeto (200) ou um erro (404)
async function pagina (plano, { valores = ROTA_ATIVA, noite = false, estado = {} } = {}) {
  const ctx = contexto({ valores, noite, estado: { destinos: [], destinosEm: AGORA, ...estado }, respostas: { [`GET ${ROTA}/plano-ativo`]: plano, [`GET ${ROTA}/destinos`]: { destinos: [] } } })
  melhor.render(ctx)
  await esperar()
  return ctx
}
const render = (ctx) => melhor.render(ctx)

// ---------- I-01: a hora de alarme de cada contacto ----------
test('I-01: a faixa mostra a hora de alarme MAIS CEDO que terra tem (envio.alarme) e, com horas diferentes por contacto, a de cada um — "Pai: alarme 18:32 · Mãe: alarme 20:32"; um contacto que já recebeu o "cheguei bem" já não conta', async () => {
  for (const noite of [false, true]) {
    const html = render(await pagina(PLANO, { noite }))
    limpo(html, 'por contacto')
    const t = texto(html)
    assert.ok(t.includes('contactos em terra: alarme 18:32'), t)
    assert.ok(t.includes('Pai: alarme 18:32 · Mãe: alarme 20:32'), t)
    assert.doesNotMatch(t, /alarme 20:32 ·|contactos em terra: alarme 20:32/, 'a mais tarde não é a da faixa')
  }
  // as horas iguais: uma só linha
  const iguais = { ...PLANO, envio: { ...PLANO.envio, alarmePlano: ALARME_PAI, porContacto: [{ nome: 'Pai', alarme: ALARME_PAI, fechado: false }, { nome: 'Mãe', alarme: ALARME_PAI, fechado: false }] } }
  const t1 = texto(render(await pagina(iguais)))
  assert.ok(t1.includes('contactos em terra: alarme 18:32'))
  assert.doesNotMatch(t1, /Pai: alarme|Mãe: alarme/)
  // o Pai já recebeu: fica só a hora da Mãe e nada a comparar
  const fechado = { ...PLANO, envio: { contactos: ['Pai', 'Mãe'], alarme: ALARME_MAE, alarmePlano: ALARME_MAE, porContacto: [{ nome: 'Pai', alarme: ALARME_PAI, fechado: true }, { nome: 'Mãe', alarme: ALARME_MAE, fechado: false }] } }
  const t2 = texto(render(await pagina(fechado)))
  assert.ok(t2.includes('contactos em terra: alarme 20:32'))
  assert.doesNotMatch(t2, /Pai: alarme|Mãe: alarme/)
  // um plugin de antes da F2 (sem porContacto): a faixa de sempre
  const antigo = { ...PLANO, envio: { contactos: ['Pai'], alarme: ALARME_PAI } }
  const t3 = texto(render(await pagina(antigo)))
  assert.ok(t3.includes('contactos em terra: alarme 18:32'))
  limpo(render(await pagina(antigo)), 'plugin antigo')
  // o nome do contacto passa pelo esc
  const html4 = render(await pagina({ ...PLANO, envio: { ...PLANO.envio, porContacto: [{ nome: '<b>Pai</b>', alarme: ALARME_PAI, fechado: false }, { nome: 'Mãe', alarme: ALARME_MAE, fechado: false }] } }))
  assert.match(html4, /&lt;b&gt;Pai&lt;\/b&gt;: alarme 18:32/)
  assert.doesNotMatch(html4, /<b>Pai<\/b>/)
  // em pausa, a caixa da pausa também
  const pausa = texto(render(await pagina({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar' })))
  assert.ok(pausa.includes('contactos em terra: alarme 18:32') && pausa.includes('Pai: alarme 18:32 · Mãe: alarme 20:32'), pausa)
})

// ---------- K-12: o "cheguei bem" por entregar com o plano fechado ----------
test('K-12: com o plano fechado (chegado, terminado) e o "cheguei bem" ou a "viagem terminada" por entregar (fechoPorEntregar), o ecrã diz "o «cheguei bem» ainda não chegou a terra: liga-lhes" — no Leme (com rota ativa) e no Pedir (sem ela); de dia e de noite', async () => {
  const fecho = (tipo) => ({ tipo, contactos: ['Pai', 'Mãe'], tentativas: 3, erro: 'sem rede' })
  for (const noite of [false, true]) {
    for (const [estado, tipo, frase] of [['chegado', 'chegada', 'o «cheguei bem» ainda não chegou a terra: liga-lhes'], ['terminado', 'terminado', 'a «viagem terminada» ainda não chegou a terra: liga-lhes']]) {
      const plano = { ...FECHADO, estado, fechoPorEntregar: fecho(tipo) }
      for (const [onde, valores] of [['Leme', ROTA_ATIVA], ['Pedir', {}]]) {
        const html = render(await pagina(plano, { valores, noite }))
        limpo(html, `${onde} ${estado}`)
        const t = texto(html)
        assert.ok(t.includes(frase), `${onde} ${estado}: ${t}`)
        assert.ok(t.includes('(Pai, Mãe)'), 'os contactos a quem ligar')
        assert.match(html, /class="[^"]*avisos-terra/, 'num mosaico à parte')
        assert.doesNotMatch(t, /sem rede/, 'o erro técnico não vai para o ecrã')
      }
    }
  }
  // entregue (null): nada
  for (const valores of [ROTA_ATIVA, {}]) assert.doesNotMatch(texto(render(await pagina({ ...FECHADO, fechoPorEntregar: null }, { valores }))), /ainda não chegou a terra/)
  // um contacto só
  assert.ok(texto(render(await pagina({ ...FECHADO, fechoPorEntregar: { tipo: 'chegada', contactos: ['Pai'], tentativas: 1, erro: null } }, { valores: {} }))).includes('liga-lhes (Pai)'))
})

// ---------- I-02: o plano enviado e nunca ativado ----------
test('I-02: terra tem um plano e não há plano ativo (o 404 traz envioEmTerra) → "Os contactos em terra têm um plano com alarme 21:32 e não há plano ativo: ativa-o ou avisa-os" no Pedir e no Leme (rota ativa à mão)', async () => {
  for (const noite of [false, true]) {
    for (const valores of [{}, ROTA_ATIVA]) {
      const html = render(await pagina(sem404({ envioEmTerra: EM_TERRA }), { valores, noite }))
      limpo(html, 'sem plano')
      assert.ok(texto(html).includes('Os contactos em terra têm um plano com alarme 21:32 e não há plano ativo: ativa-o ou avisa-os'), texto(html))
      assert.match(html, /class="[^"]*avisos-terra/)
    }
  }
  // o plano fechado também deixa terra com um plano que não é o ativo (o 200 traz envioEmTerra)
  const fechado = render(await pagina({ ...FECHADO, envioEmTerra: EM_TERRA }, { valores: {} }))
  assert.ok(texto(fechado).includes('Os contactos em terra têm um plano com alarme 21:32 e não há plano ativo: ativa-o ou avisa-os'))
  // sem envioEmTerra no 404 (ou um 404 antigo, sem corpo): nada
  assert.doesNotMatch(texto(render(await pagina(sem404(), { valores: {} }))), /não há plano ativo/)
  const antigo = Object.assign(new Error('404'), { status: 404 })
  assert.doesNotMatch(texto(render(await pagina(antigo, { valores: {} }))), /Os contactos em terra/)
})

test('I-02: com outro plano ativo, "Os contactos em terra têm o plano de outra alternativa, com alarme 21:32: avisa-os" (o envioEmTerra do 200 com o plano aberto)', async () => {
  for (const noite of [false, true]) {
    const html = render(await pagina({ ...PLANO, envioEmTerra: EM_TERRA }, { noite }))
    limpo(html, 'outra alternativa')
    const t = texto(html)
    assert.ok(t.includes('Os contactos em terra têm o plano de outra alternativa, com alarme 21:32: avisa-os'), t)
    assert.doesNotMatch(t, /não há plano ativo/)
  }
  // em pausa também
  assert.ok(texto(render(await pagina({ ...PLANO, estado: 'pausado', pausadoDe: 'a navegar', envioEmTerra: EM_TERRA }))).includes('têm o plano de outra alternativa, com alarme 21:32: avisa-os'))
  // sem o campo (envioEmTerra null): nada
  assert.doesNotMatch(texto(render(await pagina(PLANO))), /outra alternativa/)
})

// ---------- decisão n.º 19: o relógio do Pi ----------
test('decisão n.º 19: com o relógio do Pi desacertado do GPS (relogioDesacertadoS, também no 404) o ecrã diz "Relógio do Pi desacertado 3 min da hora do GPS: … acerta a hora do Pi"', async () => {
  const frase = (s) => `Relógio do Pi desacertado ${s} da hora do GPS: o acompanhamento e as mensagens para terra estão parados — acerta a hora do Pi`
  for (const noite of [false, true]) {
    // a navegar (200), adiantado (+) ou atrasado (−)
    for (const [s, dur] of [[180, '3 min'], [-300, '5 min'], [90, '90 s'], [3600, '60 min']]) {
      const html = render(await pagina({ ...PLANO, relogioDesacertadoS: s }, { noite }))
      limpo(html, `relógio ${s}`)
      assert.ok(texto(html).includes(frase(dur)), `${s}: ${texto(html)}`)
    }
    // sem plano (404) no Pedir e no Leme
    for (const valores of [{}, ROTA_ATIVA]) {
      const html = render(await pagina(sem404({ relogioDesacertadoS: 240 }), { valores, noite }))
      assert.ok(texto(html).includes(frase('4 min')), texto(html))
      assert.match(html, /class="[^"]*perigo[^"]*"[^>]*>⚠ Relógio do Pi/, 'a vermelho')
    }
  }
  // o relógio certo (null): nada
  assert.doesNotMatch(texto(render(await pagina(PLANO))), /Relógio do Pi/)
  assert.doesNotMatch(texto(render(await pagina(sem404(), { valores: {} }))), /Relógio do Pi/)
})

// ---------- I-05: desistir de entregar a quem nunca recebe ----------
test('I-05: o que o plugin desistiu de entregar — "Pai não recebeu o «cheguei bem»: liga-lhe"; vários contactos no plural; a «viagem terminada», o atraso e o plano; o aviso ao Ivo (contactos []) não se mostra; só as das últimas 24 h', async () => {
  const d = (tipo, contactos, atras = 10 * MIN) => ({ tipo, ref: 'A3', contactos, em: iso(AGORA - atras), alarme: iso(AGORA + 2 * H) })
  for (const noite of [false, true]) {
    const html = render(await pagina({ ...FECHADO, desistencias: [d('chegada', ['Pai'])] }, { valores: {}, noite }))
    limpo(html, 'desistência')
    const t = texto(html)
    assert.ok(t.includes('Pai não recebeu o «cheguei bem»: liga-lhe'), t)
    assert.match(html, /class="[^"]*avisos-terra/)
  }
  const varias = texto(render(await pagina({ ...PLANO, desistencias: [d('chegada', ['Pai', 'Mãe']), d('terminado', ['Tio']), d('atraso', ['Mãe']), d('plano', ['Avó']), d('aviso', [])] })))
  assert.ok(varias.includes('Pai e Mãe não receberam o «cheguei bem»: liga-lhes'), varias)
  assert.ok(varias.includes('Tio não recebeu a «viagem terminada»: liga-lhe'), varias)
  assert.ok(varias.includes('Mãe não recebeu a nova hora de alarme (o atraso): liga-lhe'), varias)
  assert.ok(varias.includes('Avó não recebeu o plano: liga-lhe'), varias)
  assert.doesNotMatch(varias, /aviso ao|Telegram/)
  // duas desistências do mesmo tipo juntam-se, sem repetir nomes
  const juntas = texto(render(await pagina({ ...FECHADO, desistencias: [d('chegada', ['Pai']), d('chegada', ['Pai', 'Mãe'])] }, { valores: {} })))
  assert.equal((juntas.match(/não receberam o «cheguei bem»/g) || []).length, 1)
  assert.ok(juntas.includes('Pai e Mãe não receberam o «cheguei bem»: liga-lhes'), juntas)
  // com mais de 24 h já não se mostra; sem desistências, nada
  assert.doesNotMatch(texto(render(await pagina({ ...FECHADO, desistencias: [d('chegada', ['Pai'], 25 * H)] }, { valores: {} }))), /não recebeu/)
  assert.doesNotMatch(texto(render(await pagina({ ...FECHADO, desistencias: [] }, { valores: {} }))), /não recebeu/)
  // os nomes passam pelo esc
  assert.match(render(await pagina({ ...FECHADO, desistencias: [d('chegada', ['<i>Pai</i>'])] }, { valores: {} })), /&lt;i&gt;Pai&lt;\/i&gt; não recebeu/)
})

// ---------- tudo junto, e o 404 guardado ----------
test('o GET /plano-ativo guarda o corpo do 404 (envioEmTerra, relogioDesacertadoS) e larga-o quando há plano; sem plano o que fica é o do 404', async () => {
  const ctx = contexto({ respostas: { [`GET ${ROTA}/plano-ativo`]: [sem404({ envioEmTerra: EM_TERRA, relogioDesacertadoS: 120 }), PLANO, sem404()] } })
  await buscarPlanoAtivo(ctx, true)
  assert.equal(ctx.estado.planoAtivo, null)
  assert.deepEqual(ctx.estado.semPlano, { ok: false, erro: 'não há plano ativo', envioEmTerra: EM_TERRA, relogioDesacertadoS: 120 })
  await buscarPlanoAtivo(ctx, true)
  assert.equal(ctx.estado.planoAtivo.estado, 'a navegar')
  assert.equal(ctx.estado.semPlano, null)
  await buscarPlanoAtivo(ctx, true)
  assert.equal(ctx.estado.planoAtivo, null)
  assert.equal(ctx.estado.semPlano.envioEmTerra, null)
  // um erro que não é 404 (o plugin a reiniciar): fica o que se leu, com o aviso de que pode estar velho
  const c2 = contexto({ respostas: { [`GET ${ROTA}/plano-ativo`]: [sem404({ envioEmTerra: EM_TERRA }), Object.assign(new Error('o plugin da rota não está ligado'), { status: 503 })] } })
  await buscarPlanoAtivo(c2, true)
  await buscarPlanoAtivo(c2, true)
  assert.equal(c2.estado.semPlano.envioEmTerra.alarme, EM_TERRA.alarme)
  assert.equal(c2.estado.semLigacao, true)
})

test('o pior caso do Leme — a navegar com tudo ao mesmo tempo (horas por contacto, um atraso retido, o parcial na fila, o relógio, terra com outro plano, uma desistência e 6 avisos): tudo o que a F2 manda aparece, sem null/NaN, a faixa e o mosaico de terra separados', async () => {
  const cheio = {
    ...PLANO, relogioDesacertadoS: 240, envioEmTerra: EM_TERRA,
    atrasoRetido: { motivo: 'parado', alarme: ALARME_PAI },
    filaContactos: [{ tipo: 'atraso', criada: PLANO.ativadoEm, tentativas: 1, proxima: PLANO.ativadoEm, estado: 'fila', erro: 'Pai: bloqueou o bot', contactos: ['Pai'], parcial: true }],
    desistencias: [{ tipo: 'chegada', ref: 'A1', contactos: ['Tio'], em: iso(AGORA - 5 * MIN), alarme: null }],
    avisos: [{ caminho: 'notifications.rota.relogio', state: 'warn', message: 'Relógio do Pi desacertado 4 min da hora do GPS' }, { caminho: 'notifications.rota.alarmeTerra', state: 'alert', message: 'Os contactos em terra têm o plano de outra alternativa, com alarme 21:32: avisa-os' }]
  }
  for (const noite of [false, true]) {
    const html = render(await pagina(cheio, { noite }))
    limpo(html, 'pior caso')
    const t = texto(html)
    for (const parte of ['contactos em terra: alarme 18:32', 'Pai: alarme 18:32 · Mãe: alarme 20:32', 'não chegou a Pai (a tentar outra vez)', 'A hora de alarme em terra é 18:32 e não foi adiada', 'Relógio do Pi desacertado 4 min da hora do GPS', 'Os contactos em terra têm o plano de outra alternativa, com alarme 21:32: avisa-os', 'Tio não recebeu o «cheguei bem»: liga-lhe']) assert.ok(t.includes(parte), `falta "${parte}" em ${t}`)
    assert.match(html, /data-acao="rota-estou-bem"/)
    assert.match(html, /Rumo a seguir/)
  }
})

test('o código: o mosaico de terra está no Leme e no Pedir e usa o esc; a hora é a do plugin', () => {
  const terra = lerFonte('paginas/melhor/terra.js')
  assert.match(terra, /esc\(/)
  assert.match(terra, /horaLisboa\(/)
  assert.match(lerFonte('paginas/melhor/leme.js'), /avisosTerra\(ctx\)/)
  assert.match(lerFonte('paginas/melhor/pedir.js'), /avisosTerra\(ctx\)/)
})
