// A roda do log: conta os impulsos e mede o tempo entre os dois últimos.
// Manda duas vezes por segundo: $AQL,<ms>,<impulsos desde o arranque>,<período em µs, 0 se não houver>
// A conta da velocidade é do portátil (plugin das caixas); daqui só sai o que se contou.
//
// Duas subidas a menos de 4 ms uma da outra contam como uma só: a roda nunca dá mais de umas dezenas
// de impulsos por segundo, e um impulso "duplo" é ruído do comparador.
//
// Uma avalanche de flancos (o fio no ar a apanhar ruído, o comparador a oscilar) não pode parar a caixa.
// Por isso cada interrupção desliga a do próprio pino, e é o ciclo principal que a volta a ligar na
// volta seguinte: há no máximo uma por volta (cerca de mil por segundo), venham os flancos que vierem.
// A roda dá, quando muito, umas dezenas de impulsos por segundo: não se perde nenhum verdadeiro.
// (Revisão final de 23/11/2026: com 1 MHz neste pino a caixa deixava de responder e recomeçava.)
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_timer.h>
#include <hal/gpio_ll.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint32_t LOG_MS = 500;
const int64_t LOG_MINIMO_US = 4000;

static portMUX_TYPE logTrinco = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t logImpulsos = 0;
static volatile uint32_t logPeriodoUs = 0;
static volatile int64_t logUltimaUs = 0;  // a hora da última subida que contou (0: ainda nenhuma)
static volatile uint32_t logRecusados = 0;  // subidas a menos de 4 ms da anterior: ruído, ou uma avalanche
static volatile bool logCalado = false;     // a interrupção do pino está desligada até à volta seguinte
static uint32_t logProxima = 0;

static void IRAM_ATTR logSubida() {
  gpio_ll_intr_disable(&GPIO, PINO_LOG);
  logCalado = true;
  const int64_t agora = esp_timer_get_time();
  portENTER_CRITICAL_ISR(&logTrinco);
  if (logUltimaUs == 0) {
    logUltimaUs = agora;
    logImpulsos++;
  } else if (agora - logUltimaUs >= LOG_MINIMO_US) {
    const int64_t periodo = agora - logUltimaUs;
    logPeriodoUs = periodo > 0xFFFFFFFFLL ? 0xFFFFFFFFUL : (uint32_t)periodo;
    logUltimaUs = agora;
    logImpulsos++;
  } else {
    logRecusados = logRecusados + 1;
  }
  portEXIT_CRITICAL_ISR(&logTrinco);
}

inline void logIniciar() {
  pinMode(PINO_LOG, INPUT_PULLDOWN);
  attachInterrupt(digitalPinToInterrupt(PINO_LOG), logSubida, RISING);
  logProxima = millis() + LOG_MS;
}

// Chama-se em todas as voltas do ciclo principal.
inline void logCorre(uint32_t agoraMs) {
  if (logCalado) {
    logCalado = false;
    gpio_intr_enable((gpio_num_t)PINO_LOG);  // limpa o que ficou pendente e volta a ouvir o pino
  }
  if ((int32_t)(agoraMs - logProxima) < 0) return;
  logProxima += LOG_MS;
  if ((int32_t)(agoraMs - logProxima) >= 0) logProxima = agoraMs + LOG_MS;  // ficou para trás: acerta
  portENTER_CRITICAL(&logTrinco);
  const uint32_t impulsos = logImpulsos;
  const uint32_t periodo = logPeriodoUs;
  portEXIT_CRITICAL(&logTrinco);
  AqLinha("L").u(agoraMs).u(impulsos).u(periodo).manda(Serial);
}
