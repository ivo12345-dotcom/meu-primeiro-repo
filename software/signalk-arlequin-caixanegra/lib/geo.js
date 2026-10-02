'use strict'
// Distâncias em milhas e o porto mais perto. Os portos das saídas são uma só lista
// (decisão n.º 25, contrato C4): os destinos do plugin da rota
// (signalk-arlequin-rota/dados/destinos.json, só se lê, nunca se escreve) e os extras
// da própria caixa negra, os portos e fundeadouros que não são destinos da rota.

const fs = require('node:fs')
const path = require('node:path')

const GRAU = Math.PI / 180

// O ficheiro dos destinos da rota, no mesmo repositório (o Pi corre os plugins do clone).
const DESTINOS_DA_ROTA = path.join(__dirname, '..', '..', 'signalk-arlequin-rota', 'dados', 'destinos.json')

// Portos e fundeadouros que fecham as saídas sem serem destinos da rota. A Ericeira não
// é destino da rota (decisão n.º 25); os fundeadouros que o Ivo usar juntam-se aqui ou
// na configuração do plugin.
const EXTRAS = [
  { nome: 'Ericeira', lat: 38.9630, lon: -9.4180 }
]

const parValido = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])

// O sítio de um destino da rota: o cais, o último ponto da aproximação (como faz o plugin
// da rota para o "Chegaste a X?"); sem aproximação, o largo.
function cais (d) {
  const ap = d?.aproximacao
  if (Array.isArray(ap) && ap.length && parValido(ap.at(-1))) return ap.at(-1)
  return parValido(d?.largo) ? d.largo : null
}

// [{ nome, lat, lon }] dos destinos da rota. Rebenta se o ficheiro falta ou não é uma
// lista: quem chama avisa (as saídas ficavam por fechar em silêncio).
function portosDaRota (ficheiro = DESTINOS_DA_ROTA) {
  const lista = JSON.parse(fs.readFileSync(ficheiro, 'utf8'))
  if (!Array.isArray(lista)) throw new Error('não é uma lista de destinos')
  const out = []
  for (const d of lista) {
    const p = cais(d)
    if (p && typeof d.nome === 'string' && d.nome.trim()) out.push({ nome: d.nome, lat: p[0], lon: p[1] })
  }
  return out
}

const chave = (nome) => String(nome ?? '').trim().toLowerCase()

// Os da rota e os extras; um extra com o nome de um porto da rota fica de fora (vale o
// sítio da rota: uma configuração antiga, com a lista dos 7 portos, não os repete).
function juntarPortos (daRota, extras = []) {
  const nomes = new Set(daRota.map(p => chave(p.nome)))
  const out = [...daRota]
  for (const p of extras) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || nomes.has(chave(p.nome))) continue
    nomes.add(chave(p.nome))
    out.push({ nome: p.nome, lat: p.lat, lon: p.lon })
  }
  return out
}

// A lista por omissão (os destinos da rota de agora e os extras); o plugin volta a ler
// os destinos em cada arranque. Sem o ficheiro da rota ficam só os extras.
let daRotaAoCarregar = []
try { daRotaAoCarregar = portosDaRota() } catch { /* o plugin diz porquê ao arrancar */ }
const PORTOS = juntarPortos(daRotaAoCarregar, EXTRAS)

const lat = (p) => p.latitude ?? p.lat
const lon = (p) => p.longitude ?? p.lon

function distanciaMn (a, b) {
  const la1 = lat(a) * GRAU
  const la2 = lat(b) * GRAU
  const dla = la2 - la1
  const dlo = (lon(b) - lon(a)) * GRAU
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2
  return 2 * Math.asin(Math.sqrt(h)) * 3440.065
}

function portoMaisPerto (pos, portos = PORTOS) {
  if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) return null
  let melhor = null
  for (const p of portos) {
    const mn = distanciaMn(pos, p)
    if (!melhor || mn < melhor.mn) melhor = { nome: p.nome, mn }
  }
  return melhor
}

module.exports = { PORTOS, EXTRAS, DESTINOS_DA_ROTA, portosDaRota, juntarPortos, distanciaMn, portoMaisPerto }
