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

**MODELO CONFIRMADO POR FOTO (2026-09-10): Raytheon ST4000+, série
Autohelm.** Wheel pilot de cinta.

É a versão boa da família: tem **SeaTalk** e aceita entrada de GPS, o que
lhe dá **modo track** (segue rota, não só rumo de bússola). Bastante mais
capaz que o ST4000 simples.

Procurar peças com o nome exato: **"Autohelm ST4000+ wheel drive"**.

**O que existe:**
- A unidade motora (motor + caixa + embraiagem) — solta dentro do
  porta-copos, perto da roda, um pouco acima do eixo.
- Alegadamente o resto do sistema está operacional (afirmação do vendedor,
  **não verificada** — um painel que acende não prova que o motor governa).

**O que falta:**
- O **aro dentado** que aperta aos raios da roda de leme.
- Os **grampos** de fixação do aro aos raios.
- Possivelmente o suporte/pino de fixação na consola.

**Procurar em 2ª mão ANTES de imprimir.** eBay UK, "Autohelm ST4000+ wheel
drive". Se aparecer por €100–150, é mais rápido e mais garantido do que
imprimir.

**A correia PODE já existir.** Foi encontrada a bordo uma correia dentada
âmbar, de dentes trapezoidais finos (poliuretano com cabos de aço, o tipo
certo). **Teste decisivo:** encostar à polia do motor — se engrenar
certinho, sem folga e sem forçar, é a correia.

Se engrenar, medir: **passo** (medir 10 dentes e dividir por 10, não um
só), **comprimento total**, **largura**, **número total de dentes**. Com o
passo e o comprimento fecha-se a geometria do aro — deixa de se estimar.

Se estiver rachada na base dos dentes ou com cabos à vista, não faz mal:
com o passo identificado, compra-se nova por €10–20 num fornecedor de
transmissões.

## ✅ TESTE PRINCIPAL: PASSOU (2026-09-10)

**O painel responde e o motor aciona nos dois sentidos.** Testado com
+1/-1 e +10/-10, ambos os lados. O sistema está vivo.

Isto muda a economia: um ST4000+ com painel e motor a funcionar vale uns
€300–400 em 2ª mão. Investir €100–150 no aro, ou uma tarde a imprimir,
passa a ser claramente rentável.

### Dois testes que faltam

**A embraiagem.** Passar de `standby` para `auto` e ouvir — deve dar um
**clique** claro. Em `standby` o eixo de saída roda livre à mão; em `auto`
tem de resistir. Se não engatar, o motor roda mas não transmite, e a peça a
substituir é outra.

**A bússola fluxgate.** Em `auto` o visor mostra um rumo. **Rodar a bússola
devagar com as mãos** — o número tem de acompanhar. Parado ou errático =
bússola morta, e o piloto nunca governa por melhor que esteja a mecânica.

### Nota histórica sobre o painel

Nas fotos está com o visor **muito riscado** e com dano nos bordos da
etiqueta — mas **funciona**. Painéis ST4000+ falham por entrada de água e
membrana rachada, e não há novos, só 2ª mão. Vale a pena tratá-lo com
cuidado e protegê-lo da água.

**2. A engrenagem de latão da saída do motor.** Está com **corrosão verde e
massa ressequida**. Limpar com pincel e desengordurante, ver se os dentes
estão inteiros e sem desgaste, e meter massa náutica nova. É a saída de
força — se estiver comida, o resto não interessa.

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

## 4. ⚠️ CORREÇÃO IMPORTANTE: como o ST4000 Wheel Drive funciona

**O mecanismo foi mal percebido durante boa parte deste projeto.** A ideia
de uma correia à volta da roda de leme, com um aro aparafusado aos raios,
está ERRADA. Confirmado pelo manual de serviço Raymarine.

**A arquitetura real** — é uma **unidade fechada** entre a consola e a roda:

- **Chapa de suporte traseira** fixa à consola, com **roletes**
- **Drive ring** (aro de acionamento) que **roda sobre esses roletes**
- **Correia dentada INTERNA** ligando o **pinhão do motor** ao aro — a
  correia não passa pela roda de leme
- **Manípulo da embraiagem aperta a correia contra o pinhão** para agarrar
- **A roda de leme aparafusa-se ao aro**, através de grampos nos raios

A engrenagem de latão vista na unidade **é o pinhão da correia**. A correia
âmbar encontrada a bordo (perfil tipo distribuição de automóvel) é quase de
certeza a correia interna.

Fontes: [lista de peças](https://www.manualslib.com/manual/1199211/Raymarine-St4000Plus.html?page=17),
[manual de serviço](https://www.manualslib.com/manual/2496479/Autohelm-St4000Plus.html)

## ⚠️ A IMPRESSÃO 3D SAI DO PLANO

**O proprietário tem só o motor.** Falta a chapa traseira, os roletes, o
drive ring com dentado interior, o manípulo de embraiagem, os grampos dos
raios e a tampa — praticamente o produto todo.

Fabricar isso em plástico impresso, com o binário do governo a passar por lá
e a roda de leme montada em cima, seria um projeto de engenharia com
resultado incerto. **Não é o fim de semana tranquilo descrito antes.**

Toda a estratégia de impressão anterior (ASA, PA-CF, segmentação, arco de
teste, medidas da polia e da roda) fica **obsoleta** e foi removida.

## SOLUÇÃO: comprar wheel drive completo em 2ª mão

Procurar no eBay UK: **"Autohelm ST4000 wheel drive"** ou **"Raymarine
ST4000 wheel drive unit"**. Aparecem com regularidade, **£100–250**. Muita
gente moderniza para EV-100 e vende o ST4000 antigo.

**Boa posição de partida:** já se tem o caro — painel a funcionar, bússola
fluxgate a ler, cablagem SeaTalk. Falta só a mecânica. O motor atual fica de
**sobressalente**, que num equipamento fora de produção vale bastante.

**Perguntar ao vendedor:**
1. O **drive ring roda suave** nos roletes?
2. O **manípulo da embraiagem** aperta e solta?
3. Vêm os **grampos dos raios**?
4. Foto da **correia interna** (se estiver rachada não faz mal — compra-se
   por €10–20 num fornecedor de transmissões, com o passo medido)

## Nota de honestidade que se mantém

Mesmo completo, continua a ser um piloto **marginal para 5 toneladas**. Por
€200 é um excelente remendo que dá o verão e liberta as mãos a motor e em
navegação calma. **Não é o piloto para travessias a solo** — esse continua a
ser o EV-200 abaixo do convés, quando o orçamento respirar.

## 5. MEDIDAS AINDA ÚTEIS

Já não são para desenhar peças (ver secção 4), mas continuam a servir:

1. ~~Etiqueta da unidade~~ — **RESOLVIDO: Raytheon ST4000+**
2. **Passo da correia interna** — medir 10 dentes e dividir por 10. Serve
   para comprar correia nova se a existente estiver rachada.
3. **Diâmetro da roda de leme** e **número de raios** — para confirmar
   compatibilidade do drive ring que se comprar.
4. **Fotos do paiol da popa** (para o projeto do EV-200):
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
