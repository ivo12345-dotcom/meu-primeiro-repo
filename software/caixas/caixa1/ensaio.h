// Os geradores de bancada da caixa 1: sinais a fingir, feitos pela própria placa, para ensaiar o
// caminho inteiro sem a roda do log, sem o mostrador do vento e sem o sensor.
//
// Só se ligam por um comando $AQC com a soma certa, nunca ficam gravados (um recomeço desliga-os
// todos) e, enquanto houver algum ligado, o batimento da caixa diz que ela finge: o portátil marca
// tudo como simulado e a AI não aprende com isso.
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <driver/ledc.h>
#include <driver/uart.h>
#include <esp_rom_gpio.h>
#include <esp_timer.h>
#include <hal/gpio_ll.h>
#include <soc/gpio_sig_map.h>

#include <arlequin_linhas.h>

#include "movimento.h"
#include "pinos.h"

const uint8_t ENSAIO_LOG = 1;
const uint8_t ENSAIO_VENTO = 2;
const uint8_t ENSAIO_MOVIMENTO = 4;
const uint8_t ENSAIO_AVALANCHE = 8;

inline uint8_t ensaioLigados = 0;

inline bool ensaioAlgum() { return ensaioLigados != 0; }

inline void ensaioMarca(uint8_t qual, bool ligado) {
  if (ligado) ensaioLigados |= qual;
  else ensaioLigados &= (uint8_t)~qual;
}

// ---- A roda do log a fingir: um temporizador que mexe no próprio pino do log ------------------------
// O pino fica ao mesmo tempo saída (do gerador) e entrada (do contador): a contagem faz-se pelo caminho
// verdadeiro, sem fio nenhum por fora.
static esp_timer_handle_t ensaioLogRelogio = nullptr;
static volatile int ensaioLogNivel = 0;

static void ensaioLogMeiaVolta(void *) {
  ensaioLogNivel = !ensaioLogNivel;
  gpio_set_level((gpio_num_t)PINO_LOG, ensaioLogNivel);
}

// hz: impulsos por segundo (0 para parar; 500 no máximo). Devolve false se estiver fora dos limites.
inline bool ensaioLog(long hz) {
  if (hz < 0 || hz > 500) return false;
  if (ensaioLogRelogio) {
    esp_timer_stop(ensaioLogRelogio);
    esp_timer_delete(ensaioLogRelogio);
    ensaioLogRelogio = nullptr;
  }
  ensaioLogNivel = 0;
  gpio_set_level((gpio_num_t)PINO_LOG, 0);
  if (hz == 0) {
    gpio_set_direction((gpio_num_t)PINO_LOG, GPIO_MODE_INPUT);  // volta a ser só entrada
    ensaioMarca(ENSAIO_LOG, false);
    return true;
  }
  gpio_set_direction((gpio_num_t)PINO_LOG, GPIO_MODE_INPUT_OUTPUT);
  const esp_timer_create_args_t relogio = {.callback = ensaioLogMeiaVolta, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK, .name = "log-a-fingir", .skip_unhandled_events = true};
  if (esp_timer_create(&relogio, &ensaioLogRelogio) != ESP_OK) return false;
  esp_timer_start_periodic(ensaioLogRelogio, 500000ULL / (uint64_t)hz);  // meia volta de cada vez
  ensaioMarca(ENSAIO_LOG, true);
  return true;
}

// ---- O vento a fingir: uma segunda porta série da placa escreve a frase para o próprio pino do vento --
// A porta de escrita sai num pino sem fio (TX2) e o mesmo sinal é levado, por dentro do chip, ao pino
// do vento, que fica ao mesmo tempo saída (do gerador) e entrada (da leitura verdadeira).
//
// "Por fora" (o quarto valor do comando): a caixa faz de mostrador. A frase sai SÓ pelo pino TX2 e ao
// contrário, com o repouso em baixo, que é como o mostrador NASA a manda; não se leva por dentro ao pino
// do vento, que fica só entrada. Quem a tem de trazer, direita, ao RX2 é a plaquinha do optoacoplador,
// ligada por fora (ensaio/plaquinha-vento.js). Sem plaquinha, não entra nada.
const int PINO_GERADOR_VENTO = 17;  // TX2: sem fio nenhum, a não ser no ensaio da plaquinha
const char FIM_DE_FRASE[] = {13, 10, 0};  // o fim de uma frase NMEA 0183: CR e LF
static bool ensaioVentoLigado = false, ensaioVentoLixo = false, ensaioVentoExtra = false, ensaioVentoPorFora = false;
static long ensaioVentoGrau = 0, ensaioVentoNo = 0;  // em décimos
static uint32_t ensaioVentoProxima = 0, ensaioVentoSemente = 20261123;

// decimosDeGrau 0 a 3599 e decimosDeNo 0 a 999; (0, 0) para; (-1, x) manda lixo em vez da frase;
// extra junta por segundo uma frase que não é o MWV; porFora manda a frase só pelo pino TX2 e ao
// contrário (ver acima). Devolve false se estiver fora dos limites.
inline bool ensaioVento(long decimosDeGrau, long decimosDeNo, bool extra, bool porFora = false) {
  const bool lixo = decimosDeGrau == -1;
  if (!lixo && (decimosDeGrau < 0 || decimosDeGrau > 3599 || decimosDeNo < 0 || decimosDeNo > 999)) return false;
  const bool ligar = lixo || decimosDeGrau != 0 || decimosDeNo != 0;
  // parar, ou mudar de caminho com o gerador ligado: desliga-se primeiro, e o pino do vento volta a ser
  // só entrada
  if (ensaioVentoLigado && (!ligar || porFora != ensaioVentoPorFora)) {
    Serial1.flush();
    gpio_set_direction((gpio_num_t)PINO_VENTO, GPIO_MODE_INPUT);
    Serial1.end();
    ensaioVentoLigado = false;
  }
  if (ligar && !ensaioVentoLigado) {
    Serial1.setTxBufferSize(512);
    Serial1.begin(4800, SERIAL_8N1, -1, PINO_GERADOR_VENTO);
    // o sentido da escrita diz-se sempre, para não ficar o da vez anterior
    uart_set_line_inverse(UART_NUM_1, porFora ? UART_SIGNAL_TXD_INV : UART_SIGNAL_INV_DISABLE);
    if (!porFora) {
      gpio_set_direction((gpio_num_t)PINO_VENTO, GPIO_MODE_INPUT_OUTPUT);
      esp_rom_gpio_connect_out_signal(PINO_VENTO, U1TXD_OUT_IDX, false, false);
    }
    ensaioVentoProxima = millis();
  }
  ensaioVentoLigado = ligar;
  ensaioVentoPorFora = ligar && porFora;
  ensaioVentoLixo = lixo;
  ensaioVentoExtra = extra;
  ensaioVentoGrau = decimosDeGrau;
  ensaioVentoNo = decimosDeNo;
  ensaioMarca(ENSAIO_VENTO, ligar);
  return true;
}

// Uma frase NMEA 0183 inteira, com a soma certa.
static void ensaioFrase(const char *corpo) {
  Serial1.printf("$%s*%02X%s", corpo, aqSoma(corpo), FIM_DE_FRASE);
}

static void ensaioCorreVento(uint32_t agoraMs) {
  if (!ensaioVentoLigado || (int32_t)(agoraMs - ensaioVentoProxima) < 0) return;
  ensaioVentoProxima = agoraMs + 1000;
  if (ensaioVentoLixo) {
    Serial1.print("$IIMWV,35.0,R,14.0,N,A*00");  // uma frase com a soma errada
    Serial1.print(FIM_DE_FRASE);
    Serial1.print("$IIMWV,35.0,R,14");           // outra cortada a meio, e logo a seguir bytes ao acaso
    for (int i = 0; i < 80; i++) {
      ensaioVentoSemente = ensaioVentoSemente * 1103515245UL + 12345UL;
      Serial1.write((uint8_t)(ensaioVentoSemente >> 24));
    }
    Serial1.print(FIM_DE_FRASE);
    return;
  }
  char corpo[64];
  snprintf(corpo, sizeof(corpo), "IIMWV,%ld.%ld,R,%ld.%ld,N,A", ensaioVentoGrau / 10, ensaioVentoGrau % 10, ensaioVentoNo / 10, ensaioVentoNo % 10);
  ensaioFrase(corpo);
  if (ensaioVentoExtra) {
    snprintf(corpo, sizeof(corpo), "IIVWR,%ld.%ld,R,%ld.%ld,N,7.2,M,25.9,K", ensaioVentoGrau / 10, ensaioVentoGrau % 10, ensaioVentoNo / 10, ensaioVentoNo % 10);
    ensaioFrase(corpo);
  }
}

// ---- A avalanche: uma onda quadrada rápida num dos pinos de entrada, feita por um temporizador do chip --
// Serve para ensaiar que um fio no ar a apanhar ruído, ou um comparador a oscilar, não param a caixa. A
// onda sai pelo próprio pino (que fica saída e entrada ao mesmo tempo) e não passa pelo ciclo principal:
// continua a sair mesmo que ele deixe de correr.
static int ensaioAvalanchePino = -1;

static void ensaioAvalanchePara() {
  if (ensaioAvalanchePino < 0) return;
  ledc_stop(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, 0);
  gpio_set_direction((gpio_num_t)ensaioAvalanchePino, GPIO_MODE_INPUT);  // volta a ser só entrada
  // a saída do pino deixa de ser a do temporizador (para o gerador do log voltar a mandar nele)
  esp_rom_gpio_connect_out_signal(ensaioAvalanchePino, SIG_GPIO_OUT_IDX, false, false);
  ensaioAvalanchePino = -1;
  ensaioMarca(ENSAIO_AVALANCHE, false);
}

// qual: 1 o pino do log, 2 o do vento. khz: milhares de voltas por segundo (0 para parar; 2000 no
// máximo). Devolve false se estiver fora dos limites.
inline bool ensaioAvalanche(long qual, long khz) {
  if ((qual != 1 && qual != 2) || khz < 0 || khz > 2000) return false;
  ensaioAvalanchePara();
  if (khz == 0) return true;
  // o pino só leva um sinal a fingir de cada vez
  if (qual == 1) ensaioLog(0);
  else ensaioVento(0, 0, false);
  const int pino = qual == 1 ? PINO_LOG : PINO_VENTO;
  ledc_timer_config_t relogio = {};
  relogio.speed_mode = LEDC_LOW_SPEED_MODE;
  relogio.duty_resolution = LEDC_TIMER_1_BIT;
  relogio.timer_num = LEDC_TIMER_0;
  relogio.freq_hz = (uint32_t)khz * 1000UL;
  relogio.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&relogio) != ESP_OK) return false;
  ledc_channel_config_t canal = {};
  canal.gpio_num = pino;
  canal.speed_mode = LEDC_LOW_SPEED_MODE;
  canal.channel = LEDC_CHANNEL_0;
  canal.intr_type = LEDC_INTR_DISABLE;
  canal.timer_sel = LEDC_TIMER_0;
  canal.duty = 1;  // metade do tempo em cima
  canal.hpoint = 0;
  if (ledc_channel_config(&canal) != ESP_OK) return false;
  gpio_ll_input_enable(&GPIO, (uint32_t)pino);  // o temporizador deixou o pino só como saída: volta a ouvir-se
  ensaioAvalanchePino = pino;
  ensaioMarca(ENSAIO_AVALANCHE, true);
  return true;
}

// ---- O movimento a fingir: 100 leituras por segundo, com o cenário da caixa a fingir do portátil -----
// (software/ferramentas/caixa-a-fingir/lib/gerador.js: as mesmas contas, para os dois ensaios darem o
// mesmo.) Adornamento de 12° a estibordo; proa 245°, mais ou menos 3° de 20 em 20 s; caimento de mais
// ou menos 2° e sobe e desce de mais ou menos 0,4 m/s², os dois de 6 em 6 s. A caixa conta-se montada
// com o eixo y à proa e o z para cima.
static bool ensaioMovLigado = false;
static uint32_t ensaioMovInicio = 0, ensaioMovProxima = 0;

// O produto de dois quaterniões [i, j, k, r]: roda primeiro pelo segundo, depois pelo primeiro.
static void ensaioVezes(const float a[4], const float b[4], float o[4]) {
  o[0] = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
  o[1] = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
  o[2] = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
  o[3] = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
}

static void ensaioEmTorno(int eixo, float graus, float q[4]) {
  const float meio = graus * 0.017453293f / 2;
  q[0] = q[1] = q[2] = 0;
  q[3] = cosf(meio);
  q[eixo] = sinf(meio);
}

// Um vetor do mundo visto pelo sensor (a rotação ao contrário).
static void ensaioNoSensor(const float q[4], const float v[3], float o[3]) {
  const float a = -q[0], b = -q[1], c = -q[2], r = q[3];
  const float t[3] = {2 * (b * v[2] - c * v[1]), 2 * (c * v[0] - a * v[2]), 2 * (a * v[1] - b * v[0])};
  o[0] = v[0] + r * t[0] + (b * t[2] - c * t[1]);
  o[1] = v[1] + r * t[1] + (c * t[0] - a * t[2]);
  o[2] = v[2] + r * t[2] + (a * t[1] - b * t[0]);
}

static void ensaioUmaLeitura(float s) {
  const float DOIS_PI = 6.2831853f, GRAU = 0.017453293f, G = 9.80665f;
  const float proa = 245.0f + 3.0f * sinf(DOIS_PI * s / 20.0f);
  const float caimento = 2.0f * sinf(DOIS_PI * s / 6.0f);
  float daProa[4], doCaimento[4], doAdorno[4], meio[4], q[4];
  ensaioEmTorno(2, -proa, daProa);
  ensaioEmTorno(0, caimento, doCaimento);
  ensaioEmTorno(1, 12.0f, doAdorno);
  ensaioVezes(daProa, doCaimento, meio);
  ensaioVezes(meio, doAdorno, q);
  // o que o acelerómetro sente: o peso (para cima) mais o sobe e desce, vistos pelo sensor inclinado
  const float mundo[3] = {0, 0, G + 0.4f * sinf(DOIS_PI * s / 6.0f)};
  float a[3];
  ensaioNoSensor(q, mundo, a);
  movAceleracao(a[0], a[1], a[2]);
  // a rotação: o caimento a mexer (em torno do x) e a proa a passear (em torno do z, ao contrário)
  movRotacao(2.0f * GRAU * (DOIS_PI / 6.0f) * cosf(DOIS_PI * s / 6.0f), 0, -3.0f * GRAU * (DOIS_PI / 20.0f) * cosf(DOIS_PI * s / 20.0f));
  movAtitude(q[0], q[1], q[2], q[3], 0.0349f, 3);
}

// ligado: 1 liga, 0 desliga. Devolve false se for outra coisa.
inline bool ensaioMovimento(long ligado) {
  if (ligado != 0 && ligado != 1) return false;
  if (ligado && !ensaioMovLigado) {
    ensaioMovInicio = millis();
    ensaioMovProxima = ensaioMovInicio;
  } else if (!ligado && ensaioMovLigado) {
    movLimpa();
  }
  ensaioMovLigado = ligado == 1;
  ensaioMarca(ENSAIO_MOVIMENTO, ensaioMovLigado);
  return true;
}

static void ensaioCorreMovimento(uint32_t agoraMs) {
  if (!ensaioMovLigado) return;
  int feitas = 0;
  while ((int32_t)(agoraMs - ensaioMovProxima) >= 0 && feitas < 20) {  // uma leitura de 10 em 10 ms
    ensaioUmaLeitura((ensaioMovProxima - ensaioMovInicio) / 1000.0f);
    ensaioMovProxima += 10;
    feitas++;
  }
  if ((int32_t)(agoraMs - ensaioMovProxima) >= 0) ensaioMovProxima = agoraMs + 10;  // muito atrasado: acerta
}

// Chama-se em cada volta do ciclo principal: manda o que os geradores devem neste instante.
inline void ensaioCorre(uint32_t agoraMs) {
  ensaioCorreMovimento(agoraMs);
  ensaioCorreVento(agoraMs);
}

inline void ensaioParar() {
  ensaioAvalanchePara();
  ensaioLog(0);
  ensaioVento(0, 0, false);
  ensaioMovimento(0);
  ensaioLigados = 0;
}
