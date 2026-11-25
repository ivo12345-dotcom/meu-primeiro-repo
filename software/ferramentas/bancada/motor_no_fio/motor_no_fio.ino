// ARLEQUIN · bancada: um motor a fingir NUM FIO, para ensaiar em casa a escuta da caixa 2.
//
// Porquê: o motor a fingir da caixa 2 (comando "motor,<rpm>") nasce dentro dela e não passa pelo
// módulo do barramento nem pelo pino D4. Este programa põe outra placa a escrever tramas verdadeiras
// num par de fios de bancada, e a caixa 2 ouve-as pelo caminho que vai usar no barco:
//   fios -> módulo A (sem a resistência R2) -> D4 -> controlador do chip -> rádio.
//
// Onde corre: numa placa ELEGOO "ESP32 DEVKIT V1 TYPEC" de bancada (a da caixa 1, emprestada; no fim
// volta a levar o programa dela: npm run gravar:1 -- COMx, em software/caixas).
// NUNCA se liga à linha do motor do barco: este programa ESCREVE na linha.
//
// Ligações (módulo B, o que fica com a resistência R2 de 120 ohm):
//   3V3 -> 3V3     GND -> GND     CTX -> TX2 (D17)     CRX -> RX2 (D16)
//   CANH do B -> CANH do A        CANL do B -> CANL do A
// As duas placas ficam no USB do portátil (a massa é comum por aí).
//
// A caixa 2 só escuta e por isso não confirma as tramas. O controlador pede-se no modo que não
// espera confirmação (TWAI_MODE_NO_ACK): cada trama sai uma vez só.
//
// Comandos pela porta USB (460 800 baud, a velocidade das caixas, para o ensaio/placa.js a abrir; uma letra):
//   a  arranca: as tramas do gerador da caixa 2 (2100 rpm 10 vezes por segundo; água 82 °C, 14,2 V,
//      horas e ignição 1 vez por segundo)
//   n  manda exatamente 1000 tramas de rotações, uma de 5 em 5 ms, e para (ensaio de contagem)
//   r  o mesmo, mas uma de 1 em 1 ms (ensaio com a linha carregada)
//   p  para
//   e  estado
// De segundo a segundo, enquanto manda:  fio postas=<n> falhadas=<n> por-sair=<n> erros=<n> estado=<s>
// No fim de uma rajada:                   fim postas=<n> falhadas=<n> erros=<n> estado=<s>
#include <Arduino.h>
#include <driver/twai.h>

const int PINO_ESCREVE = 17;  // TX2: vai ao CTX do módulo B
const int PINO_LE = 16;       // RX2: vem do CRX do módulo B
const int PINO_LUZ = 2;
const long RPM = 2100;
const uint32_t RAJADA = 1000;

static bool ligado = false;      // o controlador arrancou
static bool continuo = false;    // cadência normal
static uint32_t rajadaFalta = 0, rajadaPasso = 5;
static uint32_t postas = 0;      // tramas entregues ao controlador desde o último arranque ou rajada
static uint32_t recusadas = 0;   // tramas que o controlador não aceitou (fila cheia ou parado)
static uint32_t proximaRotacao = 0, proximoResto = 0, proximaRajada = 0, proximoRelato = 0;

static uint32_t idJ1939(uint8_t prioridade, uint32_t pgn) { return ((uint32_t)(prioridade & 7) << 26) | (pgn << 8); }

static const char *nomeEstado(twai_state_t e) {
  switch (e) {
    case TWAI_STATE_STOPPED: return "parado";
    case TWAI_STATE_RUNNING: return "a-andar";
    case TWAI_STATE_BUS_OFF: return "fora-da-linha";
    case TWAI_STATE_RECOVERING: return "a-recuperar";
    default: return "?";
  }
}

static bool iniciar() {
  twai_general_config_t geral = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)PINO_ESCREVE, (gpio_num_t)PINO_LE, TWAI_MODE_NO_ACK);
  geral.tx_queue_len = 32;
  const twai_timing_config_t tempos = TWAI_TIMING_CONFIG_250KBITS();
  const twai_filter_config_t filtro = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  ligado = twai_driver_install(&geral, &tempos, &filtro) == ESP_OK && twai_start() == ESP_OK;
  return ligado;
}

static void manda(uint32_t id, const uint8_t dados[8]) {
  twai_message_t m = {};
  m.extd = 1;
  m.identifier = id;
  m.data_length_code = 8;
  memcpy(m.data, dados, 8);
  if (ligado && twai_transmit(&m, 0) == ESP_OK) postas++;
  else recusadas++;
}

static void rotacoes() {
  const uint16_t v = (uint16_t)(RPM * 8);  // 0,125 rotações por minuto por unidade
  const uint8_t d[8] = {0xFF, 0xFF, 0xFF, (uint8_t)(v & 0xFF), (uint8_t)(v >> 8), 0xFF, 0xFF, 0xFF};
  manda(idJ1939(3, 61444), d);
}

static void resto(uint32_t agora) {
  const uint8_t agua[8] = {82 + 40, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  manda(idJ1939(6, 65262), agua);
  const uint16_t volt = 284;  // 14,2 V a 0,05 V por unidade
  const uint8_t tensao[8] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, (uint8_t)(volt & 0xFF), (uint8_t)(volt >> 8)};
  manda(idJ1939(6, 65271), tensao);
  const uint32_t h = 24870UL + agora / 180000UL;  // 1243,5 h a 0,05 h por unidade
  const uint8_t horas[8] = {(uint8_t)h, (uint8_t)(h >> 8), (uint8_t)(h >> 16), (uint8_t)(h >> 24), 0xFF, 0xFF, 0xFF, 0xFF};
  manda(idJ1939(6, 65253), horas);
  const uint8_t ignicao[8] = {0x00, 0, 0, 0, 0, 0, 0, 0};
  manda(idJ1939(6, 65417), ignicao);
}

static void relato(const char *titulo) {
  twai_status_info_t s = {};
  if (ligado) twai_get_status_info(&s);
  Serial.printf("%s postas=%lu recusadas=%lu falhadas=%lu por-sair=%lu erros=%lu estado=%s\r\n", titulo, (unsigned long)postas,
                (unsigned long)recusadas, (unsigned long)s.tx_failed_count, (unsigned long)s.msgs_to_tx, (unsigned long)s.bus_error_count,
                ligado ? nomeEstado(s.state) : "sem-controlador");
}

// Saiu da linha por erros (fios soltos, módulo sem corrente): volta a entrar sozinho.
static void recupera() {
  if (!ligado) return;
  twai_status_info_t s = {};
  twai_get_status_info(&s);
  if (s.state == TWAI_STATE_BUS_OFF) twai_initiate_recovery();
  else if (s.state == TWAI_STATE_STOPPED) twai_start();
}

static void zera(uint32_t agora) {
  postas = recusadas = 0;
  proximaRotacao = proximoResto = proximaRajada = agora;
  proximoRelato = agora + 1000;
  // os contadores do controlador só voltam a zero reinstalando-o
  if (ligado) {
    twai_stop();
    twai_driver_uninstall();
  }
  iniciar();
}

void setup() {
  Serial.begin(460800);
  pinMode(PINO_LUZ, OUTPUT);
  iniciar();
  Serial.printf("\r\nmotor-no-fio pronto controlador=%s (a arranca, n rajada de 1000, r rajada rapida, p para, e estado)\r\n", ligado ? "ok" : "FALHOU");
}

void loop() {
  const uint32_t agora = millis();

  while (Serial.available() > 0) {
    const int c = Serial.read();
    if (c == 'a') {
      zera(agora);
      continuo = true;
      rajadaFalta = 0;
      Serial.print("ok arranca\r\n");
    } else if (c == 'n' || c == 'r') {
      zera(agora);
      continuo = false;
      rajadaFalta = RAJADA;
      rajadaPasso = c == 'n' ? 5 : 1;
      Serial.printf("ok rajada passo=%lu\r\n", (unsigned long)rajadaPasso);
    } else if (c == 'p') {
      continuo = false;
      rajadaFalta = 0;
      delay(50);  // deixa sair as que estiverem na fila, para a conta bater com a de quem ouve
      relato("parado");
    } else if (c == 'e') {
      relato("estado");
    }
  }

  if (continuo) {
    if ((int32_t)(agora - proximaRotacao) >= 0) {
      proximaRotacao += 100;
      rotacoes();
    }
    if ((int32_t)(agora - proximoResto) >= 0) {
      proximoResto += 1000;
      resto(agora);
    }
  }

  if (rajadaFalta > 0 && (int32_t)(agora - proximaRajada) >= 0) {
    proximaRajada += rajadaPasso;
    rotacoes();
    if (--rajadaFalta == 0) {
      delay(100);  // deixa sair as que estiverem na fila
      relato("fim");
    }
  }

  if ((continuo || rajadaFalta > 0) && (int32_t)(agora - proximoRelato) >= 0) {
    proximoRelato += 1000;
    relato("fio");
    recupera();
  }

  digitalWrite(PINO_LUZ, (continuo || rajadaFalta > 0) ? HIGH : LOW);
  delay(1);
}
