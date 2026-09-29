'use strict'
// Saídas: começa quando o barco sai a mais de 0,5 MN de um porto conhecido e
// termina quando volta a um porto e fica parado 10 min. Soma milhas (só a
// andar, para o GPS parado não inventar milhas), horas à vela e a motor,
// gasóleo e a bateria no início e no fim.

const { portoMaisPerto, distanciaMn } = require('./geo')

const NO = 1852 / 3600
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100
const iso = (t) => new Date(t).toISOString()

function novaSaidas () { return { emCurso: null, paradoDesde: null, ultimoPorto: null } }

function atualizar (s0, a, portos, { raioMn = 0.5, paragemMs = 600000 } = {}) {
  const s = { ...s0 }
  const perto = portoMaisPerto(a.pos, portos)
  const noPorto = !!perto && perto.mn <= raioMn
  let terminada = null
  if (!s.emCurso) {
    if (perto && !noPorto) {
      s.emCurso = { inicio: a.t, de: s.ultimoPorto, milhas: 0, horasVela: 0, horasMotor: 0, gasoleoL: 0, socInicio: a.soc ?? null, simulado: !!a.simulado, ultimo: a }
    }
  } else {
    const e = { ...s.emCurso }
    const dtH = (a.t - e.ultimo.t) / 3600000
    if (dtH > 0 && dtH < 0.1) {
      const andar = (a.sog ?? 0) > 0.5 * NO
      if (andar && e.ultimo.pos && a.pos) e.milhas += distanciaMn(e.ultimo.pos, a.pos)
      if (a.motor) e.horasMotor += dtH
      else if ((a.sog ?? 0) > 1 * NO) e.horasVela += dtH
      if (Number.isFinite(a.litrosHora)) e.gasoleoL += a.litrosHora * dtH
    }
    if (a.simulado) e.simulado = true
    e.ultimo = a
    s.emCurso = e
    if (noPorto && (a.sog ?? 0) < 0.5 * NO) {
      s.paradoDesde = s.paradoDesde ?? a.t
      if (a.t - s.paradoDesde >= paragemMs) {
        terminada = {
          inicio: iso(e.inicio), fim: iso(a.t), de: e.de, para: perto.nome,
          milhas: r1(e.milhas), horasVela: r2(e.horasVela), horasMotor: r2(e.horasMotor), gasoleoL: r2(e.gasoleoL),
          socInicio: e.socInicio, socFim: a.soc ?? null, simulado: e.simulado
        }
        s.emCurso = null
        s.paradoDesde = null
      }
    } else {
      s.paradoDesde = null
    }
  }
  if (!s.emCurso && noPorto) s.ultimoPorto = perto.nome
  return { s, terminada }
}

module.exports = { novaSaidas, atualizar }
