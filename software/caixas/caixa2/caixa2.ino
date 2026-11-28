// ARLEQUIN · caixa 2 (motor): escuta o barramento do motor (J1939) e reenvia cada trama à caixa 1 pelo
// rádio das placas. Não há fio entre o motor e o portátil.
//
// Desenho: docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md ("Caixa 2: motor")
// Plano:   docs/superpowers/plans/2026-11-23-sistema-no-portatil-parte2-caixas.md
//
// Regras que mandam aqui:
//   - SÓ EM ESCUTA: esta caixa nunca escreve no barramento do motor (motor.h);
//   - o mais simples possível: lê e reenvia, sem contas;
//   - se o ciclo ficar preso, o cão de guarda reinicia a placa ao fim de 5 s.
//
// Pelo USB (que no barco só lhe dá corrente) manda o seu batimento de segundo a segundo, para o portátil
// a reconhecer se alguma vez a ligarem a ele: $AQB,2,<ms>,<versão>,<a fingir>,0,<pacotes falhados>
//
// Compilar, gravar e ensaiar: ver software/caixas/README.md (npm run gravar:2 -- COMx).
#include <Arduino.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include <arlequin_linhas.h>
#include <arlequin_radio.h>
#include <arlequin_versao.h>

#include "ensaio2.h"
#include "motor.h"
#include "pinos.h"
#include "radio2.h"

const uint32_t CAO_DE_GUARDA_MS = 5000;
const uint32_t BATIMENTO_MS = 1000;
const int TRAMAS_POR_VOLTA = 32;  // tramas do motor tratadas em cada volta do ciclo, no máximo

static uint32_t proximoBatimento = 0;
static AqOrdens ordens;

// Os contadores da caixa, para o comando "estado". O espaço do texto sai deste formato (AQ_TEXTO): com
// os números todos no máximo não se corta, e o compilador recusa um formato que não caiba numa linha.
#define ESTADO_FORMATO "motor-tramas=%lu;motor-ignoradas=%lu;radio-ouve=%d;radio-falhadas=%lu;radio-sem-confirmar=%lu;radio-deitadas-fora=%lu"

static void batimento(uint32_t agora) {
  AqLinha("B").i(2).u(agora).t(AQ_VERSAO).i(ensaioAlgum() ? 1 : 0).i(0).u(radioFalhadas + radioSemConfirmar).manda(Serial);
}

static void responde(const char *comando, const char *resultado) {
  AqLinha("R").t(comando).t(resultado).manda(Serial);
}

// Os comandos $AQC que chegam pelo USB (só na bancada). Devolve true se a linha era um comando com a
// soma certa: a esses responde sempre.
static bool obedece(const char *linha) {
  char nome[16];
  long v[4] = {0, 0, 0, 0};
  int quantos = 0;
  if (!aqComando(linha, nome, sizeof(nome), v, &quantos)) return false;  // sem soma certa não faz nada

  if (strcmp(nome, "parar") == 0 && quantos == 0) {
    ensaioParar();
    responde(nome, "ok");
  } else if (strcmp(nome, "motor") == 0 && quantos == 1) {
    responde(nome, ensaioMotor(v[0]) ? "ok" : "fora-dos-limites");
  } else if (strcmp(nome, "estado") == 0 && quantos == 0) {
    AQ_TEXTO(texto, "estado", ESTADO_FORMATO);
    snprintf(texto, sizeof(texto), ESTADO_FORMATO,
             (unsigned long)motorTramas, (unsigned long)motorIgnoradas, radioTemOuvinte(millis()) ? 1 : 0, (unsigned long)radioFalhadas,
             (unsigned long)radioSemConfirmar, (unsigned long)radioDeitadasFora);
    responde(nome, texto);
  } else if (strcmp(nome, "recente") == 0 && quantos == 3) {
    // a conta "há quanto tempo chegou o sinal da caixa 1" (arlequin_radio.h), com horas dadas à mão
    if (v[2] < 0 || v[2] > 60000) responde(nome, "fora-dos-limites");
    else responde(nome, aqRecente((uint32_t)v[0], (uint32_t)v[1], (uint32_t)v[2]) ? "1" : "0");
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
  // O cão de guarda do ciclo principal: 5 s sem dar a volta e a placa recomeça. Arma-se antes de tudo,
  // para também valer se alguma coisa ficar presa a arrancar (a linha do motor, o rádio).
  const esp_task_wdt_config_t cao = {.timeout_ms = CAO_DE_GUARDA_MS, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&cao);
  enableLoopWDT();

  Serial.setTxBufferSize(4096);
  Serial.begin(AQ_BAUD);
  pinMode(PINO_LUZ, OUTPUT);
  motorIniciar();
  radioIniciar();

  proximoBatimento = millis();
}

void loop() {
  const uint32_t agora = millis();

  // as ordens que chegam pelo USB, com conta e medida (AqOrdens, em arlequin_linhas.h)
  ordens.corre(Serial, agora, [agora](const char *linha) {
    const bool fingia = ensaioAlgum();
    const bool respondeu = obedece(linha);
    // Passou a fingir: di-lo já, pelo rádio e pelo USB, antes de sair a primeira trama a fingir.
    if (!fingia && ensaioAlgum()) {
      radioBatimento(agora, true);
      batimento(agora);
    }
    return respondeu;
  });

  // o que vier da linha do motor (ou do gerador de bancada) segue para o rádio
  AqTrama t;
  for (int i = 0; i < TRAMAS_POR_VOLTA && motorLe(t); i++) radioJunta(t, agora);
  ensaioCorre(agora, [agora](const AqTrama &x) { radioJunta(x, agora); });
  radioCorre(agora, ensaioAlgum());

  if ((int32_t)(agora - proximoBatimento) >= 0) {
    batimento(agora);
    proximoBatimento += BATIMENTO_MS;
    if ((int32_t)(agora - proximoBatimento) >= 0) proximoBatimento = agora + BATIMENTO_MS;  // ficou para trás: acerta
  }

  // A luz: acesa enquanto a caixa 1 estiver a ouvir.
  digitalWrite(PINO_LUZ, radioTemOuvinte(agora) ? HIGH : LOW);

  delay(1);
}
