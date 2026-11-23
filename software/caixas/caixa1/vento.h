// O vento: lê a frase do mostrador NASA Clipper Wind (NMEA 0183, a 4 800 baud) e manda-a ao portátil
// tal e qual chegou. Não faz contas: o ângulo e a velocidade são lidos no portátil.
//
// Só passa uma frase MWV inteira e com a soma certa. Com o mostrador desligado ou o fio no ar entra
// lixo: tudo o que não for isso deita-se fora e conta-se (ventoInvalidas). As outras frases que o
// mostrador mande ignoram-se sem contar.
#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_rom_gpio.h>
#include <soc/gpio_sig_map.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint32_t VENTO_BAUD = 4800;
const size_t VENTO_MAX = 82;  // o tamanho máximo de uma frase NMEA 0183

inline uint32_t ventoInvalidas = 0;
inline uint32_t ventoBytes = 0;      // tudo o que entrou pelo pino do vento, bom ou mau
inline uint32_t ventoFrases = 0;     // frases MWV boas, mandadas ao portátil
static volatile uint32_t ventoMexidas = 0;  // vezes que o pino do vento mudou de nível: há sinal no fio?

static void IRAM_ATTR ventoMexeu(void *) { ventoMexidas = ventoMexidas + 1; }
static char ventoFrase[VENTO_MAX + 2];
static size_t ventoN = 0;
static bool ventoADeitarFora = true;  // até ao primeiro fim de linha não se sabe se se apanhou o princípio

// "$" + duas letras + "MWV," ... "*HH", com HH o ou-exclusivo do que está entre o $ e o *.
static bool ventoBoa(const char *f, size_t n) {
  if (n < 12 || f[0] != '$' || !isupper((unsigned char)f[1]) || !isupper((unsigned char)f[2])) return false;
  if (strncmp(f + 3, "MWV,", 4) != 0 || f[n - 3] != '*') return false;
  if (!isxdigit((unsigned char)f[n - 2]) || !isxdigit((unsigned char)f[n - 1])) return false;
  return aqSoma(f + 1, n - 4) == (uint8_t)strtoul(f + n - 2, nullptr, 16);
}

// A frase é de vento (MWV) mas não vale: soma errada ou cortada.
static bool ventoEraMwv(const char *f, size_t n) { return n >= 6 && f[0] == '$' && strncmp(f + 3, "MWV", 3) == 0; }

inline void ventoIniciar() {
  Serial2.setRxBufferSize(512);
  Serial2.begin(VENTO_BAUD, SERIAL_8N1, PINO_VENTO, -1);  // só se ouve: não há pino de escrita
  // Neste pino (o RX2 da placa) a biblioteca liga a porta série pelo caminho direto do pino, que deixa
  // de valer mal o pino passe também a saída (é o que o gerador de bancada faz): a leitura morria até
  // ao recomeço seguinte. Liga-se por isso pela matriz de pinos do chip, que serve nos dois casos.
  // (Visto na placa a 23/11: o pino mexia e a porta série não recebia um byte.)
  esp_rom_gpio_pad_select_gpio(PINO_VENTO);
  gpio_set_direction((gpio_num_t)PINO_VENTO, GPIO_MODE_INPUT);
  gpio_set_pull_mode((gpio_num_t)PINO_VENTO, GPIO_PULLUP_ONLY);  // sem fio, o pino fica em repouso (em cima)
  esp_rom_gpio_connect_in_signal(PINO_VENTO, U2RXD_IN_IDX, false);
  // conta as mudanças de nível do pino, à parte da porta série: diz se há sinal, mesmo que não se perceba
  gpio_set_intr_type((gpio_num_t)PINO_VENTO, GPIO_INTR_ANYEDGE);
  gpio_isr_handler_add((gpio_num_t)PINO_VENTO, ventoMexeu, nullptr);
}

inline void ventoCorre() {
  while (Serial2.available() > 0) {
    const int c = Serial2.read();
    ventoBytes++;
    if (c == '\n' || c == '\r') {
      if (!ventoADeitarFora && ventoN > 0) {
        if (ventoBoa(ventoFrase, ventoN)) {
          ventoFrase[ventoN] = '\n';
          aqEscreve(Serial, ventoFrase, ventoN + 1);
          ventoFrases++;
        } else if (ventoEraMwv(ventoFrase, ventoN)) {
          ventoInvalidas++;
        }
      }
      ventoN = 0;
      ventoADeitarFora = false;
    } else if (ventoADeitarFora) {
      // a meio de uma linha que já não serve: espera-se pelo fim dela
    } else if (c < 0x20 || c > 0x7E || ventoN >= VENTO_MAX) {
      ventoInvalidas++;
      ventoN = 0;
      ventoADeitarFora = true;
    } else {
      ventoFrase[ventoN++] = (char)c;
    }
  }
}
