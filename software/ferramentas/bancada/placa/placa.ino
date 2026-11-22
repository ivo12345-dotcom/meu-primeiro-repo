// Ensaio de bancada 1: a placa está viva e o sensor BNO085 responde?
//
// Só usa o que vem com a placa (não precisa de nenhuma biblioteca à parte). Serve para apanhar
// logo o que costuma falhar: cabo USB que só carrega, fio trocado, sensor sem corrente.
//
// Placa: ELEGOO "ESP32 DEVKIT V1 TYPEC" (30 pinos). Sensor: Adafruit BNO085 (ref. 4754), pelo cabo
// de ficha pequena (STEMMA QT / Qwiic):
//   vermelho -> 3V3     preto -> GND     azul (SDA) -> D21     amarelo (SCL) -> D22
//
// De 2 em 2 segundos manda uma linha pelo USB (115 200 baud):
//   BANCADA1 t=12 chip=ESP32-D0WD-V3 rev=301 flash=4MB puxa_sda=1 puxa_scl=1 i2c=4A sensor=sim pacote=276/0
//
//   puxa_sda, puxa_scl  1 se o sensor está a puxar essa linha para cima: prova que o sensor tem
//                       corrente e que esse fio está ligado
//   i2c                 os endereços que respondem (o BNO085 é o 4A; o 4B se o pino DI estiver alto)
//   sensor              sim, se responde o 4A ou o 4B
//   pacote              comprimento/canal do pacote que o sensor oferece (só informativo)
//
// Compilar, gravar e ler (COMx é a porta que o Windows der à placa):
//   arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --build-path <pasta fora do projeto> placa
//   arduino-cli upload  --fqbn esp32:esp32:esp32doit-devkit-v1 --input-dir <a mesma pasta> -p COMx placa
//   arduino-cli monitor -p COMx --config baudrate=115200
#include <Wire.h>

const int PINO_SDA = 21;
const int PINO_SCL = 22;
const int PINO_LED = 2;                 // a luz azul da placa, se a tiver
const uint32_t VELOCIDADE_I2C = 100000;
const uint32_t PERIODO_MS = 2000;

// Com a resistência interna a puxar para baixo, a linha só fica alta se o sensor a puxar para cima.
static bool linhaPuxada(int pino) {
  pinMode(pino, INPUT_PULLDOWN);
  delay(2);
  const bool alta = digitalRead(pino) == HIGH;
  pinMode(pino, INPUT);
  return alta;
}

static String doisHex(uint8_t v) {
  String s = String(v, HEX);
  s.toUpperCase();
  return v < 16 ? "0" + s : s;
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_LED, OUTPUT);
  delay(300);
  Serial.println();
  Serial.println("BANCADA1 arranque");
}

void loop() {
  const bool puxaSda = linhaPuxada(PINO_SDA);
  const bool puxaScl = linhaPuxada(PINO_SCL);

  String enderecos = "";
  uint8_t enderecoSensor = 0;
  String pacote = "-";

  // Sem as duas linhas puxadas para cima não há barramento: procurar só fazia perder tempo.
  if (puxaSda && puxaScl) {
    Wire.begin(PINO_SDA, PINO_SCL, VELOCIDADE_I2C);
    for (uint8_t e = 0x08; e <= 0x77; e++) {
      Wire.beginTransmission(e);
      if (Wire.endTransmission() == 0) {
        if (enderecos.length()) enderecos += ",";
        enderecos += doisHex(e);
        if (e == 0x4A || e == 0x4B) enderecoSensor = e;
      }
    }
    if (enderecoSensor) {
      // Os quatro primeiros bytes de um pacote do BNO085: comprimento (2), canal, número de ordem.
      if (Wire.requestFrom((int)enderecoSensor, 4) == 4) {
        const uint8_t b0 = Wire.read();
        const uint8_t b1 = Wire.read();
        const uint8_t canal = Wire.read();
        Wire.read();
        const uint16_t comprimento = (uint16_t)((b1 & 0x7F) << 8) | b0;
        pacote = String(comprimento) + "/" + String(canal);
      } else {
        pacote = "erro";
      }
    }
    Wire.end();
  }

  digitalWrite(PINO_LED, enderecoSensor ? HIGH : !digitalRead(PINO_LED));

  Serial.print("BANCADA1 t=");
  Serial.print(millis() / 1000);
  Serial.print(" chip=");
  Serial.print(ESP.getChipModel());
  Serial.print(" rev=");
  Serial.print(ESP.getChipRevision());
  Serial.print(" flash=");
  Serial.print(ESP.getFlashChipSize() / (1024 * 1024));
  Serial.print("MB puxa_sda=");
  Serial.print(puxaSda ? 1 : 0);
  Serial.print(" puxa_scl=");
  Serial.print(puxaScl ? 1 : 0);
  Serial.print(" i2c=");
  Serial.print(enderecos.length() ? enderecos : String("-"));
  Serial.print(" sensor=");
  Serial.print(enderecoSensor ? "sim" : "nao");
  Serial.print(" pacote=");
  Serial.println(pacote);

  delay(PERIODO_MS);
}
