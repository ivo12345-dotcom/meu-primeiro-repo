// O movimento do barco: junta as leituras do sensor (pelo menos 100 por segundo) e manda a média de
// cada décimo de segundo, 10 vezes por segundo:
//   $AQM,<n.º de ordem>,<k>,<aceleração x,y,z em mm/s²>,<rotação x,y,z em 0,1 mrad/s>,
//        <quaternião i,j,k,r × 10 000>,<erro estimado da atitude em 0,1 mrad>,<confiança 0 a 3>
// k é o número de leituras de aceleração que entraram na média. A atitude não se faz média: vai a
// última. Sem acelerações nesse décimo (ou sem nenhuma atitude ainda) não sai linha nenhuma e o número
// de ordem não avança: no portátil, um salto no número quer dizer mesmo uma linha perdida.
//
// A média é o que tira a vibração do motor da medida da onda (desenho, "Sobe e desce da onda", regra 1).
// Quem dá as leituras é o sensor.h (o sensor verdadeiro) ou o ensaio.h (o gerador de bancada).
#pragma once

#include <Arduino.h>

#include <arlequin_linhas.h>

const uint32_t MOV_MS = 100;

static double movSomaA[3] = {0, 0, 0}, movSomaW[3] = {0, 0, 0};
static uint32_t movKA = 0, movKW = 0;
static float movQ[4] = {0, 0, 0, 1}, movErro = 0;
static uint8_t movConfianca = 0;
static bool movTemAtitude = false;
static uint32_t movN = 0, movProxima = 0;

inline void movAceleracao(float x, float y, float z) {  // m/s²
  movSomaA[0] += x;
  movSomaA[1] += y;
  movSomaA[2] += z;
  movKA++;
}

inline void movRotacao(float x, float y, float z) {  // rad/s
  movSomaW[0] += x;
  movSomaW[1] += y;
  movSomaW[2] += z;
  movKW++;
}

inline void movAtitude(float i, float j, float k, float r, float erroRad, uint8_t confianca) {
  const float norma = sqrtf(i * i + j * j + k * k + r * r);
  if (!(norma > 0.5f && norma < 2.0f)) return;  // um quaternião sem pés nem cabeça não entra
  movQ[0] = i / norma;
  movQ[1] = j / norma;
  movQ[2] = k / norma;
  movQ[3] = r / norma;
  movErro = erroRad;
  movConfianca = confianca & 3;
  movTemAtitude = true;
}

// Arredonda e prende aos limites do contrato das linhas.
static long movPrende(double v, long limite) {
  if (!(v == v)) return 0;  // nunca um "não é número"
  const long r = lround(v);
  return r > limite ? limite : (r < -limite ? -limite : r);
}

inline void movIniciar() { movProxima = millis() + MOV_MS; }

inline void movCorre(uint32_t agoraMs) {
  if ((int32_t)(agoraMs - movProxima) < 0) return;
  movProxima += MOV_MS;
  if ((int32_t)(agoraMs - movProxima) >= 0) movProxima = agoraMs + MOV_MS;  // ficou para trás: acerta

  const uint32_t ka = movKA, kw = movKW;
  const double a[3] = {movSomaA[0], movSomaA[1], movSomaA[2]}, w[3] = {movSomaW[0], movSomaW[1], movSomaW[2]};
  movSomaA[0] = movSomaA[1] = movSomaA[2] = movSomaW[0] = movSomaW[1] = movSomaW[2] = 0;
  movKA = movKW = 0;
  if (ka == 0 || !movTemAtitude) return;

  movN++;
  AqLinha l("M");
  l.u(movN).u(ka > 255 ? 255 : ka);
  for (int e = 0; e < 3; e++) l.i(movPrende(a[e] / ka * 1000.0, 160000));
  for (int e = 0; e < 3; e++) l.i(kw ? movPrende(w[e] / kw * 10000.0, 350000) : 0);
  for (int e = 0; e < 4; e++) l.i(movPrende(movQ[e] * 10000.0, 10000));
  long erro = movPrende(movErro * 10000.0, 31416);
  l.i(erro < 0 ? 0 : erro).i(movConfianca);
  l.manda(Serial);
}

// Deita fora o que estiver a meio (o sensor calou-se, ou o gerador foi desligado): a próxima linha só
// leva leituras novas.
inline void movLimpa() {
  movSomaA[0] = movSomaA[1] = movSomaA[2] = movSomaW[0] = movSomaW[1] = movSomaW[2] = 0;
  movKA = movKW = 0;
  movTemAtitude = false;
}
