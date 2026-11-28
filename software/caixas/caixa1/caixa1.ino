// ARLEQUIN · caixa 1 (instrumentos): roda do log, vento, sensor de movimento e o que a caixa 2 lhe
// passa pelo rádio, tudo mandado ao portátil por USB em linhas de texto.
//
// Desenho: docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md
// Plano:   docs/superpowers/plans/2026-11-23-sistema-no-portatil-parte2-caixas.md
//
// Regras que mandam aqui:
//   - a caixa só lê e manda os valores em bruto: nenhuma conta nem calibração;
//   - um ciclo principal só, que nunca espera por nada mais de 50 ms, e é só ele que escreve na porta;
//   - o batimento sai de segundo a segundo desde o arranque, aconteça o que acontecer ao resto;
//   - se o ciclo ficar preso, o cão de guarda reinicia a placa ao fim de 5 s.
//
// Compilar, gravar e ensaiar: ver software/caixas/README.md (npm run gravar:1 -- COM3).
#include <Arduino.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include <arlequin_linhas.h>
#include <arlequin_versao.h>

#include "ensaio.h"
#include "log.h"
#include "movimento.h"
#include "pinos.h"
#include "radio1.h"
#include "sensor.h"
#include "vento.h"

const uint32_t CAO_DE_GUARDA_MS = 5000;
const uint32_t BATIMENTO_MS = 1000;

// O estado do sensor como vai no batimento: 0 a medir, 1 a arrancar, 2 calado e a tentar o RST,
// 3 não volta, 4 a fingir.
static bool movimentoAFingir() { return (ensaioLigados & ENSAIO_MOVIMENTO) != 0; }
static uint8_t estadoDoSensor() { return movimentoAFingir() ? 4 : sensorEstado(); }
static uint32_t toquesNoRst() { return sensorRsts(); }

static uint8_t motivoDoArranque = 0;
static uint32_t proximoBatimento = 0;
static AqOrdens ordens;

// Os contadores da caixa, para o comando "estado". O espaço do texto sai deste formato (AQ_TEXTO): com
// os números todos no máximo não se corta, e o compilador recusa um formato que não caiba numa linha.
#define ESTADO_FORMATO "vento-mexidas=%lu;vento-bytes=%lu;vento-frases=%lu;vento-invalidas=%lu;avalanches=%lu;log-recusados=%lu;perdidas=%lu;cortadas=%lu"

static void batimento(uint32_t agora) {
  AqLinha("B")
    .i(1)
    .u(agora)
    .t(AQ_VERSAO)
    .i(ensaioAlgum() ? 1 : 0)
    .i(0)                              // força do rádio: a caixa 1 manda 0
    .u(aqPerdidas + aqCortadas)        // linhas que esta caixa não conseguiu mandar
    .i(estadoDoSensor())
    .i(motivoDoArranque)
    .u(toquesNoRst())
    .manda(Serial);
}

static void responde(const char *comando, const char *resultado) {
  AqLinha("R").t(comando).t(resultado).manda(Serial);
}

// Os comandos $AQC que chegam do portátil (ver o plano: "O que muda no contrato das linhas"). Devolve
// true se a linha era um comando com a soma certa: a esses responde sempre.
static bool obedece(const char *linha) {
  char nome[16];
  long v[4] = {0, 0, 0, 0};
  int quantos = 0;
  if (!aqComando(linha, nome, sizeof(nome), v, &quantos)) return false;  // sem soma certa não faz nada

  if (strcmp(nome, "parar") == 0 && quantos == 0) {
    ensaioParar();
    responde(nome, "ok");
  } else if (strcmp(nome, "log") == 0 && quantos == 1) {
    responde(nome, ensaioLog(v[0]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "roda") == 0 && (quantos == 1 || quantos == 2)) {
    // a roda por fora: o pino D26 faz de roda (ensaio.h). Ao parar, a resposta são as voltas que deu
    uint32_t voltas = 0;
    if (!ensaioRoda(v[0], quantos == 2 ? v[1] : 15, &voltas)) {
      responde(nome, "fora-dos-limites");
    } else if (v[0] != 0) {
      responde(nome, "ok");
    } else {
      AQ_TEXTO(texto, "roda", "%lu");
      snprintf(texto, sizeof(texto), "%lu", (unsigned long)voltas);
      responde(nome, texto);
    }
  } else if (strcmp(nome, "movimento") == 0 && quantos == 1) {
    responde(nome, ensaioMovimento(v[0]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "vento") == 0 && quantos >= 2 && quantos <= 4) {
    // o terceiro valor junta uma segunda frase; o quarto manda a frase por fora, pelo pino TX2
    responde(nome, ensaioVento(v[0], v[1], quantos >= 3 && v[2] != 0, quantos == 4 && v[3] != 0) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "avalanche") == 0 && quantos == 2) {
    responde(nome, ensaioAvalanche(v[0], v[1]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "estado") == 0 && quantos == 0) {
    // os contadores da caixa, para se ver de fora o que entra em cada entrada. Cabem sempre: com os 8
    // números no máximo (10 algarismos cada) o texto tem 185 letras e a linha 200, que é o limite.
    AQ_TEXTO(texto, "estado", ESTADO_FORMATO);
    snprintf(texto, sizeof(texto), ESTADO_FORMATO,
             (unsigned long)ventoMexidas, (unsigned long)ventoBytes, (unsigned long)ventoFrases, (unsigned long)ventoInvalidas,
             (unsigned long)ventoAvalanches, (unsigned long)logRecusados, (unsigned long)aqPerdidas, (unsigned long)aqCortadas);
    responde(nome, texto);
  } else if (strcmp(nome, "cru") == 0 && quantos == 0) {
    // as últimas letras que entraram pelo pino do vento, tal e qual (vento.h): para se ver de fora o que o
    // mostrador manda quando a caixa não lhe acha frases. Só lê: não mexe em pino nenhum.
    char texto[VENTO_CRU_TEXTO + 1];
    ventoCruTexto(texto, sizeof(texto));
    responde(nome, texto);
  } else if (strcmp(nome, "rst") == 0 && quantos == 0) {
    sensorToca();  // um toque no RST do sensor: tem de voltar a medir sozinho
    responde(nome, "ok");
  } else if (strcmp(nome, "guardar") == 0 && quantos == 0) {
    responde(nome, sensorGuarda() ? "ok" : "sem-sensor");
  } else if (strcmp(nome, "sensor") == 0 && quantos == 0) {
    AQ_TEXTO(texto, "sensor", SENSOR_FORMATO);
    sensorContadores(texto, sizeof(texto));
    responde(nome, texto);
  } else if (strcmp(nome, "leituras") == 0 && quantos == 0) {
    AQ_TEXTO(texto, "leituras", SENSOR_LEITURAS_FORMATO);
    sensorLeituras(texto, sizeof(texto));
    responde(nome, texto);
  } else if (strcmp(nome, "perdidos") == 0 && quantos >= 1) {
    // a conta dos pacotes perdidos no rádio, posta à prova com números de ordem dados à mão (ensaio.h)
    uint32_t total = 0;
    if (ensaioPerdidos(v, quantos, &total)) {
      AQ_TEXTO(texto, "perdidos", "%lu");
      snprintf(texto, sizeof(texto), "%lu", (unsigned long)total);
      responde(nome, texto);
    } else {
      responde(nome, "fora-dos-limites");
    }
  } else if (strcmp(nome, "recente") == 0 && quantos == 3) {
    // a conta "há quanto tempo chegou o sinal da outra caixa" (arlequin_radio.h), com horas dadas à mão
    if (v[2] < 0 || v[2] > 60000) responde(nome, "fora-dos-limites");
    else responde(nome, aqRecente((uint32_t)v[0], (uint32_t)v[1], (uint32_t)v[2]) ? "1" : "0");
  } else if (strcmp(nome, "avaria") == 0 && (quantos == 1 || quantos == 2)) {
    // avarias feitas de propósito, para ensaiar que a caixa dá por elas e as resolve sozinha: 1 o rádio vai
    // abaixo; 3 o sensor fica mudo os segundos pedidos; 4 o sensor deixa de mandar uma das três leituras
    bool feito = false;
    if (v[0] == 1 && quantos == 1) {
      radioAvaria();
      feito = true;
    } else if (v[0] == 3 && quantos == 2) {
      feito = sensorAvariaMudo(v[1]);
    } else if (v[0] == 4 && quantos == 2) {
      feito = sensorAvariaCala(v[1]);
    }
    responde(nome, feito ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "radio") == 0 && quantos == 0) {
    AQ_TEXTO(texto, "radio", RADIO_FORMATO);
    radioEstado(texto, sizeof(texto));
    responde(nome, texto);
  } else if (strcmp(nome, "surto") == 0 && quantos == 4) {
    // linhas com um número certo de bytes, para pôr à prova a ponte USB (ensaio.h)
    responde(nome, ensaioSurto(v[0], v[1], v[2], v[3]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "prender") == 0 && quantos == 0) {
    responde(nome, "ok");
    Serial.flush();
    while (true) {
      // preso de propósito, sem dar sinal ao cão de guarda: é ele que tem de reiniciar a placa
    }
  } else {
    responde(nome, "desconhecido");
  }
  return true;
}

void setup() {
  motivoDoArranque = (uint8_t)esp_reset_reason();

  // O cão de guarda do ciclo principal: 5 s sem dar a volta e a placa recomeça. Arma-se antes de tudo,
  // para também valer se alguma coisa ficar presa a arrancar.
  const esp_task_wdt_config_t cao = {.timeout_ms = CAO_DE_GUARDA_MS, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&cao);
  enableLoopWDT();

  // Um recomeço da placa não apaga o que os pinos tinham: as interrupções das duas entradas ficam ligadas
  // como estavam. Desligam-se aqui, antes de haver quem as atenda; cada entrada volta a ligar a sua mais
  // abaixo, já com quem a atenda. (Visto na placa a 23/11/2026: com um sinal muito rápido na entrada do
  // vento, a placa recomeçava e ficava presa a arrancar, calada, até lhe cortarem a corrente.)
  gpio_intr_disable((gpio_num_t)PINO_LOG);
  gpio_intr_disable((gpio_num_t)PINO_VENTO);
  // E o pino que faz de roda nos ensaios (ensaio.h) fica solto: um recomeço a meio de um ensaio da roda
  // podia deixá-lo em cima.
  pinMode(PINO_RODA_POR_FORA, INPUT);

  Serial.setTxBufferSize(8192);
  Serial.begin(AQ_BAUD);
  pinMode(PINO_LUZ, OUTPUT);
  logIniciar();  // antes do vento: é o log que monta o serviço das interrupções dos pinos
  ventoIniciar();
  movIniciar();
  sensorIniciar();
  radioIniciar();

  proximoBatimento = millis();
}

void loop() {
  const uint32_t agora = millis();

  // as ordens do portátil, com conta e medida (AqOrdens, em arlequin_linhas.h)
  ordens.corre(Serial, agora, [agora](const char *linha) {
    const bool fingia = ensaioAlgum();
    const bool respondeu = obedece(linha);
    // Passou a fingir: di-lo já, antes de sair a primeira linha a fingir (o batimento certo podia vir até
    // um segundo depois, e nesse intervalo o portátil tomava-as por medições).
    if (!fingia && ensaioAlgum()) batimento(agora);
    return respondeu;
  });

  if ((int32_t)(agora - proximoBatimento) >= 0) {
    batimento(agora);
    proximoBatimento += BATIMENTO_MS;
    if ((int32_t)(agora - proximoBatimento) >= 0) proximoBatimento = agora + BATIMENTO_MS;  // ficou para trás: acerta
  }

  logCorre(agora);
  ventoCorre();
  ensaioCorre(agora);
  sensorCorre(agora, movimentoAFingir());
  movCorre(agora);
  radioCorre(agora);

  // A luz: acesa com tudo a sair; apagada um instante de cada vez que se deita uma linha fora.
  static uint32_t deitadasFora = 0, apagadaAte = 0;
  if (aqPerdidas + aqCortadas != deitadasFora) {
    deitadasFora = aqPerdidas + aqCortadas;
    apagadaAte = agora + 200;
  }
  digitalWrite(PINO_LUZ, (int32_t)(agora - apagadaAte) >= 0 ? HIGH : LOW);

  delay(1);
}
