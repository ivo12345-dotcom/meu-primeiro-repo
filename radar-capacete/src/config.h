#pragma once
// =====================================================================
//  CONFIGURAÇÃO — altera aqui se mudares as ligações
// =====================================================================

// Quantos radares LD2460 estão ligados (1, 2 ou 3).
// Com 3 radares, a porta série do USB passa a ser usada pelo radar 3
// e deixa de haver mensagens de diagnóstico no computador (o ecrã OLED
// e a página no telemóvel continuam a mostrar o estado).
// (o ambiente "bancada" do platformio.ini força 1 radar, para haver mensagens no PC)
#ifndef NUM_RADARS
#define NUM_RADARS 3
#endif

// --- Pinos da Heltec V3 -------------------------------------------------
// Radar 1 (FRENTE)        : LD2460 pino 7 (Tx2) -> GPIO 4 ; pino 8 (Rx2) <- GPIO 5
// Radar 2 (TRÁS-ESQUERDA) : LD2460 pino 7 (Tx2) -> GPIO 6 ; pino 8 (Rx2) <- GPIO 7
// Radar 3 (TRÁS-DIREITA)  : LD2460 pino 7 (Tx2) -> GPIO 47; pino 8 (Rx2) <- GPIO 48
static const int RADAR_RX_PIN[3] = {4, 6, 47};
static const int RADAR_TX_PIN[3] = {5, 7, 48};
static const uint32_t RADAR_BAUD = 115200;

// Direção para onde cada radar está virado (graus, sentido dos ponteiros
// do relógio, 0 = frente do capacete). Pode ser afinado na página.
static const float RADAR_DEFAULT_YAW[3] = {0.0f, -120.0f, 120.0f};

// RCWL-0516: saída OUT
static const int RCWL_PIN = 2;

// Modulino Movement (LSM6DSOX) — I2C
static const int IMU_SDA_PIN = 41;
static const int IMU_SCL_PIN = 42;

// Ecrã OLED da própria Heltec (não mexer)
static const int OLED_SDA_PIN = 17;
static const int OLED_SCL_PIN = 18;
static const int OLED_RST_PIN = 21;
static const int VEXT_PIN = 36;   // LOW = liga a alimentação do ecrã
static const int LED_PIN = 35;
// Tempo em que o ecrã fica ligado depois de ligar a placa (depois apaga-se para não dar luz)
static const uint32_t OLED_ON_MS = 30000;
static const uint32_t DUMP_WAIT_MS = 1500;  // no arranque, espera pelo PC pedir a gravação
static const float SHADOW_DEG = 15.0f;
static const float SAME_BODY_M = 0.5f;  // m: dois alvos do mesmo radar mais perto que isto = o mesmo corpo  // graus: alvo mais longe no mesmo ângulo do mesmo radar = eco na parede
static const float MERGE_DIST = 0.7f;
static const float SEAM_MERGE_DIST = 1.6f;  // m: na fronteira entre dois radares junta-se mais longe (passagem rápida)
static const float SEAM_EDGE_DEG = 35.0f;   // graus do centro do radar a partir dos quais o alvo está "na borda"
static const uint32_t EDGE_HOLD_MS = 600;
static const float BACK_SAME_D = 0.3f;     // m: "mesma distância" para o eco pelas costas
static const float BACK_CONE_DEG = 40.0f;  // graus atrás de cada radar onde ele vê pelas costas  // alvo congelado na borda mais do que isto = fantasma
static const uint16_t MOUNT_HEIGHT_CM = 170;
static const int16_t RADAR_HALF_FOV_DDEG = 600;  // ±60,0° por radar   // m: alvos de radares diferentes mais perto que isto = a mesma pessoa

// --- Wi-Fi (o telemóvel liga-se a esta rede) -----------------------------
#define WIFI_SSID     "RADAR-CAPACETE"
#define WIFI_PASSWORD "airsoft123"   // mínimo 8 caracteres
// Endereço da página: http://192.168.4.1
