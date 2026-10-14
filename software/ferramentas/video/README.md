# Vídeo da demonstração do ecrã (só no portátil)

Grava o ecrã da roda a sério, com o SignalK do dev e o simulador a correr, seguindo um guião de páginas e toques, e
monta um MP4 com legendas gravadas na imagem e cartões (a polar, a AI, o estado).

```bash
cd software/dev && npm start                      # o SignalK do dev com o simulador navegar-demo
cd ../ferramentas/video
node gravar.mjs guiao.json pasta-gravada          # Chrome sem cabeça a 1024×600, ~6 imagens/s, cliques com realce laranja
python montar.py pasta-gravada ../../../docs/video/demonstracao-ecra.mp4   # legendas + cartões (cartoes.json) → MP4 e SRT
```

- `guiao.json`: a sequência (url, cliques por seletor CSS, esperas, condições `ate`, `segurar`) com a legenda e o
  capítulo de cada passo; os passos `slide` são cartões gerados pelo `montar.py` a partir de `cartoes.json`.
- O clique procura o botão outra vez no instante do toque (o ecrã redesenha as páginas a cada segundo) e dispara
  `pointerdown`/`pointerup`/`click` como um toque.
- `docs/video/polar-estimada.png` é o gráfico da polar de `software/arlequin-ecra/public/polar-arlequin.csv`
  (matplotlib), usado no cartão «A polar · 1 de 4».
- O MP4 e o SRT não vão para o git (`.gitignore`); as ferramentas, o guião e os cartões vão.
