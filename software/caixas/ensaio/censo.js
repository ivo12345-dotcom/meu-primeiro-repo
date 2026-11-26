'use strict'
// As contas da primeira escuta do motor (ouvir-motor.js), separadas da porta para se ensaiarem sem placas.
// Recebe, uma a uma, as linhas que a caixa 1 manda ao portátil e diz o que a caixa 2 ouviu na linha do
// motor: quantas tramas, de que tipos, de que aparelhos, e os valores que já sabemos ler.
// Não manda nada a ninguém: só conta.
const { ler } = require('../../signalk-arlequin-caixas/lib/linhas')
const { partesId, descodificar } = require('../../signalk-arlequin-j1939/lib/j1939')

const VIVA = 5000 // ms: a caixa 2 dá o batimento de segundo a segundo; mais do que isto sem ele, não dá sinal
const K = 273.15

// O nome de cada tipo de trama (PGN) que interessa neste motor. Os de 0xFF00 a 0xFFFF são do fabricante.
const NOMES = {
  61444: 'rotações',
  61443: 'acelerador e carga',
  65253: 'horas',
  65262: 'temperaturas',
  65263: 'pressões',
  65266: 'consumo',
  65271: 'tensão',
  65276: 'níveis',
  65226: 'avarias ativas',
  60928: 'apresentação do aparelho',
  65417: 'da Volvo, talvez os alarmes'
}
const nomeDe = (pgn) => NOMES[pgn] || (pgn >= 0xFF00 && pgn <= 0xFFFF ? 'da Volvo, por conhecer' : 'por conhecer')

const virgula = (v, casas) => v.toFixed(casas).replace('.', ',')
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// O valor de cada caminho, dito em unidades de bordo.
const DIZER = {
  'propulsion.main.revolutions': (v) => `rotações ${Math.round(v * 60)}`,
  'propulsion.main.temperature': (v) => `água ${Math.round(v - K)} °C`,
  'propulsion.main.oilTemperature': (v) => `óleo ${Math.round(v - K)} °C`,
  'propulsion.main.oilPressure': (v) => `pressão do óleo ${virgula(v / 100000, 1)} bar`,
  'propulsion.main.fuel.rate': (v) => `consumo ${virgula(v * 3600 * 1000, 1)} L/h`,
  'propulsion.main.alternatorVoltage': (v) => `tensão ${virgula(v, 1)} V`,
  'propulsion.main.runTime': (v) => `horas ${virgula(v / 3600, 1)}`
}

const hex = (dados) => (dados.match(/../g) || []).join(' ')

// agora: o relógio do portátil, em ms (para os ensaios lhe darem outro).
function novoCenso ({ agora = Date.now } = {}) {
  const inicio = agora()
  const tipos = new Map() // "pgn/origem" → { pgn, origem, n, dados, diferentes }
  const valores = new Map() // caminho → último valor
  const estado = {
    linhas: 0, estragadas: 0, outras: 0, tramas: 0,
    caixa2: { batimentos: 0, rssi: null, perdidos: 0, recomecos: 0, fw: null, finge: false, ms: null, hora: null }
  }

  function batimento (b) {
    if (b.caixa !== 2) { estado.outras++; return }
    const c2 = estado.caixa2
    if (c2.ms !== null && b.ms < c2.ms) c2.recomecos++
    Object.assign(c2, { batimentos: c2.batimentos + 1, rssi: b.rssi, perdidos: b.perdidos, fw: b.fw, finge: b.sim, ms: b.ms, hora: agora() })
  }

  function trama (m) {
    estado.tramas++
    const { pgn, origem } = partesId(m.id)
    const chave = `${pgn}/${origem}`
    const t = tipos.get(chave) || { pgn, origem, n: 0, dados: '', diferentes: new Set() }
    t.n++
    t.dados = m.dados
    if (t.diferentes.size < 1000) t.diferentes.add(m.dados)
    tipos.set(chave, t)
    const bytes = Uint8Array.from((m.dados.match(/../g) || []).map((h) => parseInt(h, 16)))
    for (const { path, value } of descodificar(pgn, bytes)) valores.set(path, value)
  }

  function linha (texto) {
    if (typeof texto !== 'string' || texto.trim().length === 0) return
    estado.linhas++
    const l = ler(texto)
    if (l === null) { estado.estragadas++; return }
    if (l.tipo === 'batimento') batimento(l)
    else if (l.tipo === 'motor') trama(l)
    else estado.outras++
  }

  // Uma linha só, para ir dizendo como está: a caixa 2, as tramas e os valores lidos.
  function resumo () {
    const c2 = estado.caixa2
    const partes = []
    const calada = c2.hora === null ? null : agora() - c2.hora
    if (calada === null) partes.push('caixa 2: SEM SINAL')
    else if (calada > VIVA) partes.push(`caixa 2: SEM SINAL há ${Math.floor(calada / 1000)} s`)
    else {
      let t = `caixa 2: sinal ${c2.rssi}, ${plural(c2.perdidos, 'perdido', 'perdidos')}`
      if (c2.recomecos > 0) t += `, ${plural(c2.recomecos, 'recomeço', 'recomeços')}`
      if (c2.finge) t += ', A FINGIR'
      partes.push(t)
    }
    if (estado.tramas === 0) partes.push('motor: nenhuma trama')
    else {
      const s = (agora() - inicio) / 1000
      const ritmo = s >= 1 ? ` (${Math.round(estado.tramas / s)}/s)` : ''
      partes.push(`motor: ${plural(estado.tramas, 'trama', 'tramas')}${ritmo}, ${plural(tipos.size, 'tipo', 'tipos')}`)
    }
    for (const [caminho, dizer] of Object.entries(DIZER)) {
      if (valores.has(caminho)) partes.push(dizer(valores.get(caminho)))
    }
    if (estado.estragadas > 0) partes.push(`${plural(estado.estragadas, 'linha estragada', 'linhas estragadas')}`)
    return partes.join(' · ')
  }

  // Uma linha por tipo de trama e por aparelho, por ordem do número do tipo.
  function tabela () {
    const s = (agora() - inicio) / 1000
    return [...tipos.values()]
      .sort((a, b) => a.pgn - b.pgn || a.origem - b.origem)
      .map((t) => {
        const ritmo = s >= 1 ? `, ${virgula(t.n / s, 1)}/s` : ''
        const variou = t.diferentes.size > 1 ? `, ${t.diferentes.size} valores diferentes` : ''
        return `tipo ${t.pgn} (${nomeDe(t.pgn)}), aparelho ${t.origem}: ${plural(t.n, 'trama', 'tramas')}${ritmo}${variou}; últimos bytes ${hex(t.dados)}`
      })
  }

  return { linha, resumo, tabela, estado }
}

module.exports = { novoCenso, NOMES }
