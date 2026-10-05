# Projeto: Piloto Automático — Veleiro Jeanneau Melody 34

Notas de trabalho. Continuação de uma conversa anterior — lê este ficheiro
todo antes de responder para recuperares o contexto.

> **Decidido a 02/10/2026: Raymarine EV-100 de roda (Wheel), ref. T70152 — por comprar e
> instalar.** Palavras do Ivo: "Já decidi, é este que vou comprar." **Enquanto não estiver comprado
> e montado, continua a não haver piloto automático:** o ST4000+ que está a bordo **não governa**
> (falta a unidade de roda, §4) e só dá a proa (bússola fluxgate). A única reserva de governo é a
> **cana de emergência** (`LEME-EMERGENCIA.md`, Camada A). A decisão está no §3; as outras opções
> ficam como histórico (§3b). Os outros documentos remetem para esta página.

## 1. O barco

Os dados do barco (projeto, comprimento, deslocamento) estão no quadro "Dados do barco" do
`NAVEGACAO.md` (§0b), que é a referência. Para o piloto, conta isto:

- **Jeanneau Melody 34**, com **~6 t** de deslocamento leve (6000 kg na ficha técnica, 6 046 kg no
  sailboatdata) e **~7,2 t carregado** (6 046 kg + 20 %: gasóleo, água, equipamento, mantimentos).
  As primeiras notas desta página (07/09) diziam "projeto Briand, anos 80, ~10,4 m, 4,5–5 t"; o
  `LEME-EMERGENCIA.md` (27/09) corrigiu-as.
- **Governo por roda de leme**, sistema mecânico, **com travão** (Ivo, 29/09). O barco nasceu
  com cana; a cana de inox de emergência encaixa no topo da madre (`LEME-EMERGENCIA.md`, Camada A).
- Já comprado. É do proprietário.
- **Navegação prevista: muito a solo.** Isto é o fator dominante em todas as
  decisões abaixo — o piloto automático é tripulação, não conforto.

## 2. Estado do piloto existente

**MODELO CONFIRMADO POR FOTO (2026-09-10): Raytheon ST4000+, série
Autohelm.** Piloto de roda (*wheel pilot*): uma unidade fechada entre a consola e a roda, com uma
correia interna, e não uma cinta à volta da roda (ver o §4).

**O que fica dele com a decisão de 02/10:** o painel e a bússola fluxgate continuam a dar a **proa**
ao Pi pelo SeaTalk1 (`NAVEGACAO.md` §2). Quando o EV-100 estiver montado, a bússola EV-1 dele passa
a ser a fonte de proa principal e o ST4000+ fica de reserva. A unidade de roda do ST4000+ já não se
compra (era a opção A, agora histórico: §3b).

É a versão boa da família: tem **SeaTalk** e aceita entrada de GPS, o que
lhe dá **modo track** (segue rota, não só rumo de bússola). Bastante mais
capaz que o ST4000 simples.

**O que existe:**
- O **motor** da unidade de roda (com a engrenagem de latão, que é o pinhão da correia: §4) —
  solto dentro do porta-copos, perto da roda, um pouco acima do eixo.
- O **painel** e a **bússola fluxgate**, que funcionam (testados a 10/09), e a cablagem SeaTalk.

**O que falta** (§4): praticamente a unidade de roda toda — a chapa traseira, os roletes, o
*drive ring* (aro de acionamento) com o dentado interior, o manípulo da embraiagem, os grampos dos
raios e a tampa.

**A correia interna PODE já existir.** Foi encontrada a bordo uma correia dentada
âmbar, de dentes trapezoidais finos (poliuretano com cabos de aço, o tipo
certo). Só interessa se um dia se completar o ST4000+ (histórico, §3b): o teste era encostá-la ao
pinhão do motor e medir o passo (10 dentes a dividir por 10), o comprimento, a largura e o número de
dentes.

## ✅ TESTE PRINCIPAL: PASSOU (2026-09-10)

**O painel responde e o motor aciona nos dois sentidos.** Testado com
+1/-1 e +10/-10, ambos os lados. O sistema está vivo.

Na altura isto mudava a economia: um ST4000+ com painel e motor a funcionar vale uns €300–400 em
2.ª mão, e comprar a unidade de roda que falta (£100–250 em 2.ª mão) podia valer a pena. Foi a
opção A até 02/10 (histórico, §3b).

### Os outros dois testes

**A bússola fluxgate: feita a 10/09, lê bem** (o `NAVEGACAO.md` usa-a como fonte de proa, §2). O
teste era: em `auto` o visor mostra um rumo; **rodar a bússola devagar com as mãos** e o número
tem de acompanhar. Parado ou errático seria bússola morta.

**A embraiagem: só com a unidade de roda.** Segundo o §4, a embraiagem é o manípulo que aperta a
correia interna contra o pinhão, e faz parte da mecânica que falta. Com a decisão de 02/10 este
teste deixa de ser preciso.

### Nota histórica sobre o painel

Nas fotos está com o visor **muito riscado** e com dano nos bordos da
etiqueta — mas **funciona**. Painéis ST4000+ falham por entrada de água e
membrana rachada, e não há novos, só 2.ª mão. Vale a pena tratá-lo com
cuidado e protegê-lo da água: continua a ser a fonte de proa até haver o EV-1.

### A engrenagem de latão (o pinhão da correia, §4)

Está com **corrosão verde e massa ressequida**. Só interessa se um dia se completar o ST4000+
(histórico): limpar com pincel e desengordurante, ver se os dentes estão inteiros e meter massa
náutica nova.

**Nota de segurança** (escrita a 07/09, quando se julgava que era um sistema de cinta à volta da
roda): um piloto de roda fica por fora do governo — se falhar, perde-se o piloto mas não o governo
do barco. **Vale também para o EV-100:** depois de montado, confirmar que, com o piloto desengatado
(em *standby*), a roda roda livre e o travão da roda funciona como antes.

## 3. Piloto automático: decidido a 02/10 — Raymarine EV-100 Wheel (T70152)

**Decisão do Ivo (02/10/2026):** "Já decidi, é este que vou comprar." O piloto do Arlequin é o
**Raymarine EV-100 de roda (Wheel), ref. T70152**. **Estado: por comprar e instalar.**

**O que vem no pack T70152:** o comando **p70s**, o sensor de rumo **EV-1**, a unidade de controlo
**ACU-100**, a **unidade de roda** (o motor que vai na roda) e os **cabos SeaTalkNG**.

**Porquê este:** mantém-se a regra do Ivo de 27/09 — **o piloto tem de ser de roda**. Um atuador
abaixo do convés (o EV-200 com o Type 1, opção C) fica **excluído**: passa a histórico (§3b).

**Limitação (escrever e não esquecer):** a Raymarine dá o EV-100 Wheel para barcos até
**7 500 kg carregados**. O Melody anda pelos **~7,2 t carregado** (6 046 kg + 20 %, §1): fica
**perto do limite**. Na prática:
- **rizar cedo**: com pano reduzido e o barco equilibrado (pouco leme), o piloto trabalha
  folgado;
- com vento forte, mar de popa ou o barco desequilibrado, contar com o leme à mão;
- não carregar o barco mais do que o necessário (o gasóleo cheio, 200 L, já são ~170 kg a ré:
  `NAVEGACAO.md`, "Nível do gasóleo").

**Até estar comprado e montado:** **não há piloto.** Governa-se à mão, e a melhor rota conta as
horas ao leme assim (a regra das 8 h, `NAVEGACAO.md` §11). A única reserva de governo é a cana de
emergência (`LEME-EMERGENCIA.md`, Camada A).

**A seguir (fora da auditoria de 02/10, só depois de montado):**
- ligar o EV-100 à rede NMEA 2000 do Pi (o SeaTalkNG é NMEA 2000; `NAVEGACAO.md`, "Fase 2b"): o Pi
  passa a ler o estado do piloto e a proa do EV-1, e a mandar-lhe a rota ativa (modo *track*);
- rever a regra das 8 h ao leme da melhor rota, quando houver piloto montado e testado;
- o Recolher velas automático (`NAVEGACAO.md`, "Função Recolher velas"), que precisa de um piloto
  que aceite rumo do Pi.

**Energia:** um piloto de roda gasta em média 2–4 A; o balanço do `NAVEGACAO.md` (§5b e §5c, as
linhas "com EV-100") já conta com isso.

## 3b. Histórico: as opções que estavam lado a lado (até 02/10)

Ficam como registo. A 02/10 a F8a da auditoria juntou aqui os três planos que andavam em três
documentos — o `NAVEGACAO.md` comprava um EV-100 Wheel (28/09), esta página tinha um "plano
decidido" com o EV-200 (07/09) e o `LEME-EMERGENCIA.md` previa um EV-100 Tiller na cana de
emergência (27/09). No mesmo dia o Ivo decidiu: **a opção B** (§3).

| Opção | O que é | Custo | De onde vem | Notas |
|---|---|---|---|---|
| A. Completar o ST4000+ | Comprar a unidade de roda completa em 2.ª mão; o motor que está a bordo ficava de sobressalente (§4) | £100–250 (eBay UK) | Esta página, 10/09 | Aproveitava o que já funciona (painel, bússola, cablagem SeaTalk). **Marginal para ~6 t**: um remendo para o verão ("Nota de honestidade", a seguir ao §4). **Não escolhida** |
| **B. Raymarine EV-100 Wheel** | Piloto de roda novo, com a bússola EV-1 e o comando p70s, em SeaTalkNG (NMEA 2000) | a cotar no dia da compra | `NAVEGACAO.md`, "Ordem das compras" de 28/09 | **A escolhida a 02/10** (§3) |
| C. Raymarine EV-200 Sail + atuador Type 1 | Piloto abaixo do convés: o pack EV-200 Sail (p70s + EV-1 + ACU-200 + cablagem) e um atuador linear Type 1 de 12 V na mecha do leme | ~€3 450 s/IVA (pack €2 050,38 s/IVA no SVB + atuador ~€1 400–1 700 s/IVA) | Esta página, "plano decidido" de 07/09 | **Excluída** pela regra de 27/09 (tem de ser de roda) |
| D. Piloto de cana na cana de emergência (ex.: EV-100 Tiller) | Um piloto de cana que governa a cana de inox (Camada A) ou a do leme de painel (Camada B) | €250–700, usado a novo (`LEME-EMERGENCIA.md` §3.5) | `LEME-EMERGENCIA.md`, 27/09 | Não é o piloto do barco. Para governar sozinho o leme de emergência continua a ser a única maneira (o EV-100 Wheel governa a roda): fica como ideia do `LEME-EMERGENCIA.md`, não decidida |
| E. NKE Gyropilot 3 | O computador de piloto de topo, com modos polar, roll e rajada | ~€2 535 s/IVA só o computador; €6 000–9 000 o sistema completo | Esta página, 07/09 | A parte mecânica é abaixo do convés, como a C: **excluída** pela mesma regra |
| F. Piloto de vento (Hydrovane, Windpilot, Aries usado) | Governo pelo vento, sem energia; o Hydrovane tem leme próprio e serve também de leme de emergência (`LEME-EMERGENCIA.md` §3.6) | €1 500–4 500 | Esta página, 07/09 ("para o ano ou mais tarde") | Não funciona a motor nem com vento fraco: completa um piloto elétrico, não o substitui (§6). Fica para mais tarde |

**Fora do piloto, da mesma lista de 07/09:** o **AIS MOB pessoal**, antes da 1.ª saída a solo
(€250–350), e o **comando remoto sem fios** (€250–350), que só serve com um piloto.

**Como estava antes:** a 07/09, a ordem acordada com o proprietário era reparar já o Autohelm
(aro impresso + correia comprada, €60–250), o EV-200 com o Type 1 no inverno e o piloto de vento
para o ano — "elétrico primeiro, piloto de vento depois". A reparação com o aro impresso caiu a
10/09 (§4); a 27/09 o Ivo pôs a regra "tem de ser de roda"; a 02/10 decidiu o EV-100 Wheel.

### Notas de 07/09 sobre o EV-200 (opção C, excluída)

- O pack EV-200 Sail (p70s + EV-1 + ACU-200 + cablagem) **NÃO inclui o
  atuador**. Preço verificado a 07/09: €2 050,38 s/IVA no SVB.
- Atuador **Type 1** linear 12 V: ~€1 400–1 700 s/IVA (a confirmar por
  cotação — era o número menos firme).
- O Type 1 está especificado até 11 000 kg; com ~6 t a margem era de ~1,8×. (Esta nota dizia "o
  barco anda pelas 5 t, margem de mais do dobro", com o deslocamento errado de 07/09.)
- A parte mecânica (braço na mecha do leme, chumaceira, fundação do
  atuador) era agnóstica à marca; a NKE usava a mesma.

## 4. ⚠️ CORREÇÃO IMPORTANTE: como o ST4000 Wheel Drive funciona

**O mecanismo foi mal percebido durante boa parte deste projeto.** A ideia
de uma correia à volta da roda de leme, com um aro aparafusado aos raios,
está ERRADA. Confirmado pelo manual de serviço Raymarine.

**A arquitetura real** — é uma **unidade fechada** entre a consola e a roda:

- **Chapa de suporte traseira** fixa à consola, com **roletes**
- **Drive ring** (aro de acionamento) que **roda sobre esses roletes**
- **Correia dentada INTERNA** que liga o **pinhão do motor** ao aro — a
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

## Opção A (histórico): comprar a unidade de roda (*wheel drive*) completa em 2.ª mão

Não escolhida a 02/10 (§3). Fica o que se tinha apurado: no eBay UK, **"Autohelm ST4000 wheel
drive"** ou **"Raymarine ST4000 wheel drive unit"** aparecem com regularidade, **£100–250**. Muita
gente moderniza para EV-100 e vende o ST4000 antigo. As perguntas ao vendedor eram: o *drive ring*
roda suave nos roletes? o manípulo da embraiagem aperta e solta? vêm os grampos dos raios? foto da
correia interna.

## Nota de honestidade (sobre a opção A)

Mesmo completo, o ST4000+ continua a ser um piloto **marginal para ~6 toneladas** (§1): um
remendo para o verão, a motor e em navegação calma, não o piloto para travessias a solo. O EV-100
Wheel decidido vai até 7 500 kg carregado, mas também fica perto do limite (§3).

## 5. MEDIDAS AINDA ÚTEIS

1. ~~Etiqueta da unidade~~ — **RESOLVIDO: Raytheon ST4000+**
2. **Diâmetro da roda de leme**, **número de raios** e o **pedestal** (fotos de frente e de lado)
   — para confirmar, antes de comprar, que a unidade de roda do EV-100 se monta nesta roda.
3. **Onde ficam o p70s e o ACU-100** e por onde passa o cabo SeaTalkNG até à rede NMEA 2000 do Pi
   (`NAVEGACAO.md` §2b, "Portas da MacArthur").
4. ~~Passo da correia interna~~ e ~~fotos do paiol da popa~~ — eram para a opção A e para um
   atuador abaixo do convés (opções C e E): histórico.

## 6. Considerações a solo (não esquecer)

- **Orçamento elétrico:** um piloto de roda gasta em média 2–4 A: numa travessia de 24 h são
  50–100 Ah só de piloto. O solar decidido, 2 × 305 W (`NAVEGACAO.md` §5c), já conta com isto: com
  o EV-100, no verão fica perto do equilíbrio; fora do verão falta energia e é preciso o motor.
- **Comando remoto sem fios** é dos acessórios com melhor retorno para quem
  navega sozinho — corrige rumo a partir da proa.
- **Segurança:** com o piloto ligado, se cair à água o barco continua sem
  ele. Linha de vida e arnês ao sair do poço, corda de paragem do motor ao
  pulso na manobra, AIS MOB pessoal no colete.
- **Redundância** a prazo: piloto elétrico + piloto de vento. O de vento não
  consome energia mas **não funciona a motor nem com vento fraco** — os dois
  cobrem situações diferentes, não competem.

## 7. Próximo passo

1. Medidas do §5 (roda, raios, pedestal) e confirmar a compatibilidade da unidade de roda.
2. **Comprar o EV-100 Wheel (T70152)** e instalá-lo; testá-lo sozinho, primeiro no porto e
   depois em águas calmas, antes de contar com ele.
3. Só depois: a integração com o Pi e a revisão da regra das 8 h (§3, "A seguir").

### Envio para a impressora (ficou do plano de impressão)

**O envio de gcode para a K2 já está montado no PC do proprietário e
funciona.** Numa sessão local (com shell na máquina dele) o fluxo completo
é possível: desenhar -> gerar STL -> fatiar -> enviar para a impressora.
Ao abrir no PC, procurar o método já em uso — envio pela API do
Moonraker, Creality Print, ou pasta vigiada pela impressora — e usar esse,
em vez de assumir que não há acesso.

A limitação existe apenas em sessões remotas (Claude Code na web), que
não alcançam a rede local. Não confundir as duas situações.
