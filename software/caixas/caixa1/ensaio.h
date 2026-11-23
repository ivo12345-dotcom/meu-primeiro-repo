// Os geradores de bancada da caixa 1: sinais a fingir, feitos pela própria placa, para ensaiar o
// caminho inteiro sem a roda do log, sem o mostrador do vento e sem o sensor.
//
// Só se ligam por um comando $AQC com a soma certa, nunca ficam gravados (um recomeço desliga-os
// todos) e, enquanto houver algum ligado, o batimento da caixa diz que ela finge: o portátil marca
// tudo como simulado e a AI não aprende com isso.
#pragma once

#include <Arduino.h>

const uint8_t ENSAIO_LOG = 1;
const uint8_t ENSAIO_VENTO = 2;
const uint8_t ENSAIO_MOVIMENTO = 4;

inline uint8_t ensaioLigados = 0;

inline bool ensaioAlgum() { return ensaioLigados != 0; }

inline void ensaioMarca(uint8_t qual, bool ligado) {
  if (ligado) ensaioLigados |= qual;
  else ensaioLigados &= (uint8_t)~qual;
}

// A roda do log a fingir, em impulsos por segundo (0 para parar; 200 no máximo).
// O gerador a sério chega com o log.h; aqui fica só o estado.
inline bool ensaioLog(long hz) {
  if (hz < 0 || hz > 400) return false;
  ensaioMarca(ENSAIO_LOG, hz > 0);
  return true;
}

inline void ensaioParar() {
  ensaioLog(0);
  ensaioLigados = 0;
}
