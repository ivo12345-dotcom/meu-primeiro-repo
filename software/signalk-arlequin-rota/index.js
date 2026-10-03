'use strict'
// Plugin SignalK: melhor rota do Arlequin (desenho 3a). Calcula em segundo plano as
// alternativas até um destino (lib/calculo.js), serve o resultado por REST e ativa a
// rota escolhida no SignalK (API de recursos v2 + API de rumo v2), para o OpenCPN a mostrar.
//
// REST (/plugins/signalk-arlequin-rota), com a segurança do SignalK ligada: os GET pedem uma sessão
// (readonly) e os POST um utilizador "read/write" (router.access; sem ele, só admin):
//   POST /calcular { destino, tripulacao: 'so' | 'acompanhado', sairAgora } → 202 { id }
//        (409 se já houver um a calcular; 503 com o plugin parado)
//   GET  /resultado/:id → { estado: 'a calcular' | 'pronto' | 'erro', progresso, texto, resultado?, erro?,
//        envioEmTerra: { idCalculo, indice, contactos, alarme } | null } (envioEmTerra: o último plano entregue
//        a contactos em terra que ainda conta — ultimo-envio.json; ao Ativar outro, segue o novo; alarme: a mais
//        cedo que algum contacto tem, como no GET /plano-ativo)
//   GET  /destinos, POST /destinos { nome, lat, lon | posicaoAtual: true, conhecido, abrigo? (false) }
//   POST /ativar { id, alternativa } (alternativa: índice 0–2 ou o id) → grava e ativa a rota
//        → { ok, rota, href, via, alternativa, nota, planoAtivo: { estado } } (nota: a do canal, se a
//        rota passar por um). Cria ou substitui o plano ativo (desenho 3b-2, lib/plano-ativo.js),
//        gravado em plano-ativo.json na pasta do plugin, com o envio do plano se já foi enviado. 422 com
//        um cálculo antigo (a partida há mais de 1 h ou a hora de alarme já passada; a alternativa do plano
//        aberto ativada outra vez continua: decisão do Ivo n.º 13) e quando o plano novo seguiria para terra
//        com o relógio do Pi desacertado (decisão n.º 19); 409 com outro Ativar a meio (auditoria M-21); 502
//        se a API do servidor falhar. A rota do plano substituído apaga-se do servidor (auditoria M-34).
//   POST /plano-telegram { id, alternativa } → 202 { pedido, avisos: [texto] } (404 cálculo ou
//        alternativa desconhecidos; 409 se o cálculo não estiver pronto; 422 sem a chegada mais
//        tarde (não há hora de alarme), com um cálculo antigo (a hora de alarme já passou, ou a
//        partida foi há mais de 1 h) ou com o relógio do Pi a mais de 60 s da hora do GPS (decisão n.º 19);
//        503 sem eventos no servidor ou sem o plugin porto a ouvir)
//   GET  /plano-telegram/:pedido → { estado: 'a enviar' | 'enviado' | 'falhou', entregues: [nome],
//        contactos: [nome], falhas: [{ nome, erro }], avisos: [texto], criado (a hora do pedido), motivo? }
//        contactos: os contactos em terra que o receberam (o chat do Ivo não conta; sem eles, ninguém
//        em terra tem a hora de alarme e o ecrã não marca a precaução)
//   avisos: o que o Ivo deve saber mas não impede o envio (sem o telefone dele na configuração, o
//   plano diz só "liga ao Ivo").
//   GET  /plano-ativo → 404 sem plano { ok: false, erro, envioEmTerra, relogioDesacertadoS }; com ele { agora,
//        estado, pausadoDe, ativadoEm, destino: { id, nome, lat, lon }, tripulacao, idCalculo,
//        indice, alternativa: { id, nome }, partida, saida, chegou, atrasoMin (arredondado para cima, como o
//        aviso do recalcula), proximo: { texto, hora } | null, chegadaAgora, chegadaPlano, chegadaNoite,
//        recursos: { gasoleoChegadaL, bateriaChegadaPct, semLeitura, aviso }, semGps, barometro: { semLeitura,
//        quedaHpa }, previsaoIdadeH, avisos: [{ caminho, state, message }] (os publicados: também em pausa e
//        com o plano fechado), envio: { contactos, alarme (a mais cedo que algum contacto à espera tem: o
//        que lhe chegou — um plano reenviado só quando chega; decisão do Ivo n.º 14), alarmePlano (o deste
//        plano), porContacto: [{ nome, alarme, fechado }] } | null,
//        chegadaOutro: { id, nome } | null,
//        filaContactos: [{ tipo, criada, tentativas, proxima, estado, erro, contactos, parcial }], enviadas: [{ tipo,
//        enviadaEm, contactos, falhas: [{ nome, erro }] }] (parcial: a mesma mensagem só para os contactos que
//        falharam, revisão final I3; os avisos ao Ivo não entram, não são para terra),
//        atrasoRetido: { motivo: 'parado' | 'limite', alarme (a hora de alarme que terra tem) } | null,
//        fechoPorEntregar: { tipo: 'chegada' | 'terminado', contactos, tentativas, erro } | null (auditoria K-12),
//        envioEmTerra: { idCalculo, indice, contactos, alarme } | null (o plano que os contactos em terra têm
//        quando não é este: decisão n.º 15), relogioDesacertadoS: número | null (decisão n.º 19),
//        desistencias: [{ tipo, ref, contactos, em, alarme }] (auditoria I-05, decisão n.º 16) }
//        atrasoRetido (revisão final C1, decisão do Ivo de 02/10): um atraso para terra que as guardas não
//        deixaram sair (o barco parado ou à deriva, ou o teto de 3 h): o ecrã pede o "Estou bem"
//        chegadaOutro (decisão do Ivo de 01/10): em pausa no mar, parado 30 min a menos de 0,3 MN de outro
//        porto da lista (dados/destinos.json): o ecrã pergunta "Chegaste a X?"
//   POST /plano-ativo/estou-bem → { ok, chegada, alarme } (409 sem um atraso retido): o Ivo está bem; sai
//        um atraso com a estimativa de agora e o teto passa a 3 h sobre a hora de alarme dele
//   POST /plano-ativo/terminar → { ok, estado: 'terminado', contactos } (409 sem plano aberto): fecha o
//        plano, os avisos voltam a normal e os contactos recebem "viagem terminada" (contactos: true); sem
//        GPS, com a última posição conhecida e a hora dela (auditoria M-22)
//   POST /plano-ativo/continuar → { ok, estado } (409 se não estiver "pausado" ou se o plano mudou; 502 se
//        a API de rumo falhar): volta a ativar a rota do plano, no ponto seguinte ao da posição na rota
//   POST /plano-ativo/chegada { destino } → { ok, estado: 'chegado', contactos } (409 se o destino não for
//        o porto da sugestão chegadaOutro): fecha o plano e manda "Cheguei bem a X" (só com o toque do Ivo)
//
// Os contactos em terra a navegar (lib/contactos.js): só com o plano enviado a contactos em terra.
// "Cheguei bem" na chegada, o atraso quando a chegada prevista passa da "mais tarde" do plano (no
// máximo 1× por hora; decisão do Ivo de 02/10, "só a avançar + teto de 3 h": só com ≥ 1 MN de progresso
// na rota na última hora, a avançar agora e a ≤ 2 MN da rota, e nunca mais de 3 h sobre a hora de alarme
// do plano sem o "Estou bem" do Ivo; parado ou à deriva não sai nada e fica a hora de alarme que terra
// tem; um atraso já na fila também só sai a navegar e com GPS — em pausa ou com o plano fechado sai da
// fila, sem GPS fica retido: auditoria K-02), "viagem terminada" no Terminar, e o plano novo ao Ativar
// outra alternativa com
// um plano enviado aberto, ou sem ele quando os contactos em terra têm o plano de outra alternativa ou de
// outro cálculo (o último entregue, em ultimo-envio.json, com a hora de alarme por passar e sem "cheguei
// bem"/"terminada"; revisão final I1) (o 422 de um cálculo antigo não ativa nada e o plano antigo fica). Pelo
// mesmo evento 'arlequin:plano' { pedido, tipo, texto, gpx? (só no tipo 'plano'), nomeFicheiro?,
// destinatarios: 'contactos-do-plano', contactos: [nome], chats: [chatId] } (o porto escolhe pelo chatId),
// uma mensagem de cada vez; a fila fica no plano ativo (sem resposta em 30 s ou sem o porto, nova
// tentativa daqui a 2 min; uma que falhou 3 vezes, as do plano anterior e os avisos ao Ivo nunca prendem as
// outras: auditoria K-13). O atraso só conta quando chega a terra (decisão do Ivo de 01/10): a hora de
// alarme de cada contacto é a do que LHE chegou (auditoria I-01), e o "em vez de" é o do último atraso
// entregue; um atraso ainda na fila passa a ter a chegada mais recente e o texto faz-se à hora de sair.
// De um contacto que nunca recebe (a falha é dele: outro ou o Ivo receberam) desiste-se no fim da hora de
// alarme dele e o Ivo é avisado pelo Telegram, só no chat dele (tipo 'aviso'; decisão do Ivo n.º 16).
// Um plano novo (Ativar) começa limpo (decisão do Ivo de 01/10): sem as mensagens enviadas, os atrasos,
// a saída nem a posição do plano antigo; só segue o "cheguei bem"/"terminada" do antigo que ainda não
// saiu. O plano substituído vai para planos-fechados.json (os 5 mais recentes).
// O aviso notifications.rota.alarmeTerra (60 min antes da hora de alarme mais cedo que terra tem) vale com
// o plano aberto, com o plano fechado enquanto o "cheguei bem" não chega a terra (auditoria K-12), e quando
// terra tem um plano que não é o ativo (decisão n.º 15).
//
// O plano (desenho 3b-1): monta o texto e o GPX (lib/plano.js) e emite no servidor o evento
// 'arlequin:plano' { pedido, texto, gpx, nomeFicheiro }; o plugin porto (que tem o bot do Telegram)
// envia-o e responde com 'arlequin:plano-enviado' { pedido, entregues, contactos, falhas }. Sem resposta em
// 30 s, "falhou": o plugin porto não respondeu. Um plano enviado com pelo menos um contacto em terra
// fica no plano ativo (envio: a quem e a hora de alarme), antes ou depois de Ativar a mesma alternativa
// (mandado outra vez, junta-se aos que já o tinham e a hora de alarme volta à do plano: auditoria M-32); um
// envio já fechado (o "cheguei bem" entregue) ou com a hora de alarme passada nunca se reaproveita (decisão
// n.º 13). Um stop() (o SignalK reinicia o plugin sempre que se
// grava a configuração) com planos "a enviar" deixa-os "falhou": a resposta do porto já não chegaria.
// A lista dos planos guarda os 20 mais recentes, mas nunca tira um que ainda está "a enviar".
//
// A navegar (desenho 3b-2): um ciclo de minuto a minuto (setInterval) lê do SignalK a posição, o SOG, o
// vento real e a pressão (cada um com a hora: mais de 2 min, ou sem hora legível, conta como em falta;
// sem posição é "sem GPS"), o gasóleo e o SoC (também só frescos e sem o aviso de sonda/sensor perdido:
// auditoria I-12) e a rota ativa (API de rumo v2, com um limite de 10 s: sem
// resposta não se sabe a rota e o ciclo segue); segue o plano ativo (lib/plano-ativo.js: saída, chegada
// com progresso na rota, rota mudada, a chegada em pausa e a sugestão de outro porto), o acompanhamento
// (lib/acompanhamento.js) com a previsão mais recente arquivada que cubra a posição (previsoes/ da
// pasta dos dados; lida de 10 em 10 min e só as dos últimos 50 h: auditoria M-27), e publica os avisos
// (lib/avisos-navegar.js) em notifications.rota.* por delta, só
// nas mudanças. Com o relógio do Pi a mais de 60 s da hora do GPS o ciclo não corre (decisão n.º 19). As
// amostras da pressão (de minuto a minuto, 3 h) ficam em memória e em barometro.json
// só com um plano aberto, no máximo de 10 em 10 min (e no stop); a posição na rota fica no plano ativo
// (seguimento), para um reinício não a perder. A tendência do barómetro em 3 h vai à AI do vento (I-16).
// Só testes (a viagem acelerada do dev, software/dev/viagem-acelerada.js), e só com modoTeste: true
// (desligado por omissão; sem ele as duas opções não contam): com horaSimulada, a hora do plugin é o
// navigation.datetime do SignalK (sem ele, o ciclo não corre) e o ciclo corre de cicloSegundos em
// cicloSegundos (no mínimo 1 s). No barco fica tudo desligado (o padrão). Com o modoTeste ligado, o estado
// do plugin começa por "MODO DE TESTE (hora simulada, ciclo de 1 s) · …" (vê-se no Plugin Config).
//
// O destino do /calcular: o id de um destino da lista (dados/destinos.json ou os do Ivo),
// 'rota-ativa' (o fim da rota ativa no SignalK/OpenCPN), ou { lat, lon, nome }.
// Nada aqui derruba o servidor: o cálculo corre dentro de try/catch (lib/calculo.js nunca
// lança), todas as promessas acabam em .catch e os pedidos à API do servidor têm limite de tempo (M-24).
// Ao Ivo só frases em pt-PT; o erro verdadeiro fica no registo do SignalK (auditoria I-32).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const c = require('./lib/costa')
const prev = require('./lib/previsao')
const base = require('./lib/base')
const calculo = require('./lib/calculo')
const decisao = require('./lib/decisao')
const plano = require('./lib/plano')
const pa = require('./lib/plano-ativo')
const ac = require('./lib/acompanhamento')
const av = require('./lib/avisos-navegar')
const ct = require('./lib/contactos')
const cenarios = require('./lib/cenarios')
const energiaPlano = require('./lib/energia')
const seguranca = require('./lib/seguranca')
const { slug } = require('./lib/slug')
// os modelos da AI pelo caminho relativo (auditoria I-37), como o lib/base.js faz com a polar: instalado com
// "npm install <pasta>" (o npm 11 só liga a pasta e não instala as dependências dela), o pacote
// signalk-arlequin-ia não está no node_modules da rota. (O lib/cenarios.js ainda o pede pelo nome: ver o
// relatório da F2.)
const modelosJs = require(path.join(__dirname, '..', 'signalk-arlequin-ia', 'lib', 'modelos'))

const MAX_TRABALHOS = 20
const MAX_PLANOS = 20
const LIMITE_PORTO_MS = 30000 // sem resposta do plugin porto em 30 s: "falhou"
const MOTIVO_PORTO = 'o plugin porto não respondeu (está ligado? tem o token?)'
const PORTO_DESLIGADO = 'o plugin porto está desligado: liga-o em Plugin Config'
const SEM_DESTINATARIOS = 'não há destinatários: junta os chats em "Chats autorizados" ou em "Contactos do plano" no plugin porto'
const MOTIVO_REINICIO = 'o plugin da rota foi reiniciado durante o envio: confirma com os contactos se receberam'
const AVISO_SEM_TELEFONE = 'o teu telefone não está na configuração: o plano diz só "liga ao Ivo"'
const eObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
// um erro do próprio plugin, já em pt-PT: chega ao Ivo tal e qual (auditoria I-32)
const erroPt = (msg) => Object.assign(new Error(msg), { pt: true })
const INTERNO = 'erro interno no plugin da rota: o pormenor ficou no registo do SignalK'
const MIN = 60000
const CICLO_MS = 60000 // a navegar: de minuto a minuto
const NOS = 3600 / 1852 // m/s → nós
const SEGUIMENTO_MN = 0.1 // a posição na rota grava-se no plano ativo quando anda isto
const LEITURA_VELHA_MS = 2 * MIN // posição, SOG, vento e pressão com mais de 2 min: em falta
const ESPERA_RUMO_MS = 10000 // a API de rumo sem resposta em 10 s: não se sabe a rota
const BARO_GRAVAR_MS = 10 * MIN // o barometro.json no máximo de 10 em 10 min
// a previsão de agora a navegar (auditoria M-27): lida do arquivo no máximo de 10 em 10 min (ou com uma nova,
// ou 5 MN mais longe), e só as dos últimos 50 h (o aviso "sem previsão" cobre o resto)
const PREVISAO_LER_MS = 10 * MIN
const PREVISAO_LER_MN = 5
const PREVISAO_MAX_IDADE_H = 50
const RELOGIO_MAX_MS = 60000 // decisão do Ivo n.º 19: o relógio do Pi a mais de 60 s da hora do GPS
const CAPACIDADE_AH_ANTIGA = 200 // o valor por omissão do esquema até 02/10 (auditoria I-13)
const AVISO_IVO_MS = 24 * 3600000 // o aviso ao Ivo de uma mensagem que não chegou: tenta-se durante 24 h
// a escrita atómica (com o fsync do ficheiro e da pasta, onde o sistema deixa): uma só, a do lib/previsao.js
const { escreverAtomico } = prev

// A aproximação de um destino avulso (um ponto): 2 pontos iguais e entrada 1, como o costa.js exige
// (o lib/rotas.js junta os pontos repetidos). Os destinos com uma aproximação válida ficam como estão.
const aproximacaoAvulsa = (lat, lon) => ({ aproximacao: [[lat, lon], [lat, lon]], entrada: 1 })
function corrigirAproximacao (d) {
  const ap = d.aproximacao
  const valida = Array.isArray(ap) && ap.length >= 2 && Number.isInteger(d.entrada) && d.entrada >= 1 && d.entrada <= ap.length - 1
  return valida ? d : { ...d, ...aproximacaoAvulsa(d.largo[0], d.largo[1]) }
}

// Os limites de segurança que se podem mudar na configuração (auditoria M-13: o desenho 3a diz
// "configuráveis"; lib/seguranca.js LIMITES), com o título do Admin UI. Os valores são os do lib/seguranca.js.
const TITULOS_LIMITES = Object.freeze({
  ventoMedioMax: 'Vento médio máximo, só eu (nós)',
  rajadaMax: 'Rajada máxima, só eu (nós)',
  ondasMax: 'Ondas máximas, só eu (m)',
  ventoMaxAcompanhado: 'Vento médio máximo, acompanhado (nós)',
  rajadaMaxAcompanhado: 'Rajada máxima, acompanhado (nós)',
  ondasMaxAcompanhado: 'Ondas máximas, acompanhado (m)',
  gasoleoMinL: 'Gasóleo mínimo à chegada, no pior caso (L)',
  bateriaMinPct: 'Bateria mínima à chegada, no pior caso (%)',
  lemeMaxH: 'Horas seguidas ao leme, só eu (máximo)'
})
// os limites postos na configuração: só as chaves de LIMITES e só números (o resto fica no padrão)
const limitesPostos = (x) => Object.fromEntries(seguranca.LIMITES.filter(k => Number.isFinite(x?.[k])).map(k => [k, x[k]]))

// Os valores por defeito de um objeto do schema ({ chave: default }).
const padroes = (esquema) => Object.fromEntries(Object.entries(esquema.properties).map(([k, x]) => [k, x.default]))

// o id de um destino do Ivo: "meu-<slug>"
const slugDestino = (nome) => slug(nome, 30) || 'destino'

module.exports = function (app, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a))
  const relogioBase = deps.relogio || (() => Date.now())
  // a hora do plugin: a do navigation.datetime com horaSimulada (só testes, com modoTeste), senão a do relógio
  const simulada = () => !!(o?.modoTeste === true && o?.horaSimulada === true)
  const horaSimulada = () => (simulada() ? Date.parse(app.getSelfPath?.('navigation.datetime')?.value) : NaN)
  const relogio = () => { const t = horaSimulada(); return Number.isFinite(t) ? t : relogioBase() }
  const esperar = deps.esperar || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
  // o relógio do limite do porto (injetável nos testes)
  const agendar = deps.agendar || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t })
  const cancelar = deps.cancelar || ((t) => clearTimeout(t))
  // o ciclo a navegar (injetável nos testes, que o chamam à mão com plugin.cicloNavegar)
  const agendarCiclo = deps.agendarCiclo || ((fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t })
  const pararCiclo = deps.pararCiclo || ((t) => clearInterval(t))
  const esperaRumoMs = deps.esperaRumoMs ?? ESPERA_RUMO_MS
  // ---------- os erros que chegam ao Ivo (auditoria I-32) ----------
  // Ao ecrã e ao Telegram só frases em pt-PT: o erro verdadeiro (do servidor, do Node — muitas vezes em
  // inglês) fica no registo do SignalK (app.error). Os erros do próprio plugin (erroPt) passam tal e qual.
  const esgotou = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError' || /aborted|timed? ?out/i.test(String(e?.message ?? ''))
  const semLigacao = (e) => /fetch failed|sem rede|ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|network/i.test(String(e?.message ?? ''))
  // a API de recursos/rumo do servidor (ativar a rota, Continuar)
  function motivoSignalK (e, registo) {
    if (e?.pt) return e.message
    const m = String(e?.message ?? e ?? '')
    app.error(`${registo}: ${m}`)
    if (/Unable to retrieve vessel position/i.test(m)) return 'o SignalK ainda não tem a posição do barco (sem GPS?)'
    if (esgotou(e)) return 'o SignalK não respondeu a tempo'
    if (semLigacao(e)) return 'sem ligação ao SignalK'
    return 'o SignalK recusou a rota (o pormenor ficou no registo)'
  }
  // a previsão descarregada (os erros do lib/previsao.js com a Open-Meteo já estão em pt-PT)
  function motivoPrevisao (e) {
    const m = String(e?.message ?? e ?? '')
    app.error(`previsão: ${m}`)
    if (esgotou(e)) return 'a Open-Meteo não respondeu a tempo'
    if (semLigacao(e)) return 'sem rede'
    if (/Open-Meteo/.test(m)) return m
    return 'a previsão não veio (o pormenor ficou no registo)'
  }
  // um erro de programação: a frase fixa, o pormenor no registo
  function motivoInterno (e, registo) {
    if (e?.pt) return e.message
    app.error(`${registo}: ${e?.message ?? e}`)
    return INTERNO
  }

  const plugin = {
    id: 'signalk-arlequin-rota',
    name: 'Arlequin · Melhor rota',
    description: 'Calcula as 3 melhores alternativas até um destino (previsão, maré, costa, AI) e ativa a rota escolhida'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      pasta: { type: 'string', title: 'Pasta dos dados da caixa negra (previsões e modelos da AI)', default: '~/arlequin-dados' },
      afastamentoMinimo: { type: 'number', title: 'Afastamento mínimo da costa fora das aproximações (MN)', default: seguranca.PADRAO.afastamentoMinimo },
      rpmCruzeiro: { type: 'number', title: 'Rotação de cruzeiro do motor (rpm)', default: base.RPM_CRUZEIRO },
      polar: { type: 'string', title: 'Ficheiro da polar (CSV do ecrã)', default: base.POLAR_PADRAO },
      previsoes: { type: 'boolean', title: 'Descarregar a previsão (Open-Meteo); desligado usa só as guardadas', default: true },
      bateria: { type: 'string', title: 'ID do banco de serviço (electrical.batteries.<id>)', default: 'servico' },
      deposito: { type: 'string', title: 'Depósito de gasóleo (tanks.fuel.<id>)', default: '0' },
      socDesconhecido: { type: 'number', title: 'SoC a assumir sem leitura da bateria (0–1)', default: 0.8 },
      gasoleoDesconhecidoL: { type: 'number', title: 'Gasóleo a assumir sem leitura do depósito (L)', default: 100 },
      // o banco de serviço de 440 Ah (bancos 2 + 3) e o solar com perdas (decisão do Ivo n.º 4, auditoria
      // I-13, contrato C5): os mesmos valores do lib/energia.js (PADRAO)
      energia: {
        type: 'object',
        title: 'Bateria de serviço (planeamento)',
        properties: {
          capacidadeAh: { type: 'number', title: 'Capacidade do banco de serviço (Ah)', default: energiaPlano.PADRAO.capacidadeAh },
          consumoDiaA: { type: 'number', title: 'Consumo de dia (A)', default: 4.5 },
          consumoNoiteA: { type: 'number', title: 'Consumo de noite (A)', default: 6 },
          paineis: { type: 'number', title: 'Painéis solares', default: 2 },
          areaPainelM2: { type: 'number', title: 'Área de cada painel (m²)', default: 1.65 },
          rendimento: { type: 'number', title: 'Rendimento dos painéis', default: 0.2 },
          fatorSolar: { type: 'number', title: 'Perdas do solar: fator 0–1 (regulador, sombras, painéis deitados)', default: energiaPlano.PADRAO.fatorSolar },
          alternadorA: { type: 'number', title: 'Alternador com o motor ligado (A)', default: 45 }
        }
      },
      // os limites de segurança do desenho 3a (auditoria M-13): o cálculo e os avisos dos recursos a navegar
      seguranca: {
        type: 'object',
        title: 'Limites de segurança (os do desenho; mudar só com razão)',
        properties: Object.fromEntries(seguranca.LIMITES.map(k => [k, { type: 'number', title: TITULOS_LIMITES[k] || k, default: seguranca.PADRAO[k] }]))
      },
      porta: { type: 'number', title: 'Porta do SignalK (só se a API interna faltar)', default: 3000 },
      modoTeste: { type: 'boolean', title: 'Só testes (dev): liga as duas opções seguintes; no barco, SEMPRE desligado', default: false },
      horaSimulada: { type: 'boolean', title: 'Só testes (com o modo de teste): a hora vem do navigation.datetime (viagem acelerada); no barco, desligado', default: false },
      cicloSegundos: { type: 'number', title: 'Só testes (com o modo de teste): o ciclo a navegar (s, no mínimo 1); no barco, 60', default: 60 },
      // o plano de navegação pelo Telegram (desenho 3b-1): os campos vazios ficam de fora do texto
      barco: {
        type: 'object',
        title: 'O barco (para o plano de navegação)',
        properties: {
          nome: { type: 'string', title: 'Nome', default: 'ARLEQUIN' },
          modelo: { type: 'string', title: 'Modelo', default: 'Jeanneau Melody 34' },
          corCasco: { type: 'string', title: 'Cor do casco', default: '' },
          mmsi: { type: 'string', title: 'MMSI', default: '' },
          indicativo: { type: 'string', title: 'Indicativo de chamada', default: '' }
        }
      },
      telefones: {
        type: 'object',
        title: 'Telefones do plano (hora de alarme)',
        properties: {
          ivo: { type: 'string', title: 'Telefone do Ivo', default: '' },
          emergencia: { type: 'string', title: 'Emergência', default: plano.EMERGENCIA_PADRAO }
        }
      }
    }
  }

  let o = null
  let pastaBase = null
  let dirPlugin = null
  let costaBase = null
  let polar = null
  let erroArranque = null
  let aCorrer = null // id do cálculo em curso
  let aAtivar = false // um Ativar a meio (auditoria M-21: o 2.º toque dá 409)
  const trabalhos = new Map()
  const planos = new Map() // pedido → { id, indice, estado, entregues, contactos, falhas, avisos, motivo?, criado, enviadoEm?, temporizador }
  let planoAtivo = null // o plano ativo (lib/plano-ativo.js), também em plano-ativo.json
  // a navegar: os estados do ciclo (em memória; num reinício os temporizadores recomeçam)
  let memPlano = pa.novaMemoria()
  let estAcomp = ac.novoEstado()
  let estAvisos = av.novoEstado()
  let publicados = {} // caminho → { state, chave } do que está publicado em notifications.rota.*
  let avisosPublicados = {} // os últimos avisos publicados (caminho → { state, message, … }), para o GET
  let pressoes = [] // [{ t, hPa }] de minuto a minuto (em memória; barometro.json com um plano aberto)
  let baroGravadoEm = null // a última gravação do barometro.json
  let baroPorGravar = false
  let portos = [] // os portos da lista (dados/destinos.json): { id, nome, cais } (a sugestão em pausa)
  let ventos = [] // [{ t, medido, previsto }] (10 min)
  let ultimaPosicao = null
  let ultimo = null // o último resultado do acompanhamento
  let cicloTimer = null
  let aCorrerCiclo = false
  let modelosVento = {}
  const pedidosContactos = new Map() // pedido → temporizador dos 30 s (as mensagens para terra)
  // o atraso para terra retido pelas guardas (revisão final C1): { motivo: 'parado' | 'limite' } ou null
  // (em memória: o ciclo seguinte volta a decidir)
  let retido = null

  let afastGravado = null // o afastamento máximo da partida da última gravação do plano

  // ---------- o relógio do Pi contra a hora do GPS (decisão do Ivo n.º 19) ----------
  // A hora de alarme que vai para terra e a frescura das leituras saem do relógio do Pi. Com ele a mais de 60 s
  // da hora do GPS (navigation.datetime), o envio do plano dá 422, o ciclo a navegar não corre (nada sai para
  // terra; o aviso notifications.rota.relogio diz porquê) e o GET diz relogioDesacertadoS. A hora do GPS só
  // conta enquanto muda (um GPS parado ou desligado não é um relógio errado: não se sabe, e o ciclo corre).
  // Com a hora simulada (só testes) o relógio do plugin é o próprio navigation.datetime.
  let dataGps = null // { g: a hora do GPS (ms), em: a hora do plugin em que a vi mudar, desvio (ms) | null }
  let desacertoAtual = null // o do último ciclo (ms, Pi − GPS) quando passa os 60 s; senão null
  function desacertoRelogio (agora) {
    if (simulada()) return null
    const g = Date.parse(app.getSelfPath?.('navigation.datetime')?.value)
    if (!Number.isFinite(g)) { dataGps = null; return null }
    if (!dataGps) { dataGps = { g, em: agora, desvio: null }; return null }
    if (g !== dataGps.g) dataGps = { g, em: agora, desvio: agora - g }
    else if (agora - dataGps.em > LEITURA_VELHA_MS || agora < dataGps.em) return null
    return dataGps.desvio
  }
  function relogioErrado (agora) {
    const d = desacertoRelogio(agora)
    return Number.isFinite(d) && Math.abs(d) > RELOGIO_MAX_MS ? d : null
  }
  const minutosDesacerto = (d) => `${Math.max(1, Math.round(Math.abs(d) / MIN))} min`
  const recusaRelogio = (d) => `o relógio do Pi está desacertado ${minutosDesacerto(d)} da hora do GPS: a hora de alarme sairia errada — acerta a hora antes de enviar o plano`
  // O estado do plugin (Plugin Config); com o modoTeste ligado, à frente (re-revisão M-4): "MODO DE TESTE
  // (hora simulada, ciclo de 1 s) · …", para nunca passar despercebido no barco
  let modoTesteTexto = ''
  function estadoPlugin (texto) { app.setPluginStatus(`${modoTesteTexto}${texto}`) }
  // O último plano entregue a contactos em terra (revisão final I1), em ultimo-envio.json (escrita atómica,
  // vale depois de um reinício): { idCalculo, indice, contactos, chats, alarme (a hora de alarme mais tarde
  // que terra tem: até lá ainda espera notícias), alarmeMaisCedo? (a mais cedo, quando os contactos têm horas
  // diferentes: auditoria I-01), enviadoEm, fechado } — fechado com o "cheguei bem"/"terminada" entregue
  // (terra já não espera).
  const ficheiroUltimoEnvio = () => path.join(dirPlugin, 'ultimo-envio.json')
  function lerUltimoEnvio () {
    try {
      const x = JSON.parse(fs.readFileSync(ficheiroUltimoEnvio(), 'utf8'))
      return eObjeto(x) && Array.isArray(x.contactos) ? x : null
    } catch { return null }
  }
  function gravarUltimoEnvio (x) {
    try { escreverAtomico(ficheiroUltimoEnvio(), JSON.stringify(x)) } catch (e) { app.error(`não gravei o último envio: ${e.message}`) }
  }
  // O do plano ativo (o envio dele chegou a terra, ou um atraso dele): passa a ser o último entregue.
  // alarme: a mais tarde que algum contacto tem (até lá terra ainda espera notícias); alarmeMaisCedo: a mais
  // cedo (a do aviso de 60 min, auditoria I-01).
  function ultimoEnvioDoPlano () {
    const p = planoAtivo
    const terra = terraDe(p)
    const tarde = ct.alarmeMaisTarde(terra)
    if (!p?.envio?.contactos?.length || !Number.isFinite(tarde)) return
    gravarUltimoEnvio({ idCalculo: p.idCalculo, indice: p.indice, contactos: [...p.envio.contactos], chats: [...(p.envio.chats || [])], alarme: new Date(tarde).toISOString(), alarmeMaisCedo: new Date(ct.alarmeMaisCedo(terra)).toISOString(), enviadoEm: p.envio.enviadoEm ?? null, fechado: false })
  }
  // O último entregue em terra que ainda conta: com contactos, sem "cheguei bem"/"terminada" e com a hora de
  // alarme por passar; senão null.
  function envioEmTerra (agora) {
    const x = lerUltimoEnvio()
    if (!x || x.fechado || !x.contactos.length || !(Date.parse(x.alarme) > agora)) return null
    return x
  }
  function gravarPlanoAtivo () {
    try { pa.gravar(dirPlugin, planoAtivo); afastGravado = planoAtivo?.afastamentoMaxMn ?? null } catch (e) { app.error(`não gravei o plano ativo: ${e.message}`) }
  }
  // O envio de uma alternativa (o mais recente com contactos em terra): { contactos, alarme, pedido, enviadoEm } ou null.
  // Um envio já fechado (o "cheguei bem"/"terminada" desse plano entregue) nunca se reaproveita, nem um cuja
  // hora de alarme já passou (decisão do Ivo n.º 13, auditoria I-03): numa 2.ª viagem com o mesmo cálculo a
  // Mãe recebia "Ainda a navegar, tudo bem" de uma viagem de que não recebeu plano.
  function envioDe (id, indice, alt) {
    const alarme = plano.horaAlarme(alt)
    if (alarme != null && alarme <= relogio()) return null
    const enviados = [...planos].filter(([, x]) => x.id === id && x.indice === indice && x.estado === 'enviado' && x.contactos.length && !x.fechado)
    const ultimo = enviados.at(-1)
    if (!ultimo) return null
    return { contactos: [...ultimo[1].contactos], chats: [...(ultimo[1].chats || [])], alarme: alarme == null ? null : new Date(alarme).toISOString(), pedido: ultimo[0], enviadoEm: ultimo[1].enviadoEm }
  }

  // A resposta do plugin porto a um plano: "enviado" com pelo menos uma entrega; sem nenhuma,
  // "falhou" com as falhas (ou sem destinatários). Uma resposta depois do limite já não conta.
  // Corre dentro do emit do porto (auditoria M-25): um erro aqui não pode rebentar lá; fica no registo.
  function aoPlanoEnviado (m) {
    try { tratarPlanoEnviado(m) } catch (e) { app.error(`resposta do porto: ${e?.message ?? e}`) }
  }
  function tratarPlanoEnviado (m) {
    if (eObjeto(m) && pedidosContactos.has(m.pedido)) return respostaContactos(m)
    const p = eObjeto(m) ? planos.get(m.pedido) : null
    if (!p || p.estado !== 'a enviar') return
    cancelar(p.temporizador)
    p.entregues = Array.isArray(m.entregues) ? m.entregues.map(String) : []
    // um porto antigo não manda os contactos: nenhum em terra (o ecrã avisa)
    p.contactos = Array.isArray(m.contactos) ? m.contactos.map(String) : []
    // os chatId dos contactos em terra entregues (o porto escolhe por eles nas mensagens a navegar)
    p.chats = Array.isArray(m.chats) ? m.chats.map(String) : []
    p.falhas = Array.isArray(m.falhas) ? m.falhas.filter(eObjeto).map(f => ({ nome: String(f.nome ?? ''), erro: String(f.erro ?? '') })) : []
    p.estado = p.entregues.length ? 'enviado' : 'falhou'
    p.enviadoEm = new Date(relogio()).toISOString()
    if (!p.entregues.length) p.motivo = p.falhas.length ? p.falhas.map(f => `${f.nome}: ${f.erro}`).join('; ') : SEM_DESTINATARIOS
    // entregue em terra: o último envio (revisão final I1)
    if (p.contactos.length) {
      const alarme = plano.horaAlarme(trabalhos.get(p.id)?.resultado?.alternativas?.[p.indice])
      if (alarme != null) gravarUltimoEnvio({ idCalculo: p.id, indice: p.indice, contactos: [...p.contactos], chats: [...p.chats], alarme: new Date(alarme).toISOString(), enviadoEm: p.enviadoEm, fechado: false })
    }
    // enviado depois de Ativar a mesma alternativa: fica no plano ativo
    if (pa.aberto(planoAtivo) && p.contactos.length && p.id === planoAtivo.idCalculo && p.indice === planoAtivo.indice) {
      const alt = trabalhos.get(p.id)?.resultado?.alternativas?.[p.indice]
      const envio = alt && envioDe(p.id, p.indice, alt)
      // quem o recebeu passa a ter a hora de alarme do plano (auditoria I-01) e o atraso volta a decidir-se
      // contra ela (auditoria M-32: antes ficava o atraso entregue antes, e terra tinha uma hora e o barco
      // outra); os que já tinham o plano e não o receberam outra vez continuam no envio (ninguém com uma hora
      // de alarme fica sem o "cheguei bem")
      if (envio) {
        planoAtivo = { ...planoAtivo, envio: { ...envio, ...unirContactos(planoAtivo.envio, envio) }, atrasoEnviado: null, estouBem: null, terra: ct.terraEntregue(terraDe(planoAtivo), { contactos: p.contactos, chats: p.chats }, { alarme: Date.parse(envio.alarme) }) }
        ultimoEnvioDoPlano()
        gravarPlanoAtivo()
      }
    }
  }
  // Os contactos de dois envios juntos ({ contactos, chats }, pela mesma ordem), sem repetir (pelo chatId; sem
  // ele, pelo nome): quem já tinha um plano não sai do envio por o plano ir a mais alguém.
  function unirContactos (a, b) {
    const contactos = [...(a?.contactos || [])].map(String)
    const chats = [...(a?.chats || [])].map(String)
    const porChat = chats.length === contactos.length
    for (const [i, nome0] of (b?.contactos || []).entries()) {
      const nome = String(nome0)
      const chat = b?.chats?.[i] != null ? String(b.chats[i]) : null
      const ja = porChat && chat != null ? chats.includes(chat) : contactos.includes(nome)
      if (ja) continue
      contactos.push(nome)
      if (chat != null) chats.push(chat)
    }
    return { contactos, chats }
  }
  // Os mais antigos saem primeiro, mas nunca um "a enviar" (o ecrã ainda o está a seguir).
  function guardarPlano (pedido, p) {
    planos.set(pedido, p)
    while (planos.size > MAX_PLANOS) {
      const velho = [...planos].find(([, x]) => x.estado !== 'a enviar')
      if (!velho) break
      planos.delete(velho[0])
    }
  }

  const v = (p) => app.getSelfPath?.(p)?.value
  const ficheiroMeus = () => path.join(dirPlugin, 'destinos.json')

  // Os destinos do Ivo. Os gravados antes da revisão final (aproximação de 1 ponto, entrada 0) não
  // passavam no costa.verificarAproximacao ("entrada mal definida"): corrigem-se ao ler, com a
  // aproximação do destino avulso (2 pontos iguais no largo, entrada 1).
  function meusDestinos () {
    try {
      const l = JSON.parse(fs.readFileSync(ficheiroMeus(), 'utf8'))
      return Array.isArray(l) ? l.filter(d => eObjeto(d) && typeof d.id === 'string' && Array.isArray(d.largo)).map(corrigirAproximacao) : []
    } catch { return [] }
  }
  // A costa com os destinos da lista mais os do Ivo (estes marcados `meu`).
  function costaAtual () {
    return { ...costaBase, destinos: [...costaBase.destinos, ...meusDestinos().map(d => ({ ...d, meu: true }))] }
  }

  // oo: as opções com que se lê (um cálculo a correr fica com as do início, mesmo que o plugin pare)
  // Auditoria I-12: o gasóleo e o SoC só contam com leitura fresca (≤ 2 min, como a posição, o vento e a
  // pressão a navegar) e sem o aviso do próprio plugin de que a leitura não é medida — a sonda do gasóleo
  // perdida (o plugin continua a publicar os litros descontados pelo consumo) ou o SmartShunt calado (o
  // valor fica na árvore). Fora disso são desconhecidos (falha segura): o cálculo assume o valor da
  // configuração com aviso vermelho em cada alternativa, e a navegar fica "recursos: sem leitura". A
  // capacidade do depósito é da configuração do plugin e não envelhece. (A rota não lê as rotações do motor.)
  function instrumentos (oo = o, agora = relogio()) {
    const pos = v('navigation.position')
    const avisoAtivo = (caminho) => { const st = app.getSelfPath?.(caminho)?.value?.state; return typeof st === 'string' && st !== 'normal' }
    const soc = avisoAtivo('notifications.arlequin.energia.sensorPerdido') ? null : numeroFresco(`electrical.batteries.${oo.bateria}.capacity.stateOfCharge`, agora)
    const semSonda = avisoAtivo(`notifications.tanks.fuel.${oo.deposito}.sondaPerdida`)
    const vol = semSonda ? null : numeroFresco(`tanks.fuel.${oo.deposito}.currentVolume`, agora)
    const nivel = semSonda ? null : numeroFresco(`tanks.fuel.${oo.deposito}.currentLevel`, agora)
    const cap = v(`tanks.fuel.${oo.deposito}.capacity`)
    const gasoleoL = Number.isFinite(vol) ? vol * 1000 : Number.isFinite(nivel) && Number.isFinite(cap) ? nivel * cap * 1000 : null
    return {
      posicao: pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude) ? { lat: pos.latitude, lon: pos.longitude } : null,
      socPct: Number.isFinite(soc) ? soc * 100 : null,
      gasoleoL,
      // a tendência do barómetro em 3 h (hPa, pressão agora − há 3 h), das amostras de minuto a minuto que o
      // plugin guarda, como no treino do modelo do vento (auditoria I-16; sem 3 h de amostras, null)
      tendPressao3h: cenarios.tendenciaPressao3h(pressoes, agora)
    }
  }

  // Os modelos da AI em uso (sem modelo ou ilegível: null, e fica a polar e a curva da Volvo).
  function modelosAi () {
    const pasta = path.join(pastaBase, 'modelos')
    const modelos = modelosJs.carregarModelos(pasta, (nome, e) => app.error(`modelo ${nome} ilegível: ${e.message}`))
    const versoes = Object.fromEntries(modelosJs.NOMES.map(n => [n, modelos[n] ? modelosJs.versaoAtual(pasta, n) : null]))
    return { modelos, versoes }
  }

  // A previsão: descarrega (e arquiva em previsoes/); sem rede, a guardada mais recente que cubra a rota.
  // Com as opções e a pasta do início do cálculo (oo, pasta): stop() a meio não as apaga.
  const obterPrevisaoCom = (oo, pastaDados) => async function obterPrevisao ({ pontos, desde, ate, agora }) {
    const pasta = path.join(pastaDados, 'previsoes')
    let erroRede = null
    if (oo.previsoes) {
      try {
        let p = await prev.obterPrevisao({ pontos, agora, fetch: fetchFn })
        try { prev.guardarArquivo(pasta, p) } catch (e) { app.error(`não arquivei a previsão: ${e.message}`) }
        // auditoria M-11: o vento chegou e o pedido do mar falhou — as ondas da previsão guardada mais recente
        // que as tem (o lib/calculo.js põe o aviso "Ondas da previsão guardada há N h"); sem nenhuma, ficam
        // desconhecidas ("Sem previsão do mar")
        if (p.marFalhou) {
          const a = prev.lerArquivo(pasta, { pontos, desde, ate, agora, soComOndas: true })
          if (!a.erro) p = prev.juntarMarDoArquivo(p, a.previsao)
        }
        return { previsao: p, obtida: p.obtida, idadeH: 0, aviso: null, texto: null }
      } catch (e) { erroRede = motivoPrevisao(e) }
    }
    const a = prev.lerArquivo(pasta, { pontos, desde, ate, agora })
    if (a.erro) return { erro: erroRede ? `${erroRede} e ${a.erro}` : a.erro }
    return a
  }

  // A API de rumo v2 com um limite (10 s): sem resposta, undefined (o ciclo nunca fica parado à espera).
  function curso () {
    let t = null
    const limite = new Promise(resolve => { t = setTimeout(() => resolve(undefined), esperaRumoMs); t.unref?.() })
    return Promise.race([Promise.resolve().then(() => app.getCourse()), limite]).finally(() => clearTimeout(t))
  }

  // Um pedido à API do servidor com o mesmo limite da API de rumo (10 s; auditoria M-24): pendurado, rejeita
  // com "o SignalK não respondeu a tempo" (antes um getResource pendurado deixava o /calcular a dar 409, e o
  // Ativar preso, até reiniciar o servidor).
  const NAO_RESPONDEU = 'o SignalK não respondeu a tempo'
  function comLimite (fn) {
    let t = null
    const limite = new Promise((resolve, reject) => { t = setTimeout(() => reject(erroPt(NAO_RESPONDEU)), esperaRumoMs); t.unref?.() })
    return Promise.race([Promise.resolve().then(fn), limite]).finally(() => clearTimeout(t))
  }

  // O fim da rota ativa no SignalK (API de rumo v2), para o destino 'rota-ativa'.
  async function pontosRotaAtiva () {
    const c0 = typeof app.getCourse === 'function' ? await curso() : null
    const href = c0?.activeRoute?.href
    if (!href) return null
    const id = href.split('/').pop()
    let r
    try { r = await comLimite(() => app.resourcesApi?.getResource?.('routes', id)) } catch (e) {
      app.error(`rota ativa: ${e?.message ?? e}`)
      throw erroPt('não consegui ler a rota ativa do SignalK (o pormenor ficou no registo)')
    }
    const coords = r?.feature?.geometry?.coordinates
    return Array.isArray(coords) && coords.length ? coords.map(([lon, lat]) => ({ lat, lon })) : null
  }

  // ---------- os contactos em terra ----------
  // Uma mensagem para a fila do plano ativo, aos contactos entregues do plano (sem eles, nada).
  function porMensagem (tipo, texto, agora, extra = {}) {
    const contactos = planoAtivo?.envio?.contactos
    if (!contactos?.length) return false
    // a hora de alarme que CADA um destes contactos tem (desistePor): passada a dele, desiste-se dele se nunca
    // a recebe (auditoria I-05, decisão do Ivo n.º 16; F2b Importante 1: a de cada um, não a mais tarde de todos)
    const chats = planoAtivo.envio.chats || []
    const { desistePor, desisteEm: tarde } = ct.desistePorDe(terraDe(), { contactos, chats })
    const desisteEm = Number.isFinite(tarde) ? tarde : Date.parse(planoAtivo.envio.alarme)
    planoAtivo = { ...planoAtivo, contactos: ct.porNaFila(planoAtivo.contactos || ct.novaFila(), { tipo, texto, contactos, chats, idCalculo: planoAtivo.idCalculo, indice: planoAtivo.indice, ...(Number.isFinite(desisteEm) ? { desisteEm } : {}), desistePor, ...extra }, agora) }
    return true
  }
  function falharContactos (pedido, motivo) {
    if (!planoAtivo?.contactos) return
    planoAtivo = { ...planoAtivo, contactos: ct.falhou(planoAtivo.contactos, pedido, motivo, relogio()) }
    gravarPlanoAtivo()
  }
  // A próxima mensagem da fila, se for a hora dela (uma de cada vez).
  // Auditoria K-02: um atraso automático ("Ainda a navegar, tudo bem", sem o "Estou bem" do Ivo) só sai
  // com o plano "a navegar" e com GPS — é o caso para que existe a hora de alarme (o barco à deriva, a
  // antena perdida, a rede a voltar). Em pausa, à espera de sair ou com o plano fechado sai da fila; sem
  // GPS fica retido (nem sai nem prende as outras) até o GPS voltar; com GPS volta a decidir-se com os
  // valores de agora (re-revisão M-2): sai da fila se deixou de valer ou se o barco parou entretanto
  // (revisão final C1) — o ciclo seguinte cria outro se for caso disso. O parcial (revisão final I3, só
  // para quem falhou) vai igual ao que os outros receberam — a mesma ref —, mas também só com o barco a
  // avançar e ainda atrasado: quando não pode sair fica RETIDO, como sem GPS, e volta a avaliar-se no ciclo
  // seguinte; nunca se tira da fila por isso (revisão da F2, F2b Importante 2: um só ciclo "parado" numa
  // curva apagava-o para sempre, sem desistência nem aviso ao Ivo). Só sai pela desistência (decisão n.º
  // 16), por um atraso novo o substituir, ou pelo "cheguei bem"/"terminada".
  function enviarFila (agora) {
    if (!planoAtivo?.contactos) return
    // auditoria I-05 (decisão do Ivo n.º 16): de quem nunca recebe, desiste-se no fim da hora de alarme que ESSE
    // contacto tem (terra; F2b Importante 1), e o Ivo é avisado pelo Telegram (só o chat dele) para lhe ligar
    const des = ct.desistir(planoAtivo.contactos, agora, { terra: terraDe() })
    if (des.desistidas.length) {
      let c = des.c
      for (const m of des.desistidas) {
        app.error(`desisti de entregar a mensagem ${m.ref} (${m.tipo}) a ${(m.contactos || []).join(', ') || 'o Ivo'}: ${m.erro || 'nunca chegou'}`)
        if (m.tipo !== 'aviso') c = ct.porNaFila(c, { tipo: 'aviso', texto: ct.textoDesisti(m), contactos: [], chats: [], desisteEm: agora + AVISO_IVO_MS }, agora)
      }
      planoAtivo = { ...planoAtivo, contactos: c }
      gravarPlanoAtivo()
    }
    if (planoAtivo.estado !== pa.ESTADOS.NAVEGAR && planoAtivo.contactos.fila.some(m => m.estado === 'fila' && ct.atrasoAutomatico(m))) {
      planoAtivo = { ...planoAtivo, contactos: ct.tirarSe(planoAtivo.contactos, ct.atrasoAutomatico) }
      gravarPlanoAtivo()
    }
    // (com o relógio do Pi desacertado, o último acompanhamento já não vale: decisão n.º 19)
    const comLeitura = desacertoAtual == null && ultimo?.estado === pa.ESTADOS.NAVEGAR && !ultimo.semGps
    // o parcial é um atraso que os outros já receberam: vale enquanto o barco estiver atrasado (como o 1.º
    // atraso, 30 min sobre a "mais tarde"), não pela regra do 1× por hora; e conta com a hora de alarme que
    // os outros já receberam (o teto foi visto quando saiu). Quando não pode sair fica retido (saltar).
    const parcialRetido = (m) => !comLeitura || !atrasoAgora(ultimo, agora, null) || retencao(ultimo, { alarme: m.alarme }, agora) != null
    let m0 = ct.proxima(planoAtivo.contactos, agora, { saltar: (m) => ct.atrasoAutomatico(m) && (m.parcial ? parcialRetido(m) : !comLeitura) })
    if (!m0) return
    if (ct.atrasoAutomatico(m0) && !m0.parcial) {
      const d = atrasoAgora(ultimo, agora)
      if (!d || retencao(ultimo, d, agora)) {
        planoAtivo = { ...planoAtivo, contactos: ct.tirar(planoAtivo.contactos, m0.id) }
        gravarPlanoAtivo()
        return enviarFila(agora)
      }
      planoAtivo = { ...planoAtivo, contactos: ct.atualizarAtraso(planoAtivo.contactos, m0.id, { chegada: d.chegada, alarme: d.alarme }) }
      m0 = planoAtivo.contactos.fila.find(x => x.id === m0.id)
    }
    const pedido = crypto.randomUUID()
    // o atraso diz "em vez de" o último alarme entregue em terra (o texto faz-se à hora de sair)
    const texto = m0.tipo === 'atraso' && !m0.anterior && !m0.parcial && Number.isFinite(m0.chegada) ? textoAtraso(m0, agora) : null
    planoAtivo = { ...planoAtivo, contactos: ct.marcarAEnviar(planoAtivo.contactos, m0.id, pedido, agora, texto) }
    const m = planoAtivo.contactos.fila.find(x => x.id === m0.id)
    gravarPlanoAtivo()
    if (typeof app.emit !== 'function' || app.listenerCount?.('arlequin:plano') === 0) return falharContactos(pedido, PORTO_DESLIGADO)
    const t = agendar(() => {
      pedidosContactos.delete(pedido)
      if (planoAtivo?.contactos?.fila?.some(x => x.pedido === pedido)) falharContactos(pedido, MOTIVO_PORTO)
    }, LIMITE_PORTO_MS)
    pedidosContactos.set(pedido, t)
    try { app.emit('arlequin:plano', ct.evento(m, pedido)) } catch (e) {
      cancelar(t)
      pedidosContactos.delete(pedido)
      app.error(`mensagem para terra: ${e?.message ?? e}`)
      falharContactos(pedido, 'não foi possível enviar: o plugin porto deu um erro (o pormenor ficou no registo)')
    }
  }
  function respostaContactos (m) {
    cancelar(pedidosContactos.get(m.pedido))
    pedidosContactos.delete(m.pedido)
    if (!planoAtivo?.contactos) return
    const agora = relogio()
    const msg = planoAtivo.contactos.fila.find(x => x.pedido === m.pedido)
    planoAtivo = { ...planoAtivo, contactos: ct.resposta(planoAtivo.contactos, m.pedido, m, agora) }
    const enviada = planoAtivo.contactos.enviadas.at(-1)
    const entregue = !!msg && !msg.anterior && enviada?.id === msg.id
    // a hora de alarme de cada contacto que a recebeu (auditoria I-01): a do plano novo, a do atraso, ou
    // fechado com o "cheguei bem"/"terminada"
    if (entregue) {
      const upd = msg.tipo === 'chegada' || msg.tipo === 'terminado' ? { fechado: true }
        : msg.tipo === 'atraso' ? { alarme: enviada.alarme }
          : msg.tipo === 'plano' ? { alarme: Number.isFinite(msg.alarme) ? msg.alarme : Date.parse(planoAtivo.envio?.alarmePendente ?? planoAtivo.envio?.alarme) }
            : null
      if (upd) planoAtivo = { ...planoAtivo, terra: ct.terraEntregue(terraDe(planoAtivo), enviada, upd) }
    }
    // o plano novo entregue: o envio passa a ser este (a quem chegou, mais os que falharam e estão a
    // receber o parcial, revisão final I3)
    if (entregue && msg.tipo === 'plano' && planoAtivo.envio && !msg.parcial) {
      const { alarmePendente, ...envio } = planoAtivo.envio
      // (os que já estavam no envio ficam: auditoria M-32)
      const quem = unirContactos(envio, juntarContactos(enviada, planoAtivo.contactos.fila.find(x => x.parcial && x.ref === msg.ref)))
      // a hora de alarme do plano novo passa a contar agora que chegou (re-revisão M-3)
      planoAtivo = { ...planoAtivo, envio: { ...envio, ...(alarmePendente !== undefined ? { alarme: alarmePendente } : {}), ...quem, pedido: m.pedido, enviadoEm: enviada.enviadaEm } }
    }
    // o atraso só conta quando chega a terra: a hora de alarme do GET e o "em vez de" seguintes (o parcial
    // é o mesmo atraso, para quem falhou: não conta outra vez)
    if (entregue && msg.tipo === 'atraso' && !msg.parcial && Number.isFinite(enviada.chegada)) planoAtivo = { ...planoAtivo, atrasoEnviado: { ultimoEm: agora, chegada: enviada.chegada, alarme: enviada.alarme } }
    // o último envio em terra (revisão final I1): o plano novo ou o atraso entregues; o "cheguei bem" ou a
    // "terminada" entregues fecham-no
    if (entregue && (msg.tipo === 'plano' || msg.tipo === 'atraso')) ultimoEnvioDoPlano()
    // auditoria I-04: só fecha o envio do plano da mensagem (um "cheguei bem" atrasado da viagem 1 não fecha
    // o plano da viagem 2 que entretanto foi mandado); uma mensagem antiga sem o plano, só a deste plano
    if (msg && enviada?.id === msg.id && (msg.tipo === 'chegada' || msg.tipo === 'terminado')) {
      const u = lerUltimoEnvio()
      const de = msg.idCalculo != null ? { idCalculo: msg.idCalculo, indice: msg.indice } : msg.anterior ? null : planoAtivo
      if (u && !u.fechado && de && u.idCalculo === de.idCalculo && u.indice === de.indice) gravarUltimoEnvio({ ...u, fechado: true })
      // e os envios desse plano pelo Telegram já não se reaproveitam (decisão n.º 13, auditoria I-03)
      if (de) for (const x of planos.values()) if (x.id === de.idCalculo && x.indice === de.indice && x.estado === 'enviado') x.fechado = true
    }
    gravarPlanoAtivo()
    enviarFila(agora)
  }
  // A hora de alarme de cada contacto em terra deste plano (auditoria I-01): a guardada no plano (terra);
  // num plano gravado antes dela, a do último atraso entregue (ou a do envio) para todos.
  function terraDe (p = planoAtivo) {
    if (Array.isArray(p?.terra)) return p.terra
    if (!p?.envio?.contactos?.length) return []
    const antiga = Number.isFinite(p.atrasoEnviado?.alarme) ? p.atrasoEnviado.alarme : Date.parse(p.envio.alarme)
    const fechou = (p.contactos?.enviadas || []).some(m => (m.tipo === 'chegada' || m.tipo === 'terminado') && !m.anterior)
    return ct.terraInicial({ ...p.envio, alarme: antiga }).map(a => ({ ...a, fechado: fechou }))
  }
  // A hora de alarme que terra tem (ms): a mais cedo que algum contacto à espera tem (decisão do Ivo n.º 14,
  // auditoria I-01: o aviso de 60 min tem de chegar antes da primeira chamada ao MRCC).
  const alarmeEmTerra = (p = planoAtivo) => ct.alarmeMaisCedo(terraDe(p))
  // A hora de alarme do plano (a do plano ativo, também a de um plano novo ainda por entregar): a base do teto.
  const alarmeDoPlano = (p = planoAtivo) => Date.parse(p?.envio?.alarmePendente ?? p?.envio?.alarme)
  // As guardas do atraso automático (revisão final C1, decisão do Ivo de 02/10): null (pode sair),
  // 'parado' (menos de 1 MN na rota na última hora, parado agora, ou a mais de 2 MN dela) ou 'limite' (mais de 3 h
  // sobre a hora de alarme do plano, ou sobre a do último "Estou bem").
  function retencao (res, d, agora) {
    return ct.retencaoAtraso({
      progressoMnH: ct.progressoNaHora(planoAtivo.marcas, { s: res.milhas, ...res.posicao }, agora),
      ritmoAgoraMnH: ct.progressoNaHora(planoAtivo.marcas, { s: res.milhas, ...res.posicao }, agora, 15 * MIN),
      distRotaMn: res.distRota,
      alarmeNovo: d.alarme,
      alarmePlano: alarmeDoPlano(),
      estouBem: planoAtivo.estouBem
    })
  }
  // Os contactos de um envio: os que receberam (enviada) e os do parcial que ainda está a tentar.
  function juntarContactos (enviada, parcial) {
    const contactos = [...enviada.contactos]
    const chats = [...(enviada.chats || [])]
    for (const [i, id] of (parcial?.chats || []).entries()) if (!chats.includes(id)) { chats.push(id); contactos.push(parcial.contactos?.[i] ?? `chat ${id}`) }
    return { contactos, chats }
  }
  // O texto do atraso: "em vez de" o último alarme entregue em terra (sem nenhum, o do plano): com horas
  // diferentes por contacto (uma entrega parcial), a mais tarde (a do último atraso que chegou).
  function textoAtraso (m, agora) {
    const tarde = ct.alarmeMaisTarde(terraDe())
    const antes = Number.isFinite(tarde) ? tarde : Date.parse(planoAtivo?.envio?.alarme)
    return ct.textoAtraso({ chegada: m.chegada, alarme: m.alarme, alarmeAntes: antes, agora })
  }
  // O atraso que vale agora (decidido contra o último entregue), com o resultado do acompanhamento.
  // enviado: o último atraso entregue (o padrão); null para saber só se o barco está atrasado
  function atrasoAgora (res, agora, enviado = planoAtivo.atrasoEnviado || null) {
    return ct.decidirAtraso(enviado, {
      chegadaAgora: Date.parse(res.chegadaAgora), p90: Date.parse(planoAtivo.alternativa.chegada?.p90), alarmePlano: Date.parse(planoAtivo.envio?.alarme), agora
    })
  }
  // O atraso para terra (só a navegar, com GPS e o plano enviado). Decide-se contra o último entregue;
  // com um atraso ainda na fila, esse passa a ter a chegada mais recente (sem perder a vez da tentativa);
  // com um "a enviar", espera a resposta.
  // As guardas (revisão final C1, decisão do Ivo de 02/10, "só a avançar + teto de 3 h"): sem progresso
  // real na rota (parado ou à deriva) ou acima do teto, nada sai, fica a hora de alarme que terra tem e o
  // ecrã pede o "Estou bem" (retido); um atraso na fila que ainda não saiu também sai dela.
  function atrasoParaTerra (res, agora) {
    retido = null
    const envio = planoAtivo.envio
    if (!envio?.contactos?.length || res.semGps) return
    const d = atrasoAgora(res, agora)
    const c = planoAtivo.contactos || ct.novaFila()
    // (o parcial, revisão final I3, é um atraso já entregue a outros: não é o pendente)
    const pendente = c.fila.find(m => m.tipo === 'atraso' && !m.anterior && !m.parcial)
    // deixou de valer (o barco recuperou): o atraso que ainda está na fila sai (re-revisão M-2)
    if (!d) {
      if (pendente?.estado === 'fila') { planoAtivo = { ...planoAtivo, contactos: ct.tirar(c, pendente.id) }; gravarPlanoAtivo() }
      return
    }
    const motivo = pendente?.confirmado ? null : retencao(res, d, agora)
    if (motivo) {
      retido = { motivo }
      if (pendente?.estado === 'fila') { planoAtivo = { ...planoAtivo, contactos: ct.tirar(c, pendente.id) }; gravarPlanoAtivo() }
      return
    }
    if (pendente) {
      if (pendente.estado !== 'fila' || (pendente.chegada === d.chegada && pendente.alarme === d.alarme)) return
      planoAtivo = { ...planoAtivo, contactos: ct.atualizarAtraso(c, pendente.id, { chegada: d.chegada, alarme: d.alarme, texto: textoAtraso(d, agora) }) }
    } else if (!porMensagem('atraso', textoAtraso(d, agora), agora, { chegada: d.chegada, alarme: d.alarme })) return
    gravarPlanoAtivo()
  }

  // ---------- a navegar ----------
  const ficheiroPressoes = () => path.join(dirPlugin, 'barometro.json')
  function lerPressoes () {
    try { const l = JSON.parse(fs.readFileSync(ficheiroPressoes(), 'utf8')); return Array.isArray(l) ? l.filter(x => Number.isFinite(x?.t) && Number.isFinite(x?.hPa)) : [] } catch { return [] }
  }
  // Grava o barómetro (só com um plano aberto; quem chama decide quando).
  function gravarPressoes (agora) {
    try { escreverAtomico(ficheiroPressoes(), JSON.stringify(pressoes)) } catch (e) { app.error(`não gravei o barómetro: ${e.message}`); return }
    baroGravadoEm = agora
    baroPorGravar = false
  }
  // Um valor do SignalK com a hora: sem hora legível, ou com mais de 2 min, conta como em falta (null).
  function fresco (caminho, agora) {
    const x = app.getSelfPath?.(caminho)
    if (x?.value == null) return null
    const hora = Date.parse(x.timestamp)
    if (!Number.isFinite(hora) || agora - hora > LEITURA_VELHA_MS) return null
    return x.value
  }
  // O "cheguei bem"/"viagem terminada" deste plano ainda por entregar a terra (auditoria K-12): { tipo,
  // contactos (a quem falta), tentativas, erro } ou null.
  function fechoPorEntregar (p = planoAtivo) {
    const pendentes = (p?.contactos?.fila || []).filter(m => (m.tipo === 'chegada' || m.tipo === 'terminado') && !m.anterior)
    if (!pendentes.length) return null
    const contactos = [...new Set(pendentes.flatMap(m => m.contactos || []))]
    return { tipo: pendentes[0].tipo, contactos, tentativas: Math.max(...pendentes.map(m => m.tentativas || 0)), erro: pendentes.find(m => m.erro)?.erro ?? null }
  }
  // O aviso da hora de alarme em terra (revisão final I2): com o plano aberto e enviado a contactos em
  // terra; e com o plano fechado enquanto o "cheguei bem"/"terminada" não chega a terra (auditoria K-12).
  // E (decisão do Ivo n.º 15, auditoria I-02) quando os contactos em terra têm um plano entregue que não é o
  // do plano ativo (enviado e nunca ativado, ou o plano ativo é outro): conta a hora de alarme mais cedo.
  function avisoTerra (agora) {
    const p = planoAtivo
    const comEnvio = !!p?.envio?.contactos?.length
    const fecho = comEnvio && !pa.aberto(p) ? fechoPorEntregar(p) : null
    const doPlano = av.alarmeTerra({ aberto: comEnvio && pa.aberto(p), alarme: alarmeEmTerra(), fecho: fecho?.tipo ?? null }, agora)
    const u = terraSemPlano(agora)
    const alarmeOutro = u ? alarmeCedoDe(u) : NaN
    const doOutro = u ? av.alarmeTerra({ semPlano: pa.aberto(p) ? 'outro' : 'nenhum', alarme: alarmeOutro }, agora) : null
    const escolhido = doOutro && doOutro.state !== 'normal' && (doPlano.state === 'normal' || alarmeOutro < alarmeEmTerra()) ? doOutro : doPlano
    return { [av.CAMINHO_ALARME_TERRA]: escolhido }
  }
  // A hora de alarme mais cedo de um último envio (ms); sem ela, ou ilegível (um ficheiro antigo ou estragado),
  // a alarme (a que o envioEmTerra já validou)
  const alarmeCedoDe = (u) => { const t = Date.parse(u?.alarmeMaisCedo); return Number.isFinite(t) ? t : Date.parse(u?.alarme) }
  // O plano que os contactos em terra têm (ultimo-envio.json, ainda a contar) quando não é o do plano ativo.
  function terraSemPlano (agora) {
    const u = envioEmTerra(agora)
    if (!u || (planoAtivo && u.idCalculo === planoAtivo.idCalculo && u.indice === planoAtivo.indice)) return null
    return u
  }
  const envioEmTerraGet = (u) => (u ? { idCalculo: u.idCalculo, indice: u.indice, contactos: [...u.contactos], alarme: new Date(alarmeCedoDe(u)).toISOString() } : null)
  function publicarAvisos (avisos) {
    avisosPublicados = avisos
    const r = av.publicar(publicados, avisos)
    publicados = r.publicados
    if (r.deltas.length) app.handleMessage(plugin.id, { updates: [{ values: r.deltas }] })
  }
  // A rota ativa: o href, null sem nenhuma, undefined se não se sabe (a API de rumo falhou).
  async function hrefAtivo () {
    if (typeof app.getCourse === 'function') {
      try {
        const c0 = await curso()
        return c0 === undefined ? undefined : c0?.activeRoute?.href ?? null
      } catch { return undefined }
    }
    const ar = v('navigation.course.activeRoute')
    return ar === undefined ? undefined : ar?.href ?? null
  }
  function leituraPosicao (agora) {
    const p = fresco('navigation.position', agora)
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
    return { lat: p.latitude, lon: p.longitude }
  }
  const numeroFresco = (caminho, agora) => { const x = fresco(caminho, agora); return Number.isFinite(x) ? x : null }
  // A previsão mais recente arquivada que cubra a posição agora: { previsao, obtida, idadeH } ou null.
  // Auditoria M-27: antes descomprimia e lia todo o arquivo de minuto a minuto (de forma síncrona: o servidor
  // parado), sem limite de idade. Agora guarda a leitura e só volta a ler de 10 em 10 min, quando chega uma
  // previsão nova à pasta, ou com o barco 5 MN mais longe; e só as dos últimos 50 h. A idade é a de agora.
  let previsaoLida = null // { chave, em, pos, r }
  function previsaoAgora (pos, agora) {
    if (!pos) return null
    const pasta = path.join(pastaBase, 'previsoes')
    let chave = 'sem pasta'
    try { const nomes = fs.readdirSync(pasta); let max = ''; for (const n of nomes) if (n > max) max = n; chave = `${nomes.length} ${max}` } catch { /* sem pasta */ }
    const k = previsaoLida
    if (!(k && k.chave === chave && agora >= k.em && agora - k.em < PREVISAO_LER_MS && c.distanciaMn(k.pos, pos) < PREVISAO_LER_MN)) {
      const a = prev.lerArquivo(pasta, { pontos: [pos], desde: agora, ate: agora, agora, maxIdadeH: PREVISAO_MAX_IDADE_H })
      previsaoLida = { chave, em: agora, pos, r: a.erro ? null : a }
    }
    const r = previsaoLida.r
    return r ? { ...r, idadeH: (agora - Date.parse(r.obtida)) / 3600000 } : null
  }

  async function passoNavegar () {
    const agora = relogio()
    // decisão n.º 19: com o relógio do Pi desacertado o ciclo não corre (os avisos ficam como estão)
    desacertoAtual = relogioErrado(agora)
    if (desacertoAtual != null) {
      publicarAvisos({ ...avisosPublicados, [`${av.PREFIXO}.relogio`]: { state: 'warn', method: [...av.METODO], message: `Relógio do Pi desacertado ${minutosDesacerto(desacertoAtual)} da hora do GPS: o acompanhamento e as mensagens para terra estão parados — acerta a hora do Pi` } })
      return
    }
    const hPa = numeroFresco('environment.outside.pressure', agora)
    const comPressao = hPa != null
    // as amostras em memória (uma por ciclo: o mesmo instante outra vez não conta)
    if (comPressao && pressoes.at(-1)?.t !== agora) { pressoes = av.juntarPressao(pressoes, { t: agora, hPa: hPa / 100 }, agora); baroPorGravar = true }
    // no disco só com um plano aberto, no máximo de 10 em 10 min
    if (baroPorGravar && pa.aberto(planoAtivo) && (baroGravadoEm == null || agora - baroGravadoEm >= BARO_GRAVAR_MS || agora < baroGravadoEm)) gravarPressoes(agora)
    // sem plano aberto: a fila (o "cheguei bem" por entregar) e, com ele por entregar, o aviso de terra
    if (!pa.aberto(planoAtivo)) { ultimo = null; retido = null; if (planoAtivo) enviarFila(agora); publicarAvisos(avisoTerra(agora)); return }
    const sog = numeroFresco('navigation.speedOverGround', agora)
    // as milhas feitas na rota (a chegada pede progresso): a última posição na rota
    const milhas = estAcomp.anterior?.s ?? planoAtivo.seguimento?.s ?? null
    const leitura = { posicao: leituraPosicao(agora), sogNos: sog != null ? sog * NOS : null, href: await hrefAtivo(), milhas }
    // a última posição e a hora dela (a do SignalK: a do GPS), para o Terminar sem GPS (auditoria M-22)
    if (leitura.posicao) { const t = Date.parse(app.getSelfPath?.('navigation.position')?.timestamp); ultimaPosicao = { ...leitura.posicao, t: Number.isFinite(t) ? t : agora } }
    const r = pa.avaliar(planoAtivo, leitura, memPlano, agora, { portos })
    planoAtivo = r.plano
    memPlano = r.mem
    // o afastamento máximo da partida (a chegada em pausa) grava-se quando cresce 0,1 MN
    const afast = planoAtivo.afastamentoMaxMn
    if (!r.mudou && Number.isFinite(afast) && (afastGravado == null || afast - afastGravado >= SEGUIMENTO_MN)) gravarPlanoAtivo()
    // a chegada: "cheguei bem" aos contactos (uma vez: o plano fica fechado)
    if (r.mudou === 'chegou') porMensagem('chegada', ct.textoChegada({ destino: planoAtivo.destino?.nome, chegou: Date.parse(planoAtivo.chegou), agora }), agora)
    if (r.mudou) gravarPlanoAtivo()
    if (!pa.aberto(planoAtivo) || planoAtivo.estado === 'pausado') {
      ultimo = null
      retido = null
      estAvisos = av.novoEstado()
      // em pausa só fica o da hora de alarme em terra (revisão final I2); fechado, só enquanto o "cheguei
      // bem" não chega a terra (auditoria K-12: a fila primeiro, para publicar o que ficou)
      enviarFila(agora)
      publicarAvisos(avisoTerra(agora))
      return
    }
    const ins = instrumentos()
    const pv = previsaoAgora(leitura.posicao || ultimaPosicao || planoAtivo.partida, agora)
    const tempo = pv ? prev.criarTempo(pv.previsao) : null
    const a = ac.acompanhar(estAcomp, {
      plano: planoAtivo, posicao: leitura.posicao, agora, gasoleoL: ins.gasoleoL, socPct: ins.socPct, energia: o.energia, rpm: o.rpmCruzeiro,
      radiacao: tempo ? (lat, lon, t) => tempo(lat, lon, t).radiacao : null
    })
    estAcomp = a.estado
    // o vento medido contra o previsto P50 (a correção da AI, se houver modelo) naquele sítio e hora
    const medido = numeroFresco('environment.wind.speedTrue', agora)
    let previsto = null
    if (tempo && leitura.posicao) {
      // com a tendência do barómetro, como no treino (auditoria I-16)
      const k = cenarios.criarCorrecaoVento({ tempoBruto: tempo, modelos: modelosVento, obtida: Date.parse(pv.obtida), tendPressao3h: cenarios.tendenciaPressao3h(pressoes, agora) })(leitura.posicao.lat, leitura.posicao.lon, agora)
      previsto = Number.isFinite(k.w.tws) ? k.w.tws * k.razao.p50 : null
    }
    ventos = medido != null && leitura.posicao ? ac.juntarAmostra(ventos, { t: agora, medido: medido * NOS, previsto }, agora) : ventos.filter(x => x.t >= agora - 10 * MIN)
    const vento = ac.desvioVento(ventos)
    const res = a.resultado
    const navegar = planoAtivo.estado === 'a navegar'
    const x = av.avaliar(estAvisos, {
      navegar, tripulacao: planoAtivo.tripulacao, saida: Date.parse(planoAtivo.saida), destino: planoAtivo.destino?.nome, semGps: !leitura.posicao,
      atrasoMin: res.atrasoMin, vento, previsaoIdadeH: pv ? pv.idadeH : null, barometro: pressoes, recursos: res.recursos, eventos: res.eventos, chegadaNoite: res.chegadaNoite,
      // os mínimos à chegada da configuração (auditoria M-13), os mesmos do cálculo
      limites: { gasoleoL: o.seguranca.gasoleoMinL ?? seguranca.PADRAO.gasoleoMinL, bateriaPct: o.seguranca.bateriaMinPct ?? seguranca.PADRAO.bateriaMinPct }
    }, agora)
    estAvisos = x.estado
    const avisos = { ...x.avisos, ...avisoTerra(agora) }
    publicarAvisos(avisos)
    ultimo = { ...res, posicao: leitura.posicao, agora, vento, previsaoIdadeH: pv ? pv.idadeH : null, barometroSemLeitura: !comPressao, quedaBarometro: av.quedaEm3h(pressoes, agora), avisos }
    // a posição na rota: no plano ativo, para um reinício continuar dali
    const ant = estAcomp.anterior
    if (navegar && ant && (!planoAtivo.seguimento || Math.abs(planoAtivo.seguimento.s - ant.s) >= SEGUIMENTO_MN)) {
      planoAtivo = { ...planoAtivo, seguimento: { s: ant.s, t: new Date(ant.t).toISOString() } }
      gravarPlanoAtivo()
    }
    // as marcas { t, s } de 5 em 5 min (o progresso na rota na última hora, revisão final C1)
    if (navegar && leitura.posicao && Number.isFinite(res.milhas)) {
      const marcas = ct.juntarMarca(planoAtivo.marcas, { t: agora, s: res.milhas, ...leitura.posicao })
      if (marcas.length !== (planoAtivo.marcas || []).length || marcas.at(-1)?.t !== planoAtivo.marcas?.at(-1)?.t) {
        planoAtivo = { ...planoAtivo, marcas }
        gravarPlanoAtivo()
      }
    }
    if (navegar) atrasoParaTerra(ultimo, agora)
    else retido = null
    enviarFila(agora)
  }

  // O que o GET /plano-ativo devolve (o ecrã lê-o de 10 em 10 s).
  function estadoPlanoAtivo () {
    const p = planoAtivo
    const u = ultimo
    const rec = u?.recursos || {}
    const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null)
    // os avisos ativos publicados (também em pausa e com o plano fechado: o da hora de alarme em terra)
    const ativos = Object.entries(avisosPublicados || {}).filter(([, a]) => a.state !== 'normal').map(([caminho, a]) => ({ caminho, state: a.state, message: a.message }))
    const recursosAviso = ativos.find(a => a.caminho === `${av.PREFIXO}.recursos`)
    const c = p.contactos || ct.novaFila()
    const sug = p.estado === pa.ESTADOS.PAUSADO ? memPlano.sugestao : null
    return {
      // a hora do plugin (o ecrã conta "daqui a X min" com ela)
      agora: new Date(relogio()).toISOString(),
      estado: p.estado,
      pausadoDe: p.pausadoDe ?? null,
      // o plano (o ecrã liga a ele a pergunta do Terminar e as mensagens)
      ativadoEm: p.ativadoEm ?? null,
      // o cais (para o Recalcular de um destino avulso, sem id)
      destino: { id: p.destino?.id ?? null, nome: p.destino?.nome ?? null, lat: p.destino?.cais?.lat ?? null, lon: p.destino?.cais?.lon ?? null },
      tripulacao: p.tripulacao,
      idCalculo: p.idCalculo,
      indice: p.indice,
      alternativa: { id: p.alternativa.id, nome: p.alternativa.nome },
      partida: p.alternativa.partida ?? null,
      saida: p.saida,
      chegou: p.chegou,
      // para o lado do aviso (para cima), como a mensagem do recalcula (+ 0: nunca -0)
      atrasoMin: u && u.estado === 'a navegar' && Number.isFinite(u.atrasoMin) ? av.acima(u.atrasoMin) + 0 : null,
      proximo: u?.proximo ? { texto: u.proximo.texto, hora: u.proximo.hora } : null,
      chegadaAgora: u?.chegadaAgora ?? p.alternativa.chegada?.p50 ?? null,
      chegadaPlano: p.alternativa.chegada?.p50 ?? null,
      chegadaNoite: u?.chegadaNoite ?? null,
      recursos: {
        gasoleoChegadaL: r0(rec.gasoleoChegadaL),
        bateriaChegadaPct: r0(rec.bateriaChegadaPct),
        semLeitura: !!u && rec.gasoleoChegadaL == null && rec.bateriaChegadaPct == null,
        aviso: recursosAviso ? recursosAviso.message : null
      },
      semGps: !!u?.semGps,
      barometro: { semLeitura: u ? !!u.barometroSemLeitura : true, quedaHpa: Number.isFinite(u?.quedaBarometro) ? Math.round(u.quedaBarometro * 10) / 10 : null },
      previsaoIdadeH: Number.isFinite(u?.previsaoIdadeH) ? Math.round(u.previsaoIdadeH * 10) / 10 : null,
      avisos: ativos,
      // alarme: a mais cedo que algum contacto à espera tem (decisão n.º 14); porContacto: a de cada um (o ecrã
      // diz "Pai: alarme HH:MM" quando diferem, auditoria I-01)
      envio: p.envio ? { contactos: p.envio.contactos, alarme: Number.isFinite(alarmeEmTerra(p)) ? new Date(alarmeEmTerra(p)).toISOString() : p.envio.alarme, alarmePlano: p.envio.alarmePendente ?? p.envio.alarme, porContacto: terraDe(p).map(a => ({ nome: a.nome, alarme: Number.isFinite(a.alarme) ? new Date(a.alarme).toISOString() : null, fechado: !!a.fechado })) } : null,
      // o atraso que não seguiu para terra (revisão final C1): o ecrã pede o "Estou bem"
      atrasoRetido: retido && p.estado === pa.ESTADOS.NAVEGAR && Number.isFinite(alarmeEmTerra(p)) ? { motivo: retido.motivo, alarme: new Date(alarmeEmTerra(p)).toISOString() } : null,
      // o "cheguei bem"/"terminada" deste plano ainda por entregar (auditoria K-12): o ecrã diz "ainda não
      // chegou a terra: liga-lhes"
      fechoPorEntregar: fechoPorEntregar(p),
      // o relógio do Pi desacertado da hora do GPS (s, Pi − GPS; decisão n.º 19): o Leme diz "Relógio do Pi
      // desacertado"; null quando está certo ou não se sabe
      relogioDesacertadoS: desacertoAtual != null ? Math.round(desacertoAtual / 1000) : null,
      // o plano que os contactos em terra têm, quando não é este (decisão n.º 15, auditoria I-02): o ecrã diz
      // "os contactos em terra têm o plano de outra alternativa, com alarme HH:MM"
      envioEmTerra: envioEmTerraGet(terraSemPlano(relogio())),
      chegadaOutro: sug ? { id: sug.id, nome: sug.nome } : null,
      // contactos: a quem vai; parcial: só para os que falharam (revisão final I3)
      // (as mensagens para terra; os avisos ao Ivo de uma desistência não são para terra)
      filaContactos: c.fila.filter(m => m.tipo !== 'aviso').map(m => ({ tipo: m.tipo, criada: m.criada, tentativas: m.tentativas, proxima: m.proxima, estado: m.estado, erro: m.erro, contactos: [...(m.contactos || [])], parcial: !!m.parcial })),
      enviadas: c.enviadas.filter(m => m.tipo !== 'aviso').map(m => ({ tipo: m.tipo, enviadaEm: m.enviadaEm, contactos: m.contactos, falhas: Array.isArray(m.falhas) ? m.falhas.map(f => ({ nome: String(f?.nome ?? ''), erro: String(f?.erro ?? '') })) : [] })),
      // as mensagens de que se desistiu (auditoria I-05, decisão n.º 16): o ecrã diz "Pai não recebeu o
      // «cheguei bem»: liga-lhe" (o Ivo também recebe o aviso pelo Telegram)
      desistencias: (c.desistencias || []).map(d => ({ tipo: d.tipo, ref: d.ref, contactos: [...(d.contactos || [])], em: d.em, alarme: d.alarme ?? null }))
    }
  }

  // Ativar um href na API de rumo (Continuar): a API do servidor, ou HTTP para o próprio servidor.
  async function ativarHref (href, pointIndex) {
    if (typeof app.activateRoute === 'function') return comLimite(() => app.activateRoute({ href, pointIndex }))
    const r = await fetchFn(`http://localhost:${o.porta || 3000}/signalk/v2/api/vessels/self/navigation/course/activeRoute`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ href, pointIndex }), signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw erroPt(`a API de rumo do SignalK respondeu ${r.status}`)
  }
  // O ponto da rota a seguir à posição na rota (seguimento); sem ela, o 1.
  function pontoSeguinte (p) {
    const s = estAcomp.anterior?.s ?? p.seguimento?.s
    if (!Number.isFinite(s)) return 1
    const { linha } = ac.prepararRota(p)
    const i = linha.s.findIndex(x => x > s + 1e-9)
    return i < 1 ? Math.max(1, linha.s.length - 1) : i
  }
  async function cicloNavegar () {
    if (!o || !dirPlugin || aCorrerCiclo) return
    aCorrerCiclo = true
    try {
      // com a hora simulada e sem navigation.datetime, não há hora: não corre (a leitura dentro do try:
      // auditoria M-30, um getSelfPath que rebenta não dá uma rejeição por tratar)
      if (simulada() && !Number.isFinite(horaSimulada())) return
      await passoNavegar()
    } catch (e) { app.error(`a navegar: ${e.message}`) } finally { aCorrerCiclo = false }
  }

  function guardarTrabalho (id, t) {
    trabalhos.set(id, t)
    while (trabalhos.size > MAX_TRABALHOS) {
      const velho = [...trabalhos.keys()].find(k => k !== aCorrer)
      if (!velho) break
      trabalhos.delete(velho)
    }
  }

  async function executar (id, pedido) {
    // as opções do início: um stop() a meio (o = null) não estraga o cálculo, que acaba sozinho
    const oo = o
    const pastaDados = pastaBase
    const t = trabalhos.get(id)
    const { modelos, versoes } = modelosAi()
    let destino = pedido.destino
    if (destino === 'rota-ativa') {
      const pts = await pontosRotaAtiva()
      if (!pts) throw erroPt('não há rota ativa no SignalK')
      destino = { rotaAtiva: pts }
    }
    const costa = costaAtual()
    const r = await calculo.calcular(
      { instrumentos: instrumentos(oo), destino, tripulacao: pedido.tripulacao, sairAgora: pedido.sairAgora, agora: relogio() },
      {
        costa, polar, modelos, versoes, obterPrevisao: obterPrevisaoCom(oo, pastaDados),
        opcoes: {
          afastamentoMinimo: oo.afastamentoMinimo, rpmCruzeiro: oo.rpmCruzeiro, energia: oo.energia,
          socDesconhecido: oo.socDesconhecido, gasoleoDesconhecidoL: oo.gasoleoDesconhecidoL, seguranca: oo.seguranca
        },
        progresso: (f, texto) => { t.progresso = Math.round(f * 100) / 100; t.texto = texto },
        // o registo dos erros de programação da geometria (lib/rotas.js: log(msg, erro))
        log: (msg, e) => app.error(e && e.message ? `${msg}: ${e.message}` : String(msg))
      })
    if (r.erro) { t.estado = 'erro'; t.erro = r.erro; return }
    t.estado = 'pronto'
    t.progresso = 1
    t.texto = 'pronto'
    t.resultado = r
  }

  // Grava a rota na API de recursos v2 e ativa-a na API de rumo v2. Primeiro a API dentro do
  // servidor (app.resourcesApi e app.activateRoute); sem ela, HTTP para o próprio servidor.
  // A rota direta (salto curto) não tem afastamento: diz "direta (salto curto)", nunca "null MN" — só com
  // alt.direto, como o plano (auditoria M-29: uma alternativa sem afastamento e que não é direta não diz
  // "direta"); uma variante por um canal leva a nota do canal (terra dos dois lados, por confirmar na carta).
  // Apaga do servidor uma rota que o plugin gravou e deixou de usar (auditoria M-34: cada Ativar/Recalcular
  // gravava uma rota nova que nunca se apagava e acumulavam no OpenCPN): a do plano substituído, a do mesmo
  // plano ativado outra vez, e a de uma ativação que falhou. Sem a API interna, por HTTP. Um erro só vai ao
  // registo. (A do plano terminado ou chegado fica até ao Ativar seguinte: pode ainda estar ativa no OpenCPN.)
  async function apagarRota (href) {
    const id = typeof href === 'string' && href.startsWith('/resources/routes/') ? href.split('/').pop() : null
    if (!id) return
    try {
      if (typeof app.resourcesApi?.deleteResource === 'function') await comLimite(() => app.resourcesApi.deleteResource('routes', id))
      else {
        const r = await fetchFn(`http://localhost:${o?.porta || 3000}/signalk/v2/api/resources/routes/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) })
        if (!r.ok) throw new Error(`o SignalK respondeu ${r.status}`)
      }
    } catch (e) { app.error(`não apaguei a rota antiga ${id}: ${e?.message ?? e}`) }
  }

  async function ativarRota (alt, destinoNome) {
    const quando = (iso) => decisao.quando(Date.parse(iso), relogio(), 'Europe/Lisbon')
    const pts = alt.pontosRota
    const id = crypto.randomUUID()
    const href = `/resources/routes/${id}`
    const onde = alt.direto ? 'direta (salto curto)' : Number.isFinite(alt.afastamento) ? `${alt.afastamento} MN${alt.canal ? ` pelo ${alt.canal}` : ''}` : null
    const dados = {
      name: `Arlequin → ${destinoNome} (${alt.nome})`,
      // as horas em hora de Lisboa (HH:MM), não o UTC em bruto: o OpenCPN mostra o texto tal e qual
      // a propulsão como no ecrã e no plano: "a motor (sem vento para vela)" quando vai toda a motor
      description: `Melhor rota: ${onde ? `${onde}, ` : ''}${plano.propulsaoTexto(alt)}, partida ${quando(alt.partida)}, chegada prevista ${quando(alt.chegada.p50)} (hora de Lisboa)${alt.nota ? `. ${alt.nota}` : ''}`,
      ...(Number.isFinite(alt.milhas) ? { distance: Math.round(alt.milhas * 1852) } : {}),
      feature: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) },
        properties: { coordinatesMeta: pts.map((p, i) => ({ name: p.nome || `WP${i}` })) }
      }
    }
    // o barco está no primeiro ponto (o cais ou a posição): o próximo é o seguinte
    const destinoCurso = { href, pointIndex: pts.length > 1 ? 1 : 0 }
    if (app.resourcesApi && typeof app.resourcesApi.setResource === 'function' && typeof app.activateRoute === 'function') {
      await comLimite(() => app.resourcesApi.setResource('routes', id, dados))
      try {
        // o setResource do servidor não espera pela escrita do fornecedor: esperar até se ler (um pedido
        // pendurado acaba no limite de tempo e não se repete)
        let lida = false
        for (let i = 0; i < 30 && !lida; i++) {
          try { lida = !!(await comLimite(() => app.resourcesApi.getResource('routes', id))) } catch (e) {
            if (e?.pt && e.message === NAO_RESPONDEU) throw e
            lida = false
          }
          if (!lida) await esperar(100)
        }
        if (!lida) throw erroPt('a rota foi gravada mas não se consegue ler de volta')
        await comLimite(() => app.activateRoute(destinoCurso))
      } catch (e) { apagarRota(href); throw e } // a rota gravada de uma ativação que falhou não fica (M-34)
      return { rota: id, href, via: 'api interna' }
    }
    const url = `http://localhost:${o.porta || 3000}`
    const pedir = async (caminho, corpo) => {
      const r = await fetchFn(url + caminho, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) })
      if (!r.ok) throw erroPt(`o SignalK respondeu ${r.status} a ${caminho}`)
    }
    await pedir(`/signalk/v2/api/resources/routes/${id}`, dados)
    try { await pedir('/signalk/v2/api/vessels/self/navigation/course/activeRoute', destinoCurso) } catch (e) { apagarRota(href); throw e }
    return { rota: id, href, via: 'http' }
  }

  plugin.start = function (props) {
    o = {
      pasta: '~/arlequin-dados', afastamentoMinimo: seguranca.PADRAO.afastamentoMinimo, rpmCruzeiro: base.RPM_CRUZEIRO, polar: base.POLAR_PADRAO, previsoes: true,
      bateria: 'servico', deposito: '0', socDesconhecido: 0.8, gasoleoDesconhecidoL: 100, energia: {}, porta: 3000, ...props
    }
    o.barco = { ...padroes(plugin.schema.properties.barco), ...(eObjeto(props?.barco) ? props.barco : {}) }
    // A bateria de serviço (auditoria I-13): uma configuração gravada no Admin UI com o esquema antigo tem os
    // 200 Ah que eram o valor por omissão escritos — contam como não postos (fica o banco de 440 Ah, decisão
    // do Ivo n.º 4), e o registo di-lo
    o.energia = eObjeto(props?.energia) ? { ...props.energia } : {}
    o.seguranca = limitesPostos(props?.seguranca)
    if (o.energia.capacidadeAh === CAPACIDADE_AH_ANTIGA) {
      delete o.energia.capacidadeAh
      app.error(`energia.capacidadeAh = ${CAPACIDADE_AH_ANTIGA} na configuração (o valor por omissão antigo) não conta: o banco de serviço tem ${energiaPlano.PADRAO.capacidadeAh} Ah (decisão n.º 4); grava a configuração do plugin para o tirar`)
    }
    o.telefones = { ...padroes(plugin.schema.properties.telefones), ...(eObjeto(props?.telefones) ? props.telefones : {}) }
    pastaBase = path.resolve(o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta)
    dirPlugin = app.getDataDirPath()
    erroArranque = null
    try {
      fs.mkdirSync(dirPlugin, { recursive: true })
      costaBase = deps.costa || c.carregarCosta()
      polar = base.carregarPolar(path.resolve(o.polar || base.POLAR_PADRAO))
    } catch (e) {
      // (auditoria I-32: o que falta, em pt-PT; o pormenor no registo)
      app.error(`arranque: ${e?.message ?? e}`)
      erroArranque = `não arrancou: ${e?.code === 'ENOENT' && e.path ? `falta o ficheiro ${e.path}` : 'erro a ler a costa ou a polar (o pormenor ficou no registo)'}`
      costaBase = null; polar = null
      app.setPluginError?.(erroArranque)
      return
    }
    const lido = pa.ler(dirPlugin)
    planoAtivo = lido.plano
    if (lido.erro) app.error(lido.erro)
    // a mensagem para terra que estava a enviar já não tem resposta: volta à fila
    if (planoAtivo?.contactos) planoAtivo = { ...planoAtivo, contactos: ct.aoArrancar(planoAtivo.contactos, relogio()) }
    // a navegar: os temporizadores recomeçam; a posição na rota e o barómetro vêm dos ficheiros, e o
    // que já está publicado lê-se do SignalK (não se publica outra vez)
    memPlano = pa.novaMemoria()
    const seg = planoAtivo?.seguimento
    estAcomp = { ...ac.novoEstado(), anterior: seg && Number.isFinite(seg.s) ? { s: seg.s, t: Date.parse(seg.t) } : null }
    estAvisos = av.novoEstado()
    ventos = []
    ultimo = null
    retido = null
    pressoes = lerPressoes()
    previsaoLida = null
    dataGps = null
    desacertoAtual = null
    baroGravadoEm = null
    baroPorGravar = false
    portos = costaBase.destinos.filter(d => d.id && Array.isArray(d.aproximacao) && d.aproximacao.length).map(d => ({ id: d.id, nome: d.nome, cais: c.P(d.aproximacao.at(-1)) }))
    try { publicados = av.publicadosDaArvore(app.getSelfPath?.(av.PREFIXO)) } catch { publicados = {} }
    avisosPublicados = {}
    try { modelosVento = modelosAi().modelos } catch { modelosVento = {} }
    if (cicloTimer) pararCiclo(cicloTimer)
    // cicloSegundos só com modoTeste (no mínimo 1 s); no barco, 60 s
    const cicloMs = o.modoTeste === true && Number.isFinite(o.cicloSegundos) ? Math.max(1, o.cicloSegundos) * 1000 : CICLO_MS
    modoTesteTexto = o.modoTeste === true ? `MODO DE TESTE (${simulada() ? 'hora simulada' : 'hora real'}, ciclo de ${cicloMs / 1000} s) · ` : ''
    cicloTimer = agendarCiclo(() => { cicloNavegar() }, cicloMs)
    app.removeListener?.('arlequin:plano-enviado', aoPlanoEnviado)
    app.on?.('arlequin:plano-enviado', aoPlanoEnviado)
    estadoPlugin(`Pronto · ${costaBase.destinos.length + meusDestinos().length} destinos`)
  }

  plugin.stop = function () {
    // Um cálculo a correr acaba sozinho (é finito), com as opções do início (executar); o resultado
    // fica no mapa.
    if (baroPorGravar && dirPlugin && pa.aberto(planoAtivo)) gravarPressoes(relogio())
    o = null
    if (cicloTimer) pararCiclo(cicloTimer)
    cicloTimer = null
    app.removeListener?.('arlequin:plano-enviado', aoPlanoEnviado)
    for (const t of pedidosContactos.values()) cancelar(t)
    pedidosContactos.clear()
    for (const p of planos.values()) {
      cancelar(p.temporizador)
      if (p.estado === 'a enviar') { p.estado = 'falhou'; p.motivo = MOTIVO_REINICIO }
    }
  }

  plugin.registerWithRouter = function (router) {
    const parado = (res) => res.status(503).json({ ok: false, erro: erroArranque || 'o plugin da rota não está ligado' })
    const ligado = () => o && costaBase && polar
    // Com a segurança ligada, o SignalK 2.33 só deixa um utilizador admin chamar as rotas registadas
    // com router.get/post simples (tokensecurity.js, pluginAuthenticationMiddleware). Com o
    // router.access(nível) (interfaces/plugins.js, asPluginRouter), as leituras pedem uma sessão
    // (readonly) e as escritas um utilizador "read/write". Sem o router.access (versões antigas): as simples.
    const comNivel = typeof router.access === 'function'
    const ler = comNivel ? router.access('readonly') : router
    const escrever = comNivel ? router.access('readwrite') : router

    escrever.post('/calcular', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const tripulacao = b.tripulacao
      if (tripulacao !== 'so' && tripulacao !== 'acompanhado') return res.status(400).json({ ok: false, erro: 'tripulacao tem de ser "so" ou "acompanhado"' })
      const destino = b.destino
      const destinoOk = (typeof destino === 'string' && destino) || (eObjeto(destino) && Number.isFinite(destino.lat) && Number.isFinite(destino.lon))
      if (!destinoOk) return res.status(400).json({ ok: false, erro: 'falta o destino (id, "rota-ativa" ou { lat, lon, nome })' })
      if (b.sairAgora != null && typeof b.sairAgora !== 'boolean') return res.status(400).json({ ok: false, erro: 'sairAgora tem de ser true ou false' })
      if (aCorrer) return res.status(409).json({ ok: false, erro: 'já há um cálculo a correr', id: aCorrer })
      const id = crypto.randomUUID()
      aCorrer = id
      guardarTrabalho(id, { estado: 'a calcular', progresso: 0, texto: 'a começar', pedido: { destino, tripulacao, sairAgora: !!b.sairAgora }, criado: new Date(relogio()).toISOString() })
      estadoPlugin('A calcular a melhor rota…')
      executar(id, { destino, tripulacao, sairAgora: !!b.sairAgora })
        .catch(e => { const t = trabalhos.get(id); if (t) { t.estado = 'erro'; t.erro = motivoInterno(e, 'calcular') } })
        .finally(() => {
          aCorrer = null
          const t = trabalhos.get(id)
          try { estadoPlugin(t?.estado === 'pronto' ? `Última rota: ${t.resultado.veredicto.texto}` : `Último cálculo: ${t?.erro || 'erro'}`) } catch { /* só o estado */ }
        })
        .catch(e => app.error(`calcular: ${e.message}`))
      res.status(202).json({ id })
    })

    ler.get('/resultado/:id', (req, res) => {
      if (!ligado()) return parado(res)
      const t = trabalhos.get(req.params.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      const out = { estado: t.estado, progresso: t.progresso, texto: t.texto }
      if (t.resultado) out.resultado = t.resultado
      if (t.erro) out.erro = t.erro
      // o plano que os contactos em terra têm (revisão final I1): o Resultado avisa que, ao Ativar outro, segue o novo.
      // A hora de alarme é a mais cedo que algum contacto tem, como no GET /plano-ativo (auditoria I-01, decisão n.º 14)
      out.envioEmTerra = envioEmTerraGet(envioEmTerra(relogio()))
      res.json(out)
    })

    ler.get('/destinos', (req, res) => {
      if (!ligado()) return parado(res)
      res.json({ destinos: costaAtual().destinos })
    })

    escrever.post('/destinos', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const nome = typeof b.nome === 'string' ? b.nome.trim() : ''
      if (!nome || nome.length > 40) return res.status(400).json({ ok: false, erro: 'o nome tem de ter 1 a 40 letras' })
      let p = null
      if (b.posicaoAtual === true) {
        p = instrumentos().posicao
        if (!p) return res.status(400).json({ ok: false, erro: 'sem GPS: não sei a posição atual' })
      } else if (Number.isFinite(b.lat) && Number.isFinite(b.lon) && Math.abs(b.lat) <= 90 && Math.abs(b.lon) <= 180) p = { lat: b.lat, lon: b.lon }
      else return res.status(400).json({ ok: false, erro: 'faltam as coordenadas (lat, lon) ou posicaoAtual: true' })
      // abrigo: só se o Ivo o marcar (por omissão false — um "meu" não gasta os candidatos de abrigo da desistência)
      if (typeof b.conhecido !== 'boolean' || (b.abrigo != null && typeof b.abrigo !== 'boolean')) return res.status(400).json({ ok: false, erro: 'conhecido e abrigo têm de ser true ou false' })
      if (costaBase.emTerra(p)) return res.status(400).json({ ok: false, erro: 'essa posição fica em terra' })
      const meus = meusDestinos()
      const todos = costaAtual().destinos
      let id = `meu-${slugDestino(nome)}`
      for (let n = 2; todos.some(d => d.id === id); n++) id = `meu-${slugDestino(nome)}-${n}`
      const lat = Math.round(p.lat * 1e5) / 1e5; const lon = Math.round(p.lon * 1e5) / 1e5
      const d = { id, nome, abrigo: b.abrigo === true, conhecido: b.conhecido, largo: [lat, lon], ...aproximacaoAvulsa(lat, lon), notas: 'acrescentado no ecrã', confirmado: false, criado: new Date(relogio()).toISOString() }
      try { escreverAtomico(ficheiroMeus(), JSON.stringify([...meus, d], null, 1)) } catch (e) {
        app.error(`destinos: ${e?.message ?? e}`)
        return res.status(500).json({ ok: false, erro: 'não gravei o destino: o disco recusou a escrita (o pormenor ficou no registo)' })
      }
      res.status(201).json({ ok: true, destino: { ...d, meu: true } })
    })

    escrever.post('/ativar', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const t = trabalhos.get(b.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      if (t.estado !== 'pronto') return res.status(409).json({ ok: false, erro: `o cálculo está "${t.estado}"` })
      const lista = t.resultado.alternativas
      const indice = Number.isInteger(b.alternativa) ? b.alternativa : lista.findIndex(a => a.id === b.alternativa)
      const alt = lista[indice]
      if (!alt) return res.status(404).json({ ok: false, erro: 'alternativa desconhecida' })
      const id = b.id
      // um cálculo antigo não se ativa (decisão do Ivo n.º 13, auditoria I-03), como o envio do plano; a
      // alternativa do plano aberto ativada outra vez é o mesmo plano (a rota apagada no OpenCPN) e continua
      const continuaAberto = pa.aberto(planoAtivo) && planoAtivo.idCalculo === id && planoAtivo.indice === indice
      const velho = continuaAberto ? null : plano.calculoAntigo(alt, relogio(), { antesDe: 'ativar' })
      if (velho) return res.status(422).json({ ok: false, erro: velho })
      // Recalcular → Ativar (desenho 3b-2): com um plano aberto já enviado a contactos em terra, o plano
      // novo segue para os mesmos contactos ("Este plano substitui o anterior"). Monta-se antes de
      // ativar: um cálculo antigo (422) não ativa nada e o plano antigo fica.
      const antigo = pa.aberto(planoAtivo) ? planoAtivo : null
      const mesmo = !!antigo && antigo.idCalculo === id && antigo.indice === indice
      // (a alternativa nova já enviada pelo Ivo depois de ativar o plano antigo não se reenvia)
      const envioNovo = envioDe(id, indice, alt)
      const novoJaEnviado = !!envioNovo && !!antigo && Date.parse(envioNovo.enviadoEm) >= Date.parse(antigo.ativadoEm)
      const reenviar = !!antigo && !mesmo && !novoJaEnviado && !!antigo.envio?.contactos?.length
      // revisão final I1: sem um plano aberto enviado, os contactos em terra podem ter o plano de outra
      // alternativa ou de outro cálculo (o último entregue, com a hora de alarme por passar): o novo segue
      // pelo caminho do reenvio ("Este plano substitui o anterior")
      const emTerra = !reenviar && !mesmo ? envioEmTerra(relogio()) : null
      const terraOutro = !!emTerra && !(emTerra.idCalculo === id && emTerra.indice === indice)
      let novoTexto = null
      if (reenviar || terraOutro) {
        // o plano novo segue para terra: com o relógio do Pi desacertado, não (decisão n.º 19)
        const errado = relogioErrado(relogio())
        if (errado != null) return res.status(422).json({ ok: false, erro: recusaRelogio(errado) })
        try {
          novoTexto = plano.montarPlano({ resultado: t.resultado, indice, barco: o.barco, telefones: o.telefones, agora: relogio() })
        } catch (e) {
          if (e.status === 422) return res.status(422).json({ ok: false, erro: e.message })
          app.error(`plano: ${e?.message ?? e}`)
          return res.status(500).json({ ok: false, erro: 'não montei o plano: erro interno (o pormenor ficou no registo)' })
        }
      }
      // dois toques em Ativar (auditoria M-21, sonda S8): as decisões acima fazem-se antes da ativação, e o 2.º
      // pedido mandava outro "Este plano substitui o anterior" e gravava mais uma rota
      if (aAtivar) return res.status(409).json({ ok: false, erro: 'já há uma ativação a meio: espera um momento' })
      aAtivar = true
      ativarRota(alt, t.resultado.destino.nome)
        .then(r => {
          const agora = relogio()
          // o plano ativo (desenho 3b-2): cria ou substitui. Lê-se o plano de agora (o ciclo e as respostas
          // do porto podem tê-lo mudado durante a ativação): nada de uma cópia de antes
          const aproximacao = costaAtual().destinos.find(d => d.id && d.id === t.resultado.destino.id)?.aproximacao || null
          const anterior = planoAtivo
          const continua = mesmo && pa.aberto(anterior) && anterior.idCalculo === id && anterior.indice === indice
          if (continua) {
            // a mesma alternativa: o mesmo plano (fila, saída, atrasos), com a rota nova
            planoAtivo = { ...anterior, href: r.href, estado: anterior.estado === 'pausado' ? anterior.pausadoDe || pa.ESTADOS.ESPERA : anterior.estado, pausadoDe: null }
          } else {
            let envio = envioNovo
            if (reenviar || terraOutro) {
              const alarme = plano.horaAlarme(alt)
              let de = emTerra
              let entregue = emTerra?.alarme
              if (reenviar) {
                const velho = anterior?.envio?.contactos?.length ? anterior : antigo
                de = velho.envio
                // a hora de alarme em terra só muda quando o plano novo lá chegar (re-revisão M-3): até lá, a
                // última entregue do plano antigo (o atraso entregue, ou a do plano); a nova fica pendente
                entregue = Number.isFinite(velho.atrasoEnviado?.alarme) ? new Date(velho.atrasoEnviado.alarme).toISOString() : de.alarme
              }
              envio = { contactos: [...de.contactos], chats: [...(de.chats || [])], alarme: entregue, alarmePendente: alarme == null ? null : new Date(alarme).toISOString(), pedido: null, enviadoEm: null, substitui: true }
            }
            // um plano novo começa limpo (decisão do Ivo de 01/10): só herda do antigo o "cheguei
            // bem"/"terminada" por enviar e o que está "a enviar"; o antigo vai para planos-fechados.json
            planoAtivo = pa.criarPlano({ idCalculo: id, resultado: t.resultado, indice, href: r.href, aproximacao, envio, agora })
            // a hora de alarme de cada contacto (auditoria I-01): com o plano antigo aberto e reenviado, a que
            // cada um tinha dele; com o plano de terra (ultimo-envio.json), a mais cedo; senão, a do envio
            planoAtivo.terra = reenviar ? terraDe(anterior?.envio?.contactos?.length ? anterior : antigo).map(a => ({ ...a }))
              : terraOutro ? ct.terraInicial({ ...envio, alarme: alarmeCedoDe(emTerra) })
                : envio ? ct.terraInicial(envio) : []
            if (anterior) {
              planoAtivo.contactos = ct.herdar(anterior.contactos)
              try { pa.arquivar(dirPlugin, anterior, agora) } catch (e) { app.error(`não arquivei o plano antigo: ${e.message}`) }
            }
            if (reenviar || terraOutro) porMensagem('plano', ct.textoSubstitui(novoTexto.texto), agora, { gpx: novoTexto.gpx, nomeFicheiro: novoTexto.nomeFicheiro, alarme: plano.horaAlarme(alt) ?? undefined })
            memPlano = pa.novaMemoria(); estAcomp = ac.novoEstado(); estAvisos = av.novoEstado(); ventos = []; ultimo = null; retido = null
          }
          gravarPlanoAtivo()
          enviarFila(agora)
          // a rota do plano anterior (ou a anterior deste) já não se usa: sai do servidor (auditoria M-34)
          if (anterior?.href && anterior.href !== planoAtivo.href) apagarRota(anterior.href)
          aAtivar = false // (antes da resposta: o ecrã pode pedir outra logo a seguir)
          res.json({ ok: true, ...r, alternativa: alt.id, nota: alt.nota || null, planoAtivo: { estado: planoAtivo.estado } })
        })
        .catch(e => { aAtivar = false; res.status(502).json({ ok: false, erro: `não ativei a rota: ${motivoSignalK(e, 'ativar')}` }) })
        .catch(e => app.error(`ativar: ${e.message}`))
        .finally(() => { aAtivar = false })
    })

    escrever.post('/plano-telegram', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const t = trabalhos.get(b.id)
      if (!t) return res.status(404).json({ ok: false, erro: 'cálculo desconhecido' })
      if (t.estado !== 'pronto') return res.status(409).json({ ok: false, erro: `o cálculo está "${t.estado}"` })
      const lista = t.resultado.alternativas
      const indice = Number.isInteger(b.alternativa) ? b.alternativa : lista.findIndex(a => a.id === b.alternativa)
      if (!lista[indice]) return res.status(404).json({ ok: false, erro: 'alternativa desconhecida' })
      if (typeof app.emit !== 'function') return res.status(503).json({ ok: false, erro: 'o servidor não tem eventos: não dá para enviar o plano ao plugin porto' })
      // decisão n.º 19: com o relógio do Pi desacertado, a hora de alarme sairia errada
      const errado = relogioErrado(relogio())
      if (errado != null) return res.status(422).json({ ok: false, erro: recusaRelogio(errado) })
      // ninguém a ouvir (o plugin porto desligado, o padrão no dev): diz logo, sem esperar os 30 s
      if (app.listenerCount?.('arlequin:plano') === 0) return res.status(503).json({ ok: false, erro: PORTO_DESLIGADO })
      let p
      try {
        p = plano.montarPlano({ resultado: t.resultado, indice, barco: o.barco, telefones: o.telefones, agora: relogio() })
      } catch (e) {
        // 422: falta o que o plano precisa (a hora de alarme), com o motivo; 500: um erro de programação
        if (e.status === 422) return res.status(422).json({ ok: false, erro: e.message })
        app.error(`plano: ${e?.message ?? e}`)
        return res.status(500).json({ ok: false, erro: 'não montei o plano: erro interno (o pormenor ficou no registo)' })
      }
      const pedido = crypto.randomUUID()
      const avisos = typeof o.telefones.ivo === 'string' && o.telefones.ivo.trim() ? [] : [AVISO_SEM_TELEFONE]
      const estado = { id: b.id, indice, estado: 'a enviar', entregues: [], contactos: [], falhas: [], avisos, criado: new Date(relogio()).toISOString() }
      estado.temporizador = agendar(() => {
        if (estado.estado === 'a enviar') { estado.estado = 'falhou'; estado.motivo = MOTIVO_PORTO }
      }, LIMITE_PORTO_MS)
      guardarPlano(pedido, estado)
      try {
        app.emit('arlequin:plano', { pedido, texto: p.texto, gpx: p.gpx, nomeFicheiro: p.nomeFicheiro })
      } catch (e) {
        // um ouvinte que lança não derruba o pedido: fica "falhou" com o motivo
        cancelar(estado.temporizador)
        estado.estado = 'falhou'
        app.error(`plano pelo Telegram: ${e?.message ?? e}`)
        estado.motivo = 'não foi possível enviar: o plugin porto deu um erro (o pormenor ficou no registo)'
      }
      res.status(202).json({ pedido, avisos })
    })

    ler.get('/plano-ativo', (req, res) => {
      if (!ligado()) return parado(res)
      // sem plano: 404, com o plano que os contactos em terra têm (decisão n.º 15, auditoria I-02: o ecrã diz
      // "os contactos em terra têm um plano com alarme HH:MM e não há plano ativo: ativa-o ou avisa-os")
      if (!planoAtivo) return res.status(404).json({ ok: false, erro: 'não há plano ativo', envioEmTerra: envioEmTerraGet(terraSemPlano(relogio())), relogioDesacertadoS: desacertoAtual != null ? Math.round(desacertoAtual / 1000) : null })
      res.json(estadoPlanoAtivo())
    })

    escrever.post('/plano-ativo/terminar', (req, res) => {
      if (!ligado()) return parado(res)
      if (!pa.aberto(planoAtivo)) return res.status(409).json({ ok: false, erro: 'não há um plano ativo aberto' })
      const agora = relogio()
      // só a posição de agora; sem GPS, a última conhecida, com a hora dela (auditoria M-22)
      const agoraPos = leituraPosicao(agora)
      const posicao = agoraPos || ultimaPosicao
      planoAtivo = pa.terminar(planoAtivo, agora)
      const contactos = porMensagem('terminado', ct.textoTerminado({ posicao, posicaoEm: agoraPos ? null : ultimaPosicao?.t ?? null, agora }), agora)
      estAvisos = av.novoEstado()
      ultimo = null
      gravarPlanoAtivo()
      enviarFila(agora)
      // os avisos a normal; o de terra fica enquanto a "terminada" não chegar (auditoria K-12)
      publicarAvisos(avisoTerra(agora))
      res.json({ ok: true, estado: planoAtivo.estado, contactos })
    })

    escrever.post('/plano-ativo/continuar', (req, res) => {
      if (!ligado()) return parado(res)
      if (planoAtivo?.estado !== 'pausado') return res.status(409).json({ ok: false, erro: 'o plano não está pausado' })
      const p = planoAtivo
      const mesmoPlano = (x) => pa.aberto(x) && x.ativadoEm === p.ativadoEm && x.idCalculo === p.idCalculo && x.indice === p.indice && x.href === p.href
      ativarHref(p.href, pontoSeguinte(p))
        .then(() => {
          // o mesmo plano (o ciclo pode já o ter retomado entretanto: não é um "mudou")
          if (!mesmoPlano(planoAtivo)) return res.status(409).json({ ok: false, erro: 'o plano mudou entretanto' })
          if (planoAtivo.estado === pa.ESTADOS.PAUSADO) {
            planoAtivo = pa.continuar(planoAtivo)
            memPlano = pa.novaMemoria()
            gravarPlanoAtivo()
          }
          res.json({ ok: true, estado: planoAtivo.estado })
        })
        .catch(e => res.status(502).json({ ok: false, erro: `não ativei a rota: ${motivoSignalK(e, 'continuar')}` }))
        .catch(e => app.error(`continuar: ${e.message}`))
    })

    // "Estou bem" (revisão final C1, decisão do Ivo de 02/10): com um atraso retido pelas guardas (parado
    // ou acima do teto de 3 h), liberta uma mensagem de atraso com a estimativa de agora; o teto passa a
    // ser 3 h sobre a hora de alarme dessa mensagem
    escrever.post('/plano-ativo/estou-bem', (req, res) => {
      if (!ligado()) return parado(res)
      const agora = relogio()
      const d = planoAtivo?.estado === pa.ESTADOS.NAVEGAR && retido && ultimo && !ultimo.semGps ? atrasoAgora(ultimo, agora) : null
      if (!d) return res.status(409).json({ ok: false, erro: 'não há nenhum atraso por enviar: a hora de alarme em terra não precisa de ser adiada' })
      planoAtivo = { ...planoAtivo, estouBem: { em: new Date(agora).toISOString(), alarme: d.alarme } }
      porMensagem('atraso', textoAtraso(d, agora), agora, { chegada: d.chegada, alarme: d.alarme, confirmado: true })
      retido = null
      gravarPlanoAtivo()
      enviarFila(agora)
      res.json({ ok: true, chegada: new Date(d.chegada).toISOString(), alarme: new Date(d.alarme).toISOString() })
    })

    // "Cheguei bem a X" noutro porto (decisão do Ivo de 01/10): só o porto da sugestão (em pausa no mar,
    // parado 30 min perto dele), e só com o toque do Ivo
    escrever.post('/plano-ativo/chegada', (req, res) => {
      if (!ligado()) return parado(res)
      const b = eObjeto(req.body) ? req.body : {}
      const sug = planoAtivo?.estado === pa.ESTADOS.PAUSADO ? memPlano.sugestao : null
      if (!sug || typeof b.destino !== 'string' || b.destino !== sug.id) return res.status(409).json({ ok: false, erro: 'não há a sugestão de chegada a esse porto (o barco parado 30 min perto dele, com o plano em pausa)' })
      const agora = relogio()
      planoAtivo = pa.chegarA(planoAtivo, { id: sug.id, nome: sug.nome }, sug.desde, agora)
      memPlano = pa.novaMemoria()
      const contactos = porMensagem('chegada', ct.textoChegada({ destino: sug.nome, chegou: sug.desde, agora }), agora)
      estAvisos = av.novoEstado()
      ultimo = null
      gravarPlanoAtivo()
      enviarFila(agora)
      publicarAvisos(avisoTerra(agora))
      res.json({ ok: true, estado: planoAtivo.estado, contactos })
    })

    ler.get('/plano-telegram/:pedido', (req, res) => {
      if (!ligado()) return parado(res)
      const p = planos.get(req.params.pedido)
      if (!p) return res.status(404).json({ ok: false, erro: 'pedido desconhecido' })
      const out = { estado: p.estado, entregues: p.entregues, contactos: p.contactos, falhas: p.falhas, avisos: p.avisos, criado: p.criado }
      if (p.motivo) out.motivo = p.motivo
      res.json(out)
    })
  }

  // o plano ativo em memória, o último acompanhamento e o ciclo (diagnóstico e testes)
  plugin.planoAtivo = () => planoAtivo
  plugin.acompanhamento = () => ultimo
  plugin.cicloNavegar = cicloNavegar

  return plugin
}
