// A roda do log: conta as voltas e mede o tempo entre as duas últimas.
// Manda duas vezes por segundo: $AQL,<ms>,<impulsos desde o arranque>,<período em µs, 0 se não houver>
// A conta da velocidade é do portátil (plugin das caixas); daqui só sai o que se contou.
//
// A roda é um contacto fechado quase a volta toda, que abre uma vez por volta (medido no barco a
// 27/11/2026): cada vez que volta a fechar, o pino sobe, e é uma volta. Mas nem toda a subida é uma volta:
//   - o contacto pode ressaltar ao abrir (fecha um instante e abre outra vez);
//   - o condensador da entrada faz o pino descer devagar quando a roda abre, e as entradas deste chip não
//     têm folga entre o "em cima" e o "em baixo": a meio da descida pode aparecer uma subida que não existe.
// Por isso uma subida só conta se o pino se aguentar em cima 2 ms seguidos (LOG_FIRME_US). A roda fechada
// aguenta-se muito mais do que isso; um ressalto ou uma subida falsa, muito menos. A hora da volta é a da
// subida, não a da confirmação: o período entre voltas não fica mexido.
//
// Duas voltas a menos de 4 ms uma da outra contam como uma só: a roda nunca dá mais de umas dezenas por
// segundo.
//
// As subidas que não contaram (não se aguentaram, ou vieram coladas à volta anterior) somam-se em
// "log-recusados" (comando estado). Com um contacto que ressalta, sobe uma ou duas por volta: é a regra a
// trabalhar. A subir aos milhares por segundo, é ruído no fio.
//
// Para se ver de fora como o contacto verdadeiro se porta, guardam-se três medidas (comando "tempos"):
// quanto tempo o pino esteve em baixo na última volta e na mais curta (a roda aberta, contada da descida
// à subida que ficou), e a subida recusada mais comprida. Não entram em conta nenhuma. Dizem se o
// condensador da entrada deixa o pino descer a tempo com a roda depressa, e que folga têm os 2 ms.
//
// Uma avalanche de mudanças (o fio no ar a apanhar ruído) não pode parar a caixa. Por isso a interrupção
// do pino atende, no máximo, LOG_RAJADA mudanças em cada volta do ciclo principal; passando disso desliga-se
// até à volta seguinte, e a subida que estivesse à espera fica sem efeito (sem olhar para o pino não se
// sabe se ele se aguentou). As voltas do ciclo em que isso aconteceu contam-se em "caladas" (comando
// tempos): com a roda a andar e o fio bom, não sobem. (Revisão final de 23/11/2026: com 1 MHz neste pino
// a caixa deixava de responder e recomeçava.)
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_timer.h>
#include <hal/gpio_ll.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint32_t LOG_MS = 500;
const int64_t LOG_MINIMO_US = 4000;  // duas voltas a menos disto uma da outra: a segunda não conta
const int64_t LOG_FIRME_US = 2000;   // uma subida só é uma volta se o pino se aguentar em cima este tempo
const uint32_t LOG_RAJADA = 16;      // mudanças do pino atendidas em cada volta do ciclo principal, no máximo

static portMUX_TYPE logTrinco = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t logImpulsos = 0;
static volatile uint32_t logPeriodoUs = 0;
static volatile int64_t logUltimaUs = 0;    // a hora da última volta contada (0: ainda nenhuma)
static volatile int64_t logSubiuUs = 0;     // a hora de uma subida à espera de se ver se o pino se aguenta (0: nenhuma)
static volatile bool logEmCima = false;     // como estava o pino da última vez que se olhou para ele
static volatile uint32_t logRecusados = 0;  // subidas que não contaram como volta
static volatile uint32_t logNaVolta = 0;    // mudanças atendidas nesta volta do ciclo
static volatile bool logCalado = false;     // a interrupção do pino está desligada até à volta seguinte
static uint32_t logProxima = 0;

// As medidas do contacto (comando "tempos"). Só se guardam: não entram na contagem.
static volatile bool logFirme = false;          // a última coisa confirmada foi o pino em cima (a roda fechada)
static volatile int64_t logDesceuUs = 0;        // quando o pino desceu depois de ter estado firme em cima (0: não se sabe)
static volatile uint32_t logAbertaUltUs = 0;    // quanto esteve em baixo na última volta, da descida à subida que ficou
static volatile uint32_t logAbertaMinUs = 0;    // a volta em que esteve menos tempo, desde a última pergunta (0: nenhuma)
static volatile uint32_t logRecusadaMaxUs = 0;  // a subida recusada mais comprida, desde a última pergunta
static volatile uint32_t logCaladas = 0;        // voltas do ciclo em que a interrupção se calou por haver mudanças a mais

// Com o trinco fechado. A subida de "quando" aguentou-se: é uma volta, se não vier colada à anterior.
static void IRAM_ATTR logConta(int64_t quando) {
  if (logUltimaUs == 0) {
    logUltimaUs = quando;
    logImpulsos = logImpulsos + 1;
  } else if (quando - logUltimaUs >= LOG_MINIMO_US) {
    const int64_t periodo = quando - logUltimaUs;
    logPeriodoUs = periodo > 0xFFFFFFFFLL ? 0xFFFFFFFFUL : (uint32_t)periodo;
    logUltimaUs = quando;
    logImpulsos = logImpulsos + 1;
  } else {
    logRecusados = logRecusados + 1;
  }
}

// Com o trinco fechado. Olhou-se para o pino agora e está em cima (ou em baixo): acerta-se o que se sabe.
// Chama-se a cada mudança do pino (a interrupção) e em todas as voltas do ciclo principal.
static void IRAM_ATTR logOlha(int64_t agora, bool emCima) {
  // a subida que estava à espera já se aguentou o tempo todo (uma descida pelo meio tinha-a anulado): conta
  if (logSubiuUs != 0 && agora - logSubiuUs >= LOG_FIRME_US) {
    if (logDesceuUs != 0) {  // a parte aberta da volta: da descida até esta subida, que ficou
      const int64_t aberta = logSubiuUs - logDesceuUs;
      const uint32_t us = aberta > 0xFFFFFFFFLL ? 0xFFFFFFFFUL : aberta < 1 ? 1 : (uint32_t)aberta;
      logAbertaUltUs = us;
      if (logAbertaMinUs == 0 || us < logAbertaMinUs) logAbertaMinUs = us;
      logDesceuUs = 0;
    }
    logFirme = true;
    logConta(logSubiuUs);
    logSubiuUs = 0;
  }
  if (emCima) {
    if (!logEmCima) logSubiuUs = agora;  // subiu agora: fica à espera
  } else {
    if (logSubiuUs != 0) {  // desceu antes do tempo: não era uma volta
      const int64_t durou = agora - logSubiuUs;
      if (durou > (int64_t)logRecusadaMaxUs) logRecusadaMaxUs = (uint32_t)durou;
      logSubiuUs = 0;
      logRecusados = logRecusados + 1;
    }
    if (logFirme) {  // a roda abriu: daqui até à subida que ficar é a parte aberta da volta
      logFirme = false;
      logDesceuUs = agora;
    }
  }
  logEmCima = emCima;
}

static void IRAM_ATTR logMexeu() {
  const int64_t agora = esp_timer_get_time();
  portENTER_CRITICAL_ISR(&logTrinco);
  logOlha(agora, gpio_ll_get_level(&GPIO, PINO_LOG) != 0);
  logNaVolta = logNaVolta + 1;
  if (logNaVolta >= LOG_RAJADA) {
    gpio_ll_intr_disable(&GPIO, PINO_LOG);
    logCalado = true;
    logCaladas = logCaladas + 1;
    if (logSubiuUs != 0) {  // deixa-se de olhar: a subida à espera fica sem efeito
      logSubiuUs = 0;
      logRecusados = logRecusados + 1;
    }
  }
  portEXIT_CRITICAL_ISR(&logTrinco);
}

inline void logIniciar() {
  pinMode(PINO_LOG, INPUT_PULLDOWN);
  // a roda parada costuma estar fechada, com o pino em cima: isso não é uma subida, nem uma volta
  logEmCima = digitalRead(PINO_LOG) != 0;
  logFirme = logEmCima;
  attachInterrupt(digitalPinToInterrupt(PINO_LOG), logMexeu, CHANGE);
  logProxima = millis() + LOG_MS;
}

// O texto do comando "tempos": as medidas do contacto, em microssegundos, e as voltas do ciclo em que a
// entrada se calou. A mais curta e a mais comprida contam-se desde a última vez que se perguntou.
#define LOG_TEMPOS_FORMATO "aberta-ult=%lu;aberta-min=%lu;recusada-max=%lu;caladas=%lu"
inline void logTempos(char *texto, size_t espaco) {
  portENTER_CRITICAL(&logTrinco);
  const uint32_t ult = logAbertaUltUs, min = logAbertaMinUs, max = logRecusadaMaxUs, caladas = logCaladas;
  logAbertaMinUs = 0;
  logRecusadaMaxUs = 0;
  portEXIT_CRITICAL(&logTrinco);
  snprintf(texto, espaco, LOG_TEMPOS_FORMATO, (unsigned long)ult, (unsigned long)min, (unsigned long)max, (unsigned long)caladas);
}

// Chama-se em todas as voltas do ciclo principal.
inline void logCorre(uint32_t agoraMs) {
  portENTER_CRITICAL(&logTrinco);
  logNaVolta = 0;
  const bool calado = logCalado;
  logCalado = false;
  portEXIT_CRITICAL(&logTrinco);
  if (calado) gpio_intr_enable((gpio_num_t)PINO_LOG);  // limpa o que ficou pendente e volta a ouvir o pino
  // Olha-se para o pino em todas as voltas: é aqui que conta a subida que se aguentou e a que não teve
  // mais mudança nenhuma depois dela (a roda parou fechada), e que se dá pela subida que tenha acontecido
  // com a interrupção calada.
  portENTER_CRITICAL(&logTrinco);
  logOlha(esp_timer_get_time(), gpio_ll_get_level(&GPIO, PINO_LOG) != 0);
  // Com ruído muito rápido, a interrupção pode ter-se calado outra vez entre o voltar a ligá-la e este
  // olhar. Ninguém fica então a vigiar o pino até à volta seguinte, e a subida que este olhar tenha posto
  // à espera não vale. (Revisão de 28/11/2026: com o ciclo a parar uns 50 ms a meio do ruído, contava-se
  // uma volta que não existia.)
  if (logCalado && logSubiuUs != 0) {
    logSubiuUs = 0;
    logRecusados = logRecusados + 1;
  }
  portEXIT_CRITICAL(&logTrinco);

  if ((int32_t)(agoraMs - logProxima) < 0) return;
  logProxima += LOG_MS;
  if ((int32_t)(agoraMs - logProxima) >= 0) logProxima = agoraMs + LOG_MS;  // ficou para trás: acerta
  portENTER_CRITICAL(&logTrinco);
  const uint32_t impulsos = logImpulsos;
  const uint32_t periodo = logPeriodoUs;
  portEXIT_CRITICAL(&logTrinco);
  AqLinha("L").u(agoraMs).u(impulsos).u(periodo).manda(Serial);
}
