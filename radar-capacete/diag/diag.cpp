// Sonda do LD2460: encostar um fio ligado ao GPIO 6 a cada pino do conector J1
// e ver em qual aparecem dados. Gravar com:  pio run -e diag -t upload
#include <Arduino.h>

static const int PROBE = 6;    // fio solto de prova
static const int TXCMD = 4;    // fio amarelo (já soldado) - só para mandar o comando de ativação
static const int PIN_Y = 4, PIN_O = 5;
static const uint8_t ENABLE[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x06, 0x0C, 0x00, 0x01, 0x04, 0x03, 0x02, 0x01};
static const uint32_t BAUDS[] = {115200, 256000, 9600};

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\n=== SONDA LD2460 (fio de prova no GPIO 6) ===");
}

void loop() {
  for (uint32_t baud : BAUDS) {
    // 1) nível: com pull-down, só lê 1 se o pino tocado estiver a ser segurado em cima com força
    pinMode(PROBE, INPUT_PULLDOWN);
    delay(5);
    int hi = 0;
    for (int i = 0; i < 100; i++) { hi += digitalRead(PROBE); delayMicroseconds(200); }

    // 2) escutar dados nesse pino
    Serial1.end();
    Serial1.begin(baud, SERIAL_8N1, PROBE, TXCMD);
    delay(10);
    while (Serial1.available()) Serial1.read();
    Serial1.write(ENABLE, sizeof(ENABLE));
    int total = 0, n = 0;
    uint8_t first[16];
    const uint32_t t0 = millis();
    while (millis() - t0 < 700) {
      while (Serial1.available()) {
        uint8_t c = Serial1.read();
        if (n < 16) first[n++] = c;
        total++;
      }
    }
    const char *lvl = hi > 95 ? "ALTO(forte)" : hi < 5 ? "baixo/solto" : "a mexer";
    Serial.printf("SONDA %-11s %6lu baud: %4d bytes", lvl, (unsigned long)baud, total);
    for (int i = 0; i < n; i++) Serial.printf(" %02X", first[i]);
    Serial.println();
  }
}
