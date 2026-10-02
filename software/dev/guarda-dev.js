'use strict'
// O que os scripts do dev (viagem-acelerada.js, testar-rota.js) partilham para nunca correrem no barco
// (auditoria I-35, contrato C9):
//   - a marca de fonte dos dados que injetam: 'arlequin-simulador.<script>' — a caixa negra marca como
//     "simulado" tudo o que vem de 'arlequin-simulador' ou 'arlequin-simulador.*'
//     (signalk-arlequin-caixanegra/lib/estado.js), e o simulado nunca treina a AI;
//   - a guarda: só correm num SignalK de dev, lido do próprio servidor (GET /plugins/<id>/config).

const ROTA_ID = 'signalk-arlequin-rota'
const PORTO_ID = 'signalk-arlequin-porto'
// os contactos do plano falsos do dev (config/plugin-config-data/signalk-arlequin-porto.json)
const FALSOS = new Set(['222'])

const fonteDev = (script) => `arlequin-simulador.${script}`

// O SignalK é o do dev? rota e porto: as configurações (GET /plugins/<id>/config) ou null (não se
// leram). viagem: a viagem acelerada precisa também da hora simulada e do ciclo de 1 s (o testar-rota
// não). → [motivo] (vazio: pode correr)
function verificarDev ({ rota, porto }, { viagem = true } = {}) {
  const motivos = []
  const cr = rota?.configuration
  if (!cr) motivos.push('não consegui ler a configuração do plugin da rota (a segurança do SignalK está ligada? isto é o Pi?): só corre no SignalK do dev')
  else {
    if (cr.modoTeste !== true) motivos.push('o plugin da rota não tem o modoTeste ligado (só no dev)')
    if (viagem && cr.horaSimulada !== true) motivos.push('o plugin da rota não tem a horaSimulada ligada (com o modoTeste)')
  }
  const cp = porto?.configuration
  if (!porto) motivos.push('não consegui ler a configuração do plugin porto')
  else if (porto.enabled !== false) {
    let base = null
    try { base = new URL(cp?.telegramBase || 'https://api.telegram.org') } catch { base = null }
    if (!base || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) motivos.push('o plugin porto não está ligado ao Telegram falso (telegramBase em localhost)')
    const verdadeiros = (Array.isArray(cp?.contactosPlano) ? cp.contactosPlano : []).filter(c => !FALSOS.has(String(c?.chatId ?? '').trim()))
    if (verdadeiros.length) motivos.push(`o plugin porto tem contactos do plano verdadeiros: ${verdadeiros.map(c => c?.nome || c?.chatId).join(', ')}`)
  }
  return motivos
}

// Lê as configurações da rota e do porto do servidor e devolve os motivos para não correr (vazio: pode).
async function motivosParaNaoCorrer (base, json, opcoes) {
  const config = async (id) => { try { const r = await json(`${base}/plugins/${id}/config`); return r.status === 200 && r.corpo && typeof r.corpo === 'object' ? r.corpo : null } catch { return null } }
  return verificarDev({ rota: await config(ROTA_ID), porto: await config(PORTO_ID) }, opcoes)
}

module.exports = { ROTA_ID, PORTO_ID, FALSOS, fonteDev, verificarDev, motivosParaNaoCorrer }
