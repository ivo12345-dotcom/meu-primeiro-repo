// O rádio entre as duas caixas: o rádio próprio das placas (ESP-NOW), sem rede Wi-Fi nenhuma.
//
// Não há endereços escritos no código (o repositório é público, e uma placa trocada tem de se
// emparelhar sozinha):
//   - a caixa 1 manda de segundo a segundo um FAROL a todos;
//   - a caixa 2 aprende do farol o endereço da caixa 1 e só manda para ela, com a confirmação e a
//     repetição do próprio rádio: o BATIMENTO de segundo a segundo e as TRAMAS do motor, até 11 por
//     pacote.
// Cada pacote leva um número de ordem (para a caixa 1 contar os que se perderam) e o número do
// arranque de quem o mandou (para um recomeço não parecer uma perda de milhares de pacotes).
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

const uint8_t AQ_CANAL = 1;
const uint8_t AQ_RADIO_VERSAO = 1;
const uint8_t AQ_FAROL = 1;      // da caixa 1, a todos: "estou aqui"
const uint8_t AQ_BATIMENTO = 2;  // da caixa 2: viva, versão, se finge
const uint8_t AQ_TRAMAS = 3;     // da caixa 2: tramas do motor
const uint8_t AQ_MAX_TRAMAS = 11;
const uint8_t AQ_TODOS[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

#pragma pack(push, 1)
struct AqCabecalho {
  char a, q;          // 'A', 'Q'
  uint8_t versao;     // AQ_RADIO_VERSAO
  uint8_t tipo;
  uint16_t arranque;  // tirado à sorte em cada arranque de quem manda
  uint16_t ordem;     // sobe 1 por pacote mandado
};
struct AqPacoteBatimento {
  AqCabecalho c;
  uint32_t ms;        // desde o arranque da caixa 2
  char fw[12];        // a versão do programa, com zeros no fim
  uint8_t sim;        // 1 se a caixa 2 está a fingir
};
struct AqTrama {
  uint32_t id;        // o identificador de 29 bits
  uint8_t quantos;    // bytes de dados (0 a 8)
  uint8_t dados[8];
  uint32_t s, us;     // a hora da caixa 2 quando a leu: segundos e microssegundos desde o arranque
};
struct AqPacoteTramas {
  AqCabecalho c;
  uint8_t quantas;
  AqTrama tramas[AQ_MAX_TRAMAS];
};
#pragma pack(pop)

static_assert(sizeof(AqPacoteTramas) <= 250, "o pacote das tramas não cabe num envio do rádio");

inline void aqCabecalho(AqCabecalho &c, uint8_t tipo, uint16_t arranque, uint16_t ordem) {
  c.a = 'A';
  c.q = 'Q';
  c.versao = AQ_RADIO_VERSAO;
  c.tipo = tipo;
  c.arranque = arranque;
  c.ordem = ordem;
}

inline bool aqCabecalhoBom(const uint8_t *dados, int n) {
  return n >= (int)sizeof(AqCabecalho) && dados[0] == 'A' && dados[1] == 'Q' && dados[2] == AQ_RADIO_VERSAO;
}

// Um número de arranque que mude de vez para vez (nunca 0).
inline uint16_t aqNumeroDoArranque() {
  const uint16_t n = (uint16_t)esp_random();
  return n ? n : 1;
}

// O que aconteceu em quandoMs foi há prazoMs ou menos, contando de agoraMs? As horas são as do relógio
// da placa (millis), que dá a volta de 49,7 em 49,7 dias: a conta faz-se com sinal, para dar certo
// através da volta.
//
// quandoMs pode ser um pouco DEPOIS de agoraMs: quem pergunta tirou a hora no princípio da volta do
// ciclo, e o que aconteceu (um pacote do rádio, que chega noutra tarefa) pode ter chegado a meio dela.
// Feita sem sinal, a conta dava então a volta para 49 dias, e o que tinha acabado de chegar parecia
// perdido há muito. Até AQ_FOLGA_MS depois de agoraMs conta como "agora mesmo"; mais do que isso já não
// é desta volta: é um silêncio de mais de 24 dias, que deu a volta ao relógio.
// (O prazo tem de ser de menos de 24 dias; os que se usam são de segundos.)
const uint32_t AQ_FOLGA_MS = 1000;

inline bool aqRecente(uint32_t agoraMs, uint32_t quandoMs, uint32_t prazoMs) {
  const int32_t ha = (int32_t)(agoraMs - quandoMs);
  return ha >= -(int32_t)AQ_FOLGA_MS && ha <= (int32_t)prazoMs;
}

// Liga o rádio das placas no canal fixo, sem se ligar a rede nenhuma, e regista quem recebe.
inline bool aqRadioLiga(esp_now_recv_cb_t aoReceber) {
  WiFi.persistent(false);
  if (!WiFi.mode(WIFI_STA)) return false;
  esp_wifi_set_ps(WIFI_PS_NONE);  // sempre à escuta
  esp_wifi_set_channel(AQ_CANAL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(aoReceber);
  esp_now_peer_info_t todos = {};
  memcpy(todos.peer_addr, AQ_TODOS, 6);
  todos.channel = 0;  // o canal em que o rádio estiver
  todos.ifidx = WIFI_IF_STA;
  todos.encrypt = false;
  return esp_now_add_peer(&todos) == ESP_OK;
}

// Conta os pacotes que se perderam pelo caminho, pelos saltos no número de ordem.
// Um pacote repetido ou fora de ordem não conta; um salto de mais de 1000 é um recomeço mal apanhado
// e também não conta, para o contador nunca disparar aos milhares.
class AqPerdidos {
public:
  uint32_t total = 0;

  void chegou(uint16_t ordem) {
    if (tem_) {
      const uint16_t salto = (uint16_t)(ordem - ultima_ - 1);
      if (salto > 0 && salto <= 1000) total += salto;
      else if (salto > 1000 && salto < 0xFF00) { /* recomeço mal apanhado: recomeça-se a contar daqui */ }
      else if (salto >= 0xFF00) return;  // repetido ou atrasado: fica a ordem que já se tinha
    }
    tem_ = true;
    ultima_ = ordem;
  }

  void recomecou() { tem_ = false; }

private:
  bool tem_ = false;
  uint16_t ultima_ = 0;
};
