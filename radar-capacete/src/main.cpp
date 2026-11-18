// =====================================================================
//  RADAR DE CAPACETE — Heltec WiFi LoRa 32 V3
//  3 x HLK-LD2460 + RCWL-0516 + Arduino Modulino Movement (LSM6DSOX)
//  Página no telemóvel: ligar à rede "RADAR-CAPACETE" e abrir http://192.168.4.1
// =====================================================================
#include <Arduino.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>

#include "SSD1306Wire.h"
#include "config.h"
#include "imu.h"
#include "ld2460.h"
#include "web_page.h"

#if NUM_RADARS < 1 || NUM_RADARS > 3
#error "NUM_RADARS tem de ser 1, 2 ou 3"
#endif

// Com 3 radares a UART0 (a do USB) é usada pelo radar 3
#define DEBUG_LOG (NUM_RADARS < 3)
#if DEBUG_LOG
#define LOG(...) Serial.printf(__VA_ARGS__)
#else
#define LOG(...)
#endif

static HardwareSerial *const RADAR_PORT[3] = {&Serial1, &Serial2, &Serial};

LD2460 radars[NUM_RADARS];
HeadImu imu;
TwoWire imuWire(1);
SSD1306Wire oled(0x3c, OLED_SDA_PIN, OLED_SCL_PIN, GEOMETRY_128_64, I2C_ONE);
WebServer server(80);
Preferences prefs;

// Definições guardadas na memória da placa
struct Settings {
  float yaw[3];
  bool flip[3];
  bool invert;
  float minDist;
} cfg;

uint32_t lastWebMs = 0;

// ---------------------------------------------------------------------
void loadSettings() {
  prefs.begin("radar", true);
  for (int i = 0; i < 3; i++) {
    char k[8];
    snprintf(k, sizeof(k), "y%d", i);
    cfg.yaw[i] = prefs.getFloat(k, RADAR_DEFAULT_YAW[i]);
    snprintf(k, sizeof(k), "f%d", i);
    cfg.flip[i] = prefs.getBool(k, false);
  }
  cfg.invert = prefs.getBool("inv", false);
  cfg.minDist = prefs.getFloat("min", 0.6f);
  prefs.end();
  imu.invert = cfg.invert;
}

void saveSettings() {
  prefs.begin("radar", false);
  for (int i = 0; i < 3; i++) {
    char k[8];
    snprintf(k, sizeof(k), "y%d", i);
    prefs.putFloat(k, cfg.yaw[i]);
    snprintf(k, sizeof(k), "f%d", i);
    prefs.putBool(k, cfg.flip[i]);
  }
  prefs.putBool("inv", cfg.invert);
  prefs.putFloat("min", cfg.minDist);
  prefs.end();
  imu.invert = cfg.invert;
}

// O RCWL só conta quando a cabeça está parada (senão deteta o teu próprio movimento)
bool rcwlActive() { return digitalRead(RCWL_PIN) == HIGH; }

// ---------------------------------------------------------------------
// Web
void handleRoot() {
  lastWebMs = millis();
  server.send_P(200, "text/html; charset=utf-8", WEB_PAGE);
}

void handleData() {
  lastWebMs = millis();
  const uint32_t now = millis();
  static char out[1024];
  int n = snprintf(out, sizeof(out), "{\"t\":%lu,\"h\":%.1f,\"st\":%d,\"cal\":%d,\"imu\":%d,\"mv\":%.1f,\"rc\":%d,\"r\":[",
                   (unsigned long)now, imu.heading, imu.still ? 1 : 0, imu.calibrating ? 1 : 0, imu.ok ? 1 : 0,
                   imu.motion, rcwlActive() ? 1 : 0);
  for (int i = 0; i < NUM_RADARS; i++) {
    n += snprintf(out + n, sizeof(out) - n, "%s[%d,%lu]", i ? "," : "", radars[i].alive(now) ? 1 : 0,
                  (unsigned long)radars[i].framesTotal);
  }
  n += snprintf(out + n, sizeof(out) - n, "],\"tg\":[");
  // 1) recolher os alvos de todos os radares; 2) juntar repetidos; 3) escrever.
  struct Cand { float wx, wy, bearing, d, rel; int r; bool keep; };
  Cand c[15];
  int nc = 0;
  for (int i = 0; i < NUM_RADARS; i++) {
    if (!radars[i].alive(now)) continue;
    for (uint8_t k = 0; k < radars[i].targetCount; k++) {
      const float x = radars[i].targets[k].x * (cfg.flip[i] ? -1.0f : 1.0f);
      const float y = radars[i].targets[k].y;
      const float d = sqrtf(x * x + y * y);
      if (d < cfg.minDist) continue;  // o próprio jogador / a arma
      const float bearing = cfg.yaw[i] + atan2f(x, y) * 180.0f / PI;
      // "Sombra": o eco de uma pessoa a bater na parede atrás dela aparece no MESMO radar,
      // quase no mesmo ângulo e mais longe. Uma pessoa real escondida atrás de outra
      // também não seria vista (o radar não atravessa corpos), por isso deita-se fora.
      bool shadow = false;
      for (uint8_t q = 0; q < radars[i].targetCount && !shadow; q++) {
        if (q == k) continue;
        const float qx = radars[i].targets[q].x * (cfg.flip[i] ? -1.0f : 1.0f), qy = radars[i].targets[q].y;
        const float qd = sqrtf(qx * qx + qy * qy);
        const float da = fabsf(atan2f(qx, qy) - atan2f(x, y)) * 180.0f / PI;
        shadow = qd >= cfg.minDist && qd < d - 0.3f && da < SHADOW_DEG;
      }
      if (shadow) continue;
      if (nc < 15)
        c[nc++] = {d * sinf(bearing * PI / 180.0f), d * cosf(bearing * PI / 180.0f), bearing, d,
                   fabsf(atan2f(x, y)) * 180.0f / PI, i, true};
    }
  }
  // A mesma pessoa vista por dois radares: perto (< MERGE_DIST) = a mesma. Na fronteira entre
  // radares (ambos na borda) junta-se mais longe, porque o radar que a perdeu ainda a segura
  // um instante na posição antiga. Fica o alvo mais ao centro do seu radar (mais fiável).
  for (int a = 0; a < nc; a++)
    for (int b = a + 1; b < nc; b++) {
      if (!c[a].keep || !c[b].keep || c[a].r == c[b].r) continue;
      const float dist = hypotf(c[a].wx - c[b].wx, c[a].wy - c[b].wy);
      const bool seam = c[a].rel > SEAM_EDGE_DEG && c[b].rel > SEAM_EDGE_DEG;
      if (dist < MERGE_DIST || (seam && dist < SEAM_MERGE_DIST)) {
        if (c[a].rel <= c[b].rel) c[b].keep = false; else c[a].keep = false;
      }
    }
  bool first = true;
  for (int a = 0; a < nc; a++) {
    if (!c[a].keep) continue;
    n += snprintf(out + n, sizeof(out) - n, "%s[%.1f,%.2f,%d]", first ? "" : ",", c[a].bearing, c[a].d, c[a].r);
    first = false;
    if (n > (int)sizeof(out) - 40) break;
  }
  n += snprintf(out + n, sizeof(out) - n, "]}");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", out);
}

void handleCfg() {
  char out[256];
  snprintf(out, sizeof(out),
           "{\"n\":%d,\"yaw\":[%.0f,%.0f,%.0f],\"flip\":[%d,%d,%d],\"inv\":%d,\"min\":%.2f}", NUM_RADARS,
           cfg.yaw[0], cfg.yaw[1], cfg.yaw[2], cfg.flip[0], cfg.flip[1], cfg.flip[2], cfg.invert ? 1 : 0,
           cfg.minDist);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", out);
}

void handleSet() {
  for (int i = 0; i < 3; i++) {
    String k = "y" + String(i);
    if (server.hasArg(k)) cfg.yaw[i] = server.arg(k).toFloat();
    k = "f" + String(i);
    if (server.hasArg(k)) cfg.flip[i] = server.arg(k) == "1";
  }
  if (server.hasArg("inv")) cfg.invert = server.arg("inv") == "1";
  if (server.hasArg("min")) cfg.minDist = constrain(server.arg("min").toFloat(), 0.3f, 2.0f);
  saveSettings();
  server.send(200, "text/plain", "ok");
}

void handleCmd() {
  const String c = server.arg("c");
  if (c == "zero") {
    imu.zeroHeading();
  } else if (c == "cal") {
    imu.startCalibration();
  } else if (c == "side") {
    for (int i = 0; i < NUM_RADARS; i++) radars[i].setInstallMode(1);
  }
  server.send(200, "text/plain", "ok");
}

// ---------------------------------------------------------------------
// Ecrã OLED da Heltec
void drawOled() {
  const uint32_t now = millis();
  oled.clear();
  oled.setFont(ArialMT_Plain_10);
  oled.setTextAlignment(TEXT_ALIGN_LEFT);
  oled.drawString(0, 0, WIFI_SSID);
  oled.drawString(0, 11, "http://192.168.4.1");

  int total = 0;
  String r = "Radar:";
  for (int i = 0; i < NUM_RADARS; i++) {
    const bool a = radars[i].alive(now);
    r += a ? " OK" : (radars[i].bytesTotal ? " ??" : " --");
    if (a) total += radars[i].targetCount;
  }
  oled.drawString(0, 22, r);

  String s = imu.ok ? (imu.calibrating ? "IMU: calibrar..." : "IMU OK  " + String((int)imu.heading) + "deg")
                    : "IMU: nao encontrado";
  oled.drawString(0, 33, s);
  oled.drawString(0, 44, String("Alvos: ") + total + (rcwlActive() ? "   RCWL!" : ""));
  oled.drawString(0, 54, String("Telemovel: ") + (now - lastWebMs < 3000 ? "ligado" : "--") + "  " +
                             WiFi.softAPgetStationNum());
  oled.display();
}

// ---------------------------------------------------------------------
void setup() {
#if DEBUG_LOG
  Serial.begin(115200);
#endif
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);  // LED sempre apagado (não denunciar a posição)
  pinMode(RCWL_PIN, INPUT_PULLDOWN);

  // Ecrã OLED
  pinMode(VEXT_PIN, OUTPUT);
  digitalWrite(VEXT_PIN, LOW);
  delay(50);
  pinMode(OLED_RST_PIN, OUTPUT);
  digitalWrite(OLED_RST_PIN, LOW);
  delay(20);
  digitalWrite(OLED_RST_PIN, HIGH);
  delay(20);
  oled.init();
  oled.flipScreenVertically();
  oled.setFont(ArialMT_Plain_10);
  oled.drawString(0, 0, "Radar a arrancar...");
  oled.drawString(0, 12, "NAO MEXER (calibrar)");
  oled.display();

  loadSettings();

  // Radares
  for (int i = 0; i < NUM_RADARS; i++) {
    radars[i].begin(RADAR_PORT[i], RADAR_RX_PIN[i], RADAR_TX_PIN[i], RADAR_BAUD);
  }
  // Dizer aos radares onde estão: capacete a ~1,7 m, a olhar a direito, cada um só na sua fatia
  delay(300);
  for (int i = 0; i < NUM_RADARS; i++) {
    radars[i].setMountParams(MOUNT_HEIGHT_CM, 0);
    delay(60);
    radars[i].setRange(60, -RADAR_HALF_FOV_DDEG, RADAR_HALF_FOV_DDEG);
    delay(60);
    radars[i].enableReporting();
  }

  // IMU
  imuWire.begin(IMU_SDA_PIN, IMU_SCL_PIN, 400000);
  if (imu.begin(&imuWire)) {
    LOG("IMU LSM6DSOX encontrado\n");
  } else {
    LOG("IMU nao encontrado - verifica SDA=41 SCL=42 3V3 GND\n");
  }

  // Wi-Fi (ponto de acesso próprio, não precisa de internet)
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD, 6, 0, 2);
  WiFi.setSleep(false);
  LOG("Wi-Fi: %s  IP: %s\n", WIFI_SSID, WiFi.softAPIP().toString().c_str());

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/cfg", handleCfg);
  server.on("/set", handleSet);
  server.on("/cmd", handleCmd);
  server.onNotFound(handleRoot);
  server.begin();
}

void loop() {
  const uint32_t now = millis();

  for (int i = 0; i < NUM_RADARS; i++) {
    radars[i].poll();
    // Se um radar não manda dados, volta a pedir o envio de alvos a cada 3 s
    if (!radars[i].alive(now) && now - radars[i].lastEnableMs > 3000) radars[i].enableReporting();
  }

  imu.update();
  server.handleClient();

  // Sem luz nenhuma em jogo: o ecrã só mostra o estado nos primeiros OLED_ON_MS depois de ligar
  // (para confirmar "Radar: OK OK OK") e depois desliga-se de vez. O LED da placa fica sempre apagado.
  static uint32_t lastOled = 0;
  static bool oledOff = false;
  if (!oledOff && now - lastOled > 300) {
    lastOled = now;
    if (now < OLED_ON_MS) {
      drawOled();
    } else {
      oled.clear();
      oled.display();
      oled.displayOff();
      digitalWrite(VEXT_PIN, HIGH);  // corta a alimentação do ecrã
      oledOff = true;
    }
  }

#if DEBUG_LOG
  static uint32_t lastLog = 0;
  if (now - lastLog > 1000) {
    lastLog = now;
    for (int i = 0; i < NUM_RADARS; i++) {
      LOG("R%d bytes=%lu tramas=%lu alvos=%u", i + 1, (unsigned long)radars[i].bytesTotal,
          (unsigned long)radars[i].framesTotal, radars[i].targetCount);
      for (uint8_t k = 0; k < radars[i].targetCount; k++)
        LOG("  (x=%.1f y=%.1f)", radars[i].targets[k].x, radars[i].targets[k].y);
      LOG("\n");
    }
    LOG("IMU ok=%d cal=%d still=%d heading=%.1f  RCWL=%d\n", imu.ok, imu.calibrating, imu.still, imu.heading,
        rcwlActive());
  }
#endif
}
