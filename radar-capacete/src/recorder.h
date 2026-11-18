#pragma once
// "Caixa negra": grava na memória da placa tudo o que os radares mandam (em bruto, antes de
// qualquer filtro), o giroscópio e as marcas carregadas no telemóvel. Depois lê-se pelo USB:
// no arranque a placa espera ~1,5 s por um 'D' na porta USB e, se o receber, despeja o ficheiro.
//
// Formato (texto, uma linha por registo):
//   R,<ms>,<radar 0-2>,<n>,<x1>,<y1>,...   alvos em bruto do radar (x,y em dm, como vêm do LD2460)
//   I,<ms>,<rumo>,<parado 0/1>,<mexer>     giroscópio, 5x por segundo
//   M,<ms>,<n>                             marca n.º n (botão "Marcar" no telemóvel)
//   S,<ms>,<texto>                         início da gravação e definições
#include <Arduino.h>
#include <LittleFS.h>

class Recorder {
 public:
  static constexpr const char *PATH = "/rec.txt";
  static const size_t MAX_BYTES = 1200000;  // ~20 min de gravação

  bool begin() {
    fsOk = LittleFS.begin(true);
    if (fsOk && LittleFS.exists(PATH)) {
      File f = LittleFS.open(PATH, "r");
      bytes = f ? f.size() : 0;
      if (f) f.close();
    }
    return fsOk;
  }

  void start(const String &header) {
    if (!fsOk) return;
    stop();
    LittleFS.remove(PATH);
    file_ = LittleFS.open(PATH, "w");
    if (!file_) return;
    bytes = 0;
    marks = 0;
    buf_ = "";
    on = true;
    line("S," + String(millis()) + "," + header);
  }

  void stop() {
    if (!on) return;
    flush();
    file_.close();
    on = false;
  }

  void line(const String &s) {
    if (!on) return;
    buf_ += s;
    buf_ += '\n';
    if (buf_.length() > 2048) flush();
  }

  void mark() { line("M," + String(millis()) + "," + String(++marks)); }

  // Chamar no loop(): despeja o buffer para a memória pelo menos 1x por segundo
  void tick() {
    if (on && millis() - lastFlush_ > 1000) flush();
  }

  void flush() {
    lastFlush_ = millis();
    if (!on || buf_.length() == 0) return;
    file_.print(buf_);
    file_.flush();
    bytes += buf_.length();
    buf_ = "";
    if (bytes > MAX_BYTES) stop();  // memória cheia: pára sozinho
  }

  // No arranque, antes dos radares ocuparem a porta USB
  void offerDump(HardwareSerial &s, uint32_t waitMs) {
    s.begin(115200);
    const uint32_t t0 = millis();
    bool done = false;
    while (!done && millis() - t0 < waitMs) {
      s.println("CAIXA-NEGRA? manda D");
      delay(100);
      while (!done && s.available()) {
        if (s.read() == 'D') {
          dump_(s);
          done = true;
        }
      }
    }
    s.flush();
    s.end();
  }

  bool fsOk = false;
  bool on = false;
  size_t bytes = 0;
  uint16_t marks = 0;

 private:
  void dump_(HardwareSerial &s) {
    File f = fsOk ? LittleFS.open(PATH, "r") : File();
    s.printf("\n===INICIO %u===\n", f ? (unsigned)f.size() : 0);
    if (f) {
      uint8_t b[256];
      while (f.available()) {
        const size_t n = f.read(b, sizeof(b));
        s.write(b, n);
      }
      f.close();
    }
    s.println("\n===FIM===");
    s.flush();
  }

  File file_;
  String buf_;
  uint32_t lastFlush_ = 0;
};
