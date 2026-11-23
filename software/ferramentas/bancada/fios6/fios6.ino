// Ensaio de bancada 3: os dois fios novos do sensor (RST e INT) estão no sítio, e a placa consegue
// acordar o sensor pelo RST?
//
// Placa: ELEGOO "ESP32 DEVKIT V1 TYPEC" (30 pinos). Sensor: Adafruit BNO085 (ref. 4754), a 6 fios:
//   VIN -> 3V3     GND -> GND     SDA -> D21     SCL -> D22        (os quatro da bancada 1)
//   INT -> D19     RST -> D18                                      (os dois novos, ponto 12 do desenho)
// Os fios marcados nas fotos do Ivo: docs/caixas/bancada-ligacao-6-fios.jpg
//
// Este programa NÃO mexe no RST por sua conta, só a pedido. Assim pode gravar-se com o sensor bloqueado
// e ver primeiro em que estado ele está. Tal como o da bancada 1, só lê o sensor, e lê cada pacote até
// ao fim.
//
// De 2 em 2 segundos manda uma linha pelo USB (115 200 baud):
//   BANCADA3 t=12 rst=D18 int=D19 fio_rst=alto fio_int=alto nivel_int=1 puxa_sda=1 puxa_scl=1 i2c=4A sensor=sim pacote=276/0 lidos=290
//
//   fio_rst, fio_int   como está a linha desse pino, vista com as resistências internas da placa:
//                        alto   alguma coisa a segura em cima (o RST do sensor tem uma resistência
//                               a puxá-lo para cima; o INT em repouso está em cima)
//                        baixo  alguma coisa a segura em baixo (o INT com dados à espera de serem lidos)
//                        solto  nada ligado a esse pino (fio por ligar, ou no pino errado)
//   nivel_int          o que o pino do INT mostra neste instante (0 = o sensor diz que tem dados)
//   o resto            como na bancada 1 (programa "placa")
//
// Comandos pelo USB (uma linha cada):
//   r          toque no RST de 20 ms ("r 100" para outro tempo, em ms, até 2000) e 3 s de vigia: diz
//              quando o INT caiu e quando o sensor voltou a responder, e com que pacote (276/0 é a
//              apresentação de quem acabou de arrancar)
//   x          troca os papéis dos dois pinos (para o caso de os fios terem ficado trocados na placa)
//   ?          manda já a linha de estado
//
// Cuidados com o RST, porque o fio pode ter ficado no pino errado:
//   - só se puxa para baixo, nunca para cima (saída de dreno aberto): quem o leva para cima é a
//     resistência do sensor;
//   - antes do toque a sério faz-se um toque fraco de 0,3 ms e lê-se o pino: se não desceu, o fio está
//     ligado a corrente (não é o RST) e o programa recusa-se a continuar.
//
// Compilar, gravar e falar com ele (COMx é a porta que o Windows der à placa):
//   arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --build-path <pasta fora do projeto> fios6
//   arduino-cli upload  --fqbn esp32:esp32:esp32doit-devkit-v1 --input-dir <a mesma pasta> -p COMx fios6
//   python ../falar.py COMx 12 --baud=115200 3=r
#include <Wire.h>
#include "driver/gpio.h"

const int PINO_SDA = 21;
const int PINO_SCL = 22;
const int PINO_LED = 2;                 // a luz azul da placa, se a tiver
const uint32_t VELOCIDADE_I2C = 100000;
const uint32_t PERIODO_MS = 2000;
const uint32_t VIGIA_MS = 3000;         // quanto tempo se fica a olhar depois de soltar o RST
const uint32_t PRIMEIRA_LEITURA_MS = 150;  // sem o INT a avisar, só se pergunta ao sensor passado isto
const uint8_t ENDERECOS[] = {0x4A, 0x4B};
const size_t MAIOR_LEITURA = 128;       // o que cabe de uma vez no barramento desta placa
const int MAX_MUDANCAS = 24;

static int pinoRst = 18;                // D18
static int pinoInt = 19;                // D19
static bool puxaSda = false, puxaScl = false, barramento = false;
static uint8_t endereco = 0;            // 0: o sensor ainda não respondeu
static String primeiro = "-";
static uint32_t lidos = 0;
static uint32_t proximaLinha = 0;
static String comando = "";

// Com a resistência interna a puxar para baixo, a linha só fica alta se o sensor a puxar para cima.
// Só se faz com o barramento parado: mexer no modo dos pinos a meio de uma conversa estragava-a.
static bool linhaPuxada(int pino) {
  pinMode(pino, INPUT_PULLDOWN);
  delay(2);
  const bool alta = digitalRead(pino) == HIGH;
  pinMode(pino, INPUT);
  return alta;
}

// Como está a linha de um pino: lê-a com a resistência interna a puxar para baixo e depois para cima.
// Se dá o mesmo das duas vezes, alguma coisa a segura; se acompanha a resistência, está solta.
// Só mexe nas resistências internas (uns 45 kΩ), não faz força nenhuma na linha.
static const char *estadoLinha(int pino, bool deixaPuxadaParaCima) {
  gpio_set_pull_mode((gpio_num_t)pino, GPIO_PULLDOWN_ONLY);
  delay(2);
  const bool comBaixo = digitalRead(pino) == HIGH;
  gpio_set_pull_mode((gpio_num_t)pino, GPIO_PULLUP_ONLY);
  delay(2);
  const bool comCima = digitalRead(pino) == HIGH;
  gpio_set_pull_mode((gpio_num_t)pino, deixaPuxadaParaCima ? GPIO_PULLUP_ONLY : GPIO_FLOATING);
  if (comBaixo && comCima) return "alto";
  if (!comBaixo && !comCima) return "baixo";
  if (!comBaixo && comCima) return "solto";
  return "incerto";
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

// Abre o barramento quando as duas linhas estiverem puxadas para cima (uma vez só).
static void abreBarramento() {
  if (barramento) return;
  puxaSda = linhaPuxada(PINO_SDA);
  puxaScl = linhaPuxada(PINO_SCL);
  if (puxaSda && puxaScl) barramento = Wire.begin(PINO_SDA, PINO_SCL, VELOCIDADE_I2C);
}

// Pergunta ao sensor, no endereço que já se conhece ou nos dois possíveis.
static bool sensorResponde() {
  if (!barramento) return false;
  if (endereco) return esvazia(endereco);
  for (uint8_t e : ENDERECOS) {
    if (esvazia(e)) {
      endereco = e;
      return true;
    }
  }
  return false;
}

static void linhaDeEstado() {
  abreBarramento();
  const char *fioRst = estadoLinha(pinoRst, false);
  const char *fioInt = estadoLinha(pinoInt, true);
  const int nivelInt = digitalRead(pinoInt);
  const bool responde = sensorResponde();

  digitalWrite(PINO_LED, responde ? HIGH : !digitalRead(PINO_LED));

  Serial.print("BANCADA3 t=");
  Serial.print(millis() / 1000);
  Serial.print(" rst=D");
  Serial.print(pinoRst);
  Serial.print(" int=D");
  Serial.print(pinoInt);
  Serial.print(" fio_rst=");
  Serial.print(fioRst);
  Serial.print(" fio_int=");
  Serial.print(fioInt);
  Serial.print(" nivel_int=");
  Serial.print(nivelInt);
  Serial.print(" puxa_sda=");
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
}

// O toque no RST, com os cuidados do cabeçalho, e a vigia do que acontece a seguir.
static void toqueNoRst(uint32_t ms) {
  abreBarramento();
  const char *antes = estadoLinha(pinoRst, false);
  const char *fioInt = estadoLinha(pinoInt, true);
  const int intAntes = digitalRead(pinoInt);
  const bool respondiaAntes = sensorResponde();
  Serial.print("BANCADA3 toque pedido_ms=");
  Serial.print(ms);
  Serial.print(" rst=D");
  Serial.print(pinoRst);
  Serial.print(" fio_rst=");
  Serial.print(antes);
  Serial.print(" fio_int=");
  Serial.print(fioInt);
  Serial.print(" nivel_int=");
  Serial.print(intAntes);
  Serial.print(" sensor_antes=");
  Serial.println(respondiaAntes ? "sim" : "nao");
  if (String(antes) != "alto") {
    Serial.println("BANCADA3 toque RECUSADO: a linha do RST nao esta puxada para cima (fio solto ou noutro pino)");
    return;
  }

  // Toque fraco: com a saída no mínimo de força, a linha tem de descer. Se não descer, está ligada a
  // corrente e não ao RST.
  gpio_set_drive_capability((gpio_num_t)pinoRst, GPIO_DRIVE_CAP_0);
  pinMode(pinoRst, OUTPUT_OPEN_DRAIN);
  digitalWrite(pinoRst, LOW);
  delayMicroseconds(300);
  const bool desceu = digitalRead(pinoRst) == LOW;
  if (!desceu) {
    pinMode(pinoRst, INPUT);
    Serial.println("BANCADA3 toque RECUSADO: o pino nao desce (esta ligado a corrente, nao ao RST)");
    return;
  }
  delay(ms);
  pinMode(pinoRst, INPUT);  // solta: a resistência do sensor leva a linha para cima
  const uint32_t solto = millis();

  // Vigia: quando cai o INT e quando o sensor volta a responder. Sem o INT a avisar, só se lhe
  // pergunta passados 150 ms, e depois de 50 em 50 ms.
  int32_t intCaiu = -1, respondeu = -1;
  uint32_t mudancaMs[MAX_MUDANCAS];
  uint8_t mudancaNivel[MAX_MUDANCAS];
  int mudancas = 0;
  int nivel = digitalRead(pinoInt);
  uint32_t proximaLeitura = PRIMEIRA_LEITURA_MS;
  const String primeiroDeAntes = primeiro;
  primeiro = "-";
  while (millis() - solto < VIGIA_MS) {
    const uint32_t dt = millis() - solto;
    const int agora = digitalRead(pinoInt);
    if (agora != nivel) {
      nivel = agora;
      if (mudancas < MAX_MUDANCAS) {
        mudancaMs[mudancas] = dt;
        mudancaNivel[mudancas] = agora;
        mudancas++;
      }
      if (agora == LOW && intCaiu < 0) intCaiu = dt;
    }
    if (respondeu < 0 && ((agora == LOW && dt >= 5) || dt >= proximaLeitura)) {
      proximaLeitura = dt + 50;
      endereco = 0;  // pode ter mudado de endereço: procura-se outra vez
      if (sensorResponde()) respondeu = millis() - solto;
    }
    if (respondeu >= 0 && millis() - solto - respondeu > 300) break;  // mais 0,3 s a ver o INT, e chega
    delayMicroseconds(200);
  }
  const String pacote = primeiro;
  if (respondeu < 0) primeiro = primeiroDeAntes;

  Serial.print("BANCADA3 toque feito_ms=");
  Serial.print(ms);
  Serial.print(" rst_voltou_acima=");
  Serial.print(digitalRead(pinoRst));
  Serial.print(" int_caiu_ms=");
  Serial.print(intCaiu < 0 ? String("-") : String(intCaiu));
  Serial.print(" respondeu_ms=");
  Serial.print(respondeu < 0 ? String("-") : String(respondeu));
  Serial.print(" pacote=");
  Serial.print(pacote);
  Serial.print(" int:");
  for (int i = 0; i < mudancas; i++) {
    Serial.print(" ");
    Serial.print(mudancaNivel[i]);
    Serial.print("@");
    Serial.print(mudancaMs[i]);
  }
  if (!mudancas) Serial.print(" sem-mudancas");
  Serial.println();
}

static void obedece(String c) {
  c.trim();
  if (c == "?") {
    linhaDeEstado();
  } else if (c == "x") {
    const int t = pinoRst;
    pinoRst = pinoInt;
    pinoInt = t;
    pinMode(pinoRst, INPUT);
    pinMode(pinoInt, INPUT_PULLUP);
    Serial.print("BANCADA3 papeis trocados: rst=D");
    Serial.print(pinoRst);
    Serial.print(" int=D");
    Serial.println(pinoInt);
  } else if (c.startsWith("r")) {
    long ms = c.substring(1).toInt();
    if (ms <= 0) ms = 20;
    if (ms > 2000) ms = 2000;
    toqueNoRst((uint32_t)ms);
  } else if (c.length()) {
    Serial.print("BANCADA3 comando desconhecido: ");
    Serial.println(c);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_LED, OUTPUT);
  pinMode(pinoRst, INPUT);         // solto: não se toca no RST sem ordem
  pinMode(pinoInt, INPUT_PULLUP);
  delay(300);
  Serial.println();
  Serial.println("BANCADA3 arranque");
}

void loop() {
  while (Serial.available()) {
    const char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (comando.length()) obedece(comando);
      comando = "";
    } else if (comando.length() < 16) {
      comando += ch;
    }
  }
  if ((int32_t)(millis() - proximaLinha) >= 0) {
    proximaLinha = millis() + PERIODO_MS;
    linhaDeEstado();
  }
  delay(5);
}
