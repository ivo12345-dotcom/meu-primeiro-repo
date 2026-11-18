#pragma once
// Leitura do radar HLK-LD2460 pela porta série.
//
// Trama de alvos (enviada pelo radar):
//   F4 F3 F2 F1 | 04 | LEN_L LEN_H | n x (X_L X_H Y_L Y_H) | F8 F7 F6 F5
//   LEN = comprimento total da trama = 11 + 4*n
//   X, Y = int16 com sinal, em unidades de 0,1 m (Y = para a frente do radar)
//
// Comandos (enviados para o radar):
//   FD FC FB FA | CMD | LEN_L LEN_H | dados | 04 03 02 01

#include <Arduino.h>

struct RadarTarget {
  float x;  // metros, lateral
  float y;  // metros, para a frente
};

class LD2460 {
 public:
  static const uint8_t MAX_TARGETS = 5;

  void begin(HardwareSerial *port, int rxPin, int txPin, uint32_t baud) {
    port_ = port;
    port_->setRxBufferSize(512);
    port_->begin(baud, SERIAL_8N1, rxPin, txPin);
    enableReporting();
  }

  // Chamar sempre no loop(). Devolve true quando chega uma trama nova.
  bool poll() {
    bool gotFrame = false;
    while (port_ && port_->available()) {
      uint8_t b = port_->read();
      bytesTotal++;
      if (len_ < sizeof(buf_)) {
        buf_[len_++] = b;
      } else {
        len_ = 0;  // trama impossível: recomeça
      }
      if (tryParse_()) gotFrame = true;
    }
    return gotFrame;
  }

  void enableReporting() {
    const uint8_t cmd[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x06, 0x0C, 0x00, 0x01, 0x04, 0x03, 0x02, 0x01};
    if (port_) port_->write(cmd, sizeof(cmd));
    lastEnableMs = millis();
  }

  // Modo de instalação: 1 = lateral (parede), 2 = teto
  void setInstallMode(uint8_t mode) {
    const uint8_t cmd[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x09, 0x0C, 0x00, mode, 0x04, 0x03, 0x02, 0x01};
    if (port_) port_->write(cmd, sizeof(cmd));
  }

  bool alive(uint32_t now) const { return lastFrameMs != 0 && now - lastFrameMs < 2000; }

  RadarTarget targets[MAX_TARGETS];
  uint8_t targetCount = 0;
  uint32_t lastFrameMs = 0;
  uint32_t lastEnableMs = 0;
  uint32_t framesTotal = 0;
  uint32_t bytesTotal = 0;

 private:
  bool tryParse_() {
    // Procurar o cabeçalho F4 F3 F2 F1 no início do buffer
    static const uint8_t H[4] = {0xF4, 0xF3, 0xF2, 0xF1};
    static const uint8_t HC[4] = {0xFD, 0xFC, 0xFB, 0xFA};
    for (size_t i = 0; i < len_ && i < 4; i++) {
      if (buf_[i] != H[i] && buf_[i] != HC[i]) {
        shift_(1);
        return false;
      }
    }
    if (len_ < 7) return false;
    const bool isReport = buf_[0] == 0xF4 && buf_[1] == 0xF3 && buf_[2] == 0xF2 && buf_[3] == 0xF1;
    const bool isCmd = buf_[0] == 0xFD && buf_[1] == 0xFC && buf_[2] == 0xFB && buf_[3] == 0xFA;
    if (!isReport && !isCmd) {
      shift_(1);
      return false;
    }
    const uint16_t total = buf_[5] | (buf_[6] << 8);
    if (total < 11 || total > sizeof(buf_)) {
      shift_(1);
      return false;
    }
    if (len_ < total) return false;

    bool ok = false;
    if (isReport) {
      const bool footer = buf_[total - 4] == 0xF8 && buf_[total - 3] == 0xF7 &&
                          buf_[total - 2] == 0xF6 && buf_[total - 1] == 0xF5;
      if (footer && buf_[4] == 0x04 && (total - 11) % 4 == 0) {
        uint8_t n = (total - 11) / 4;
        if (n > MAX_TARGETS) n = MAX_TARGETS;
        for (uint8_t i = 0; i < n; i++) {
          const size_t o = 7 + i * 4;
          const int16_t rx = (int16_t)(buf_[o] | (buf_[o + 1] << 8));
          const int16_t ry = (int16_t)(buf_[o + 2] | (buf_[o + 3] << 8));
          targets[i].x = rx / 10.0f;
          targets[i].y = ry / 10.0f;
        }
        targetCount = n;
        lastFrameMs = millis();
        framesTotal++;
        ok = true;
      }
    }
    // Respostas a comandos são ignoradas
    shift_(total);
    return ok;
  }

  void shift_(size_t n) {
    if (n >= len_) {
      len_ = 0;
      return;
    }
    memmove(buf_, buf_ + n, len_ - n);
    len_ -= n;
  }

  HardwareSerial *port_ = nullptr;
  uint8_t buf_[64];
  size_t len_ = 0;
};
