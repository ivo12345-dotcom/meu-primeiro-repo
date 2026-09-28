# Sistema de navegação integrado (Jeanneau Melody 34)

Ver também `PILOTO-AUTOMATICO.md`, `LEME-EMERGENCIA.md`.
Criado a 28/09/2026. Estado: **desenho aprovado**. As ligações aparelho a
aparelho ficam por fechar até haver fotos (ver §8).

## 0. Objetivo

Toda a eletrónica de bordo num **só ecrã tátil na roda de leme**, com os dados
**sobrepostos a uma carta náutica** (tipo Navionics): AIS, vento,
profundidade, radar e rota enviada ao piloto.

A eletrónica que existe a bordo: **anemómetro, plotter, radar, VHF, AIS,
Navtex** e o piloto **ST4000+** (SeaTalk1). Das marcas e modelos ainda não se
sabe nada.

Navegação sobretudo **a solo**. Isto obriga a manter uma reserva (ver §6).

## 1. Decisões tomadas

| Tema | Decisão | Porquê |
|---|---|---|
| Cérebro | **Raspberry Pi 5 8 GB com OpenPlotter** | Traz OpenCPN e SignalK prontos a usar. Consumo baixo e custo baixo |
| Interfaces | **MacArthur HAT** (€60) | Uma placa com NMEA 2000, NMEA 0183 e SeaTalk1 |
| Programa de carta | **OpenCPN** | É o único que junta todos os dados por cima da carta (ver §3) |
| Cartas | **o-charts "Portugal"** (oeSENC, €16 s/IVA) | Oficiais do Instituto Hidrográfico: continente, Açores e Madeira. Até 5 aparelhos |
| Navionics | **Fica no telemóvel**, como segunda carta | Lê o Wi-Fi do Pi (posição, profundidade e AIS) |
| Ecrã (fase 1, testes) | **Waveshare 7" HDMI LCD (C)** (€56,90) | Barato, HDMI + USB como o definitivo. Serve para provar o sistema |
| Ecrã (fase 2, definitivo) | **SailProof STS10, 10"** (€499) | Só se a fase 1 correr bem. 1500 nits, IP65, toque com água e luvas |
| Suporte | **Impresso em ASA**, com pala e tampa | O PETG degrada-se ao sol. O ASA foi feito para o exterior |

### Porque é que a Navionics não é o ecrã principal

A app Navionics Boating aceita dados por Wi-Fi (NMEA 0183 por TCP e UDP), mas
só usa **posição, profundidade e AIS**:
- **Não mostra vento nem radar** e não controla o piloto.
- O AIS é fraco: tem poucos vetores de rumo, **não tem CPA/TCPA** e não tem
  lista de alvos. A solo, o alarme de aproximação é o que interessa.
- As cartas Navionics são encriptadas e **não abrem no OpenCPN**.

Fontes: [Yacht Devices](https://www.yachtd.com/news/navonics_app_sonarchart_live.html),
[Panbo](https://panbo.com/navionics-boating-app-ais-feature/),
[Garmin](https://support.garmin.com/en-US/?faq=hQ42kBSysV7VpOAPaqOwj7).

## 2. Arquitetura

```
 NO POÇO (roda de leme)                 DENTRO (seco, perto do quadro)
 ┌──────────────────────┐   HDMI+USB   ┌──────────────────────────────────┐
 │ Ecrã tátil (7" → 10")│◄────────────►│ Raspberry Pi 5 + SSD NVMe         │
 │ suporte ASA + pala   │  (2 + 1,5 m) │ OpenPlotter: OpenCPN + SignalK    │
 └──────────────────────┘              │ MacArthur HAT                     │
                                       │  ├ NMEA 2000 ◄► (futuro EV-100)   │
 Plotter atual (reserva) ◄─────────────┤  ├ 0183 IN ×2 ◄── AIS, VHF, Navtex│
 ST4000+ ◄── rota (0183 OUT) ──────────┤  ├ 0183 OUT ×2 ──► piloto/plotter │
 Anemómetro ── (conforme a foto) ──────┤  └ SeaTalk1 IN ◄── ST4000+        │
 Radar ── Ethernet (se suportado) ─────┤                                   │
                                       │ Wi-Fi ──► telemóvel (Navionics)   │
                                       └────────── 12 V com fusível ──────┘
```

**Como circulam os dados:** cada aparelho fala a sua língua. O SignalK junta
tudo num formato só. O OpenCPN lê o SignalK e desenha tudo por cima da carta.
O SignalK também emite NMEA 0183 por Wi-Fi para a Navionics e para qualquer
outra app.

### Limites da MacArthur HAT (a ter em conta)

- **SeaTalk1 só entra.** O Pi lê o ST4000+ mas não lhe escreve por SeaTalk.
  A rota vai por uma **saída NMEA 0183** para a entrada NMEA do piloto.
  **Confirmar no manual do ST4000+ os terminais NMEA IN e as frases que ele
  aceita** (normalmente APB/RMB/XTE).
- As saídas 0183 e o NMEA 2000 **não são isolados**. O Pi e os instrumentos
  têm de ter o **mesmo negativo** no quadro, para não haver loops de terra.
- Só há **2 entradas 0183**. AIS, VHF, Navtex e anemómetro podem ser mais do
  que 2 fontes. Se for o caso, usar um multiplexer, um adaptador USB-0183
  extra, ou ligar a cadeia através do AIS (muitos AIS têm entrada de
  multiplexer). Fecha-se com as fotos.

### O ST4000+ como bússola (mesmo sem a parte mecânica)

O **painel e a bússola fluxgate do ST4000+ funcionam** (testados a 10/09).
Mesmo sem a unidade de roda, o painel ligado **põe a proa magnética no
barramento SeaTalk1**. A MacArthur HAT lê-a, o SignalK converte-a e o OpenCPN
passa a ter a **proa**. Custo zero.

- **Proa ≠ rumo.** O **rumo** (COG) vem do GPS e diz para onde o barco está a
  andar. A **proa** vem da bússola e diz para onde a proa aponta. Com corrente
  ou abatimento são diferentes, e a solo essa diferença é informação útil.
- **Sem proa não há vento verdadeiro correto.** O SignalK precisa da proa para
  calcular a direção do vento verdadeiro a partir do anemómetro.
- **O radar sobreposto à carta também precisa de proa.** A proa de uma
  fluxgate dos anos 90 pode ser lenta para isso. **Testar:** se a imagem do
  radar "arrastar" nas viragens, é preciso uma bússola mais rápida. Uma
  bússola eletrónica NMEA 2000 fica na lista condicional.
- **Calibrar a bússola** com o próprio painel (o modo de calibração faz-se a
  motor, em círculos lentos). O painel calibra a bússola sem precisar do
  motor do piloto.
- A fluxgate tem de ficar **longe de ferro e de cabos com corrente** (o motor,
  as colunas de som, o próprio ecrã novo). Confirmar onde está montada.
- Quando o EV-100 chegar, o sensor dele (EV-1) passa a ser a bússola
  principal, e o ST4000+ fica como reserva.

Fontes: [MacArthur HAT, documentação](https://macarthur-hat-documentation.readthedocs.io/),
[loja OpenMarine](https://shop.openmarine.net/home/23-macarthur-hat.html),
[OpenPlotter](https://openmarine.net/openplotter).

## 2b. Inventário identificado por fotos (28/09)

| Aparelho | Modelo | Ligação de dados | Papel no sistema |
|---|---|---|---|
| **AIS** | **em-trak B330**, classe B, **transponder** (emite e recebe), GPS próprio, Wi-Fi | **NMEA 2000**, NMEA 0183 (38 400 baud), USB, Wi-Fi | **Fonte de AIS e de GPS.** Liga à porta **N2K** da MacArthur |
| Anemómetro | **NASA Clipper Wind** | V2: o topo do mastro envia **MWV em NMEA 0183**. V1 (5 fios, analógica): só com cabo NMEA opcional | Vento → 0183 IN 1 |
| Log | **NASA Clipper Log** | Versões com NMEA dão **VHW + VLW** (velocidade e distância) | Velocidade na água → 0183 IN 2 |
| Radar | **JRC Radar 1000** (LCD monocromático 6", até 16 MN) | Só **entrada** NMEA 0183 (GPS e bússola) | **Fica autónomo.** Não é suportado pelo radar_pi nem pelo Axiom |
| Plotter | **Garmin GPSMAP 421** (GPS interno) | NMEA 0183 porta 1 + NMEA 2000 (conector próprio) | Plotter e **GPS de reserva** |
| VHF | **Navicom RT750** (DSC classe D) | NMEA 0183 (entrada de GPS para o DSC) | Recebe posição. O AIS já vem do B330 |
| Navtex | **NASA Target Navtex Pro** | **Nenhuma saída de dados** confirmada | **Fica autónomo** |
| Sonda | **NASA Clipper Depth** | Versões com NMEA dão **DBT/DPT** (profundidade) | Profundidade → 3.ª entrada 0183 (ver abaixo) |
| Bússola repetidora | **Autohelm ST50 Compass** (SeaTalk1) | **SeaTalk1** (mesmo barramento do ST4000+) | Segunda fonte de proa, entra na SeaTalk1 IN |
| Piloto | Raytheon ST4000+ | SeaTalk1 (+ entrada NMEA a confirmar) | Proa; recebe a rota |

**O que muda:**
- **O AIS é um transponder B330 com NMEA 2000 e Wi-Fi.** Entra na MacArthur
  pela porta N2K (cabo adaptador) e traz também o **GPS**. As duas entradas
  0183 ficam livres para o vento e o log.
- **Teste que se pode fazer já, sem comprar nada:** ligar o telemóvel ao
  **Wi-Fi do B330** e configurar a Navionics (ou o OpenCPN Android) para ler
  AIS e GPS por TCP/UDP. O B330 tem de estar ligado e com MMSI programado.
- **O radar sai do ecrã único.** O JRC 1000 usa um protocolo fechado e só
  aceita dados. A saída 0183 da MacArthur pode dar-lhe posição e proa (para a
  marcação verdadeira).
- **O Axiom não mostrará este radar.** Radar no Axiom = radar Raymarine novo.
- **NASA V1 ou V2?** Ver as costas do Clipper Wind e do Clipper Log (número de
  fios, se há fio NMEA). Se não houver saída NMEA, a NASA vende cabos e
  conversores.

**Portas da MacArthur (proposta):**

| Porta | Liga a |
|---|---|
| **NMEA 2000** | **em-trak B330** (AIS + GPS); depois o EV-100, o GPSMAP 421 e o Axiom |
| 0183 IN 1 | NASA Clipper Wind (MWV), 4 800 baud |
| 0183 IN 2 | NASA Clipper Log (VHW/VLW), 4 800 baud |
| **USB–0183 (novo)** | NASA Clipper Depth (DBT/DPT), 4 800 baud |
| 0183 OUT 1 | Radar JRC 1000 + entrada GPS do RT750 (a mesma saída alimenta 2–3 recetores) |
| 0183 OUT 2 | **Livre por agora.** O ST4000+ não tem a parte mecânica, por isso não há rota para lhe enviar. Fica reservada para quando houver unidade de roda |
| SeaTalk1 IN | Barramento SeaTalk1: ST4000+ e ST50 Compass (proa) |

**Os três NASA (vento, log e sonda) precisam de 3 entradas 0183 e a MacArthur
só tem 2.** Juntar um **adaptador USB–NMEA 0183 (RS-422, isolado)** no Pi
para a sonda (a cotar). Alternativa: ligar a sonda à entrada 0183 do B330,
se este aceitar 4 800 baud (confirmar no manual).

**Compras que o inventário acrescenta (a cotar):**
- **Adaptador USB–NMEA 0183** (RS-422, de preferência isolado), para a sonda.
- **Mini-rede NMEA 2000** para ligar o B330 à MacArthur: cabo de derivação
  (micro-C), 2 T, **2 terminadores de 120 Ω** e **alimentação da rede a 12 V**
  (a porta N2K da MacArthur não alimenta o barramento; o B330 precisa dele
  alimentado). Um kit inicial N2K resolve tudo, e é a mesma rede que depois
  recebe o EV-100 e o Axiom.

**Dados do motor: DECIDIDO pô-los na rede (28/09).** O YDEG-04 põe no NMEA 2000,
a partir do EVC: rotações, temperatura da água, pressão do óleo, horas,
tensão da bateria e **códigos de alarme do motor**; e ainda temperatura do
óleo e consumo, se o motor os medir. O **nível do gasóleo não** vem do EVC,
porque o medidor é analógico.

**O que o D1-20B dá de facto (manual do YDEG-04, 28/09):** o D1 é um diesel
mecânico com uma caixa **MDI** e **poucos sensores**. Segundo o manual:
- **Valores:** rotações, horas do motor, tensão da bateria e temperatura da
  água (o que o MDI publica; confirmar ao ligar).
- **Alarmes** (mensagem própria do MDI, que o YDEG-04 traduz para NMEA 2000):
  **sobreaquecimento**, **pressão de óleo baixa**, **tensão baixa da bateria**,
  **pré-aquecimento ligado**, **motor a parar**, **avaria de cablagem** e
  alarme auxiliar (estes dois configuráveis).
- **Não há valor de pressão do óleo**, só o alarme (o D1 tem um pressóstato,
  não um sensor).
- **Não há consumo real.** O YDEG-04 pode **estimar** o consumo a partir das
  rotações (`FUEL_RATE_FAKE`, calibrável) — dá para uma ideia de autonomia.
- **Nível do gasóleo:** não (o medidor é analógico, fora do MDI).
- **Ligação:** à **porta Multilink da caixa MDI** ou **em série com o
  conta-rotações EVC**. Configuração `PROTOCOLS=J1939,MDI` (vem assim de
  fábrica).

### Alternativa DIY ao YDEG-04: o motor ligado diretamente ao Pi (28/09)

O MDI do D1 fala **J1939 em CAN**, e os valores usam PGN **normais** do J1939.
Já existe um projeto aberto que os lê num D1/D2 com MDI
([VolvoPenta-N2K_Interface](https://github.com/buhhe/VolvoPenta-N2K_Interface),
[descrição](https://open-boat-projects.org/en/volvo-penta-nmea2000-interface/)):

| PGN J1939 | Dado | Descodificação (do projeto) |
|---|---|---|
| 61444 | Rotações | `(Data[4]*256 + Data[3]) / 8` |
| 65253 | Horas do motor | `(Data[0] + Data[1]*256) / 20` |
| 65262 | Temperatura da água | `Data[0] − 40` (°C) |
| 65271 | Tensão do alternador | `(Data[7]*256 + Data[6]) / 20` (V) |

**Como ligar ao Pi:**
- Um **adaptador USB–CAN** compatível com Linux (firmware candleLight/gs_usb,
  de preferência **isolado**; ~€25–50, a cotar). Aparece como `can1` e fica
  separado do `can0` da MacArthur (a rede NMEA 2000).
- **NUNCA** ligar o barramento do motor ao CAN da MacArthur. São redes
  diferentes, e misturá-las pode perturbar o motor e a rede N2K.
- Pôr o adaptador em modo **só escuta** (`listen-only`): não envia nada nem
  confirma mensagens, por isso não interfere com o motor.
- Descodificar os 4 PGN no **Node-RED** (vem com o OpenPlotter) ou num plugin
  do SignalK, e publicar como `propulsion.main.*`.
- **Cabo em Y feito por nós:** ficha Deutsch **DT04-6P** + **DT06-6S** e uma
  derivação, em série entre o MDI e o conta-rotações.
- **Pinos (segundo o projeto aberto): 2 = CAN L, 5 = CAN H, 4 = massa,
  6 = +12 V; 1 e 3 sem uso.** ⚠️ O manual do YDEG-04 fala em **dois troços
  de CAN** nesta ficha (pinos 1/2 e 3/5). **Confirmar com o multímetro antes
  de ligar:** 60–120 Ω entre CAN H e CAN L com tudo desligado.
- **Primeiro teste:** `candump can1` com a ignição ligada. Ver que
  identificadores aparecem antes de escrever qualquer descodificação.

**O que se perde face ao YDEG-04:** os **alarmes do MDI** (sobreaquecimento,
óleo, bateria) vêm numa mensagem **própria da Volvo** (PGN 65417), que o
projeto aberto não descodifica. Dá para os descobrir: com a **ignição ligada
e o motor parado**, os alarmes de óleo e de carga ficam ativos, e isso permite
ver que bits mudam. Até lá, o Pi pode criar os próprios alarmes a partir dos
valores (temperatura alta, tensão baixa).

### Nível do gasóleo (depósito de 200 L), decidido 28/09

O medidor do painel é **analógico**: uma boia com uma **resistência variável**
(sonda) dentro do depósito, ligada por um fio ao medidor. Não passa pelo MDI.

**Como o Pi o lê:**
- **ADS1115** (conversor analógico–digital I²C, ~€5–10) ligado ao conector I²C
  da MacArthur. O **OpenPlotter suporta-o de raiz** (app I2C) e tem **modo
  ohmímetro** com resistência fixa e divisor de tensão.
- Ligação **em paralelo e sem cortar nada**: ler a **tensão no fio da sonda**
  (entre o terminal da sonda no medidor e a massa), com um **divisor de
  tensão** para baixar 12 V para a gama do ADS1115. O medidor do painel
  continua a funcionar igual.
- Publica em `tanks.fuel.0.currentLevel` → OpenCPN, telemóvel, alarme de
  reserva.
- **Primeiro medir a sonda** com o multímetro: a norma europeia é
  **10–180 Ω** e a americana **240–33 Ω**. O valor define o divisor.

**Onde está (28/09):** ao lado do motor e ao lado da cama da cabine de popa
(estibordo). Parece ter sido **prolongado para trás**, o que explica os 200 L
contra os 90 L de origem. Consequências:
- **A forma é irregular e o braço da boia é provavelmente o original.** A
  leitura não é linear e pode "bater" nos extremos (cheio ou vazio antes do
  tempo). É por isso que o dono anterior desenhou as quantidades no
  medidor, e é essa tabela que se usa.
- O fio da sonda até à mesa de navegação (Pi) é curto.
- **É em inox** (Ivo, 28/09), provavelmente feito por medida, o que confirma
  que foi alterado. Consequências:
  - Se a sonda antiga ler mal, **troca-se** por uma sonda de **tubo
    ajustável ao fundo** (corta-se ao comprimento). É mais precisa do que a
    boia de braço. Os depósitos de inox costumam ter uma **flange de 5
    parafusos (norma SAE)** para a sonda: ver se a tem.
  - **Corrosão:** o inox pica (corrosão por fissura) onde fica água parada
    por baixo ou encostada, sobretudo junto às soldaduras e aos apoios. Ver
    o fundo e os apoios do depósito, e se o porão por baixo fica seco.
  - Verificar se o depósito está **ligado à massa** (ligação equipotencial),
    como é habitual nos depósitos metálicos de combustível.
- **Vai quase até ao painel de popa** (Ivo, 28/09). Duas consequências fora
  deste sistema:
  - **Leme de emergência (Camada B, `LEME-EMERGENCIA.md`):** as ferragens
    aparafusam-se ao painel de popa. **Antes de furar, ver pelo interior
    onde acaba o depósito**, para não furar o depósito nem uma mangueira.
  - **Peso a ré:** 200 L de gasóleo pesam ~170 kg, quase todos lá atrás.
    Com o depósito cheio, o barco fica mais pesado de popa. Não é grave,
    mas convém ter em conta no caimento e ao arrumar mais peso a ré.
- **Segurança, porque está junto à cama:** verificar o respiro do depósito
  (tem de sair para fora do barco), as uniões e as mangueiras de gasóleo, e
  se há cheiro a gasóleo na cabine. Os vapores de gasóleo são pouco
  voláteis, mas o cheiro e as fugas junto a onde se dorme resolvem-se
  primeiro.

**Calibração** (o depósito não é um cubo, por isso a leitura não é linear):
- Com o depósito quase vazio, ir **enchendo aos 20 L** (10 pontos até aos
  200 L) e registar a leitura a cada passo.
- **Atalho:** o dono anterior deixou um **desenho do medidor com as
  quantidades**. Com essa tabela (posição do ponteiro → litros) basta
  registar a leitura do ADS1115 quando o ponteiro passa em cada marca, à
  medida que o gasóleo se gasta ou se abastece. Não é preciso encher aos
  20 L de propósito.
- O OpenPlotter aceita os **pontos de ajuste** e interpola entre eles.
- Com o consumo estimado do motor, dá **autonomia em horas** a motor.

Fontes: [OpenPlotter, ADS1115](https://github.com/sailoog/openplotter-documentation/blob/master/en/analog-ads1115.md),
[openplotter-i2c](https://github.com/openplotter/openplotter-i2c),
[opções de nível de depósito](https://www.liverpool.ac.uk/~cmi/boat/tanklevel.html).

### Água doce: 2 depósitos flexíveis (BB e EB, debaixo dos beliches), 28/09

Os depósitos **flexíveis** (de bexiga) não aceitam boia nem sonda: não há
parede rígida para a montar e a superfície mexe-se. As opções:

| Método | Como funciona | Prós | Contras |
|---|---|---|---|
| **Caudalímetro** (recomendado) | Sensor de efeito Hall na saída da bomba de água conta os litros gastos; ao encher, carrega-se em "cheio" | Barato (~€10–20, versão **para água potável**), um só sensor para os dois depósitos, instalação simples | Conta o que se gasta, não mede o que lá está. Erro de ~5–10 %. É preciso marcar "cheio" ao abastecer |
| **Células de carga** (pesar) | Estrado de contraplacado sobre 4 células de carga por depósito; 1 kg = 1 L | Mede a água real, qualquer que seja a forma do depósito | Precisa de espaço e de base plana debaixo do beliche. O balanço do barco e o peso no beliche perturbam: medir fundeado ou em média |
| Pressão no fundo | Sensor de pressão baixa na saída do depósito | — | **Não serve:** um depósito flexível sob o colchão muda de pressão quando alguém se deita ou se senta |

**Proposta:** **caudalímetro** a jusante das duas saídas (conta o total) e o
ESP32 com **SensESP** a contar os impulsos e a enviar para o SignalK
(`tanks.freshWater.*`), com um botão ou comando "cheio" no telemóvel. Se
houver válvula seletora BB/EB, um sensor na válvula (ou um caudalímetro por
depósito) dá o nível de cada um.

**Falta saber:** a capacidade de cada depósito, se há **válvula seletora** ou
se estão em paralelo, e onde está a bomba de água.

**Motor: painel Volvo Penta EVC** (conta-rotações, temperatura, painel EVC de
arranque e paragem, e medidor de gasóleo analógico). Os motores D1/D2 com EVC
falam um protocolo CAN da Volvo. **Opcional:** o gateway **Yacht Devices
YDEG-04** (~$249) liga ao multilink do EVC e põe na rede NMEA 2000 as
rotações, a temperatura, a pressão do óleo, as horas do motor, a tensão da
bateria e o consumo (se o motor o medir). Assim os dados do motor aparecem no
OpenCPN, no telemóvel e no diário de bordo. **Falta: o modelo exato do motor**
(chapa no bloco) e confirmar a versão do EVC. O medidor de gasóleo é
analógico e não entra na rede sem um sensor à parte. Fontes:
[Yacht Devices YDEG-04](https://www.yachtd.com/products/engine_gateway.html),
[notícia YD sobre EVC](https://www.yachtd.com/news/j1939_volvo_penta_evc_gateway.html).

**O ST4000+ tem a tecla `track`**, por isso aceita rota vinda de fora. Falta
confirmar nos terminais de trás se entra por NMEA 0183 ou só por SeaTalk1. Se
for só por SeaTalk1, a rota não lhe chega pela MacArthur, que só lê SeaTalk1.

**Radar:** a antena JRC é um radome no arco de popa. O suporte tem ferrugem:
ver o estado dos parafusos e da base.

**Há duas bússolas no SeaTalk1** (ST4000+ e ST50 Compass). Escolher uma como
fonte de proa no SignalK e manter a outra de reserva.

Fontes: [em-trak B330, manual](https://alphatronmarine.com/files/secured/docuware_documents/180-AIS+Em-trak+B330+InstallOper+Manual++12-1-2017.pdf),
[em-trak, PGN do B330](https://productsupport.em-trak.com/hc/en-gb/articles/28856352427933-What-are-the-NMEA-2000-PGNs-supported-by-the-B100-B300-and-B330),
[NASA Clipper Wind V2](https://www.nasamarine.com/product/clipper-wind-system/),
[NASA Clipper Wind NMEA (fórum YBW)](https://forums.ybw.com/threads/nasa-clipper-wind-nmea-0183-output-tx.534078/),
[NASA Clipper Log](https://www.seashop.com/en/nasa-clipper-log),
[JRC 1000, Practical Sailor](https://www.practical-sailor.com/marine-electronics/entry-level-lcd-radars/),
[instalação GPSMAP 400/500](https://www.manualowl.com/m/Garmin/GPSMAP-421%2F421s/Manual/133497?page=7),
[Navicom RT750](https://www.navicom.fr/produits/rt750ais-vhf-fixe-25w-avec-antenne-gps-et-ais-integre-nmea-2000),
[NASA Target Navtex Pro-Plus](https://www.nasamarine.com/product/target-navtex-pro-plus-v2/).

## 2c. Ligações confirmadas na documentação (pesquisa de 28/09)

**Decisão de 28/09 (Ivo):** o ST4000+ **não governa** (falta a unidade de roda) e o
EV-100 **não vem para já**. Do piloto **só se lê a proa** (a bússola) pelo
SeaTalk1. Não se liga nada à entrada NMEA dele. O que está abaixo sobre a rota
fica para quando houver unidade de roda.


| Aparelho | O que diz a documentação | Consequência |
|---|---|---|
| **ST4000+** | Tem terminais **NMEA IN** atrás do painel: **vermelho = dados +, azul = dados −**. Aceita dados de navegação (modo **track**) e de vento (modo **vento**) em NMEA 0183 | ✅ **MacArthur 0183 OUT 2 → NMEA IN do ST4000+.** O OpenCPN envia a rota (APB/XTE, a confirmar). Só há uma entrada NMEA |
| **Radar JRC 1000** | Duas entradas separadas: navegação (**amarelo +, verde −**; RMC, GLL, VTG, RMB, BWC…) e bússola (**azul +, branco −**; HDG, HDM, HDT) | ✅ **OUT 1 → as duas entradas em paralelo.** O radar passa a ter posição e proa (marcação verdadeira, rumo para cima) |
| **VHF RT750** | Entrada NMEA 0183 a **4 800 baud**. RT750 V2: **preto = massa NMEA, verde = GPS +** | ✅ **OUT 1 → verde (+) e preto (−).** Na GPS Setup do rádio, escolher a fonte NMEA 0183 |
| **em-trak B330** | NMEA 0183 a 38 400 baud; pode **multiplexar** a entrada 0183 para o Wi-Fi (comando `nmea1mux` no proAIS2); NMEA 2000 LEN 1 | ✅ Entra pela **N2K**. O B330 precisa da rede N2K **alimentada** |
| **MacArthur (N2K)** | Traz **1 terminador de 120 Ω** (opcional); a rede precisa de **2**; o barramento CAN alimenta-se **diretamente da bateria**; o Pi **não** se alimenta do barramento | Kit N2K: **1 terminador** (o outro é o da HAT), T, cabo e **derivação de alimentação a 12 V com fusível** |
| **NASA Clipper Wind** | A **Mk1 (topo do mastro de 5 fios)** só dá NMEA com o **cabo/conector de saída NMEA** da NASA; a **V2 (3 fios)** envia **MWV** diretamente | Ver o número de fios do cabo do mastro. Se for Mk1: comprar o conector de saída NMEA da NASA |
| **NASA Clipper Depth (antiga)** | A ficha de 5 pinos atrás fala **I²C** (para o repetidor), **não NMEA**. Há um projeto aberto com Arduino que o converte em `$IIDPT` a 4 800 baud | Se for a antiga: **conversor próprio** (ver abaixo) ou sonda nova com NMEA |
| **NASA Clipper Log (antiga)** | Provavelmente igual à Depth (I²C para o repetidor). As versões novas (Easy Log / EML-2 NMEA) dão **VHW + VLW** | Ver a versão nas costas |

### Conversor próprio para os NASA antigos (se for preciso)

Um **ESP32** (~€5–10) a fazer de "repetidor" I²C dos NASA:
- lê a ficha de repetidor da **sonda** e do **log** (o ESP32 tem 2 barramentos
  I²C);
- envia os dados ao **SignalK por Wi-Fi** (biblioteca **SensESP**) ou em NMEA
  0183 por fio;
- **resolve também a falta de entradas 0183**, porque deixa de ser preciso o
  adaptador USB.
- ⚠️ Confirmar a tensão do I²C dos NASA (provavelmente 5 V). O ESP32 é 3,3 V,
  por isso precisa de um conversor de nível.
- Base: o projeto aberto [NASADepth-NMEA](https://github.com/dreisday/NASADepth-NMEA)
  (endereço I²C 0x3e, pinos 1 = SCL, 3 = SDA, 2 e 5 = massa, na ficha de 5 pinos).

**Por isso as fotos das costas dos NASA passam a ser as mais importantes:**
dizem se é preciso o conversor ou só cabos.

Fontes: [ST4000+, ligações NMEA](https://www.manualslib.com/manual/138185/Raymarine-Autopilot-Plus-St4000Plus.html?page=68),
[JRC 1000, manual](https://www.scribd.com/document/577970612/JRC-1000-Radar-Manual),
[RT750 V2, ligação NMEA](https://www.navicom.fr/api/dam/files/975ed5cd-c039-410d-81d6-730194f4c52a),
[RT750, manual](https://www.manualslib.com/manual/3610453/Navicom-Rt750.html),
[em-trak B330, manual](https://alphatronmarine.com/files/secured/docuware_documents/180-AIS+Em-trak+B330+InstallOper+Manual++12-1-2017.pdf),
[MacArthur, NMEA 2000](https://macarthur-hat-documentation.readthedocs.io/en/latest/nmea2000.html),
[MacArthur, alimentação](https://macarthur-hat-documentation.readthedocs.io/en/latest/power.html),
[NASA, saída NMEA do Clipper Wind Mk1](https://www.nasamarine.com/product/clipper-wind-nmea-output-cable/),
[NASA Clipper Wind V2](https://www.nasamarine.com/product/clipper-wind-system/),
[OpenSeaMap, ligações da Clipper Depth](https://openseamap-develop.narkive.com/SOdDATA6/nasa-clipper-depth-wiring-information),
[NASADepth-NMEA](https://github.com/dreisday/NASADepth-NMEA/blob/main/Clipper_Depth_to_NMEA.ino).

## 3. O radar é a incógnita

Os radares falam protocolos fechados de cada marca. O plugin **radar_pi** do
OpenCPN suporta vários modelos (Navico: Simrad/B&G/Lowrance BR24, 3G, 4G,
HALO; Garmin HD/xHD; alguns Raymarine e Furuno recentes), mas **um radar
antigo ou analógico não aparece no ecrã novo.** Nesse caso o radar continua no
plotter atual. **É a foto mais importante da lista.**

Se o radar for suportado e se quiser vê-lo sobreposto, considerar o Pi 5 de
**8 GB** em vez de 4 GB. O radar é o que mais puxa pela máquina.

## 4. Lista de material

Preços pesquisados a 28/09/2026. O "c/IVA" das lojas que mostram preço sem
IVA foi calculado com 23% (a loja pode aplicar a taxa do seu país).

**Montagem do conjunto:** Pi 5 → **base NVMe por baixo** → MacArthur HAT por
cima. A base NVMe **tem de ser a de baixo (Pimoroni)**, porque a M.2 HAT+
oficial vai por cima e choca com a MacArthur. É uma montagem que outros já
usaram com o OpenPlotter 4 sem problemas: 50–55 °C, com o módulo de
alimentação da HAT a alimentar tudo
([fórum OpenMarine](https://forum.openmarine.net/showthread.php?tid=5254)).

| # | Peça | Loja | Preço c/IVA | Nota |
|---|---|---|---|---|
| 1 | Raspberry Pi 5 **8 GB** (decidido 28/09) | [Amazon.es](https://www.amazon.es/dp/B0CK2FCG1K) | **€204,80** (outros vendedores desde €201,46) | Só €40 acima do 4 GB na Amazon; fica preparado para o radar. O 4 GB estava esgotado em PT |
| 2 | Dissipador ativo oficial (SC1148) | [Botnroll PT](https://www.botnroll.com/en/accessories/5018-raspberry-pi-5-official-active-cooler-sc1148.html) | **€5,90** | |
| 3 | Pimoroni NVMe Base | [RaspberryPi.dk](https://raspberrypi.dk/en/product/pimoroni-nvme-base-for-raspberry-pi-5/) | **€19,93** | Traz cabo PCIe, espaçadores e pés |
| 4 | SSD NVMe 256 GB (M.2 2280) | [PcComponentes](https://www.pccomponentes.pt/gigabyte-ssd-m2-2280-256gb-pcie-30-x4-nvme) (Gigabyte) | **€34,33** | Preferir uma marca testada pela Pimoroni (Kingston, Crucial, Samsung, Kioxia) se custar o mesmo |
| 5 | MacArthur HAT | [OpenMarine](https://shop.openmarine.net/home/23-macarthur-hat.html) | **~€76** (€62 s/IVA) | 36 em stock. Só envia às segundas e terças |
| 6 | Módulo de alimentação 12→5 V da HAT | OpenMarine | **~€28** (desde €23 s/IVA) | Alimenta o conjunto todo a partir dos 12 V |
| 7 | Ecrã de testes LAFVIN 7" HDMI, tátil capacitivo, 1024×600 | [Amazon.es](https://www.amazon.es/dp/B0BVW7J1J8) | **€48,78** | HDMI + toque por USB, como o definitivo. Há versão de 10,1" a €71,14 |
| 7b | Cabo **micro-HDMI → HDMI** (o Pi 5 só tem micro-HDMI), com o comprimento até à roda (3–5 m) | Amazon | a confirmar (1 m: €9,95) | + cabo USB do mesmo comprimento para o toque |
| 8 | Cartas o-charts Portugal | [o-charts](https://o-charts.org/shop/en/oesenc/79-portugal.html) | **~€20** (€16 s/IVA) | Continente, Açores e Madeira |
| 9 | Chave USB de licença o-charts | [o-charts](https://o-charts.org/shop/en/hardware/38-usb-key-dongle.html) | **~€23** (€19 s/IVA) | Recomendada: reinstalar o OpenPlotter apaga a licença; com a chave não se perde |
| 10 | ASA preto 1 kg | [EVOLT](https://evolt.pt/produto/asa-1kg-black-esun/) | **€17,73** (Winkle, em stock) | eSUN €21,39 esgotado. 1 bobina chega para o suporte e a pala |
| 11 | Porta-fusível em linha ATO/ATC IP55 | [SVB](https://www.svb24.pt/pt/seatec-porta-fusiveis-em-linha-ato.html) | **€3,32** | + fusível de 5 A |
| 12 | **Motor → Pi, feito por nós** (decidido 28/09, em vez do YDEG-04): adaptador **USB–CAN** isolado (candleLight/gs_usb) + fichas **Deutsch DT04-6P e DT06-6S** com contactos e travas + cabo de 4 fios | a cotar | **~€40–60** | Ver secção "Alternativa DIY". O YDEG-04N (~€263,52) fica como **plano B** se o teste de escuta falhar |
| 13 | **ADS1115** (I²C) + resistências do divisor, para o nível do gasóleo | a cotar | **~€5–10** | Ver "Nível do gasóleo" |
| 14 | **Barómetro BME280** (pressão, temperatura, humidade) DFRobot Gravity I²C, com cabo | [Botnroll PT](https://www.botnroll.com/en/temperature/5336-gravity-i2c-bme280-environmental-sensor-dfrobot-sen0236.html) | **€23,80** | Liga à I²C da MacArthur. Montar **fora da caixa do Pi** (o calor falseia a temperatura). Alternativa: Adafruit €26,60 |
| 15 | **2 besouros piezo ativos 12 V, 95 dB a 30 cm**, 8 mA (1 no poço, 1 na **cabine do comandante**, junto ao beliche e ao ecrã 2) | [Botnroll PT](https://www.botnroll.com/en/sounders/861-buzzer-piezoelectrico.html) | **€3,60** (2 × €1,80) | Comandados pelo Pi por um **transístor NPN** (BC337 ou 2N2222) + resistência de 1 kΩ, a partir de um GPIO (cêntimos). Testar se o volume acorda quem dorme; se não, trocar por uma sirene de painel mais forte |
| | **Total** | | **≈ €566** (€482 + ~€50 motor + ~€8 gasóleo + €24 barómetro + €4 besouros) | Sem portes, sem cabos e sem o kit N2K. Portes: contar €30–50 |

**Também é preciso** (preço não confirmado, loja náutica ou sobras):
- Cabo **estanhado** de 1,5 mm² (≥ 16 AWG) vermelho/preto, do quadro até ao
  Pi.
- 4 espaçadores M2,5 de 15 mm, para a caixa.
- **Caixa do Pi impressa**: há um modelo já feito para Pi 5 + MacArthur + NVMe
  por baixo
  ([Printables, Ozoner](https://www.printables.com/model/781587-case-for-raspberry-pi-5-with-macarthur-hat-and-bot)).
  Imprimir em ASA ou PETG, porque fica dentro do barco.

**Só depois das fotos** (pode não ser preciso):
- Multiplexer ou adaptador USB–NMEA 0183, se houver mais de 2 fontes 0183.
- Cabos e conector em T de NMEA 2000, se algum aparelho for N2K.
- Comando físico Bluetooth/USB para usar com luvas ou com o ecrã molhado.
- Pi 5 de **8 GB** em vez de 4 GB, se o radar entrar no ecrã.

### Ordem das compras (decidida 28/09)

1. **Agora:** Pi 5 8 GB + MacArthur + ecrã de testes (esta lista).
2. **Depois:** piloto **Raymarine EV-100 Wheel** (ver `PILOTO-AUTOMATICO.md`).
3. **Mais tarde:** plotter **Axiom** (fase 3, abaixo).

### Fase 2b: o EV-100 na rede do Pi

O EV-100 fala **SeaTalkNG = NMEA 2000**. Liga-se à porta N2K da MacArthur com
um cabo adaptador SeaTalkNG ↔ DeviceNet. Ganha-se:
- **Proa rápida do EV-1** (sensor giroscópico). Resolve a dúvida da proa lenta
  do ST4000+ para o radar sobreposto. O ST4000+ passa a reserva.
- **Rotas do OpenCPN para o piloto:** o OpenCPN ≥ 5.12 envia os PGN 129283 e
  129284 quando se ativa uma rota ou waypoint. O modo track engata-se no p70s.
  Já foi testado com o EV-1 por outros utilizadores.
- **Comando do piloto a partir do Pi ou do telemóvel** (standby, auto, ±1,
  ±10): há plugins do SignalK e do OpenCPN para pilotos Raymarine N2K.
  **Testar antes de confiar nisso ao largo.**
- O **p70s** passa a mostrar também o vento, o AIS e a profundidade que o Pi
  põe na rede.
- A rede NMEA 2000 (backbone, T, terminadores) monta-se nesta fase e fica
  pronta para o Axiom.

Fontes: [OpenCPN wiki, pilotos](https://opencpn.org/wiki/dokuwiki/doku.php?id=opencpn%3Amanual_basic%3Aset_options%3Aconnections%3Aautopilot),
[Yacht Devices, pilotos Raymarine](https://www.yachtd.com/news/raymarine_autopilot_support.html),
[Cruisers Forum](https://www.cruisersforum.com/forums/f134/opencpn-nmea2000-and-autopilots-229737.html).

### Fase 3 (futuro, sem data): plotter Raymarine Axiom na roda

O Ivo quer pôr um **Axiom** mais tarde (28/09). Não está decidido o modelo
nem a data. Se avançar, **substitui o SailProof** como ecrã da roda.

- Preços SVB s/IVA (28/09): **Axiom+ 7 Touch €638,61** (~€785 c/IVA),
  **Axiom+ 9 Touch €1 092,40** (~€1 344), Axiom 2 Pro 9 S €2 184,83. Num
  veleiro chegam as versões sem sonda 3D. Recomendação: Axiom+ 9.
- **O Axiom+ só tem NMEA 2000.** Não tem NMEA 0183 nem SeaTalk1.
- **O Pi + MacArthur continuam a servir**, como ponte: leem o SeaTalk1 e o
  0183 e põem tudo em NMEA 2000 para o Axiom. Dispensam os conversores da
  Raymarine. O OpenCPN no Pi fica como reserva e o Wi-Fi continua a servir o
  telemóvel.
- **O Axiom só mostra radares Raymarine** (Quantum, Cyclone, Magnum e alguns
  digitais antigos). O radar atual tem de ser identificado primeiro.
- A acrescentar nessa altura: rede NMEA 2000 (cabo de backbone, T,
  terminadores, cabo DeviceNet micro) e o cartão de cartas Navionics.
- **Nada do que se compra agora se perde.** A porta NMEA 2000 da MacArthur é o
  que liga o Axiom.

Fontes: [SVB Axiom+ 9](https://www.svb24.com/en/raymarine-axiom-9-touch.html),
[SVB Axiom+ 7](https://www.svb24.com/en/raymarine-axiom-7-touch.html),
[Axiom e NMEA 0183](https://pysselilivet.blogspot.com/2019/05/raymarine-axiom-and-nmea0183.html).

### Fase 1 (testes) e fase 2 (ecrã definitivo)

**Decisão de 28/09:** começar com o ecrã barato de 7". O Pi, a HAT, as cartas
e as ligações são os mesmos nas duas fases; só se troca o ecrã. Na fase 1:
- **Não é estanque nem se lê ao sol.** Testar à sombra, na cabine ou debaixo
  da capota, e protegê-lo dos salpicos (saco estanque ou caixa impressa).
- Serve para validar tudo o resto: leitura de cada aparelho, proa do ST4000+,
  AIS, vento, a rota para o piloto, o Wi-Fi para a Navionics e o consumo real.
- Passa-se à **fase 2 (SailProof STS10, €499,17)** só quando o sistema estiver
  estável. O ecrã de 7" fica depois como segundo ecrã na mesa de cartas.
- O **suporte e a pala impressos** desenham-se para o ecrã definitivo. Para a
  fase 1 chega um suporte simples.

Alternativas ao ecrã de testes que ficaram de fora:
- **Raspberry Pi Touch Display 2** (7", desde $40–60): liga por fita DSI
  curta. Não dá para o levar até à roda nem testa a ligação HDMI + USB.
- **10,1" capacitivo HDMI genérico** (~€68 no eBay.de): maior, mas acima do
  orçamento.
- **Waveshare 7" HDMI LCD (C)** (€56,90, welectron): igual ao LAFVIN, mas mais
  caro.
- **Freenove 7"** (€54,85, Amazon): liga por fita DSI, não tem HDMI.

Outras opções rejeitadas a 28/09:
- **Box Android X88 Pro B (Allwinner H313, 2 GB) em vez do Pi:** não tem o
  conector de 40 pinos (não leva a MacArthur nem lê o SeaTalk1), é 3–4× mais
  lenta e o Linux é só da comunidade, com Wi-Fi incerto. O Raspberry Pi OS
  não arranca nela. Serviria apenas para aprender o OpenPlotter em casa.
- **Kit db-tronic Pi 5 NVMe (Amazon):** a placa do disco vai por cima e choca
  com a MacArthur. Tem fonte de 230 V e caixa de metal (que tira alcance ao
  Wi-Fi). Sai mais caro que as peças soltas.

**Não usar a fonte oficial de 27 W do Pi.** É para tomada de 230 V. No barco o
Pi alimenta-se dos 12 V pelo módulo da HAT, com fusível no quadro.

Os preços do Pi subiram várias vezes em 2025–2026 por causa da falta de
memória RAM
([Tom's Hardware](https://www.tomshardware.com/raspberry-pi/raspberry-pi-5-price-increases-drastically-as-ai-shortage-bites-16gb-version-now-usd205-second-price-increase-in-three-months-over-70-percent-more-expensive-than-original-msrp)).
Confirmar tudo no dia da compra.

Fontes dos preços: [RasPi Shop](https://raspishop.pt/c/robotica-e-desenvolvimento/raspberry-pi-robotica-e-desenvolvimento/placas-e-kits/raspberry-pi-5/),
[SailProof STS10](https://sailproof.shop/product/sunlight-readable-waterproof-touchscreen-10-2/),
[o-charts Portugal](https://o-charts.org/shop/en/oesenc/79-portugal.html).

### Ecrãs que ficaram de fora

| Ecrã | Preço | Porque ficou de fora |
|---|---|---|
| Xenarc 1029CNH 10,1" IP65 | $749–851 | Mais caro, importação dos EUA, menos brilho |
| Xenarc 1219GNH 12,1" IP67, colagem ótica | $1 324 | 2,5× o preço por mais 2" |
| SailProof 13,3" | €1 279 | Idem |

## 5. Energia

| Consumo | W | A a 12 V |
|---|---|---|
| SailProof STS10 (fase 2, brilho máximo) | ~19 | ~1,6 |
| Pi 5 + HAT + SSD | ~7 | ~0,6 |
| **Total** | **~26** | **~2,2** |

**Em 24 h de navegação, com o ecrã definitivo, são ~50 Ah só neste sistema**, sem o piloto, o
frigorífico e as luzes. Baixar o brilho à noite (o modo noturno do OpenCPN)
reduz o consumo do ecrã. Juntar estes números ao balanço de energia do barco
quando se fizer o sistema elétrico. Hoje o barco tem baterias separadas
(motor e serviço), **sem painel solar e sem monitor de bateria**.

## 6. Reserva (obrigatória a solo)

Com tudo num ecrã só, esse ecrã passa a ser um ponto único de falha.
- O **plotter atual mantém-se** ligado à rede, como segundo ecrã.
- **VHF, AIS e Navtex funcionam sozinhos** se o Pi falhar.
- A **Navionics no telemóvel** tem GPS próprio e cartas offline.
- O **ST4000+** governa por bússola sem o Pi; só perde o modo track.

## 7. Suporte e pala (impressão 3D)

- **Material: ASA preto.** O PETG amarelece e fica frágil ao sol em 1–2 anos.
  Imprimir com a câmara fechada nas K2.
- **Fixação:** abraçadeira ao **tubo da guarda do pedestal**.
- **Berço do ecrã** para 250 × 170 × 33 mm.
- **Pala:** aba de cima comprida, abas laterais curtas (para não atrapalhar o
  toque nos cantos) e **sem aba em baixo**. Tem **furos de escoamento**,
  interior preto mate contra reflexos, e **encaixa por clipe** no suporte.
- **A pala roda e fecha sobre o ecrã** como tampa quando o barco está parado
  (protege do UV e das gaivotas).
- **Desenho paramétrico.** O comprimento da pala é um compromisso entre sombra
  e ângulo de visão: ao leme a solo está-se muitas vezes de lado. Imprimir
  primeiro uma pala curta de teste e afinar no barco.
- Antes de desenhar, **mostrar fotos de palas reais** instaladas em barcos
  para escolher o estilo. Não gerar maquetes 3D como referência.
- Prever um **comando físico** (teclado ou roda pequena Bluetooth/USB) para
  zoom e confirmar alarmes com luvas ou com o ecrã molhado.

## 7b. Disposição do ecrã escolhida (28/09)

O Ivo escolheu a **primeira maqueta do ecrã de 10"**, na **horizontal**
(1280×800):
- **Barra de cima:** hora, GPS, rota e **alarme AIS a vermelho**.
- **Carta à esquerda (~58 %):** o barco com a linha da proa e o vetor COG, a
  rota e os waypoints, os alvos AIS com vetores (o perigoso a vermelho), o
  anel de 0,5 MN e, em baixo, o próximo WP e o XTE.
- **Painel à direita:**
  - vento aparente (mostrador) e vento real;
  - proa, SOG/COG, fundo (com tendência), velocidade na água e corrente
    estimada;
  - **lista AIS** com CPA e TCPA;
  - motor (rotações, temperatura, tensão, horas, óleo e carga);
  - gasóleo (L, autonomia em horas e em MN).
- **Botões em baixo:** Carta, Instrumentos, AIS, Motor, Rota, **Diário** e Noite.
- Montagem na **horizontal**: o suporte e a pala desenham-se para isso.
- Implementação: OpenCPN (carta, AIS, rota) + painel de instrumentos do
  **KIP** (SignalK) ou do próprio OpenCPN (dashboard), a decidir na montagem.

## 7c. Diário de bordo (pedido do Ivo, 28/09)

Página **Diário** no ecrã (7.º botão, entre Rota e Noite). Base: o plugin do
SignalK **signalk-logbook** (semi-automático, com interface web que funciona
no ecrã e no telemóvel).
- **Entradas automáticas:** **de hora a hora** a navegar (posição, rumo,
  velocidade, vento, fundo, horas de motor); **motor ligado/desligado**;
  **início e fim de viagem** (precisa do plugin `signalk-autostate`).
- **Entradas manuais:** botões de um toque (motor, rizar, mudar vela,
  fundear, amarrar, avaria) e **notas** escritas. Mudanças de vela também
  registadas.
- **Guardado no Pi** em ficheiros YAML, **um por dia**
  (`~/.signalk/plugin-config-data/signalk-logbook/AAAA-MM-DD.yml`): fáceis de
  ler, de copiar e de exportar para PDF.
- **A juntar aos alarmes:** registar também os alarmes AIS e do motor.
- **Sugestão:** um **barómetro** I²C (BME280, ~€5–10) na MacArthur. O diário
  passa a registar a **pressão atmosférica** de hora a hora, que é o dado mais
  útil para ver o tempo a mudar a solo. A cotar.
- Alternativas: `signalk-sailing-logbook` (acrescenta viragens e cambadas) ou
  o plugin de diário do OpenCPN.

**Cópia sem fios (alternativa à pen, 28/09):**
- **Syncthing** no Pi e no telemóvel (e no PC de casa, se quiser): sempre
  que o telemóvel está na rede Wi-Fi do barco, a pasta do diário
  **sincroniza sozinha**, nos dois sentidos, sem cabos e sem cloud. O
  telemóvel fica com uma cópia completa, e é a melhor cópia de segurança
  porque sai do barco contigo.
- **Pasta partilhada (Samba)** no Pi: no PC com Windows, abre-se como uma
  pasta de rede e copiam-se os ficheiros.
- A própria **página web do diário** (signalk-logbook) abre no telemóvel.
- **Com internet** (4G do barco ou Wi-Fi da marina), o `rclone` pode enviar
  também uma cópia para a cloud (Google Drive, OneDrive).
- **Bluetooth: não recomendado.** Dá (OBEX), mas é lento, tem de se
  emparelhar à mão e cada envio precisa de aceitação no telemóvel.
- **Decisão:** Wi-Fi (Syncthing) como principal. A pen fica **opcional**, o
  que liberta uma porta USB.

**Cópia para uma pen USB (pedido do Ivo, 28/09):**
- A pen fica **sempre ligada ao Pi**, montada por UUID num sítio fixo
  (`/media/diario`) com `nofail`. Assim o Pi arranca mesmo sem a pen.
- Um **temporizador systemd** corre de **15 em 15 minutos** e ao desligar:
  `rsync` dos ficheiros do diário (YAML por dia) + exportação diária em
  **CSV/PDF** para a pen, seguido de `sync`.
- Formato da pen: **exFAT** (ou FAT32), para se ler diretamente no PC com
  Windows. Como o exFAT/FAT não tem journal, a cópia é pequena e seguida de
  `sync`, e o original fica no SSD. Um corte de energia estraga no máximo a
  última cópia, nunca o diário.
- Na mesma rotina: **cópia semanal da configuração do SignalK/OpenPlotter**
  para a pen. Se o SSD morrer, o sistema reinstala-se depressa.
- ⚠️ **Portas USB do Pi 5: são só 4.** Toque do ecrã, chave o-charts, USB-CAN
  do motor, pen, e ainda o adaptador USB-0183 da sonda (se não for pelo
  ESP32). **São 5.** Solução: um **hub USB pequeno** (de preferência
  alimentado) ou a sonda pelo ESP32 (Wi-Fi), que liberta uma porta.

Fontes: [signalk-logbook](https://github.com/meri-imperiumi/signalk-logbook),
[artigo do autor](https://bergie.iki.fi/blog/electronic-logbook/),
[signalk-sailing-logbook](https://github.com/johansolve/signalk-sailing-logbook).

## 7d. Segundo posto na cabine do Ivo (28/09)

**Planta final do Arlequin (28/09, aprovada pelo Ivo):** [`planta-arlequin.pdf`](planta-arlequin.pdf)
(A4 para imprimir) e [`planta-arlequin.svg`](planta-arlequin.svg). Mostra o interior
(letras a–n) e a posição do sistema de navegação (números 1–10).

**Esquema final de ligações (28/09):** [`esquema-arlequin.pdf`](esquema-arlequin.pdf) (A4) e
[`esquema-arlequin.svg`](esquema-arlequin.svg): entradas → Pi/MacArthur → saídas, e a rede NMEA 2000.

**Motor (28/09):** fica **atrás da escada**, encostado à cabine de popa. Há
acesso **pela cabine** e **tirando a escada**. A ficha Deutsch do MDI e a
ligação ao Pi (USB–CAN) ficam a poucos metros da mesa de navegação.

**Planta (ficha técnica Jeanneau, em `Documents\Veleirorochura`):** de popa
para proa: cabine de popa com cama de casal a **estibordo**, por baixo do poço;
**mesa de navegação a estibordo** à frente dela; cozinha a bombordo; escada
ao centro; sala com beliches dos dois lados (os **depósitos de água** estão
debaixo deles); WC; cabine de proa; poço da âncora. Dados de origem: água
**180 L**, gasóleo **90 L** e motor Yanmar 2QM. Hoje o barco tem **200 L de
gasóleo** e um **Volvo D1-20B**, por isso foi alterado.

O Ivo descansa **na cabine junto à mesa de navegação**. Daí vê o poço pelas
janelas, um bocado do mastro e os manómetros do motor. O sistema tem de
funcionar também ali:
- **O Pi fica instalado junto à mesa de navegação**, que é seca e perto do
  quadro. O cabo longo é só o do ecrã da roda.
- **Dois ecrãs no mesmo Pi:** o Pi 5 tem **duas saídas micro-HDMI**.
  - Ecrã 1: o de 10" na roda.
  - Ecrã 2: o **LAFVIN 7" dos testes** fica **na mesa de navegação, virado
    para a porta da cabine de popa**. A cabine do Ivo só tem a cama; com a
    porta aberta vê-se a mesa de navegação (confirmado 28/09). Assim vê-se o
    ecrã deitado, e os cabos até ao Pi têm centímetros.
  - Os dois são táteis por USB. No Linux é preciso associar cada toque ao
    seu ecrã (configuração, sem custo).
  - Alternativa: um tablet ou o telemóvel em Wi-Fi (KIP/OpenCPN) no
    beliche.
- **Besouro 2 DENTRO da cabine de popa**, junto à cabeceira, para acordar
  mesmo com a porta fechada. Testar o volume. Opcional: um **LED vermelho**
  de alarme à vista da almofada.
- **Modo noite nos dois ecrãs**, para não estragar a visão noturna quando
  se sobe ao poço.

## 8. Fotos e medidas em falta (próxima ida ao barco)

1. **Radar**: a etiqueta da antena e da unidade (modelo exato). **Prioridade.**
2. **Plotter**: a frente, a etiqueta de trás e **as fichas e os fios de trás**.
3. **AIS, VHF, Navtex, anemómetro**: a etiqueta e as fichas de cada um. As
   fichas mostram se o aparelho é NMEA 0183, SeaTalk ou NMEA 2000.
4. **ST4000+**: os terminais de trás do painel (se tem NMEA IN).
5. **Quadro elétrico e baterias**: as etiquetas e quantas são.
6. **Pedestal da roda**: foto de frente e **diâmetro do tubo da guarda**
   (paquímetro; costuma ser 25,4 mm).
7. **Caminho do cabo** do pedestal até ao sítio seco onde fica o Pi (máximo
   3,5 m com as extensões do ecrã).

## 8b. Lista para a próxima ida ao barco (28/09)

1. **AIS no Garmin:** o GPSMAP 421 mostra triângulos de barcos? Se sim,
   configurar a **zona de segurança** (raio e tempo) do alarme de colisão. Se
   não, ver se o B330 está ligado ao 421 (NMEA 2000 ou 0183 a 38 400 baud).
2. **Teste de Wi-Fi do B330:** ligar o telemóvel ao Wi-Fi do B330 e ver se a
   Navionics recebe AIS e GPS.
3. **Costas dos três NASA** (vento, log, sonda): fichas e número de fios. No
   vento, o cabo do mastro tem 3 ou 5 fios? Isto decide entre cabos e o
   conversor ESP32.
4. **Chapa do motor Volvo** (modelo e número de série).
5. **Quadro elétrico e baterias.**
6. **Diâmetro do tubo do pedestal da roda** (paquímetro) e percurso do cabo até
   onde fica o Pi.
7. **Onde está a bússola fluxgate do ST4000+** (longe de ferro e de cabos?).
8. **Foto do desenho do medidor de gasóleo com as quantidades** (feito pelo
   dono anterior): dá a tabela ponteiro → litros para a calibração.
9. **Medir a resistência da sonda do gasóleo** (10–180 Ω ou 240–33 Ω?).
10. **Pinos da ficha Deutsch do motor** com o multímetro (60–120 Ω entre CAN H
    e CAN L) e teste de escuta com a ignição ligada.
11. **Água doce:** capacidade de cada depósito (BB e EB), se há **torneira
    seletora** ou se estão em paralelo, e onde está a **bomba de água**.
12. **Fuga de gasóleo** na ligação da mangueira ao depósito: trocar a
    braçadeira (inox 316, banda lisa, duas se couber), ver o estado da
    mangueira (ISO 7840 A1), limpar, ligar o motor e confirmar com papel
    branco. Ver também a mangueira de retorno.
13. **Depósito de gasóleo em inox:** respiro para fora, fundo e apoios sem
    água parada (corrosão), ligação à massa, se tem **flange SAE de 5
    parafusos** para a sonda, e **onde acaba junto ao painel de popa**
    (antes de furar para o leme de emergência).
14. **Sensor de líquido** (a acrescentar ao sistema do barco parado): escolher
    o ponto mais baixo por baixo do depósito de gasóleo para o pôr.

**Alarme sonoro:** a solo, o alarme AIS tem de acordar quem dorme. O apito do
Garmin é fraco. No Pi, acrescentar à lista um **altifalante ou besouro forte**
(ou o alarme no telemóvel pelo SignalK).

## 9. Próximos passos

1. Fotos e medidas do §8.
2. Fechar o mapa de ligações: que aparelho entra em que porta, as frases NMEA
   e as velocidades (4800 ou 38400 baud).
3. Lista de compras final, com os preços do dia.
4. Montar e configurar o Pi em casa (OpenPlotter, SignalK, OpenCPN, cartas)
   e **testar em bancada** antes de levar para o barco.
5. Desenhar e imprimir o suporte e a pala.
6. Instalar, e testar primeiro no porto e depois a navegar.

## 10. Fora do âmbito deste documento (subprojeto seguinte)

**Monitorização com o barco parado** (amarração ou marina): alarmes de fumo,
de água no porão, de energia e de intrusão com câmaras interiores, a chegar ao
telemóvel. Notas já discutidas:
- **Ligação: 4G** (router ~2–3 W) para os alarmes. A **Starlink** (20–40 W)
  gasta demasiado para ficar ligada sozinha na amarração. Fica como segunda
  ligação quando se está a bordo ou ao largo.
- **Sem painel solar, a monitorização na amarração dura só ~5 dias.** Um
  painel de 100 W passa a fazer parte do sistema.
- **O sistema só avisa.** O detetor de fumo mantém sirene e pilha próprias e a
  bomba de porão mantém o seu flutuador.
- **Intrusão:** contacto magnético na gaiuta (deteta) mais câmaras de baixo
  consumo que acordam com movimento e gravam no SD (confirmam).
- **Câmaras nunca expostas por UPnP ou por portas abertas.** Acesso só por VPN
  (Tailscale ou WireGuard no router).
- Base recomendada: **Victron Cerbo GX + SmartShunt**, com as entradas
  digitais para porão, fumo e gaiuta e alertas pela app VRM. Não está
  decidido.
