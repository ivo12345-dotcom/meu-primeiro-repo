// O barramento do motor (J1939, 250 kbit/s), SÓ EM ESCUTA.
//
// O controlador do chip é pedido em modo de só escuta: não manda tramas, não confirma as dos outros e
// não mexe na linha, nem quando há erros. Neste ficheiro e nesta caixa não há nenhuma chamada de envio:
// há um ensaio que lê o código e falha se aparecer uma (software/caixas/ensaio/caixa2.test.js).
// Do lado dos fios a garantia repete-se: o pino de escrita do módulo fica preso aos 3,3 V (pinos.h).
//
// Só passam as tramas de identificador comprido (29 bits), que são as do J1939.
#pragma once

#include <Arduino.h>
#include <driver/twai.h>
#include <esp_timer.h>

#include <arlequin_radio.h>

#include "pinos.h"

inline uint32_t motorTramas = 0;       // tramas lidas da linha do motor desde o arranque
inline uint32_t motorIgnoradas = 0;    // tramas de identificador curto, que não são do J1939
static bool motorLigado = false;

inline bool motorIniciar() {
  twai_general_config_t geral = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)PINO_MOTOR_ESCREVE, (gpio_num_t)PINO_MOTOR_LE, TWAI_MODE_LISTEN_ONLY);
  geral.rx_queue_len = 64;
  const twai_timing_config_t tempos = TWAI_TIMING_CONFIG_250KBITS();
  const twai_filter_config_t filtro = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  motorLigado = twai_driver_install(&geral, &tempos, &filtro) == ESP_OK && twai_start() == ESP_OK;
  return motorLigado;
}

// A trama seguinte que estiver à espera, com a hora desta caixa. Não espera: false se não houver.
inline bool motorLe(AqTrama &t) {
  if (!motorLigado) return false;
  twai_message_t m;
  while (twai_receive(&m, 0) == ESP_OK) {
    if (!m.extd || m.rtr) {
      motorIgnoradas++;
      continue;
    }
    const int64_t agora = esp_timer_get_time();
    t.id = m.identifier & 0x1FFFFFFFUL;
    t.quantos = m.data_length_code > 8 ? 8 : m.data_length_code;
    memset(t.dados, 0, sizeof(t.dados));
    memcpy(t.dados, m.data, t.quantos);
    t.s = (uint32_t)(agora / 1000000LL);
    t.us = (uint32_t)(agora % 1000000LL);
    motorTramas++;
    return true;
  }
  return false;
}
