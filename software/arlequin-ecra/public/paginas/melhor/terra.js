// Os contactos em terra no Leme e no Pedir (F3b item 1; o contrato da F2, GET /plugins/signalk-arlequin-rota/plano-ativo,
// relatório da F2 secção 7). Um mosaico à parte, "Contactos em terra", só com o que pede uma ação do Ivo — a hora de alarme
// de terra e a fila ficam na faixa do plano (navegar.js):
//   decisão n.º 19  relogioDesacertadoS (Pi − GPS, em s; também no corpo do 404): "Relógio do Pi desacertado N min da hora
//                   do GPS: o acompanhamento e as mensagens para terra estão parados — acerta a hora do Pi" (a vermelho);
//   K-12            fechoPorEntregar { tipo: 'chegada' | 'terminado', contactos, tentativas, erro }: o «cheguei bem» (ou a
//                   «viagem terminada») deste plano ainda por entregar, mesmo com o plano fechado: "…ainda não chegou a
//                   terra: liga-lhes (Pai, Mãe)"; o erro técnico não vai para o ecrã (auditoria I-32);
//   I-05            desistencias [{ tipo, ref, contactos, em, alarme }] (as 10 mais recentes; o plugin desistiu de entregar a
//                   quem nunca recebe): "Pai não recebeu o «cheguei bem»: liga-lhe"; só as das últimas 24 h; o tipo 'aviso'
//                   (contactos []: o aviso ao Ivo pelo Telegram) não é de nenhum contacto e já se vê aqui;
//   I-02            envioEmTerra { idCalculo, indice, contactos, alarme }: terra tem um plano que NÃO é o do plano ativo (o 200
//                   e o corpo do 404): sem plano ativo, "Os contactos em terra têm um plano com alarme HH:MM e não há plano
//                   ativo: ativa-o ou avisa-os"; com outro plano ativo, "…têm o plano de outra alternativa, com alarme
//                   HH:MM: avisa-os".
// Os dados vêm do plano ativo lido (aberto ou fechado: o K-12 e o I-05 são sobretudo do plano que já fechou) ou, sem plano
// (404), do corpo do 404 (estado.semPlano, navegar.js). As horas contam-se com a hora do plugin. Tudo o que vem de fora
// passa pelo esc; nunca null, NaN nem undefined.

import { esc, horaLisboa } from '../../lib/rota-texto.js'
import { aberto } from './aberto.js'

const ok = (x) => typeof x === 'number' && Number.isFinite(x)
const agora = (ctx) => (Number.isFinite(ctx.agora) ? ctx.agora : Date.now())
const DESISTENCIA_VISIVEL_MS = 24 * 3600 * 1000

// A hora do plugin agora: o agora do GET /plano-ativo mais o tempo desde a leitura (no barco é o mesmo relógio; na
// viagem acelerada do dev, o simulado). Sem ele, a do ecrã.
export function horaPlugin (ctx, p) {
  const base = Date.parse(p?.agora)
  const lido = ctx.estado.planoAtivoLidoEm
  return ok(base) && ok(lido) ? base + (agora(ctx) - lido) : agora(ctx)
}

// O que o plugin diz de terra: o plano ativo lido (200, aberto ou fechado) ou o corpo do 404.
const dadosDoPlugin = (e) => e.planoAtivo || e.semPlano || null

// "Pai", "Pai e Mãe", "Pai, Mãe e Tio" (os nomes já escapados)
const juntar = (nomes) => (nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0] ?? '')
const nomesDe = (x) => (Array.isArray(x) ? x.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim()) : [])

// "90 s", "3 min": o relógio desacertado
const duracaoCurta = (s) => (s < 120 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)

// I-01: a hora de alarme de cada contacto que ainda espera, só quando são diferentes ("Pai: alarme 18:32 · Mãe: alarme
// 20:32"): a da faixa é a mais cedo (envio.alarme); um contacto que já recebeu o "cheguei bem" já não conta. '' se são
// iguais, se falta o porContacto (um plugin de antes da F2) ou se só há um.
export function alarmesPorContacto (envio, t) {
  const abertos = (Array.isArray(envio?.porContacto) ? envio.porContacto : [])
    .filter(c => c && !c.fechado && typeof c.nome === 'string' && c.nome.trim() && ok(Date.parse(c.alarme)))
  const horas = abertos.map(c => horaLisboa(Date.parse(c.alarme), t))
  if (new Set(horas).size < 2) return ''
  return abertos.map((c, i) => `${esc(c.nome.trim())}: alarme ${horas[i]}`).join(' · ')
}

// O que se desistiu de entregar, por tipo, com os nomes juntos e sem repetir; só as das últimas 24 h.
const COISA = { chegada: 'o «cheguei bem»', terminado: 'a «viagem terminada»', atraso: 'a nova hora de alarme (o atraso)', plano: 'o plano' }
function linhasDesistencias (d, t) {
  const porTipo = new Map()
  for (const x of Array.isArray(d.desistencias) ? d.desistencias : []) {
    if (!x || !COISA[x.tipo]) continue
    const em = Date.parse(x.em)
    if (ok(em) && t - em > DESISTENCIA_VISIVEL_MS) continue
    const nomes = nomesDe(x.contactos)
    if (!nomes.length) continue
    const antes = porTipo.get(x.tipo) || []
    porTipo.set(x.tipo, [...antes, ...nomes.filter(n => !antes.includes(n))])
  }
  return Object.keys(COISA).filter(tipo => porTipo.has(tipo)).map(tipo => {
    const nomes = porTipo.get(tipo).map(esc)
    return ['atencao', `⚠ ${juntar(nomes)} ${nomes.length > 1 ? 'não receberam' : 'não recebeu'} ${COISA[tipo]}: ${nomes.length > 1 ? 'liga-lhes' : 'liga-lhe'}`]
  })
}

// As linhas do mosaico: [classe, html] por ordem de urgência.
function linhas (ctx) {
  const d = dadosDoPlugin(ctx.estado)
  if (!d) return []
  const t = horaPlugin(ctx, d)
  const out = []
  if (ok(d.relogioDesacertadoS) && d.relogioDesacertadoS !== 0) {
    out.push(['perigo', `⚠ Relógio do Pi desacertado ${duracaoCurta(Math.abs(d.relogioDesacertadoS))} da hora do GPS: o acompanhamento e as mensagens para terra estão parados — acerta a hora do Pi`])
  }
  const f = d.fechoPorEntregar
  if (f && (f.tipo === 'chegada' || f.tipo === 'terminado')) {
    const quem = nomesDe(f.contactos).map(esc)
    out.push(['atencao', `⚠ ${f.tipo === 'chegada' ? 'o «cheguei bem»' : 'a «viagem terminada»'} ainda não chegou a terra: liga-lhes${quem.length ? ` (${quem.join(', ')})` : ''}`])
  }
  out.push(...linhasDesistencias(d, t))
  const u = d.envioEmTerra
  if (u && typeof u === 'object') {
    const alarme = Date.parse(u.alarme)
    const com = ok(alarme) ? ` com alarme ${horaLisboa(alarme, t)}` : ''
    out.push(['atencao', aberto(d)
      ? `⚠ Os contactos em terra têm o plano de outra alternativa,${com || ' sem hora de alarme'}: avisa-os`
      : `⚠ Os contactos em terra têm um plano${com} e não há plano ativo: ativa-o ou avisa-os`])
  }
  return out
}

// O mosaico "Contactos em terra" ('' sem nada para dizer): no Leme (na coluna da direita, como os avisos da rota) e no
// Pedir (sem plano ativo, ou com o plano fechado).
export function avisosTerra (ctx) {
  const l = linhas(ctx)
  if (!l.length) return ''
  return `<div class="tile avisos-terra"><div class="lab">Contactos em terra</div>${l.map(([classe, html]) => `<div class="${classe}">${html}</div>`).join('')}</div>`
}
