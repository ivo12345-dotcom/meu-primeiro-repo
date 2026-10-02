'use strict'
// Plugin SignalK: motor Volvo Penta D1-20B pelo J1939 do MDI (só escuta).
// Fonte: candump -L no Pi, ou o simulador (evento 'arlequin-j1939') no portátil.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { lerLinha, descodificar, BYTES } = require('./lib/j1939')
const { litrosHora, m3s } = require('./lib/consumo')
const { novoEstadoMotor, avaliarMotor } = require('./lib/motor')
const { novaDescoberta, registar, alarmesDoMapa } = require('./lib/descoberta')
const { criarDetetor, estavel, novaCurva, amostra, resumo } = require('./lib/curva')
const { lerInterface, avaliarLigacao } = require('./lib/ligacao')

// Cada caminho guarda a hora da última trama que o trouxe com um valor (vistoEm). Sem ele há mais de
// 5 s — a PGN deixou de chegar ou chega com o campo "sem dado" — o caminho passa a desconhecido (null),
// nunca um valor velho como se fosse atual (auditoria K-07).
//   - Rotações: null, nunca 0; quem lê trata null como "motor não está a trabalhar", mas a AI não pode
//     ler isto como "à vela" (ver arlequin-ia/treino.py). O estado do motor fica "stopped".
//   - Consumo medido (PGN 65266): deixa de ser "medido" e passa a "estimado" pela curva, como sem
//     medição nenhuma. Sem as rotações a estimativa é 0 com o motor calado e null (desconhecida) sem
//     ligação ou sem a EEC1.
//   - Horas do motor (PGN 65253): não passam a null nem se republicam; o valor não muda com o motor
//     parado e a hora dele na árvore envelhece (assim o contador da energia não as substitui).
//   - Alarmes do mapa do MDI (PGN 65417): limpam quando a 65417 deixa de chegar (o MDI deixou de os dizer)
//     a receber outras tramas ou com o MDI calado; sem ligação ficam (não se sabe).
//   - O sobreaquecimento calculado aqui não limpa só por faltar a temperatura: fica até haver uma leitura
//     normal ou o MDI calado (ignição desligada).
// O estado da ligação (contrato C11; como se distingue a ignição desligada de uma leitura perdida está
// em lib/ligacao.js): propulsion.main.ligacao = 'a-receber' | 'calado' | 'sem-ligacao', publicado a cada
// segundo (nos primeiros 5 s sem tramas ainda não se sabe e não se publica).
//   - 'calado' (a ignição desligada): os valores a null, o consumo estimado 0, o estado "stopped" e os
//     alarmes que vêm dos dados do motor (sobreaquecimento, alternador, mapa do MDI) voltam a normal;
//   - 'sem-ligacao' (a interface em baixo ou o candump a falhar): os valores a null, o consumo estimado e
//     o estado a null, os alarmes ativos ficam como estão, e o aviso notifications.propulsion.main.semLigacao
//     (warn, apito curto, só para o ecrã: o porto não o manda para o Telegram), que limpa com uma trama ou
//     com 30 s seguidos de 'calado' (a interface a ir e vir não o faz apitar outra vez). O estado do plugin
//     passa a erro com o motivo (o de cada segundo já não apaga o erro do candump).
const VELHO = 5000
const REV = 'propulsion.main.revolutions'
const CONSUMO = 'propulsion.main.fuel.rate'
const HORAS = 'propulsion.main.runTime'
const LIGACAO = 'propulsion.main.ligacao'
const MAPA = 'pgn:65417'
const CALADO_LIMPA = 30 * 1000 // o aviso semLigacao limpa com tanto tempo seguido de 'calado'
const RELIGAR = 5000 // o candump volta a lançar-se de tanto em tanto

// deps (só para os testes): spawn (o do child_process) e lerInterface (o de lib/ligacao.js).
module.exports = function (app, { spawn: lancar = spawn, lerInterface: interfaceDe = (nome) => lerInterface(nome) } = {}) {
  const plugin = {
    id: 'signalk-arlequin-j1939',
    name: 'Arlequin · motor J1939',
    description: 'Rotações, horas, temperatura, tensão e alarmes do MDI do Volvo Penta D1-20B (só escuta)'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      fonte: { type: 'string', title: 'Fonte das tramas', enum: ['candump', 'simulador'], default: 'candump' },
      interface: { type: 'string', title: 'Interface CAN do motor (NUNCA a da rede NMEA 2000)', default: 'can1' },
      estimarConsumo: { type: 'boolean', title: 'Estimar o consumo pelas rotações (curva Volvo Penta)', default: true },
      fatorConsumo: { type: 'number', title: 'Fator de calibração do consumo (medir com o depósito)', default: 1 },
      mapaAlarmes: {
        type: 'array',
        title: 'Alarmes do MDI (PGN 65417): byte e bit de cada alarme, depois da descoberta',
        default: [],
        items: {
          type: 'object',
          properties: {
            byte: { type: 'number', title: 'Byte (0–7)' },
            bit: { type: 'number', title: 'Bit (0–7)' },
            id: { type: 'string', title: 'ID SignalK (ex.: lowOilPressure)' },
            mensagem: { type: 'string', title: 'Mensagem' },
            estado: { type: 'string', enum: ['alarm', 'warn'], default: 'alarm' }
          }
        }
      }
    }
  }

  let o = {}
  let proc = null
  let religar = null
  let temporizador = null
  let ouvinte = null
  let valores = {} // caminho → valor (último)
  let vistoEm = {} // caminho → hora da última trama que o trouxe com valor; MAPA → a da última 65417
  let estado, desc, ativosMapa, rpmAtual, ficheiroDesc, vistasTotal
  let detetor, curva, ficheiroCurva, ultimaGravacao
  let mudancas = [] // últimas 50 mudanças das PGN proprietárias (o ficheiro guarda todas)
  // o estado da ligação (C11, lib/ligacao.js)
  let ultimaTrama = -Infinity // a hora da última trama (qualquer PGN)
  let ouvirDesde = 0 // desde quando o leitor está à escuta (o candump de agora, ou o simulador)
  let candumpVivo = false
  let motivoCandump = null // o último erro do candump (o que disse no stderr, não arrancou, saiu)
  let ligacao = null // 'a-receber' | 'calado' | 'sem-ligacao' | null (ainda não se sabe)
  let motivoLigacao = null
  let avisoLigacao = false // o aviso semLigacao está publicado
  let caladoDesde = null // desde quando está 'calado' seguido, com o aviso publicado
  let aCorrer = false // entre o start() e o stop()

  const fresco = (p, agora) => agora - (vistoEm[p] ?? -Infinity) <= VELHO

  function aoReceber (linha) {
    const t = lerLinha(linha)
    if (!t) return
    vistasTotal++
    const agora = Date.now()
    ultimaTrama = agora
    for (const v of descodificar(t.pgn, t.dados)) {
      valores[v.path] = v.value
      vistoEm[v.path] = agora
      if (v.path === REV) rpmAtual = v.value * 60
    }
    // a 65417 só conta inteira (8 bytes): uma curta lia os bytes em falta como 0 e limpava alarmes (M-61)
    const mapaInteiro = t.pgn === 65417 && t.dados.length >= BYTES
    if (mapaInteiro) vistoEm[MAPA] = agora
    const r = registar(desc, t, rpmAtual)
    desc = r.d
    if (r.mudou) {
      mudancas = [...mudancas.slice(-49), r.mudou]
      fs.appendFile(ficheiroDesc, JSON.stringify(r.mudou) + '\n', () => {})
      app.debug(`PGN ${r.mudou.pgn} mudou: ${r.mudou.bytes} ${r.mudou.bitsMudados.join(', ')}`)
    }
    if (mapaInteiro && o.mapaAlarmes?.length) {
      const m = alarmesDoMapa(o.mapaAlarmes, t.dados, ativosMapa)
      ativosMapa = m.ativos
      publicarNotificacoes(m.notificacoes)
    }
  }

  function publicarNotificacoes (ns) {
    if (!ns.length) return
    app.handleMessage(plugin.id, {
      updates: [{ values: ns.map(n => ({ path: `notifications.propulsion.main.${n.id}`, value: { state: n.state, method: n.method, message: n.message, ...(n.apito ? { apito: n.apito } : {}) } })) }]
    })
  }

  // O aviso semLigacao (C11): acende ao ficar sem ligação; limpa com uma trama ou com CALADO_LIMPA
  // seguido de 'calado' (a interface a ir e vir, ou o candump a ser relançado, não o faz apitar outra vez).
  function avisarLigacao (agora) {
    if (ligacao === 'sem-ligacao') {
      caladoDesde = null
      if (avisoLigacao) return
      avisoLigacao = true
      publicarNotificacoes([{ id: 'semLigacao', state: 'warn', method: ['visual', 'sound'], apito: 'curto', message: `Sem leitura do motor (J1939): ${motivoLigacao}` }])
      return
    }
    if (!avisoLigacao) return
    caladoDesde = ligacao === 'calado' ? (caladoDesde ?? agora) : null
    if (ligacao === 'a-receber' || (ligacao === 'calado' && agora - caladoDesde >= CALADO_LIMPA)) {
      avisoLigacao = false
      caladoDesde = null
      publicarNotificacoes([{ id: 'semLigacao', state: 'normal', method: [], message: 'Normal' }])
    }
  }

  // A 1 Hz: o estado da ligação, os valores, o estado, o consumo estimado e os alarmes calculados.
  function publicar () {
    const agora = Date.now()
    const l = avaliarLigacao({
      agora, ultimaTrama, simulador: o.fonte === 'simulador', ouvirDesde, candumpVivo,
      lerInterface: () => interfaceDe(o.interface), anterior: ligacao, motivoCandump, nome: o.interface
    })
    ligacao = l.ligacao
    motivoLigacao = l.motivo
    if (candumpVivo && (ligacao === 'a-receber' || ligacao === 'calado')) motivoCandump = null // o candump confirmou-se
    // os caminhos velhos (sem trama com valor há mais de 5 s): ver o cabeçalho (auditoria K-07)
    for (const p of Object.keys(valores)) {
      if (fresco(p, agora)) continue
      if (p === CONSUMO) delete valores[p]
      else if (p !== HORAS) valores[p] = null
    }
    if (!fresco(REV, agora)) { valores[REV] = null; rpmAtual = 0 } // também desde o arranque: null, nunca 0
    // os do mapa do MDI limpam quando a 65417 deixa de chegar; sem ligação (ou sem saber) ficam
    if (Object.keys(ativosMapa).length && !fresco(MAPA, agora) && (ligacao === 'a-receber' || ligacao === 'calado')) {
      publicarNotificacoes(Object.keys(ativosMapa).map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
      ativosMapa = {}
    }
    const rpm = (valores[REV] ?? 0) * 60
    const r = avaliarMotor(estado, { rpm, temp: valores['propulsion.main.temperature'], volt: valores['propulsion.main.alternatorVoltage'], ligacao }, agora)
    estado = r.estado
    const vals = Object.entries(valores)
      .filter(([p]) => p !== HORAS || fresco(p, agora))
      .map(([p, value]) => ({ path: p, value }))
    // Consumo: o real (PGN 65266) se o MDI o mandar; senão, a estimativa pelas rotações (sem elas: 0 com
    // o motor calado, null sem saber). A origem vai em propulsion.main.fuel.rateOrigem ('medido' |
    // 'estimado'): a AI só aprende o consumo com o medido (a estimativa é a própria curva da Volvo × fator).
    if (CONSUMO in valores) {
      vals.push({ path: 'propulsion.main.fuel.rateOrigem', value: 'medido' })
    } else if (o.estimarConsumo) {
      const lhEstimado = typeof valores[REV] === 'number' ? litrosHora(rpm, o.fatorConsumo) : ligacao === 'calado' ? 0 : null
      vals.push({ path: CONSUMO, value: lhEstimado === null ? null : m3s(lhEstimado) })
      vals.push({ path: 'propulsion.main.fuel.rateOrigem', value: 'estimado' })
    }
    vals.push({ path: 'propulsion.main.state', value: ligacao === 'sem-ligacao' ? null : estado.ligado ? 'started' : 'stopped' })
    if (ligacao !== null) vals.push({ path: LIGACAO, value: ligacao })

    // Curva aprendida: em regime estável, velocidade (na água, se houver) e consumo por faixa.
    const lh = CONSUMO in valores
      ? valores[CONSUMO] * 3600 * 1000
      : (o.estimarConsumo ? litrosHora(rpm, o.fatorConsumo) : null)
    const e = estavel(detetor, estado.ligado ? rpm : 0, agora)
    detetor = e.d
    const vel = velocidade()
    if (estado.ligado && e.estavel && typeof lh === 'number' && vel > 0.5) {
      curva = amostra(curva, { rpm, lh, vel })
      if (agora - ultimaGravacao > 60000) {
        ultimaGravacao = agora
        fs.writeFile(ficheiroCurva, JSON.stringify(curva), () => {})
      }
    }
    app.handleMessage(plugin.id, { updates: [{ values: vals }] })
    publicarNotificacoes(r.notificacoes)
    avisarLigacao(agora)
    const pgns = `${Object.keys(desc.vistas).length} PGN`
    if (ligacao === 'sem-ligacao') app.setPluginError(`Sem leitura do motor (J1939): ${motivoLigacao}`)
    else if (ligacao === 'calado') {
      const ha = Number.isFinite(ultimaTrama) ? `nenhuma trama há ${Math.round((agora - ultimaTrama) / 1000)} s` : 'nenhuma trama desde o arranque'
      app.setPluginStatus(`${o.fonte} · calado (ignição desligada): ${ha} · ${vistasTotal} tramas · ${pgns}`)
    } else if (ligacao === null) app.setPluginStatus(`${o.fonte} · à escuta${o.fonte === 'simulador' ? '' : ` em ${o.interface}`}…`)
    else app.setPluginStatus(`${o.fonte} · ${vistasTotal} tramas · ${estado.ligado ? Math.round(rpm) + ' rpm' : 'parado'} · ${pgns}`)
  }

  // Velocidade na água se for recente; senão a velocidade no fundo.
  function velocidade () {
    for (const p of ['navigation.speedThroughWater', 'navigation.speedOverGround']) {
      const v = app.getSelfPath?.(p)
      if (typeof v?.value === 'number' && Date.now() - Date.parse(v.timestamp) < 10000) return v.value
    }
    return null
  }

  // O candump: vivo desde que se lança até sair ('close') ou não arrancar ('error'; o Node dá os dois a
  // um ENOENT: só o primeiro conta). Religa de 5 em 5 s. O que vem de um candump antigo não conta.
  function arrancarCandump () {
    religar = null
    if (!aCorrer) return
    let p
    try { p = lancar('candump', ['-L', o.interface]) } catch (e) { acabou(null, `candump não arrancou (${e.message}). Instalar can-utils e configurar o ${o.interface}.`); return }
    proc = p
    candumpVivo = true
    ouvirDesde = Date.now()
    let resto = ''
    let erro = null // o que este candump disse no stderr
    p.stdout.on('data', (b) => {
      if (p !== proc) return
      const linhas = (resto + b.toString()).split('\n')
      resto = linhas.pop()
      linhas.forEach(aoReceber)
    })
    p.stderr.on('data', (b) => {
      erro = `candump: ${b.toString().trim()}`
      if (p !== proc) return
      motivoCandump = erro
      app.setPluginError(erro)
    })
    p.on('error', (e) => acabou(p, `candump não arrancou (${e.message}). Instalar can-utils e configurar o ${o.interface}.`))
    p.on('close', (codigo) => acabou(p, erro || `o candump saiu (código ${codigo})`))
  }

  function acabou (p, motivo) {
    if (p !== proc) return // um candump antigo (já substituído, ou depois do stop)
    proc = null
    candumpVivo = false
    motivoCandump = motivo
    app.setPluginError(motivo)
    if (aCorrer && !religar) religar = setTimeout(arrancarCandump, RELIGAR)
  }

  plugin.start = function (props) {
    o = { fonte: 'candump', interface: 'can1', estimarConsumo: true, fatorConsumo: 1, mapaAlarmes: [], ...props }
    valores = {}
    vistoEm = {}
    estado = novoEstadoMotor()
    desc = novaDescoberta()
    ativosMapa = {}
    rpmAtual = 0
    vistasTotal = 0
    ultimaTrama = -Infinity
    ouvirDesde = Date.now()
    candumpVivo = false
    motivoCandump = null
    ligacao = null
    motivoLigacao = null
    avisoLigacao = false
    caladoDesde = null
    aCorrer = true
    // Um alarme não pode ficar preso na árvore (auditoria I-21): os deste plugin que ficaram ativos de
    // antes passam a normal (a regra volta a dar o alarme se ainda for verdade); no stop(), os ativos.
    const ids = ['overTemperature', 'alternadorNaoCarrega', 'semLigacao', ...(o.mapaAlarmes || []).map(m => m.id)]
    publicarNotificacoes([...new Set(ids)]
      .filter(id => { const s = app.getSelfPath?.(`notifications.propulsion.main.${id}`)?.value?.state; return s && s !== 'normal' })
      .map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
    const dir = app.getDataDirPath()
    fs.mkdirSync(dir, { recursive: true })
    ficheiroDesc = path.join(dir, 'descoberta-65417.jsonl')
    try { mudancas = fs.readFileSync(ficheiroDesc, 'utf8').trim().split('\n').filter(Boolean).slice(-50).map(l => JSON.parse(l)) } catch { mudancas = [] }
    ficheiroCurva = path.join(dir, 'curva-consumo.json')
    detetor = criarDetetor()
    ultimaGravacao = 0
    try { curva = JSON.parse(fs.readFileSync(ficheiroCurva, 'utf8')) } catch { curva = novaCurva() }
    if (o.fonte === 'simulador') {
      ouvinte = aoReceber
      app.on('arlequin-j1939', ouvinte)
    } else {
      arrancarCandump()
    }
    temporizador = setInterval(publicar, 1000)
  }

  plugin.stop = function () {
    aCorrer = false
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    if (religar) clearTimeout(religar)
    religar = null
    if (ouvinte) app.removeListener('arlequin-j1939', ouvinte)
    ouvinte = null
    const p = proc
    proc = null // o 'close' dele já não conta (acabou)
    candumpVivo = false
    if (p) p.kill()
    const ativos = [...Object.keys(estado?.ativos || {}), ...Object.keys(ativosMapa || {}), ...(avisoLigacao ? ['semLigacao'] : [])]
    publicarNotificacoes([...new Set(ativos)].map(id => ({ id, state: 'normal', method: [], message: 'Normal' })))
    if (estado) estado = { ...estado, ativos: {} }
    ativosMapa = {}
    avisoLigacao = false
  }

  // Diagnóstico: PGN vistas e mudanças da 65417 (JSON e página simples).
  // A página fica em /pagina porque o SignalK usa a raiz /plugins/<id>/ para si.
  // Com a segurança do SignalK ligada (2.33), uma rota registada com o router simples só aceita admin
  // (tokensecurity.js); com o router.access a leitura pede só uma sessão ("readonly"), como a conta
  // "read/write" do ecrã (auditoria K-11, contrato C2). Sem o router.access (versões antigas): o simples.
  plugin.registerWithRouter = function (router) {
    const ler = typeof router.access === 'function' ? router.access('readonly') : router
    const diag = () => {
      const vistas = Object.entries(desc?.vistas || {}).map(([pgn, v]) => ({ pgn: Number(pgn), n: v.n, origem: v.origem, bytes: v.bytes }))
      return { fonte: o.fonte, tramas: vistasTotal, rpm: Math.round(rpmAtual || 0), vistas, mudancas: [...mudancas].reverse() }
    }
    ler.get('/diagnostico', (req, res) => res.json(diag()))
    // Curva de consumo aprendida no barco (para a página Motor).
    ler.get('/consumo', (req, res) => res.json({
      ...resumo(curva || novaCurva()),
      consumo: CONSUMO in valores ? 'medido pelo MDI' : `estimado (curva Volvo × ${o.fatorConsumo})`
    }))
    ler.get('/pagina', (req, res) => {
      const d = diag()
      const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      res.type('html').send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Arlequin · J1939</title>
<style>body{font:16px Arial;background:#0f1114;color:#e8eaed;margin:1rem}td,th{padding:.3rem .6rem;border-bottom:1px solid #333;text-align:left}code{color:#fac775}h2{margin-top:1.5rem}</style>
<h1>Motor · J1939 (${esc(d.fonte)})</h1><p>${d.tramas} tramas · ${d.rpm} rpm</p>
<h2>PGN vistas</h2><table><tr><th>PGN</th><th>Origem</th><th>N</th><th>Últimos bytes</th></tr>${d.vistas.map(v => `<tr><td>${v.pgn}</td><td>${v.origem}</td><td>${v.n}</td><td><code>${esc(v.bytes)}</code></td></tr>`).join('')}</table>
<h2>Mudanças nas PGN proprietárias (65417 = alarmes do MDI)</h2><p>Teste: ignição ligada com o motor parado acende os alarmes de óleo e de carga. Liga o motor e vê que bits apagam.</p>
<table><tr><th>Hora</th><th>PGN</th><th>rpm</th><th>Bytes</th><th>Bits que mudaram</th></tr>${d.mudancas.map(m => `<tr><td>${new Date(m.t).toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' })}</td><td>${m.pgn}</td><td>${m.rpm ?? ''}</td><td><code>${esc(m.bytes)}</code></td><td>${esc(m.bitsMudados.join(', '))}</td></tr>`).join('')}</table>`)
    })
  }

  return plugin
}
