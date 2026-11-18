#pragma once
// Arduino Modulino Movement (LSM6DSOX) — leitura direta por I2C, sem bibliotecas.
//
// Calcula a rotação da cabeça à volta do eixo vertical ("heading"), usando
// só o giroscópio + a direção da gravidade (sem bússola, por isso não é
// afetado por metal nem ímanes). Também diz se a cabeça está parada.

#include <Arduino.h>
#include <Wire.h>

class HeadImu {
 public:
  bool begin(TwoWire *wire) {
    wire_ = wire;
    for (uint8_t a : {0x6A, 0x6B}) {
      addr_ = a;
      if (read8_(0x0F) == 0x6C) {  // WHO_AM_I do LSM6DSOX
        write8_(0x12, 0x44);       // CTRL3_C: BDU=1, IF_INC=1
        write8_(0x10, 0x40);       // CTRL1_XL: 104 Hz, ±2 g
        write8_(0x11, 0x44);       // CTRL2_G : 104 Hz, ±500 dps
        ok = true;
        startCalibration();
        return true;
      }
    }
    ok = false;
    return false;
  }

  // Pede uma calibração do giroscópio (o capacete tem de estar parado ~2 s)
  void startCalibration() {
    calibrating = true;
    calStartMs_ = millis();
    calN_ = 0;
    calSum_[0] = calSum_[1] = calSum_[2] = 0;
  }

  void zeroHeading() { heading = 0; }

  // Chamar no loop(); lê o sensor no máximo a ~100 Hz
  void update() {
    if (!ok) return;
    const uint32_t nowUs = micros();
    if (nowUs - lastUs_ < 9000) return;
    float dt = (nowUs - lastUs_) / 1e6f;
    lastUs_ = nowUs;
    if (dt > 0.1f) dt = 0.1f;

    uint8_t raw[12];
    if (!readN_(0x22, raw, 12)) {
      errors++;
      if (++failRun_ > 20) ok = false;  // deixou de responder: o main volta a procurá-lo
      return;
    }
    failRun_ = 0;
    float g[3], a[3];
    for (int i = 0; i < 3; i++) {
      g[i] = (int16_t)(raw[2 * i] | (raw[2 * i + 1] << 8)) * 0.0175f;        // dps
      a[i] = (int16_t)(raw[6 + 2 * i] | (raw[6 + 2 * i + 1] << 8)) * 0.000061f;  // g
    }

    // Filtro passa-baixo da gravidade
    for (int i = 0; i < 3; i++) grav_[i] += (a[i] - grav_[i]) * 0.05f;
    const float an = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

    if (calibrating) {
      for (int i = 0; i < 3; i++) calSum_[i] += g[i];
      calN_++;
      if (millis() - calStartMs_ > 2000 && calN_ > 50) {
        for (int i = 0; i < 3; i++) bias_[i] = calSum_[i] / calN_;
        calibrating = false;
      }
      return;
    }

    float gc[3] = {g[0] - bias_[0], g[1] - bias_[1], g[2] - bias_[2]};
    const float gmag = sqrtf(gc[0] * gc[0] + gc[1] * gc[1] + gc[2] * gc[2]);
    motion = motion * 0.9f + gmag * 0.1f;

    // Cabeça parada?
    const bool quiet = gmag < 4.0f && fabsf(an - 1.0f) < 0.08f;
    if (quiet) {
      if (quietSinceMs_ == 0) quietSinceMs_ = millis();
    } else {
      quietSinceMs_ = 0;
    }
    still = quietSinceMs_ != 0 && millis() - quietSinceMs_ > 600;

    // Correção lenta do erro do giroscópio enquanto está parado
    if (quietSinceMs_ != 0 && millis() - quietSinceMs_ > 1500 && gmag < 2.0f) {
      for (int i = 0; i < 3; i++) bias_[i] += (g[i] - bias_[i]) * 0.01f;
    }

    // Velocidade de rotação à volta da vertical = giroscópio projetado na gravidade
    const float gn = sqrtf(grav_[0] * grav_[0] + grav_[1] * grav_[1] + grav_[2] * grav_[2]);
    if (gn < 0.3f) return;
    const float yawRate = (gc[0] * grav_[0] + gc[1] * grav_[1] + gc[2] * grav_[2]) / gn;
    // Rodar para a esquerda (visto de cima) dá yawRate > 0 -> heading diminui
    heading -= (invert ? -1.0f : 1.0f) * yawRate * dt;
    while (heading >= 360.0f) heading -= 360.0f;
    while (heading < 0.0f) heading += 360.0f;
  }

  bool ok = false;
  uint16_t failRun_ = 0;
  bool calibrating = false;
  bool still = false;
  bool invert = false;
  float heading = 0;   // graus, sentido dos ponteiros do relógio
  float motion = 0;    // intensidade do movimento (dps, filtrado)
  uint32_t errors = 0;

 private:
  uint8_t read8_(uint8_t reg) {
    uint8_t v = 0;
    readN_(reg, &v, 1);
    return v;
  }
  void write8_(uint8_t reg, uint8_t v) {
    wire_->beginTransmission(addr_);
    wire_->write(reg);
    wire_->write(v);
    wire_->endTransmission();
  }
  bool readN_(uint8_t reg, uint8_t *out, uint8_t n) {
    wire_->beginTransmission(addr_);
    wire_->write(reg);
    if (wire_->endTransmission(false) != 0) return false;
    if (wire_->requestFrom((int)addr_, (int)n) != n) return false;
    for (uint8_t i = 0; i < n; i++) out[i] = wire_->read();
    return true;
  }

  TwoWire *wire_ = nullptr;
  uint8_t addr_ = 0x6A;
  uint32_t lastUs_ = 0;
  float bias_[3] = {0, 0, 0};
  float grav_[3] = {0, 0, 1};
  uint32_t calStartMs_ = 0;
  uint32_t calN_ = 0;
  float calSum_[3];
  uint32_t quietSinceMs_ = 0;
};
