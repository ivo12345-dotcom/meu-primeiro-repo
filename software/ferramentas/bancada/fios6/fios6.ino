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
//   b          prova do programa de arranque do sensor. Só para diagnóstico, e com o fio do D19 mudado,
//              no sensor, do INT para o BT: segura o BT em baixo, dá o toque no RST e procura quem
//              responde no barramento (o programa de arranque responde no endereço 28, ou 29; o programa
//              normal no 4A ou 4B). No fim solta o BT e dá outro toque no RST, para o sensor voltar ao
//              arranque normal. Se o 28 responder, o sensor está vivo e é o programa normal dele que não
//              arranca; se nada responder, não há vida nenhuma lá dentro.
//   v          mede tensões com a própria placa (medidor dela, de 0,15 a uns 3,1 V; acima disso marca
//              o teto): a dos 3,3 V da placa (num pino livre, pela resistência interna) e a do pino D4,
//              para onde se leva um fio do ponto a medir (por exemplo o 3Vo do sensor). Do D4 tira
//              milhares de leituras seguidas e diz a mais baixa, a média e a mais alta, para apanhar
//              quedas curtas. "v r" faz o mesmo com um toque no RST a meio.
//   i          confere o lado da placa: os pinos D21 e D22 conseguem puxar a linha para baixo? Depois
//              faz à mão, sem o circuito de barramento do chip, o princípio de uma conversa com os
//              endereços 4A, 4B, 28 e 29, e diz se alguém responde
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

// Puxa um pino para baixo com os cuidados do RST: primeiro um toque fraco, e só continua se a linha
// descer. Devolve false (e solta o pino) se não desceu.
static bool puxaParaBaixo(int pino) {
  gpio_set_drive_capability((gpio_num_t)pino, GPIO_DRIVE_CAP_0);
  pinMode(pino, OUTPUT_OPEN_DRAIN);
  digitalWrite(pino, LOW);
  delayMicroseconds(300);
  if (digitalRead(pino) == LOW) return true;
  pinMode(pino, INPUT);
  return false;
}

// Quem responde no barramento, de 08 a 77? Lê 1 byte a cada endereço. Só se usa com o sensor calado ou
// no programa de arranque: ao programa normal a trabalhar, ler 1 byte deixava-o a meio de uma frase.
static String quemResponde() {
  String achados = "";
  for (uint8_t a = 0x08; a <= 0x77; a++) {
    if (Wire.requestFrom((int)a, 1) == 1) {
      achados += " ";
      achados += doisHex(a);
      while (Wire.available()) Wire.read();
    }
  }
  return achados.length() ? achados : String(" ninguem");
}

// A prova do programa de arranque (comando "b"). O fio do pino do INT tem de estar, no sensor, no BT.
static void provaDoArranque() {
  abreBarramento();
  const int pinoBt = pinoInt;
  const char *fioBt = estadoLinha(pinoBt, true);
  const char *fioRst = estadoLinha(pinoRst, false);
  Serial.print("BANCADA3 arranque bt=D");
  Serial.print(pinoBt);
  Serial.print(" fio_bt=");
  Serial.print(fioBt);
  Serial.print(" rst=D");
  Serial.print(pinoRst);
  Serial.print(" fio_rst=");
  Serial.print(fioRst);
  Serial.print(" barramento=");
  Serial.println(barramento ? "aberto" : "fechado");
  if (!barramento) {
    Serial.println("BANCADA3 arranque RECUSADO: as linhas do barramento nao estao puxadas para cima");
    return;
  }
  if (String(fioRst) != "alto") {
    Serial.println("BANCADA3 arranque RECUSADO: a linha do RST nao esta puxada para cima");
    return;
  }
  Serial.print("BANCADA3 arranque antes:");
  Serial.println(quemResponde());

  if (!puxaParaBaixo(pinoBt)) {
    Serial.println("BANCADA3 arranque RECUSADO: o pino do BT nao desce (esta ligado a corrente)");
    return;
  }
  if (!puxaParaBaixo(pinoRst)) {
    pinMode(pinoBt, INPUT_PULLUP);
    Serial.println("BANCADA3 arranque RECUSADO: o pino do RST nao desce (esta ligado a corrente)");
    return;
  }
  delay(50);
  pinMode(pinoRst, INPUT);  // solta o RST com o BT ainda em baixo: é agora que o sensor olha para o BT
  for (int espera : {100, 400, 1500}) {
    delay(espera);
    Serial.print("BANCADA3 arranque com_bt_em_baixo bt=");
    Serial.print(digitalRead(pinoBt));
    Serial.print(" rst=");
    Serial.print(digitalRead(pinoRst));
    Serial.print(" respondem:");
    Serial.println(quemResponde());
  }

  // De volta ao arranque normal: BT solto (a resistência do sensor leva-o para cima) e novo toque no RST.
  pinMode(pinoBt, INPUT_PULLUP);
  delay(20);
  if (puxaParaBaixo(pinoRst)) {
    delay(50);
    pinMode(pinoRst, INPUT);
  }
  delay(1000);
  Serial.print("BANCADA3 arranque depois bt=");
  Serial.print(digitalRead(pinoBt));
  Serial.print(" respondem:");
  Serial.println(quemResponde());
  endereco = 0;
}

// Medição de tensões com o medidor da própria placa (comando "v").
const int PINO_MEDIDA = 4;              // D4: para onde vai o fio do ponto a medir
const int PINO_LIVRE = 33;              // D33: livre; serve para medir os 3,3 V da placa
const int LEITURAS = 12000;

// Um pino livre visto pelo medidor com a resistência interna para cima (true) ou para baixo (false).
// A primeira leitura prepara o pino para o medidor e tira-lhe as resistências; por isso a resistência
// põe-se depois dela.
static uint32_t pinoLivreCom(bool paraCima) {
  analogReadMilliVolts(PINO_LIVRE);
  gpio_set_pull_mode((gpio_num_t)PINO_LIVRE, paraCima ? GPIO_PULLUP_ONLY : GPIO_PULLDOWN_ONLY);
  delay(10);
  uint32_t soma = 0;
  for (int i = 0; i < 64; i++) soma += analogReadMilliVolts(PINO_LIVRE);
  gpio_set_pull_mode((gpio_num_t)PINO_LIVRE, GPIO_FLOATING);
  return soma / 64;
}

// O D4 visto com a resistência interna da placa (uns 45 kΩ) para cima ou para baixo. Diz que tipo de
// ponto está do outro lado do fio:
//   para baixo e continua no teto        ponto com corrente a sério (o 3Vo, por exemplo)
//   para baixo e desce                   ponto só puxado para cima por uma resistência, ou fio solto
//   para cima e fica perto de 0,6 V      ponto puxado para baixo por 10 kΩ com a massa boa (cada 0,1 V
//                                        a mais na massa do sensor soma uns 0,08 V)
//   para cima e vai ao teto              fio solto
static uint32_t d4Com(gpio_pull_mode_t resistencia) {
  analogReadMilliVolts(PINO_MEDIDA);
  gpio_set_pull_mode((gpio_num_t)PINO_MEDIDA, resistencia);
  delay(10);
  uint32_t soma = 0;
  for (int i = 0; i < 64; i++) soma += analogReadMilliVolts(PINO_MEDIDA);
  gpio_set_pull_mode((gpio_num_t)PINO_MEDIDA, GPIO_FLOATING);
  delay(5);
  return soma / 64;
}

// Milhares de leituras seguidas do D4. Com toque = true dá um toque de 20 ms no RST ao fim de um
// terço das leituras, para ver o que a tensão faz quando o sensor tenta arrancar.
static void medeTensoes(bool toque) {
  const uint32_t d4ParaCima = d4Com(GPIO_PULLUP_ONLY);
  const uint32_t d4ParaBaixo = d4Com(GPIO_PULLDOWN_ONLY);
  // Os 3,3 V da placa: o pino livre puxado para cima. Puxado para baixo tem de dar quase zero; se não
  // der, a medida não é de fiar.
  const uint32_t placa = pinoLivreCom(true);
  const uint32_t zero = pinoLivreCom(false);
  uint32_t minimo = 99999, maximo = 0, abaixo2800 = 0, abaixo2400 = 0;
  uint64_t soma = 0;
  uint32_t minDepois = 99999;
  bool tocou = false;
  const uint32_t inicio = micros();
  for (int i = 0; i < LEITURAS; i++) {
    if (toque && !tocou && i == LEITURAS / 3) {
      tocou = true;
      if (puxaParaBaixo(pinoRst)) {
        delay(20);
        pinMode(pinoRst, INPUT);
      }
    }
    const uint32_t mv = analogReadMilliVolts(PINO_MEDIDA);
    soma += mv;
    if (mv < minimo) minimo = mv;
    if (mv > maximo) maximo = mv;
    if (mv < 2800) abaixo2800++;
    if (mv < 2400) abaixo2400++;
    if (tocou && mv < minDepois) minDepois = mv;
  }
  const uint32_t durou = (micros() - inicio) / 1000;
  Serial.print("BANCADA3 tensoes placa_3v3_mV=");
  Serial.print(placa);
  Serial.print(" zero_mV=");
  Serial.print(zero);
  Serial.print(" d4_com_cima_mV=");
  Serial.print(d4ParaCima);
  Serial.print(" d4_com_baixo_mV=");
  Serial.print(d4ParaBaixo);
  Serial.print(" d4_min_mV=");
  Serial.print(minimo);
  Serial.print(" d4_media_mV=");
  Serial.print((uint32_t)(soma / LEITURAS));
  Serial.print(" d4_max_mV=");
  Serial.print(maximo);
  Serial.print(" leituras=");
  Serial.print(LEITURAS);
  Serial.print(" em_ms=");
  Serial.print(durou);
  Serial.print(" abaixo_2800=");
  Serial.print(abaixo2800);
  Serial.print(" abaixo_2400=");
  Serial.print(abaixo2400);
  if (toque) {
    Serial.print(" min_depois_do_toque_mV=");
    Serial.print(minDepois);
  }
  Serial.println();
}

// O barramento à mão (comando "i"): confere o lado da PLACA. Até aqui só estava provado que os pinos
// D21 e D22 leem; falta ver se também conseguem puxar a linha para baixo, que é como a placa fala.
// Depois faz ela própria, pino a pino e devagar (uns 5 kHz), o princípio de uma conversa com cada
// endereço possível do sensor, sem passar pelo circuito de barramento do chip nem pela biblioteca.
static const uint32_t MEIO_BIT_US = 100;

static void solta(int pino) { digitalWrite(pino, HIGH); }   // dreno aberto: "alto" é largar a linha
static void baixa(int pino) { digitalWrite(pino, LOW); }

// Larga o relógio e espera que suba (o sensor pode segurá-lo um instante). false se não subir em 5 ms.
static bool relogioSobe() {
  solta(PINO_SCL);
  const uint32_t t0 = micros();
  while (digitalRead(PINO_SCL) == LOW) {
    if (micros() - t0 > 5000) return false;
  }
  delayMicroseconds(MEIO_BIT_US);
  return true;
}

static bool mandaByte(uint8_t b, bool *respondeu) {
  for (int i = 7; i >= 0; i--) {
    if (b & (1 << i)) solta(PINO_SDA); else baixa(PINO_SDA);
    delayMicroseconds(MEIO_BIT_US);
    if (!relogioSobe()) return false;
    baixa(PINO_SCL);
  }
  solta(PINO_SDA);  // o nono bit é do sensor: puxa os dados para baixo se lá estiver
  delayMicroseconds(MEIO_BIT_US);
  if (!relogioSobe()) return false;
  *respondeu = digitalRead(PINO_SDA) == LOW;
  baixa(PINO_SCL);
  return true;
}

static bool leByte(uint8_t *b, bool ultimo) {
  uint8_t v = 0;
  solta(PINO_SDA);
  for (int i = 7; i >= 0; i--) {
    delayMicroseconds(MEIO_BIT_US);
    if (!relogioSobe()) return false;
    if (digitalRead(PINO_SDA) == HIGH) v |= (1 << i);
    baixa(PINO_SCL);
  }
  if (ultimo) solta(PINO_SDA); else baixa(PINO_SDA);  // confirma todos menos o último
  delayMicroseconds(MEIO_BIT_US);
  if (!relogioSobe()) return false;
  baixa(PINO_SCL);
  solta(PINO_SDA);
  *b = v;
  return true;
}

static void fimDeConversa() {
  baixa(PINO_SDA);
  delayMicroseconds(MEIO_BIT_US);
  solta(PINO_SCL);
  delayMicroseconds(MEIO_BIT_US);
  solta(PINO_SDA);
  delayMicroseconds(MEIO_BIT_US);
}

static void barramentoAMao() {
  if (barramento) {
    Wire.end();
    barramento = false;
  }
  pinMode(PINO_SDA, INPUT);
  pinMode(PINO_SCL, INPUT);
  delay(2);
  const int sdaAntes = digitalRead(PINO_SDA), sclAntes = digitalRead(PINO_SCL);

  // 1. Cada pino consegue puxar a sua linha para baixo, e a linha volta a subir quando ele a larga?
  const bool sdaDesce = puxaParaBaixo(PINO_SDA);
  pinMode(PINO_SDA, INPUT);
  delay(1);
  const bool sdaSobe = digitalRead(PINO_SDA) == HIGH;
  const bool sclDesce = puxaParaBaixo(PINO_SCL);
  pinMode(PINO_SCL, INPUT);
  delay(1);
  const bool sclSobe = digitalRead(PINO_SCL) == HIGH;
  Serial.print("BANCADA3 amao sda_antes=");
  Serial.print(sdaAntes);
  Serial.print(" scl_antes=");
  Serial.print(sclAntes);
  Serial.print(" sda_desce=");
  Serial.print(sdaDesce);
  Serial.print(" sda_sobe=");
  Serial.print(sdaSobe);
  Serial.print(" scl_desce=");
  Serial.print(sclDesce);
  Serial.print(" scl_sobe=");
  Serial.println(sclSobe);
  if (!(sdaDesce && sdaSobe && sclDesce && sclSobe)) {
    Serial.println("BANCADA3 amao PAROU: um dos dois pinos da placa nao mexe na linha como deve");
    return;
  }

  // 2. O princípio de uma conversa de leitura com cada endereço, feito à mão.
  gpio_set_drive_capability((gpio_num_t)PINO_SDA, GPIO_DRIVE_CAP_2);
  gpio_set_drive_capability((gpio_num_t)PINO_SCL, GPIO_DRIVE_CAP_2);
  digitalWrite(PINO_SDA, HIGH);
  digitalWrite(PINO_SCL, HIGH);
  pinMode(PINO_SDA, OUTPUT_OPEN_DRAIN);
  pinMode(PINO_SCL, OUTPUT_OPEN_DRAIN);
  solta(PINO_SDA);
  solta(PINO_SCL);
  delay(1);
  for (uint8_t e : {(uint8_t)0x4A, (uint8_t)0x4B, (uint8_t)0x28, (uint8_t)0x29}) {
    // início de conversa: os dados descem com o relógio em cima
    baixa(PINO_SDA);
    delayMicroseconds(MEIO_BIT_US);
    baixa(PINO_SCL);
    bool respondeu = false;
    const bool relogio = mandaByte((uint8_t)((e << 1) | 1), &respondeu);
    Serial.print("BANCADA3 amao endereco=");
    Serial.print(doisHex(e));
    Serial.print(" relogio=");
    Serial.print(relogio ? "ok" : "preso");
    Serial.print(" responde=");
    Serial.print(respondeu ? "sim" : "nao");
    if (relogio && respondeu) {
      // lê o cabeçalho de 4 bytes e fecha (o resto do pacote fica por ler: a seguir dá-se um toque no RST)
      Serial.print(" cabecalho=");
      for (int i = 0; i < 4; i++) {
        uint8_t b = 0;
        if (!leByte(&b, i == 3)) break;
        Serial.print(doisHex(b));
      }
    }
    Serial.println();
    fimDeConversa();
    delay(2);
  }
  pinMode(PINO_SDA, INPUT);
  pinMode(PINO_SCL, INPUT);
  endereco = 0;
}

static void obedece(String c) {
  c.trim();
  if (c == "?") {
    linhaDeEstado();
  } else if (c == "i") {
    barramentoAMao();
  } else if (c == "v") {
    medeTensoes(false);
  } else if (c == "v r") {
    medeTensoes(true);
  } else if (c == "b") {
    provaDoArranque();
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
