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
| Sonda | **Por identificar** (há sonda?) | ? | — |
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
| 0183 OUT 1 | Radar JRC 1000 + entrada GPS do RT750 (a mesma saída alimenta 2–3 recetores) |
| 0183 OUT 2 | ST4000+, entrada NMEA (rota) |
| SeaTalk1 IN | ST4000+ (proa) |

Se aparecer uma sonda NMEA 0183, falta uma entrada (multiplexer ou adaptador
USB–0183).

Fontes: [em-trak B330, manual](https://alphatronmarine.com/files/secured/docuware_documents/180-AIS+Em-trak+B330+InstallOper+Manual++12-1-2017.pdf),
[em-trak, PGN do B330](https://productsupport.em-trak.com/hc/en-gb/articles/28856352427933-What-are-the-NMEA-2000-PGNs-supported-by-the-B100-B300-and-B330),
[NASA Clipper Wind V2](https://www.nasamarine.com/product/clipper-wind-system/),
[NASA Clipper Wind NMEA (fórum YBW)](https://forums.ybw.com/threads/nasa-clipper-wind-nmea-0183-output-tx.534078/),
[NASA Clipper Log](https://www.seashop.com/en/nasa-clipper-log),
[JRC 1000, Practical Sailor](https://www.practical-sailor.com/marine-electronics/entry-level-lcd-radars/),
[instalação GPSMAP 400/500](https://www.manualowl.com/m/Garmin/GPSMAP-421%2F421s/Manual/133497?page=7),
[Navicom RT750](https://www.navicom.fr/produits/rt750ais-vhf-fixe-25w-avec-antenne-gps-et-ais-integre-nmea-2000),
[NASA Target Navtex Pro-Plus](https://www.nasamarine.com/product/target-navtex-pro-plus-v2/).

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
| | **Total** | | **≈ €482** | Sem portes nem cabos. Portes: contar €30–50 |

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
