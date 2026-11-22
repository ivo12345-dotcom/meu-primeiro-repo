// Quanto ocupa o movimento do barco na caixa negra? Usa o gravador verdadeiro do plugin
// (signalk-arlequin-caixanegra/lib/bruto.js) e o bloco verdadeiro do plugin das caixas
// (signalk-arlequin-caixas/lib/movimento.js): um bloco por segundo com 10 leituras, cada uma com o
// número de ordem, as leituras do sensor na média, a aceleração (mm/s²), a rotação (0,1 mrad/s) e a
// orientação completa (quaternião × 10 000). Despeja de 10 em 10 s, como faz o plugin. Simula uma hora.
//   node tamanho.js
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { criarGravadorBruto } = require(path.join(__dirname, '..', '..', 'signalk-arlequin-caixanegra', 'lib', 'bruto.js'))
const { novoBloco, juntar, fechar } = require(path.join(__dirname, '..', '..', 'signalk-arlequin-caixas', 'lib', 'movimento.js'))
const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-ondas-'))

function gauss () { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) }

// Guinada, caimento e adornamento (rad) → quaternião [i, j, k, r].
function quaterniao (gui, cai, rol) {
  const cy = Math.cos(gui / 2); const sy = Math.sin(gui / 2)
  const cp = Math.cos(cai / 2); const sp = Math.sin(cai / 2)
  const cr = Math.cos(rol / 2); const sr = Math.sin(rol / 2)
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]
}

function hora (nome) {
  const dir = path.join(saida, 'movimento')
  const g = criarGravadorBruto(dir)
  const t0 = Date.UTC(2026, 10, 22, 10, 0, 0)
  let bytesTexto = 0
  for (let s = 0; s < 3600; s++) {
    let bloco = novoBloco()
    for (let k = 0; k < 10; k++) {
      const t = s + k / 10
      // movimento parecido com o de um barco: ondas de 8 s e balanço de 5 s, a proa a passear, mais ruído
      const onda = 0.4 * Math.sin(2 * Math.PI * t / 8) + 0.15 * Math.sin(2 * Math.PI * t / 3.1)
      const rol = 0.31 + 0.07 * Math.sin(2 * Math.PI * t / 5) + 0.001 * gauss()
      const cai = 0.05 * Math.sin(2 * Math.PI * t / 8 + 1) + 0.001 * gauss()
      const gui = 1.2 + 0.06 * Math.sin(2 * Math.PI * t / 23) + 0.002 * gauss()
      bloco = juntar(bloco, {
        n: s * 10 + k,
        k: 10,
        a: [0.5 + 0.3 * Math.sin(t) + 0.013 * gauss(), 3.0 + 0.3 * Math.cos(t / 2) + 0.013 * gauss(), -9.3 + onda + 0.013 * gauss()].map(x => Math.round(x * 1000)),
        w: [0.088 * Math.cos(2 * Math.PI * t / 5) + 0.002 * gauss(), 0.04 * Math.cos(2 * Math.PI * t / 8 + 1) + 0.002 * gauss(), 0.002 * gauss()].map(x => Math.round(x * 1e4)),
        q: quaterniao(gui, cai, rol).map(x => Math.round(x * 1e4))
      })
    }
    const delta = {
      context: 'vessels.urn:mrn:imo:mmsi:263000000',
      updates: [{ $source: 'signalk-arlequin-caixas', timestamp: new Date(t0 + s * 1000).toISOString(), values: [{ path: 'arlequin.caixas.movimento', value: fechar(bloco) }] }]
    }
    bytesTexto += JSON.stringify(delta).length + 1
    g.escrever(delta, t0 + s * 1000)
    if (s % 10 === 9) g.despejar()
  }
  g.despejar()
  const gz = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0)
  console.log(`${nome.padEnd(34)} texto ${(bytesTexto / 1e6).toFixed(2)} MB/h   gravado ${(gz / 1e6).toFixed(2)} MB/h   (${(gz * 24 / 1e6).toFixed(0)} MB por dia inteiro, ${(gz * 300 / 1e9).toFixed(2)} GB em 300 h)`)
}

hora('bloco do movimento (n, k, a, w, q)')
fs.rmSync(saida, { recursive: true, force: true })
