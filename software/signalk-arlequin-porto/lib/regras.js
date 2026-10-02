'use strict'
// Regras da monitorização no porto (lógica pura). Limites aprovados pelo Ivo
// (29/09): deriva > 30 m; bomba de porão > 4 arranques/h ou > 3 min seguidos;
// intrusão só armada à mão, com lembrete ao fim de 12 h sem ninguém a bordo.

const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const NO = 1852 / 3600

const LIMITES = Object.freeze({
  raio: 30, raioLimpa: 24, // m
  paradoParaAmarrar: 30 * MIN, sogParado: 0.3 * NO,
  arranquesHora: 4, bombaSeguida: 3 * MIN,
  lembrete: 12 * H
})

function distancia (a, b) {
  const r = 6371000
  const f1 = a.latitude * Math.PI / 180
  const f2 = b.latitude * Math.PI / 180
  const df = f2 - f1
  const dl = (b.longitude - a.longitude) * Math.PI / 180
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

// Os alarmes que este plugin publica (notifications.arlequin.porto.<id>).
const ALARMES = Object.freeze(['deriva', 'aguaPorao', 'bombaPorao', 'fumo', 'fugaGasoleo', 'intrusao'])

// O apito no ecrã (decisão n.º 2 do dono, contrato C1; o campo `apito` no valor da notificação): o
// contínuo só para o perigo imediato — o fumo, a água no porão (o sensor e a bomba a trabalhar sem
// parar: "está a entrar água") e a fuga de gasóleo (o líquido debaixo do depósito); o resto com o
// apito curto. O Telegram não muda com isto.
const APITO = Object.freeze({ fumo: 'continuo', aguaPorao: 'continuo', bombaPorao: 'continuo', fugaGasoleo: 'continuo', intrusao: 'curto', deriva: 'curto' })

// ativos: { id: { state, message } } os alarmes publicados ativos (o plugin grava-os no porto.json para
// os repor depois de um reinício: auditoria I-21)
function novoEstado () {
  return {
    ativos: {},
    amarracao: { ponto: null, paradoDesde: null },
    bomba: { ligada: false, desde: null, arranques: [] },
    ultimoMovimento: null,
    ultimoLembrete: null
  }
}

// l: { posicao, sog, motorLigado, agua, bomba, fumo, liquidoGasoleo, gaiuta, movimento, armado }
function passo (e0, l, t, lim = LIMITES) {
  const e = { ...e0, ativos: { ...e0.ativos }, amarracao: { ...e0.amarracao }, bomba: { ...e0.bomba } }
  const notificacoes = []
  const acoes = []
  const mudar = (id, deve, estado, mensagem) => {
    if (deve === null || deve === undefined || deve === !!e.ativos[id]) return
    if (deve) { e.ativos[id] = { state: estado, message: mensagem }; notificacoes.push({ id, state: estado, method: ['visual', 'sound'], message: mensagem, apito: APITO[id] }) }
    else { delete e.ativos[id]; notificacoes.push({ id, state: 'normal', method: [], message: 'Normal' }) }
  }

  // Deriva: grava o ponto com 30 min parado; alarme fora do raio.
  const pos = l.posicao
  if (pos) {
    const parado = !l.motorLigado && (l.sog ?? 0) < lim.sogParado
    if (!parado) {
      e.amarracao.paradoDesde = null
      if (l.motorLigado && (l.sog ?? 0) > 1 * NO) e.amarracao.ponto = null // largou
    } else {
      e.amarracao.paradoDesde = e.amarracao.paradoDesde ?? t
      if (!e.amarracao.ponto && t - e.amarracao.paradoDesde >= lim.paradoParaAmarrar) e.amarracao.ponto = pos
    }
    if (e.amarracao.ponto) {
      const d = distancia(e.amarracao.ponto, pos)
      mudar('deriva', e.ativos.deriva ? d > lim.raioLimpa : d > lim.raio, 'alarm', `O barco saiu do lugar: está a ${Math.round(d)} m do ponto de amarração`)
    } else if (e.ativos.deriva) {
      mudar('deriva', false)
    }
  }

  // Porão.
  if (typeof l.agua === 'boolean') mudar('aguaPorao', l.agua, 'alarm', 'Água no porão!')
  if (typeof l.bomba === 'boolean') {
    if (l.bomba && !e.bomba.ligada) {
      e.bomba.desde = t
      e.bomba.arranques = [...e.bomba.arranques.filter(x => x > t - H), t]
    }
    e.bomba.ligada = l.bomba
    const seguida = l.bomba && e.bomba.desde !== null && t - e.bomba.desde > lim.bombaSeguida
    const muitos = e.bomba.arranques.filter(x => x > t - H).length > lim.arranquesHora
    if (seguida || muitos) {
      mudar('bombaPorao', true, 'alarm', seguida
        ? `Bomba de porão a trabalhar há mais de ${lim.bombaSeguida / MIN} min seguidos`
        : `Bomba de porão arrancou ${e.bomba.arranques.length} vezes na última hora: está a entrar água`)
    } else if (e.ativos.bombaPorao && !l.bomba && e.bomba.arranques.filter(x => x > t - H).length <= 1) {
      mudar('bombaPorao', false)
    }
  }

  // Sensores simples.
  if (typeof l.fumo === 'boolean') mudar('fumo', l.fumo, 'emergency', 'FUMO a bordo!')
  if (typeof l.liquidoGasoleo === 'boolean') mudar('fugaGasoleo', l.liquidoGasoleo, 'alarm', 'Líquido debaixo do depósito de gasóleo: possível fuga')

  // Intrusão (armada à mão) e lembrete.
  if (l.movimento || l.gaiuta) e.ultimoMovimento = t
  if (e.ultimoMovimento === null) e.ultimoMovimento = t
  if (l.armado) {
    if ((l.gaiuta || l.movimento) && !e.ativos.intrusao) {
      mudar('intrusao', true, 'alarm', l.gaiuta ? 'Intrusão: a gaiuta abriu com o alarme armado' : 'Intrusão: movimento a bordo com o alarme armado')
      acoes.push({ tipo: 'foto' })
    }
  } else {
    if (e.ativos.intrusao) mudar('intrusao', false)
    if (t - e.ultimoMovimento >= lim.lembrete && (e.ultimoLembrete === null || t - e.ultimoLembrete >= lim.lembrete)) {
      e.ultimoLembrete = t
      acoes.push({ tipo: 'lembrete', texto: `O alarme está desarmado e não há movimento a bordo há ${Math.round((t - e.ultimoMovimento) / H)} h. Queres armar? /armar` })
    }
  }

  return { estado: e, notificacoes, acoes }
}

module.exports = { LIMITES, ALARMES, APITO, novoEstado, passo, distancia }
