// O "Larguei (sou eu)" (contrato C10, Adenda 2 do dono): o alarme "o barco saiu do lugar" do plugin do porto leva
// no valor da notificação acao: 'largar'; o ecrã põe-lhe o botão, que chama POST /plugins/signalk-arlequin-porto/largar
// (o mesmo que o /largar do Telegram: apaga o ponto de amarração e o alarme limpa); se falhar, a razão em pt-PT.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { lerFonte, corte } from './ajuda-fonte.mjs'
import { chipAlarme, alarmeDaBarra, botaoLarguei, largar, URL_LARGAR } from '../public/lib/alarmes.js'
import { falhaLargar } from '../public/lib/erros.js'
import { barraHtml } from '../public/lib/barra.js'

const require = createRequire(import.meta.url)
const regras = require('../../signalk-arlequin-porto/lib/regras.js')

const SOM = ['visual', 'sound']
const st = (x = {}) => ({ silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true, canClear: false, ...x })
// como o plugin do porto a publica (regras.js) mais o id e o status do servidor
const deriva = (extra = {}) => ({ caminho: 'notifications.arlequin.porto.deriva', id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', state: 'alarm', method: SOM, apito: 'curto', acao: 'largar', message: 'O barco saiu do lugar: está a 45 m do ponto de amarração', status: st(), timestamp: '2026-10-03T10:00:00.000Z', ...extra })
const erro = (status, message = String(status)) => Object.assign(new Error(message), status ? { status } : {})

test('contrato C10: o que o plugin do porto publica em "o barco saiu do lugar" (regras.passo) leva acao: "largar", e só esse alarme', () => {
  const ponto = { latitude: 38.7, longitude: -9.4 }
  const longe = { latitude: 38.7005, longitude: -9.4 }
  const e0 = { ...regras.novoEstado(), amarracao: { ponto, paradoDesde: null } }
  const r = regras.passo(e0, { posicao: longe, sog: 0, motorLigado: false, juntoAPorto: true, armado: false, agua: true }, Date.now())
  const porId = Object.fromEntries(r.notificacoes.map(n => [n.id, n]))
  assert.equal(porId.deriva.acao, 'largar')
  assert.equal(porId.deriva.state, 'alarm')
  assert.equal(porId.aguaPorao.acao, undefined, 'o resto dos alarmes do porto não leva ação')
  // chega ao ecrã como { caminho, id, …valor, status }: o botão aparece no alarme da barra
  const noEcra = { caminho: 'notifications.arlequin.porto.deriva', ...porId.deriva, id: '0b6f3c2e-1d2a-4c55-9d1e-6a1f2b3c4d5e', status: st() }
  assert.match(chipAlarme(noEcra), /<button class="largar" data-acao="largar">Larguei \(sou eu\)<\/button>/)
})

test('"Larguei (sou eu)": o alarme com acao "largar" leva o botão ao lado do calar; sem acao, com outra acao, já normal ou sem alarme, não; com o texto do plugin escapado', () => {
  const html = chipAlarme(deriva())
  assert.match(html, /^<span class="chip alarme"[^>]*>⚠ O barco saiu do lugar: está a 45 m do ponto de amarração<\/span><button class="silenciar" data-acao="silenciar" data-id="[^"]+">silenciar<\/button><button class="largar" data-acao="largar">Larguei \(sou eu\)<\/button>$/)
  // já calado (só visual): continua o Larguei (o alarme ainda está ativo), sem o calar
  const calado = chipAlarme(deriva({ method: ['visual'], status: st({ silenced: true }) }))
  assert.match(calado, /Larguei \(sou eu\)/)
  assert.doesNotMatch(calado, /class="silenciar"/)
  assert.doesNotMatch(chipAlarme(deriva({ acao: undefined })), /largar|Larguei/)
  assert.doesNotMatch(chipAlarme(deriva({ acao: 'outra' })), /largar|Larguei/)
  assert.doesNotMatch(chipAlarme(deriva({ state: 'normal', method: [] })), /Larguei/)
  assert.equal(botaoLarguei(null), '')
  assert.equal(chipAlarme(null), '')
  // o botão é da ação do próprio alarme: o dos outros não o levam
  assert.doesNotMatch(chipAlarme(deriva({ caminho: 'notifications.arlequin.porto.aguaPorao', acao: undefined, message: 'Água no porão!' })), /Larguei/)
  // na barra de cima fica logo a seguir ao alarme e ao calar, antes do "sem som" e das falhas
  const barra = barraHtml({ agora: Date.now(), gps: true, ligado: true, alarmeHtml: html, somHtml: '<span class="chip sem-som">sem som</span>', falhas: ['x'] })
  assert.ok(barra.indexOf('class="silenciar"') < barra.indexOf('class="largar"') && barra.indexOf('class="largar"') < barra.indexOf('sem-som'))
  // a barra mostra o alarme que apita: com o fumo reconhecido e o deriva a apitar, é o deriva (e o Larguei)
  const fumoReconhecido = { caminho: 'notifications.arlequin.porto.fumo', id: '1c7f4d3f-2e3b-4d66-8e2f-7b2a3c4d5e6f', state: 'emergency', method: ['visual'], apito: 'continuo', message: 'FUMO a bordo!', status: st({ acknowledged: true }) }
  assert.equal(alarmeDaBarra([fumoReconhecido, deriva()]).caminho, 'notifications.arlequin.porto.deriva')
})

test('largar(): POST /plugins/signalk-arlequin-porto/largar, sem corpo; devolve a resposta do plugin', async () => {
  assert.equal(URL_LARGAR, '/plugins/signalk-arlequin-porto/largar')
  const pedidos = []
  const pedirOk = async (url, o = {}) => { pedidos.push([o.method || 'GET', url, o.body]); return { ok: true } }
  assert.deepEqual(await largar(pedirOk), { ok: true })
  assert.deepEqual(pedidos, [['POST', '/plugins/signalk-arlequin-porto/largar', undefined]])
  // uma recusa chega a quem chama (o app.js mostra-a na barra)
  await assert.rejects(largar(async () => { throw erro(503, 'o plugin porto não está ligado') }), /o plugin porto não está ligado/)
})

test('"Larguei" que falha: a razão em pt-PT na barra, curta — sem permissão, sem ligação, plugin parado (a do plugin), não instalado, erro', () => {
  assert.equal(falhaLargar(erro(401)), 'não larguei: sem permissão (entra no SignalK)')
  assert.equal(falhaLargar(erro(403)), 'não larguei: sem permissão (entra no SignalK)')
  assert.equal(falhaLargar(erro(undefined, 'sem ligação ao SignalK')), 'não larguei: sem ligação ao SignalK')
  // o 503 do plugin parado traz o motivo em pt-PT ({ erro } na resposta; o pedir() põe-no na mensagem)
  assert.equal(falhaLargar(erro(503, 'o plugin porto não está ligado')), 'não larguei: o plugin porto não está ligado')
  assert.equal(falhaLargar(erro(503)), 'não larguei: o plugin do porto não está ligado')
  assert.equal(falhaLargar(erro(404)), 'não larguei: o plugin do porto não está instalado ou ligado')
  assert.equal(falhaLargar(erro(500)), 'não larguei: o plugin do porto deu um erro (HTTP 500)')
  // nunca o código cru, o inglês nem null/undefined
  for (const e of [erro(401), erro(undefined), erro(404), erro(500), erro(503), null, undefined, {}]) assert.doesNotMatch(falhaLargar(e), /undefined|null|\[object|^\d{3}$|Failed/)
})

test('o app.js trata o toque em "Larguei": um pedido de cada vez, a falha vai para a barra em pt-PT e para o registo, e o desenho é forçado', () => {
  const app = lerFonte('app.js')
  const bloco = corte(app, "if (acao === 'largar')", "if (acao === 'ir-alarme')", 'o bloco do largar do app.js')
  assert.match(bloco, /await largar\(pedir\)/)
  assert.match(bloco, /falhaLargar\(/)
  assert.match(bloco, /registarErro\('largar'/)
  assert.match(bloco, /app\.aLargar/, 'um toque duplo não pede duas vezes')
  assert.match(bloco, /render\(true\)/)
  assert.doesNotMatch(bloco, /\.catch\(\(\) => \{\}\)/)
  // a falha usa a mesma faixa da barra do calar (15 s)
  assert.match(bloco, /app\.falhaCalar\s*=\s*\{ texto: falhaLargar\(err\)/)
})

test('o estilo do botão: 44 px, azul (não se confunde com o vermelho do calar), de noite com o texto das letras de noite', () => {
  const css = lerFonte('estilo.css')
  const regra = corte(css, '.largar {', '}', 'a regra .largar')
  assert.match(regra, /min-height:\s*44px/)
  assert.match(regra, /min-width:\s*44px/)
  assert.match(regra, /flex:\s*0 0 auto/)
  assert.match(regra, /background:\s*var\(--ativo\)/)
  assert.match(css, /body\.noite \.largar\s*\{[^}]*color:\s*var\(--texto\)/)
})
