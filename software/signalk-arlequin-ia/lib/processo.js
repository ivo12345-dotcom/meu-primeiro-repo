'use strict'
// Lança o treino em Python (python -m arlequin_ia treinar …) como processo
// filho, com prioridade baixa no Pi (nice), e lê uma linha JSON por modelo.
// Pára-o se passar do tempo.

const { spawn } = require('node:child_process')

function lancarTreino ({ comando, cwd, nice = process.platform === 'linux', timeoutMs = 30 * 60000, spawnFn = spawn }) {
  const cmd = nice ? ['nice', '-n', '19', ...comando] : comando
  return new Promise((resolve, reject) => {
    const p = spawnFn(cmd[0], cmd.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let saida = ''
    let erro = ''
    let fim = false
    const relogio = setTimeout(() => { fim = true; p.kill(); reject(new Error(`o treino passou de ${Math.round(timeoutMs / 60000)} min e foi parado`)) }, timeoutMs)
    p.stdout.on('data', d => { saida += d })
    p.stderr.on('data', d => { erro = (erro + d).slice(-2000) })
    p.on('error', e => { if (!fim) { fim = true; clearTimeout(relogio); reject(new Error(`não consegui lançar o treino: ${e.message}`)) } })
    p.on('close', (codigo) => {
      if (fim) return
      fim = true
      clearTimeout(relogio)
      if (codigo !== 0) return reject(new Error(`o treino falhou (código ${codigo}): ${erro.trim().split('\n').pop() || 'sem mensagem'}`))
      try {
        resolve(saida.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)))
      } catch (e) { reject(new Error(`resposta do treino ilegível: ${e.message}`)) }
    })
  })
}

module.exports = { lancarTreino }
