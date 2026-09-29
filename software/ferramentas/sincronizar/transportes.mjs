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
