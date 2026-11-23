// Os geradores de bancada da caixa 1: sinais a fingir, feitos pela própria placa, para ensaiar o
// caminho inteiro sem a roda do log, sem o mostrador do vento e sem o sensor.
//
// Só se ligam por um comando $AQC com a soma certa, nunca ficam gravados (um recomeço desliga-os
// todos) e, enquanto houver algum ligado, o batimento da caixa diz que ela finge: o portátil marca
// tudo como simulado e a AI não aprende com isso.
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_rom_gpio.h>
#include <esp_timer.h>
#include <soc/gpio_sig_map.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint8_t ENSAIO_LOG = 1;
const uint8_t ENSAIO_VENTO = 2;
const uint8_t ENSAIO_MOVIMENTO = 4;

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
const int PINO_GERADOR_VENTO = 17;  // TX2: não leva fio nenhum
const char FIM_DE_FRASE[] = {13, 10, 0};  // o fim de uma frase NMEA 0183: CR e LF
static bool ensaioVentoLigado = false, ensaioVentoLixo = false, ensaioVentoExtra = false;
static long ensaioVentoGrau = 0, ensaioVentoNo = 0;  // em décimos
static uint32_t ensaioVentoProxima = 0, ensaioVentoSemente = 20261123;

// decimosDeGrau 0 a 3599 e decimosDeNo 0 a 999; (0, 0) para; (-1, x) manda lixo em vez da frase;
// extra junta por segundo uma frase que não é o MWV. Devolve false se estiver fora dos limites.
inline bool ensaioVento(long decimosDeGrau, long decimosDeNo, bool extra) {
  const bool lixo = decimosDeGrau == -1;
  if (!lixo && (decimosDeGrau < 0 || decimosDeGrau > 3599 || decimosDeNo < 0 || decimosDeNo > 999)) return false;
  const bool ligar = lixo || decimosDeGrau != 0 || decimosDeNo != 0;
  if (ligar && !ensaioVentoLigado) {
    Serial1.setTxBufferSize(512);
    Serial1.begin(4800, SERIAL_8N1, -1, PINO_GERADOR_VENTO);
    gpio_set_direction((gpio_num_t)PINO_VENTO, GPIO_MODE_INPUT_OUTPUT);
    esp_rom_gpio_connect_out_signal(PINO_VENTO, U1TXD_OUT_IDX, false, false);
    ensaioVentoProxima = millis();
  } else if (!ligar && ensaioVentoLigado) {
    Serial1.flush();
    gpio_set_direction((gpio_num_t)PINO_VENTO, GPIO_MODE_INPUT);  // volta a ser só entrada
    Serial1.end();
  }
  ensaioVentoLigado = ligar;
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

// Chama-se em cada volta do ciclo principal: manda o que os geradores devem neste instante.
inline void ensaioCorre(uint32_t agoraMs) {
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

inline void ensaioParar() {
  ensaioLog(0);
  ensaioVento(0, 0, false);
  ensaioLigados = 0;
}
