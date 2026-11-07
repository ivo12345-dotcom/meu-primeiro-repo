# Bitcoin Puzzle — procura de chaves

Script educativo em Python (sem dependências) para o desafio público
"Bitcoin Puzzle" de 2015. A chave do puzzle **#n** está no intervalo
`[2^(n-1), 2^n - 1]`; o script percorre esse intervalo e compara o endereço
de cada chave com o endereço do puzzle. O alvo por omissão é o **#71**
(`1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU`, prémio ~7,1 BTC).

## Utilização

```bash
python3 bitcoin_puzzle.py --teste                     # verifica o código
python3 bitcoin_puzzle.py --puzzle 25                 # demo: resolve o #25 (~15 s)
python3 bitcoin_puzzle.py --puzzle 71 --benchmark 60  # mede a velocidade no seu PC
python3 bitcoin_puzzle.py --puzzle 71                 # procura aleatória
python3 bitcoin_puzzle.py --puzzle 71 --modo sequencial --inicio 0x4a0000000000000000
```

Opções: `--processos N` (núcleos a usar), `--bloco N` (chaves por tarefa),
`--endereco ADDR` (outro alvo). No modo sequencial o progresso fica em
`progresso_puzzle71.json` e é retomado automaticamente.

Se a chave for encontrada, é guardada em `ENCONTRADO_puzzle71.txt`
(já está no `.gitignore` — **nunca** faça commit desse ficheiro).

## Expectativas realistas

| Hardware | Velocidade aprox. | Tempo para percorrer o #71 |
|---|---|---|
| Este script, 4 núcleos | ~1 milhão chaves/s | ~37 milhões de anos |
| GPU de topo (KeyHunt-Cuda, VanitySearch) | ~5 mil milhões chaves/s | ~7 500 anos |

Na procura aleatória, cada hora dá uma probabilidade de acerto igual a
`chaves testadas / 1,18e21`. Para tentativas sérias use ferramentas de GPU
(open source, compiladas a partir do código) — e desconfie de "solvers"
vendidos ou distribuídos em grupos de Telegram.

## Se encontrar a chave

**Não envie a transação pela mempool pública.** Ao gastar, a chave pública
fica visível e bots calculam a chave privada em segundos (o intervalo é
pequeno) e roubam o prémio com uma taxa mais alta. Envie a transação
diretamente a um minerador/pool que aceite transações privadas.
