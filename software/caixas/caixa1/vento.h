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
#include <hal/gpio_ll.h>
#include <soc/gpio_sig_map.h>

#include <arlequin_linhas.h>

#include "pinos.h"

const uint32_t VENTO_BAUD = 4800;
const size_t VENTO_MAX = 82;  // o tamanho máximo de uma frase NMEA 0183
// As mudanças de nível do pino atendidas em cada volta do ciclo principal, no máximo. A 4 800 baud a
// frase dá menos de 5 por milésimo de segundo; acima disto é uma avalanche (o fio no ar a apanhar ruído)
// e a interrupção do pino desliga-se até à volta seguinte, para a caixa nunca parar por causa dela.
// (Revisão final de 23/11/2026: com 1 MHz neste pino a caixa deixava de responder.)
const uint32_t VENTO_RAJADA = 16;

// As últimas letras que entraram pelo pino do vento, tal e qual chegaram, boas ou más. É o que o comando
// "cru" mostra, para se ver de fora o que o mostrador manda quando a caixa não lhe acha frases: uma frase
// que não é o MWV (ignora-se sem contar), o MWV sem a soma no fim, ou a velocidade e o sentido trocados.
// São 80 porque é o que cabe, em hexadecimal, numa linha de 200.
const size_t VENTO_CRU = 80;
static uint8_t ventoCru[VENTO_CRU];
static size_t ventoCruOnde = 0, ventoCruQuantas = 0;  // onde entra a próxima letra, e quantas lá estão

inline uint32_t ventoInvalidas = 0;
inline uint32_t ventoBytes = 0;      // tudo o que entrou pelo pino do vento, bom ou mau
inline uint32_t ventoFrases = 0;     // frases MWV boas, mandadas ao portátil
inline uint32_t ventoAvalanches = 0;  // voltas do ciclo em que as mudanças de nível passaram do limite
static volatile uint32_t ventoMexidas = 0;  // vezes que o pino do vento mudou de nível: há sinal no fio?
static volatile uint32_t ventoNaVolta = 0;  // as desta volta do ciclo
static volatile bool ventoCalado = false;   // a interrupção do pino está desligada até à volta seguinte

static void IRAM_ATTR ventoMexeu(void *) {
  ventoMexidas = ventoMexidas + 1;
  ventoNaVolta = ventoNaVolta + 1;
  if (ventoNaVolta >= VENTO_RAJADA) {
    gpio_ll_intr_disable(&GPIO, PINO_VENTO);
    ventoCalado = true;
  }
}
static char ventoFrase[VENTO_MAX + 2];
static size_t ventoN = 0;
static bool ventoADeitarFora = true;  // até ao primeiro fim de linha não se sabe se se apanhou o princípio

// O valor de uma letra hexadecimal (0 a 15), ou -1.
static int ventoHex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

// "$" + duas letras + "MWV," ... "*HH", com HH o ou-exclusivo do que está entre o $ e o *.
// A soma lê-se pelas duas letras e mais nada: a seguir a elas, na memória, pode estar o resto de uma
// frase anterior mais comprida. (Visto na placa a 23/11: depois de "14.0" uma frase com "5.0" era
// deitada fora, porque a soma "09" se lia agarrada ao "E" que sobrava do "3E" da anterior.)
static bool ventoBoa(const char *f, size_t n) {
  if (n < 12 || f[0] != '$' || !isupper((unsigned char)f[1]) || !isupper((unsigned char)f[2])) return false;
  if (strncmp(f + 3, "MWV,", 4) != 0 || f[n - 3] != '*') return false;
  const int alto = ventoHex(f[n - 2]), baixo = ventoHex(f[n - 1]);
  if (alto < 0 || baixo < 0) return false;
  return aqSoma(f + 1, n - 4) == (uint8_t)(alto * 16 + baixo);
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

// O texto do comando "cru": o total de letras entradas desde o arranque (o contador vento-bytes) e as
// últimas, até VENTO_CRU, em hexadecimal e pela ordem de chegada. Com o total, quem pergunta várias vezes
// seguidas sabe quantas letras são novas e junta-as sem repetir nem saltar (ensaio/cru.js).
const size_t VENTO_CRU_TEXTO = sizeof("total=") - 1 + 10 + sizeof(";hex=") - 1 + 2 * VENTO_CRU;
// a linha inteira é "$AQR," + "cru" + "," + o texto + "*HH"
static_assert(5 + 3 + 1 + VENTO_CRU_TEXTO + 3 <= AQ_MAX_LINHA, "cru: o texto não cabe numa linha");

inline void ventoCruTexto(char *texto, size_t espaco) {
  static const char LETRAS[] = "0123456789ABCDEF";
  size_t n = (size_t)snprintf(texto, espaco, "total=%lu;hex=", (unsigned long)ventoBytes);
  const size_t primeira = (ventoCruOnde + VENTO_CRU - ventoCruQuantas) % VENTO_CRU;
  for (size_t i = 0; i < ventoCruQuantas && n + 2 < espaco; i++) {
    const uint8_t b = ventoCru[(primeira + i) % VENTO_CRU];
    texto[n++] = LETRAS[b >> 4];
    texto[n++] = LETRAS[b & 15];
  }
  texto[n] = 0;
}

// Chama-se em todas as voltas do ciclo principal.
inline void ventoCorre() {
  ventoNaVolta = 0;
  if (ventoCalado) {
    ventoCalado = false;
    ventoAvalanches++;
    gpio_intr_enable((gpio_num_t)PINO_VENTO);  // limpa o que ficou pendente e volta a ouvir o pino
  }
  while (Serial2.available() > 0) {
    const int c = Serial2.read();
    ventoCru[ventoCruOnde] = (uint8_t)c;
    ventoCruOnde = (ventoCruOnde + 1) % VENTO_CRU;
    if (ventoCruQuantas < VENTO_CRU) ventoCruQuantas++;
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
