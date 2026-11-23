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
#include "vento.h"

const uint32_t BAUD = 460800;
const uint32_t CAO_DE_GUARDA_MS = 5000;
const uint32_t BATIMENTO_MS = 1000;

// O estado do sensor como vai no batimento: 0 a medir, 1 a arrancar, 2 calado e a tentar o RST,
// 3 não volta, 4 a fingir. Enquanto não houver sensor.h, não há leituras: 3.
static uint8_t estadoDoSensor() { return (ensaioLigados & ENSAIO_MOVIMENTO) ? 4 : 3; }
static uint32_t toquesNoRst() { return 0; }

static uint8_t motivoDoArranque = 0;
static uint32_t proximoBatimento = 0;
static AqEntrada entrada;

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

// Os comandos $AQC que chegam do portátil (ver o plano: "O que muda no contrato das linhas").
static void obedece(const char *linha) {
  char nome[16];
  long v[4] = {0, 0, 0, 0};
  int quantos = 0;
  if (!aqComando(linha, nome, sizeof(nome), v, &quantos)) return;  // sem soma certa não faz nada

  if (strcmp(nome, "parar") == 0 && quantos == 0) {
    ensaioParar();
    responde(nome, "ok");
  } else if (strcmp(nome, "log") == 0 && quantos == 1) {
    responde(nome, ensaioLog(v[0]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "movimento") == 0 && quantos == 1) {
    responde(nome, ensaioMovimento(v[0]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "vento") == 0 && (quantos == 2 || quantos == 3)) {
    responde(nome, ensaioVento(v[0], v[1], quantos == 3 && v[2] != 0) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "estado") == 0 && quantos == 0) {
    // os contadores da caixa, para se ver de fora o que entra em cada entrada
    char texto[128];
    snprintf(texto, sizeof(texto), "vento-mexidas=%lu;vento-bytes=%lu;vento-frases=%lu;vento-invalidas=%lu;perdidas=%lu;cortadas=%lu",
             (unsigned long)ventoMexidas, (unsigned long)ventoBytes, (unsigned long)ventoFrases, (unsigned long)ventoInvalidas, (unsigned long)aqPerdidas,
             (unsigned long)aqCortadas);
    responde(nome, texto);
  } else if (strcmp(nome, "prender") == 0 && quantos == 0) {
    responde(nome, "ok");
    Serial.flush();
    while (true) {
      // preso de propósito, sem dar sinal ao cão de guarda: é ele que tem de reiniciar a placa
    }
  } else {
    responde(nome, "desconhecido");
  }
}

void setup() {
  motivoDoArranque = (uint8_t)esp_reset_reason();
  Serial.setTxBufferSize(8192);
  Serial.begin(BAUD);
  pinMode(PINO_LUZ, OUTPUT);
  logIniciar();  // antes do vento: é o log que monta o serviço das interrupções dos pinos
  ventoIniciar();
  movIniciar();

  // O cão de guarda do ciclo principal: 5 s sem dar a volta e a placa recomeça.
  const esp_task_wdt_config_t cao = {.timeout_ms = CAO_DE_GUARDA_MS, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&cao);
  enableLoopWDT();

  proximoBatimento = millis();
}

void loop() {
  const uint32_t agora = millis();

  while (Serial.available() > 0) {
    if (entrada.junta(Serial.read())) obedece(entrada.texto());
  }

  if ((int32_t)(agora - proximoBatimento) >= 0) {
    batimento(agora);
    proximoBatimento += BATIMENTO_MS;
    if ((int32_t)(agora - proximoBatimento) >= 0) proximoBatimento = agora + BATIMENTO_MS;  // ficou para trás: acerta
  }

  logCorre(agora);
  ventoCorre();
  ensaioCorre(agora);
  movCorre(agora);

  // A luz: acesa com tudo a sair; apagada um instante de cada vez que se deita uma linha fora.
  static uint32_t deitadasFora = 0, apagadaAte = 0;
  if (aqPerdidas + aqCortadas != deitadasFora) {
    deitadasFora = aqPerdidas + aqCortadas;
    apagadaAte = agora + 200;
  }
  digitalWrite(PINO_LUZ, (int32_t)(agora - apagadaAte) >= 0 ? HIGH : LOW);

  delay(1);
}
