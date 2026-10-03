// As páginas e os estados que o verificar-ecra desenha (com os módulos e o estilo verdadeiros do ecrã) para
// medir no Chromium a 1024×600: a barra de cima com várias combinações de chips, o Motor com 0 a 6 alarmes,
// o Leme com os avisos da rota, a Melhor rota (Pedir, A calcular, Resultado e Mapa com as três fixtures e o
// plano aberto), a AIS com muitos alvos, o Diário com um dia cheio e as outras páginas; de dia e de noite.
// Cada estado: { nome, barra (HTML da barra), pagina (HTML da página), noite }.

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { criarStore, aplicarDelta } from '../public/signalk.js'
import { lerPolar } from '../public/lib/polar.js'
import { novaViagem } from '../public/lib/viagem.js'
import { barraHtml } from '../public/lib/barra.js'
import * as alarmes from '../public/lib/alarmes.js'
import { chipSemSom } from '../public/lib/som.js'
import { alvosAis } from '../public/lib/ais.js'
import motor from '../public/paginas/motor.js'
import melhor from '../public/paginas/melhor.js'
import ais from '../public/paginas/ais.js'
import carta from '../public/paginas/carta.js'
import diario from '../public/paginas/diario.js'
import viagem from '../public/paginas/viagem.js'
import velas from '../public/paginas/velas.js'
import instr from '../public/paginas/instr.js'

const require = createRequire(import.meta.url)
const { criarNavegacao, avancarNav } = require('../../arlequin-simulador/lib/navegacao.js')
const DESTINOS = require('../../signalk-arlequin-rota/dados/destinos.json')
const polar = lerPolar(readFileSync(new URL('../public/polar-arlequin.csv', import.meta.url), 'utf8'))
const fixture = (nome) => JSON.parse(gunzipSync(readFileSync(new URL(`../test/fixtures/resultado-${nome}.json.gz`, import.meta.url))))

// o alarme da barra: o do app.js (alarmeDaBarra; antes desta revisão, o maisGrave)
const daBarra = alarmes.alarmeDaBarra || alarmes.maisGrave

function storeSimulado (segundos) {
  const store = criarStore()
  store.selfContext = 'vessels.urn:mrn:signalk:uuid:arlequin'
  let e = criarNavegacao({}, Date.now() - segundos * 1000)
  for (let s = 0; s < segundos; s++) { const r = avancarNav(e, 1000); e = r.estado; for (const d of r.deltas) aplicarDelta(store, d) }
  return store
}

function contexto (store, estado = {}, extra = {}) {
  const v = (p) => store.self.get(p)?.value
  const eu = { position: v('navigation.position'), cog: v('navigation.courseOverGroundTrue'), sog: v('navigation.speedOverGround') }
  const notificacoes = [...store.notificacoes.values()]
  return {
    v,
    idade: () => 0,
    store,
    polar,
    baro: { sentido: 'desce', hpa3h: -2.4 },
    viagem: { ...novaViagem(Date.now() - 3600e3), ultimo: Date.now(), distancia: 9260, tempoVela: 3000, tempoMotor: 600, gasoleoL: 0.2, ventoMax: 8, pressaoInicial: 101600, pressaoFinal: 101520 },
    alvos: alvosAis({ vessels: store.vessels.values(), eu, notificacoes, agora: Date.now() }),
    notificacoes,
    estado,
    demo: false,
    noite: false,
    pedir: () => new Promise(() => {}),
    logbook: async () => {},
    refrescar: () => {},
    guardado: () => null,
    guardar: () => {},
    ...extra
  }
}

const SOM = ['visual', 'sound']
const doServidor = (caminho, valor, status = {}) => ({ caminho, id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', timestamp: new Date().toISOString(), ...valor, status: { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true, ...status } })
const barra = ({ som = 'running', falhas = [], lista = [], ligado = true, calarFalha = null } = {}) => barraHtml({
  agora: Date.now(), gps: true, pressao: 101600, tendencia: { sentido: 'desce' }, somHtml: chipSemSom({ state: som }),
  alarmeHtml: alarmes.chipAlarme(daBarra(lista), lista), calarFalha, piloto: 'standby', ligado, falhas
})

// os alarmes da barra: as formas dos plugins (contrato C1) com o id e o status do servidor
const AIS_NORMAL = doServidor('notifications.arlequin.ais.263000001', { state: 'alarm', method: SOM, apito: 'continuo', message: 'NORDIC STAR em rota de colisão · CPA 0,1 MN' })
const AIS_LONGO = doServidor('notifications.arlequin.ais.263000001', { state: 'alarm', method: SOM, apito: 'continuo', message: 'MSC FANTASIA GRANDE a 0,4 MN e a aproximar-se · sem rumo de nenhum dos dois' })
// 60 letras (o pedido da revisão: falha + "SEM SOM" + uma mensagem de 60 letras)
const MSG_60 = 'Possível fuga de gasóleo: −6,0 L em 2 h com o motor parado!!'
const FUGA_60 = doServidor('notifications.tanks.fuel.0.fuga', { state: 'alarm', method: SOM, apito: 'continuo', message: MSG_60 })
const FUGA = doServidor('notifications.tanks.fuel.0.fuga', { state: 'alarm', method: SOM, apito: 'continuo', message: 'Possível fuga de gasóleo: −6,0 L com o motor parado' })
const TERRA = doServidor('notifications.rota.alarmeTerra', { state: 'alert', method: SOM, apito: 'curto', message: 'Os contactos em terra ligam ao MRCC às 14:59: avisa-os ou Terminar' })
const FUMO = doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: SOM, apito: 'continuo', message: 'FUMO a bordo!' })
const FUMO_RECONHECIDO = doServidor('notifications.arlequin.porto.fumo', { state: 'emergency', method: ['visual'], apito: 'continuo', message: 'FUMO a bordo!' }, { acknowledged: true })
const PORAO = { ...doServidor('notifications.arlequin.porto.aguaPorao', { state: 'alarm', method: SOM, apito: 'continuo', message: 'Água no porão!' }), id: '1c7f4d3f-2e3b-4d66-8e2f-7b2a3c4d5e6f' }
// o "o barco saiu do lugar" do porto (apito curto, acao: 'largar': o botão "Larguei (sou eu)", contrato C10)
const DERIVA = doServidor('notifications.arlequin.porto.deriva', { state: 'alarm', method: SOM, apito: 'curto', acao: 'largar', message: 'O barco saiu do lugar: está a 45 m do ponto de amarração' })
const DERIVA_LONGO = doServidor('notifications.arlequin.porto.deriva', { state: 'alarm', method: SOM, apito: 'curto', acao: 'largar', message: 'O barco saiu do lugar: está a 1234 m do ponto de amarração (a garrar?)' })
const PORAO_SEM_ID = { caminho: 'notifications.arlequin.porto.aguaPorao', state: 'alarm', method: SOM, apito: 'continuo', message: 'Água no porão!', timestamp: new Date().toISOString() }

const vazio = '<div class="col"><div class="tile">(página de teste da barra)</div></div>'

export function estados () {
  const out = []
  const junta = (nome, b, pagina, o = {}) => out.push({ nome, barra: b, pagina, noite: !!o.noite })

  // ---------- a barra de cima ----------
  junta('barra-ais', barra({ lista: [AIS_NORMAL] }), vazio)
  junta('barra-ais-longo', barra({ lista: [AIS_LONGO] }), vazio)
  junta('barra-semsom-ais-longo', barra({ som: 'suspended', lista: [AIS_LONGO] }), vazio)
  junta('barra-falha-fuga', barra({ falhas: ['OpenCPN: as janelas não mudaram'], lista: [FUGA] }), vazio)
  junta('barra-falha-semsom-60letras', barra({ som: 'suspended', falhas: ['OpenCPN: as janelas não mudaram'], lista: [FUGA_60] }), vazio)
  junta('barra-falha-semsom-60letras-noite', barra({ som: 'suspended', falhas: ['OpenCPN: as janelas não mudaram'], lista: [FUGA_60] }), vazio, { noite: true })
  junta('barra-falha-terra', barra({ falhas: ['OpenCPN: o modo noite não mudou'], lista: [TERRA] }), vazio)
  junta('barra-falhaCalar-ais', barra({ falhas: [null, 'não silenciou: um alarme de emergência não se silencia: só se reconhece'], lista: [AIS_NORMAL] }), vazio)
  junta('barra-pior-caso', barra({ som: 'suspended', falhas: ['OpenCPN: o modo noite não mudou', 'não silenciou: sem ligação ao SignalK'], lista: [FUMO], ligado: false }), vazio)
  junta('barra-fumo-reconhecido-porao', barra({ lista: [FUMO_RECONHECIDO, PORAO] }), vazio)
  junta('barra-fumo-reconhecido-porao-sem-id', barra({ lista: [FUMO_RECONHECIDO, PORAO_SEM_ID] }), vazio)
  // o "Larguei (sou eu)" ao lado do calar (contrato C10): sempre à vista, também com o pior caso da barra
  junta('barra-larguei', barra({ lista: [DERIVA] }), vazio)
  junta('barra-larguei-noite', barra({ lista: [DERIVA] }), vazio, { noite: true })
  junta('barra-larguei-falha-semsom', barra({ som: 'suspended', falhas: ['OpenCPN: as janelas não mudaram'], lista: [DERIVA_LONGO] }), vazio)
  junta('barra-larguei-pior-caso', barra({ som: 'suspended', falhas: ['OpenCPN: o modo noite não mudou'], lista: [DERIVA_LONGO], ligado: false, calarFalha: 'não larguei: o plugin porto não está ligado' }), vazio)
  junta('barra-larguei-pior-caso-noite', barra({ som: 'suspended', falhas: ['OpenCPN: o modo noite não mudou'], lista: [DERIVA_LONGO], ligado: false, calarFalha: 'não larguei: o plugin porto não está ligado' }), vazio, { noite: true })
  junta('barra-fumo-reconhecido-ais', barra({ falhas: ['OpenCPN: as janelas não mudaram'], som: 'suspended', lista: [FUMO_RECONHECIDO, AIS_LONGO] }), vazio)

  // ---------- Motor: o pior caso realista (4 cargas, a tabela do gasóleo, 2 depósitos com sensor) ----------
  const stm = storeSimulado(60)
  aplicarDelta(stm, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'tanks.freshWater.0.name', value: 'Cozinha (BB)' }, { path: 'tanks.freshWater.0.currentVolume', value: 0.04 }, { path: 'tanks.freshWater.0.currentLevel', value: 0.5 },
    { path: 'tanks.freshWater.1.name', value: 'WC (EB)' }, { path: 'tanks.freshWater.1.currentVolume', value: 0.06 }, { path: 'tanks.freshWater.1.currentLevel', value: 0.75 },
    { path: 'tanks.fuel.0.currentLevel', value: 0.5 }, { path: 'tanks.fuel.0.capacity', value: 0.2 }
  ] }] })
  // pela ordem de chegada; a fuga (apito contínuo) é a 5.ª
  const alarmesMotor = [
    ['notifications.propulsion.main.alternadorNaoCarrega', 'warn', 'Alternador a 12,4 V — não está a carregar'],
    ['notifications.arlequin.energia.ligarMotor', 'alert', 'Bateria de serviço a 52 %: liga o motor'],
    ['notifications.tanks.fuel.0.consumoAnormal', 'warn', 'Gastou 6,0 L em vez de ~2,0 L: possível fuga ou avaria no motor'],
    ['notifications.arlequin.energia.motorFraca', 'alarm', 'Bateria do motor fraca: 11,9 V'],
    ['notifications.tanks.fuel.0.fuga', 'alarm', 'Possível fuga de gasóleo: −6,0 L com o motor parado'],
    ['notifications.tanks.freshWater.0.baixo', 'warn', 'Água a acabar: Cozinha (BB) com 9 L']
  ]
  const estadoMotor = (extra = {}) => ({
    sessoes: [0, 1, 2, 3].map(i => ({ inicio: new Date(Date.now() - (i + 1) * 86400e3).toISOString(), duracaoMin: 95, ah: 42.5, socInicial: 0.55, socFinal: 0.81 })), sessoesEm: Date.now(),
    gas: { tabela: [{ litros: 0, razao: 0.1 }, { litros: 100, razao: 0.5 }, { litros: 200, razao: 0.9 }], ultimaSessao: { medido: 6.2, esperado: 6.0 } }, gasEm: Date.now(),
    curva: { faixas: [{ de: 1600, lmn: 0.31 }, { de: 1800, lmn: 0.28 }, { de: 2000, lmn: 0.3 }, { de: 2200, lmn: 0.36 }], melhor: { de: 1800 } }, curvaEm: Date.now(),
    agua: { tanques: [{ id: 0, nome: 'Cozinha (BB)', ritmo: { dias: 4.2 }, semSensor: false, nivelConhecido: true }, { id: 1, nome: 'WC (EB)', ritmo: { dias: 6.1 }, semSensor: false, nivelConhecido: true }] }, aguaEm: Date.now(),
    ...extra
  })
  for (const n of [0, 3, 4, 6]) {
    const ctx = contexto(stm, estadoMotor())
    ctx.notificacoes = alarmesMotor.slice(0, n).map(([c, s, m]) => doServidor(c, { state: s, method: SOM, message: m, ...(c.endsWith('fuga') ? { apito: 'continuo' } : {}) }))
    junta(`motor-${n}-alarmes`, barra({ lista: ctx.notificacoes }), motor.render(ctx))
  }
  {
    const ctx = contexto(stm, estadoMotor({ msgGas: 'Abastecimento registado: 40 → 125 L', msgGasErro: false, confirmarEncher: 0 }))
    ctx.notificacoes = alarmesMotor.map(([c, s, m]) => doServidor(c, { state: s, method: SOM, message: m }))
    junta('motor-6-alarmes-encher', barra({ lista: ctx.notificacoes }), motor.render(ctx))
    junta('motor-6-alarmes-noite', barra({ lista: ctx.notificacoes }), motor.render(ctx), { noite: true })
  }
  // a água sem nível (revisão F3, Minor 8): com sensor mas sem o 1.º "Enchi" ("nível por confirmar: carrega Enchi", a
  // frase mais comprida da linha do depósito) e sem sensor; o pior caso de alarmes por cima e a pergunta do Enchi
  const stag = storeSimulado(60)
  aplicarDelta(stag, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'tanks.freshWater.0.name', value: 'Cozinha (BB)' }, { path: 'tanks.freshWater.0.currentVolume', value: null }, { path: 'tanks.freshWater.0.currentLevel', value: null },
    { path: 'tanks.freshWater.1.name', value: 'WC (EB)' }, { path: 'tanks.freshWater.1.currentVolume', value: null }, { path: 'tanks.freshWater.1.currentLevel', value: null },
    { path: 'tanks.fuel.0.currentLevel', value: 0.5 }, { path: 'tanks.fuel.0.capacity', value: 0.2 }
  ] }] })
  const aguaSemNivel = (cozinha, wc) => ({ tanques: [{ id: 0, nome: 'Cozinha (BB)', ritmo: null, semSensor: cozinha.semSensor, nivelConhecido: cozinha.nivelConhecido }, { id: 1, nome: 'WC (EB)', ritmo: null, semSensor: wc.semSensor, nivelConhecido: wc.nivelConhecido }] })
  junta('motor-agua-por-confirmar', barra(), motor.render(contexto(stag, estadoMotor({ agua: aguaSemNivel({ semSensor: false, nivelConhecido: false }, { semSensor: true, nivelConhecido: false }) }))))
  {
    const ctx = contexto(stag, estadoMotor({ agua: aguaSemNivel({ semSensor: false, nivelConhecido: false }, { semSensor: false, nivelConhecido: false }), confirmarEncher: 0, msgAgua: 'o plugin da água não responde' }))
    ctx.notificacoes = alarmesMotor.map(([c, s, m]) => doServidor(c, { state: s, method: SOM, message: m, ...(c.endsWith('fuga') ? { apito: 'continuo' } : {}) }))
    junta('motor-agua-por-confirmar-6-alarmes-encher', barra({ lista: ctx.notificacoes }), motor.render(ctx))
  }
  // o gasóleo sem leitura (F3b, item 6): o último nível, com a hora, e a recusa do Abasteci com a sonda perdida (a frase mais
  // comprida do mosaico); o nível velho também na Carta
  const nivelVelho = { idade: (p) => (p === 'tanks.fuel.0.currentLevel' ? 12 * 60e3 : 0) }
  junta('motor-gasoleo-sem-leitura', barra(), motor.render(contexto(stm, estadoMotor({ msgGas: 'Não gravou: sem leitura da sonda do gasóleo (ADS1115, app I2C do OpenPlotter): não gravei nada; tenta outra vez quando a sonda voltar', msgGasErro: true }), nivelVelho)))
  junta('motor-gasoleo-sem-leitura-noite', barra(), motor.render(contexto(stm, estadoMotor({ msgGas: 'Não gravou: sem leitura da sonda do gasóleo (ADS1115, app I2C do OpenPlotter): não gravei nada; tenta outra vez quando a sonda voltar', msgGasErro: true }), nivelVelho)), { noite: true })
  junta('carta-gasoleo-sem-leitura', barra(), carta.render(contexto(stm, {}, nivelVelho)))
  junta('motor-teclado', barra(), motor.render(contexto(stm, estadoMotor({ teclado: { modo: 'abasteci', valor: '85,5' } }))))
  junta('motor-calibracao', barra(), motor.render(contexto(stm, estadoMotor({ calibAberta: true, calib: { ativa: true, total: 25, pontos: [0, 5, 10, 15, 20, 25].map(l => ({ litros: l, razao: 0.1 + l / 250 })), pendente: null, razaoAtual: 0.2, boiaParada: { de: 10, ate: 15 } }, confirmarCancelarCalib: true }))))
  junta('motor-bomba', barra(), motor.render(contexto(stm, estadoMotor({ bombaCalib: 0, agua: { tanques: [{ id: 0, nome: 'Cozinha (BB)', pedaladasCalibracao: 12, semSensor: false, nivelConhecido: true }] }, msgAgua: 'o plugin da água não responde' }))))

  // ---------- Melhor rota: o Leme a navegar com 6 avisos, e o Resultado/Mapa/A calcular de um Recalcular no mar ----------
  const st = storeSimulado(60)
  const PLANO = {
    estado: 'a navegar', pausadoDe: null, ativadoEm: new Date(Date.now() - 4 * 3600e3).toISOString(), chegadaOutro: null, destino: { id: 'peniche', nome: 'Peniche', lat: 39.3522, lon: -9.376 }, tripulacao: 'so', idCalculo: 'calc-1', indice: 0, alternativa: { id: 'x', nome: 'Agora, 5 MN, só motor' }, partida: new Date(Date.now() - 3 * 3600e3).toISOString(), saida: new Date(Date.now() - 3 * 3600e3).toISOString(), chegou: null, atrasoMin: 20, proximo: { texto: 'rizar', hora: new Date(Date.now() + 25 * 60e3).toISOString() }, chegadaAgora: new Date(Date.now() + 8 * 3600e3).toISOString(), chegadaPlano: new Date(Date.now() + 7.6 * 3600e3).toISOString(), chegadaNoite: true, recursos: { gasoleoChegadaL: 34, bateriaChegadaPct: 70, semLeitura: false, aviso: 'Recursos: gasóleo à chegada ~34 L' }, semGps: false, barometro: { semLeitura: false, quedaHpa: 1.2 }, previsaoIdadeH: 2, envio: { contactos: ['Mãe', 'Pai'], alarme: new Date(Date.now() + 18 * 3600e3).toISOString() }, filaContactos: [{ tipo: 'atraso', parcial: true, contactos: ['Pai'], tentativas: 2 }], atrasoRetido: { motivo: 'parado', alarme: new Date(Date.now() + 18 * 3600e3).toISOString() },
    avisos: [
      { caminho: 'notifications.rota.lembrete.e3', state: 'alert', message: 'Às 15:57: rizar' },
      { caminho: 'notifications.rota.recalcula', state: 'warn', message: 'Recalcula a rota: atraso de 40 min' },
      { caminho: 'notifications.rota.previsao', state: 'alarm', message: 'Previsão com 14 h: confia nos instrumentos e no barómetro' },
      { caminho: 'notifications.rota.barometro', state: 'warn', message: 'Barómetro: caiu 3,4 hPa em 3 h — o tempo pode piorar antes do previsto' },
      { caminho: 'notifications.rota.alarmeTerra', state: 'alert', message: 'Os contactos em terra ligam ao MRCC às 09:38: avisa-os ou Terminar' },
      { caminho: 'notifications.rota.vento', state: 'warn', message: 'Vento 30 % acima do previsto há 1 h: confirma os limites' }
    ]
  }
  const valoresLeme = { 'navigation.position': { latitude: 38.9, longitude: -9.6 }, 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 1, 'navigation.course.nextPoint': { name: 'WP3' }, 'navigation.headingTrue': 1.2, 'navigation.course.activeRoute': { href: '/r/1', name: 'Arlequin → Peniche' }, 'environment.wind.directionTrue': 2, 'environment.wind.speedTrue': 7 }
  const comPlano = (estado, noite = false) => ({ ...contexto(st, { planoAtivo: PLANO, planoAtivoEm: Date.now(), planoAtivoLidoEm: Date.now(), ...estado }, { noite }), v: (p) => valoresLeme[p] })
  junta('leme-6-avisos', barra({ lista: [TERRA] }), melhor.render(comPlano({})))
  junta('leme-6-avisos-noite', barra({ lista: [TERRA] }), melhor.render(comPlano({}, true)), { noite: true })
  for (const f of ['fuga', 'direta', 'canal']) {
    const resultado = fixture(f)
    junta(`resultado-${f}`, barra(), melhor.render(comPlano({ vista: 'resultado', resultado, idCalculo: 'calc-1', selecionada: 0, novo: true })))
    junta(`resultado-${f}-2a`, barra(), melhor.render(comPlano({ vista: 'resultado', resultado, idCalculo: 'calc-1', selecionada: 1, novo: true, plano: { estado: 'enviado', indice: 1, contactos: ['Mãe', 'Pai'], falhas: [{ nome: 'Pai', erro: 'chat bloqueado' }], avisos: ['sem o teu telefone: os contactos não te podem ligar'] }, msg: 'o plugin da rota recusou: este cálculo é antigo (mais de 30 min), calcula outra vez', msgErro: true })))
    junta(`mapa-${f}`, barra(), melhor.render(comPlano({ vista: 'mapa', resultado, idCalculo: 'calc-1', selecionada: 0, novo: true, msg: 'o plugin da rota recusou: este cálculo é antigo (mais de 30 min), calcula outra vez', msgErro: true })))
  }
  junta('resultado-fuga-noite', barra(), melhor.render(comPlano({ vista: 'resultado', resultado: fixture('fuga'), idCalculo: 'calc-1', selecionada: 0, novo: true }, true)), { noite: true })
  junta('a-calcular', barra(), melhor.render(comPlano({ vista: 'a-calcular', calculo: { id: 'calc-9', progresso: 0.42, texto: 'a simular as partidas de amanhã' }, novo: true })))
  junta('erro', barra(), melhor.render(contexto(st, { vista: 'erro', erro: 'o plugin da rota não responde', ultimoPedido: { destino: 'peniche' }, novo: true })))
  junta('pedir', barra(), melhor.render(contexto(st, { destinos: DESTINOS, destinosEm: Date.now(), novo: true, escolhido: 'nazare' })))
  junta('pedir-acrescentar', barra(), melhor.render(contexto(st, { destinos: DESTINOS, destinosEm: Date.now(), novo: true, acrescentar: 'coordenadas', msgDestino: 'coordenadas inválidas: escreve, por exemplo, 39,37 e 9,34 W' })))
  junta('leme-pausado', barra(), melhor.render({ ...comPlano({ planoAtivo: { ...PLANO, estado: 'pausado', pausadoDe: 'a navegar', chegadaOutro: { id: 'cascais', nome: 'Cascais' } }, confirmarTerminar: 'calc-1|0|' + PLANO.ativadoEm }), v: (p) => (p === 'navigation.course.activeRoute' || p.startsWith('navigation.course.calcValues') ? undefined : valoresLeme[p]) }))

  // ---------- AIS com 13 alvos e o detalhe aberto ----------
  const sta = storeSimulado(60)
  for (let i = 0; i < 12; i++) aplicarDelta(sta, { context: `vessels.urn:mrn:imo:mmsi:2630000${10 + i}`, updates: [{ timestamp: new Date().toISOString(), values: [{ path: 'navigation.position', value: { latitude: 39.3 + i * 0.01, longitude: -9.45 } }, { path: '', value: { name: `ALVO ${i}` } }, { path: 'navigation.speedOverGround', value: 3 }, { path: 'navigation.courseOverGroundTrue', value: 1 }, { path: 'design.aisShipType', value: { id: 70 + (i % 3), name: 'Cargo' } }] }] })
  const ctxAis = contexto(sta, { sel: '263000021' })
  ctxAis.notificacoes = [doServidor('notifications.arlequin.ais.263000021', { state: 'alarm', method: SOM, apito: 'continuo', message: 'ALVO 11 em rota de colisão · CPA 0,1 MN' })]
  ctxAis.alvos = alvosAis({ vessels: sta.vessels.values(), eu: { position: ctxAis.v('navigation.position'), cog: ctxAis.v('navigation.courseOverGroundTrue'), sog: ctxAis.v('navigation.speedOverGround') }, notificacoes: ctxAis.notificacoes, agora: Date.now() })
  junta('ais', barra({ lista: ctxAis.notificacoes }), ais.render(ctxAis))
  junta('ais-noite', barra({ lista: ctxAis.notificacoes }), ais.render(ctxAis), { noite: true })
  const semCog = { ...ctxAis, alvos: alvosAis({ vessels: sta.vessels.values(), eu: { position: ctxAis.v('navigation.position'), sog: 3 }, notificacoes: ctxAis.notificacoes, agora: Date.now() }) }
  junta('ais-sem-cog', barra({ lista: ctxAis.notificacoes }), ais.render(semCog))
  // sem o nosso rumo (revisão F3, Minor 7): "sem rumo: só distância" em vez de CPA e TCPA, na AIS (com a linha que o diz) e na Carta
  junta('carta-sem-cog', barra({ lista: ctxAis.notificacoes }), carta.render({ ...contexto(sta), alvos: semCog.alvos }))

  // ---------- as outras páginas ----------
  junta('carta', barra({ lista: [AIS_NORMAL] }), carta.render(contexto(st)))
  junta('instr', barra(), instr.render(contexto(st)))
  junta('viagem', barra(), viagem.render(contexto(st, { confirmarNova: true })))
  for (const passo of [-1, 0, 1, 2]) junta(`velas-passo-${passo}`, barra(), velas.render(contexto(st, { passo, msg: 'Diário: Início de recolher velas', msgErro: false })))
  const entradas = Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(Date.now() - i * 600e3).toISOString(), text: `Entrada ${i}: rumo 020°, vento 14 nós, mar 1 m`, category: 'navigation', origin: 'manual' }))
  const ia = { modelos: { velocidade: { versao: 'v0002', versoes: ['v0001', 'v0002'], podeVoltar: true, horas: 6, frases: ['a 60° com 12 nós andas 5,6 nós (a polar dizia 6,2)'] }, ventoForca: { versao: null, versoes: [] }, ventoDirecao: { versao: 'v0001', versoes: ['v0001'], horas: 3, frases: [] }, consumo: { versao: 'v0001', versoes: ['v0001'], horas: 2, frases: [] } }, ultimoTreino: { em: new Date().toISOString(), resultados: [{ aceite: true }] }, previsao: { okEm: Date.now() } }
  junta('diario', barra(), diario.render(contexto(st, { entradas, em: Date.now(), ia, iaEm: Date.now(), msg: 'Gravado: Rizei', msgErro: false })))
  junta('diario-noite', barra(), diario.render(contexto(st, { entradas, em: Date.now(), ia, iaEm: Date.now() })), { noite: true })
  return out
}
