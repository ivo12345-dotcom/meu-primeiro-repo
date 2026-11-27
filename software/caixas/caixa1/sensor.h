// O sensor de movimento (Adafruit BNO085) pela ligação de 10 ligações (SPI), com o INT e o RST, e com a
// biblioteca do fabricante (Adafruit BNO08x). As regras são as do ponto 12 do desenho, tiradas da bancada
// de 22 e 23/11/2026:
//
//   - quem fala com o sensor é uma tarefa à parte. A biblioteca espera pelo sensor até meio segundo de
//     cada vez; no ciclo principal isso calava o batimento, o log e o vento. A tarefa só entrega leituras
//     numa fila e NUNCA escreve na porta USB: quem escreve é só o ciclo principal;
//   - só se lê quando o sensor avisa pelo INT (regra 6); nunca se lhe pergunta "estás aí?";
//   - arrancar é um toque no RST, ler tudo o que o sensor tem para dizer, confirmar o "recomeço completo"
//     e só então escrever (regras 1 e 2); só vale "a medir" quando as três leituras chegam mesmo;
//   - a gravação periódica das calibrações do sensor fica desligada (regra 7): grava-se a pedido, com o
//     barco parado (comando "guardar");
//   - 500 ms sem leituras é "calado": toque no RST e volta a arrancar, com os toques espaçados (1, 2, 5,
//     10 s e depois de 30 em 30 s); ao fim de 5 toques seguidos sem leituras é "não volta", e continua a
//     tentar de 30 em 30 s (regras 4 e 10). O estado e os toques vão no batimento;
//   - a biblioteca tem pedidos que esperam pela resposta sem prazo. Os do arranque e das leituras não são
//     desses; o de gravar as calibrações é. Se a tarefa ficar presa lá dentro, o ciclo principal dá por
//     isso (a tarefa deixa de dar sinal) e recomeça a placa, como faria o cão de guarda (regra 5).
//
// Os fios: VIN→3V3, GND→GND, SCL→D22 (o relógio), SDA→D21 (do sensor para a placa), DI→D23 (da placa
// para o sensor), CS→D5, INT→D19, RST→D18; nas costas do sensor, as pontes PS0 e PS1 fechadas com solda.
#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include <Adafruit_BNO08x.h>

#include "movimento.h"
#include "pinos.h"

const uint8_t SENSOR_A_MEDIR = 0, SENSOR_A_ARRANCAR = 1, SENSOR_CALADO = 2, SENSOR_NAO_VOLTA = 3;

const uint32_t SENSOR_INTERVALO_US = 10000;      // 100 leituras por segundo de cada (o ritmo do desenho)
const uint32_t SENSOR_CALADO_MS = 500;           // tanto tempo sem leituras: calou-se
const uint32_t SENSOR_PRAZO_ARRANQUE_MS = 2000;  // depois de pedidas, as três leituras têm de chegar neste prazo
const uint32_t SENSOR_ESPERAS_MS[] = {1000, 2000, 5000, 10000, 30000};  // entre uma tentativa falhada e o toque seguinte
const uint32_t SENSOR_DESISTE_AOS = 5;           // toques seguidos sem leituras: "não volta" (e continua a tentar)
const uint32_t SENSOR_PRESA_MS = 4000;           // a tarefa sem dar sinal: ficou presa dentro da biblioteca
const int SENSOR_POR_VOLTA = 32;                 // leituras tiradas da fila em cada volta do ciclo principal

// Uma leitura, como passa da tarefa do sensor para o ciclo principal.
struct SensorLeitura {
  uint8_t tipo;       // 1 aceleração (m/s²), 2 rotação (rad/s), 3 atitude (quaternião i, j, k, r)
  uint8_t confianca;  // só na atitude: 0 a 3
  float v[4];
  float erro;         // só na atitude: erro estimado, em radianos
};

static QueueHandle_t sensorFila = nullptr;
static volatile uint8_t sensorEstadoV = SENSOR_A_ARRANCAR;
static volatile uint32_t sensorToques = 0;       // toques no RST desde o arranque (o primeiro, o do arranque, não conta)
static volatile uint32_t sensorRecomecos = 0;    // vezes que o sensor recomeçou sozinho
static volatile uint32_t sensorDeitadas = 0;     // leituras que não couberam na fila
static volatile uint32_t sensorIlegiveis = 0;    // leituras que a biblioteca não conseguiu ler
static volatile uint32_t sensorGuardadas = 0;    // gravações das calibrações que o sensor confirmou
static volatile uint32_t sensorPorGuardar = 0;   // gravações pedidas que falharam
static volatile uint32_t sensorSinalMs = 0;      // a última vez que a tarefa deu sinal de vida
static volatile uint32_t sensorUltimaMs = 0;     // a última leitura
static volatile bool sensorPedeToque = false, sensorPedeGuardar = false;
static volatile bool sensorRecomecou = false;    // chegou o "recomeço completo"
static volatile bool sensorChegou[3] = {false, false, false};
// Até onde chegou o último arranque (para se ver de fora onde encrava): 0 a conversa não abriu, 1 sem
// "recomeço completo", 2 a 4 o pedido da 1.ª, 2.ª ou 3.ª leitura não saiu, 5 a ordem das calibrações não
// saiu, 6 as leituras não chegaram no prazo, 7 a medir.
static volatile uint8_t sensorFase = 0;
static volatile uint32_t sensorVistas[3] = {0, 0, 0};  // leituras recebidas de cada espécie, desde o arranque da placa
static volatile uint32_t sensorPacotes = 0;            // vezes que se foi ler o que o sensor tinha para dizer
static volatile uint32_t sensorOutras = 0;             // leituras de espécies que não se pediram

static void sensorAconteceu(void *, sh2_AsyncEvent_t *evento) {
  if (evento->eventId == SH2_RESET) sensorRecomecou = true;
}

// A biblioteca do fabricante, com duas diferenças: não tem pino de RST (os toques são só os desta caixa,
// contados), e ao abrir a conversa não faz o pedido de identificação, que é dos que esperam pela resposta
// sem prazo. A prova de que o sensor está vivo são o "recomeço completo" e as leituras a chegar.
class SensorBno : public Adafruit_BNO08x {
public:
  SensorBno() : Adafruit_BNO08x(-1) {}

protected:
  bool _init(int32_t) override { return sh2_open(&_HAL, sensorAconteceu, nullptr) == SH2_OK; }
};

static SensorBno sensorBno;
static bool sensorAberto = false;

static void sensorSinal() { sensorSinalMs = millis(); }

// Chamada pela biblioteca, dentro da tarefa do sensor, por cada leitura que chega.
static void sensorAoLer(void *, sh2_SensorEvent_t *evento) {
  sh2_SensorValue_t v;
  if (sh2_decodeSensorEvent(&v, evento) != SH2_OK) {
    sensorIlegiveis = sensorIlegiveis + 1;
    return;
  }
  SensorLeitura l = {};
  switch (v.sensorId) {
    case SH2_ACCELEROMETER:
      l.tipo = 1;
      l.v[0] = v.un.accelerometer.x;
      l.v[1] = v.un.accelerometer.y;
      l.v[2] = v.un.accelerometer.z;
      break;
    case SH2_GYROSCOPE_CALIBRATED:
      l.tipo = 2;
      l.v[0] = v.un.gyroscope.x;
      l.v[1] = v.un.gyroscope.y;
      l.v[2] = v.un.gyroscope.z;
      break;
    case SH2_ROTATION_VECTOR:
      l.tipo = 3;
      l.v[0] = v.un.rotationVector.i;
      l.v[1] = v.un.rotationVector.j;
      l.v[2] = v.un.rotationVector.k;
      l.v[3] = v.un.rotationVector.real;
      l.erro = v.un.rotationVector.accuracy;
      l.confianca = v.status & 3;
      break;
    default:
      sensorOutras = sensorOutras + 1;
      return;
  }
  sensorVistas[l.tipo - 1] = sensorVistas[l.tipo - 1] + 1;
  sensorChegou[l.tipo - 1] = true;
  sensorUltimaMs = millis();
  if (xQueueSend(sensorFila, &l, 0) != pdTRUE) sensorDeitadas = sensorDeitadas + 1;
}

// Um toque no RST: a linha só se puxa para baixo; em cima é o sensor que a tem.
static void sensorToque(bool conta) {
  digitalWrite(PINO_RST, LOW);
  vTaskDelay(pdMS_TO_TICKS(10));
  digitalWrite(PINO_RST, HIGH);
  if (conta) sensorToques = sensorToques + 1;
}

// Lê o que o sensor tiver para dizer, se ele tiver avisado; senão descansa um milésimo de segundo.
static void sensorOuve() {
  if (digitalRead(PINO_INT) == LOW) {
    sensorPacotes = sensorPacotes + 1;
    sh2_service();
  } else {
    vTaskDelay(1);
  }
}

// Espera, até ms, que o sensor avise que tem alguma coisa para dizer (o INT em baixo).
static bool sensorAvisa(uint32_t ms) {
  const uint32_t inicio = millis();
  while (digitalRead(PINO_INT) != LOW) {
    if (millis() - inicio >= ms) return false;
    sensorSinal();
    vTaskDelay(1);
  }
  return true;
}

// Pede as três leituras, desliga a gravação periódica das calibrações e espera que as leituras cheguem
// mesmo.
//
// Nesta ligação, com o pino P0 do sensor preso aos 3 V, a placa não tem maneira de o acordar: só lhe
// consegue escrever enquanto ele está a avisar que tem alguma coisa para dizer. E a biblioteca, se
// escrever sem o aviso, fica à espera dele para sempre (visto na placa a 27/11/2026: o primeiro pedido
// nunca saía). Por isso nunca se chama a biblioteca para escrever sem o aviso já lá estar; a primeira
// coisa que se pede é uma leitura, e daí em diante o sensor avisa de 10 em 10 ms.
static bool sensorPede() {
  sensorChegou[0] = sensorChegou[1] = sensorChegou[2] = false;
  const sh2_SensorId_t quais[3] = {SH2_ACCELEROMETER, SH2_GYROSCOPE_CALIBRATED, SH2_ROTATION_VECTOR};
  for (int i = 0; i < 3; i++) {
    sensorFase = 2 + i;
    if (!sensorAvisa(600) || !sensorBno.enableReport(quais[i], SENSOR_INTERVALO_US)) return false;
    sensorSinal();
  }
  sensorFase = 5;
  if (!sensorAvisa(600) || sh2_setDcdAutoSave(false) != SH2_OK) return false;
  sensorSinal();
  sensorFase = 6;
  const uint32_t inicio = millis();
  while (millis() - inicio < SENSOR_PRAZO_ARRANQUE_MS) {
    sensorSinal();
    sensorOuve();
    if (sensorChegou[0] && sensorChegou[1] && sensorChegou[2]) {
      sensorFase = 7;
      sensorRecomecou = false;  // o recomeço do toque de acordar é o esperado, não é o sensor a recomeçar sozinho
      return true;
    }
  }
  return false;
}

// Depois de um toque no RST: abre a conversa (a biblioteca lê tudo o que o sensor tem para dizer) e exige
// o "recomeço completo", que é a prova de que o sensor está vivo. Nessa altura ele já disse tudo e deixou
// de avisar, e por isso não se lhe consegue escrever (ver sensorPede). Dá-se então um segundo toque, o de
// acordar, que não conta: ao recomeçar o sensor volta a avisar, e os pedidos das leituras saem com esse
// aviso. Devolve true com as três leituras a chegar.
static bool sensorAbre() {
  if (sensorAberto) sh2_close();
  sensorAberto = false;
  sensorRecomecou = false;
  sensorFase = 0;
  sensorSinal();
  if (!sensorBno.begin_SPI(PINO_SENSOR_ESCOLHE, PINO_INT, &SPI)) return false;
  sensorAberto = true;
  sensorSinal();
  sensorFase = 1;
  if (!sensorRecomecou) return false;
  sh2_setSensorCallback(sensorAoLer, nullptr);
  sensorToque(false);
  // a apresentação do sensor lê-se primeiro, e só depois se escreve: é a ordem em que a biblioteca do
  // fabricante o faz
  if (!sensorAvisa(600)) return false;
  sensorPacotes = sensorPacotes + 1;
  sh2_service();
  return sensorPede();
}

// A medir: fica aqui enquanto as leituras chegam. Devolve true se for para dar um toque a pedido (o
// comando "rst"), false se o sensor se calou.
static bool sensorMede() {
  for (;;) {
    sensorSinal();
    if (sensorPedeToque) return true;
    if (sensorPedeGuardar) {
      sensorPedeGuardar = false;
      if (sensorAvisa(600) && sh2_saveDcdNow() == SH2_OK) sensorGuardadas = sensorGuardadas + 1;
      else sensorPorGuardar = sensorPorGuardar + 1;
      sensorUltimaMs = millis();  // a gravação demora: não é o sensor calado
      continue;
    }
    sensorOuve();
    if (sensorRecomecou) {  // recomeçou sozinho e esqueceu os pedidos: voltam a fazer-se, sem toque
      sensorRecomecou = false;
      sensorRecomecos = sensorRecomecos + 1;
      if (!sensorPede()) return false;
    }
    if (millis() - sensorUltimaMs >= SENSOR_CALADO_MS) return false;
  }
}

// Espera, a dar sinal de vida; um pedido de toque acaba a espera.
static void sensorEspera(uint32_t ms) {
  const uint32_t inicio = millis();
  while (millis() - inicio < ms && !sensorPedeToque) {
    sensorSinal();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void sensorTarefa(void *) {
  uint32_t seguidos = 0;  // tentativas seguidas sem leituras
  bool conta = false;     // o toque do arranque da placa não conta
  for (;;) {
    sensorPedeToque = false;
    sensorToque(conta);
    conta = true;
    if (sensorAbre()) {
      seguidos = 0;
      sensorEstadoV = SENSOR_A_MEDIR;
      if (sensorMede()) continue;  // toque a pedido: é já, e conta
      // calou-se: o toque é já (o primeiro da série)
      sensorEstadoV = SENSOR_CALADO;
      continue;
    }
    // não arrancou: espera-se antes do toque seguinte, cada vez mais
    seguidos++;
    sensorEstadoV = seguidos >= SENSOR_DESISTE_AOS ? SENSOR_NAO_VOLTA : SENSOR_CALADO;
    const size_t n = sizeof(SENSOR_ESPERAS_MS) / sizeof(SENSOR_ESPERAS_MS[0]);
    sensorEspera(SENSOR_ESPERAS_MS[seguidos - 1 < n ? seguidos - 1 : n - 1]);
  }
}

// ---- O lado do ciclo principal -----------------------------------------------------------------------

inline uint8_t sensorEstado() { return sensorEstadoV; }
inline uint32_t sensorRsts() { return sensorToques; }

// O comando "rst": um toque no RST do sensor, para ensaiar que a caixa o volta a pôr a medir.
inline void sensorToca() { sensorPedeToque = true; }

// O comando "guardar": o sensor grava as calibrações dele agora. Só com o sensor a medir.
inline bool sensorGuarda() {
  if (sensorEstadoV != SENSOR_A_MEDIR) return false;
  sensorPedeGuardar = true;
  return true;
}

// Os contadores do sensor, para o comando "sensor". Quem chama dá o espaço à medida do formato (AQ_TEXTO).
#define SENSOR_FORMATO "estado=%u;fase=%u;toques=%lu;recomecos=%lu;deitadas=%lu;ilegiveis=%lu;guardadas=%lu;por-guardar=%lu;calado-ms=%lu"
inline void sensorContadores(char *texto, size_t tamanho) {
  snprintf(texto, tamanho, SENSOR_FORMATO,
           (unsigned)sensorEstadoV, (unsigned)sensorFase, (unsigned long)sensorToques, (unsigned long)sensorRecomecos, (unsigned long)sensorDeitadas,
           (unsigned long)sensorIlegiveis, (unsigned long)sensorGuardadas, (unsigned long)sensorPorGuardar,
           (unsigned long)(sensorEstadoV == SENSOR_A_MEDIR ? 0 : millis() - sensorUltimaMs));
}

// O que chegou do sensor desde o arranque da placa, para o comando "leituras".
#define SENSOR_LEITURAS_FORMATO "aceleracao=%lu;rotacao=%lu;atitude=%lu;outras=%lu;pacotes=%lu;int=%d"
inline void sensorLeituras(char *texto, size_t tamanho) {
  snprintf(texto, tamanho, SENSOR_LEITURAS_FORMATO,
           (unsigned long)sensorVistas[0], (unsigned long)sensorVistas[1], (unsigned long)sensorVistas[2],
           (unsigned long)sensorOutras, (unsigned long)sensorPacotes, digitalRead(PINO_INT));
}

inline void sensorIniciar() {
  sensorFila = xQueueCreate(128, sizeof(SensorLeitura));
  // O barramento abre-se aqui, com os pinos desta caixa: a biblioteca volta a pedi-lo sem dizer pinos, e
  // esse pedido já não muda nada.
  SPI.begin(PINO_SENSOR_RELOGIO, PINO_SENSOR_DADOS, PINO_SENSOR_ORDENS, -1);
  digitalWrite(PINO_RST, HIGH);
  pinMode(PINO_RST, OUTPUT_OPEN_DRAIN);
  sensorSinalMs = sensorUltimaMs = millis();
  // no outro núcleo do chip, com a prioridade do ciclo principal: o que o sensor demorar não lhe toca
  xTaskCreatePinnedToCore(sensorTarefa, "sensor", 8192, nullptr, 1, nullptr, 0);
}

// Chama-se em todas as voltas do ciclo principal. aFingir: o gerador de bancada está ligado, e as leituras
// verdadeiras não se misturam com as dele.
inline void sensorCorre(uint32_t agoraMs, bool aFingir) {
  static uint8_t anterior = SENSOR_A_ARRANCAR;
  const uint8_t estado = sensorEstadoV;
  if (estado != SENSOR_A_MEDIR && anterior == SENSOR_A_MEDIR && !aFingir) movLimpa();  // calou-se: o que ia a meio não vale
  anterior = estado;

  SensorLeitura l;
  for (int n = 0; n < SENSOR_POR_VOLTA && xQueueReceive(sensorFila, &l, 0) == pdTRUE; n++) {
    if (aFingir) continue;
    if (l.tipo == 1) movAceleracao(l.v[0], l.v[1], l.v[2]);
    else if (l.tipo == 2) movRotacao(l.v[0], l.v[1], l.v[2]);
    else if (l.tipo == 3) movAtitude(l.v[0], l.v[1], l.v[2], l.v[3], l.erro, l.confianca);
  }

  // A tarefa do sensor deixou de dar sinal: ficou presa dentro da biblioteca. Recomeça-se a placa.
  if ((int32_t)(agoraMs - sensorSinalMs) > (int32_t)SENSOR_PRESA_MS) {
    Serial.flush();
    ESP.restart();
  }
}
