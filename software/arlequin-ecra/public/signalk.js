// Ligação ao SignalK: WebSocket com reconexão, e o "store" com os últimos
// valores do nosso barco, dos alvos AIS e das notificações.

import { SEM_AUTORIZACAO, SEM_LIGACAO, doServidor } from './lib/erros.js'

const CAMINHOS_AIS =['navigation.position', 'navigation.courseOverGroundTrue', 'navigation.speedOverGround', 'name', 'mmsi', 'design.aisShipType']

export function criarStore () {
  return {
    selfContext: null,
    self: new Map(), // caminho -> { value, timestamp }
    vessels: new Map(), // context -> { name, mmsi, tipo, position, cog, sog, em }
    notificacoes: new Map(), // caminho -> { caminho, ...value }
    ligado: false,
    ultimaMensagem: 0
  }
}

// Aplica uma delta ao store (exportado para testes).
export function aplicarDelta (store, delta) {
  const ctx = delta.context || store.selfContext || 'self'
  const eSelf = !delta.context || ctx === store.selfContext || ctx === 'vessels.self'
  for (const u of delta.updates || []) {
    const ts = u.timestamp
    for (const { path, value } of u.values || []) {
      if (eSelf) {
        if (path.startsWith('notifications.')) {
          if (value && typeof value === 'object') store.notificacoes.set(path, { caminho: path, ...value, timestamp: ts })
        } else if (path === '') {
          for (const [k, v] of Object.entries(value || {})) store.self.set(k, { value: v, timestamp: ts })
        } else {
          store.self.set(path, { value, timestamp: ts })
        }
        continue
      }
      const v = store.vessels.get(ctx) || { mmsi: ctx.split(':').pop() }
      if (path === '') Object.assign(v, value?.name ? { name: value.name } : {}, value?.mmsi ? { mmsi: value.mmsi } : {})
      else if (path === 'name') v.name = value
      else if (path === 'mmsi') v.mmsi = value
      else if (path === 'navigation.position') { v.position = value; v.em = Date.parse(ts) || Date.now() }
      else if (path === 'navigation.courseOverGroundTrue') v.cog = value
      else if (path === 'navigation.speedOverGround') v.sog = value
      else if (path === 'design.aisShipType') v.tipo = value?.name
      store.vessels.set(ctx, v)
    }
  }
}

// Sem ligação os alarmes guardados ficam velhos: esquecem-se, para o ecrã não
// continuar a apitar um alarme que já pode ter passado. Ao religar, o SignalK
// volta a mandar os que ainda estiverem ativos. A barra mostra "SEM LIGAÇÃO".
export function perderLigacao (store) {
  store.ligado = false
  store.notificacoes.clear()
}

export function ligar (store, { host = location.host, aoMudar = () => {} } = {}) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  let ws
  const abrir = () => {
    ws = new WebSocket(`${proto}://${host}/signalk/v1/stream?subscribe=none`)
    ws.onopen = () => {
      store.ligado = true
      ws.send(JSON.stringify({ context: 'vessels.self', subscribe: [{ path: '*', period: 1000 }] }))
      ws.send(JSON.stringify({ context: 'vessels.*', subscribe: CAMINHOS_AIS.map(path => ({ path, period: 2000 })) }))
      aoMudar()
    }
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      store.ultimaMensagem = Date.now()
      if (m.self) { store.selfContext = m.self.startsWith('vessels.') ? m.self : `vessels.${m.self}`; return }
      if (m.updates) aplicarDelta(store, m)
    }
    ws.onclose = () => {
      perderLigacao(store)
      aoMudar()
      setTimeout(abrir, 3000)
    }
    ws.onerror = () => ws.close()
  }
  abrir()
}

// Acesso rápido: valor de um caminho do nosso barco (ou undefined).
export const valor = (store, caminho) => store.self.get(caminho)?.value

// Idade em ms do último valor de um caminho (Infinity se nunca chegou).
export function idade (store, caminho) {
  const t = Date.parse(store.self.get(caminho)?.timestamp)
  return Number.isNaN(t) ? Infinity : Date.now() - t
}

// O pedido comum de todas as páginas. O erro fala pt-PT (auditoria K-11 e I-32): a explicação do plugin
// ({ erro: '…' }), o 401/403 da segurança do SignalK (SEM_AUTORIZACAO), o "sem ligação ao SignalK" (sem
// resposta, sem e.status) e as mensagens conhecidas da API do SignalK; senão o código (o motivo() de cada
// página diz o que é). Leva também o código, o corpo (ex.: o id do cálculo que já está a correr, num 409 da
// melhor rota) e o erro verdadeiro em e.detalhe (para o registo, nunca para o ecrã).
export async function pedir (url, opcoes = {}) {
  let r
  try {
    r = await fetch(url, {
      credentials: 'include',
      headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opcoes,
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined
    })
  } catch (causa) {
    const e = new Error(SEM_LIGACAO)
    e.detalhe = String(causa?.message ?? causa)
    throw e
  }
  if (!r.ok) {
    let msg = String(r.status)
    let corpo = null
    try { corpo = await r.json() } catch { /* sem corpo */ }
    if (typeof corpo?.erro === 'string' && corpo.erro.trim()) msg = corpo.erro
    else if (r.status === 401 || r.status === 403) msg = SEM_AUTORIZACAO
    else if (doServidor(corpo?.message)) msg = doServidor(corpo.message)
    const e = new Error(msg)
    e.status = r.status
    e.corpo = corpo
    e.detalhe = `HTTP ${r.status}${corpo ? ` ${JSON.stringify(corpo)}` : ''}`
    throw e
  }
  const tipo = r.headers.get('content-type') || ''
  return tipo.includes('json') ? r.json() : r.text()
}
