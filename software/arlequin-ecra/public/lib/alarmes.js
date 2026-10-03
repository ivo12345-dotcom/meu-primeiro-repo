// Escolhe o alarme para a barra de cima, decide o som e a página de destino, e cala-o.
// Notificação: { caminho, id, state, method, message, status }.

import { esc } from './rota-texto.js'

// A gravidade de cada estado do SignalK (uma só fonte: a barra, os avisos da rota no Leme e a lista do Motor).
export const GRAVIDADE = Object.freeze({ normal: 0, nominal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 })
// A cor do texto de cada gravidade nas listas: o alerta sem cor, o aviso âmbar, o alarme e a emergência a vermelho.
export const COR_GRAVIDADE = Object.freeze({ alert: '', warn: 'atencao', alarm: 'perigo', emergency: 'perigo' })

export const nivel = (n) => GRAVIDADE[n?.state] ?? 0

// As ativas (acima de normal), da mais grave para a menos; entre iguais, pela ordem de chegada (revisão F3,
// Important 3: a lista do Motor vinha pela ordem de chegada e a mais grave podia ficar por baixo).
export const porGravidade = (lista) => [...(lista || [])].filter(n => nivel(n) > 0).sort((a, b) => nivel(b) - nivel(a))

// O mais grave. Entre os da mesma gravidade, primeiro o que ainda apita (auditoria I-08: com dois alarmes AIS, o
// chip ficava preso no 1.º, já silenciado, e o 2.º — o que apitava — não se calava).
export function maisGrave (lista) {
  let melhor = null
  for (const n of lista) {
    if (nivel(n) === 0) continue
    if (!melhor || nivel(n) > nivel(melhor) || (nivel(n) === nivel(melhor) && deveTocar(n) && !deveTocar(melhor))) melhor = n
  }
  return melhor
}

// O alarme da barra de cima (revisão F3, Important 4): o que está a apitar agora, com o botão dele — primeiro o
// de apito contínuo por calar, depois o de apito curto por calar, só depois os já calados (reconhecidos,
// silenciados ou sem som); dentro de cada grupo o mais grave e, entre iguais, o primeiro. Antes ia sempre o mais
// grave: com o fumo já reconhecido, a água no porão apitava sem botão na barra (e o toque no chip levava à
// Carta, sem nada para calar). Calado um, o seguinte que apita passa para a barra: calam-se todos, um a um.
const GRUPO = { continuo: 0, curto: 1 }
export function alarmeDaBarra (lista) {
  let melhor = null
  let chave = null
  for (const n of lista || []) {
    if (nivel(n) === 0) continue
    const c = [GRUPO[deveTocar(n)] ?? 2, -nivel(n)]
    if (!melhor || c[0] < chave[0] || (c[0] === chave[0] && c[1] < chave[1])) { melhor = n; chave = c }
  }
  return melhor
}

// 'continuo' | 'curto' | null (contrato C1, decisão do Ivo n.º 2 de 02/10). O apito contínuo quer dizer
// "levanta-te já": só o perigo imediato, que os plugins marcam com apito: 'continuo' no valor da notificação
// (colisão AIS, fumo, água no porão, fuga de gasóleo, motor a sobreaquecer). Sem o campo apito (um plugin
// de antes do contrato, ou de terceiros) só a emergência dá o contínuo. Tudo o resto com som — o disco a
// 95 %, a bateria do motor fraca, o serviço crítico, os avisos da rota (apito: 'curto'), um alarm sem o
// campo — dá o apito curto. Silenciado, reconhecido ou sem som: nada.
export function deveTocar (n) {
  if (!n || nivel(n) === 0) return null
  if (!Array.isArray(n.method) || !n.method.includes('sound')) return null
  if (n.status && (n.status.silenced || n.status.acknowledged)) return null
  if (n.apito === 'continuo') return 'continuo'
  if (n.apito == null && n.state === 'emergency') return 'continuo'
  return 'curto'
}

// ---------- o som, ciclo a ciclo ----------
// O fumo reconhecido (Adenda 2 do dono, 02/10): o servidor não deixa silenciar uma emergência, só reconhecê-la, e
// reconhecida ela deixa de apitar (alarm.js: fica só visual) — o que apagava o único aviso de um fumo que continua.
// Agora: o apito contínuo pára, o alarme fica vermelho no ecrã (a barra mostra-o enquanto estiver ativo, sem botão)
// e o ecrã repete um bip curto de 2 em 2 minutos enquanto houver fumo; o 1.º, 2 minutos depois de o ver
// reconhecido. Se o fumo passar (o porto publica "normal") e voltar, o servidor repõe o estado do alarme (sem
// reconhecer, alarm.js syncFromNotificationUpdate) e o ecrã volta a apitar contínuo: a memória do lembrete só
// vive enquanto o alarme está ativo e reconhecido. Só as emergências (o fumo é a única): o resto cala-se com o
// "silenciar".
export const LEMBRETE_RECONHECIDA_MS = 2 * 60 * 1000
// (sem o id do servidor — o SignalK sem a gestão das notificações — o "reconhecer" cala pelo caminho e o calado() local
// marca-a silenciada, não reconhecida: o servidor nunca deixa silenciar uma emergência, por isso aqui também conta)
export const emergenciaReconhecida = (n) => !!n && n.state === 'emergency' && n.apito !== 'curto' && (n.status?.acknowledged === true || n.status?.silenced === true)

// A memória do som, que o app.js guarda de ciclo para ciclo: os alarmes que já deram o bip curto (caminho e hora) e,
// por alarme reconhecido, a hora do último lembrete (ou de o ter visto reconhecido).
export const novaMemoriaSom = () => ({ bipados: new Set(), lembretes: new Map() })

// O que tocar neste ciclo: { continuo (o apito contínuo), curtos (os caminhos que dão o seu bip curto, uma vez por
// alarme), lembretes (os caminhos das emergências reconhecidas com o lembrete à hora) }. O som lê as notificações
// direto do store (nunca depende do desenho, auditoria I-06). `agora` em ms: o relógio é de quem chama (os testes
// avançam-no).
export function decidirSom (notificacoes, memoria, agora) {
  let continuo = false
  const curtos = []
  const lembretes = []
  const reconhecidas = new Set()
  for (const n of notificacoes || []) {
    const t = deveTocar(n)
    if (t === 'continuo') continuo = true
    else if (t === 'curto') {
      const chave = `${n.caminho}@${n.timestamp}`
      if (!memoria.bipados.has(chave)) { memoria.bipados.add(chave); curtos.push(n.caminho) }
    }
    if (emergenciaReconhecida(n)) {
      reconhecidas.add(n.caminho)
      const ultimo = memoria.lembretes.get(n.caminho)
      if (ultimo === undefined) memoria.lembretes.set(n.caminho, agora)
      else if (agora - ultimo >= LEMBRETE_RECONHECIDA_MS) { memoria.lembretes.set(n.caminho, agora); lembretes.push(n.caminho) }
    }
  }
  // o que já não está ativo e reconhecido (o fumo passou, voltou por reconhecer, ou a ligação caiu) esquece-se
  for (const caminho of [...memoria.lembretes.keys()]) if (!reconhecidas.has(caminho)) memoria.lembretes.delete(caminho)
  return { continuo, curtos, lembretes }
}

export function paginaDoAlarme (caminho) {
  if (caminho.startsWith('notifications.rota.')) return 'melhor'
  if (caminho.includes('.caixanegra.velas')) return 'velas'
  if (caminho.includes('.caixanegra.')) return 'diario'
  if (caminho.includes('.ais.')) return 'ais'
  if (/energia|propulsion|electrical|tanks/.test(caminho)) return 'motor'
  return 'carta'
}

// Bip curto só no momento em que a ligação ao SignalK cai (não a cada tentativa
// falhada de religar, nem no arranque).
export function bipDeLigacao (estavaLigado, ligado) {
  return estavaLigado === true && ligado === false
}

// ---------- calar ----------
// Como o SignalK 2.33 cala uma notificação (api/notifications): pelo id que o gestor das notificações lhe dá
// (POST /signalk/v2/api/notifications/<id>/silence ou /acknowledge; o servidor guarda o calado no alarme e
// recusa silenciar uma emergência: "Cannot silence Emergency Alarm!"); sem esse id — o SignalK com a gestão das
// notificações desligada (settings.notifications.manageNotifications: false; aí a API v2 responde 501) ou um
// valor sem id — pelo caminho: PUT /signalk/v1/api/vessels/self/<caminho>/method = ['visual'] (o put.js do
// servidor muda o method da notificação: deixa de apitar e continua à vista).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idDoServidor = (n) => (typeof n?.id === 'string' && UUID.test(n.id) ? n.id : null)
export const NAO_DEIXA = 'não se cala no ecrã: o SignalK não deixa'

// 'silenciar' | 'reconhecer' | null, só enquanto apita (auditoria I-08). Com o id do servidor: 'silenciar' onde ele
// deixa (nunca a emergência, nem canSilence: false), senão 'reconhecer' (o reconhecido deixa de apitar e continua
// à vista), senão null (o servidor não deixa nenhum dos dois). Sem o id: pelo caminho, 'reconhecer' na emergência
// (fica à vista, como no servidor) e 'silenciar' no resto.
export function acaoCalar (al) {
  if (!deveTocar(al)) return null
  if (!idDoServidor(al)) return al.state === 'emergency' ? 'reconhecer' : 'silenciar'
  const st = al.status || {}
  if (al.state !== 'emergency' && st.canSilence !== false) return 'silenciar'
  if (st.canAcknowledge !== false) return 'reconhecer'
  return null
}

// Os atributos do botão de calar: o id do servidor, ou (sem ele) o caminho.
export const dadosCalar = (al) => (idDoServidor(al) ? `data-id="${esc(al.id)}"` : `data-caminho="${esc(al.caminho)}"`)

// O botão de calar, para o dedo (44 px), fora do chip que leva à página do alarme; a apitar sem maneira de o
// calar (o servidor não deixa), o porquê.
export function botaoCalar (al) {
  const a = acaoCalar(al)
  if (a) return `<button class="silenciar" data-acao="${a}" ${dadosCalar(al)}>${a}</button>`
  return deveTocar(al) ? `<span class="chip falha calar">${NAO_DEIXA}</span>` : ''
}

// Cala uma notificação (acao: 'silenciar' | 'reconhecer') com o pedir do ecrã (signalk.js: o erro já vem em pt-PT).
// Pelo id; se o servidor não gere as notificações (501), pelo caminho; sem id, pelo caminho. "Já estava calado" (um
// 2.º toque, outro ecrã) é o que se queria: { jaCalado: true }. Outra recusa (ex.: a emergência que não se
// silencia) passa para quem chama (a barra mostra-a).
const JA_CALADO = /already (silenced|acknowledged)/i
export async function calar (n, acao, pedir) {
  const id = idDoServidor(n)
  if (id) {
    try {
      return await pedir(`/signalk/v2/api/notifications/${encodeURIComponent(id)}/${acao === 'reconhecer' ? 'acknowledge' : 'silence'}`, { method: 'POST' })
    } catch (err) {
      if (err?.status === 400 && JA_CALADO.test(err.corpo?.message || '')) return { jaCalado: true }
      if (err?.status !== 501 || !n.caminho) throw err
    }
  }
  if (typeof n?.caminho !== 'string' || !n.caminho.startsWith('notifications.')) throw Object.assign(new Error('o SignalK já não tem este alarme'), { status: 404 })
  return pedir(`/signalk/v1/api/vessels/self/${n.caminho.split('.').map(encodeURIComponent).join('/')}/method`, { method: 'PUT', body: { value: ['visual'] } })
}

// A notificação como o SignalK a deixa depois de calada (alarm.js, alignAlarmMethod): silenciada, sem o sound;
// reconhecida, a emergência só visual e o resto sem nada; pelo caminho (sem status do servidor), só visual. O
// app.js põe-na já no store (visto ponta a ponta: o stream só a confirma até 1 s depois — subscrição com period —
// e a barra ficava ~2 s com o mesmo botão; um 2.º toque dava "já estava silenciado"). O delta seguinte do servidor
// substitui-a pelo que ele tem.
export function calado (n, acao) {
  if (!idDoServidor(n)) return { ...n, method: ['visual'], status: { ...(n.status || {}), silenced: true } }
  if (acao === 'reconhecer') return { ...n, method: n.state === 'emergency' ? ['visual'] : [], status: { ...(n.status || {}), acknowledged: true } }
  return { ...n, method: (n.method || []).filter(m => m !== 'sound'), status: { ...(n.status || {}), silenced: true } }
}

// O "silenciado" que sobrevive ao reinício de um plugin (F3b item 9, nota do SignalK 2.33): ao parar um plugin o servidor
// apaga-lhe os valores e ao arrancar o plugin repõe os alarmes que ainda são verdade — o ecrã vê normal → o alarme outra
// vez, com o estado reposto pelo servidor (sem silenciar nem reconhecer), e voltava a apitar o que o Ivo já calara. O ecrã
// lembra-se, por caminho e mensagem, do que viu calado (pelo servidor ou já no ecrã) e, se o mesmo alarme volta dentro de
// CALADO_VALE_MS, fica calado: continua ativo e à vista, só não apita. Um alarme que falta mais do que isso (passou de
// verdade, ou o servidor esteve em baixo) e volta é outro alarme e apita. Só o que se cala sem ser emergência: a emergência
// (o fumo) tem a política do decidirSom — se o fumo passar e voltar, apita contínuo outra vez — e um aviso calado que volta
// mais grave também apita (o servidor repõe o calado quando a gravidade sobe, e o ecrã faz o mesmo).
// O custo, a assumir: um alarme com a mesma mensagem que passa e volta em menos de 3 minutos (a bomba do porão seca o
// sensor e a água sobe outra vez) fica calado — vê-se na barra, só não apita; o Telegram do porto não muda com isto.
export const CALADO_VALE_MS = 3 * 60 * 1000
const chaveCalado = (n) => `${n.caminho}|${n.message}`
const vistoCalado = (n) => n.status?.silenced === true || n.status?.acknowledged === true
export const novaMemoriaCalados = () => new Map()

// A cada ciclo, antes de o som decidir: notificacoes é o Map do store (caminho → notificação), que se muda no lugar.
// Um alarme calado (por quem for) lembra-se; um ativo por calar que a memória conhece volta calado; o que passou do prazo
// esquece-se. memoria: Map chave → { visto (a última vez que se viu ativo e calado), nivel (a gravidade, 0–4), acao }.
export function reporCalados (notificacoes, memoria, agora) {
  for (const [caminho, n] of notificacoes) {
    if (nivel(n) === 0 || n.state === 'emergency' || typeof n.message !== 'string') continue
    const chave = chaveCalado(n)
    if (vistoCalado(n)) {
      memoria.set(chave, { visto: agora, nivel: nivel(n), acao: n.status.acknowledged === true ? 'reconhecer' : 'silenciar' })
      continue
    }
    const m = memoria.get(chave)
    if (!m || agora - m.visto > CALADO_VALE_MS || nivel(n) > m.nivel || !deveTocar(n)) continue
    notificacoes.set(caminho, calado(n, m.acao))
    m.visto = agora
  }
  for (const [chave, m] of memoria) if (agora - m.visto > CALADO_VALE_MS) memoria.delete(chave)
}

// "Larguei (sou eu)" (contrato C10, Adenda 2 do dono): o plugin do porto põe acao: 'largar' no valor do alarme "o
// barco saiu do lugar" e o ecrã oferece o botão — o mesmo que o /largar do Telegram: apaga o ponto de amarração e o
// alarme limpa. Sem motor, esse alarme nunca se apaga sozinho; este botão é a maneira de dizer "fui eu".
export const URL_LARGAR = '/plugins/signalk-arlequin-porto/largar'
export const botaoLarguei = (al) => (al?.acao === 'largar' && nivel(al) > 0 ? '<button class="largar" data-acao="largar">Larguei (sou eu)</button>' : '')

// POST /plugins/signalk-arlequin-porto/largar (conta "read/write", router.access do contrato C2). Um erro chega a
// quem chama (o app.js mostra-o na barra, em pt-PT: lib/erros.js falhaLargar).
export const largar = (pedir) => pedir(URL_LARGAR, { method: 'POST' })

// O chip do alarme na barra de cima e, ao lado, o botão de calar e, no alarme do "saiu do lugar", o "Larguei". O
// texto vem dos plugins (eventos da rota, nomes dos destinos do Ivo): passa sempre pelo esc.
export function chipAlarme (al) {
  if (!al) return ''
  return `<span class="chip ${al.state === 'warn' || al.state === 'alert' ? 'aviso' : 'alarme'}" data-acao="ir-alarme" data-caminho="${esc(al.caminho)}">⚠ ${esc(al.message || al.caminho)}</span>${botaoCalar(al)}${botaoLarguei(al)}`
}
