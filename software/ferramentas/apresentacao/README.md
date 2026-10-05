# Ferramentas da apresentação e dos PDFs (só no portátil)

Os scripts que fizeram o `docs/apresentacao-arlequin-2026-10-05.pdf` e as capturas de
`docs/img-apresentacao/` (05/10/2026). Correm no portátil, com o Chrome instalado (`CHROME=…` para
outro browser) e o SignalK do dev a correr para as capturas ao vivo.

| Ficheiro | O que faz |
|---|---|
| `capturar.mjs plano.json pasta` | Abre o ecrã da roda a sério (`http://localhost:3000/arlequin-ecra/…`) num Chrome sem cabeça a 1024×600, pelo protocolo DevTools, carrega nos botões que o plano diz e grava um PNG por estado. Usa o `ws` do `software/dev/node_modules` (correr primeiro `npm run instalar` em `software/dev`) |
| `plano-capturas.json` | O plano de 05/10: as 8 páginas de dia, o fluxo da Melhor rota (Pedir → Calcular → Resultado → Mapa → Ativar → Leme), 4 páginas de noite, e o Terminar do plano no fim |
| `plano-motor.json` | Espera que o motor do simulador esteja "a trabalhar" (até 28 min) e captura a página Motor |
| `medir.mjs ficheiro.html [largura] [limite]` | Mede a altura de cada `section.pag` do HTML da apresentação à largura útil de uma A4 deitada (1047 px) e diz quais passam dos 718 px (iam partir em duas ao imprimir) |
| `render-md.py origem.md saida.html saida.pdf "Título" [portrait\|landscape]` | Markdown → HTML (Segoe UI) → PDF pelo Chrome sem cabeça (precisa de `pip install markdown pymupdf`) |

Como se fez a apresentação:

```bash
cd software/dev && npm start            # o SignalK do dev, com o simulador navegar-demo
cd ../ferramentas/apresentacao
node capturar.mjs plano-capturas.json ../../../docs/img-apresentacao
node medir.mjs ../../../docs/apresentacao-arlequin-2026-10-05.html
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=../../../docs/apresentacao-arlequin-2026-10-05.pdf file:///…/docs/apresentacao-arlequin-2026-10-05.html
```

A captura do Leme a navegar (`docs/img-apresentacao/leme-a-navegar-ensaio.png`) não vem daqui: é o
estado de ensaio `leme-6-avisos` do `npm run verificar-ecra -- --capturas=pasta` (`software/arlequin-ecra`).

Depois das capturas, parar o servidor do dev e ver com `git status` se ele reescreveu
`software/dev/config` (repor com `git checkout -- software/dev/config`).
