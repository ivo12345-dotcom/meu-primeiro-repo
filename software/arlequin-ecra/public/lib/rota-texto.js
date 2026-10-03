// Textos da página "Melhor rota" (desenho 3b-1): horas de Lisboa, margens, números, nomes das
// alternativas, a cor do veredicto e os avisos vermelhos. Funções puras; nunca devolvem null, NaN
// nem undefined — o que falta é "—".

export const SEM = '—'
const FUSO = 'Europe/Lisbon'
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const SEMANA_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const ms = (x) => (typeof x === 'number' ? x : typeof x === 'string' ? Date.parse(x) : x instanceof Date ? x.getTime() : NaN)
const ok = (x) => typeof x === 'number' && Number.isFinite(x)

let formato = null
function partes (t) {
  formato ??= new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(formato.formatToParts(t).map(x => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, dia: p.day, mes: p.month, hm: `${p.hour}:${p.minute}`, semana: DIAS[SEMANA_EN.indexOf(p.weekday)] }
}

// A data (AAAA-MM-DD) do dia de calendário a seguir a uma data AAAA-MM-DD (não agora + 24 h: os
// dias da mudança de hora têm 23 ou 25 h).
function diaSeguinte (data) {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
}

// O dia de uma hora em relação a agora: '' (hoje), 'amanhã' ou 'sex 02/10'.
function dia (t, agora) {
  const a = partes(t)
  const hoje = partes(agora).data
  if (a.data === hoje) return ''
  if (a.data === diaSeguinte(hoje)) return 'amanhã'
  return `${a.semana} ${a.dia}/${a.mes}`
}

// A hora de Lisboa, sem o dia: "14:32"; "—" sem hora (auditoria I-31: o ecrã dá sempre a hora de Lisboa,
// seja qual for o fuso do Pi).
export function hmLisboa (t) {
  t = ms(t)
  return ok(t) ? partes(t).hm : SEM
}

// O dia e a hora de Lisboa: "15/7 00:30"; "—" sem hora.
export function diaHoraLisboa (t) {
  t = ms(t)
  if (!ok(t)) return SEM
  const p = partes(t)
  return `${Number(p.dia)}/${Number(p.mes)} ${p.hm}`
}

// O dia de Lisboa de uma hora: "2026-10-02"; "—" sem hora.
export function dataLisboa (t) {
  t = ms(t)
  return ok(t) ? partes(t).data : SEM
}

// "21:05" (hoje), "amanhã 06:30", "sex 02/10 23:10"; "—" sem hora.
export function horaLisboa (t, agora = Date.now()) {
  t = ms(t)
  if (!ok(t)) return SEM
  const d = dia(t, agora)
  return `${d ? `${d} ` : ''}${partes(t).hm}`
}

// "às 19:16", "amanhã às 10:33", "sex 02/10 às 10:33"; "—" sem hora.
export function quandoAs (t, agora = Date.now()) {
  t = ms(t)
  if (!ok(t)) return SEM
  const d = dia(t, agora)
  return `${d ? `${d} ` : ''}às ${partes(t).hm}`
}

// A margem da chegada, da mais cedo (p10) à mais tarde (p90): "amanhã 07:10–08:40"; o dia só uma vez.
export function margem (chegada, agora = Date.now()) {
  if (!chegada) return SEM
  const a = ms(chegada.p10); const b = ms(chegada.p90)
  if (!ok(a) || !ok(b)) return `${horaLisboa(a, agora)}–${horaLisboa(b, agora)}`
  if (partes(a).hm === partes(b).hm && partes(a).data === partes(b).data) return horaLisboa(a, agora)
  if (dia(a, agora) === dia(b, agora)) return `${horaLisboa(a, agora)}–${partes(b).hm}`
  return `${horaLisboa(a, agora)}–${horaLisboa(b, agora)}`
}

// 6,3 · "—" sem número.
export function num (x, casas = 1) {
  if (!ok(x)) return SEM
  const t = x.toFixed(casas)
  return (Number(t) === 0 ? (0).toFixed(casas) : t).replace('.', ',')
}

// "há 32 min", "há 5 h 30", "há 2 dias"; '' sem hora.
export function idade (t, agora = Date.now()) {
  t = ms(t)
  if (!ok(t)) return ''
  const min = Math.max(0, Math.round((agora - t) / 60000))
  if (min < 60) return `há ${min} min`
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return `há ${Math.floor(min / 1440)} dias`
}

// Uma "vela e motor" com menos de 0,1 h de vela (o cenário provável) vai toda a motor: o campo semVela
// do plugin (horas em bruto, o critério da junção das repetidas); sem ele (resultados antigos), o
// horas.vela arredondado.
const SEM_VENTO_VELA = 'a motor (sem vento para vela)'
const semVela = (alt) => alt.propulsao === 'vela' && (typeof alt.semVela === 'boolean' ? alt.semVela : ok(alt.horas?.vela) && alt.horas.vela < 0.1)

// "5 MN, só motor", "direta (salto curto), vela e motor", "5 MN pelo Canal da Berlenga, só motor",
// "8 MN, a motor (sem vento para vela)".
export function rotaCurta (alt = {}) {
  const onde = alt.direto ? 'direta (salto curto)' : ok(alt.afastamento) ? `${num(alt.afastamento, alt.afastamento % 1 ? 1 : 0)} MN` : ''
  const via = alt.canal ? `${onde ? `${onde} ` : ''}pelo ${alt.canal}` : onde
  const prop = alt.propulsao === 'motor' ? 'só motor' : semVela(alt) ? SEM_VENTO_VELA : alt.propulsao === 'vela' ? 'vela e motor' : ''
  return [via, prop].filter(Boolean).join(', ') || SEM
}

// O nome do plugin (com a hora da partida), ou o da rota; o "vela e motor" do plugin passa a "a motor
// (sem vento para vela)" quando a alternativa não tem vela.
export function nomeAlternativa (alt = {}) {
  if (!(typeof alt.nome === 'string' && alt.nome)) return rotaCurta(alt)
  return semVela(alt) ? alt.nome.replace(/vela e motor$/, SEM_VENTO_VELA) : alt.nome
}

// ---------- os nomes dos sítios: o artigo e as preposições (auditoria M-19; F3b item 8) ----------
// A MESMA tabela e as MESMAS regras de signalk-arlequin-rota/lib/costa.js (sitio.a, sitio.em…), que o plugin usa nos
// textos que manda aos contactos: "à Nazaré", "na Figueira da Foz", "ao Porto", "às Berlengas", "aos Farilhões", "em
// Peniche", "em Lagoa". O ecrã é um módulo do browser e não pode carregar o costa.js (CommonJS, com a costa e os
// dados): copia a tabela, sem lhe mudar uma letra, e test/sitios.test.mjs compara o texto das duas e o resultado sobre
// os destinos da rota e os nomes do plugin. (Antes o ecrã tinha uma lista só de femininos, com a Lagoa e as Berlengas
// no singular, e dizia "a Porto" e "à Berlengas".) Quem mudar uma tem de mudar a outra.
const SEM_ARTIGO = /^(Porto Covo|Porto de Mós)(?![\p{L}\p{N}])/iu
const ARTIGOS = Object.freeze([
  ['as', /^(Berlengas|Estelas|Caldas)(?![\p{L}\p{N}])/iu],
  ['os', /^(Farilhões|Açores)(?![\p{L}\p{N}])/iu],
  ['a', /^(Nazaré|Figueira|Ericeira|Berlenga|Póvoa|Costa|Fonte|Arrábida|Linha|Ponta|Barra|Ilha|Baía|Praia|Foz|Enseada|Boia|Bóia|Marina|Doca|Ria|Posição|Desistência)(?![\p{L}\p{N}])/iu],
  ['o', /^(Porto|Cabo|Largo|Canal|Cais|Ilhéu|Bugio|Farol|Molhe|Portinho|Cachopo|Banco|Rio|Pontal|Algarve|Tejo|Sado|Mondego|Destino|Fim|Fundeadouro|WP\d*)(?![\p{L}\p{N}])/iu]
])
const COMUNS = /^(Posição atual|Destino|Desistência|Fim da rota ativa)$/
const CONTRACOES = Object.freeze({
  a: { '': 'a', a: 'à', o: 'ao', as: 'às', os: 'aos' },
  em: { '': 'em', a: 'na', o: 'no', as: 'nas', os: 'nos' },
  de: { '': 'de', a: 'da', o: 'do', as: 'das', os: 'dos' },
  por: { '': 'por', a: 'pela', o: 'pelo', as: 'pelas', os: 'pelos' },
  para: { '': 'para', a: 'para a', o: 'para o', as: 'para as', os: 'para os' },
  ate: { '': 'até', a: 'até à', o: 'até ao', as: 'até às', os: 'até aos' },
  junto: { '': 'junto a', a: 'junto à', o: 'junto ao', as: 'junto às', os: 'junto aos' },
  com: { '': '', a: 'a', o: 'o', as: 'as', os: 'os' } // só o artigo: "entre Peniche e a Nazaré"
})
// O nome como vai a meio da frase (as palavras comuns com minúscula).
const noTexto = (nome) => { const n = String(nome ?? '').trim(); return COMUNS.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n }
// O artigo do nome: 'a' | 'o' | 'as' | 'os' | '' (sem artigo).
export function artigo (nome) {
  const n = noTexto(nome)
  if (!n || SEM_ARTIGO.test(n)) return ''
  for (const [a, re] of ARTIGOS) if (re.test(n)) return a
  return ''
}
// A preposição (a, em, de, por, para, ate, junto, com) com o nome: preposicao('em', 'Nazaré') → "na Nazaré".
export function preposicao (prep, nome) {
  const t = CONTRACOES[prep]
  if (!t) throw new Error(`preposição desconhecida: ${prep}`)
  const n = noTexto(nome)
  const p = t[artigo(n)]
  return p ? `${p} ${n}` : n
}
// sitio.a('Nazaré') → "à Nazaré", sitio.em('Peniche') → "em Peniche", sitio.de('Posição atual') → "da posição atual"…
export const sitio = Object.freeze(Object.fromEntries(Object.keys(CONTRACOES).map(k => [k, (nome) => preposicao(k, nome)])))
export const aNome = (nome) => sitio.a(nome)
export const emNome = (nome) => sitio.em(nome)

const CORES = { segue: 'verde', espera: 'amarelo', 'nao-recomendado': 'laranja', volta: 'vermelho' }
export const corVeredicto = (tipo) => CORES[tipo] || 'cinzento'

// Os avisos gerais do resultado que contam como vermelhos: previsão (velha, aproximada, em falta),
// gasóleo ou bateria assumidos.
const VERMELHO_GERAL = /previs|^Sem (nível do gasóleo|estado da bateria)/i

// Os avisos vermelhos de uma alternativa (índice i): os dela (segurança: limites a solo com
// tripulação, previsão em falta, gasóleo…), a nota do canal por confirmar, a previsão aproximada
// (avisosRota) e os gerais vermelhos (a previsão velha vem aqui, com a frase: o previsao.aviso do
// resultado é só um código, 'aviso' | 'grande', e nunca se mostra — auditoria I-28); e as fugas junto à
// costa com vento do mar dos pontos de desistência — só na 1.ª, para a qual se calcularam.
export function avisosVermelhos (resultado = {}, i = 0, agora = Date.now()) {
  const alt = resultado.alternativas?.[i]
  if (!alt) return []
  const out = [...(alt.avisosVermelhos || [])]
  if (alt.canal) out.push(alt.nota || `${alt.canal} por confirmar na carta`)
  for (const a of alt.avisosRota || []) if (/previs/i.test(a)) out.push(a)
  const temGasoleo = out.some(x => /gasóleo inicial desconhecido/.test(x))
  for (const a of resultado.avisos || []) {
    if (!VERMELHO_GERAL.test(a)) continue
    if (temGasoleo && /^Sem nível do gasóleo/.test(a)) continue
    out.push(a)
  }
  if (i === 0) {
    for (const p of resultado.desistencia || []) {
      // a mesma fuga (o mesmo aviso) para o abrigo e para a volta junta-se numa linha
      const porAviso = new Map()
      for (const f of [p.abrigo, p.voltar]) {
        if (!f?.avisoVermelho) continue
        if (!porAviso.has(f.avisoVermelho)) porAviso.set(f.avisoVermelho, [])
        if (f.nome && !porAviso.get(f.avisoVermelho).includes(f.nome)) porAviso.get(f.avisoVermelho).push(f.nome)
      }
      const onde = p.nome || (ok(p.milhas) ? `${num(p.milhas, 0)} MN feitas` : '')
      for (const [aviso, nomes] of porAviso) out.push(`Fuga ${quandoAs(p.t, agora)}${onde ? ` (${onde})` : ''}${nomes.length ? ` para ${nomes.join(' e ')}` : ''}: ${aviso}`)
    }
  }
  return [...new Set(out.filter(x => typeof x === 'string' && x))]
}

// Os avisos gerais que não são vermelhos (mostram-se à parte, a amarelo).
export const avisosGerais = (resultado = {}) => (resultado.avisos || []).filter(a => typeof a === 'string' && a && !VERMELHO_GERAL.test(a))

// "previsão das 15:00 (há 32 min), AI v0003 · 114 alternativas avaliadas"
export function linhaPrevisao (resultado = {}, agora = Date.now()) {
  const obtida = ms(resultado.previsao?.obtida)
  if (!ok(obtida)) return ''
  const versoes = Object.values(resultado.ia?.versoes || {}).filter(v => typeof v === 'string' && v).sort()
  const ai = versoes.length ? `AI ${versoes.at(-1)}` : 'AI: a aprender'
  const n = resultado.estatisticas?.candidatos
  return `previsão das ${horaLisboa(obtida, agora)} (${idade(obtida, agora)}), ${ai}${ok(n) ? ` · ${n} alternativas avaliadas` : ''}`
}
