# Sistema de navegação integrado (Jeanneau Melody 34)

Ver também `PILOTO-AUTOMATICO.md`, `LEME-EMERGENCIA.md`.
Criado a 28/09/2026. Estado: **desenho aprovado**. As ligações aparelho a
aparelho ficam por fechar até haver fotos (ver §8).

## 0. Objetivo

Toda a eletrónica de bordo num **só ecrã tátil na roda de leme**, com os dados
**sobrepostos a uma carta náutica** (tipo Navionics): AIS, vento,
profundidade, radar e rota enviada ao piloto (quando houver piloto: o EV-100 Wheel está decidido
mas ainda por comprar e instalar, ver §1).

A eletrónica que existe a bordo: **anemómetro, plotter, radar, VHF, AIS,
Navtex** e o piloto **ST4000+** (SeaTalk1). Das marcas e modelos ainda não se
sabe nada. (Ficaram identificados por fotos no mesmo dia: §2b.)

Navegação sobretudo **a solo**. Isto obriga a manter uma reserva (ver §6).

## 0b. Dados do barco

Este é o quadro de referência: as outras notas (`PILOTO-AUTOMATICO.md`, `LEME-EMERGENCIA.md`,
`CABOS.md`, `MASTREACAO.md`) remetem para aqui. Fontes: a **ficha técnica** do Melody (versão GTE,
sailboat-data.com/fr, especificação de 1982), guardada em `Documents\Veleiro\brochura`, e o
quadro do `LEME-EMERGENCIA.md` (27/09, Wikipedia e sailboatdata). Onde as fontes não batem, ficam
os dois valores.

| | |
|---|---|
| Barco | **Arlequin**, Jeanneau Melody ("Melody 34"), sloop de topo |
| Projeto | **André Mauric** (ficha técnica); a Wikipedia e o sailboatdata juntam Gilles Vaton. As primeiras notas (07/09, `PILOTO-AUTOMATICO.md`) diziam "Briand, anos 80", sem fonte. Por confirmar pelo Ivo |
| Construção | Jeanneau, **1976–1982** na ficha (1974–1982 no sailboatdata), 607 unidades. O ano do Arlequin está por confirmar pelo Ivo |
| Comprimento | **10,55 m** fora a fora e **10,25 m** de casco; **8,70 m** na flutuação (8,69 m no sailboatdata). As notas de 07/09 diziam ~10,4 m |
| Boca / calado | **3,38 m** / **1,90 m** |
| Deslocamento / lastro | **~6 t**: 6000 kg (deslocamento leve, ficha) ou 6 046 kg (sailboatdata) / **2 900 kg** em ferro fundido. As notas de 07/09 diziam 4,5–5 t |
| Mastreação | Mastro pousado no convés, com **14,20 m** de comprimento (ficha), e **um só par de cruzetas**; a mastreação fixa tem **12 anos** (`MASTREACAO.md`). O `CABOS.md` conta "~13 m acima do convés": por confirmar pelo Ivo (muda o comprimento das drizas) |
| Leme | Semi-suspenso, num patilhão (*skeg*) que protege a parte de cima da lâmina |
| Popa | Espelho invertido (o painel inclina-se para vante) |
| Governo | **Roda de leme, com travão** (Ivo, 29/09). O barco nasceu com cana (a ficha diz "barre franche"); a cana de inox de emergência encaixa no topo da madre (`LEME-EMERGENCIA.md`, Camada A) |
| Piloto automático | **Ainda não há.** Decidido a 02/10: **Raymarine EV-100 Wheel** (de roda, ref. T70152), **por comprar e instalar** (`PILOTO-AUTOMATICO.md` §3). Limite do fabricante: 7 500 kg carregado; o Arlequin carregado anda pelos ~7,2 t (6 046 kg + 20 %): perto do limite, rizar cedo. O ST4000+ não governa (falta a unidade de roda) e só dá a proa |
| Motor | **Volvo Penta D1-20B** (de origem: Yanmar 2QM) |
| Gasóleo | **200 L**, depósito de inox que parece ter sido prolongado para trás (de origem: 90 L) |
| Água doce | 2 depósitos flexíveis, debaixo dos beliches da sala (de origem: 180 L ao todo); a capacidade de cada um está por medir (§8b, ponto 11) |
| Baterias | 3 bancos × 2 × 110 Ah, seladas, provavelmente AGM: banco 1 = motor; bancos 2+3 = serviço, **440 Ah** (§5b) |

## 1. Decisões tomadas

| Tema | Decisão | Porquê |
|---|---|---|
| Cérebro | **Raspberry Pi 5 8 GB com OpenPlotter** | Traz OpenCPN e SignalK prontos a usar. Consumo baixo e custo baixo |
| Interfaces | **MacArthur HAT** (~€76 c/IVA) | Uma placa com NMEA 2000, NMEA 0183 e SeaTalk1 |
| Programa de carta | **OpenCPN** | É o único que junta todos os dados por cima da carta (ver §3) |
| Cartas | **o-charts "Portugal"** (oeSENC, €16 s/IVA) | Oficiais do Instituto Hidrográfico: continente, Açores e Madeira. Até 5 aparelhos |
| Navionics | **Fica no telemóvel**, como segunda carta | Lê o Wi-Fi do Pi (posição, profundidade e AIS) |
| Ecrã (fase 1, testes) | **LAFVIN 7" HDMI, tátil** (€48,78) | Barato, HDMI + USB como o definitivo. Serve para provar o sistema |
| Ecrã (fase 2, definitivo) | **SailProof STS10, 10"** (€499) | Só se a fase 1 correr bem. 1500 nits, IP65, toque com água e luvas |
| Suporte | **Impresso em ASA**, com pala e tampa | O PETG degrada-se ao sol. O ASA foi feito para o exterior |
| Piloto automático | **Raymarine EV-100 Wheel (T70152)**, decidido pelo Ivo a 02/10: **por comprar e instalar**. Até lá **não há piloto**: o ST4000+ não governa (falta a unidade de roda) e só dá a proa | Tem de ser de roda (regra do Ivo de 27/09; o atuador abaixo do convés ficou excluído). Pormenores e limitação (7 500 kg carregado) no `PILOTO-AUTOMATICO.md` §3. Até estar montado, a única reserva de governo é a cana de emergência (§6) |

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

**Proposta inicial (28/09 de manhã), antes do inventário por fotos.** Valem as ligações do §2b
("Portas da MacArthur"), a decisão do §2c e o esquema final `esquema-arlequin.pdf` (§7d): o AIS
(B330, com GPS) entra pela NMEA 2000; as duas entradas 0183 são o vento e o log, e a sonda vai por
um adaptador USB–0183 (ou pelo ESP32); a 0183 OUT 1 dá posição e proa ao radar JRC 1000, que fica
autónomo no ecrã dele, e a posição ao VHF; a OUT 2 fica livre, porque não se liga nada à entrada
NMEA do ST4000+ (não governa); a SeaTalk1 IN lê a proa do ST4000+ e do ST50. O piloto decidido
(EV-100 Wheel, por instalar) liga-se à NMEA 2000 ("Fase 2b", §4). O comprimento do cabo do ecrã está
por medir (§8, ponto 7).

```
 NO POÇO (roda de leme)                 DENTRO (seco, perto do quadro)
 ┌──────────────────────┐   HDMI+USB   ┌──────────────────────────────────┐
 │ Ecrã tátil (7" → 10")│◄────────────►│ Raspberry Pi 5 + SSD NVMe         │
 │ suporte ASA + pala   │  (a medir)   │ OpenPlotter: OpenCPN + SignalK    │
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
  aceita** (normalmente APB/RMB/XTE). (Confirmado no §2c: tem NMEA IN. Mas, como o ST4000+ não
  governa, hoje não se lhe envia rota nenhuma.)
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
- O piloto decidido (EV-100 Wheel, `PILOTO-AUTOMATICO.md` §3) traz bússola própria, o sensor
  **EV-1**: quando estiver montado, essa passa a ser a principal e o ST4000+ fica como reserva.

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
| Piloto | Raytheon ST4000+ (painel, bússola e motor; falta a unidade de roda) | SeaTalk1 (e uma entrada NMEA 0183, confirmada no §2c) | **Só a proa: não governa** (§2c) |

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
| **NMEA 2000** | **em-trak B330** (AIS + GPS); depois o piloto EV-100 Wheel (SeaTalkNG, quando for montado), o GPSMAP 421 e o Axiom |
| 0183 IN 1 | NASA Clipper Wind (MWV), 4 800 baud |
| 0183 IN 2 | NASA Clipper Log (VHW/VLW), 4 800 baud |
| **USB–0183 (novo)** | NASA Clipper Depth (DBT/DPT), 4 800 baud |
| 0183 OUT 1 | Radar JRC 1000 + entrada GPS do RT750 (a mesma saída alimenta 2–3 recetores) |
| 0183 OUT 2 | **Livre.** O ST4000+ não tem a parte mecânica, por isso não há rota para lhe enviar; o piloto decidido (EV-100 Wheel) recebe a rota pela NMEA 2000, não por aqui |
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
  recebe o piloto EV-100 Wheel (decidido a 02/10, SeaTalkNG) e o Axiom.

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
- Com o depósito quase vazio, **encher de 20 em 20 L** (10 pontos até aos
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

**Motor (nota de 28/09 de manhã, resolvida no mesmo dia):** o motor é um **Volvo Penta D1-20B**
(§2b, "O que o D1-20B dá de facto"; a foto da chapa continua no §8b, ponto 4) e os dados vão ao Pi
pelo J1939 do MDI, por um adaptador USB–CAN feito por nós (§2b, "Alternativa DIY", e §4, "Motor
J1939: compras"). O gateway Yacht Devices YDEG-04 fica como plano B. O nível do gasóleo vem da
sonda analógica, à parte ("Nível do gasóleo", acima). Fontes do YDEG-04:
[Yacht Devices YDEG-04](https://www.yachtd.com/products/engine_gateway.html),
[notícia YD sobre EVC](https://www.yachtd.com/news/j1939_volvo_penta_evc_gateway.html).

**O ST4000+ tem a tecla `track`** e tem entrada NMEA 0183 (confirmado no §2c). Mas não governa
(falta a unidade de roda), por isso não se lhe liga nada.

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
SeaTalk1. Não se liga nada à entrada NMEA dele. O que está abaixo sobre a rota para o ST4000+ fica
como registo. (A 02/10 o Ivo decidiu o piloto: **Raymarine EV-100 Wheel**, por comprar e instalar,
`PILOTO-AUTOMATICO.md` §3. Esse recebe a rota pela NMEA 2000, "Fase 2b" no §4.)

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

**Resolvido a 28/09 (§2b):** o radar é um **JRC Radar 1000**, que não é suportado pelo radar_pi
nem pelo Axiom. Fica autónomo no ecrã dele e só recebe posição e proa pela 0183 OUT 1. O Pi 5 de
8 GB ficou escolhido na mesma (§1 e §4, item 1). O texto abaixo é o de antes de identificar o
radar.

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
| 7b | Cabo **micro-HDMI → HDMI** (o Pi 5 só tem micro-HDMI), com o comprimento até à roda (3–5 m; por medir: §8, ponto 7) | Amazon | a confirmar (1 m: €9,95) | + cabo USB do mesmo comprimento para o toque |
| 8 | Cartas o-charts Portugal | [o-charts](https://o-charts.org/shop/en/oesenc/79-portugal.html) | **~€20** (€16 s/IVA) | Continente, Açores e Madeira |
| 9 | Chave USB de licença o-charts | [o-charts](https://o-charts.org/shop/en/hardware/38-usb-key-dongle.html) | **~€23** (€19 s/IVA) | Recomendada: reinstalar o OpenPlotter apaga a licença; com a chave não se perde |
| 10 | ASA preto 1 kg | [EVOLT](https://evolt.pt/produto/asa-1kg-black-esun/) | **€17,73** (Winkle, em stock) | eSUN €21,39 esgotado. 1 bobina chega para o suporte e a pala |
| 11 | Porta-fusível em linha ATO/ATC IP55 | [SVB](https://www.svb24.pt/pt/seatec-porta-fusiveis-em-linha-ato.html) | **€3,32** | + fusível de 5 A |
| 12 | **Motor → Pi, feito por nós** (decidido 28/09, em vez do YDEG-04): ver a lista **"Motor J1939: compras"** abaixo | Amazon.es | **≈ €49** + cabo USB e fitas | O YDEG-04N (~€263,52) fica como **plano B** se o teste de escuta falhar |
| 13 | **ADS1115** (I²C) + resistências do divisor, para o nível do gasóleo | a cotar | **~€5–10** | Ver "Nível do gasóleo" |
| 14 | **Barómetro BME280** (pressão, temperatura, humidade) DFRobot Gravity I²C, com cabo | [Botnroll PT](https://www.botnroll.com/en/temperature/5336-gravity-i2c-bme280-environmental-sensor-dfrobot-sen0236.html) | **€23,80** | Liga à I²C da MacArthur. Montar **fora da caixa do Pi** (o calor falseia a temperatura). Alternativa: Adafruit €26,60 |
| 15 | **2 besouros piezo ativos 12 V, 95 dB a 30 cm**, 8 mA (1 no poço, 1 na **cabine do comandante**, junto ao beliche e ao ecrã 2) | [Botnroll PT](https://www.botnroll.com/en/sounders/861-buzzer-piezoelectrico.html) | **€3,60** (2 × €1,80) | Comandados pelo Pi por um **transístor NPN** (BC337 ou 2N2222) + resistência de 1 kΩ, a partir de um GPIO (cêntimos). Testar se o volume acorda quem dorme; se não, trocar por uma sirene de painel mais forte |
| 16 | **Sensor de inclinação (IMU) SparkFun 9DoF ICM-20948 (Qwiic)**: adorno e caimento para o abatimento | [RS Online](https://es.rs-online.com/web/p/kits-de-desarrollo-de-sensores/2836590) | **~€25,51** (€21,08 s/IVA) | Liga à ficha Qwiic/I²C da MacArthur. O da OpenMarine (€10 s/IVA) está esgotado e o revendedor dos EUA deixou de o vender por problemas de qualidade. Montar rígido e alinhado com o eixo do barco, longe de ferro |
| 17 | **Sensor de temperatura DS18B20 à prova de água, 2 m** (frigorífico) + resistência de 4,7 kΩ | [Botnroll PT](https://www.botnroll.com/en/temperature/429-sensor-de-temperatura-a-prova-de-agua-ds18b20-09m-.html) | **€4,65** (em promoção, antes €9,30) | 1-Wire num GPIO do Pi. Vários no mesmo fio: dá para juntar depois a casa do motor, a cabine, etc. Alarme se o frigorífico aquecer |
| | **Total** | | **≈ €596** (€482 dos itens 1–11 + €49,21 motor + ~€7,50 gasóleo + €23,80 barómetro + €3,60 besouros + €25,51 IMU + €4,65 frigorífico) | Sem portes, sem cabos e sem o kit N2K. Portes: contar €30–50 |

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
- ~~Pi 5 de **8 GB** em vez de 4 GB, se o radar entrar no ecrã.~~ Resolvido: o 8 GB já está na
  lista (item 1) e o radar fica autónomo (§3).

### Motor J1939: compras (preços vistos a 29/09/2026 na Amazon.es, c/IVA)

| Peça | Link | Preço | Nota |
|---|---|---|---|
| Adaptador **USB–CAN isolado** InnoMaker USB2CAN (gs_usb, SocketCAN nativo, 3000 V, jumper 120 Ω) | [B0956NV6CM](https://www.amazon.es/dp/B0956NV6CM) | **€37,02** | Em stock. Jumper de 120 Ω **desligado**: o barramento do MDI já tem terminação. **Não** comprar o Waveshare USB-CAN-A (protocolo série, não é SocketCAN) |
| Terminal **DB9 fêmea** → parafusos | [B08153D2F1](https://www.amazon.es/dp/B08153D2F1) | **€12,19** | O USB2CAN tem ficha DB9 (norma CiA: pino 7 CAN-H, 2 CAN-L, 3 massa; confirmar no manual) |
| ~~2 pares de fichas Deutsch DT 6 pinos~~ | [B0FKB6S6H3](https://www.amazon.es/dp/B0FKB6S6H3) | ~~€15,14~~ | **Dispensadas (29/09):** o Ivo liga direto à cablagem da Volvo (ver abaixo) |
| **Fita vulcanizada** (autoamalgamante) + fita isoladora de PVC + abraçadeiras | loja náutica / Amazon | a confirmar | Isolamento das emendas em T |
| ~~Cabo CAN blindado Lapp 10 m~~ | [B0CFLBKBDK](https://www.amazon.es/dp/B0CFLBKBDK) | ~~€36,53~~ | **Dispensado (29/09):** o adaptador fica junto ao motor, com uma derivação CAN curta (≤ 50 cm, os fios das fichas torcidos). O J1939 só admite derivações até ~1 m. Até ao Pi vai um **cabo USB** (até ~3 m) |
| Cabo USB-A → micro-USB com o comprimento até ao Pi (até ~3 m) | a cotar | a confirmar | Micro-USB é a ficha do USB2CAN |
| Manga termorretrátil **com cola** (sortido) + estanho | loja náutica / Amazon | a confirmar | Emendas soldadas, nunca de cravar em "T" |
| Hub USB alimentado (o Pi 5 só tem 4 portas USB) | a cotar | a confirmar | Já estava previsto (§7c) |
| **Total** | | **≈ €49** + cabo USB e fitas | Contra ~€263 do YDEG-04N |

**Ligação: DECIDIDO pelo Ivo (29/09) — direto à cablagem da Volvo, com
emendas em T soldadas** (em vez do cabo em Y). Como fazer:
1. **Identificar os fios antes de descarnar:** as cores não são conhecidas.
   Com o multímetro, pela traseira da ficha Deutsch (sem a abrir), achar os
   fios dos pinos **5 (CAN-H), 2 (CAN-L) e 4 (massa)**. Tudo desligado:
   **60–120 Ω entre o 5 e o 2**. O pino 6 (+12 V) não se toca.
2. **Ignição desligada e bateria isolada** enquanto se solda (eletrónica do MDI).
3. **Emenda em T:** descarnar ~10 mm a meio do fio sem cortar os filamentos,
   enrolar o fio da derivação, soldar com fluxo e **pouco estanho** (o estanho
   não pode subir pelo fio, que fica rígido e parte com a vibração).
4. **Desfasar as 3 emendas ~5 cm**; CAN-H e CAN-L **torcidos** até à emenda e
   na derivação.
5. **Isolar:** fita **vulcanizada** esticada a ~50% com meia sobreposição (sela
   e é estanque) e fita isoladora de PVC por cima. **Sem cola quente** (amolece
   com o calor do motor e não sela no PVC). A manga termorretrátil não entra
   numa emenda a meio do fio.
6. **Abraçadeiras dos dois lados de cada emenda**, a prender a derivação à
   cablagem, para a emenda nunca trabalhar com a vibração.
7. **Derivação curta (≤ 50 cm)** até ao adaptador USB–CAN junto ao motor
   (J1939 admite ~1 m); daí um cabo USB até ao Pi.
8. **Testar:** 60–120 Ω entre CAN-H e CAN-L na ponta do adaptador; sem
   continuidade entre o CAN e a massa ou os +12 V; o motor arranca e o
   conta-rotações funciona **antes** de ligar o adaptador; depois `candump can1`.

Nota: deixa de ser reversível em 10 s (a emenda fica na cablagem do motor).
Bem feita, dura; é a opção do Ivo.

### Água doce: compras (29/09, Amazon.es)

| Peça | Link | Preço | Nota |
|---|---|---|---|
| 3 sensores magnéticos (reed) com íman e cabo | [B093LBSDH1](https://www.amazon.es/dp/B093LBSDH1) | **€6,56** | 1 por pedal de água doce + 1 de reserva; a bomba de água do mar não leva |
| ESP32 DevKitC WROOM-32U com antena externa | [B0H1WQCMJ1](https://www.amazon.es/dp/B0H1WQCMJ1) | **€12,69** | Só se os pedais ficarem longe do Pi |

### Ordem das compras (decidida 28/09)

1. **Agora:** Pi 5 8 GB + MacArthur + ecrã de testes (esta lista).
2. **Depois:** o piloto automático — **Raymarine EV-100 Wheel (T70152)**, decidido pelo Ivo a 02/10
   (`PILOTO-AUTOMATICO.md` §3). Era o que esta lista de 28/09 já punha aqui.
3. **Mais tarde:** plotter **Axiom** (fase 3, abaixo).

### Fase 2b: o EV-100 na rede do Pi (depois de montado)

**Decidido a 02/10:** o piloto é o **EV-100 Wheel** (`PILOTO-AUTOMATICO.md` §3), ainda por comprar e
instalar. Esta fase faz-se **depois** de ele estar montado e testado sozinho. A integração com o Pi
(ler o estado do piloto e a proa do EV-1, mandar-lhe a rota ativa) e a revisão da regra das 8 h ao
leme da melhor rota ficaram fora da auditoria de 02/10: fazem-se nessa altura. O que está abaixo é o
plano de 28/09.

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

### Ecrã da roda: Lowrance HDS-9 Live do Ivo (28/09)

**Decisão de 28/09: fica para mais tarde.** Primeiro avança o plano original
(Pi + ecrã de testes LAFVIN); a HDS entra depois, se fizer sentido.

O Ivo tem uma **Lowrance HDS-9 Live, solta, com transdutor e cartão Navionics
da Península Ibérica**. É uma opção futura para o **ecrã 1 (roda)**, no lugar
do SailProof STS10 (€499):
- Ecrã tátil de 9" **SolarMAX HD** (lê-se ao sol), feito para o exterior;
  cartas **Navionics ou C-MAP** (as de Portugal compram-se à parte).
- Liga-se à **rede NMEA 2000**: o Pi põe lá vento, fundo, velocidade, proa,
  motor e gasóleo, e o B330 põe o AIS. A HDS mostra tudo, com alarmes AIS.
- **Sonda CHIRP própria:** dá um **segundo valor de fundo**, útil a solo como
  reserva da NASA Clipper Depth.
- Não mostra o OpenCPN nem o diário (não tem entrada de vídeo): esses ficam no
  ecrã 2 (LAFVIN, mesa de navegação) e no telemóvel.
- Radar: só Navico (Broadband/Halo). O JRC continua no ecrã dele.
- Com o EV-100 (decidido a 02/10, por instalar): seguir rota pela NMEA 2000 deve funcionar; a
  confirmar.
- **A fazer:** suporte na roda (o suporte e a pala em ASA desenham-se para a
  HDS em vez do SailProof); alimentação 12 V com fusível; derivação N2K;
  identificar o **modelo do transdutor** e escolher a montagem num veleiro
  (de popa não serve bem com o barco adornado e o espelho invertido; em
  princípio, dentro do casco ou por passa-casco).

### Função "Recolher velas" (pedido do Ivo, 28/09; a versão automática só com um piloto)

**Hoje, sem piloto,** a página **Velas** do ecrã guia a manobra à mão, passo a passo: liga o motor,
aproa ao vento com o rumo indicado, recolhe as velas e termina; cada passo fica no diário. O que
está abaixo é a versão automática de 28/09, que só serve com um piloto que aceite rumo do Pi (o
EV-100 Wheel decidido a 02/10, depois de montado e integrado: `PILOTO-AUTOMATICO.md` §3).

Um botão no ecrã (Pi, e mais tarde a HDS) que põe o barco **aproado ao vento
com o motor a dar seguimento**, para o Ivo recolher as velas a solo.

**O que o Pi pode e não pode fazer:**
- **Pode:** comandar o EV-100 pelo SignalK (`signalk-autopilot`): pôr em
  auto e **rumo = direção do vento**, calculada a partir do vento aparente e
  da proa; ler as **rotações do motor** (CAN) e a **velocidade na água**
  (log).
- **Não pode:** ligar o motor, meter a mudança nem acelerar. O D1-20B tem
  manete mecânica e o Pi só **escuta** o CAN do motor. Automatizar o arranque
  e a mudança seria um risco de segurança (cabos na água, hélice) e fica
  **de fora**.

**Sequência:**
1. O Ivo liga o motor e mete **avante devagar** (ex.: 1200–1500 rpm).
2. Carrega em **"Recolher velas"**. O Pi verifica: motor a trabalhar
   (rotações > 0), seguimento (velocidade na água > ~1,5 nós), vento válido,
   EV-100 presente. Se falhar alguma, **não faz nada** e diz porquê.
3. O Pi põe o EV-100 em auto com o rumo **à proa do vento**, com um
   **desvio configurável** (ex.: 10–15° para um dos bordos, para o barco não
   ficar a "bater" nem a mudar de bordo sozinho; lado escolhido no ecrã).
4. Durante a manobra, o ecrã mostra o vento aparente, as rotações e a
   velocidade. **Alarme no besouro** se o motor parar ou a velocidade cair
   abaixo do mínimo.
5. **"Terminar"**: volta ao rumo anterior ou a standby (à escolha).

**Segurança:** o botão **standby do p70s** tem sempre prioridade; testar em
águas calmas.

**Registo automático no diário de bordo** (signalk-logbook), duas entradas:
- **Início:** "17:38 Recolher velas: aproado 15° EB · posição · vento aparente
  e real · motor 1 350 rpm · 2,1 nós".
- **Fim:** "17:44 Velas recolhidas · duração 6 min · terminou em rumo
  anterior/standby".
- Se a manobra for **abortada** (motor parou, sem seguimento, standby no
  p70s), fica registado **o motivo**.

### Abatimento, corrente e informação da viagem (pedido do Ivo, 28/09)

- **Corrente (set/drift), vento real, VMG:** plugin `signalk-derived-data`, a
  partir da proa, velocidade na água (log NASA), COG/SOG (GPS) e vento.
- **Abatimento (leeway):** precisa do **ângulo de adornamento** (heel). Juntar
  um **sensor de inclinação (IMU) I²C**: o ICM-20948 da OpenMarine (~€12 c/IVA,
  estava esgotado) ou equivalente. Fórmula clássica: abatimento = K × adorno /
  velocidade², com **K calibrado para o Arlequin**; ou o plugin
  `speedandcurrent`, que estima abatimento e corrente a partir dos dados.
- **Na carta (OpenCPN):** linha de proa, vetor COG/SOG, **seta da corrente**,
  **ângulo de abatimento** e **laylines** (plugin `tactics_pi`), e o rasto
  gravado da viagem.
- **Resumo da viagem** (diário + OpenCPN): distância, tempo, velocidade média
  e máxima, horas de motor, gasóleo estimado, vento médio e máximo, pressão
  inicial e final, rasto em GPX.

Fontes: [signalk-derived-data](https://github.com/SignalK/signalk-derived-data),
[speedandcurrent](https://github.com/Asw1n/speedandcurrent).

### Melhor rota (routing meteorológico), pedido do Ivo, 28/09

**Substituído (29/09–01/10)** pelo plugin `signalk-arlequin-rota` (ver "Melhor rota (cálculo)" e
"A navegar", na secção 11); o Weather Routing do OpenCPN fica disponível à parte. A polar
aprende-se com a AI do barco ("AI a bordo"), e não com o `signalk-polar-builder`. O texto abaixo é
o de 28/09.

Dá, com três peças no OpenCPN/SignalK:
1. **Previsão (GRIB):** vento, ondulação, pressão e correntes para os
   próximos dias. Descarregada pelo **plugin GRIB do OpenCPN** quando há
   internet (4G ou Starlink). Ao largo, sem rede, fica a última previsão
   descarregada. O **Meshtastic não serve** para isto: as mensagens são
   pequenas de mais.
2. **Polar do Arlequin** (velocidade do barco para cada vento e ângulo):
   começa com uma polar genérica de um barco parecido e vai sendo
   **aprendida automaticamente** a partir dos instrumentos a navegar (plugin
   `signalk-polar-builder`: vento real, velocidade na água, adorno).
3. **Cálculo da rota:** plugin **Weather Routing** do OpenCPN. Calcula por
   isócronas a rota mais rápida, com limites que o Ivo define para navegar a
   solo (vento máximo, ondulação máxima, ângulo mínimo ao vento, evitar
   terra, motor abaixo de X nós de vento).

A rota calculada passa a **rota ativa**: aparece na carta e, com o EV-100, o
piloto segue-a em track. Recalcula-se sempre que chega uma previsão nova.
**É uma ajuda à decisão, não uma garantia:** a previsão pode falhar, e a
decisão de sair é sempre do skipper.

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
  digitais antigos). O radar atual tem de ser identificado primeiro. (Foi: é um JRC Radar 1000,
  que o Axiom não mostra; fica no ecrã dele, §2b.)
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
  AIS, vento, a rota para o piloto (quando houver piloto), o Wi-Fi para a
  Navionics e o consumo real.
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

## 5b. Balanço de energia com as baterias AGM (estimativa, 28/09)

**Baterias:** 3 bancos × 2 × 110 Ah, seladas, **provavelmente AGM** (a
confirmar na etiqueta). Banco 1 = motor; bancos 2+3 = **serviço 440 Ah**.
- AGM: não descer abaixo de **50%** → **~220 Ah úteis**. Na prática, a
  carregar pelo motor ou pelo sol, as AGM demoram muito a encher acima de
  ~85%, por isso a janela real entre cargas é **~150 Ah** (50→85%).

**Consumos estimados por dia (a confirmar com o monitor de bateria):**

| Carga | A navegar 24 h | No porto (Pi sempre ligado) |
|---|---|---|
| Pi 5 + HAT + SSD (~7 W) | 14 Ah | 14 Ah |
| Ecrã 1 roda (LAFVIN, ~5 W) | 10 Ah | — |
| Ecrã 2 mesa (7", modo noite) | 6 Ah | — |
| Instrumentos NASA + ST50 | 7 Ah | — |
| AIS B330 (170 mA) | 4 Ah | 4 Ah (se ligado) |
| VHF RT750 em escuta (0,5 A) | 12 Ah | — |
| Radar JRC 1000 (~8 h de noite) | ~19 Ah | — |
| Navtex, Meshtastic, sensores | 4 Ah | 3 Ah |
| Router 4G (~3 W) | 6 Ah | 6 Ah |
| Luzes de navegação (LED) | ~2 Ah | — |
| Luzes interiores, telemóvel, etc. | 5 Ah | — |
| **Subtotal** | **~89 Ah** | **~27 Ah** |
| Frigorífico a compressor (confirmado 28/09; 120 L de origem) | +30–40 Ah (verão pode passar dos 40) | desligado quando o barco fica sozinho |
| Piloto EV-100 Wheel, quando for montado (2–4 A) | +50–100 Ah | — |
| **Total** | **~120 Ah (sem piloto) · ~185 Ah (com EV-100)** | **~27 Ah** |

"Com EV-100", aqui e no §5c, quer dizer com o piloto decidido a 02/10, o EV-100 Wheel (2–4 A). Hoje
ainda não há piloto: está por comprar e instalar (`PILOTO-AUTOMATICO.md` §3).

As duas linhas dos ecrãs juntam o LAFVIN na roda e um 2.º ecrã na mesa, o que não acontece ao mesmo
tempo: na fase 1 não há ecrã 2 (menos ~6 Ah); na fase 2 a roda leva o STS10, que gasta mais (~19 W
no brilho máximo, §5), e o LAFVIN passa para a mesa.

**O que isto quer dizer:**
- **No porto:** 220 Ah úteis ÷ 27 Ah/dia ≈ **8 dias** sem carregar.
- **A navegar:** com o EV-100, gasta-se **quase toda a janela útil num dia**.
  É preciso carregar todos os dias (motor e/ou solar).
- **Solar necessário** (Portugal, perdas ~25%):
  - Porto, no inverno (~2,7 h de sol útil): **~150–200 W**.
  - A navegar, no verão (~6,5 h), sem piloto: **~300 W**; com o EV-100:
    **~450–500 W**. Realista num 34 pés: **300–400 W** no arco de popa ou
    na capota, mais o motor nos dias de pouco sol.
- **Luzes de navegação: LED (decisão do Ivo, 28/09).** Se as atuais não forem
  LED, o Ivo troca-as. As contas assumem LED (~2 Ah por noite em vez de ~25).
  Ao trocar, escolher luzes **homologadas (COLREG)** para barcos até 12 m.

## 5c. Solar 2 × 305 W cruzado com o balanço (28/09)

Produção = 610 W × horas de sol útil × 0,55–0,75 (perdas, painel deitado,
sombras de radome/retranca/velas) ÷ 13 V. Sol útil: inverno 2,7 h,
primavera/outono 5,0 h, verão 6,5 h.

| Situação | Produz (Ah/dia) | Gasta (Ah/dia) | Saldo |
|---|---|---|---|
| Porto, inverno (Pi sempre ligado) | 70–95 | 27 | **+43 a +68** |
| Porto, inverno, com frigorífico | 70–95 | ~62 | **+8 a +33** |
| A navegar, verão, sem piloto | 168–229 | ~120–130 | **+38 a +109** |
| A navegar, verão, com EV-100 | 168–229 | ~185–200 | **−32 a +44** |
| A navegar, primavera/outono, sem piloto | 129–176 | ~120 | **+9 a +56** |
| A navegar, primavera/outono, com EV-100 | 129–176 | ~185 | **−56 a −9** |
| A navegar, inverno, sem piloto | 70–95 | ~120 | **−50 a −25** |
| A navegar, inverno, com EV-100 | 70–95 | ~185 | **−115 a −90** |

**Conclusões:**
- **No porto** o barco fica autónomo o ano todo, mesmo com o frigorífico.
- **A navegar sem piloto:** autónomo da primavera ao outono.
- **Com o EV-100 no verão:** fica perto do equilíbrio; num dia de sombra
  falta pouco, e a janela de ~150 Ah aguenta uns dias.
- **Com o EV-100 fora do verão, e no inverno em geral:** falta energia. Uma
  hora de motor dá mais ~40–60 Ah (estimativa, depende do separador e da
  aceitação das AGM); no inverno com piloto são ~2 h de motor por dia.
- **AGM:** o sol raramente as leva aos 100%. Uma carga completa no cais de vez
  em quando (por exemplo uma vez por mês) prolonga-lhes a vida.
- Estas contas são estimativas. Os valores reais vêm do SmartShunt ao fim de
  algumas semanas.

### Aerogerador (analisado 28/09; retirado do plano pelo Ivo)

Estimativa com a distribuição de Rayleigh e curvas aproximadas dos
fabricantes, com perdas de 15%. Na prática, contar com cerca de metade.

| Vento médio | Silentwind 400+ | Rutland 914i |
|---|---|---|
| 3,5 m/s (marina abrigada) | até ~45 Ah/dia | até ~22 Ah/dia |
| 4,5 m/s | até ~90 Ah/dia | até ~47 Ah/dia |
| 5,5 m/s (inverno ventoso, fundeado) | até ~145 Ah/dia | até ~80 Ah/dia |

**Preços (28/09):** Silentwind 400+/Pro 12 V €525–740 (livre.pt, NautiRadar,
nootica) · Rutland 914i ~€900–1000 · Superwind 350-II ~€2900. A isto
somam-se o mastro ou suporte (€200–400) e o controlador próprio com
resistência de descarga (os MPPT Victron não servem para vento).

**Recomendação (a decisão é do Ivo):** por agora não comprar. Só ajuda no caso "inverno com EV-100".
Traz peso e ruído à popa, faz sombra aos painéis e o arco já tem o radar e os
painéis. Deixar previsto no arco um ponto de fixação e a passagem do cabo.
Decidir depois de uma época de dados do SmartShunt.

### Carregar com o motor no inverno (28/09)

- O alternador do D1-20 é de **115 A / 14 V** com regulador interno
  (confirmar na placa do D1-20B). A 1500–1800 rpm dá na prática cerca de
  60–80 A, **se o separador não tiver díodos**. Com díodos perde ~0,7 V e
  cai para cerca de 20–40 A.
- Com o serviço a 50–80%, as AGM aceitam bem a carga (~40–70 Ah por hora de
  motor). Acima de ~85% a corrente cai muito.
- **Estratégia:** ligar o motor com o serviço a ~55%, carregar até ~80–85% e
  deixar o sol acabar a carga. Não correr horas ao ralenti sem carga, porque
  o motor vidra os cilindros. Usar ~1500–1800 rpm, de preferência a navegar.
- **Custo:** ~0,8–1 L/h de gasóleo, ou seja ~2 L por dia no inverno com o
  EV-100. É mais barato que o aerogerador se forem poucos dias de inverno a
  navegar.
- **Melhoria barata:** se o separador for de díodos, trocá-lo por um VSR/ACR.
- **O Pi ajuda:** alarme "serviço a 55%, ligar o motor" e "85%, pode desligar"
  a partir do SmartShunt, com as horas de motor e os Ah carregados a irem
  para o diário.

## 6. Reserva (obrigatória a solo)

Com tudo num ecrã só, esse ecrã passa a ser um ponto único de falha.
- O **plotter atual mantém-se** ligado à rede, como segundo ecrã.
- **VHF, AIS e Navtex funcionam sozinhos** se o Pi falhar.
- A **Navionics no telemóvel** tem GPS próprio e cartas offline.
- O **ST4000+** ainda **não governa** (falta a unidade de roda: ver `PILOTO-AUTOMATICO.md`).
  Hoje a única reserva de governo é a cana de emergência (`LEME-EMERGENCIA.md`, Camada A). Do
  ST4000+ só se lê a proa (bússola fluxgate), e essa funciona sem o Pi.
- O piloto decidido a 02/10, o **EV-100 Wheel**, ainda não está comprado nem montado: até lá não
  conta como reserva de nada (`PILOTO-AUTOMATICO.md` §3).

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
  para escolher o estilo. Não gerar maquetas 3D como referência.
- Prever um **comando físico** (teclado ou roda pequena Bluetooth/USB) para
  zoom e confirmar alarmes com luvas ou com o ecrã molhado.

## 7a. Produto final: maqueta e funções (28/09)

**Maqueta interativa de 28/09 (histórico):** [`maqueta-arlequin.html`](maqueta-arlequin.html)
(abrir no browser; 9 botões a funcionar). Foi substituída em quatro pontos: os limites a solo que
mostra (25 nós, ondas de 2,5 m, motor abaixo de 5 nós) passaram a 22 nós de vento médio, 30 de
rajada e 3 m de ondas, com o motor abaixo de 7 nós; o consumo (~4 L/h a 2 150 rpm) é ~1,5 L/h pela
curva da Volvo; o modo noite deixou de ser vermelho (abaixo); e a melhor rota é o plugin próprio
(secção 11). O ecrã a sério é o `software/arlequin-ecra`. **Polar estimada:**
[`polar-arlequin-estimada.csv`](polar-arlequin-estimada.csv) é uma cópia de 28/09, com os mesmos
números: o código (o ecrã, a AI e a rota) lê a `software/arlequin-ecra/public/polar-arlequin.csv`,
e é essa que conta. Trocar a da raiz não muda nada.

| Botão | Função |
|---|---|
| Carta | OpenCPN: rota, rasto, proa, COG, **abatimento**, **corrente**, **laylines**, AIS, vento real + painel (vento, proa, velocidades, fundo, **% da polar**, AIS, motor, gasóleo) |
| Instr. | Vento grande + VMG, **polar com alvo e real**, desempenho, proa, fundo, adorno, barómetro e tendência, corrente |
| AIS | Lista CPA/TCPA, alarmes, estado do B330, detalhe do alvo (silenciar, chamar por DSC a confirmar, centrar) |
| Motor | Rotações, temperatura, tensão, horas, alarmes do MDI, consumo estimado, gasóleo |
| Viagem | Rota em track, XTE, VMG ao WP + **resumo da viagem** (distância, tempo, médias, vela/motor, polar, gasóleo, vento, pressão, abatimento, corrente, GPX) |
| Diário | signalk-logbook: hora a hora, motor, **velas**, **rota**, **alarmes (e se foram por Mesh)**, entradas de um toque, cópia Wi-Fi |
| Melhor rota | (28/09: GRIB + polar + Weather Routing, isócronas, ativar no piloto: **substituído**.) Hoje é o plugin `signalk-arlequin-rota` (secção 11): o destino e a tripulação, as 3 melhores alternativas com o veredicto, o mini-mapa, o plano para terra pelo Telegram, Ativar e o Leme a navegar |
| Velas (era "Rec. velas") | O estado da grande e da genoa (a AI precisa dele) e o Recolher velas **sem piloto**, passo a passo: liga o motor, aproa ao vento com o rumo indicado, recolhe, terminado; tudo no diário. (Em 28/09 aproava com o EV-100: decidido a 02/10, ainda por instalar) |
| Noite | As cores do dia muito escurecidas, com − e + para o brilho (ver abaixo) |

**Modo noite (decisão do Ivo de 01/10; substitui o modo noite a vermelho de 29/09):** o Ivo não
distinguia as linhas coloridas em vermelho e não gosta dele. O modo noite passa a ter **as mesmas
cores do dia** — vela azul, motor cinzento, perigo vermelho, ok verde, avisos âmbar, a terra e o mar
do mini-mapa — **muito escurecidas**, sobre fundo preto, com o texto em cinzento escuro e sem áreas
grandes claras (nem brancas nem azul-claras). Ao lado do botão **Noite** ficam **−** e **+** (só de
noite, 44 px para o dedo): 5 níveis de brilho (1 o mais escuro, **2 por omissão**, 5 o mais claro);
o nível fica guardado no ecrã e o botão diz "Noite 2/5". Vale para todas as páginas (Carta, Instr.,
AIS, Motor, Viagem, Diário, Melhor rota com o mini-mapa e o Leme, Velas). Capturas do nível mais
escuro e do mais claro em `docs/capturas-3b2/noite-brilho-1.png` e `noite-brilho-5.png`.

Barra de cima sempre visível: nome, hora, GPS, **Meshtastic**, **4G**,
pressão, **estado do piloto**, **alarme AIS**.

**Dependências:** seguir a rota em track, mandar a melhor rota ao piloto e um Recolher velas
automático precisam de um **piloto automático**, que **ainda não há** (o EV-100 Wheel está decidido
mas por comprar e instalar: `PILOTO-AUTOMATICO.md` §3); hoje o Recolher velas faz-se à mão, guiado
pela página Velas. O
abatimento precisa do **sensor de inclinação**; a polar começa **estimada** e aprende-se a navegar.

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
- **Botões em baixo:** Carta, Instrumentos, AIS, Motor, Rota, **Diário** e Noite. Hoje, no ecrã,
  são 9: Carta, Instr., AIS, Motor, Viagem, Diário, Melhor rota, Velas e Noite (com − e + de
  noite).
- Montagem na **horizontal**: o suporte e a pala desenham-se para isso.
- Implementação: OpenCPN (carta, AIS, rota) + painel de instrumentos do
  **KIP** (SignalK) ou do próprio OpenCPN (dashboard), a decidir na montagem.

## 7c. Diário de bordo (pedido do Ivo, 28/09)

Página **Diário** no ecrã (hoje o 6.º botão, entre Viagem e Melhor rota). Base: o plugin do
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
- **Barómetro** I²C (BME280) na MacArthur: já está na lista de material (§4, item 14: DFRobot
  Gravity, €23,80). O diário passa a registar a **pressão atmosférica** de hora a hora, que é o
  dado mais útil para ver o tempo a mudar a solo.
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

**Planta (ficha técnica Jeanneau, em `Documents\Veleiro\brochura`):** de popa
para proa: cabine de popa com cama de casal a **estibordo**, por baixo do poço;
**mesa de navegação a estibordo** à frente dela; cozinha a bombordo; escada
ao centro; sala com beliches dos dois lados (os **depósitos de água** estão
debaixo deles); WC; cabine de proa; poço da âncora. Dados de origem: água
**180 L**, gasóleo **90 L** e motor Yanmar 2QM. Hoje o barco tem **200 L de
gasóleo** e um **Volvo D1-20B**, por isso foi alterado. O plugin da água assume **2 × 80 L** por
omissão ("capacidades a confirmar no barco"): fica por medir cada depósito (§8b, ponto 11).

O Ivo descansa **na cabine junto à mesa de navegação**. Daí vê o poço pelas
janelas, um bocado do mastro e os manómetros do motor. O sistema tem de
funcionar também ali:
- **O Pi fica instalado junto à mesa de navegação**, que é seca e perto do
  quadro. O cabo longo é só o do ecrã da roda.
- **Dois ecrãs no mesmo Pi** (na fase 2; na fase 1 o LAFVIN está na roda e não há ecrã 2): o Pi
  5 tem **duas saídas micro-HDMI**.
  - Ecrã 1: o de 10" na roda (o SailProof STS10).
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

1. ~~**Radar**: a etiqueta da antena e da unidade (modelo exato). **Prioridade.**~~ Resolvido a
   28/09: JRC Radar 1000 (§2b).
2. **Plotter**: a frente, a etiqueta de trás e **as fichas e os fios de trás**.
3. **AIS, VHF, Navtex, anemómetro**: a etiqueta e as fichas de cada um. As
   fichas mostram se o aparelho é NMEA 0183, SeaTalk ou NMEA 2000.
4. ~~**ST4000+**: os terminais de trás do painel (se tem NMEA IN).~~ Resolvido pela documentação
   (§2c): tem NMEA IN.
5. **Quadro elétrico e baterias**: as etiquetas e quantas são.
6. **Pedestal da roda**: foto de frente e **diâmetro do tubo da guarda**
   (paquímetro; costuma ser 25,4 mm).
7. **Caminho do cabo** do pedestal até ao sítio seco onde fica o Pi. O comprimento está por medir
   e decide os cabos HDMI e USB do ecrã (§4, item 7b). As notas de 28/09 davam dois valores: no
   máximo 3,5 m com as extensões do ecrã (este ponto, e o diagrama do §2, que dizia "2 + 1,5 m")
   e 3–5 m (§4): por confirmar pelo Ivo. O USB 2.0 passivo, o do toque, não passa dos 5 m.

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
15. **Baterias (3 bancos × 2 × 110 Ah, seladas: 1 motor, 2 serviço):** foto da
    etiqueta de uma bateria de cada banco (AGM/gel/SLA, data), dos comutadores,
    do que divide a carga do alternador (díodos/VSR/DC-DC) e do carregador de cais.
16. **Painéis solares (decidido 28/09): no arco de popa, ao lado do radar, a
    fazer também de teto/sombra por cima da roda, sem chegar à retranca.**
    Fotos do arco (de trás e de lado) e medidas: largura útil de cada lado do
    radar, comprimento disponível para a frente, diâmetro dos tubos, altura do
    arco acima do piso do poço, distância do arco à roda, e a altura do Ivo.
    Plano: 2 painéis rígidos (400–500 W se forem por cima da roda), um MPPT
    Victron SmartSolar por painel (sombra do radome), SmartShunt no serviço,
    tudo lido pelo Pi por Bluetooth; perfil de carga AGM.
    **Preços (28/09):** painel 185 W 12 V €134–155 · 190 W 24 V série 4C €106,41
    (FV Componentes) · 305 W 20 V €164–235 · MPPT SmartSolar 75/15 ~€88 ·
    SmartShunt 500 A €91,54. **Opção A** 2×~190 W só no arco ≈ €480–580 +
    suporte; **opção B** 2×305 W em teto ≈ €660–860 + estrutura inox
    (€300–600, a cotar). Painéis de 305 W precisam de MPPT 100/20 ou 100/30.
    **Ligação:** strings independentes, **um MPPT por painel** (sombra/avaria
    não afeta o outro), ambos para o **banco de serviço** (bancos 2+3 sempre em
    paralelo = 440 Ah). **Bateria do motor:** manter carregada por **VSR/ACR
    bidirecional** ou **carregador de manutenção** (echo charger), conforme o
    separador que já existir. Fusível à saída de cada MPPT; ambos em perfil AGM.
    **Escolhido (28/09): opção B, 2 × 305 W** (610 W no total) em teto por cima
    da roda. Cada painel tem um **MPPT SmartSolar 100/30** (com 305 W a 12 V dá
    ~23 A; o 75/15 cortava a 15 A e o 100/20 a 20 A). Fusível de **40 A** à saída
    de cada MPPT, junto às baterias. Preço do MPPT 100/30 (29/09): **€129,95** na
    [SVB](https://www.svb24.pt/pt/victron-controlador-de-carga-solar-smartsolar-mppt-100-30.html). Cabo de 6 mm² do MPPT às baterias (troço
    curto) e 4–6 mm² com MC4 do painel ao MPPT. Confirmar que o Voc a frio do
    painel escolhido fica abaixo de 100 V. Produção estimada: ~168–229 Ah/dia
    no verão e ~70–95 Ah/dia no inverno (o quadro do §5c; aqui dizia ~150–180 e ~60–80).
    **Painel candidato (29/09):** Victron BlueSolar 305W-20V mono
    (SPM043052002): 1658 × 1002 × 35 mm, 19 kg; Vmp 32,5 V, Imp 9,38 A, Voc
    39,7 V, Isc 10,27 A. Com o MPPT 100/30: Voc a 0 °C ≈ 43 V (< 100 V),
    ~22,6 A a 12 V (< 30 A), Isc < 35 A. Dois lado a lado = 2,0 m (través) ×
    1,66 m (proa-popa), 38 kg. Preço €199–268 conforme a loja. Alternativas se
    não couber: 2 × 215 W (1580 × 705 mm, 11,7 kg) ou 2 × 185 W (1485 × 668 mm,
    11 kg, chegam MPPT 75/15). **Fecha-se com as fotos e medidas (Ivo, 30/09).**
    **Estrutura do teto (29/09):** o arco inclina-se para ré e o topo passa pouco
    do espelho. Opções desenhadas: A pernas nas braçolas; B consola (não); C
    escoras; D centrada no arco (0,83/0,83 m, radar num poste +40 cm); E toda
    atrás (não: ~1,4 m sobre o mar, mais comprimento na marina). **Proposta:
    D ajustada** ~0,4 m para ré do topo do arco e ~1,25 m para vante, com duas
    escoras curtas das pernas do arco (a inclinação ajuda), sem pernas no poço.
    Medidas extra pedidas: recuo do arco (base → topo, na horizontal) e quanto
    o topo passa do espelho. Falta decidir: serralheiro (soldado) ou o Ivo
    (aparafusado com peças de inox).
    **Comprimento na marina (Ivo, 29/09): sem problema até aos 12 m** (o
    Melody tem 10,55 m fora a fora e 10,25 m de casco: ver §0b). A D centrada
    (+~0,8 m, ~11,4 m) fica dentro do escalão; a escolha entre D centrada e D
    ajustada passa a ser só **sombra na roda** contra **estrutura mais simples**.

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

## 10. Monitorização no porto (notas de 28/09, antes do plugin porto)

**Substituído (29/09):** a monitorização no porto é o plugin `signalk-arlequin-porto`, no mesmo
Pi: alarmes e comandos pelo **Telegram**, com o router Teltonika **RUT241** (desenho
`docs/superpowers/specs/2026-09-29-porto-design.md`); o Meshtastic fica para depois de o sistema
estar validado. A base é o próprio Pi, com o SmartShunt lido por Bluetooth, e não o Victron Cerbo
GX. O solar decidido é de **2 × 305 W** (§8b, ponto 16) e, com 220 Ah úteis e ~27 Ah/dia, o barco
aguenta **~8 dias** sem carregar (§5b). O texto abaixo é o de 28/09.

### Atualização de 28/09: decisões para a monitorização no porto
- **O mesmo Pi fica sempre ligado.** O Ivo vai pôr painéis solares; a energia
  fica para depois.
- **Alarmes críticos por rádio Meshtastic** (placa Heltec WiFi LoRa 32 V3, 868
  MHz, ligada ao Pi por USB): fumo, água no porão, fuga de gasóleo, intrusão,
  bateria baixa. **4G como via garantida** para detalhes e câmaras.
- **Barco em Peniche, Ivo em Lisboa (~75–80 km).** No mapa meshtastic.pt não
  há nós em Peniche; os mais próximos são TasMouvir (Lourinhã, ~12 km) e
  PMNKY (~20 km), há routers na zona de Torres Vedras/Montejunto (ARADO2ER a
  383 m) e ~100 nós em Lisboa. A cadeia é possível mas **tem de ser testada**.
- **Teste em curso** com a placa do Ivo e a de um amigo. Definições da
  comunidade PT: EU_868, **LongFast**, **no máximo 4 saltos**, firmware Beta,
  **nunca o modo Range Test**. Canal privado com chave para os alarmes;
  antena da placa do barco no alto e por fora; usar traceroute; registar
  RSSI e SNR.

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

## 11. Software a bordo

O código está em `software/` (que pasta é o quê e como se testa no portátil: `software/README.md`).
Aqui fica o que cada parte faz no barco e o que é preciso no Pi.

### Caminhos próprios do Arlequin (fora da norma SignalK)

Quase tudo usa os caminhos normalizados do SignalK. Estes não existem na norma: foram criados para
o Arlequin.

| Caminho | Valor | Quem publica | Quem lê |
|---|---|---|---|
| `sails.grande.rizos` | 0 inteira, 1 ou 2 rizos, −1 arriada | caixa negra (botões da página Velas) | ecrã (Velas), caixa negra (tabela da AI) |
| `sails.genoa.percentagem` | percentagem, 0–100 (a norma usaria uma razão 0–1) | caixa negra (página Velas) | ecrã (Velas), caixa negra (tabela da AI) |
| `sensors.porao.agua`, `sensors.porao.bomba`, `sensors.fumo`, `sensors.gasoleo.liquido`, `sensors.gaiuta.aberta`, `sensors.movimento` | 0/1 (ou falso/verdadeiro) | os sensores do barco parado: um ESP32 (SensESP) ou o GPIO do Pi | plugin porto (caminhos configuráveis) |
| `tanks.fuel.0.senderVoltage`, `tanks.fuel.0.supplyVoltage` | V (a sonda e a alimentação do medidor) | a app I2C do OpenPlotter (ADS1115, A0 e A1) | plugin do gasóleo (caminhos configuráveis) |
| `tanks.freshWater.N.pedaladas` | contador acumulado das pedaladas da bomba de pé | o contador dos sensores reed dos pedais: um ESP32 (SensESP) ou o GPIO do Pi | plugin da água (caminho configurável) |
| `propulsion.main.fuel.rateOrigem` | `medido` (PGN 65266 do MDI) ou `estimado` (curva da Volvo) | plugin J1939 | caixa negra (coluna `consumoMedido`) |

As notificações também têm nomes próprios (`notifications.arlequin.*`, `notifications.rota.*`), o
que a norma permite.

### Caixa negra e Tailscale (dados para o Claude analisar)

**O que grava** (plugin `signalk-arlequin-caixanegra`), em `~/arlequin-dados` no Pi, desde o primeiro dia:
- `bruto/`: todas as mensagens, 1 ficheiro por hora;
- `tabela/`: 1 linha a cada 10 s, para a AI;
- `saidas/`: resumo de cada saída;
- `previsoes/`: escrito por dois plugins — o da AI guarda a previsão para a posição do barco (de
  hora a hora a navegar, de 3 em 3 h parado) e o da rota guarda um ficheiro por ponto da rota,
  sempre que descarrega a previsão para um cálculo.

**Regras do disco:**
- **Aos 80 %**, apaga do `bruto/` só o que o portátil já confirmou, o mais antigo primeiro, até
  ficar abaixo dos 75 % (a folga evita que o aviso vá e venha). Se, mesmo assim, o disco ficar nos
  80 % ou mais (falta copiar e confirmar no portátil), avisa no ecrã: "copia os dados para o
  portátil".
- **Aos 95 %**, se o disco continuar aí depois de apagar tudo o que já foi confirmado, pára o
  `bruto/` (a tabela continua) e dá o alarme, que vai também para o Telegram. O bruto volta a
  gravar quando o disco desce abaixo dos 90 %.
- Nunca apaga nada que não esteja no portátil.

**Tailscale: feito pelo Ivo, uma vez** (o Claude não trata contas nem palavras-passe):
1. Criar a conta em tailscale.com (entrar com Google ou Microsoft).
2. No portátil: instalar o Tailscale para Windows e entrar com a conta.
3. No Pi, com rede (o telemóvel em ponto de acesso serve):
   - `curl -fsSL https://tailscale.com/install.sh | sh`
   - `sudo tailscale up --ssh --hostname arlequin`
   - abrir o link que aparece e aprovar com a conta.
4. Testar no portátil: `ssh pi@arlequin "ls ~/arlequin-dados"`.

**Relógio do Pi certo** (uma vez): os nomes dos ficheiros e a junção dos dados com as previsões e as saídas dependem da hora do Pi. A bordo não há Internet para a acertar e, sem pilha, o Pi arranca com a hora errada.
- Pôr a **pilha do relógio (RTC) do Pi 5** (a oficial, recarregável, na ficha "BAT").
- E acertar a hora pelo GPS: plugin **`@signalk/set-system-time`** no SignalK (ou o equivalente do OpenPlotter).
- Se mesmo assim a hora do GPS e a do Pi diferirem mais de 1 min, o ecrã avisa "Relógio do Pi desacertado" (só no ecrã, não vai para o Telegram).

**Copiar os dados** (sempre que estiveres a bordo com rede):

```
node software/ferramentas/sincronizar/sincronizar.mjs --host pi@arlequin
```

- Os dados ficam em `Documents\Veleiro\arlequin-dados`.
- Recomendado: incluir esta pasta na cópia de segurança do Windows ou no OneDrive.
- Sem rede, também dá com uma pen: `--origem E:\arlequin-dados`. Pela pen **só se copiam** os dados: a confirmação ao Pi (que o deixa libertar espaço aos 80%) só acontece por ssh/Tailscale. O portátil só dá um ficheiro como confirmado quando o `confirmados.json` do próprio Pi o tem.

### AI a bordo (plugin `signalk-arlequin-ia` + pacote `software/arlequin-ia`)

- **Instalar no Pi** (uma vez):
  - **Onde ficam as coisas:** o repositório clonado no Pi (por exemplo em `~/arlequin`) e os plugins instalados a partir dele, no `~/.signalk`, com `npm install <caminho>` (dependência `file:`) ou com um atalho (symlink) para a pasta do plugin. Assim o plugin `signalk-arlequin-ia` encontra o pacote Python em `../arlequin-ia` e o ecrã a polar em `arlequin-ecra/public/`, ao lado.
  - Se copiares o plugin para outro sítio, põe na configuração do plugin **`pastaIa`** = a pasta `software/arlequin-ia` do repositório. Sem isso, o plugin diz "não encontro o pacote arlequin-ia em …: configura pastaIa" e não treina (o arquivo da previsão continua).
  - O ambiente do Python:

    ```
    python3 -m venv ~/arlequin-ia-venv && ~/arlequin-ia-venv/bin/pip install -r ~/arlequin/software/arlequin-ia/requirements.txt
    ```

    Depois, na configuração do plugin, pôr **`python`** = o Python do venv, `~/arlequin-ia-venv/bin/python` escrito por inteiro (ex.: `/home/pi/arlequin-ia-venv/bin/python`). **`/home/pi` pode ser outro:** é a pasta do utilizador que corre o SignalK (`echo $HOME`).
  - As versões testadas estão fixas no `requirements.txt` (LightGBM 4.7.0, pandas 3.0.3, numpy 2.4.6).
- **O que faz sozinho:**
  - guarda a previsão Open-Meteo para a posição do barco sempre que há rede (de hora a hora a navegar, de 3 em 3 h parado);
  - depois de cada saída, quando o barco está parado há 1 h, treina os modelos com prioridade baixa.
- **O que aprende:**
  - a velocidade real do Arlequin contigo ao leme, **só à vela**: precisa das velas marcadas na página **Velas** (com a grande arriada e a genoa enrolada nunca conta como vela, mesmo sem rotações do motor);
  - em quanto a previsão do vento falha (força e direção);
  - o gasóleo real, **só quando o motor dá o caudal medido** (PGN 65266 do MDI). A estimativa pela curva da Volvo não ensina nada: era a própria curva.
  - O simulador nunca ensina.
- **Quando começa a valer:** precisa de pelo menos 5 h de navegação estável e 2 saídas. Até lá o ecrã diz "a aprender" e usa-se a polar de origem. O 1.º modelo da velocidade pode precisar de **umas 8 h de vela variada** (ventos e ângulos diferentes) até errar menos do que a polar e entrar em uso. A última saída serve de teste; se tiver menos de 1 h, junta-se a anterior.
- **No ecrã:** no Diário, o cartão "AI" mostra a versão em uso, o que aprendeu e o estado da previsão ("previsão: última HH:MM" ou "sem rede"). Tem "Treinar agora" e, quando há uma versão anterior que esteve em uso, "Voltar atrás", se um modelo novo te parecer pior.

**Velas:** na página **Velas** do ecrã, toca no estado da grande e da genoa sempre que mudares. A AI precisa disto para aprender, e o ecrã lembra-te se o vento mudar muito.

### Melhor rota (cálculo) (plugin `signalk-arlequin-rota`)

Desenho completo em `docs/superpowers/specs/2026-09-30-melhor-rota-calculo-design.md`. Esta
parte (3a) é o cálculo; a página do ecrã, o mini-mapa e o plano pelo Telegram (3b-1) estão em
"No ecrã e pelo Telegram", mais abaixo; os avisos e o acompanhamento durante a viagem (3b-2) estão
em "A navegar", mais abaixo.

- **O que faz:** cobre a costa continental, de Caminha a Vila Real de Santo António. Para um
  destino e a tripulação ("só eu" ou "acompanhado"), gera as alternativas por afastamento à
  costa (3, 5 ou 8 MN) × hora de partida × vela ou motor, simula cada uma em três cenários
  (pessimista, provável, otimista), e devolve as **3 melhores**, o **veredicto** ("Segue" /
  "Espera até às HH:MM" / "Não recomendado sozinho" / "Volta ou abriga-te em X"), o **"Sair agora
  mesmo assim"** (inclui as não recomendadas, para quando o Ivo quer sair na mesma) e os
  **pontos de desistência** ao longo da rota.
- **No Pi:** ativar o plugin `@signalk/resources-provider` no SignalK. Sem ele, o `/ativar` dá
  502 "não ativei a rota: …" — não há onde gravar a rota nem ativá-la.
- **No Pi: instalar e ativar o plugin `@signalk/course-provider`** (Appstore do SignalK, ou
  `npm install @signalk/course-provider` na pasta `~/.signalk`, e ligá-lo em Plugin Config). É ele
  que calcula o rumo e a distância ao próximo ponto (`navigation.course.calcValues`): sem ele, o
  Leme não tem rumo e fica em "Rota ativada · à espera do rumo do SignalK".
- **No Pi: ligar a segurança do SignalK** (Security, com utilizador e palavra-passe) e criar
  um utilizador **"read/write"** para o ecrã da roda (iniciar sessão com ele no browser do ecrã).
  Sem segurança, qualquer aparelho na rede do barco pode mandar planos aos contactos ou ativar
  rotas. O plugin da rota regista as rotas com níveis (`router.access` do SignalK 2.33):
  - as leituras (`GET /destinos`, `/resultado`, `/plano-telegram/:pedido`) pedem uma sessão
    iniciada (qualquer utilizador);
  - as escritas (`POST /calcular`, `/destinos`, `/ativar`, `/plano-telegram`) pedem um utilizador
    "read/write" ou admin.

  Num SignalK antigo, sem o `router.access`, as rotas dos plugins só aceitam um utilizador
  **admin** (também os GET): aí o ecrã precisa de uma sessão de admin, ou atualiza-se o SignalK.
- **Caminho da polar:** `software/arlequin-ecra/public/polar-arlequin.csv`, do próprio
  repositório.
- **Zonas e portos: estão por confirmar.** Antes de confiar no cálculo, o Ivo tem de ver na
  carta:
  - os separadores de tráfego (geometria oficial da DGRM);
  - os Cachopos (barra do Tejo), desenhados à mão a partir da carta do IH n.º 26303;
  - a entrada de Algés e de Oeiras pela Barra Norte: do largo de Cascais ao eixo do canal
    (enfiamento Santa Marta–Guia, 104,7°) ao largo da Parede (o antigo ponto "Largo de
    Carcavelos", dentro dos 10 m do Cachopo do Norte, já saiu do `destinos.json` a 30/09);
  - as aproximações e entradas de todos os portos;
  - quais destinos são abrigo (no `destinos.json`, todos menos a Figueira da Foz e Olhão);
  - o **Canal da Berlenga** (`dados/canais.json`): eixo desenhado à mão entre o Cabo Carvoeiro e
    a Berlenga a partir do OSM, com os fundos, as correntes e as Estelas/Farilhões por
    confirmar.
- **Portos conhecidos** (confirmado pelo Ivo a 02/10): só **Peniche, Cascais e Algés**
  (`conhecido: true` no `destinos.json`). Com "só eu", uma chegada de noite a qualquer outro dá
  "Não recomendado sozinho".
- **Como marcar como confirmado:** editar `dados/destinos.json`, `dados/zonas.json` e
  `dados/canais.json`, pondo `"confirmado": true` no que já foi visto na carta.
- **Regra da calma para as horas ao leme:** vento < 10 nós **e** (ondas < 2 m, **ou** ondulação
  comprida ≤ 3 m com período ≥ 9 s). Nessa calma, as horas a motor contam metade, porque **a roda
  tem travão** (confirmado pelo Ivo a 29/09) e dá para pausas curtas.

**O que convém saber sobre o comportamento do cálculo:**
- A alternativa de 3 MN só existe com **vento de terra ao longo de toda a linha seguida**
  (verificado à hora estimada de passagem, e voltado a verificar-se nos rastos dos 3 cenários
  simulados); perto da costa (< 3 MN), a rota direta segue a mesma regra. Sem vento de terra,
  essa alternativa **nunca aparece, nem no "Sair agora mesmo assim"** (é uma exclusão dura).
- Entre dois portos vizinhos com um **salto curto**, há uma só alternativa "direta", junto à
  costa, com a distância real à terra (nunca "a null MN" nos nomes).
- Se o barco já estiver dentro da aproximação de um porto (por exemplo, no canal do Tejo), a
  rota segue essa aproximação até ao largo, em vez de traçar a direito.
- Entre portos com o mesmo largo dentro do Tejo (por exemplo, Oeiras e Algés), **não há rota
  calculada**: "sem rota dentro do Tejo: sair pela barra ou navegar à vista".
- O **Canal da Berlenga** só entra como alternativa quando a linha dá a volta às Berlengas, e só
  com ondas previstas abaixo de 3 m nos 3 cenários (tem terra dos dois lados, por isso
  fica fora da regra do vento de terra — aí só as ondas decidem).
- **Sem rede**, o cálculo usa a previsão arquivada mais recente, mas só se tiver **até 48 h** e
  cobrir as **próximas 12 h** ao longo da rota; senão não calcula e diz porquê.
- Previsão em falta (vento, rajadas ou ondas) numa parte da rota **exclui** a alternativa —
  desconhecido nunca conta como calmo; só no "Sair agora" fica, com aviso vermelho. Ondas
  desconhecidas contam como 3 m para a velocidade a motor; distância à costa desconhecida também
  exclui; gasóleo ou bateria desconhecidos à chegada dão sempre aviso vermelho, sem excluir.
- Os pontos de desistência **aparecem sempre**: primeiro tenta a fuga pela linha dos 5 MN; se só
  houver uma fuga junto à costa com vento do mar, aparece na mesma, com aviso vermelho — nunca
  fica escondida. O resumo diz onde é que essa fuga "limpa" falha.
- As horas de chegada dos 3 cenários **não seguem sempre a mesma ordem** (o otimista, com menos
  vento, pode ir mais a motor e chegar depois do pessimista); o intervalo mostrado é sempre por
  ordem de hora (o mais cedo, o provável, o mais tarde), não literalmente "o pessimista"/"o
  otimista".
- "Sair agora mesmo assim" pode mostrar uma passagem que acaba depois do fim da previsão — fica
  na mesma, com aviso vermelho, porque o Ivo pediu para sair mesmo assim.
- **Limites de segurança.** Com "só eu": "Não recomendado sozinho" acima de 22 nós de vento
  médio, 30 de rajada ou 3 m de ondas, mais de 8 h equivalentes ao leme, ou chegada de noite a um
  porto que não conheces. Com "acompanhado" (decisão do Ivo de 01/10, "limites mais largos"):
  "Não recomendado" acima de **28 nós, 35 de rajada ou 4 m de ondas**; entre os limites a solo e
  estes, a alternativa fica, com um aviso vermelho "acima dos limites a solo: …" (as 8 h ao leme e
  a chegada de noite só contam com "só eu"). Os limites contam no pior dos **3 cenários** (o
  otimista, mais lento, pode apanhar uma frente que os outros não apanham), e o vento do pior caso
  nunca fica abaixo do previsto, mesmo que a AI tenha aprendido que a previsão exagera.
- **Destinos acrescentados por ti** (`POST /destinos`: posição atual ou coordenadas, com nome):
  servem de destino e de partida (por exemplo, fundeado lá); só contam como **abrigo** para os
  pontos de desistência se os marcares assim (por omissão não). Os gravados antes de 01/10 são
  corrigidos sozinhos ao ler.
- As 3 melhores: primeiro as recomendadas, depois por custo.
- Perto da costa (alternativa a ≤ 3 MN), o mínimo à terra é o próprio afastamento (3 MN), não os
  5 MN de omissão das outras alternativas.

### No ecrã e pelo Telegram (3b-1)

Desenho em `docs/superpowers/specs/2026-10-01-melhor-rota-ecra-3b1-design.md`; capturas de cada
estado, de dia e de noite, em `docs/capturas-3b1/`.

**Como usar a página "Melhor rota":**
- **Com uma rota ativa**, a página mostra o **Leme** (o rumo a seguir, os bordos, VIRA AGORA).
  **Novo cálculo** volta à escolha do destino; a rota ativa aparece no topo da lista e
  **Voltar ao leme** volta ao rumo (sair da página e voltar também).
- **Pedir:** toca no destino (os portos vêm do mais perto para o mais longe; "+ acrescentar"
  grava um destino aqui, com a posição do GPS, ou por coordenadas, ex.: `39,37` e `9,34 W`),
  escolhe **Só eu** ou **2 ou mais** e carrega em **Calcular**. Sem GPS, o Calcular fica
  desligado ("sem GPS: não dá para calcular").
- **A calcular:** a barra de progresso; demora uns segundos. **Cancelar** só deixa de seguir: o
  plugin continua a calcular até ao fim (um novo Calcular segue esse cálculo).
- **Resultado:** a faixa do veredicto (verde Segue, amarela Espera, laranja Não recomendado,
  vermelha Volta/abriga-te), a idade da previsão, os 3 cartões (toca num para o escolher), os
  **avisos vermelhos** (sempre visíveis), a linha do tempo, as **precauções** (caixas para marcar;
  não bloqueiam nada e ficam guardadas no ecrã para esse cálculo) e os pontos de desistência
  (calculados para a 1.ª alternativa).
- **Mapa:** o mini-mapa das 3 alternativas (azul à vela, cinzento tracejado a motor, mais escuro de
  noite; triângulos nos avisos; bolinhas nos pontos de desistência, verdes com uma fuga limpa e
  vermelhas sem nenhuma; tracejado vermelho nas zonas a evitar). Toca num cartão para destacar
  outra alternativa.
- **Enviar plano:** manda o plano de navegação (texto com a hora de alarme + o ficheiro GPX) pelo
  bot do Telegram do plugin porto.
  - Com pelo menos um **contacto do plano** a recebê-lo: "enviado ✓ a N contactos em terra", e a
    precaução "Plano deixado a alguém em terra" fica marcada.
  - Só com o teu chat (os **Chats autorizados**; um chat que esteja nas duas listas conta como
    teu): a amarelo, "enviado só para o teu chat — nenhum contacto em terra recebeu (junta
    contactos do plano na configuração)", e a precaução fica por marcar (ninguém em terra tem a
    hora de alarme).
  - Quem falhou vem com o motivo ("bloqueou o bot", "sem ligação ao Telegram").
  - Com o plugin porto desligado: logo "o plugin porto está desligado: liga-o em Plugin Config".
    Ligado mas sem resposta em 30 s: "o plugin porto não respondeu (está ligado? tem o token?)".
  - Sem a chegada mais tarde não há hora de alarme e o plano não vai. Um cálculo antigo também
    não: com a hora de alarme já passada ou a partida há mais de 1 h, "este cálculo é antigo: … —
    calcula outra vez antes de enviar o plano".
  - Escolher outro cartão a meio do envio não o perde: o estado diz "(plano da N.ª alternativa)".
- **Ativar esta rota:** grava e ativa a rota no SignalK (o OpenCPN mostra-a) e a página passa ao
  Leme. **Sair agora mesmo assim** recalcula só para partir já.

**Hora de alarme do plano:** a chegada mais tarde (o pior dos 3 cenários) + 2 h. O texto diz a
quem o recebe para ligar ao Ivo e, se ele não atender, ao MRCC Lisboa (+351 214 401 919, 24 h, ou
112), com o barco, a origem, o destino e a hora de saída.

**Juntar contactos do plano** (quem só recebe o plano, sem poder comandar o barco):
1. A pessoa procura o bot do Arlequin no Telegram e manda **/start** (ou qualquer mensagem).
2. O bot responde "Para receberes os planos do ARLEQUIN, dá este código ao Ivo: NNNN" (uma vez
   por hora, no máximo). O número também aparece no estado do plugin porto.
3. O Ivo junta-o no plugin porto, em **Contactos do plano** (`contactosPlano`: nome + código).
   Ninguém entra sozinho. Os contactos do plano recebem os planos, mas as mensagens deles são
   ignoradas (não podem /armar, /posicao, etc.). Os **Chats autorizados** (`chatIds`) também
   recebem o plano, mas não contam como contactos em terra.

**Telefones e barco na configuração** (plugin `signalk-arlequin-rota`):
- `telefones.ivo` — o teu telemóvel (vazio por omissão: o plano diz só "liga ao Ivo", e o ecrã
  avisa ao enviar);
- `telefones.emergencia` — por omissão "+351 214 401 919 (MRCC Lisboa, 24 h) ou 112";
- `barco` — nome (ARLEQUIN), modelo (Jeanneau Melody 34), cor do casco, MMSI e indicativo; os
  campos vazios ficam de fora do plano.

**Em casa (dev):**
- O plugin porto vem **desligado** (`enabled: false`), para o `npm start` não registar erros de
  ligação de 10 em 10 s. Para experimentar o **Enviar plano**:
  1. na pasta `software/dev`, `npm run telegram-falso` (porta 8081; `GET
     http://localhost:8081/_enviados` mostra o texto e o GPX recebidos);
  2. ligar o porto: em `config/plugin-config-data/signalk-arlequin-porto.json`, `"enabled": true`
     (ou no Admin UI, Plugin Config), e `npm start`. Já aponta para o Telegram falso.
  O envio para o Telegram verdadeiro precisa do token do bot, que só o Ivo põe.
- O `@signalk/course-provider` está instalado e ligado no dev (`npm run instalar` instala-o): depois
  de **Ativar**, o Leme mostra o rumo a seguir.

### A navegar (3b-2)

Desenho em `docs/superpowers/specs/2026-10-01-melhor-rota-navegar-3b2-design.md`; capturas do Leme
(faixa com o lembrete de mudar de rumo, recalcula, rota mudada, recursos e barómetro, e o "Estou bem" com a hora de alarme em terra por adiar), de dia e de noite
(o modo noite de 01/10, brilho 2), em `docs/capturas-3b2/`. Corre no **plugin da rota,
no Pi**, de minuto a minuto: funciona com o ecrã desligado e continua depois de um reinício (o plano
fica gravado em `plano-ativo.json`, na pasta do plugin). **Nunca muda a rota sozinho.**

**O plano ativo:** ao carregar em **Ativar**, a alternativa fica como plano ativo, "à espera de
sair". Passa a "a navegar" quando o barco fica a mais de 0,5 MN da partida (em duas leituras
seguidas) ou anda a mais de 2 nós durante 5 min. Chega quando fica a menos de 0,3 MN do cais do
destino, parado (menos de 0,5 nó) durante 5 min, depois de feita pelo menos metade da rota (numa rota
com menos de 1 MN, depois de 5 min a navegar). Com a rota limpa ou trocada no OpenCPN (o plano em
pausa), conta também o afastamento real: se já estiveste a pelo menos 1 MN da partida (ou a metade
da distância em linha reta até ao destino, se for menor), chegar e ficar 5 min no cais dá o "cheguei
bem" na mesma. Em pausa, e numa rota com menos de 1 MN, o barco também tem de ter saído 0,5 MN do
cais (a contar da partida) e voltado: numa ida e volta, ou com o destino colado à partida, ficar no
cais logo à saída não é "cheguei bem". Um plano novo começa limpo; os 5 últimos ficam em
`planos-fechados.json`.

**A faixa no Leme**, por cima do rumo:
- "próximo: rizar às 22:50 (daqui a 25 min) · +20 min sobre o plano" (os eventos de sítio — rizar,
  cabos, largos, chegada — deslizam com o atraso; o pôr do sol, a chuva e a frente ficam à hora
  prevista);
- "chegada ~amanhã 07:58 (plano 07:38)", com "de noite" se a chegada deslizada for de noite;
- "recursos: gasóleo à chegada ~34 L" quando há aviso, ou "recursos: sem leitura";
- "sem GPS: acompanhamento parado" (mais de 2 min sem posição) e "barómetro: sem leitura";
- antes de sair: "plano ativo · à espera de sair";
- com o plano enviado: "contactos em terra: alarme HH:MM" (a hora a que eles ligam ao MRCC), "mensagem
  para terra por enviar (sem rede)" quando uma já falhou, "não chegou a X (a tentar outra vez)" e, na
  caixa da pausa, "em pausa: os atrasos não seguem para terra".

**O que o sistema avisa** (na barra de cima, com o apito curto; nenhum muda a rota):
- **Lembretes**, 30 min antes: rizar ou largar rizo, a frente, chuva e visibilidade abaixo de 5 km
  ("radar ligado e luzes"), o pôr do sol ("luzes, arnês, come antes de escurecer"), a chegada de
  noite, **virar/cambar** nos pontos da rota onde o rumo muda mais de 45° ("virar/cambar no Cabo
  Raso"; num troço a motor, "mudar de rumo no Cabo Raso") e a **rotação do vento** previsto de mais
  de 45° em 1 h ("rotação do vento de 350° para 50°"; com vento previsto de 6 nós ou mais, no mínimo
  3 h entre elas e nenhuma perto de uma frente, que já diz para onde roda). Só no ecrã.
- **A hora de alarme em terra**, 60 min antes, com o plano aberto (também à espera de sair e em
  pausa): "Os contactos em terra ligam ao MRCC às HH:MM: avisa-os ou Terminar". Só no ecrã.
- **Come e bebe** (só com "só eu"), de 3 em 3 h desde a saída, durante 15 min. Só no ecrã.
- **Recalcula a rota**: atraso de mais de 30 min, ou o vento medido (média de 10 min) afastado do
  previsto mais de 30 % e mais de 4 nós durante 30 min seguidos. Apaga-se com os dois normais
  durante 10 min. Vai também para o teu Telegram.
- **Recursos**: gasóleo à chegada abaixo de 40 L ou bateria abaixo de 50 % (pelas horas de motor
  que faltam no plano, a 2100 rpm, e o balanço da bateria). Vai também para o teu Telegram.
- **Previsão velha**: com mais de 6 h, aviso no ecrã; com mais de 12 h (ou sem previsão nenhuma),
  alarme com o apito curto, "confia nos instrumentos e no barómetro", e vai para o teu Telegram.
- **Barómetro**: queda de mais de 3 hPa em 3 h, "o tempo pode piorar antes do previsto"; apaga-se
  com a queda em 3 h até 2 hPa. Vai também para o teu Telegram.
- O teu Telegram recebe o "✓ Resolvido" quando passam, uma só vez (o plugin porto guarda o que já
  te mandou em `encaminhador.json`: um reinício do plugin não repete os avisos nem o "Resolvido";
  depois de desligar o Pi, um aviso ainda ativo volta a chegar uma vez — mais vale repetido do que
  perdido).
  O apito contínuo fica só para o AIS.

**O que os contactos em terra recebem** (só se o plano lhes foi enviado; vão também para o teu chat):
- "Cheguei bem a Peniche às 10:24. Obrigado!" à chegada (uma vez);
- "Ainda a navegar, tudo bem. Nova chegada prevista ~HH:MM. Nova hora de alarme: HH:MM (em vez de
  HH:MM)." quando a chegada prevista passa **30 min ou mais** da "mais tarde" do plano (decisão do
  Ivo de 01/10: uns minutos não preocupam ninguém em terra); depois, no máximo 1× por hora
  e só se a chegada escorregar mais 15 min. A nova hora de alarme é a chegada prevista + 2 h, e só
  conta quando chega a terra (o "em vez de" é sempre a última que eles receberam). **Só sai com o
  barco a avançar** (decisão do Ivo de 02/10, "só a avançar + teto de 3 h"): pelo menos 1 MN na rota
  na última hora, a andar agora e a menos de 2 MN da rota; e **nunca empurra sozinho a hora de alarme
  mais de 3 h** sobre a do plano. Parado ou à deriva não sai nada: fica a hora de alarme que eles têm
  (se estiveres incapacitado, ligam ao MRCC à hora certa). O Leme diz então "A hora de alarme em terra
  é HH:MM e não foi adiada (barco parado / limite de 3 h). Se estás bem, carrega Estou bem.": o botão
  **Estou bem** manda um atraso com a estimativa de agora, e o limite passa a 3 h sobre essa hora;
- "Viagem terminada / mudança de planos: estou bem, em <posição> às HH:MM." ao Terminar;
- o plano novo, com "Este plano substitui o anterior", ao Recalcular → Ativar, e também ao Ativar
  outra alternativa (ou outro cálculo) quando eles têm o plano de outra (o Resultado avisa: "os
  contactos em terra têm o plano da 1.ª alternativa (alarme HH:MM): ao Ativar, segue o novo").
- Um contacto que não a recebeu (bloqueou o bot, um erro do Telegram) recebe-a outra vez, igual e com
  a mesma referência, de 2 em 2 min, até chegar.
- Nada mais: os lembretes, os avisos e a rota mudada nunca vão para terra. Sem rede (ou sem o
  plugin porto), as mensagens ficam em fila e voltam a tentar de 2 em 2 min (no teu chat só a 1.ª
  vez). Um atraso que fica na fila sai com os valores da hora a que sai, e já não sai se entretanto
  recuperaste.
- Cada mensagem acaba com uma referência curta ("ref. A3"), a mesma em todas as tentativas: depois
  de um reinício a meio de um envio a mensagem volta a sair (perder um atraso é pior do que o contacto
  o receber duas vezes) e quem a recebe vê que é a mesma.

**Os botões:**
- **Recalcular**: um cálculo novo de onde estás para o mesmo destino e tripulação; abre o
  Resultado, onde **Ativar** substitui o plano (se o plano antigo tinha sido enviado, o novo segue
  sozinho para os mesmos contactos). A navegar (ou em pausa no mar) só conta a partida imediata e,
  se continuar não for recomendado, diz "Volta ou abriga-te em X"; à espera de sair, todas as
  partidas. Um cálculo antigo é recusado e o plano antigo fica.
- **Terminar** (pede confirmação: "Terminar o plano? Os contactos em terra recebem 'viagem
  terminada, estou bem'"): fecha o plano e os avisos.
- Com o plano ativo, o Leme fica limpo: só o **Recalcular** (sai o "Novo cálculo" e o texto do OpenCPN).
- **Rota mudada no OpenCPN** (outra rota ativa, ou nenhuma, durante pelo menos 2 min: logo a seguir a
  um reinício a API de rumo pode ainda não ter a rota): o plano fica em pausa e o Leme mostra
  "a rota ativa já não é a do plano: terminar o plano?" com **Terminar**, **Continuar** (volta a
  ativar a rota do plano) e **Recalcular**. Nada segue sozinho para terra, exceto a chegada ao cais
  do plano (a mesma regra: "cheguei bem"). Parado 30 min noutro porto da lista, o Leme pergunta
  "Chegaste a X? Enviar 'cheguei bem a X'": só envia se carregares.

**Em casa (dev) — nunca no Pi:** a viagem acelerada Algés → Peniche (`npm run viagem-acelerada` na
pasta `software/dev`, com o servidor e o `npm run telegram-falso` a correr) faz de GPS, barómetro,
depósito e relógio, a 60× (1 s = 1 min). Injeta posição e hora falsas, manda planos e ativa rotas:
**nunca a corras no Pi** (nem noutro SignalK que não seja o do portátil). Precisa, só para o teste,
do simulador desligado, do porto ligado ao Telegram falso (só com o contacto falso do dev, o 222) e,
no plugin da rota, de `modoTeste: true` com `horaSimulada: true` e `cicloSegundos: 1`. O script lê a
configuração do servidor e recusa-se a correr sem ela (no Pi, com a segurança do SignalK ligada, nem a
consegue ler). As opções de teste estão **desligadas por omissão**: `modoTeste` é `false` e, sem ele,
`horaSimulada` e `cicloSegundos` não contam (no barco, o ciclo é sempre de 60 s); no fim do teste,
desliga o `modoTeste`. Com ele ligado, o estado do plugin no Plugin Config começa por "MODO DE TESTE
(hora simulada, ciclo de 1 s)", para nunca passar despercebido no barco. Ctrl-C a meio termina o plano, desativa a rota e repõe a hora. Com
`--pausa <ficheiro>`, a hora pára enquanto o ficheiro existir.
