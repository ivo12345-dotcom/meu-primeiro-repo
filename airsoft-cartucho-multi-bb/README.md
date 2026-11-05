# Cartucho multi-BB (ASG Dan Wesson 6 mm, CO2)

Modelo 3D **paramétrico** (OpenSCAD) de um cartucho que leva **várias BBs de 6 mm em fila**
em vez de uma só. Ficheiro: [`cartucho_multi_bb.scad`](cartucho_multi_bb.scad).

## Como funciona

O cano é de 6 mm, por isso as BBs não cabem lado a lado: ficam **em fila** dentro do
cartucho. O CO2 entra pelo furo da base, empurra a BB de trás e esta empurra as da frente.
Saem quase juntas, como um mini "chumbo".

```
 base (aro)                                   ponta com fendas
 ┌──┬──────────────┬─────────────────────────┬──┐
 │  │ canal de gás │   (O)   (O)   (O)       │<-│ lábio Ø5.70 segura as BBs
 └──┴──────────────┴─────────────────────────┴──┘
```

## Passo 1 — Medir um cartucho original

As medidas por defeito no ficheiro **são só exemplos**. Com um paquímetro, mede um cartucho
original e altera no topo do `.scad`:

| Parâmetro | O que medir |
|---|---|
| `comprimento_total` | da base do aro à ponta |
| `diametro_corpo` | diâmetro exterior do corpo |
| `diametro_aro` / `espessura_aro` | o aro (rim) da base |
| `diametro_canal_gas` | o furo central da base por onde entra o gás |
| `diametro_rebaixo` / `profundidade_rebaixo` | se a base tiver um O-ring de vedação |

Depois escolhe `numero_bbs` (2 ou 3 é o realista). Se não couberem, o OpenSCAD avisa.

## Passo 2 — Gerar o STL

1. Instala o [OpenSCAD](https://openscad.org) (grátis).
2. Abre `cartucho_multi_bb.scad` — podes mexer nos valores no painel *Customizer*.
3. `F6` para renderizar, `F7` para exportar o STL.

## Passo 3 — Imprimir

- **Resina (SLA) é o ideal** — precisão de ~0.05 mm. Usa resina *tough*/ABS-like; a
  standard é quebradiça e pode rachar com a pressão do CO2.
- **FDM** funciona com bico 0.2–0.4 mm, camada 0.1 mm, PETG ou nylon (evitar PLA), em pé,
  base para baixo. Aumenta `folga_camara` para 0.15–0.25.
- Imprime primeiro **um** cartucho e testa antes de fazer os seis.

## Afinar

- BB cai pela frente → diminui `diametro_labio` (ex.: 5.60).
- Custa muito a meter a BB / parte a ponta → aumenta `diametro_labio` ou o nº/comprimento das `fendas`.
- Cartucho não entra no tambor → reduz `diametro_corpo` 0.1 mm de cada vez.
- Fuga de gás pela base → usa o rebaixo + um O-ring igual ao do cartucho original.

## Avisos

- Cada BB sai **mais lenta** (a energia do disparo é dividida) e com **pouca precisão** —
  é um efeito "espingarda" para curta distância.
- Usa sempre **BBs de 0.20 g ou mais leves**, óculos de proteção e respeita os limites de
  potência (FPS) do campo e a legislação de airsoft em vigor.
- Testa em alvo antes de usar em jogo. Cartuchos mal impressos podem encravar o tambor.
