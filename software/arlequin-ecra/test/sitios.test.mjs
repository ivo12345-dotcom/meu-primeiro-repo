// As preposições com os nomes dos sítios no ecrã (F3b item 8; auditoria M-19 e F1): "Chegaste à Nazaré?", "ao Porto",
// "às Berlengas", "em Lagoa" — a mesma lista e as mesmas regras de signalk-arlequin-rota/lib/costa.js (sitio.a/em/…),
// que o plugin usa nos textos que manda aos contactos. O ecrã é um módulo do browser e não pode carregar o costa.js
// (CommonJS, com a costa e os dados): copia a tabela, e este teste compara as duas — o texto da tabela e o resultado
// sobre os 15 destinos da rota, os fundeadouros e os nomes dos testes do plugin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { aNome, emNome, artigo, preposicao, sitio } from '../public/lib/rota-texto.js'
import { semCR } from './ajuda-fonte.mjs'
import melhor from '../public/paginas/melhor.js'

const require = createRequire(import.meta.url)
const costa = require('../../signalk-arlequin-rota/lib/costa.js')
const DESTINOS = require('../../signalk-arlequin-rota/dados/destinos.json')

// os nomes que o plugin da rota usa e que o ecrã pode ouvir: os destinos, os que o Ivo acrescenta (fundeadouros, pontos),
// os do teste do plugin (M-19), as palavras comuns e o que começa como um sítio com artigo sem o ter
const NOMES = [
  ...DESTINOS.map(d => d.nome),
  'Nazaré', 'Figueira da Foz', 'Ponta de Sagres', 'Berlengas', 'Berlenga', 'Farilhões', 'Cabo Raso', 'Porto', 'Peniche', 'Algés (CNA)',
  'Portimão', 'Porto Covo', 'Porto de Mós', 'Posição atual', 'Destino', 'destino', 'Desistência', 'Fim da rota ativa',
  'Lagoa', 'Lagoa de Albufeira', 'Ericeira', 'Póvoa de Varzim', 'Praia da Ursa', 'Baía de Cascais', 'Costa da Caparica', 'Fonte da Telha',
  'Arrábida', 'Marina de Cascais', 'Doca de Alcântara', 'Ria Formosa', 'Estelas', 'Caldas da Rainha', 'Açores', 'Bugio', 'Farol do Cabo Raso',
  'Canal da Berlenga', 'Largo de Cascais', 'Tejo', 'Sado', 'Mondego', 'Algarve', 'Cais do Sodré', 'Ilhéu da Berlenga', 'Molhe Leste',
  'Fundeadouro de Peniche', 'WP3', 'WP', 'Boia de Cascais', 'Bóia 2', 'Barra do Tejo', 'Enseada de Sesimbra', 'Linha de 5 MN', 'Foz do Arelho',
  'Banco do Cachopo', 'Pontal', 'Rio Arade', 'Cachopo', 'Ilha da Culatra', 'Viana do Castelo', 'Leixões', 'Sines', 'Lagos', 'Olhão', '  Nazaré  '
]
const PREPOSICOES = ['a', 'em', 'de', 'por', 'para', 'ate', 'junto', 'com']

test('as preposições e os artigos do ecrã são os do plugin da rota (costa.js): o mesmo resultado em todos os nomes, nas 8 preposições', () => {
  for (const nome of NOMES) {
    assert.equal(artigo(nome), costa.artigo(nome), `artigo de "${nome}"`)
    for (const p of PREPOSICOES) {
      assert.equal(sitio[p](nome), costa.sitio[p](nome), `${p} "${nome}"`)
      assert.equal(preposicao(p, nome), costa.preposicao(p, nome), `preposicao ${p} "${nome}"`)
    }
    assert.equal(aNome(nome), costa.sitio.a(nome), `aNome "${nome}"`)
    assert.equal(emNome(nome), costa.sitio.em(nome), `emNome "${nome}"`)
  }
  assert.throws(() => preposicao('sobre', 'Nazaré'), /preposição desconhecida/)
})

test('a tabela de artigos do ecrã é textualmente a do costa.js (sem os comentários nem os espaços): quem muda uma lista tem de mudar a outra', () => {
  const bloco = (ficheiro) => {
    const texto = semCR(readFileSync(new URL(ficheiro, import.meta.url), 'utf8'))
    const i = texto.indexOf('const SEM_ARTIGO')
    const j = texto.indexOf('const noTexto')
    assert.ok(i >= 0 && j > i, `${ficheiro}: não achei a tabela`)
    return texto.slice(i, j).split('\n').map(l => l.replace(/\s*\/\/.*$/, '').trim()).filter(Boolean).join('\n')
  }
  const ecra = bloco('../public/lib/rota-texto.js')
  const rota = bloco('../../signalk-arlequin-rota/lib/costa.js')
  assert.ok(ecra.length > 600, 'a tabela não está vazia')
  assert.equal(ecra, rota)
})

test('"Chegaste à Nazaré?", "ao Porto", "às Berlengas", "aos Farilhões", "a Cascais", "a Lagoa" — as preposições da tabela do plugin', () => {
  for (const [nome, a, em] of [
    ['Nazaré', 'à Nazaré', 'na Nazaré'], ['Figueira da Foz', 'à Figueira da Foz', 'na Figueira da Foz'], ['Ericeira', 'à Ericeira', 'na Ericeira'],
    ['Berlenga', 'à Berlenga', 'na Berlenga'], ['Berlengas', 'às Berlengas', 'nas Berlengas'], ['Farilhões', 'aos Farilhões', 'nos Farilhões'],
    ['Porto', 'ao Porto', 'no Porto'], ['Cabo Raso', 'ao Cabo Raso', 'no Cabo Raso'], ['Bugio', 'ao Bugio', 'no Bugio'], ['Canal da Berlenga', 'ao Canal da Berlenga', 'no Canal da Berlenga'],
    ['Póvoa de Varzim', 'à Póvoa de Varzim', 'na Póvoa de Varzim'], ['Praia da Ursa', 'à Praia da Ursa', 'na Praia da Ursa'],
    ['Cascais', 'a Cascais', 'em Cascais'], ['Peniche', 'a Peniche', 'em Peniche'], ['Algés (CNA)', 'a Algés (CNA)', 'em Algés (CNA)'], ['Viana do Castelo', 'a Viana do Castelo', 'em Viana do Castelo'],
    ['Lagoa', 'a Lagoa', 'em Lagoa'], ['Portimão', 'a Portimão', 'em Portimão'], ['Porto Covo', 'a Porto Covo', 'em Porto Covo'], ['Posição atual', 'à posição atual', 'na posição atual'], ['Destino', 'ao destino', 'no destino']
  ]) {
    assert.equal(aNome(nome), a, nome)
    assert.equal(emNome(nome), em, nome)
  }
  // a Lagoa do Algarve não leva artigo (a lista do plugin não a tem): "em Lagoa", nunca "na Lagoa"
  assert.equal(emNome('Lagoa'), 'em Lagoa')
  // os 15 destinos da rota: só a Nazaré e a Figueira da Foz levam artigo, como no plugin
  assert.deepEqual(DESTINOS.filter(d => artigo(d.nome)).map(d => d.id).sort(), ['figueira', 'nazare'])
})

// o Leme: a pergunta "Chegaste a X?" com a preposição certa, e o que se envia
const AGORA = Date.parse('2026-09-29T14:32:00Z')
const ROTA = '/plugins/signalk-arlequin-rota'
const PAUSADO = { estado: 'pausado', pausadoDe: 'a navegar', ativadoEm: new Date(AGORA - 4 * 3600000).toISOString(), idCalculo: 'c1', indice: 0, destino: { id: 'peniche', nome: 'Peniche' }, tripulacao: 'so', avisos: [], envio: null, filaContactos: [], enviadas: [] }
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('o Leme pergunta "Chegaste ao Porto?" / "às Berlengas?" / "a Lagoa?" e o que envia leva a mesma preposição', async () => {
  for (const [nome, frase] of [['Porto', 'ao Porto'], ['Berlengas', 'às Berlengas'], ['Farilhões', 'aos Farilhões'], ['Lagoa', 'a Lagoa'], ['Nazaré', 'à Nazaré'], ['Cascais', 'a Cascais']]) {
    const pedidos = []
    const ctx = {
      v: (p) => ({ 'navigation.course.activeRoute': { href: '/resources/routes/r1', name: 'Arlequin → Peniche' } })[p], idade: () => 0, polar: null, agora: AGORA, agendar: () => {}, guardado: (k, d) => d, guardar: () => {}, refrescar: () => {}, noite: false,
      estado: { planoAtivo: { ...PAUSADO, chegadaOutro: { id: 'x', nome } }, planoAtivoEm: AGORA, planoAtivoLidoEm: AGORA },
      pedir: async (url, o = {}) => { pedidos.push([o.method || 'GET', url]); return { ok: true, estado: 'chegado', contactos: true } }
    }
    assert.match(texto(melhor.render(ctx)), new RegExp(`Chegaste ${frase}\\? Enviar 'cheguei bem ${frase}'`), nome)
    await melhor.acao('rota-chegada', {}, ctx)
    assert.match(texto(melhor.render(ctx)), new RegExp(`Enviado aos contactos em terra: 'cheguei bem ${frase}'`), nome)
  }
})
