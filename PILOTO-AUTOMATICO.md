# Projeto: Piloto Automático — Veleiro Jeanneau Melody 34

Notas de trabalho. Continuação de uma conversa anterior — lê este ficheiro
todo antes de responder para recuperares o contexto.

## 1. O barco

- **Jeanneau Melody 34** (projeto Briand, anos 80, ~10,4 m).
- Deslocamento aproximado: **4,5–5 toneladas**.
- **Governo por roda de leme**, sistema mecânico.
- Já comprado. É do proprietário.
- **Navegação prevista: muito a solo.** Isto é o fator dominante em todas as
  decisões abaixo — o piloto automático é tripulação, não conforto.

## 2. Estado do piloto existente

Piloto **Autohelm** de roda (wheel pilot de cinta). A marca Autohelm
desapareceu por volta de 2001 (passou a Raymarine), portanto a unidade tem
no mínimo 25 anos. Modelo provável: ST3000, ST4000 ou ST4000+.

**O que existe:**
- A unidade motora (motor + caixa + embraiagem) — solta dentro do
  porta-copos, perto da roda, um pouco acima do eixo.
- Alegadamente o resto do sistema está operacional (afirmação do vendedor,
  **não verificada** — um painel que acende não prova que o motor governa).

**O que falta:**
- O aro dentado que aperta aos raios da roda de leme.
- A correia dentada.
- Possivelmente o suporte/pino de fixação na consola.

**Nota de segurança:** o sistema de cinta é externo ao leme. Se falhar,
perde-se o piloto mas não o governo do barco. Falha benigna — daí ser
aceitável experimentar peças impressas aqui.

## 3. Plano decidido

Ordem acordada com o proprietário:

| Quando | O quê | Custo |
|---|---|---|
| Já | Reparar o Autohelm (aro impresso + correia comprada) | €60–250 |
| Antes da 1ª saída a solo | AIS MOB pessoal | €250–350 |
| Inverno, barco em seco | Raymarine EV-200 Sail pack + atuador Type 1 | ~€3.450 s/IVA |
| Quando der | Comando remoto sem fios | €250–350 |
| Para o ano ou mais tarde | Piloto de vento (Hydrovane / Windpilot / Aries usado) | €1.500–4.500 |

**Elétrico primeiro, piloto de vento depois** — confirmado pelo proprietário.

### Notas sobre a compra do EV-200

- O pack EV-200 Sail (p70s + EV-1 + ACU-200 + cablagem) **NÃO inclui o
  atuador**. Preço verificado: €2.050,38 s/IVA no SVB.
- Atuador **Type 1** linear 12 V: ~€1.400–1.700 s/IVA (a confirmar por
  cotação — é o número menos firme).
- **Não sobredimensionar para Type 2:** o Type 1 está especificado até
  11.000 kg e o barco anda pelas 5 t. Margem de mais do dobro já.
- A parte mecânica (braço na mecha do leme, chumaceira, fundação do
  atuador) é agnóstica à marca. Fazer bem uma vez; se um dia se quiser
  saltar para NKE, troca-se só o cérebro.
- Alternativa de topo, se algum dia o orçamento permitir: **NKE Gyropilot
  3** (~€2.535 s/IVA só o computador, €6.000–9.000 sistema completo) — é a
  referência em navegação a solo, com modos polar, roll e rajada.

## 4. Reparação do Autohelm — peças impressas

**Impressoras disponíveis: Creality K2 Plus e K2 Pro.**
(Especificações da K2 Pro por confirmar com o proprietário: volume de
construção e se é fechada.)

### Materiais
- **Aro dentado: ASA.** Estável aos UV, aguenta o calor do poço ao sol.
  Imprimir na K2 Plus fechada.
- **Grampos dos raios: PA-CF** (nylon com fibra de carbono) — é a peça que
  leva todo o binário. Exige **bico endurecido** e **filamento seco**.
- **PLA está fora de questão** (deforma ao sol). PETG só como recurso —
  sofre de fluência sob carga contínua.
- A correia **compra-se**, não se imprime. Se o perfil for normalizado
  (tipo HTD), qualquer fornecedor de transmissões a tem por €10–20.

### Estratégia de impressão
- **Orientação:** aro deitado na mesa, camadas horizontais. Assim o esforço
  do dente fica no plano da camada. Impresso de pé, os dentes rompem na
  adesão entre camadas.
- **Segmentação:** o aro não cabe na mesa. Dividir de modo a que a corda de
  cada segmento fique abaixo de ~330 mm (ou ~460 mm na diagonal da mesa).
  Fórmula: `corda = diâmetro × sin(180°/n)`.
- As **juntas devem cair entre dentes**, nunca a meio de um dente.
- Ligações **sobrepostas (escarva)** com parafusos inox a atravessar, não
  topo a topo.
- **Arco de teste primeiro:** imprimir só ~60° de arco com meia dúzia de
  dentes, comprar a correia, e verificar a engrenagem antes de lançar a
  peça completa. Ajustar a folga do perfil do dente nesse arco.
- Grampos: generosos, sobredimensionados, com parafusos metálicos a
  atravessar. Não há restrição de peso.

## 5. MEDIDAS EM FALTA — pedir ao proprietário

Nada se desenha sem isto:

1. **Etiqueta da unidade Autohelm** — modelo e part number (ST3000 /
   ST4000 / ST4000+ / ST5000+). Fotografar.
2. **Polia de saída do motor** — número de dentes e passo (distância entre
   centros de dois dentes consecutivos). Fotografar de perto com régua ou
   paquímetro ao lado. **É daqui que sai tudo o resto.**
3. **Diâmetro da roda de leme** e **número de raios**.
4. **Secção do raio** (largura × espessura) onde os grampos vão apertar.
5. **Distância do eixo da roda ao eixo da polia do motor** — define o
   comprimento da correia.
6. **Fotos do paiol da popa** (para o projeto do EV-200):
   - Setor/quadrante do leme visto de cima, com a mecha visível.
   - Espaço lateral para um atuador de ~60 cm, e o que lá está
     (mangueiras, cablagem, depósito).
   - Estrutura à volta: anteparas, longarinas, o que houver de sólido para
     fixar a chumaceira.
   - Uma foto afastada do paiol todo, para perceber a geometria.

## 6. Considerações a solo (não esquecer)

- **Orçamento elétrico:** um atuador abaixo do convés puxa 2–5 A de média.
  Numa travessia de 24 h são 50–100 Ah só de piloto. Painel solar de
  100–200 W deixa de ser luxo.
- **Comando remoto sem fios** é dos acessórios com melhor retorno para quem
  navega sozinho — corrige rumo a partir da proa.
- **Segurança:** com o piloto ligado, se cair à água o barco continua sem
  ele. Linha de vida e arnês ao sair do poço, corda de paragem do motor ao
  pulso na manobra, AIS MOB pessoal no colete.
- **Redundância** a prazo: piloto elétrico + piloto de vento. O de vento não
  consome energia mas **não funciona a motor nem com vento fraco** — os dois
  cobrem situações diferentes, não competem.

## 7. Próximo passo

Assim que chegarem as medidas do ponto 5: desenhar o aro e os grampos
(paramétricos, para se poder afinar a folga do dente), gerar STL, e definir
os parâmetros de fatiamento para ASA e PA-CF na K2 Plus.

### Envio para a impressora

**O envio de gcode para a K2 já está montado no PC do proprietário e
funciona.** Numa sessão local (com shell na máquina dele) o fluxo completo
é possível: desenhar -> gerar STL -> fatiar -> enviar para a impressora.
Ao abrir no PC, procurar o método já em uso — upload para a API do
Moonraker, Creality Print, ou pasta vigiada pela impressora — e usar esse,
em vez de assumir que não há acesso.

A limitação existe apenas em sessões remotas (Claude Code na web), que
nao alcançam a rede local. Não confundir as duas situações.
