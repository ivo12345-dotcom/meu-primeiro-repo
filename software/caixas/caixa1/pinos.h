// Os pinos da caixa 1 (placa ELEGOO "ESP32 DEVKIT V1 TYPEC", 30 pinos). Os nomes são os que estão
// impressos na placa; os fios do sensor estão marcados em docs/caixas/bancada-ligacao-6-fios.jpg.
#pragma once

const int PINO_SDA = 21;       // D21: sensor, dados
const int PINO_SCL = 22;       // D22: sensor, relógio
const int PINO_INT = 19;       // D19: o sensor avisa que tem dados (em baixo)
const int PINO_RST = 18;       // D18: recomeço do sensor; só se puxa para baixo
const int PINO_LOG = 27;       // D27: impulsos da roda do log
const int PINO_VENTO = 16;     // RX2: a frase do mostrador do vento, a 4 800 baud
const int PINO_LUZ = 2;        // D2: a luz azul da placa
