// Ajuda dos testes (não é um teste): ler o código do ecrã sem depender dos fins de linha e cortar-lhe um pedaço
// (uma função, um bloco) sem que o teste passe em vazio (revisão F3, Minor 13). O app.js é do browser e não se
// importa no node: os testes leem-no e conferem o que ele chama, num pedaço só.
//
// O problema: no Windows o git (core.autocrlf=true) entrega os ficheiros com CRLF. Um corte que procurasse o fim
// da função em "\n}\n" não o achava (o fim é "\r\n}\r\n"), o indexOf dava -1, e o slice(início, -1) ia até ao fim
// do ficheiro: o teste lia o ficheiro todo em vez da função e passava sem verificar o que dizia.

import { readFileSync } from 'node:fs'

// Sem os \r.
export const semCR = (texto) => String(texto).replace(/\r/g, '')

// O ficheiro do ecrã (o caminho é relativo a public/, ex.: 'app.js' ou 'lib/alarmes.js'), sem os \r.
export const lerFonte = (caminho) => semCR(readFileSync(new URL(`../public/${caminho}`, import.meta.url), 'utf8'))

// O texto do 1.º `de` até ao 1.º `ate` a seguir (o `ate` fica de fora), com LF ou CRLF no fonte. Rebenta, com o
// nome, se algum não se achar: um teste que lê um pedaço nunca fica a ler o ficheiro todo (ou nada) sem dar por isso.
export function corte (fonte, de, ate, nome = `${de} … ${ate}`) {
  const texto = semCR(fonte)
  const i = texto.indexOf(semCR(de))
  if (i < 0) throw new Error(`corte "${nome}": não achei o princípio (${JSON.stringify(de)})`)
  const j = texto.indexOf(semCR(ate), i + semCR(de).length)
  if (j < 0) throw new Error(`corte "${nome}": não achei o fim (${JSON.stringify(ate)}) a seguir ao princípio`)
  return texto.slice(i, j)
}

// Uma função de topo do ficheiro: da assinatura (ex.: 'function ciclo') ao "}" que a fecha na coluna 0.
export const funcao = (fonte, assinatura) => `${corte(fonte, assinatura, '\n}\n', `a função ${assinatura}`)}\n}`
