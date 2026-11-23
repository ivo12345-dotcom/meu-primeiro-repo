'use strict'
// Plugin SignalK: o que a caixa 1 manda pelo cabo USB (a roda do log, o mostrador do vento, o sensor
// de movimento e as tramas do motor que a caixa 2 lhe passa pelo rádio) → SignalK.
//
// As caixas só leem e mandam em bruto; as contas e as calibrações são daqui (lib/contas.js), com os
// números na configuração do plugin, para se corrigirem sem regravar as placas.
//
// Regras:
//   - Nunca um valor velho (K-07): cada grandeza vale enquanto a última linha dela tiver 5 s ou menos;
//     depois publica-se a null, a medida e o que veio em bruto. O relógio é o do portátil, para um
//     salto de hora (o portátil adormeceu e acordou) envelhecer tudo de uma vez.
//   - Sem o batimento da caixa 1 há 5 s ou menos nada sai como medição: é por ele que se sabe se a
//     caixa finge, e uma caixa calada não pode deixar valores a parecer atuais.
//   - Dados a fingir nunca ensinam a AI: com "ensaio" ligado, ou com uma das duas caixas a dizer que
//     finge, todas as atualizações levam o $source 'arlequin-simulador.caixas' (a caixa negra marca
//     "simulado" o que vem de 'arlequin-simulador' ou 'arlequin-simulador.*').
//   - A proa só sai quando o sensor confia na bússola dele: com a confiança a 0, ou com o erro que ele
//     próprio estima acima do limite da configuração, a proa vai a null e o estado do plugin diz porquê.
//     O adornamento e o caimento vêm da gravidade e saem na mesma.
//   - As tramas do motor seguem logo para o plugin do motor, pelo evento 'arlequin-j1939', com a hora
//     do portátil. O estado de cada caixa vai em arlequin.caixas.N.estado; o aviso da caixa 2 calada
//     é do plugin do motor, daqui só sai o da caixa 1 (lib/caixas.js).
//   - O sensor de movimento: a caixa 1 diz no batimento como ele está, e isso vai em
//     arlequin.caixas.1.sensor, com o motivo do último arranque da placa e os toques no RST. Um sensor
//     que não volta acende o aviso notifications.arlequin.caixas.sensor.
//   - Linhas que não se percebem contam-se e mostram-se no estado do plugin e no /estado; nunca uma
//     mensagem por linha no registo.
//
// A proa e a atitude saem 2 vezes por segundo; o resto, 1 vez. O bloco do movimento (as leituras do
// sensor de um segundo, tal como chegaram) sai num caminho só, para a caixa negra o gravar.

const { ler, linhaMotor } = require('./lib/linhas')
const contas = require('./lib/contas')
const { novoBloco, juntar, fechar, emFalta } = require('./lib/movimento')
const { novoEstadoCaixas, anotarBatimento, anotarPorta, avaliarCaixas } = require('./lib/caixas')
const { abrirFonte: abrirFonteVerdadeira } = require('./lib/fonte')

const VELHO = 5000 // uma linha mais velha do que isto já não vale
const PASSO = 500 // ms: a atitude sai a cada passo, o resto de dois em dois
const SIMULADO = 'arlequin-simulador.caixas'
const GRAU = Math.PI / 180
const EIXOS = ['+x', '-x', '+y', '-y', '+z', '-z']
const DIZER = { 'a-receber': 'a receber', 'sem-ligacao': 'sem ligação' }
const POR_OMISSAO = {
  porta: 'auto',
  ensaio: false,
  nosPorHz: 0.2,
  desvioVento: 0,
  fatorVento: 1,
  eixoProa: '+y',
  eixoCima: '+z',
  desvioProa: 0,
  desvioAdorno: 0,
  desvioCaimento: 0,
  erroMaxProa: 20,
  tabelaDesvios: [],
  posicaoSensor: { vante: 0, estibordo: 0, acima: 0 },
  acelerometro: { desvio: [0, 0, 0], escala: [1, 1, 1] }
}

const fresco = (visto, agora) => agora - visto <= VELHO
const numero = (v) => (Number.isFinite(v) ? v : null)

// deps (só para os testes): abrirFonte (o de lib/fonte.js).
module.exports = function (app, { abrirFonte = abrirFonteVerdadeira } = {}) {
  const plugin = {
    id: 'signalk-arlequin-caixas',
    name: 'Arlequin · caixas',
    description: 'Caixas ESP32 do Arlequin: vento, velocidade na água, proa, adornamento, movimento e motor, por USB'
  }

  const tres = (titulo, omissao) => ({ type: 'array', title: titulo, items: { type: 'number' }, minItems: 3, maxItems: 3, default: omissao })
  plugin.schema = {
    type: 'object',
    properties: {
      porta: { type: 'string', title: 'Porta da caixa 1: "auto" (procura-a sozinho), o nome de uma porta (COM7) ou tcp://máquina:porta (a caixa a fingir)', default: POR_OMISSAO.porta },
      ensaio: { type: 'boolean', title: 'Ensaio: marca tudo como simulado (em casa, com a caixa verdadeira), para não ensinar a AI', default: POR_OMISSAO.ensaio },
      nosPorHz: { type: 'number', title: 'Roda do log: nós por impulso por segundo (acerta-se contra o GPS)', default: POR_OMISSAO.nosPorHz },
      desvioVento: { type: 'number', title: 'Vento: graus a somar ao ângulo do mostrador', default: POR_OMISSAO.desvioVento },
      fatorVento: { type: 'number', title: 'Vento: fator a multiplicar pela velocidade', default: POR_OMISSAO.fatorVento },
      eixoProa: { type: 'string', title: 'Sensor: eixo que aponta à proa', enum: EIXOS, default: POR_OMISSAO.eixoProa },
      eixoCima: { type: 'string', title: 'Sensor: eixo que aponta para cima', enum: EIXOS, default: POR_OMISSAO.eixoCima },
      desvioProa: { type: 'number', title: 'Proa: graus a somar (o sensor não ficou bem apontado)', default: POR_OMISSAO.desvioProa },
      desvioAdorno: { type: 'number', title: 'Adornamento: graus que o sensor marca com o barco direito', default: POR_OMISSAO.desvioAdorno },
      desvioCaimento: { type: 'number', title: 'Caimento: graus que o sensor marca com o barco de nível', default: POR_OMISSAO.desvioCaimento },
      erroMaxProa: { type: 'number', title: 'Proa: o maior erro, em graus, que o sensor pode estimar para a proa ainda se publicar (acima disto fica sem proa, e o estado diz porquê)', default: POR_OMISSAO.erroMaxProa },
      tabelaDesvios: {
        type: 'array',
        title: 'Tabela de desvios da bússola (o ferro do barco): graus a somar em cada rumo',
        default: POR_OMISSAO.tabelaDesvios,
        items: { type: 'object', properties: { rumo: { type: 'number', title: 'Rumo (graus)' }, desvio: { type: 'number', title: 'Desvio (graus)' } } }
      },
      posicaoSensor: {
        type: 'object',
        title: 'Posição do sensor, em metros (só se guarda: é para a conta da onda)',
        default: POR_OMISSAO.posicaoSensor,
        properties: {
          vante: { type: 'number', title: 'Para vante do meio do barco' },
          estibordo: { type: 'number', title: 'Para estibordo do eixo do barco' },
          acima: { type: 'number', title: 'Acima da linha de água' }
        }
      },
      acelerometro: {
        type: 'object',
        title: 'Calibração do acelerómetro pelas seis faces (só se guarda)',
        default: POR_OMISSAO.acelerometro,
        properties: { desvio: tres('Desvio (m/s²) em x, y, z', [0, 0, 0]), escala: tres('Escala em x, y, z', [1, 1, 1]) }
      }
    }
  }

  let o = { ...POR_OMISSAO }
  let aCorrer = false
  let fonte = null
  let temporizador = null
  let montagem = null // os eixos do barco no referencial do sensor
  let porta, estadoCaixas, avaliado, info
  let log, logVisto, impulsos
  let vento, ventoVisto
  let mov, movVisto
  let bloco, nAnterior
  let nLinhas, invalidas, faltam, ultimas
  let meio, queixou, avisoAceso, avisoSensorAceso

  function zerar (agora) {
    porta = { aberta: false, nome: '' }
    estadoCaixas = novoEstadoCaixas(agora)
    avaliado = null // o último avaliarCaixas
    info = { 1: null, 2: null } // o que cada caixa disse de si no último batimento
    log = contas.novoLog()
    logVisto = -Infinity
    impulsos = null
    vento = null
    ventoVisto = -Infinity
    mov = null // a última leitura do sensor de movimento
    movVisto = -Infinity
    bloco = novoBloco()
    nAnterior = null
    nLinhas = 0
    invalidas = 0
    faltam = 0
    ultimas = []
    meio = false
    queixou = false
    avisoAceso = false
    avisoSensorAceso = false
  }
  zerar(0)

  const aFingir = () => o.ensaio === true || avaliado?.sim === true

  function enviar (values) {
    if (!values.length) return
    app.handleMessage(plugin.id, { updates: [{ ...(aFingir() ? { $source: SIMULADO } : {}), values }] })
  }

  function publicarNotificacoes (ns) {
    for (const n of ns) {
      if (n.id === 'caixa1') avisoAceso = n.state !== 'normal'
      if (n.id === 'sensor') avisoSensorAceso = n.state !== 'normal'
    }
    enviar(ns.map(n => ({
      path: `notifications.arlequin.caixas.${n.id}`,
      value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) }
    })))
  }

  function aoEstado (e) {
    if (!aCorrer) return
    porta = { aberta: e.aberta === true, nome: e.nome || '', ...(e.motivo ? { motivo: e.motivo } : {}) }
    estadoCaixas = anotarPorta(estadoCaixas, porta, Date.now())
  }

  function aoLinha (texto) {
    if (!aCorrer) return
    try {
      ultimas = [...ultimas.slice(-19), String(texto)]
      const l = ler(texto)
      if (!l) {
        invalidas++
        return
      }
      nLinhas++
      const agora = Date.now()
      if (l.tipo === 'batimento') {
        estadoCaixas = anotarBatimento(estadoCaixas, l, agora)
        info[l.caixa] = { fw: l.fw, perdidos: l.perdidos, rssi: l.rssi, arranque: l.arranque ?? null, rsts: l.rsts ?? null }
      } else if (l.tipo === 'log') {
        log = contas.juntarLog(log, l)
        logVisto = agora
        impulsos = l.impulsos
      } else if (l.tipo === 'vento') {
        vento = l
        ventoVisto = agora
      } else if (l.tipo === 'movimento') {
        faltam += emFalta(nAnterior, l.n)
        nAnterior = l.n
        bloco = juntar(bloco, l)
        mov = l
        movVisto = agora
      } else if (l.tipo === 'motor') {
        app.emit('arlequin-j1939', linhaMotor(l, agora))
      }
    } catch (erro) {
      // uma linha nunca pode rebentar com a fonte; e no registo fica uma queixa só, não uma por linha
      if (!queixou) (app.error || app.debug)(`uma linha da caixa deu erro: ${erro.message}`)
      queixou = true
    }
  }

  // A orientação que o chip calcula → adornamento, caimento e proa do barco, já com os desvios.
  function atitudeDe (q) {
    const a = contas.atitude(q, montagem)
    if (!a) return null
    const { roll, pitch } = contas.corrigirInclinacao(a, o)
    const r = { roll, pitch, yaw: contas.corrigirProa(a.heading, o) }
    return Object.values(r).every(Number.isFinite) ? r : null
  }

  function passo () {
    const agora = Date.now()
    avaliado = avaliarCaixas(estadoCaixas, agora)
    estadoCaixas = avaliado.estado
    const c1 = avaliado.caixas[1]
    const c2 = avaliado.caixas[2]
    const viva1 = c1.estado === 'a-receber'
    publicarNotificacoes(avaliado.notificacoes)

    // 2 vezes por segundo: a atitude e a proa
    const m = viva1 && mov && fresco(movVisto, agora) ? mov : null
    const a = m ? atitudeDe(m.q) : null
    // A proa só sai com o sensor a dar alguma confiança à bússola dele (1 a 3) e com o erro que ele
    // próprio estima dentro do limite. O adornamento e o caimento vêm da gravidade: saem na mesma.
    const erroProa = m ? m.precisao / 10000 / GRAU : null
    const semProa = !a
      ? null
      : m.estado < 1
        ? 'o sensor ainda não confia na bússola dele'
        : erroProa > o.erroMaxProa ? `o sensor estima ${Math.round(erroProa)}° de erro (o limite é ${o.erroMaxProa}°)` : null
    const proa = a && !semProa ? a.yaw : null
    enviar([
      { path: 'navigation.attitude', value: a ? { roll: a.roll, pitch: a.pitch, yaw: proa } : null },
      { path: 'navigation.headingMagnetic', value: proa }
    ])
    meio = !meio
    if (meio) return

    // 1 vez por segundo: o resto
    const logVivo = viva1 && fresco(logVisto, agora)
    const hz = logVivo ? contas.hzLog(log) : null
    const v = viva1 && vento && fresco(ventoVisto, agora) ? vento : null
    const aparente = v ? contas.ventoAparente(v, o) : null
    const valores = [
      { path: 'navigation.speedThroughWater', value: hz === null ? null : numero(contas.velocidadeNaAgua(hz, o.nosPorHz)) },
      { path: 'environment.wind.angleApparent', value: aparente ? numero(aparente.angleApparent) : null },
      { path: 'environment.wind.speedApparent', value: aparente ? numero(aparente.speedApparent) : null },
      { path: 'arlequin.caixas.log.impulsos', value: logVivo ? impulsos : null },
      { path: 'arlequin.caixas.log.hz', value: numero(hz) },
      { path: 'arlequin.caixas.vento.angulo', value: v ? v.angulo : null },
      { path: 'arlequin.caixas.vento.velocidade', value: v ? v.velocidade : null },
      { path: 'arlequin.caixas.atitude.precisao', value: m ? m.precisao / 10000 : null },
      { path: 'arlequin.caixas.atitude.estado', value: m ? m.estado : null }
    ]
    for (const n of [1, 2]) {
      const c = avaliado.caixas[n]
      const dela = c.estado === 'a-receber' ? info[n] : null
      valores.push(
        { path: `arlequin.caixas.${n}.estado`, value: c.estado },
        { path: `arlequin.caixas.${n}.fw`, value: dela ? dela.fw : null },
        { path: `arlequin.caixas.${n}.perdidos`, value: dela ? dela.perdidos : null }
      )
      if (n === 2) valores.push({ path: 'arlequin.caixas.2.rssi', value: dela ? dela.rssi : null })
      if (n === 1) {
        valores.push(
          { path: 'arlequin.caixas.1.sensor', value: avaliado.sensor },
          { path: 'arlequin.caixas.1.arranque', value: dela ? dela.arranque : null },
          { path: 'arlequin.caixas.1.sensorRsts', value: dela ? dela.rsts : null }
        )
      }
    }
    // o bloco do movimento deste segundo; sem a caixa 1 a dizer quem é, deita-se fora
    const b = fechar(bloco)
    bloco = novoBloco()
    if (b && viva1) valores.push({ path: 'arlequin.caixas.movimento', value: b })
    enviar(valores)

    if (!viva1) {
      app.setPluginError(`Sem a caixa dos instrumentos: ${c1.motivo}`)
    } else {
      app.setPluginStatus(`${porta.nome || o.porta} · caixa 1 ${DIZER[c1.estado]} · caixa 2 ${DIZER[c2.estado]} · ${nLinhas} linhas · ` +
        `${invalidas} inválidas · ${faltam} leituras em falta${semProa ? ` · sem proa: ${semProa}` : ''}${aFingir() ? ' · A FINGIR' : ''}`)
    }
  }

  plugin.start = function (props) {
    if (aCorrer) plugin.stop()
    const dadas = Object.fromEntries(Object.entries(props || {}).filter(([, valor]) => valor !== undefined && valor !== null))
    o = { ...POR_OMISSAO, ...dadas }
    zerar(Date.now())
    montagem = contas.eixos(o.eixoProa, o.eixoCima)
    if (!montagem) {
      app.setPluginError('o eixo da proa e o eixo de cima têm de ser diferentes e perpendiculares')
      return
    }
    aCorrer = true
    fonte = abrirFonte({ porta: o.porta, aoLinha, aoEstado })
    temporizador = setInterval(passo, PASSO)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (fonte) fonte.fechar()
    fonte = null
    // um aviso não pode ficar preso na árvore depois de o plugin parar (auditoria I-21)
    if (aCorrer && avisoAceso) publicarNotificacoes([{ id: 'caixa1', state: 'normal', method: [], message: 'Normal' }])
    if (aCorrer && avisoSensorAceso) publicarNotificacoes([{ id: 'sensor', state: 'normal', method: [], message: 'Normal' }])
    aCorrer = false
  }

  // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin;
  // com o router.access a leitura pede só uma sessão ("readonly"), como a conta do ecrã (K-11, C2).
  plugin.registerWithRouter = function (router) {
    const leitura = typeof router.access === 'function' ? router.access('readonly') : router
    leitura.get('/estado', (req, res) => {
      const caixas = (avaliado || avaliarCaixas(estadoCaixas, Date.now())).caixas
      res.json({
        porta: { pedida: o.porta, ...porta },
        caixas: Object.fromEntries([1, 2].map(n => [n, { ...caixas[n], ...(info[n] || {}) }])),
        sim: aFingir(),
        linhas: nLinhas,
        invalidas,
        emFalta: faltam,
        ultimas: [...ultimas]
      })
    })
  }

  return plugin
}
