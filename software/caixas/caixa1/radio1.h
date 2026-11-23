// O rádio do lado da caixa 1: manda o farol e passa ao portátil o que a caixa 2 mandar.
//   por cada batimento da caixa 2:  $AQB,2,<ms dela>,<versão>,<a fingir>,<força do rádio em dBm>,<perdidos>
//   por cada trama do motor:        (s.µs) can1 ID#DADOS*HH, com a hora da caixa 2
// Os pacotes chegam numa tarefa do rádio; passam para o ciclo principal por uma fila, porque só ele
// escreve na porta. Fila cheia conta em perdidos.
#pragma once

#include <Arduino.h>

#include <arlequin_linhas.h>
#include <arlequin_radio.h>

const uint32_t FAROL_MS = 1000;
const int RADIO_FILA = 32;
const int RADIO_POR_VOLTA = 8;  // pacotes tratados em cada volta do ciclo, no máximo

struct RadioPacote {
  int8_t rssi;
  uint8_t n;
  uint8_t dados[250];
};

static QueueHandle_t radioFila = nullptr;
static volatile uint32_t radioFilaCheia = 0;
static bool radioLigado = false;
static uint16_t radioArranque = 0, radioOrdem = 0;
static uint32_t radioProximoFarol = 0;
static AqPerdidos radioPerdidos;
static bool radioConhece2 = false;
static uint16_t radioArranque2 = 0;

static void radioAoReceber(const esp_now_recv_info_t *de, const uint8_t *dados, int n) {
  if (!radioFila || n > (int)sizeof(RadioPacote::dados) || !aqCabecalhoBom(dados, n)) return;
  RadioPacote p;
  p.rssi = (de && de->rx_ctrl) ? (int8_t)de->rx_ctrl->rssi : 0;
  p.n = (uint8_t)n;
  memcpy(p.dados, dados, n);
  if (xQueueSend(radioFila, &p, 0) != pdTRUE) radioFilaCheia = radioFilaCheia + 1;
}

inline void radioIniciar() {
  radioFila = xQueueCreate(RADIO_FILA, sizeof(RadioPacote));
  radioArranque = aqNumeroDoArranque();
  radioLigado = radioFila && aqRadioLiga(radioAoReceber);
  radioProximoFarol = millis();
}

// O número de ordem deste pacote da caixa 2: conta os saltos, e recomeça a contar se ela recomeçou.
static void radioConta(const AqCabecalho *c) {
  if (!radioConhece2 || c->arranque != radioArranque2) {
    radioConhece2 = true;
    radioArranque2 = c->arranque;
    radioPerdidos.recomecou();
  }
  radioPerdidos.chegou(c->ordem);
}

static void radioTrata(const RadioPacote &p) {
  const AqCabecalho *c = (const AqCabecalho *)p.dados;
  if (c->tipo == AQ_BATIMENTO && p.n >= sizeof(AqPacoteBatimento)) {
    const AqPacoteBatimento *b = (const AqPacoteBatimento *)p.dados;
    radioConta(c);
    char fw[13];
    size_t k = 0;
    for (; k < 12 && b->fw[k]; k++) {
      const char ch = b->fw[k];
      fw[k] = (isalnum((unsigned char)ch) || ch == '.' || ch == '_' || ch == '-') ? ch : '-';
    }
    if (k == 0) fw[k++] = '0';
    fw[k] = '\0';
    const int rssi = p.rssi > 0 ? 0 : (p.rssi < -127 ? -127 : p.rssi);
    AqLinha("B").i(2).u(b->ms).t(fw).i(b->sim ? 1 : 0).i(rssi).u(radioPerdidos.total + radioFilaCheia).manda(Serial);
  } else if (c->tipo == AQ_TRAMAS && p.n >= sizeof(AqCabecalho) + 1) {
    const AqPacoteTramas *t = (const AqPacoteTramas *)p.dados;
    const size_t cabem = (p.n - sizeof(AqCabecalho) - 1) / sizeof(AqTrama);
    const size_t quantas = t->quantas < cabem ? t->quantas : cabem;
    radioConta(c);
    for (size_t i = 0; i < quantas && i < AQ_MAX_TRAMAS; i++) {
      const AqTrama &x = t->tramas[i];
      aqMotor(Serial, x.s, x.us, x.id & 0x1FFFFFFFUL, x.dados, x.quantos);
    }
  }
}

inline void radioCorre(uint32_t agoraMs) {
  if (!radioLigado) return;
  if ((int32_t)(agoraMs - radioProximoFarol) >= 0) {
    radioProximoFarol = agoraMs + FAROL_MS;
    AqCabecalho farol;
    aqCabecalho(farol, AQ_FAROL, radioArranque, radioOrdem++);
    esp_now_send(AQ_TODOS, (const uint8_t *)&farol, sizeof(farol));
  }
  RadioPacote p;
  for (int i = 0; i < RADIO_POR_VOLTA && xQueueReceive(radioFila, &p, 0) == pdTRUE; i++) radioTrata(p);
}
