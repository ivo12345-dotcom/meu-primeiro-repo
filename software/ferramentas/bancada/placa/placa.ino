// Ensaio de bancada 1: a placa está viva e o sensor BNO085 responde?
//
// Só usa o que vem com a placa (não precisa de nenhuma biblioteca à parte). Serve para apanhar
// logo o que costuma falhar: cabo USB que só carrega, fio trocado, sensor sem corrente.
//
// Placa: ELEGOO "ESP32 DEVKIT V1 TYPEC" (30 pinos). Sensor: Adafruit BNO085 (ref. 4754), a 4 fios:
//   VIN -> 3V3     GND -> GND     SDA -> D21     SCL -> D22
//
// De 2 em 2 segundos manda uma linha pelo USB (115 200 baud):
//   BANCADA1 t=12 chip=ESP32-D0WD-V3 rev=301 flash=4MB puxa_sda=1 puxa_scl=1 i2c=4A sensor=sim pacote=276/0 lidos=290
//
//   puxa_sda, puxa_scl  1 se o sensor está a puxar essa linha para cima: prova que o sensor tem
//                       corrente e que esse fio está ligado
//   i2c                 o endereço a que o sensor responde (4A; 4B se o pino DI estiver alto)
//   sensor              sim, se respondeu nesta volta
//   pacote              comprimento/canal do primeiro pacote que o sensor ofereceu (276/0 é a
//                       apresentação de quem acabou de arrancar; "-" se não tinha nada para dizer)
//   lidos               bytes lidos ao sensor desde o arranque da placa
//
// ATENÇÃO, aprendido na bancada a 22/11/2026 (ponto 12 do desenho): a primeira versão deste programa
// procurava o sensor com escritas vazias a todos os endereços e lia-lhe só os 4 primeiros bytes, de
// 2 em 2 segundos. Isso deixou o sensor num estado em que ignorava ordens até recomeçar sozinho.
// Esta versão só lê, e lê cada pacote até ao fim, que é como o sensor quer ser tratado.
// (Compila; ainda não correu numa placa.)
//
// Compilar, gravar e ler (COMx é a porta que o Windows der à placa):
//   arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --build-path <pasta fora do projeto> placa
//   arduino-cli upload  --fqbn esp32:esp32:esp32doit-devkit-v1 --input-dir <a mesma pasta> -p COMx placa
//   python ../ler.py COMx 12
#include <Wire.h>

const int PINO_SDA = 21;
const int PINO_SCL = 22;
const int PINO_LED = 2;                 // a luz azul da placa, se a tiver
const uint32_t VELOCIDADE_I2C = 100000;
const uint32_t PERIODO_MS = 2000;
const uint8_t ENDERECOS[] = {0x4A, 0x4B};
const size_t MAIOR_LEITURA = 128;       // o que cabe de uma vez no barramento desta placa

static bool puxaSda = false, puxaScl = false, barramento = false;
static uint8_t endereco = 0;            // 0: o sensor ainda não respondeu
static String primeiro = "-";
static uint32_t lidos = 0;

// Com a resistência interna a puxar para baixo, a linha só fica alta se o sensor a puxar para cima.
// Só se faz com o barramento parado: mexer no modo dos pinos a meio de uma conversa estragava-a.
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

// Lê tudo o que o sensor tiver para dizer, cada pacote até ao fim. Devolve false se ele não responder.
// Um pacote começa por 4 bytes: comprimento (2, com o cabeçalho incluído), canal e número de ordem.
// Lido o cabeçalho, o resto vem aos bocados, e cada bocado traz outra vez um cabeçalho à frente.
static bool esvazia(uint8_t e) {
  for (int pacotes = 0; pacotes < 16; pacotes++) {
    if (Wire.requestFrom((int)e, 4) != 4) return false;
    uint8_t c[4];
    for (int i = 0; i < 4; i++) c[i] = Wire.read();
    uint16_t resto = ((uint16_t)(c[1] & 0x7F) << 8) | c[0];
    if (resto <= 4) return true;  // nada à espera
    if (primeiro == "-") primeiro = String(resto) + "/" + String(c[2]);
    lidos += 4;
    resto -= 4;
    while (resto > 0) {
      const size_t n = (size_t)resto + 4 > MAIOR_LEITURA ? MAIOR_LEITURA : (size_t)resto + 4;
      if (Wire.requestFrom((int)e, (int)n) != n) return false;
      while (Wire.available()) Wire.read();
      lidos += n - 4;
      resto -= n - 4;
    }
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_LED, OUTPUT);
  delay(300);
  Serial.println();
  Serial.println("BANCADA1 arranque");
}

void loop() {
  // Enquanto não houver barramento, vê-se se as duas linhas estão puxadas para cima; depois de o abrir
  // já não se mexe nos pinos.
  if (!barramento) {
    puxaSda = linhaPuxada(PINO_SDA);
    puxaScl = linhaPuxada(PINO_SCL);
    if (puxaSda && puxaScl) barramento = Wire.begin(PINO_SDA, PINO_SCL, VELOCIDADE_I2C);
  }

  bool responde = false;
  if (barramento) {
    if (endereco) {
      responde = esvazia(endereco);
    } else {
      for (uint8_t e : ENDERECOS) {
        if (esvazia(e)) {
          endereco = e;
          responde = true;
          break;
        }
      }
    }
  }

  digitalWrite(PINO_LED, responde ? HIGH : !digitalRead(PINO_LED));

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
  Serial.print(endereco ? doisHex(endereco) : String("-"));
  Serial.print(" sensor=");
  Serial.print(responde ? "sim" : "nao");
  Serial.print(" pacote=");
  Serial.print(primeiro);
  Serial.print(" lidos=");
  Serial.println(lidos);

  delay(PERIODO_MS);
}
