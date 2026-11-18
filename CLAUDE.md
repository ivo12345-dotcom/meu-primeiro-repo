# Projeto: Radar de capacete para airsoft

> Este ficheiro passa o contexto a uma sessão nova do Claude Code no PC Windows do utilizador.
> Fala sempre em **português de Portugal**, de forma simples: o utilizador não é programador.
> Trabalha ao mesmo tempo no PC e no telemóvel (as fotos vêm do telemóvel).

## Objetivo

Um radar pessoal montado no **topo do capacete**, para CQB de airsoft. Mostra num **telemóvel Android**
os alvos (pessoas) à volta do jogador, num raio de cerca de 6 m e em 360°.

Como o utilizador o usa: **para, olha para o telemóvel, analisa, volta a andar.**
Alertas só **visuais ou por vibração, nunca som**.

## Hardware (já comprado, já com os pinos soldados)

| Peça | Notas |
|---|---|
| **Heltec WiFi LoRa 32 V3** (ESP32-S3, OLED 128x64, USB-C com CP2102) | Pentes de pinos soldados, com os pinos a sair por trás |
| **3 × HLK-LD2460** (radar 24 GHz, até 5 alvos, 120° H / 90° V, ~6 m, deteta pessoas paradas) | Frente, trás-esquerda e trás-direita. Já trazem pinos de fábrica |
| **RCWL-0516** (Doppler ~3 GHz, só sim/não) | Pinos soldados. Alarme "movimento atrás da parede" |
| **Arduino Modulino Movement** (LSM6DSOX, I2C 0x6A, só 3,3 V) | Pinos SCL/SDA/3V3/GND soldados. Compensa a rotação da cabeça |
| Mini power bank USB-C | Vai numa bolsa do colete, com um cabo até ao capacete |
| Fios Dupont, fio de 0,14 mm², estanho Sn60Pb 0,6 mm | Ferro a ~330 °C |

## Ligações (devem coincidir com `radar-capacete/src/config.h`)

| Heltec | Liga a |
|---|---|
| 5V | VIN dos 3 LD2460 (pino 1) e VIN do RCWL |
| GND | GND de tudo (LD2460 pino 2, RCWL GND, Modulino GND) |
| GPIO 4 / GPIO 5 | LD2460 n.º 1 (frente): pino 7 (Tx2) → GPIO 4 · pino 8 (Rx2) ← GPIO 5 |
| GPIO 6 / GPIO 7 | LD2460 n.º 2 (trás-esq): Tx2 → GPIO 6 · Rx2 ← GPIO 7 |
| GPIO 47 / GPIO 48 | LD2460 n.º 3 (trás-dir): Tx2 → GPIO 47 · Rx2 ← GPIO 48 |
| GPIO 2 | RCWL OUT |
| GPIO 41 / GPIO 42 | Modulino SDA / SCL |
| 3V3 | Modulino 3V3 (**nunca 5 V**) |

- O pino 5 do LD2460 (VDD33) **não se liga**.
- Segundo a loja, os dados saem pela UART2 (pinos 7 e 8). Se não chegarem dados, experimentar a UART1 (pinos 3 e 4).
- Pinos da Heltec a evitar: 0, 3, 21 (reset do OLED), 26, 35 (LED), 36 (Vext), 37, 45, 46, e 17/18 (I2C do OLED).
- Com `NUM_RADARS 3`, a UART0 (a do USB) passa a ser usada pelo radar 3 e **deixa de haver monitor série**.
  Para testar na bancada com o monitor série, usar `NUM_RADARS 1`.

## Protocolo LD2460 (confirmado no código do ESPHome: smarthomeshop/ld2460 e jesusvallejo/esphome_ld2460)

- 115200 baud, 8N1.
- Trama de alvos: `F4 F3 F2 F1 | 04 | LEN(LE16) | n × (X int16 LE, Y int16 LE) | F8 F7 F6 F5`, com LEN = 11 + 4n.
  X e Y em **0,1 m**, e Y é a distância para a frente do radar.
- Comandos: `FD FC FB FA | CMD | LEN(LE16) | dados | 04 03 02 01`
  - Ativar o envio de alvos: `FD FC FB FA 06 0C 00 01 04 03 02 01`
  - Modo de instalação (0x09): 01 = lateral, 02 = teto

## Estado do código (pasta `radar-capacete/`, PlatformIO)

- `src/main.cpp`: ponto de acesso Wi‑Fi **RADAR-CAPACETE** / palavra-passe **airsoft123**, servidor web em
  **http://192.168.4.1**, rotas `/data`, `/cfg`, `/set`, `/cmd`, estado no OLED, definições guardadas em NVS
  (Preferences).
- `src/ld2460.h`: leitor das tramas do radar.
- `src/imu.h`: driver mínimo do LSM6DSOX. Calcula a rotação à volta da vertical (giroscópio projetado na
  gravidade, sem bússola), calibra o erro do giroscópio no arranque e quando a cabeça está parada, e indica
  se a cabeça está "parada".
- `src/web_page.h`: página de radar (canvas). Mostra os alvos com memória que vai desvanecendo, fixa no
  mundo graças à compensação da rotação. Tem vibração e flash opcionais, aviso do RCWL só quando a cabeça
  está parada, e um painel de definições (espelhar cada radar, direção de cada radar, inverter rotação,
  distância mínima, recalibrar, modo lateral).
- ⚠️ **O código NUNCA foi compilado** (o ambiente na cloud não conseguia descarregar as ferramentas do ESP32).
  A primeira tarefa é compilá-lo e corrigir os erros.

## Tarefas para a sessão no PC (por esta ordem)

1. **Preparar as ferramentas** (pedir confirmação ao utilizador antes de instalar):
   - Python 3 (`winget install Python.Python.3.12`, se não existir) e PlatformIO Core (`pip install platformio`).
     Em alternativa, o utilizador pode usar o VS Code com a extensão PlatformIO IDE.
   - Driver USB **CP210x** (Silicon Labs), se a placa não aparecer como porta COM.
2. **Compilar**: na pasta `radar-capacete`, correr `pio run`, e corrigir os erros até compilar.
3. **Gravar a placa sem sensores ligados**: `pio run -t upload`. O OLED deve mostrar RADAR-CAPACETE e
   o estado dos sensores. Testar a página no telemóvel (ligar à rede Wi‑Fi e abrir http://192.168.4.1).
4. **Ligar e testar os sensores um a um**, guiando o utilizador com as ligações acima:
   LD2460 n.º 1 → RCWL → Modulino → LD2460 n.º 2 → LD2460 n.º 3.
   Antes de ligar cada LD2460, confirmar a orientação dos pinos com o multímetro: os pinos 2 e 6 (os dois GND)
   têm de dar continuidade entre si. Medir também os 5 V da Heltec ligada ao power bank (~4,8–5,1 V).
5. **Afinar no terreno**: em cada radar, espelhar o X se for preciso; sentido da rotação da cabeça;
   distância mínima (para ignorar os braços e a arma); quanto tempo o LD2460 demora a detetar uma pessoa imóvel.
6. **A seguir**: desenhar a caixa 3D para o capacete. Disco baixo de ~80–90 × 35–45 mm, com base curva
   (o utilizador vai dar as medidas do capacete), velcro e fita, em PETG ou ASA, sem metal à frente dos
   radares e com paredes de 1–2 mm. A seta X do Modulino aponta para a frente.
   Opcional: um 4.º LD2460 virado para cima, para o piso superior (exige outra solução de portas série).

## Limites já explicados ao utilizador

- Os sensores **não atravessam alvenaria nem betão**. Passam por madeira, OSB e lona.
- O sistema não distingue amigos de inimigos.
- O LD2460 pode demorar até ~30 s a mostrar uma pessoa completamente imóvel.
- Lembrar que o organizador do campo tem de autorizar o uso destes dispositivos.

## Git

Trabalhar no ramo `ccr-aee29d3d-h5dz27`. Fazer commit e push quando houver progresso.
