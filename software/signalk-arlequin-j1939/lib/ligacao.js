'use strict'
// O estado da ligação ao motor (contrato C11 da auditoria; revisão F6, Importante 3): o plugin tem de
// distinguir a ignição desligada (o MDI cala-se) de uma leitura perdida (o adaptador USB-CAN solto, a
// interface em baixo, o candump a falhar). Com o leitor que o plugin usa (candump -L <if>) há dois sinais
// independentes, e as tramas valem mais do que os dois:
//   1. a interface no Linux, em /sys/class/net/<if>: sem a pasta, a interface não existe (o adaptador USB
//      soltou-se ou não está configurado); "operstate" up (ou "unknown", o das interfaces virtuais e dos
//      drivers que não dizem se há "carrier") com a flag IFF_UP = de pé; "down" = desligada (ip link set
//      <if> down) ou sem "carrier" (bus-off). Lê-se a cada segundo (dois ficheiros pequenos).
//   2. o candump: vivo desde que é lançado até sair ('close') ou não arrancar ('error'). Sai sozinho quando
//      a interface vai abaixo ("read: Network is down") e não arranca sem ela ("SIOCGIFINDEX: No such
//      device") nem sem o can-utils (ENOENT); o plugin volta a lançá-lo de 5 em 5 s.
// Os estados:
//   'a-receber'   uma trama (qualquer PGN) há menos de 5 s;
//   'calado'      a interface de pé, o candump vivo há mais de 5 s e nenhuma trama há mais de 5 s. O Pi só
//                 escuta (listen-only): um barramento em que ninguém fala é o MDI desligado, ou seja, a
//                 ignição desligada;
//   'sem-ligacao' a interface não existe ou está em baixo, ou o candump não está a correr. Um candump
//                 acabado de relançar ainda não confirma nada: fica 'sem-ligacao' até ter 5 s;
//   null          ainda não se sabe (os primeiros 5 s depois do arranque, sem tramas).
// O que nenhum dos dois sinais vê: um fio CAN solto entre o adaptador e o MDI, com a interface de pé, é
// igual à ignição desligada (só escutamos: ninguém responde a nada). Fica escrito no NAVEGACAO.
// No simulador (fonte 'simulador') não há interface nem candump: só 'a-receber' e 'calado'.

const fs = require('node:fs')
const path = require('node:path')

const VELHO = 5000 // uma trama mais velha do que isto já não conta (o mesmo do K-07)
const IFF_UP = 0x1
const NOME = /^[A-Za-z0-9_.:-]{1,15}$/ // um nome de interface do Linux (nunca um caminho)

// A interface como o Linux a mostra: { existe, ativa, estado } (estado: o operstate, ou null).
function lerInterface (nome, base = '/sys/class/net') {
  if (typeof nome !== 'string' || !NOME.test(nome) || nome === '.' || nome === '..') return { existe: false, ativa: false, estado: null }
  const dir = path.join(base, nome)
  let estado
  try { estado = fs.readFileSync(path.join(dir, 'operstate'), 'utf8').trim() } catch { return { existe: false, ativa: false, estado: null } }
  let flags = NaN
  try { flags = parseInt(fs.readFileSync(path.join(dir, 'flags'), 'utf8').trim(), 16) } catch { /* sem as flags: só o operstate */ }
  const deCima = Number.isNaN(flags) || (flags & IFF_UP) === IFF_UP
  return { existe: true, ativa: deCima && (estado === 'up' || estado === 'unknown'), estado }
}

// → { ligacao: 'a-receber' | 'calado' | 'sem-ligacao' | null, motivo (só em 'sem-ligacao') }
// s: { agora, ultimaTrama, simulador, ouvirDesde (o candump de agora, ou o simulador, à escuta desde),
//      candumpVivo, lerInterface: () => { existe, ativa, estado }, anterior (o estado de antes),
//      motivoCandump (o último erro do candump), nome (da interface) }
function avaliarLigacao (s) {
  if (s.agora - s.ultimaTrama <= VELHO) return { ligacao: 'a-receber', motivo: null }
  const aEscutaHa = s.agora - s.ouvirDesde
  if (s.simulador) return { ligacao: aEscutaHa > VELHO ? 'calado' : null, motivo: null }
  const i = s.lerInterface()
  if (!i.existe) return { ligacao: 'sem-ligacao', motivo: `a interface ${s.nome} não existe (adaptador USB-CAN solto?)` }
  if (!i.ativa) return { ligacao: 'sem-ligacao', motivo: `a interface ${s.nome} está em baixo (estado "${i.estado}": desligada ou em bus-off; ver ip -details link show ${s.nome})` }
  if (!s.candumpVivo) return { ligacao: 'sem-ligacao', motivo: s.motivoCandump || 'o candump não está a correr' }
  if (aEscutaHa > VELHO) return { ligacao: 'calado', motivo: null }
  // o candump acabou de (re)arrancar: ainda não diz nada; quem estava sem ligação continua até confirmar
  if (s.anterior === 'sem-ligacao') return { ligacao: 'sem-ligacao', motivo: s.motivoCandump || 'o candump acabou de arrancar' }
  return { ligacao: null, motivo: null }
}

module.exports = { VELHO, lerInterface, avaliarLigacao }
