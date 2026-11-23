// Os geradores de bancada da caixa 1: sinais a fingir, feitos pela própria placa, para ensaiar o
// caminho inteiro sem a roda do log, sem o mostrador do vento e sem o sensor.
//
// Só se ligam por um comando $AQC com a soma certa, nunca ficam gravados (um recomeço desliga-os
// todos) e, enquanto houver algum ligado, o batimento da caixa diz que ela finge: o portátil marca
// tudo como simulado e a AI não aprende com isso.
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_timer.h>

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

inline void ensaioParar() {
  ensaioLog(0);
  ensaioLigados = 0;
}
