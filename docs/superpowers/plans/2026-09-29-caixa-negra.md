# Caixa negra do Arlequin: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gravar todos os dados do barco desde o primeiro dia em `~/arlequin-dados`:
- `bruto/`: todas as mensagens;
- `tabela/`: uma linha de 10 s para a AI;
- `saidas/`: resumo de cada saída.

Também passa a haver:
- botões do estado das velas no ecrã;
- uma ferramenta que copia os dados para o portátil pelo Tailscale e confirma ao Pi o que chegou bem.

**Architecture:**
- Um plugin SignalK novo, `signalk-arlequin-caixanegra`, ouve o evento `unfilteredDelta` do servidor, que passa todas as mensagens de todas as fontes.
  - Escreve NDJSON e CSV comprimidos com blocos gzip acrescentados, que são seguros se a energia falhar.
  - Mantém um estado com os últimos valores do próprio barco, para a linha de 10 s.
  - A lógica está em módulos puros em `lib/`, testados um a um. O `index.js` só liga as peças.
- O portátil deixa listas de confirmação em `entrada/`. O plugin confere cada hash antes de marcar um ficheiro como apagável.
- **Só apaga bruto confirmado, e só acima dos 80% de disco.**

**Tech Stack:**
- Node ≥ 22, sem dependências npm (só `node:fs`, `node:zlib`, `node:crypto`, `node:child_process`, `node:events`);
- SignalK server 2.33.0 (local em `software/dev`);
- `node:test` com relógios falsos;
- ecrã em módulos ES sem compilação;
- OpenSSH e `tar` do Windows para a sincronização.

## Global Constraints

- Desenho: `docs/superpowers/specs/2026-09-29-melhor-rota-ia-design.md`, Parte 1. As decisões do Ivo de 29/09 são fixas.
- **Grava desde o 1.º dia, nunca apaga sozinho.**
  - Aos 80% do disco: aviso, e apaga do `bruto/` só o que está **confirmado no portátil**, o mais antigo primeiro, e só se o sha256 ainda bater certo.
  - Aos 95% sem nada para apagar: pára o bruto (a tabela continua), com alarme no ecrã e no Telegram. Retoma abaixo dos 90%.
  - `tabela/`, `previsoes/`, `saidas/` e `modelos/` nunca se apagam.
- **Dados do `arlequin-simulador`** (`$source` = `arlequin-simulador`) são marcados `simulado=1` e **nunca** `estavel=1`.
- **"Estável":**
  - janela de 2 min (pelo menos 110 s de amostras);
  - proa a variar menos de 10°;
  - STW acima de 1 nó;
  - a mais de 0,5 MN de qualquer porto;
  - proa, STW e TWS com valores frescos (menos de 15 s).
- **Velas:**
  - `sails.grande.rizos` ∈ {0, 1, 2, −1 (arriada)};
  - `sails.genoa.percentagem` ∈ {100, 70, 50, 0 (enrolada)};
  - lembrete `notifications.arlequin.caixanegra.velas` (`warn`, só visual) quando o vento real médio muda mais de 40% e passou 1 h desde a última mudança ou lembrete;
  - este lembrete **nunca vai para o Telegram**.
- **Nomes de ficheiros sem `:`**, porque o Windows não os aceita. Todos em UTC:
  - `bruto/AAAA-MM-DDTHH.ndjson.gz`;
  - `tabela/AAAA-MM-DD.csv.gz`;
  - `saidas/AAAA-MM-DDTHH-MM.json`.
- **Plugins em CommonJS** com `'use strict'`. Ecrã e ferramentas em módulos ES (`.mjs`/`import`).
- **Textos para o Ivo em português de Portugal.** Os comentários seguem o estilo dos plugins que já existem.
- **Testes com relógios falsos:** avançar **1 s de cada vez** (`t.mock.timers.tick(1000)` em ciclo). Um salto grande põe o `Date` no fim antes de os intervalos correrem.
- **O Claude não trata credenciais.** A conta Tailscale e os logins são do Ivo.

## Estrutura de ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| `software/signalk-arlequin-caixanegra/package.json` | pacote do plugin |
| `…/lib/geo.js` | distância em MN, porto mais perto, lista de portos |
| `…/lib/estado.js` | últimos valores do próprio barco e marca de simulado |
| `…/lib/bruto.js` | gravador NDJSON gzip por hora (memória → bloco a cada despejo) |
| `…/lib/estavel.js` | janela de 2 min, rajada, critério "estável" |
| `…/lib/tabela.js` | colunas, linha CSV em unidades legíveis, ficheiro diário |
| `…/lib/saidas.js` | deteção de saídas e resumo |
| `…/lib/confirmados.js` | sha256, caixa de entrada do portátil, apagar só o confirmado |
| `…/lib/disco.js` | uso do disco e plano 80/95% |
| `…/lib/velas.js` | estado das velas e lembrete |
| `…/index.js` | plugin: liga tudo, intervalos, REST |
| `…/test/*.test.js` | testes de cada módulo e do plugin |
| `software/signalk-arlequin-porto/lib/mensagens.js` | (alterar) nunca encaminhar o lembrete das velas |
| `software/arlequin-ecra/public/paginas/velas.js` | (alterar) botões do estado das velas |
| `software/arlequin-ecra/public/lib/alarmes.js` | (alterar) lembrete das velas abre a página Velas |
| `software/arlequin-ecra/public/index.html` | (alterar) botão "Rec. velas" → "Velas" |
| `software/ferramentas/sincronizar/{package.json,lib.mjs,transportes.mjs,sincronizar.mjs}` | cópia para o portátil e confirmação |
| `software/dev/…` | (alterar) testes de tudo, config do plugin, dados locais ignorados pelo git |
| `NAVEGACAO.md`, desenho | (alterar) passos do Tailscale e notas de implementação |

---

### Task 1: Pacote, geografia e estado do barco

**Files:**
- Create: `software/signalk-arlequin-caixanegra/package.json`
- Create: `software/signalk-arlequin-caixanegra/lib/geo.js`
- Create: `software/signalk-arlequin-caixanegra/lib/estado.js`
- Test: `software/signalk-arlequin-caixanegra/test/geo-estado.test.js`

**Interfaces:**
- Produces:
  - `geo.PORTOS: {nome, lat, lon}[]`;
  - `geo.distanciaMn(a, b) → number`, onde `a` e `b` são `{latitude, longitude}` ou `{lat, lon}`;
  - `geo.portoMaisPerto(pos, portos) → {nome, mn} | null`;
  - `estado.novoEstado() → {valores, ultimoSimulado}`;
  - `estado.aplicar(estado, delta, selfContext, agora) → estado` (altera o próprio objeto);
  - `estado.valor(estado, caminho, agora, maxIdadeMs = 15000) → any | undefined`;
  - `estado.simuladoRecente(estado, agora, janelaMs = 15000) → boolean`;
  - `estado.SIMULADOR = 'arlequin-simulador'`.

- [ ] **Step 1: Criar o `package.json`**

```json
{
  "name": "signalk-arlequin-caixanegra",
  "version": "0.1.0",
  "description": "Caixa negra do Arlequin: grava todos os dados desde o primeiro dia (bruto, tabela de 10 s para a AI, saídas) e o estado das velas",
  "main": "index.js",
  "keywords": ["signalk-node-server-plugin", "signalk-category-utility"],
  "license": "MIT",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test \"test/*.test.js\"" }
}
```

- [ ] **Step 2: Escrever o teste que falha**

`software/signalk-arlequin-caixanegra/test/geo-estado.test.js`:

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const geo = require('../lib/geo')
const est = require('../lib/estado')

const EU = 'vessels.urn:mrn:signalk:uuid:arlequin'

test('distância: 1 minuto de latitude ≈ 1 MN; Algés → Peniche ≈ 40 MN', () => {
  const d1 = geo.distanciaMn({ latitude: 39, longitude: -9.4 }, { latitude: 39 + 1 / 60, longitude: -9.4 })
  assert.ok(d1 > 0.999 && d1 < 1.002, `deu ${d1}`)
  const alges = geo.PORTOS.find(p => p.nome.startsWith('Algés'))
  const peniche = geo.PORTOS.find(p => p.nome === 'Peniche')
  const d = geo.distanciaMn(alges, peniche)
  assert.ok(d > 39 && d < 41, `deu ${d}`)
})

test('porto mais perto; sem posição dá null', () => {
  const p = geo.portoMaisPerto({ latitude: 39.35, longitude: -9.38 }, geo.PORTOS)
  assert.equal(p.nome, 'Peniche')
  assert.ok(p.mn < 0.5)
  assert.equal(geo.portoMaisPerto(undefined, geo.PORTOS), null)
  assert.equal(geo.portoMaisPerto({ latitude: NaN, longitude: 1 }, geo.PORTOS), null)
})

test('estado: guarda só o próprio barco, ignora notificações, envelhece aos 15 s', () => {
  const e = est.novoEstado()
  est.aplicar(e, { context: EU, updates: [{ $source: 'nmea0183.GP', values: [{ path: 'navigation.speedOverGround', value: 2.5 }, { path: 'notifications.x', value: { state: 'alarm' } }] }] }, EU, 1000)
  est.aplicar(e, { context: 'vessels.urn:mrn:imo:mmsi:263000001', updates: [{ $source: 'ais', values: [{ path: 'navigation.speedOverGround', value: 9 }] }] }, EU, 1000)
  est.aplicar(e, { updates: [{ $source: 'derived', values: [{ path: 'environment.wind.speedTrue', value: 6 }] }] }, EU, 1000)
  assert.equal(est.valor(e, 'navigation.speedOverGround', 1000), 2.5)
  assert.equal(est.valor(e, 'environment.wind.speedTrue', 1000), 6)
  assert.equal(est.valor(e, 'notifications.x', 1000), undefined)
  assert.equal(est.valor(e, 'navigation.speedOverGround', 16001), undefined)
  assert.equal(est.simuladoRecente(e, 1000), false)
})

test('estado: mensagens do simulador ficam marcadas durante 15 s', () => {
  const e = est.novoEstado()
  est.aplicar(e, { context: EU, updates: [{ $source: est.SIMULADOR, values: [{ path: 'navigation.headingTrue', value: 1 }] }] }, EU, 5000)
  assert.equal(est.simuladoRecente(e, 5000), true)
  assert.equal(est.simuladoRecente(e, 20000), true)
  assert.equal(est.simuladoRecente(e, 20001), false)
})
```

- [ ] **Step 3: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: FAIL com `Cannot find module '../lib/geo'`

- [ ] **Step 4: Implementar `lib/geo.js`**

```js
'use strict'
// Distâncias em milhas e o porto mais perto (lista configurável no plugin).

const GRAU = Math.PI / 180

const PORTOS = [
  { nome: 'Peniche', lat: 39.3530, lon: -9.3770 },
  { nome: 'Algés (CNA)', lat: 38.6955, lon: -9.2330 },
  { nome: 'Oeiras', lat: 38.6780, lon: -9.3160 },
  { nome: 'Cascais', lat: 38.6925, lon: -9.4175 },
  { nome: 'Ericeira', lat: 38.9630, lon: -9.4180 },
  { nome: 'Nazaré', lat: 39.5845, lon: -9.0735 },
  { nome: 'Sesimbra', lat: 38.4410, lon: -9.1060 }
]

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

module.exports = { PORTOS, distanciaMn, portoMaisPerto }
```

- [ ] **Step 5: Implementar `lib/estado.js`**

```js
'use strict'
// Últimos valores do próprio barco, a partir das mensagens do SignalK, com a
// hora a que chegaram. Marca quando chegam dados do simulador: essas linhas
// ficam "simulado" e nunca ensinam a AI.

const SIMULADOR = 'arlequin-simulador'

function novoEstado () { return { valores: {}, ultimoSimulado: -Infinity } }

function doProprio (delta, selfContext) {
  return !delta.context || delta.context === 'vessels.self' || delta.context === selfContext
}

function aplicar (estado, delta, selfContext, agora) {
  if (!doProprio(delta, selfContext)) return estado
  for (const u of delta.updates || []) {
    const fonte = u.$source || ''
    if (fonte === SIMULADOR || fonte.startsWith(SIMULADOR + '.')) estado.ultimoSimulado = agora
    for (const { path, value } of u.values || []) {
      if (!path || path.startsWith('notifications.')) continue
      estado.valores[path] = { value, t: agora }
    }
  }
  return estado
}

function valor (estado, caminho, agora, maxIdadeMs = 15000) {
  const v = estado.valores[caminho]
  if (!v || agora - v.t > maxIdadeMs) return undefined
  return v.value
}

function simuladoRecente (estado, agora, janelaMs = 15000) {
  return agora - estado.ultimoSimulado <= janelaMs
}

module.exports = { novoEstado, aplicar, valor, simuladoRecente, SIMULADOR }
```

- [ ] **Step 6: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (4 testes)

- [ ] **Step 7: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: pacote, distâncias e porto mais perto, estado do barco com marca de simulado"
```

---

### Task 2: Gravador do bruto (NDJSON gzip por hora)

**Files:**
- Create: `software/signalk-arlequin-caixanegra/lib/bruto.js`
- Test: `software/signalk-arlequin-caixanegra/test/bruto.test.js`

**Interfaces:**
- Produces:
  - `criarGravadorBruto(dir) → { escrever(delta, agora), despejar() → bytes, parar(), retomar(), parado: boolean, pendentes: number }`;
  - `nomeHora(t) → 'AAAA-MM-DDTHH.ndjson.gz'` (UTC).

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { criarGravadorBruto, nomeHora } = require('../lib/bruto')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-bruto-'))
const linhas = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

test('nome por hora em UTC, sem ":"', () => {
  assert.equal(nomeHora(Date.UTC(2026, 8, 29, 14, 59, 59)), '2026-09-29T14.ndjson.gz')
})

test('uma linha por mensagem, ficheiro novo a cada hora', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  g.escrever({ n: 1 }, Date.UTC(2026, 8, 29, 10, 59, 59))
  g.escrever({ n: 2 }, Date.UTC(2026, 8, 29, 11, 0, 1))
  g.escrever({ n: 3 }, Date.UTC(2026, 8, 29, 11, 0, 2))
  assert.equal(g.pendentes, 3)
  assert.ok(g.despejar() > 0)
  assert.equal(g.pendentes, 0)
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T10.ndjson.gz')), [{ n: 1 }])
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T11.ndjson.gz')), [{ n: 2 }, { n: 3 }])
})

test('vários despejos na mesma hora: o .gz com vários blocos lê-se inteiro', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  const t = Date.UTC(2026, 8, 29, 12, 0, 0)
  g.escrever({ a: 1 }, t); g.despejar()
  g.escrever({ a: 2 }, t + 10000); g.despejar()
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T12.ndjson.gz')), [{ a: 1 }, { a: 2 }])
  assert.equal(g.despejar(), 0) // nada pendente, nada escrito
})

test('parado não grava; retomar volta a gravar', () => {
  const dir = tmp()
  const g = criarGravadorBruto(dir)
  const t = Date.UTC(2026, 8, 29, 12, 0, 0)
  g.parar()
  assert.equal(g.parado, true)
  g.escrever({ x: 1 }, t)
  assert.equal(g.pendentes, 0)
  g.retomar()
  g.escrever({ x: 2 }, t); g.despejar()
  assert.deepEqual(linhas(path.join(dir, '2026-09-29T12.ndjson.gz')), [{ x: 2 }])
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/bruto.test.js`
Expected: FAIL com `Cannot find module '../lib/bruto'`

- [ ] **Step 3: Implementar `lib/bruto.js`**

```js
'use strict'
// Caixa negra em bruto: todas as mensagens do SignalK, uma por linha (NDJSON),
// num ficheiro comprimido por hora (UTC). As linhas juntam-se em memória e cada
// despejo acrescenta um bloco gzip ao ficheiro: um .gz com vários blocos lê-se
// inteiro (zcat/gunzip) e, se o Pi se desligar, perde-se só o último intervalo.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const nomeHora = (t) => new Date(t).toISOString().slice(0, 13) + '.ndjson.gz'

function criarGravadorBruto (dir) {
  fs.mkdirSync(dir, { recursive: true })
  let linhas = [] // { nome, texto }
  let parado = false
  return {
    escrever (delta, agora) {
      if (parado) return
      linhas.push({ nome: nomeHora(agora), texto: JSON.stringify(delta) })
    },
    despejar () {
      const porFicheiro = new Map()
      for (const l of linhas) {
        if (!porFicheiro.has(l.nome)) porFicheiro.set(l.nome, [])
        porFicheiro.get(l.nome).push(l.texto)
      }
      linhas = []
      let bytes = 0
      for (const [nome, textos] of porFicheiro) {
        const gz = zlib.gzipSync(textos.join('\n') + '\n')
        fs.appendFileSync(path.join(dir, nome), gz)
        bytes += gz.length
      }
      return bytes
    },
    parar () { parado = true; linhas = [] },
    retomar () { parado = false },
    get parado () { return parado },
    get pendentes () { return linhas.length }
  }
}

module.exports = { criarGravadorBruto, nomeHora }
```

- [ ] **Step 4: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (8 testes no total)

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: gravador do bruto (NDJSON gzip por hora, blocos acrescentados, parar/retomar)"
```

---

### Task 3: Janela estável, rajada e tabela de 10 s

**Files:**
- Create: `software/signalk-arlequin-caixanegra/lib/estavel.js`
- Create: `software/signalk-arlequin-caixanegra/lib/tabela.js`
- Test: `software/signalk-arlequin-caixanegra/test/tabela.test.js`

**Interfaces:**
- Produces:
  - `estavel.novaJanela() → []`;
  - `estavel.juntar(janela, {t, proa, stw, tws}) → janela` (rad, m/s; guarda 120 s);
  - `estavel.rajada(janela) → m/s | undefined`;
  - `estavel.estavel(janela, {longeDoPorto}) → boolean`;
  - `tabela.COLUNAS: string[]`;
  - `tabela.linha({v, agora, rajadaMs, simulado, estavel}) → string CSV`, onde `v(caminho)` dá o valor SI;
  - `tabela.escrever(dir, agora, texto) → caminho do ficheiro`;
  - `tabela.nomeDia(t) → 'AAAA-MM-DD.csv.gz'`.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const est = require('../lib/estavel')
const tabela = require('../lib/tabela')

const NO = 1852 / 3600
const GRAU = Math.PI / 180

function janelaDe (segundos, proaGraus) {
  const j = est.novaJanela()
  for (let s = 0; s <= segundos; s++) est.juntar(j, { t: s * 1000, proa: proaGraus(s) * GRAU, stw: 5 * NO, tws: (12 + (s === 30 ? 6 : 0)) * NO })
  return j
}

test('estável: 2 min com a proa firme, longe do porto', () => {
  const j = janelaDe(125, () => 90 + Math.sin(0.3) * 3)
  assert.equal(est.estavel(j, { longeDoPorto: true }), true)
  assert.equal(est.estavel(j, { longeDoPorto: false }), false)
})

test('a janela só guarda 120 s e a rajada é o máximo nela', () => {
  const j = janelaDe(125, () => 90)
  assert.ok(j[j.length - 1].t - j[0].t <= 120000)
  const j2 = janelaDe(100, () => 90)
  assert.ok(Math.abs(est.rajada(j2) / NO - 18) < 1e-9)
})

test('não é estável: proa a variar 20°, janela curta, parado, ou sensor em falta', () => {
  assert.equal(est.estavel(janelaDe(125, (s) => 80 + (s % 40 < 20 ? 0 : 20)), { longeDoPorto: true }), false)
  assert.equal(est.estavel(janelaDe(90, () => 90), { longeDoPorto: true }), false)
  const parado = est.novaJanela()
  for (let s = 0; s <= 125; s++) est.juntar(parado, { t: s * 1000, proa: 1, stw: 0.3, tws: 5 })
  assert.equal(est.estavel(parado, { longeDoPorto: true }), false)
  const semVento = est.novaJanela()
  for (let s = 0; s <= 125; s++) est.juntar(semVento, { t: s * 1000, proa: 1, stw: 3, tws: undefined })
  assert.equal(est.estavel(semVento, { longeDoPorto: true }), false)
})

test('estável a passar pelo Norte (355° → 5°)', () => {
  const j = janelaDe(125, (s) => (355 + (s % 10)) % 360) // 355°…359°, 0°…4°
  assert.equal(est.estavel(j, { longeDoPorto: true }), true)
})

test('linha da tabela em unidades de gente; vazio quando falta', () => {
  const valores = {
    'navigation.position': { latitude: 39.123456, longitude: -9.5 },
    'navigation.headingTrue': 350 * GRAU,
    'navigation.speedOverGround': 5 * NO,
    'navigation.speedThroughWater': 4.5 * NO,
    'environment.wind.speedTrue': 15 * NO,
    'environment.wind.angleTrueWater': -60 * GRAU,
    'environment.wind.directionTrue': 290 * GRAU,
    'navigation.attitude': { roll: -12 * GRAU, pitch: 2 * GRAU },
    'environment.outside.pressure': 101250,
    'propulsion.main.revolutions': 0,
    'sails.grande.rizos': 1,
    'sails.genoa.percentagem': 70,
    'electrical.batteries.servico.capacity.stateOfCharge': 0.92
  }
  const texto = tabela.linha({ v: (c) => valores[c], agora: Date.UTC(2026, 8, 29, 14, 0, 0), rajadaMs: 20 * NO, simulado: false, estavel: true })
  const campos = Object.fromEntries(tabela.COLUNAS.map((c, i) => [c, texto.split(',')[i]]))
  assert.equal(campos.t, '2026-09-29T14:00:00.000Z')
  assert.equal(campos.lat, '39.12346')
  assert.equal(campos.proa, '350.0')
  assert.equal(campos.sog, '5.00')
  assert.equal(campos.twa, '-60.0')
  assert.equal(campos.twd, '290.0')
  assert.equal(campos.rajada, '20.00')
  assert.equal(campos.adorno, '-12.0')
  assert.equal(campos.pressao, '1012.5')
  assert.equal(campos.rpm, '0')
  assert.equal(campos.grandeRizos, '1')
  assert.equal(campos.genoaPct, '70')
  assert.equal(campos.soc, '92')
  assert.equal(campos.cog, '')
  assert.equal(campos.litrosHora, '')
  assert.equal(campos.simulado, '0')
  assert.equal(campos.estavel, '1')
  assert.equal(texto.split(',').length, tabela.COLUNAS.length)
})

test('ficheiro por dia: cabeçalho só no início, dia novo → ficheiro novo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-tabela-'))
  const d1 = Date.UTC(2026, 8, 29, 23, 59, 50)
  tabela.escrever(dir, d1, 'a')
  tabela.escrever(dir, d1 + 5000, 'b')
  tabela.escrever(dir, d1 + 15000, 'c')
  const ler = (n) => zlib.gunzipSync(fs.readFileSync(path.join(dir, n))).toString('utf8').trim().split('\n')
  assert.deepEqual(ler('2026-09-29.csv.gz'), [tabela.COLUNAS.join(','), 'a', 'b'])
  assert.deepEqual(ler('2026-09-30.csv.gz'), [tabela.COLUNAS.join(','), 'c'])
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/tabela.test.js`
Expected: FAIL com `Cannot find module '../lib/estavel'`

- [ ] **Step 3: Implementar `lib/estavel.js`**

```js
'use strict'
// "Navegação estável" (só estas linhas ensinam a AI): 2 min seguidos com a proa
// a variar menos de 10°, velocidade na água acima de 1 nó, longe dos portos e
// com proa, velocidade e vento a dar valores. A mesma janela dá a rajada.

const JANELA_MS = 120000
const NO = 1852 / 3600
const GRAU = Math.PI / 180

function novaJanela () { return [] }

// amostra: { t (ms), proa (rad), stw (m/s), tws (m/s) }
function juntar (janela, amostra) {
  janela.push(amostra)
  while (janela.length && amostra.t - janela[0].t > JANELA_MS) janela.shift()
  return janela
}

function rajada (janela) {
  let m
  for (const a of janela) if (Number.isFinite(a.tws)) m = m === undefined ? a.tws : Math.max(m, a.tws)
  return m
}

function estavel (janela, { longeDoPorto }) {
  if (!longeDoPorto || janela.length < 2) return false
  if (janela[janela.length - 1].t - janela[0].t < JANELA_MS - 10000) return false
  const ref = janela[0].proa
  let lo = 0
  let hi = 0
  for (const a of janela) {
    if (!Number.isFinite(a.proa) || !Number.isFinite(a.stw) || !Number.isFinite(a.tws)) return false
    if (a.stw <= 1 * NO) return false
    let d = ((a.proa - ref) / GRAU) % 360
    if (d > 180) d -= 360
    if (d < -180) d += 360
    lo = Math.min(lo, d)
    hi = Math.max(hi, d)
  }
  return hi - lo < 10
}

module.exports = { novaJanela, juntar, rajada, estavel, JANELA_MS }
```

- [ ] **Step 4: Implementar `lib/tabela.js`**

```js
'use strict'
// Tabela de treino da AI: uma linha a cada 10 s, em unidades de gente (nós,
// graus, hPa, rpm, L/h), num CSV comprimido por dia (UTC). A previsão do tempo
// não entra aqui: junta-se no treino, a partir de previsoes/, pela hora e posição.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const NO = 1852 / 3600
const GRAU = 180 / Math.PI

const COLUNAS = ['t', 'lat', 'lon', 'proa', 'cog', 'sog', 'stw', 'tws', 'twa', 'twd', 'aws', 'awa', 'rajada',
  'adorno', 'caimento', 'pressao', 'rpm', 'litrosHora', 'grandeRizos', 'genoaPct', 'profundidade', 'soc',
  'simulado', 'estavel']

const num = (x, casas) => Number.isFinite(x) ? x.toFixed(casas) : ''
const rumo360 = (rad) => Number.isFinite(rad) ? ((rad * GRAU) % 360 + 360) % 360 : NaN
const angulo180 = (rad) => { const d = rumo360(rad); return d > 180 ? d - 360 : d }

function linha ({ v, agora, rajadaMs, simulado, estavel }) {
  const pos = v('navigation.position') || {}
  const att = v('navigation.attitude') || {}
  const campos = {
    t: new Date(agora).toISOString(),
    lat: num(pos.latitude, 5),
    lon: num(pos.longitude, 5),
    proa: num(rumo360(v('navigation.headingTrue')), 1),
    cog: num(rumo360(v('navigation.courseOverGroundTrue')), 1),
    sog: num(v('navigation.speedOverGround') / NO, 2),
    stw: num(v('navigation.speedThroughWater') / NO, 2),
    tws: num(v('environment.wind.speedTrue') / NO, 2),
    twa: num(angulo180(v('environment.wind.angleTrueWater')), 1),
    twd: num(rumo360(v('environment.wind.directionTrue')), 1),
    aws: num(v('environment.wind.speedApparent') / NO, 2),
    awa: num(angulo180(v('environment.wind.angleApparent')), 1),
    rajada: num(rajadaMs / NO, 2),
    adorno: num(att.roll * GRAU, 1),
    caimento: num(att.pitch * GRAU, 1),
    pressao: num(v('environment.outside.pressure') / 100, 1),
    rpm: num(v('propulsion.main.revolutions') * 60, 0),
    litrosHora: num(v('propulsion.main.fuel.rate') * 3.6e6, 2),
    grandeRizos: num(v('sails.grande.rizos'), 0),
    genoaPct: num(v('sails.genoa.percentagem'), 0),
    profundidade: num(v('environment.depth.belowTransducer'), 1),
    soc: num(v('electrical.batteries.servico.capacity.stateOfCharge') * 100, 0),
    simulado: simulado ? '1' : '0',
    estavel: estavel ? '1' : '0'
  }
  return COLUNAS.map(c => campos[c]).join(',')
}

const nomeDia = (t) => new Date(t).toISOString().slice(0, 10) + '.csv.gz'

function escrever (dir, agora, texto) {
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, nomeDia(agora))
  const novo = !fs.existsSync(f)
  fs.appendFileSync(f, zlib.gzipSync((novo ? COLUNAS.join(',') + '\n' : '') + texto + '\n'))
  return f
}

module.exports = { COLUNAS, linha, escrever, nomeDia }
```

- [ ] **Step 5: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (14 testes no total)

- [ ] **Step 6: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: janela estável de 2 min, rajada e tabela de 10 s em CSV diário"
```

---

### Task 4: Deteção de saídas e resumo

**Files:**
- Create: `software/signalk-arlequin-caixanegra/lib/saidas.js`
- Test: `software/signalk-arlequin-caixanegra/test/saidas.test.js`

**Interfaces:**
- Consumes: `geo.distanciaMn`, `geo.portoMaisPerto`, `geo.PORTOS` (Task 1).
- Produces:
  - `novaSaidas() → {emCurso: null, paradoDesde: null, ultimoPorto: null}`;
  - `atualizar(s, amostra, portos, {raioMn = 0.5, paragemMs = 600000}) → {s, terminada}`;
  - `amostra = {t, pos: {latitude, longitude}, sog (m/s), motor: boolean, litrosHora, soc (0–1), simulado}`;
  - `terminada = {inicio, fim (ISO), de, para, milhas, horasVela, horasMotor, gasoleoL, socInicio, socFim, simulado} | null`.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { novaSaidas, atualizar } = require('../lib/saidas')
const { PORTOS, distanciaMn } = require('../lib/geo')

const NO = 1852 / 3600
const ALGES = PORTOS.find(p => p.nome.startsWith('Algés'))
const CASCAIS = PORTOS.find(p => p.nome === 'Cascais')
const ponto = (f) => ({ latitude: ALGES.lat + (CASCAIS.lat - ALGES.lat) * f, longitude: ALGES.lon + (CASCAIS.lon - ALGES.lon) * f })

test('Algés → Cascais: 30 min a motor, 1 h à vela, pára 10 min → resumo', () => {
  let s = novaSaidas()
  let t = Date.UTC(2026, 8, 29, 13, 0, 0)
  let terminada = null
  const passo = (a) => { const r = atualizar(s, { t, ...a }, PORTOS); s = r.s; if (r.terminada) terminada = r.terminada; t += 10000 }
  for (let i = 0; i < 30; i++) passo({ pos: ponto(0), sog: 0, motor: false, soc: 0.95 }) // 5 min no porto
  assert.equal(s.emCurso, null)
  const total = 540 // 90 min em passos de 10 s
  const mn = distanciaMn(ALGES, CASCAIS)
  const sog = mn / 1.5 * NO
  for (let i = 1; i <= total; i++) passo({ pos: ponto(i / total), sog, motor: i <= 180, litrosHora: i <= 180 ? 1.3 : undefined, soc: 0.9 })
  assert.ok(s.emCurso, 'a saída começou')
  for (let i = 0; i < 62; i++) passo({ pos: ponto(1), sog: 0, motor: false, soc: 0.9 }) // 10 min e pouco parado
  assert.ok(terminada, 'a saída terminou')
  assert.equal(terminada.de, 'Algés (CNA)')
  assert.equal(terminada.para, 'Cascais')
  assert.ok(terminada.milhas > mn - 0.7 && terminada.milhas < mn - 0.3, `milhas ${terminada.milhas} (reta ${mn})`)
  assert.ok(terminada.horasMotor > 0.38 && terminada.horasMotor < 0.45, `motor ${terminada.horasMotor}`)
  assert.ok(terminada.horasVela > 0.95 && terminada.horasVela < 1.02, `vela ${terminada.horasVela}`)
  assert.ok(Math.abs(terminada.gasoleoL - 1.3 * terminada.horasMotor) < 0.03)
  assert.equal(terminada.socFim, 0.9)
  assert.equal(terminada.simulado, false)
  assert.equal(s.emCurso, null)
  assert.equal(s.ultimoPorto, 'Cascais')
})

test('buracos de mais de 6 min não somam; simulado marca a saída toda', () => {
  let s = novaSaidas()
  const longe = { latitude: 39.0, longitude: -9.6 }
  s = atualizar(s, { t: 0, pos: longe, sog: 3, motor: true, simulado: true }, PORTOS).s
  s = atualizar(s, { t: 3600000, pos: longe, sog: 3, motor: true }, PORTOS).s
  assert.equal(s.emCurso.horasMotor, 0)
  assert.equal(s.emCurso.simulado, true)
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/saidas.test.js`
Expected: FAIL com `Cannot find module '../lib/saidas'`

- [ ] **Step 3: Implementar `lib/saidas.js`**

```js
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
```

- [ ] **Step 4: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (16 testes no total)

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: deteção de saídas (0,5 MN dos portos) e resumo com milhas, vela, motor e gasóleo"
```

---

### Task 5: Confirmações do portátil e disco 80/95%

**Files:**
- Create: `software/signalk-arlequin-caixanegra/lib/confirmados.js`
- Create: `software/signalk-arlequin-caixanegra/lib/disco.js`
- Test: `software/signalk-arlequin-caixanegra/test/disco.test.js`

**Interfaces:**
- Produces:
  - `confirmados.sha256Ficheiro(f) → hex`;
  - `confirmados.lerConfirmados(base) → {'bruto/…': sha256}`;
  - `confirmados.processarEntrada(base) → {aceites: string[], rejeitados: {ficheiro, motivo}[]}`. Lê `base/entrada/*.json` (listas `[{ficheiro, sha256}]`), confere cada hash e apaga a lista;
  - `confirmados.apagarConfirmados(base, ficheiros) → string[]` (os que apagou; só se o hash ainda bater certo);
  - `disco.usoDisco(dir) → {total, livre, usadoPct}`;
  - `disco.planear({usadoPct, total, ficheiros: {ficheiro, bytes}[], confirmados, limiteAviso = 80, limiteParar = 95}) → {aviso, apagar: string[], pararBruto}`.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const conf = require('../lib/confirmados')
const disco = require('../lib/disco')

function base () {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-disco-'))
  for (const d of ['bruto', 'entrada']) fs.mkdirSync(path.join(b, d))
  fs.writeFileSync(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'), 'dez')
  fs.writeFileSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'), 'onze')
  return b
}
const entrada = (b, nome, lista) => fs.writeFileSync(path.join(b, 'entrada', nome), JSON.stringify(lista))

test('entrada: hash certo fica confirmado; errado, inexistente ou fora do bruto não', () => {
  const b = base()
  const h10 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'))
  entrada(b, 'confirmados-1.json', [
    { ficheiro: 'bruto/2026-09-28T10.ndjson.gz', sha256: h10 },
    { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', sha256: 'f'.repeat(64) },
    { ficheiro: 'bruto/nao-existe.ndjson.gz', sha256: h10 },
    { ficheiro: '../velas.json', sha256: h10 },
    { ficheiro: 'tabela/2026-09-28.csv.gz', sha256: h10 }
  ])
  fs.writeFileSync(path.join(b, 'entrada', 'meio-escrito.json.tmp'), '[')
  const r = conf.processarEntrada(b)
  assert.deepEqual(r.aceites, ['bruto/2026-09-28T10.ndjson.gz'])
  assert.deepEqual(r.rejeitados.map(x => x.motivo), ['hash diferente', 'não existe', 'fora do bruto', 'fora do bruto'])
  assert.deepEqual(conf.lerConfirmados(b), { 'bruto/2026-09-28T10.ndjson.gz': h10 })
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'confirmados-1.json')), false)
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'meio-escrito.json.tmp')), true, 'os .tmp ficam para o fim da cópia')
})

test('lista ilegível: fica de lado (.mau) e não rebenta', () => {
  const b = base()
  fs.writeFileSync(path.join(b, 'entrada', 'x.json'), '{isto não é json')
  const r = conf.processarEntrada(b)
  assert.equal(r.rejeitados[0].motivo, 'lista ilegível')
  assert.equal(fs.existsSync(path.join(b, 'entrada', 'x.json.mau')), true)
})

test('apagar só o confirmado e só se o hash ainda bater certo', () => {
  const b = base()
  const h10 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T10.ndjson.gz'))
  const h11 = conf.sha256Ficheiro(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'))
  entrada(b, 'c.json', [{ ficheiro: 'bruto/2026-09-28T10.ndjson.gz', sha256: h10 }, { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', sha256: h11 }])
  conf.processarEntrada(b)
  fs.appendFileSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz'), 'mais') // mudou depois de confirmado
  const apagados = conf.apagarConfirmados(b, ['bruto/2026-09-28T10.ndjson.gz', 'bruto/2026-09-28T11.ndjson.gz', 'bruto/outro.gz'])
  assert.deepEqual(apagados, ['bruto/2026-09-28T10.ndjson.gz'])
  assert.equal(fs.existsSync(path.join(b, 'bruto', '2026-09-28T11.ndjson.gz')), true)
  assert.deepEqual(Object.keys(conf.lerConfirmados(b)), ['bruto/2026-09-28T11.ndjson.gz'])
})

test('plano do disco: abaixo de 80% nada; acima apaga o confirmado mais antigo até baixar', () => {
  const ficheiros = [
    { ficheiro: 'bruto/2026-09-28T12.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T10.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T11.ndjson.gz', bytes: 30 },
    { ficheiro: 'bruto/2026-09-28T13.ndjson.gz', bytes: 30 }
  ]
  const confirmadosTodos = Object.fromEntries(ficheiros.map(f => [f.ficheiro, 'h']))
  assert.deepEqual(disco.planear({ usadoPct: 79, total: 1000, ficheiros, confirmados: confirmadosTodos }), { aviso: false, apagar: [], pararBruto: false })
  const p = disco.planear({ usadoPct: 85, total: 1000, ficheiros, confirmados: confirmadosTodos })
  assert.equal(p.aviso, true)
  assert.deepEqual(p.apagar, ['bruto/2026-09-28T10.ndjson.gz', 'bruto/2026-09-28T11.ndjson.gz'])
  assert.equal(p.pararBruto, false)
  const soUm = disco.planear({ usadoPct: 85, total: 1000, ficheiros, confirmados: { 'bruto/2026-09-28T13.ndjson.gz': 'h' } })
  assert.deepEqual(soUm.apagar, ['bruto/2026-09-28T13.ndjson.gz'], 'nunca o que não está confirmado')
})

test('plano do disco: 96% sem nada confirmado → parar o bruto; com o suficiente não', () => {
  const ficheiros = [{ ficheiro: 'bruto/a.gz', bytes: 20 }, { ficheiro: 'bruto/b.gz', bytes: 20 }]
  assert.equal(disco.planear({ usadoPct: 96, total: 1000, ficheiros, confirmados: {} }).pararBruto, true)
  assert.equal(disco.planear({ usadoPct: 96, total: 1000, ficheiros, confirmados: { 'bruto/a.gz': 'h', 'bruto/b.gz': 'h' } }).pararBruto, false)
})

test('usoDisco dá números com sentido', () => {
  const u = disco.usoDisco(os.tmpdir())
  assert.ok(u.total > 0 && u.livre >= 0 && u.usadoPct >= 0 && u.usadoPct <= 100)
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/disco.test.js`
Expected: FAIL com `Cannot find module '../lib/confirmados'`

- [ ] **Step 3: Implementar `lib/confirmados.js`**

```js
'use strict'
// Ficheiros do bruto já copiados e verificados no portátil. O portátil deixa
// listas [{ ficheiro, sha256 }] em entrada/*.json (escreve .tmp e muda o nome
// no fim, para nunca se ler uma lista a meio). Aqui confere-se o hash de cada
// ficheiro no SSD: só os que batem certo ficam em confirmados.json, e só esses
// podem ser apagados quando o disco enche, e só se o hash ainda bater certo.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const sha256Ficheiro = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const ficheiroConf = (base) => path.join(base, 'confirmados.json')

function lerConfirmados (base) {
  try { return JSON.parse(fs.readFileSync(ficheiroConf(base), 'utf8')) } catch { return {} }
}
function gravarConfirmados (base, conf) {
  const tmp = ficheiroConf(base) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(conf, null, 1))
  fs.renameSync(tmp, ficheiroConf(base))
}

function processarEntrada (base) {
  const dir = path.join(base, 'entrada')
  const conf = lerConfirmados(base)
  const r = { aceites: [], rejeitados: [] }
  let nomes = []
  try { nomes = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort() } catch { return r }
  for (const nome of nomes) {
    const f = path.join(dir, nome)
    let lista
    try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(lista)) throw new Error('não é lista') } catch {
      r.rejeitados.push({ ficheiro: nome, motivo: 'lista ilegível' })
      fs.renameSync(f, f + '.mau')
      continue
    }
    for (const { ficheiro, sha256 } of lista) {
      if (typeof ficheiro !== 'string' || !/^bruto\/[\w-][\w.-]*$/.test(ficheiro)) { r.rejeitados.push({ ficheiro: String(ficheiro), motivo: 'fora do bruto' }); continue }
      const alvo = path.join(base, ficheiro)
      if (!fs.existsSync(alvo)) { r.rejeitados.push({ ficheiro, motivo: 'não existe' }); continue }
      if (sha256Ficheiro(alvo) !== sha256) { r.rejeitados.push({ ficheiro, motivo: 'hash diferente' }); continue }
      conf[ficheiro] = sha256
      r.aceites.push(ficheiro)
    }
    fs.unlinkSync(f)
  }
  if (r.aceites.length) gravarConfirmados(base, conf)
  return r
}

function apagarConfirmados (base, ficheiros) {
  const conf = lerConfirmados(base)
  const apagados = []
  for (const ficheiro of ficheiros) {
    const alvo = path.join(base, ficheiro)
    if (!conf[ficheiro] || !fs.existsSync(alvo)) continue
    if (sha256Ficheiro(alvo) !== conf[ficheiro]) continue // mudou depois de confirmado: fica
    fs.unlinkSync(alvo)
    delete conf[ficheiro]
    apagados.push(ficheiro)
  }
  if (apagados.length) gravarConfirmados(base, conf)
  return apagados
}

module.exports = { sha256Ficheiro, lerConfirmados, processarEntrada, apagarConfirmados }
```

- [ ] **Step 4: Implementar `lib/disco.js`**

```js
'use strict'
// Espaço no SSD. Aos 80%: avisa e apaga do bruto só o que o portátil já
// confirmou, o mais antigo primeiro, até ficar abaixo dos 80%. Aos 95% sem
// nada para apagar: pára o bruto (a tabela continua). Nunca o que não está
// confirmado.

const fs = require('node:fs')

function usoDisco (dir) {
  const s = fs.statfsSync(dir)
  const total = s.blocks * s.bsize
  const livre = s.bavail * s.bsize
  return { total, livre, usadoPct: 100 * (1 - livre / total) }
}

function planear ({ usadoPct, total, ficheiros, confirmados, limiteAviso = 80, limiteParar = 95 }) {
  const r = { aviso: usadoPct >= limiteAviso, apagar: [], pararBruto: false }
  if (!r.aviso) return r
  let pct = usadoPct
  for (const f of [...ficheiros].sort((a, b) => a.ficheiro.localeCompare(b.ficheiro))) {
    if (pct < limiteAviso) break
    if (!confirmados[f.ficheiro]) continue
    r.apagar.push(f.ficheiro)
    pct -= 100 * f.bytes / total
  }
  r.pararBruto = pct >= limiteParar
  return r
}

module.exports = { usoDisco, planear }
```

- [ ] **Step 5: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (22 testes no total)

- [ ] **Step 6: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: confirmações do portátil com sha256 e plano do disco (80% arquiva o confirmado, 95% pára o bruto)"
```

---

### Task 6: Estado das velas e lembrete

**Files:**
- Create: `software/signalk-arlequin-caixanegra/lib/velas.js`
- Test: `software/signalk-arlequin-caixanegra/test/velas.test.js`

**Interfaces:**
- Produces:
  - `GRANDE = [0, 1, 2, -1]`, `GENOA = [100, 70, 50, 0]`;
  - `novoEstadoVelas() → {grandeRizos: 0, genoaPct: 100, mudouEm: null, twsNaMudanca: null, lembradoEm: null}`;
  - `mudar(e, {grandeRizos?, genoaPct?}, agora, tws) → e'` (lança `Error` com a mensagem para o Ivo se o valor for inválido);
  - `precisaLembrete(e, agora, tws) → boolean`.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const velas = require('../lib/velas')

const H = 3600000

test('mudar guarda as velas e o vento dessa altura; valores inválidos dão erro claro', () => {
  let e = velas.novoEstadoVelas()
  e = velas.mudar(e, { grandeRizos: 1 }, 1000, 6)
  assert.equal(e.grandeRizos, 1)
  assert.equal(e.genoaPct, 100)
  assert.equal(e.twsNaMudanca, 6)
  e = velas.mudar(e, { genoaPct: 70 }, 2000, 7)
  assert.equal(e.grandeRizos, 1)
  assert.equal(e.genoaPct, 70)
  assert.throws(() => velas.mudar(e, { grandeRizos: 3 }, 0, 6), /0, 1, 2 rizos ou -1/)
  assert.throws(() => velas.mudar(e, { genoaPct: 80 }, 0, 6), /100, 70, 50 ou 0/)
  assert.throws(() => velas.mudar(e, { grandeRizos: NaN }, 0, 6), /rizos/)
})

test('lembrete: vento mudou mais de 40% e passou 1 h; depois só de hora a hora', () => {
  let e = velas.mudar(velas.novoEstadoVelas(), { grandeRizos: 0 }, 0, 5)
  assert.equal(velas.precisaLembrete(e, 0.5 * H, 8), false, 'ainda não passou 1 h')
  assert.equal(velas.precisaLembrete(e, 1.1 * H, 6.5), false, 'só 30% de diferença')
  assert.equal(velas.precisaLembrete(e, 1.1 * H, 8), true)
  e = { ...e, lembradoEm: 1.1 * H }
  assert.equal(velas.precisaLembrete(e, 1.5 * H, 8), false)
  assert.equal(velas.precisaLembrete(e, 2.2 * H, 8), true)
})

test('sem vento conhecido não há lembrete', () => {
  const nunca = velas.novoEstadoVelas()
  assert.equal(velas.precisaLembrete(nunca, 10 * H, 8), false)
  const e = velas.mudar(nunca, { grandeRizos: 1 }, 0, undefined)
  assert.equal(velas.precisaLembrete(e, 10 * H, 8), false)
  const e2 = velas.mudar(nunca, { grandeRizos: 1 }, 0, 5)
  assert.equal(velas.precisaLembrete(e2, 10 * H, undefined), false)
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/velas.test.js`
Expected: FAIL com `Cannot find module '../lib/velas'`

- [ ] **Step 3: Implementar `lib/velas.js`**

```js
'use strict'
// Estado das velas: só o Ivo sabe (nenhum sensor vê rizos nem a genoa
// enrolada), por isso escolhe-se no ecrã. Se o vento mudar muito sem mudança
// nas velas, passada 1 h, lembra "as velas continuam assim?".

const GRANDE = [0, 1, 2, -1] // inteira, 1 rizo, 2 rizos, arriada
const GENOA = [100, 70, 50, 0] // % desenrolada; 0 = enrolada
const HORA = 3600000
const BASE_MINIMA = 2 * 1852 / 3600 // 2 nós: numa calmaria a percentagem sobre zero não diz nada

function novoEstadoVelas () {
  return { grandeRizos: 0, genoaPct: 100, mudouEm: null, twsNaMudanca: null, lembradoEm: null }
}

function mudar (e, { grandeRizos, genoaPct }, agora, tws) {
  if (grandeRizos !== undefined && !GRANDE.includes(grandeRizos)) throw new Error('Grande: 0, 1, 2 rizos ou -1 (arriada)')
  if (genoaPct !== undefined && !GENOA.includes(genoaPct)) throw new Error('Genoa: 100, 70, 50 ou 0 (enrolada)')
  return {
    ...e,
    ...(grandeRizos !== undefined ? { grandeRizos } : {}),
    ...(genoaPct !== undefined ? { genoaPct } : {}),
    mudouEm: agora,
    twsNaMudanca: Number.isFinite(tws) ? tws : null,
    lembradoEm: null
  }
}

function precisaLembrete (e, agora, tws) {
  if (!Number.isFinite(tws) || !Number.isFinite(e.twsNaMudanca)) return false
  const desde = Math.max(e.mudouEm ?? 0, e.lembradoEm ?? 0)
  if (agora - desde < HORA) return false
  const base = Math.max(e.twsNaMudanca, BASE_MINIMA) // decisão do Ivo: numa calmaria conta como 2 nós
  return Math.abs(tws - base) / base > 0.4
}

module.exports = { GRANDE, GENOA, novoEstadoVelas, mudar, precisaLembrete }
```

- [ ] **Step 4: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (25 testes no total)

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: estado das velas (grande e genoa) e lembrete quando o vento muda 40%"
```

---

### Task 7: O plugin (ligar tudo, intervalos, REST)

**Files:**
- Create: `software/signalk-arlequin-caixanegra/index.js`
- Test: `software/signalk-arlequin-caixanegra/test/plugin.test.js`

**Interfaces:**
- Consumes: todos os módulos das Tasks 1–6.
- Produces:
  - plugin `signalk-arlequin-caixanegra` com as opções `{pasta = '~/arlequin-dados', limiteAviso = 80, limiteParar = 95, portos = PORTOS}`;
  - publica `sails.grande.rizos`, `sails.genoa.percentagem`, `notifications.arlequin.caixanegra.velas` (warn, visual) e `notifications.arlequin.caixanegra.disco` (warn visual; alarm visual+sound);
  - REST:
    - `GET /estado → {pasta, disco, bruto: {parado, ficheiros}, ultimaLinha, erros, velas: {grandeRizos, genoaPct}, saidaEmCurso}`;
    - `GET /ficheiros?desde=ISO → {ficheiros: [{ficheiro, bytes, alterado}]}`;
    - `GET /velas → {grandeRizos, genoaPct}`;
    - `POST /velas {grandeRizos?, genoaPct?} → {ok, grandeRizos, genoaPct}`, ou 400 `{ok:false, erro}`.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { EventEmitter } = require('node:events')
const disco = require('../lib/disco')
const criar = require('..')

const NO = 1852 / 3600
const EU = 'vessels.urn:mrn:signalk:uuid:arlequin'
const INICIO = Date.UTC(2026, 8, 29, 14, 0, 0)
let usoFalso = 50
disco.usoDisco = () => ({ total: 256e9, livre: 256e9 * (1 - usoFalso / 100), usadoPct: usoFalso })

function appFalso (dir) {
  const app = { valores: {}, notificacoes: [], estado: '', signalk: new EventEmitter(), selfContext: EU }
  app.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'arlequin-cn-'))
  app.getDataDirPath = () => path.join(app.dir, 'plugin')
  app.handleMessage = (id, d) => { for (const u of d.updates) for (const v of u.values) { if (v.path.startsWith('notifications.')) app.notificacoes.push({ path: v.path, ...v.value }); else app.valores[v.path] = v.value } }
  app.setPluginStatus = (s) => { app.estado = s }
  app.error = () => {}
  return app
}
const rotas = (p) => { const r = { get: {}, post: {} }; p.registerWithRouter({ get: (k, h) => { r.get[k] = h }, post: (k, h) => { r.post[k] = h } }); return r }
const chamar = (h, body, query = {}) => new Promise((resolve) => { const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, ...j }) } }; h({ body, query }, res) })
function enviar (app, fonte, { tws = 6, proa = 0.5, stw = 2.5 } = {}) {
  app.signalk.emit('unfilteredDelta', { context: EU, updates: [{ $source: fonte, timestamp: new Date().toISOString(), values: [
    { path: 'navigation.position', value: { latitude: 39.0, longitude: -9.6 } },
    { path: 'navigation.headingTrue', value: proa },
    { path: 'navigation.speedThroughWater', value: stw },
    { path: 'navigation.speedOverGround', value: stw },
    { path: 'environment.wind.speedTrue', value: tws }
  ] }] })
}
function correr (t, app, n, fonte, opc) { for (let i = 0; i < n; i++) { enviar(app, fonte, opc); t.mock.timers.tick(1000) } }
const csv = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => l.split(','))
const ndjson = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean)

test('grava o bruto e a tabela; dados do simulador ficam marcados e nunca estáveis', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'arlequin-simulador')
  p.stop()
  const base = path.join(app.dir, 'dados')
  for (const d of ['bruto', 'tabela', 'saidas', 'previsoes', 'entrada']) assert.ok(fs.existsSync(path.join(base, d)), `falta ${d}/`)
  assert.ok(ndjson(path.join(base, 'bruto', '2026-09-29T14.ndjson.gz')).length >= 130)
  const linhas = csv(path.join(base, 'tabela', '2026-09-29.csv.gz'))
  const cab = linhas[0]
  assert.equal(linhas.length, 1 + 13)
  for (const l of linhas.slice(1)) {
    assert.equal(l[cab.indexOf('simulado')], '1')
    assert.equal(l[cab.indexOf('estavel')], '0')
  }
})

test('dados reais firmes ao largo: a linha fica estável depois de 2 min', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP')
  p.stop()
  const linhas = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz'))
  const i = linhas[0].indexOf('estavel')
  assert.equal(linhas[1][i], '0', 'aos 10 s ainda não')
  assert.equal(linhas[linhas.length - 1][i], '1', 'aos 130 s sim')
  assert.equal(linhas[linhas.length - 1][linhas[0].indexOf('tws')], (6 / NO).toFixed(2))
})

test('velas: POST muda, publica e sobrevive a um reinício; inválido dá 400', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(app.valores['sails.grande.rizos'], 0)
  const r = rotas(p)
  const ok = await chamar(r.post['/velas'], { grandeRizos: 1, genoaPct: '70' })
  assert.equal(ok.ok, true)
  assert.equal(app.valores['sails.grande.rizos'], 1)
  assert.equal(app.valores['sails.genoa.percentagem'], 70)
  const mau = await chamar(r.post['/velas'], { grandeRizos: 3 })
  assert.equal(mau.code, 400)
  assert.match(mau.erro, /rizos/)
  p.stop()
  const app2 = appFalso(app.dir)
  const p2 = criar(app2)
  p2.start({ pasta: path.join(app.dir, 'dados') })
  assert.equal(app2.valores['sails.grande.rizos'], 1)
  assert.equal(app2.valores['sails.genoa.percentagem'], 70)
  const est = await chamar(rotas(p2).get['/estado'], {})
  assert.deepEqual(est.velas, { grandeRizos: 1, genoaPct: 70 })
  p2.stop()
})

test('lembrete das velas quando o vento sobe 60% durante mais de 1 h', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 50
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 130, 'nmea0183.GP', { tws: 5 })
  await chamar(rotas(p).post['/velas'], { grandeRizos: 0 })
  correr(t, app, 3700, 'nmea0183.GP', { tws: 8 })
  p.stop()
  const lembrete = app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.velas' && n.state === 'warn')
  assert.equal(lembrete.length, 1)
  assert.match(lembrete[0].message, /As velas continuam assim\? Grande inteira, genoa 100%/)
  assert.deepEqual(lembrete[0].method, ['visual'])
})

test('disco a 96% sem nada confirmado: pára o bruto e dá alarme; a 50% retoma', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: INICIO })
  usoFalso = 96
  const app = appFalso()
  const p = criar(app)
  p.start({ pasta: path.join(app.dir, 'dados') })
  correr(t, app, 60, 'nmea0183.GP')
  const alarme = app.notificacoes.find(n => n.path === 'notifications.arlequin.caixanegra.disco' && n.state === 'alarm')
  assert.ok(alarme, 'alarme do disco')
  assert.deepEqual(alarme.method, ['visual', 'sound'])
  assert.match(app.estado, /BRUTO PARADO/)
  const f = path.join(app.dir, 'dados', 'bruto', '2026-09-29T14.ndjson.gz')
  const antes = fs.statSync(f).size
  correr(t, app, 30, 'nmea0183.GP')
  assert.equal(fs.statSync(f).size, antes, 'parado não grava')
  const linhasTabela = csv(path.join(app.dir, 'dados', 'tabela', '2026-09-29.csv.gz')).length
  assert.equal(linhasTabela, 1 + 9, 'a tabela continua')
  usoFalso = 50
  correr(t, app, 60, 'nmea0183.GP')
  assert.ok(fs.statSync(f).size > antes, 'retomou')
  assert.equal(app.notificacoes.filter(n => n.path === 'notifications.arlequin.caixanegra.disco').pop().state, 'normal')
  p.stop()
})
```

- [ ] **Step 2: Correr o teste e ver que falha**

Run: `cd software/signalk-arlequin-caixanegra && node --test test/plugin.test.js`
Expected: FAIL com `Cannot find module '..'` (ainda não há `index.js`)

- [ ] **Step 3: Implementar `index.js`**

```js
'use strict'
// Plugin SignalK: caixa negra do Arlequin. Grava TUDO desde o primeiro dia em
// ~/arlequin-dados: bruto/ (todas as mensagens, 1 ficheiro por hora), tabela/
// (uma linha a cada 10 s para a AI), saidas/ (resumo de cada saída) e
// previsoes/ (escrita pelo plugin da rota). Só apaga do bruto o que o portátil
// já confirmou, e só quando o disco passa os 80%. Guarda o estado das velas.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarGravadorBruto } = require('./lib/bruto')
const est = require('./lib/estado')
const estavel = require('./lib/estavel')
const tabela = require('./lib/tabela')
const saidasLib = require('./lib/saidas')
const confirmados = require('./lib/confirmados')
const disco = require('./lib/disco')
const velasLib = require('./lib/velas')
const { PORTOS, portoMaisPerto } = require('./lib/geo')

const NOME_GRANDE = { 0: 'inteira', 1: '1 rizo', 2: '2 rizos', '-1': 'arriada' }

module.exports = function (app) {
  const plugin = {
    id: 'signalk-arlequin-caixanegra',
    name: 'Arlequin · caixa negra',
    description: 'Grava todos os dados desde o primeiro dia (bruto, tabela de 10 s para a AI, saídas) e o estado das velas'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      pasta: { type: 'string', title: 'Pasta dos dados', default: '~/arlequin-dados' },
      limiteAviso: { type: 'number', title: 'Aviso e arquivo a partir de (% do disco)', default: 80 },
      limiteParar: { type: 'number', title: 'Parar o bruto a partir de (% do disco)', default: 95 },
      portos: {
        type: 'array',
        title: 'Portos (para detetar as saídas)',
        default: PORTOS,
        items: { type: 'object', properties: { nome: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } } }
      }
    }
  }

  let o = {}
  let base
  let dirPlugin
  let bruto
  let estado
  let janela
  let saidas
  let velas
  let temporizador = null
  let contador = 0
  let ultimaLinha = null
  let infoDisco = null
  let avisoDisco = 'normal'
  let erros = 0

  const aoDelta = (delta) => {
    const agora = Date.now()
    bruto.escrever(delta, agora)
    est.aplicar(estado, delta, app.selfContext, agora)
  }

  const publicar = (values) => app.handleMessage(plugin.id, { updates: [{ values }] })
  const notificar = (id, state, message, method = ['visual']) =>
    publicar([{ path: `notifications.arlequin.caixanegra.${id}`, value: { state, method: state === 'normal' ? [] : method, message } }])
  const publicarVelas = () =>
    publicar([{ path: 'sails.grande.rizos', value: velas.grandeRizos }, { path: 'sails.genoa.percentagem', value: velas.genoaPct }])

  const ficheiroVelas = () => path.join(dirPlugin, 'velas.json')
  const ficheiroSaida = () => path.join(dirPlugin, 'saida-em-curso.json')
  const ler = (f, omissao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return omissao } }
  function guardar (f, obj) {
    try { fs.writeFileSync(f, JSON.stringify(obj)) } catch (e) { erros++; app.error(`não guardei ${path.basename(f)}: ${e.message}`) }
  }

  function twsMedio () {
    const xs = janela.map(a => a.tws).filter(Number.isFinite)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined
  }

  function listarBruto () {
    const dir = path.join(base, 'bruto')
    return fs.readdirSync(dir).filter(n => n.endsWith('.gz')).map(n => ({ ficheiro: `bruto/${n}`, bytes: fs.statSync(path.join(dir, n)).size }))
  }

  function segundo () {
    const agora = Date.now()
    const v = (c) => est.valor(estado, c, agora)
    estavel.juntar(janela, { t: agora, proa: v('navigation.headingTrue'), stw: v('navigation.speedThroughWater'), tws: v('environment.wind.speedTrue') })
    contador++
    if (contador % 10 === 0) dezSegundos(agora, v)
    if (contador % 60 === 0) minuto()
  }

  function dezSegundos (agora, v) {
    try { bruto.despejar() } catch (e) { erros++; app.error(`bruto: ${e.message}`) }
    const pos = v('navigation.position')
    const perto = portoMaisPerto(pos, o.portos)
    const simulado = est.simuladoRecente(estado, agora)
    const eEstavel = !simulado && estavel.estavel(janela, { longeDoPorto: !!perto && perto.mn > 0.5 })
    try {
      tabela.escrever(path.join(base, 'tabela'), agora, tabela.linha({ v, agora, rajadaMs: estavel.rajada(janela), simulado, estavel: eEstavel }))
      ultimaLinha = agora
    } catch (e) { erros++; app.error(`tabela: ${e.message}`) }
    const rps = v('propulsion.main.revolutions')
    const caudal = v('propulsion.main.fuel.rate')
    const r = saidasLib.atualizar(saidas, {
      t: agora,
      pos,
      sog: v('navigation.speedOverGround'),
      motor: Number.isFinite(rps) && rps > 5,
      litrosHora: Number.isFinite(caudal) ? caudal * 3.6e6 : undefined,
      soc: v('electrical.batteries.servico.capacity.stateOfCharge'),
      simulado
    }, o.portos)
    saidas = r.s
    if (r.terminada) guardar(path.join(base, 'saidas', r.terminada.inicio.slice(0, 16).replace(':', '-') + '.json'), r.terminada)
    if (velasLib.precisaLembrete(velas, agora, twsMedio())) {
      velas = { ...velas, lembradoEm: agora }
      guardar(ficheiroVelas(), velas)
      notificar('velas', 'warn', `As velas continuam assim? Grande ${NOME_GRANDE[velas.grandeRizos]}, genoa ${velas.genoaPct}%`)
    }
  }

  function verificarDisco () {
    const u = disco.usoDisco(base)
    const plano = disco.planear({ ...u, ficheiros: listarBruto(), confirmados: confirmados.lerConfirmados(base), limiteAviso: o.limiteAviso, limiteParar: o.limiteParar })
    const apagados = plano.apagar.length ? confirmados.apagarConfirmados(base, plano.apagar) : []
    infoDisco = { ...u, aviso: plano.aviso, apagados: apagados.length }
    const pct = Math.round(u.usadoPct)
    if (plano.pararBruto) {
      if (!bruto.parado) bruto.parar()
      if (avisoDisco !== 'alarm') {
        avisoDisco = 'alarm'
        notificar('disco', 'alarm', `Disco a ${pct}%: parei de gravar o bruto (a tabela continua). Liga o portátil para copiar os dados.`, ['visual', 'sound'])
      }
      return
    }
    if (bruto.parado && u.usadoPct < o.limiteParar - 5) bruto.retomar()
    if (bruto.parado) return
    const novo = plano.aviso ? 'warn' : 'normal'
    if (novo !== avisoDisco) {
      avisoDisco = novo
      notificar('disco', novo, novo === 'warn' ? `Disco a ${pct}%: copia os dados para o portátil` : 'Normal')
    }
  }

  function minuto () {
    try {
      const r = confirmados.processarEntrada(base)
      if (r.rejeitados.length) app.error(`confirmações rejeitadas: ${r.rejeitados.map(x => `${x.ficheiro} (${x.motivo})`).join(', ')}`)
    } catch (e) { erros++; app.error(`entrada: ${e.message}`) }
    guardar(ficheiroSaida(), saidas)
    try { verificarDisco() } catch (e) { erros++; app.error(`disco: ${e.message}`) }
    const mb = listarBruto().reduce((s, f) => s + f.bytes, 0) / 1e6
    const hora = ultimaLinha ? new Date(ultimaLinha).toLocaleTimeString('pt-PT') : '—'
    app.setPluginStatus(`${bruto.parado ? 'BRUTO PARADO · ' : ''}bruto ${mb.toFixed(1)} MB · disco ${Math.round(infoDisco?.usadoPct ?? 0)}% · última linha ${hora}`)
  }

  plugin.start = function (props) {
    o = { pasta: '~/arlequin-dados', limiteAviso: 80, limiteParar: 95, portos: PORTOS, ...props }
    base = o.pasta.startsWith('~') ? path.join(os.homedir(), o.pasta.slice(1)) : o.pasta
    for (const d of ['bruto', 'tabela', 'saidas', 'previsoes', 'entrada']) fs.mkdirSync(path.join(base, d), { recursive: true })
    dirPlugin = app.getDataDirPath()
    fs.mkdirSync(dirPlugin, { recursive: true })
    bruto = criarGravadorBruto(path.join(base, 'bruto'))
    estado = est.novoEstado()
    janela = estavel.novaJanela()
    saidas = ler(ficheiroSaida(), saidasLib.novaSaidas())
    velas = { ...velasLib.novoEstadoVelas(), ...ler(ficheiroVelas(), {}) }
    contador = 0
    ultimaLinha = null
    infoDisco = null
    avisoDisco = 'normal'
    erros = 0
    publicarVelas()
    app.signalk.on('unfilteredDelta', aoDelta)
    temporizador = setInterval(segundo, 1000)
    app.setPluginStatus(`A gravar em ${base}`)
  }

  plugin.stop = function () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
    app.signalk?.removeListener('unfilteredDelta', aoDelta)
    if (bruto) { try { bruto.despejar() } catch (e) { app.error(`bruto: ${e.message}`) } }
    if (saidas && dirPlugin) guardar(ficheiroSaida(), saidas)
  }

  plugin.registerWithRouter = function (router) {
    router.get('/estado', (req, res) => {
      res.json({
        pasta: base,
        disco: infoDisco,
        bruto: { parado: bruto.parado, ficheiros: listarBruto().length },
        ultimaLinha: ultimaLinha ? new Date(ultimaLinha).toISOString() : null,
        erros,
        velas: { grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct },
        saidaEmCurso: saidas.emCurso
          ? { inicio: new Date(saidas.emCurso.inicio).toISOString(), de: saidas.emCurso.de, milhas: Math.round(saidas.emCurso.milhas * 10) / 10 }
          : null
      })
    })
    router.get('/ficheiros', (req, res) => {
      const desde = req.query?.desde ? Date.parse(req.query.desde) : 0
      const lista = []
      for (const d of ['bruto', 'tabela', 'saidas', 'previsoes']) {
        for (const n of fs.readdirSync(path.join(base, d))) {
          const s = fs.statSync(path.join(base, d, n))
          if (s.mtimeMs >= desde) lista.push({ ficheiro: `${d}/${n}`, bytes: s.size, alterado: s.mtime.toISOString() })
        }
      }
      res.json({ ficheiros: lista })
    })
    router.get('/velas', (req, res) => res.json({ grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct }))
    router.post('/velas', (req, res) => {
      const pedido = {}
      if (req.body?.grandeRizos !== undefined) pedido.grandeRizos = Number(req.body.grandeRizos)
      if (req.body?.genoaPct !== undefined) pedido.genoaPct = Number(req.body.genoaPct)
      try { velas = velasLib.mudar(velas, pedido, Date.now(), twsMedio()) } catch (e) { return res.status(400).json({ ok: false, erro: e.message }) }
      guardar(ficheiroVelas(), velas)
      publicarVelas()
      notificar('velas', 'normal', 'Normal')
      res.json({ ok: true, grandeRizos: velas.grandeRizos, genoaPct: velas.genoaPct })
    })
  }

  return plugin
}
```

- [ ] **Step 4: Correr os testes e ver que passam**

Run: `cd software/signalk-arlequin-caixanegra && npm test`
Expected: PASS (31 testes no total)

- [ ] **Step 5: Commit**

```bash
git add software/signalk-arlequin-caixanegra
git commit -m "Caixa negra: plugin (todas as mensagens via unfilteredDelta, tabela de 10 s, saídas, disco, velas, REST)"
```

---

### Task 8: Ecrã (botões das velas) e Telegram (sem lembrete das velas)

**Files:**
- Modify: `software/arlequin-ecra/public/paginas/velas.js`
- Modify: `software/arlequin-ecra/public/lib/alarmes.js:25-29` (`paginaDoAlarme`)
- Modify: `software/arlequin-ecra/public/index.html:21` (texto do botão)
- Modify: `software/signalk-arlequin-porto/lib/mensagens.js:17-26` (`encaminhar`)
- Test: `software/arlequin-ecra/test/paginas.test.mjs` (acrescentar), `software/arlequin-ecra/test/barometro-viagem-alarmes.test.mjs` (acrescentar), `software/signalk-arlequin-porto/test/mensagens.test.js` (acrescentar)

**Interfaces:**
- Consumes: `POST /plugins/signalk-arlequin-caixanegra/velas {grandeRizos}|{genoaPct}` e os caminhos `sails.grande.rizos`, `sails.genoa.percentagem` (Task 7).
- Produces:
  - ações da página velas: `grande` e `genoa`, com `dados.valor` em texto;
  - `encaminhar(…, {nunca = ['notifications.arlequin.caixanegra.velas']})`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `software/arlequin-ecra/test/paginas.test.mjs`:

```js
test('Velas: estado atual marcado e os toques mandam para a caixa negra', async () => {
  const st = storeSimulado(60)
  aplicarDelta(st, { updates: [{ timestamp: new Date().toISOString(), values: [
    { path: 'sails.grande.rizos', value: 1 },
    { path: 'sails.genoa.percentagem', value: 70 }
  ] }] })
  const html = velas.render(contexto(st, {}))
  assert.match(html, /class="acao go" data-acao="grande" data-valor="1"/)
  assert.match(html, /class="acao go" data-acao="genoa" data-valor="70"/)
  assert.match(html, /class="acao" data-acao="grande" data-valor="-1">Arriada/)
  const pedidos = []
  const ctx = { ...contexto(st, {}), pedir: async (url, op) => { pedidos.push({ url, ...op }); return { ok: true } } }
  await velas.acao('grande', { valor: '2' }, ctx)
  await velas.acao('genoa', { valor: '0' }, ctx)
  assert.deepEqual(pedidos, [
    { url: '/plugins/signalk-arlequin-caixanegra/velas', method: 'POST', body: { grandeRizos: 2 } },
    { url: '/plugins/signalk-arlequin-caixanegra/velas', method: 'POST', body: { genoaPct: 0 } }
  ])
  const falha = { ...contexto(st, {}), pedir: async () => { throw new Error('caixa negra desligada') } }
  await velas.acao('grande', { valor: '1' }, falha)
  assert.match(falha.estado.msg, /Velas não gravadas \(caixa negra desligada\)/)
})
```

Acrescentar a `software/arlequin-ecra/test/barometro-viagem-alarmes.test.mjs`:

```js
test('o lembrete das velas abre a página Velas', () => {
  assert.equal(paginaDoAlarme('notifications.arlequin.caixanegra.velas'), 'velas')
  assert.equal(paginaDoAlarme('notifications.arlequin.caixanegra.disco'), 'diario')
})
```

Acrescentar a `software/signalk-arlequin-porto/test/mensagens.test.js`:

```js
test('o lembrete das velas nunca vai para o Telegram; o alarme do disco vai', () => {
  const e = novoEncaminhador()
  const r = encaminhar(e, [
    n('notifications.arlequin.caixanegra.velas', 'warn', 'As velas continuam assim?'),
    n('notifications.arlequin.caixanegra.disco', 'alarm', 'Disco a 96%')
  ], 0)
  assert.deepEqual(r.mensagens, ['🚨 Disco a 96%'])
})
```

- [ ] **Step 2: Correr os testes e ver que falham**

Run: `cd software/arlequin-ecra && npm test` e `cd software/signalk-arlequin-porto && npm test`
Expected: FAIL nos 3 testes novos. Por exemplo, "Velas: estado atual…" falha em `data-acao="grande"`, `paginaDoAlarme` devolve `'carta'`, e as mensagens incluem o lembrete.

- [ ] **Step 3: Botões na página Velas**

Em `software/arlequin-ecra/public/paginas/velas.js`:

1. Trocar o comentário de topo por:

```js
// Velas: o estado atual (grande e genoa), que só o Ivo sabe e fica gravado na
// caixa negra para a AI, e recolher velas sem piloto, passo a passo. Motor
// ligado → aproar ao vento (rumo alvo = direção do vento real) → recolher →
// terminar. Tudo no diário.
```

2. Logo antes de `export default {`, acrescentar:

```js
const URL_VELAS = '/plugins/signalk-arlequin-caixanegra/velas'
const GRANDE = [[0, 'Inteira'], [1, '1 rizo'], [2, '2 rizos'], [-1, 'Arriada']]
const GENOA = [[100, '100%'], [70, '70%'], [50, '50%'], [0, 'Enrolada']]

function estadoVelas (ctx) {
  const opcoes = (acao, lista, atual) => lista
    .map(([v, t]) => `<button class="acao${v === atual ? ' go' : ''}" data-acao="${acao}" data-valor="${v}">${t}</button>`)
    .join('')
  return `<div class="tile"><div class="lab">Grande</div><div class="acoes">${opcoes('grande', GRANDE, ctx.v('sails.grande.rizos'))}</div>
<div class="lab" style="margin-top:.4rem;">Genoa</div><div class="acoes">${opcoes('genoa', GENOA, ctx.v('sails.genoa.percentagem'))}</div></div>`
}
```

3. No `return` de `render`, a coluna da direita passa a começar pelo estado das velas. Trocar:

```js
<div class="col"><div class="tile" style="flex:1;">${lista}</div>
```

por:

```js
<div class="col">${estadoVelas(ctx)}<div class="tile" style="flex:1;">${lista}</div>
```

4. No início de `acao (nome, dados, ctx)`, logo a seguir a `const e = ctx.estado`, acrescentar:

```js
    if (nome === 'grande' || nome === 'genoa') {
      const body = nome === 'grande' ? { grandeRizos: Number(dados.valor) } : { genoaPct: Number(dados.valor) }
      try { await ctx.pedir(URL_VELAS, { method: 'POST', body }); e.msg = null } catch (err) { e.msg = `Velas não gravadas (${err.message})`; e.msgErro = true }
      return
    }
```

- [ ] **Step 4: Página do alarme e texto do botão**

Em `software/arlequin-ecra/public/lib/alarmes.js`, dentro de `paginaDoAlarme`, antes de `if (caminho.includes('.ais.'))`, acrescentar:

```js
  if (caminho.includes('.caixanegra.velas')) return 'velas'
  if (caminho.includes('.caixanegra.')) return 'diario'
```

Em `software/arlequin-ecra/public/index.html`, trocar:

```html
    <button data-pag="velas" class="vel">Rec. velas</button>
```

por:

```html
    <button data-pag="velas" class="vel">Velas</button>
```

- [ ] **Step 5: O lembrete das velas não vai para o Telegram**

Em `software/signalk-arlequin-porto/lib/mensagens.js`, trocar a assinatura e o início do ciclo de `encaminhar`:

```js
function encaminhar (enc0, notificacoes, agora, { intervalo = 10 * 60 * 1000, amarrado = false, ignorarAmarrado = ['notifications.arlequin.ais.'], nunca = ['notifications.arlequin.caixanegra.velas'] } = {}) {
  const enc = { estados: { ...enc0.estados }, mensagem: { ...enc0.mensagem }, ultimoAlarme: { ...enc0.ultimoAlarme }, pendente: { ...enc0.pendente } }
  const mensagens = []
  for (const n of notificacoes) {
    if (nunca.some(p => n.caminho.startsWith(p))) continue // lembretes só para o ecrã
```

O resto da função fica igual.

- [ ] **Step 6: Correr os testes e ver que passam**

Run: `cd software/arlequin-ecra && npm test` e `cd software/signalk-arlequin-porto && npm test`
Expected: PASS (ecrã: 53 testes; porto: 20 testes)

- [ ] **Step 7: Commit**

```bash
git add software/arlequin-ecra software/signalk-arlequin-porto
git commit -m "Ecrã: estado das velas na página Velas (vai para a caixa negra); o lembrete das velas não vai para o Telegram"
```

---

### Task 9: Sincronização para o portátil (Tailscale/ssh)

**Files:**
- Create: `software/ferramentas/sincronizar/package.json`
- Create: `software/ferramentas/sincronizar/lib.mjs`
- Create: `software/ferramentas/sincronizar/transportes.mjs`
- Create: `software/ferramentas/sincronizar/sincronizar.mjs`
- Test: `software/ferramentas/sincronizar/test/sincronizar.test.mjs`

**Interfaces:**
- Consumes: formato de `entrada/*.json` e `confirmados.processarEntrada` (Task 5), usado no teste cruzado.
- Produces:
  - `sincronizar({transporte, destino, agora}) → {remotos, copiados, bytes, confirmados, diferentes: string[]}`;
  - `transporteLocal(origem)` e `transporteSsh(host, {pasta = 'arlequin-dados', exec})`, cada um com `{listar, copiar, hashes, escreverEntrada}`;
  - `executar(cmd, args, {entrada, para}) → Promise<stdout>`.

- [ ] **Step 1: Criar o `package.json`**

```json
{
  "name": "arlequin-sincronizar",
  "private": true,
  "description": "Copia a caixa negra do Arlequin para o portátil (Tailscale/ssh) e confirma ao Pi o que chegou bem",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test \"test/*.test.mjs\"" }
}
```

- [ ] **Step 2: Escrever o teste que falha**

`software/ferramentas/sincronizar/test/sincronizar.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { sincronizar, sha256 } from '../lib.mjs'
import { transporteLocal, transporteSsh } from '../transportes.mjs'

const require = createRequire(import.meta.url)
const confirmados = require('../../../signalk-arlequin-caixanegra/lib/confirmados.js')
const AGORA = Date.UTC(2026, 8, 29, 14, 30, 0)

function pi () {
  const b = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pi-'))
  for (const d of ['bruto', 'tabela', 'saidas', 'entrada']) mkdirSync(path.join(b, d))
  writeFileSync(path.join(b, 'bruto', '2026-09-29T10.ndjson.gz'), 'dez')
  writeFileSync(path.join(b, 'bruto', '2026-09-29T14.ndjson.gz'), 'catorze') // hora atual, a crescer
  writeFileSync(path.join(b, 'tabela', '2026-09-29.csv.gz'), 't')
  writeFileSync(path.join(b, 'confirmados.json'), '{}')
  return b
}

test('copia tudo, confirma só horas fechadas, e o Pi aceita a confirmação', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const r = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA })
  assert.equal(r.copiados, 3)
  assert.equal(r.confirmados, 1)
  assert.deepEqual(r.diferentes, [])
  assert.equal(readFileSync(path.join(destino, 'bruto', '2026-09-29T14.ndjson.gz'), 'utf8'), 'catorze')
  assert.equal(existsSync(path.join(destino, 'entrada')), false, 'a entrada não se copia')
  const listas = readdirSync(path.join(origem, 'entrada'))
  assert.equal(listas.length, 1)
  assert.match(listas[0], /^confirmados-.*\.json$/)
  const aceite = confirmados.processarEntrada(origem)
  assert.deepEqual(aceite.aceites, ['bruto/2026-09-29T10.ndjson.gz'])
  // segunda vez: nada de novo
  const r2 = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA })
  assert.equal(r2.copiados, 0)
  assert.equal(r2.confirmados, 0)
  // a hora atual cresceu e a hora fechou: copia de novo e confirma
  appendFileSync(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz'), ' e mais')
  const r3 = await sincronizar({ transporte: transporteLocal(origem), destino, agora: AGORA + 3600000 })
  assert.equal(r3.copiados, 1)
  assert.equal(r3.confirmados, 1)
  assert.equal(sha256(path.join(destino, 'bruto', '2026-09-29T14.ndjson.gz')), sha256(path.join(origem, 'bruto', '2026-09-29T14.ndjson.gz')))
})

test('hash diferente: não confirma e avisa', async () => {
  const origem = pi()
  const destino = mkdtempSync(path.join(os.tmpdir(), 'arlequin-pc-'))
  const t = transporteLocal(origem)
  const mau = { ...t, hashes: async (fs) => Object.fromEntries(fs.map(f => [f, '0'.repeat(64)])) }
  const r = await sincronizar({ transporte: mau, destino, agora: AGORA })
  assert.deepEqual(r.diferentes, ['bruto/2026-09-29T10.ndjson.gz'])
  assert.equal(r.confirmados, 0)
  assert.equal(readdirSync(path.join(origem, 'entrada')).length, 0)
})

test('ssh: comandos certos e respostas bem lidas', async () => {
  const chamadas = []
  const exec = async (cmd, args, op = {}) => {
    chamadas.push({ cmd, args, ...op })
    const remoto = args[1]
    if (remoto.includes('find ')) return 'bruto/2026-09-29T10.ndjson.gz\t123\ntabela/2026-09-29.csv.gz\t45\n'
    if (remoto.includes('sha256sum')) return `${'a'.repeat(64)}  bruto/2026-09-29T10.ndjson.gz\n`
    return ''
  }
  const t = transporteSsh('pi@arlequin', { exec })
  assert.deepEqual(await t.listar(), [{ ficheiro: 'bruto/2026-09-29T10.ndjson.gz', bytes: 123 }, { ficheiro: 'tabela/2026-09-29.csv.gz', bytes: 45 }])
  assert.deepEqual(await t.hashes(['bruto/2026-09-29T10.ndjson.gz']), { 'bruto/2026-09-29T10.ndjson.gz': 'a'.repeat(64) })
  await t.copiar(['bruto/2026-09-29T10.ndjson.gz'], 'C:\\dados')
  await t.escreverEntrada('confirmados-x.json', '[]')
  const copiar = chamadas[2]
  assert.equal(copiar.cmd, 'ssh')
  assert.deepEqual(copiar.para, ['tar', ['-xf', '-', '-C', 'C:\\dados']])
  assert.equal(copiar.entrada, 'bruto/2026-09-29T10.ndjson.gz\n')
  assert.match(chamadas[3].args[1], /cat > ~\/arlequin-dados\/entrada\/confirmados-x\.json\.tmp && mv .*confirmados-x\.json\.tmp .*confirmados-x\.json$/)
  assert.ok(chamadas.every(c => c.args[0] === 'pi@arlequin'))
})
```

- [ ] **Step 3: Correr o teste e ver que falha**

Run: `cd software/ferramentas/sincronizar && npm test`
Expected: FAIL com `Cannot find module '…/lib.mjs'`

- [ ] **Step 4: Implementar `lib.mjs`**

```js
// Copia a caixa negra do Pi para o portátil e confirma ao Pi o que chegou bem.
// O transporte (ssh pelo Tailscale, ou uma pasta local para testes e pens) dá:
//   listar() → [{ ficheiro, bytes }]      copiar(ficheiros, destino)
//   hashes(ficheiros) → { ficheiro: sha256 }   escreverEntrada(nome, texto)
// Só se confirmam horas do bruto já fechadas: a hora atual ainda está a crescer.

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const horaDoBruto = (f) => f.match(/^bruto\/(\d{4}-\d{2}-\d{2}T\d{2})\.ndjson\.gz$/)?.[1]

export async function sincronizar ({ transporte, destino, agora = Date.now() }) {
  mkdirSync(destino, { recursive: true })
  const local = (f) => path.join(destino, ...f.split('/'))
  const remotos = await transporte.listar()
  const aCopiar = remotos.filter(r => !existsSync(local(r.ficheiro)) || statSync(local(r.ficheiro)).size !== r.bytes)
  if (aCopiar.length) await transporte.copiar(aCopiar.map(r => r.ficheiro), destino)

  const registo = path.join(destino, '.confirmados.json')
  let enviados = {}
  try { enviados = JSON.parse(readFileSync(registo, 'utf8')) } catch { enviados = {} }
  const horaAtual = new Date(agora).toISOString().slice(0, 13)
  const recopiados = new Set(aCopiar.map(r => r.ficheiro))
  // Não se volta a calcular o hash do que já foi confirmado (anos de bruto), só do novo ou recopiado.
  const candidatos = remotos
    .map(r => r.ficheiro)
    .filter(f => { const h = horaDoBruto(f); return h && h < horaAtual && existsSync(local(f)) && (!enviados[f] || recopiados.has(f)) })
  const remotosHash = candidatos.length ? await transporte.hashes(candidatos) : {}
  const confirmar = []
  const diferentes = []
  for (const f of candidatos) {
    const h = sha256(local(f))
    if (remotosHash[f] === h) confirmar.push({ ficheiro: f, sha256: h })
    else diferentes.push(f)
  }
  if (confirmar.length) {
    const nome = `confirmados-${new Date(agora).toISOString().replace(/[:.]/g, '-')}.json`
    await transporte.escreverEntrada(nome, JSON.stringify(confirmar))
    for (const c of confirmar) enviados[c.ficheiro] = c.sha256
    writeFileSync(registo, JSON.stringify(enviados, null, 1))
  }
  return { remotos: remotos.length, copiados: aCopiar.length, bytes: aCopiar.reduce((s, r) => s + r.bytes, 0), confirmados: confirmar.length, diferentes }
}
```

- [ ] **Step 5: Implementar `transportes.mjs`**

```js
// Transportes da sincronização: uma pasta local a fazer de Pi (testes, ou os
// dados trazidos numa pen) e o Pi a sério por ssh (Tailscale). Por ssh a cópia
// vai num só "tar" (rápido com muitos ficheiros) e o tar do Windows desempacota.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PASTAS = ['bruto', 'tabela', 'saidas', 'previsoes', 'modelos']

export function transporteLocal (origem) {
  return {
    async listar () {
      const lista = []
      const andar = (rel) => {
        let entradas
        try { entradas = readdirSync(path.join(origem, rel), { withFileTypes: true }) } catch { return }
        for (const e of entradas) {
          const r = `${rel}/${e.name}`
          if (e.isDirectory()) andar(r)
          else lista.push({ ficheiro: r, bytes: statSync(path.join(origem, r)).size })
        }
      }
      for (const p of PASTAS) andar(p)
      return lista
    },
    async copiar (ficheiros, destino) {
      for (const f of ficheiros) {
        const d = path.join(destino, ...f.split('/'))
        mkdirSync(path.dirname(d), { recursive: true })
        copyFileSync(path.join(origem, f), d)
      }
    },
    async hashes (ficheiros) {
      return Object.fromEntries(ficheiros.map(f => [f, createHash('sha256').update(readFileSync(path.join(origem, f))).digest('hex')]))
    },
    async escreverEntrada (nome, texto) {
      const dir = path.join(origem, 'entrada')
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, nome + '.tmp'), texto)
      renameSync(path.join(dir, nome + '.tmp'), path.join(dir, nome))
    }
  }
}

// Corre um programa e devolve o que escreveu. Com `para`, liga a saída a outro
// programa (ssh … tar → tar -x) e espera pelos dois.
export function executar (cmd, args, { entrada, para } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] })
    const q = para ? spawn(para[0], para[1], { stdio: ['pipe', 'inherit', 'inherit'] }) : null
    let saida = ''
    if (q) p.stdout.pipe(q.stdin)
    else p.stdout.on('data', (d) => { saida += d })
    let falta = q ? 2 : 1
    let erro = null
    const fim = (nome) => (codigo) => {
      if (codigo !== 0 && !erro) erro = new Error(`${nome} saiu com o código ${codigo}`)
      if (--falta === 0) { if (erro) reject(erro); else resolve(saida) }
    }
    p.on('error', reject)
    q?.on('error', reject)
    p.on('close', fim(cmd))
    q?.on('close', fim(para[0]))
    p.stdin.end(entrada ?? '')
  })
}

export function transporteSsh (host, { pasta = 'arlequin-dados', exec = executar } = {}) {
  const dir = `~/${pasta}`
  return {
    async listar () {
      const t = await exec('ssh', [host, `cd ${dir} && find ${PASTAS.join(' ')} -type f -printf '%p\\t%s\\n' 2>/dev/null; true`])
      return t.split('\n').filter(Boolean).map(l => { const [ficheiro, bytes] = l.split('\t'); return { ficheiro, bytes: Number(bytes) } })
    },
    async copiar (ficheiros, destino) {
      await exec('ssh', [host, `cd ${dir} && tar -cf - -T -`], { entrada: ficheiros.join('\n') + '\n', para: ['tar', ['-xf', '-', '-C', destino]] })
    },
    async hashes (ficheiros) {
      const t = await exec('ssh', [host, `cd ${dir} && xargs -d '\\n' sha256sum --`], { entrada: ficheiros.join('\n') + '\n' })
      return Object.fromEntries(t.split('\n').filter(Boolean).map(l => { const m = l.match(/^([0-9a-f]{64}) [ *](.+)$/); return [m[2], m[1]] }))
    },
    async escreverEntrada (nome, texto) {
      const e = `${dir}/entrada`
      await exec('ssh', [host, `mkdir -p ${e} && cat > ${e}/${nome}.tmp && mv ${e}/${nome}.tmp ${e}/${nome}`], { entrada: texto })
    }
  }
}
```

- [ ] **Step 6: Implementar `sincronizar.mjs` (linha de comandos)**

```js
// Copia a caixa negra do Arlequin para o portátil (pelo Tailscale) e confirma
// ao Pi o que chegou bem, para ele poder libertar espaço quando o disco encher.
//   node sincronizar.mjs                          → ssh pi@arlequin → Documents\Veleiro\arlequin-dados
//   node sincronizar.mjs --host ivo@arlequin --destino D:\arlequin-dados
//   node sincronizar.mjs --origem E:\arlequin-dados   (pasta local, ex.: uma pen)

import os from 'node:os'
import path from 'node:path'
import { sincronizar } from './lib.mjs'
import { transporteSsh, transporteLocal } from './transportes.mjs'

const arg = (nome, omissao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : omissao }
const destino = arg('destino', path.join(os.homedir(), 'Documents', 'Veleiro', 'arlequin-dados'))
const transporte = arg('origem') ? transporteLocal(arg('origem')) : transporteSsh(arg('host', 'pi@arlequin'))
const inicio = Date.now()
try {
  const r = await sincronizar({ transporte, destino })
  console.log(`Ficheiros no barco: ${r.remotos} · copiados agora: ${r.copiados} (${(r.bytes / 1e6).toFixed(1)} MB) · confirmados ao Pi: ${r.confirmados}`)
  if (r.diferentes.length) console.log(`ATENÇÃO: ${r.diferentes.length} ficheiro(s) com hash diferente, não confirmados: ${r.diferentes.join(', ')}`)
  console.log(`Em ${destino} · ${Math.round((Date.now() - inicio) / 1000)} s`)
} catch (e) {
  console.error(`Falhou: ${e.message}`)
  process.exit(1)
}
```

- [ ] **Step 7: Correr os testes e ver que passam**

Run: `cd software/ferramentas/sincronizar && npm test`
Expected: PASS (3 testes)

- [ ] **Step 8: Commit**

```bash
git add software/ferramentas/sincronizar
git commit -m "Sincronização da caixa negra para o portátil (ssh/Tailscale ou pasta), confirmação por sha256 só de horas fechadas"
```

---

### Task 10: Ligar no SignalK local, validar ao vivo e documentar

**Files:**
- Modify: `software/dev/package.json` (script `test`)
- Modify: `software/dev/config/package.json` (dependência nova)
- Create: `software/dev/config/plugin-config-data/signalk-arlequin-caixanegra.json`
- Modify: `.gitignore` (raiz do repo `arlequin`)
- Modify: `NAVEGACAO.md` (secção nova "Caixa negra e Tailscale")
- Modify: `docs/superpowers/specs/2026-09-29-melhor-rota-ia-design.md` (Parte 1: notas de implementação)

- [ ] **Step 1: Testes de tudo e plugin no SignalK local**

Em `software/dev/package.json`, no fim do script `test`, acrescentar:

```
 && cd ../signalk-arlequin-caixanegra && npm test && cd ../ferramentas/sincronizar && npm test
```

Em `software/dev/config/package.json`, acrescentar às `dependencies`:

```json
    "signalk-arlequin-caixanegra": "file:../../signalk-arlequin-caixanegra"
```

Criar `software/dev/config/plugin-config-data/signalk-arlequin-caixanegra.json`. A pasta relativa resolve-se a partir de onde o servidor corre (`software/dev`, pelo `npm start`), por isso os dados ficam em `software/dev/arlequin-dados`, ignorados pelo git:

```json
{
  "enabled": true,
  "configuration": {
    "pasta": "arlequin-dados",
    "limiteAviso": 80,
    "limiteParar": 95
  }
}
```

Acrescentar ao `.gitignore` da raiz do repositório:

```
software/dev/arlequin-dados/
```

Run: `cd software/dev/config && npm install && cd .. && npm test`
Expected: todos os pacotes PASS (energia 33, simulador 16, ais 4, ecrã 53, j1939 28, gasóleo 31, água 9, porto 20, caixa negra 31, sincronizar 3).

- [ ] **Step 2: Validação ao vivo com o simulador**

Confirmar no `/estado` que `pasta` termina em `software\dev\arlequin-dados`.

Run (em segundo plano): `cd software/dev && npm start`

Depois de 3 minutos:
- `curl -s http://localhost:3000/plugins/signalk-arlequin-caixanegra/estado`
  - Expected: `bruto.ficheiros ≥ 1`, `ultimaLinha` recente, `erros: 0`, `disco.usadoPct` real.
- `node -e "const z=require('zlib'),fs=require('fs');const f=fs.readdirSync('arlequin-dados/tabela')[0];const l=z.gunzipSync(fs.readFileSync('arlequin-dados/tabela/'+f)).toString().trim().split('\n');console.log(l.length,l[0]);console.log(l.at(-1))"`
  - Expected: cabeçalho com as 24 colunas e a última linha com `simulado=1` e `estavel=0`, porque o simulador está ligado.

- [ ] **Step 3: Ecrã: os botões das velas ao vivo**

- Abrir `http://localhost:3000/arlequin-ecra/?pagina=velas` no browser (painel de pré-visualização).
- Tocar em "1 rizo" e em "70%".
  - Expected: os botões ficam verdes.
  - `curl -s http://localhost:3000/plugins/signalk-arlequin-caixanegra/velas` dá `{"grandeRizos":1,"genoaPct":70}`.
  - Na tabela, as linhas seguintes têm `grandeRizos=1` e `genoaPct=70`.
- Ver também em `?noite=1`. Tirar uma captura de cada, dia e noite, e confirmar que se lê bem.

- [ ] **Step 4: Sincronização ao vivo com a pasta local**

Run: `node software/ferramentas/sincronizar/sincronizar.mjs --origem software/dev/arlequin-dados --destino <scratchpad>/arlequin-dados-pc`
Expected: "copiados agora: N", ficheiros iguais no destino. Na 2.ª corrida, "copiados agora: 0".

Parar o servidor no fim: terminar o processo do `npm start`.

- [ ] **Step 5: Documentar**

1. **`NAVEGACAO.md`**: acrescentar a secção seguinte depois da secção da monitorização no porto.

````markdown
## Caixa negra e Tailscale (dados para o Claude analisar)

**O que grava** (plugin `signalk-arlequin-caixanegra`), em `~/arlequin-dados` no Pi, desde o primeiro dia:
- `bruto/`: todas as mensagens, 1 ficheiro por hora;
- `tabela/`: 1 linha a cada 10 s, para a AI;
- `saidas/`: resumo de cada saída;
- `previsoes/`: escrito pelo plugin da rota.

**Regras do disco:** aos 80% apaga do `bruto/` só o que o portátil já confirmou. Aos 95% sem nada confirmado pára o bruto, e a tabela continua. Nunca apaga nada que não esteja no portátil.

**Tailscale: feito pelo Ivo, uma vez** (o Claude não trata contas nem palavras-passe):
1. Criar a conta em tailscale.com (entrar com Google ou Microsoft).
2. No portátil: instalar o Tailscale para Windows e entrar com a conta.
3. No Pi, com rede (o telemóvel em ponto de acesso serve):
   - `curl -fsSL https://tailscale.com/install.sh | sh`
   - `sudo tailscale up --ssh --hostname arlequin`
   - abrir o link que aparece e aprovar com a conta.
4. Testar no portátil: `ssh pi@arlequin "ls ~/arlequin-dados"`.

**Copiar os dados** (sempre que estiveres a bordo com rede):

```
node software/ferramentas/sincronizar/sincronizar.mjs --host pi@arlequin
```

- Os dados ficam em `Documents\Veleiro\arlequin-dados`.
- Recomendado: incluir esta pasta na cópia de segurança do Windows ou no OneDrive.
- Sem rede, também dá com uma pen: `--origem E:\arlequin-dados`.

**Velas:** na página **Velas** do ecrã, toca no estado da grande e da genoa sempre que mudares. A AI precisa disto para aprender, e o ecrã lembra-te se o vento mudar muito.
````

2. **Desenho, Parte 1**: acrescentar no fim da secção "Parte 1: Caixa negra":

```markdown
### Notas de implementação (29/09)

- **A previsão não entra na tabela de 10 s.** Junta-se no treino (Parte 2) a partir de `previsoes/`, pela hora e posição. Assim a caixa negra não depende do plugin da rota, e previsões descarregadas mais tarde também servem.
- **A confirmação do portátil é um ficheiro, não um pedido HTTP.**
  - A sincronização escreve `entrada/confirmados-*.json` pelo ssh (`.tmp` e depois muda o nome).
  - O plugin lê a entrada a cada minuto e confere o sha256 de cada ficheiro.
  - Evita abrir ou autenticar a API do SignalK para o portátil.
  - O `POST /confirmados` do desenho original fica substituído por isto.
- **Só se confirmam horas do bruto já fechadas.** Antes de apagar, o plugin volta a conferir o hash.
- **"Sensores sem alarme" = proa, STW e TWS com valores de há menos de 15 s.** Ainda não há alarmes de sensor próprios.
- **O lembrete das velas é só para o ecrã.** O plugin do porto não o manda para o Telegram. O alarme do disco (95%) vai para o Telegram.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore NAVEGACAO.md docs/superpowers/specs/2026-09-29-melhor-rota-ia-design.md software/dev/package.json software/dev/config/package.json software/dev/config/plugin-config-data/signalk-arlequin-caixanegra.json
git commit -m "Caixa negra ligada no SignalK local, validada ao vivo; passos do Tailscale e notas no desenho"
```

---

## Self-review (feito)

**Cobertura do desenho, Parte 1:**

| Requisito | Onde |
|---|---|
| bruto com tudo (todos os contextos, plugins, notificações) | Tasks 2 e 7 (`unfilteredDelta`) |
| tabela de 10 s, com as colunas do desenho menos a previsão | Tasks 3 e 7; a previsão ficou para o treino (nota na Task 10) |
| `previsoes/` | pasta criada; quem escreve é o plugin da rota (fora deste plano) |
| `saidas/` | Tasks 4 e 7 |
| `estavel` e `simulado` | Tasks 1, 3 e 7 |
| velas (botões, caminhos, lembrete de 1 h e 40%) | Tasks 6, 7 e 8 |
| disco 80/95, nunca apagar o não confirmado, retomar | Tasks 5 e 7 |
| REST `/estado`, `/ficheiros` | Task 7 |
| confirmação do portátil | Tasks 5 e 9, com ficheiro em vez de POST (nota na Task 10) |
| sincronização com hash, só depois de verificar | Task 9 |
| Tailscale pelo Ivo, passos escritos | Task 10 |
| alarme do disco no Telegram, lembrete das velas não | Tasks 7 e 8 |

**Sem marcadores vazios.** Todos os passos têm código ou comandos.

**Nomes coerentes:**
- `processarEntrada`, `lerConfirmados`, `apagarConfirmados` e `sha256Ficheiro` são usados com o mesmo nome nas Tasks 5, 7 e 9.
- `sails.grande.rizos` e `sails.genoa.percentagem` são iguais nas Tasks 3, 7 e 8.
- `notifications.arlequin.caixanegra.velas` e `.disco` são iguais nas Tasks 7 e 8.
