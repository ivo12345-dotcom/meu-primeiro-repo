// A roda do log: conta os impulsos e mede o tempo entre os dois últimos.
// Manda duas vezes por segundo: $AQL,<ms>,<impulsos desde o arranque>,<período em µs, 0 se não houver>
// A conta da velocidade é do portátil (plugin das caixas); daqui só sai o que se contou.
//
// Duas subidas a menos de 4 ms uma da outra contam como uma só: a roda nunca dá mais de umas dezenas
// de impulsos por segundo, e um impulso "duplo" é ruído do comparador.
#pragma once

#include <Arduino.h>
#include <esp_timer.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint32_t LOG_MS = 500;
const int64_t LOG_MINIMO_US = 4000;

static portMUX_TYPE logTrinco = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t logImpulsos = 0;
static volatile uint32_t logPeriodoUs = 0;
static volatile int64_t logUltimaUs = 0;  // a hora da última subida que contou (0: ainda nenhuma)
static uint32_t logProxima = 0;

static void IRAM_ATTR logSubida() {
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
  }
  portEXIT_CRITICAL_ISR(&logTrinco);
}

inline void logIniciar() {
  pinMode(PINO_LOG, INPUT_PULLDOWN);
  attachInterrupt(digitalPinToInterrupt(PINO_LOG), logSubida, RISING);
  logProxima = millis() + LOG_MS;
}

inline void logCorre(uint32_t agoraMs) {
  if ((int32_t)(agoraMs - logProxima) < 0) return;
  logProxima += LOG_MS;
  if ((int32_t)(agoraMs - logProxima) >= 0) logProxima = agoraMs + LOG_MS;  // ficou para trás: acerta
  portENTER_CRITICAL(&logTrinco);
  const uint32_t impulsos = logImpulsos;
  const uint32_t periodo = logPeriodoUs;
  portEXIT_CRITICAL(&logTrinco);
  AqLinha("L").u(agoraMs).u(impulsos).u(periodo).manda(Serial);
}
