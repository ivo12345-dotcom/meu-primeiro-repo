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
| Cérebro | **Raspberry Pi 5 com OpenPlotter** | Traz OpenCPN e SignalK prontos a usar. Consumo baixo e custo baixo |
| Interfaces | **MacArthur HAT** (€60) | Uma placa com NMEA 2000, NMEA 0183 e SeaTalk1 |
| Programa de carta | **OpenCPN** | É o único que junta todos os dados por cima da carta (ver §3) |
| Cartas | **o-charts "Portugal"** (oeSENC, €16 s/IVA) | Oficiais do Instituto Hidrográfico: continente, Açores e Madeira. Até 5 aparelhos |
| Navionics | **Fica no telemóvel**, como segunda carta | Lê o Wi-Fi do Pi (posição, profundidade e AIS) |
| Ecrã | **SailProof STS10, 10"** (€499) | 1500 nits, IP65, toque com água e luvas, cabos incluídos |
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
 │ SailProof STS10 10"  │◄────────────►│ Raspberry Pi 5 + SSD NVMe         │
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

Fontes: [MacArthur HAT, documentação](https://macarthur-hat-documentation.readthedocs.io/),
[loja OpenMarine](https://shop.openmarine.net/home/23-macarthur-hat.html),
[OpenPlotter](https://openmarine.net/openplotter).

## 3. O radar é a incógnita

Os radares falam protocolos fechados de cada marca. O plugin **radar_pi** do
OpenCPN suporta vários modelos (Navico: Simrad/B&G/Lowrance BR24, 3G, 4G,
HALO; Garmin HD/xHD; alguns Raymarine e Furuno recentes), mas **um radar
antigo ou analógico não aparece no ecrã novo.** Nesse caso o radar continua no
plotter atual. **É a foto mais importante da lista.**

Se o radar for suportado e se quiser vê-lo sobreposto, considerar o Pi 5 de
**8 GB** em vez de 4 GB. O radar é o que mais puxa pela máquina.

## 4. Lista de material

| Peça | Preço | Estado |
|---|---|---|
| Raspberry Pi 5 **4 GB** | €109,99 (RasPi Shop PT, esgotado) / kit €114,99 | Confirmado 28/09 |
| (alternativa) Pi 5 8 GB | €132,51 RS (provavelmente s/IVA) a €269,40 | Preços muito desencontrados; pesquisar bem |
| MacArthur HAT | €60 | Confirmado |
| Base NVMe + SSD | — | A cotar |
| Dissipador ativo oficial | — | A cotar |
| Conversor 12→5 V 5 A (ou módulo de alimentação da HAT) | — | A cotar |
| Caixa para o Pi | — | A cotar (ou impressa) |
| SailProof STS10 | €499,17 | Confirmado (IVA não indicado na página) |
| Cartas o-charts Portugal | €16 s/IVA | Confirmado, edição 2026/1-2 |
| Suporte + pala em ASA | Filamento | Impressão própria |

**Não usar a fonte oficial de 27 W do Pi.** É para tomada de 230 V. No barco o
Pi alimenta-se dos 12 V por conversor, com fusível no quadro.

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
| SailProof STS10 (brilho máximo) | ~19 | ~1,6 |
| Pi 5 + HAT + SSD | ~7 | ~0,6 |
| **Total** | **~26** | **~2,2** |

**Em 24 h de navegação são ~50 Ah só neste sistema**, sem o piloto, o
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
