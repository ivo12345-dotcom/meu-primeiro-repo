// Quanto ocupa o "sobe e desce" na caixa negra? Usa o gravador verdadeiro do plugin
// (signalk-arlequin-caixanegra/lib/bruto.js), com um bloco por segundo de 10 leituras (aceleração,
// rotação e inclinação), despejado de 10 em 10 s, como faz o plugin. Simula uma hora.
//   node tamanho.js
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { criarGravadorBruto } = require(path.join(__dirname, '..', '..', 'signalk-arlequin-caixanegra', 'lib', 'bruto.js'))
const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ondas-'))

function gauss () { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) }

function hora (nome, formato) {
  const dir = path.join(saida, nome)
  const g = criarGravadorBruto(dir)
  const t0 = Date.UTC(2026, 10, 22, 10, 0, 0)
  let bytesTexto = 0
  for (let s = 0; s < 3600; s++) {
    const a = []; const w = []; const i = []
    for (let k = 0; k < 10; k++) {
      const t = s + k / 10
      // movimento parecido com o de um barco: ondas de 8 s e balanço de 5 s, mais ruído
      const onda = 0.4 * Math.sin(2 * Math.PI * t / 8) + 0.15 * Math.sin(2 * Math.PI * t / 3.1)
      const rol = 0.31 + 0.07 * Math.sin(2 * Math.PI * t / 5); const cai = 0.05 * Math.sin(2 * Math.PI * t / 8 + 1)
      a.push([0.5 + 0.3 * Math.sin(t) + 0.013 * gauss(), 3.0 + 0.3 * Math.cos(t / 2) + 0.013 * gauss(), -9.3 + onda + 0.013 * gauss()])
      w.push([0.088 * Math.cos(2 * Math.PI * t / 5) + 0.002 * gauss(), 0.04 * Math.cos(2 * Math.PI * t / 8 + 1) + 0.002 * gauss(), 0.002 * gauss()])
      i.push([rol + 0.001 * gauss(), cai + 0.001 * gauss()])
    }
    const delta = {
      context: 'vessels.urn:mrn:imo:mmsi:263000000',
      updates: [{ $source: 'signalk-arlequin-caixas', timestamp: new Date(t0 + s * 1000).toISOString(), values: [{ path: 'arlequin.caixas.movimento', value: formato(a, w, i, s) }] }]
    }
    bytesTexto += JSON.stringify(delta).length + 1
    g.escrever(delta, t0 + s * 1000)
    if (s % 10 === 9) g.despejar()
  }
  g.despejar()
  const gz = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0)
  console.log(`${nome.padEnd(34)} texto ${(bytesTexto / 1e6).toFixed(2)} MB/h   gravado ${(gz / 1e6).toFixed(2)} MB/h   (${(gz * 24 / 1e6).toFixed(0)} MB por dia inteiro, ${(gz * 300 / 1e9).toFixed(2)} GB em 300 h)`)
}

const dec = (n) => (x) => Number(x.toFixed(n))
hora('decimais (3 casas acel., 4 resto)', (a, w, i, s) => ({ n: s * 10, a: a.map(v => v.map(dec(3))), w: w.map(v => v.map(dec(4))), i: i.map(v => v.map(dec(4))) }))
hora('inteiros (mm/s2, 0,1 mrad/s, 0,1 mrad)', (a, w, i, s) => ({ n: s * 10, a: a.map(v => v.map(x => Math.round(x * 1000))), w: w.map(v => v.map(x => Math.round(x * 1e4))), i: i.map(v => v.map(x => Math.round(x * 1e4))) }))
hora('so aceleracao e inclinacao', (a, w, i, s) => ({ n: s * 10, a: a.map(v => v.map(x => Math.round(x * 1000))), i: i.map(v => v.map(x => Math.round(x * 1e4))) }))
fs.rmSync(saida, { recursive: true, force: true })
