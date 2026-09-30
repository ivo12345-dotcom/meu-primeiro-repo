'use strict'
// Lança o treino em Python (python -m arlequin_ia treinar …) como processo
// filho, com prioridade baixa no Pi (nice), e lê uma linha JSON por modelo
// (as linhas que não são JSON, como os avisos do LightGBM, saltam-se).
// Pára-o se passar do tempo: mata-o e só dá o erro depois de ele fechar, para o
// plugin não lançar outro treino enquanto este ainda está a morrer. Se não fechar
// com o SIGTERM, insiste com SIGKILL.

const { spawn } = require('node:child_process')

function lerLinhas (saida) {
  const out = []
  for (const l of saida.split('\n')) {
    if (!l.trim()) continue
    try { out.push(JSON.parse(l)) } catch { /* não é uma linha de resultado */ }
  }
  return out
}

function lancarTreino ({ comando, cwd, nice = process.platform === 'linux', timeoutMs = 30 * 60000, esperaKillMs = 10000, spawnFn = spawn }) {
  const cmd = nice ? ['nice', '-n', '19', ...comando] : comando
  return new Promise((resolve, reject) => {
    const p = spawnFn(cmd[0], cmd.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let saida = ''
    let erro = ''
    let fim = false
    let esgotado = false
    let duro = null
    const relogio = setTimeout(() => {
      esgotado = true
      p.kill()
      duro = setTimeout(() => p.kill('SIGKILL'), esperaKillMs)
    }, timeoutMs)
    p.stdout.on('data', d => { saida += d })
    p.stderr.on('data', d => { erro = (erro + d).slice(-2000) })
    p.on('error', e => {
      if (fim || esgotado) return
      fim = true
      clearTimeout(relogio)
      reject(new Error(`não consegui lançar o treino: ${e.message}`))
    })
    p.on('close', (codigo) => {
      if (fim) return
      fim = true
      clearTimeout(relogio)
      clearTimeout(duro)
      if (esgotado) return reject(new Error(`o treino passou de ${Math.round(timeoutMs / 60000)} min e foi parado`))
      if (codigo !== 0) return reject(new Error(`o treino falhou (código ${codigo}): ${erro.trim().split('\n').pop() || 'sem mensagem'}`))
      resolve(lerLinhas(saida))
    })
  })
}

module.exports = { lancarTreino }
