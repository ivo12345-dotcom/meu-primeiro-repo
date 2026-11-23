// O gerador de bancada da caixa 2: tramas do motor a fingir, com as contas do simulador do portátil
// (software/arlequin-simulador/lib/j1939sim.js), feitas aqui em vez de lidas da linha do motor. Daí em
// diante o caminho é o verdadeiro: pacotes pelo rádio para a caixa 1 e linhas para o portátil.
//
// Só se liga por um comando $AQC com a soma certa, nunca fica gravado, e enquanto estiver ligado o
// batimento desta caixa diz que ela finge.
#pragma once

#include <Arduino.h>
#include <esp_timer.h>

#include <arlequin_radio.h>

static long ensaioRpm = 0;  // 0: gerador desligado
static uint32_t ensaioProximaRotacao = 0, ensaioProximoResto = 0;

inline bool ensaioAlgum() { return ensaioRpm > 0; }

// rpm: rotações por minuto a fingir (0 para parar; 4000 no máximo). false se estiver fora dos limites.
inline bool ensaioMotor(long rpm) {
  if (rpm < 0 || rpm > 4000) return false;
  if (rpm > 0 && ensaioRpm == 0) ensaioProximaRotacao = ensaioProximoResto = millis();
  ensaioRpm = rpm;
  return true;
}

inline void ensaioParar() { ensaioRpm = 0; }

// O identificador de uma trama do J1939: prioridade, número da mensagem (PGN) e endereço de origem 0.
static uint32_t ensaioId(uint8_t prioridade, uint32_t pgn) { return ((uint32_t)(prioridade & 7) << 26) | (pgn << 8); }

static AqTrama ensaioTrama(uint32_t id, const uint8_t dados[8]) {
  AqTrama t;
  const int64_t agora = esp_timer_get_time();
  t.id = id;
  t.quantos = 8;
  memcpy(t.dados, dados, 8);
  t.s = (uint32_t)(agora / 1000000LL);
  t.us = (uint32_t)(agora % 1000000LL);
  return t;
}

// Chama-se em cada volta do ciclo: dá ao "junta" as tramas devidas neste instante. As rotações saem
// 10 vezes por segundo; a temperatura da água (82 °C), a tensão (14,2 V), as horas (1243,5 h, a contar)
// e o estado inventado da ignição, 1 vez por segundo.
template <typename Junta>
inline void ensaioCorre(uint32_t agoraMs, Junta junta) {
  if (ensaioRpm <= 0) return;
  if ((int32_t)(agoraMs - ensaioProximaRotacao) >= 0) {
    ensaioProximaRotacao = agoraMs + 100;
    const uint16_t v = (uint16_t)(ensaioRpm * 8);  // 0,125 rotações por minuto por unidade
    const uint8_t d[8] = {0xFF, 0xFF, 0xFF, (uint8_t)(v & 0xFF), (uint8_t)(v >> 8), 0xFF, 0xFF, 0xFF};
    junta(ensaioTrama(ensaioId(3, 61444), d));
  }
  if ((int32_t)(agoraMs - ensaioProximoResto) >= 0) {
    ensaioProximoResto = agoraMs + 1000;
    const uint8_t agua[8] = {82 + 40, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    junta(ensaioTrama(ensaioId(6, 65262), agua));
    const uint16_t volt = 284;  // 14,2 V a 0,05 V por unidade
    const uint8_t tensao[8] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, (uint8_t)(volt & 0xFF), (uint8_t)(volt >> 8)};
    junta(ensaioTrama(ensaioId(6, 65271), tensao));
    const uint32_t h = 24870UL + agoraMs / 180000UL;  // 1243,5 h a 0,05 h por unidade, mais o tempo ligado
    const uint8_t horas[8] = {(uint8_t)h, (uint8_t)(h >> 8), (uint8_t)(h >> 16), (uint8_t)(h >> 24), 0xFF, 0xFF, 0xFF, 0xFF};
    junta(ensaioTrama(ensaioId(6, 65253), horas));
    const uint8_t ignicao[8] = {(uint8_t)(ensaioRpm > 300 ? 0x00 : 0x03), 0, 0, 0, 0, 0, 0, 0};
    junta(ensaioTrama(ensaioId(6, 65417), ignicao));
  }
}
