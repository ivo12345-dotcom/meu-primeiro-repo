// Os pinos da caixa 1 (placa ELEGOO "ESP32 DEVKIT V1 TYPEC", 30 pinos). Os nomes são os que estão
// impressos na placa; os fios do sensor estão marcados em docs/caixas/bancada-ligacao-6-fios.jpg.
#pragma once

// O sensor, pela ligação de 10 ligações (os nomes entre parênteses são os que estão escritos no sensor):
const int PINO_SENSOR_DADOS = 21;    // D21 (SDA): os dados do sensor para a placa
const int PINO_SENSOR_RELOGIO = 22;  // D22 (SCL): o relógio
const int PINO_SENSOR_ORDENS = 23;   // D23 (DI): os dados da placa para o sensor
const int PINO_SENSOR_ESCOLHE = 5;   // D5 (CS): a placa escolhe o sensor
const int PINO_INT = 19;       // D19: o sensor avisa que tem dados (em baixo)
const int PINO_RST = 18;       // D18: recomeço do sensor; só se puxa para baixo
const int PINO_LOG = 27;       // D27: impulsos da roda do log
const int PINO_VENTO = 16;     // RX2: a frase do mostrador do vento, a 4 800 baud
const int PINO_LUZ = 2;        // D2: a luz azul da placa
