// O rádio do lado da caixa 2: espera pelo farol da caixa 1, aprende-lhe o endereço e manda-lhe o
// batimento de segundo a segundo e as tramas do motor, juntas em pacotes (até 11, ou o que houver ao
// fim de 50 ms). Sem ouvir a caixa 1 há mais de 5 s não manda nada: ninguém estava a ouvir.
#pragma once

#include <Arduino.h>

#include <arlequin_radio.h>
#include <arlequin_versao.h>

const uint32_t RADIO_BATIMENTO_MS = 1000;
const uint32_t RADIO_JUNTA_MS = 50;      // o mais que uma trama espera por companhia
const uint32_t RADIO_SEM_FAROL_MS = 5000;

inline uint32_t radioFalhadas = 0;        // pacotes que o rádio não aceitou ou que ninguém confirmou
inline uint32_t radioDeitadasFora = 0;    // tramas sem ninguém a ouvir
static volatile uint32_t radioSemConfirmar = 0;

static portMUX_TYPE radioTrinco = portMUX_INITIALIZER_UNLOCKED;
static uint8_t radioCaixa1[6] = {0, 0, 0, 0, 0, 0};  // aprendido do farol
static volatile bool radioEnderecoNovo = false;
static volatile uint32_t radioUltimoFarol = 0;
static volatile bool radioOuviuFarol = false;

static bool radioLigado = false, radioTemPar = false;
static uint8_t radioPar[6];
static uint16_t radioArranque = 0, radioOrdem = 0;
static uint32_t radioProximoBatimento = 0;
static AqPacoteTramas radioLote;
static uint32_t radioLoteDesde = 0;

static void radioAoReceber(const esp_now_recv_info_t *de, const uint8_t *dados, int n) {
  if (!de || !de->src_addr || !aqCabecalhoBom(dados, n)) return;
  if (((const AqCabecalho *)dados)->tipo != AQ_FAROL) return;
  portENTER_CRITICAL(&radioTrinco);
  if (memcmp(radioCaixa1, de->src_addr, 6) != 0) {
    memcpy(radioCaixa1, de->src_addr, 6);
    radioEnderecoNovo = true;
  }
  portEXIT_CRITICAL(&radioTrinco);
  radioUltimoFarol = millis();
  radioOuviuFarol = true;
}

static void radioAoMandar(const esp_now_send_info_t *, esp_now_send_status_t estado) {
  if (estado != ESP_NOW_SEND_SUCCESS) radioSemConfirmar = radioSemConfirmar + 1;
}

inline void radioIniciar() {
  radioArranque = aqNumeroDoArranque();
  radioLigado = aqRadioLiga(radioAoReceber);
  if (radioLigado) esp_now_register_send_cb(radioAoMandar);
  radioLote.quantas = 0;
  radioProximoBatimento = millis();
}

// A caixa 1 está a ouvir? (o farol dela chegou há 5 s ou menos)
inline bool radioTemOuvinte(uint32_t agoraMs) {
  return radioLigado && radioOuviuFarol && agoraMs - radioUltimoFarol <= RADIO_SEM_FAROL_MS;
}

static void radioManda(const void *pacote, size_t n) {
  if (esp_now_send(radioPar, (const uint8_t *)pacote, n) != ESP_OK) radioFalhadas++;
}

static void radioDespacha(uint32_t agoraMs) {
  if (radioLote.quantas == 0) return;
  if (radioTemOuvinte(agoraMs) && radioTemPar) {
    aqCabecalho(radioLote.c, AQ_TRAMAS, radioArranque, radioOrdem++);
    radioManda(&radioLote, sizeof(AqCabecalho) + 1 + radioLote.quantas * sizeof(AqTrama));
  } else {
    radioDeitadasFora += radioLote.quantas;
  }
  radioLote.quantas = 0;
}

// Junta uma trama ao pacote que está a encher.
inline void radioJunta(const AqTrama &t, uint32_t agoraMs) {
  if (radioLote.quantas == 0) radioLoteDesde = agoraMs;
  radioLote.tramas[radioLote.quantas++] = t;
  if (radioLote.quantas >= AQ_MAX_TRAMAS) radioDespacha(agoraMs);
}

// Manda o batimento agora, se a caixa 1 estiver a ouvir. Sai de segundo a segundo (radioCorre) e também
// no instante em que a caixa passa a fingir, antes das primeiras tramas a fingir: o batimento certo
// podia vir até um segundo depois delas, e nesse intervalo o portátil tomava-as por medições.
inline void radioBatimento(uint32_t agoraMs, bool aFingir) {
  if (!radioLigado || !radioTemOuvinte(agoraMs) || !radioTemPar) return;
  AqPacoteBatimento b;
  aqCabecalho(b.c, AQ_BATIMENTO, radioArranque, radioOrdem++);
  b.ms = agoraMs;
  memset(b.fw, 0, sizeof(b.fw));
  strncpy(b.fw, AQ_VERSAO, sizeof(b.fw));
  b.sim = aFingir ? 1 : 0;
  radioManda(&b, sizeof(b));
}

inline void radioCorre(uint32_t agoraMs, bool aFingir) {
  if (!radioLigado) return;
  // um endereço novo (o primeiro farol, ou a caixa 1 foi trocada): passa a ser esse o destino
  if (radioEnderecoNovo) {
    uint8_t novo[6];
    portENTER_CRITICAL(&radioTrinco);
    memcpy(novo, radioCaixa1, 6);
    radioEnderecoNovo = false;
    portEXIT_CRITICAL(&radioTrinco);
    if (radioTemPar) esp_now_del_peer(radioPar);
    esp_now_peer_info_t par = {};
    memcpy(par.peer_addr, novo, 6);
    par.channel = 0;
    par.ifidx = WIFI_IF_STA;
    par.encrypt = false;
    radioTemPar = esp_now_add_peer(&par) == ESP_OK;
    memcpy(radioPar, novo, 6);
  }
  if (radioLote.quantas > 0 && agoraMs - radioLoteDesde >= RADIO_JUNTA_MS) radioDespacha(agoraMs);
  if ((int32_t)(agoraMs - radioProximoBatimento) >= 0) {
    radioProximoBatimento = agoraMs + RADIO_BATIMENTO_MS;
    radioBatimento(agoraMs, aFingir);
  }
}
