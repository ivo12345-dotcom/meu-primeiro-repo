// Ensaio de bancada 2: a ligação ao BNO085 aguenta o ritmo do desenho, horas a fio?
// (ponto em aberto 12 de docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md)
//
// Liga o sensor pelo cabo de 4 fios (I²C), pede-lhe a aceleração, a rotação e a atitude ao ritmo
// que se mandar, e conta o que pode correr mal: leituras que faltam (pelo número de ordem que o
// sensor põe em cada uma), buracos no tempo, erros nos fios, o tempo que cada conversa demora e
// as vezes que o sensor se reinicia ou se cala.
//
// Placa: ELEGOO "ESP32 DEVKIT V1 TYPEC". Fios: vermelho -> 3V3, preto -> GND, azul (SDA) -> D21,
// amarelo (SCL) -> D22. Bibliotecas: Adafruit BNO08x 1.2.7 (traz a SH-2 da CEVA), Adafruit BusIO
// e Adafruit Unified Sensor.
//
// Fala pelo USB a 921 600 baud. De segundo a segundo manda uma linha "E":
//   t        segundos desde o arranque
//   a g r    leituras recebidas nesse segundo: aceleração, rotação (giroscópio), atitude
//   pa pg pr leituras em falta, pelo salto no número de ordem
//   ia ig ir maior intervalo entre duas leituras seguidas, em microssegundos
//   lei fl   conversas de leitura com o sensor, e quantas falharam
//   esc fe   conversas de escrita, e quantas falharam
//   dmax     a conversa mais demorada, em microssegundos (50 000 = desistiu de esperar)
//   rein sil vezes que o sensor se reiniciou / se calou mais de 2 s (desde o último "c" ou "z")
//   ax ay az média da aceleração (m/s2); sx sy sz o desvio-padrão (o ruído, com o sensor parado)
//   gx gy gz média da rotação (rad/s)
//   rol cai gui  inclinações e guinada tiradas da atitude, em graus
//   ea er    confiança que o sensor dá à aceleração e à atitude (0 a 3); prec, erro estimado (graus)
//   voltas   voltas do ciclo principal nesse segundo
//
// Comandos (uma linha cada):
//   c <barramento Hz> <aceleração/s> <rotação/s> <atitude/s>   muda o ritmo e põe os totais a zero
//   d 0|1    desliga/liga o despejo de todas as leituras (linhas A, G e R), para análise no portátil
//   t        mostra os totais (linha "T") desde o último "c" ou "z"
//   z        põe os totais a zero
//   n        pede ao sensor os contadores dele (linhas "N")
//   x        refaz a ligação ao sensor
//   e <ms>   tempo que a placa espera pelo sensor em cada conversa (50 é o costume)
//
// Ao arrancar fica 1,5 s à escuta antes de abrir a ligação (cada comando recebido estica mais 1,5 s;
// um "g" acaba a escuta). Se a ligação não abrir, mostra as conversas uma a uma (linhas "S passo=")
// e a placa recomeça. Só nessa escuta, para estudar o sensor quando ele não colabora:
//   r        manda-lhe só a ordem de recomeçar e mostra o que ele diz a seguir
//   w <ms> <hex>   escreve-lhe um pacote, espera e lê tudo o que ele tiver ("W": sem ler)
//   k        obriga-o a recomeçar com uma escrita mal formada (recurso de bancada, ver o ponto 12)
//   a 0|1    a seguir à ordem de recomeçar, pede-lhe também a apresentação
//   f <us>   folga mínima entre o fim de uma escrita e a conversa seguinte
//
// O que a bancada de 22/11/2026 ensinou está no ponto 12 do desenho: o sensor guarda o estado
// enquanto tiver corrente, mesmo que a placa recomece, e pode ficar num estado em que ignora ordens.
//
// Compilar e gravar (COMx é a porta que o Windows der à placa):
//   arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --build-path <pasta fora do projeto> bno085
//   arduino-cli upload  --fqbn esp32:esp32:esp32doit-devkit-v1 --input-dir <a mesma pasta> -p COMx bno085
// Correr o ensaio a partir do portátil: python ensaio.py (na pasta acima).
#include <Adafruit_BNO08x.h>
#include <Wire.h>

const int PINO_SDA = 21;
const int PINO_SCL = 22;
const uint8_t ENDERECO = 0x4A;
const uint32_t SILENCIO_US = 2000000;

// O barramento, com contadores: cada conversa com o sensor passa por aqui.
class FioContado : public TwoWire {
public:
  explicit FioContado(uint8_t barramento) : TwoWire(barramento) {}

  uint32_t leituras = 0, falhasLeitura = 0, escritas = 0, falhasEscrita = 0, duracaoMax = 0;

  // O traço: as primeiras conversas, uma a uma, para se ver onde a ligação se estraga.
  struct Passo {
    char tipo;                // 'L' leitura, 'E' escrita
    uint16_t pedidos, feitos; // bytes pedidos e lidos; na escrita, bytes mandados e o código de erro
    uint32_t us;
    uint8_t bytes[20];        // os primeiros vinte
  };
  static const size_t TRACO = 48;
  Passo traco[TRACO];
  size_t passos = 0;
  bool tracar = false;

  // A folga: o tempo mínimo entre o fim de uma escrita e a conversa seguinte. O sensor precisa de
  // um instante para tratar o que lhe mandaram; esta placa é rápida de mais e fala-lhe logo a seguir.
  uint32_t folgaUs = 0;

  // A biblioteca abre a conversa a mandar o sensor recomeçar e fica à espera de que ele se apresente.
  // Visto na bancada (22/11/2026): num estado anormal o sensor responde a pedidos mas não obedece a
  // essa ordem, e sem recomeçar não se apresenta. Com isto ligado (comando "a 1"), a seguir à ordem
  // pede-se-lhe a apresentação por extenso: serve para o estudar nesse estado, não para trabalhar.
  bool pedeApresentacao = false;
  uint32_t apresentacoesPedidas = 0;

  size_t requestFrom(uint8_t endereco, size_t n, bool parar) override {
    daFolga();
    const uint32_t t0 = micros();
    const size_t lidos = TwoWire::requestFrom(endereco, n, parar);
    const uint32_t duracao = micros() - t0;
    anota(duracao);
    leituras++;
    if (lidos != n) falhasLeitura++;
    if (tracar && passos < TRACO) {
      Passo &p = traco[passos++];
      p.tipo = 'L';
      p.pedidos = n;
      p.feitos = lidos;
      p.us = duracao;
      for (size_t i = 0; i < sizeof(p.bytes); i++) p.bytes[i] = (rxBuffer && i < rxLength) ? rxBuffer[i] : 0;
    }
    return lidos;
  }

  uint8_t endTransmission(bool parar) override {
    Passo p = {'E', (uint16_t)txLength, 0, 0, {0}};
    for (size_t i = 0; i < sizeof(p.bytes); i++) p.bytes[i] = (txBuffer && i < txLength) ? txBuffer[i] : 0;
    const uint16_t destino = txAddress;
    // a ordem de recomeçar: 5 bytes, para o canal 1, com a carga 1
    const bool recomecar = txLength == 5 && p.bytes[0] == 5 && p.bytes[1] == 0 && p.bytes[2] == 1 && p.bytes[4] == 1;
    daFolga();
    const uint32_t t0 = micros();
    const uint8_t erro = TwoWire::endTransmission(parar);
    fimEscrita = micros();
    houveEscrita = true;
    p.us = fimEscrita - t0;
    p.feitos = erro;
    anota(p.us);
    escritas++;
    if (erro != 0) falhasEscrita++;
    if (tracar && passos < TRACO) traco[passos++] = p;
    if (recomecar && pedeApresentacao && erro == 0) {
      static const uint8_t APRESENTA_TE[] = {6, 0, 0, 0, 0, 1};  // canal 0, pedido 0 (apresentação), tudo
      apresentacoesPedidas++;
      TwoWire::beginTransmission(destino);
      TwoWire::write(APRESENTA_TE, sizeof(APRESENTA_TE));
      endTransmission(true);  // por aqui outra vez, para ficar contada e no traço
    }
    return erro;
  }

private:
  uint32_t fimEscrita = 0;
  bool houveEscrita = false;

  void daFolga() {
    if (!houveEscrita || !folgaUs) return;
    const uint32_t passou = micros() - fimEscrita;
    if (passou < folgaUs) delayMicroseconds(folgaUs - passou);
  }

  void anota(uint32_t duracao) {
    if (duracao > duracaoMax) duracaoMax = duracao;
  }
};

struct Conta {  // o que se junta num período (um segundo, ou desde o último "c")
  uint32_t n = 0, perdidas = 0, repetidas = 0, intervaloMax = 0;
  double soma[3] = {0, 0, 0}, soma2[3] = {0, 0, 0};
};

struct Canal {  // um tipo de leitura: aceleração, rotação ou atitude
  Conta seg, tot;
  uint8_t ordem = 0, estado = 0;
  uint32_t tUltima = 0;   // hora da última leitura, pelo relógio do sensor
  uint32_t tChegada = 0;  // hora a que chegou à placa
  bool visto = false;
};

struct Ritmo {
  uint32_t barramento = 400000, acel = 100, giro = 100, rot = 100;
  uint32_t espera = 50;  // ms que a placa espera pelo sensor em cada conversa (50 é o costume)
};

static FioContado fio(0);
static Adafruit_BNO08x bno(-1);
static Ritmo ritmo;
static Canal acel, giro, rot;
static float quat[4] = {0, 0, 0, 1};  // i, j, k, real
static float precisaoRot = 0;
static bool ligado = false, despejo = false;
static bool aberta = false;  // a biblioteca tem uma conversa aberta com o sensor
static bool avanca = false;  // chegou um "g": acabou a escuta do arranque
static uint32_t comandos = 0;
static uint32_t tLeitura = 0, tSegundo = 0, tTotais = 0, voltas = 0, tentativas = 0;
static uint32_t reinicios = 0, silencios = 0, silenciosSeguidos = 0, errosDescodificar = 0;
static uint32_t fioLeituras = 0, fioFalhasLeitura = 0, fioEscritas = 0, fioFalhasEscrita = 0, fioDuracaoMax = 0;
static char linha[96];
static size_t linhaN = 0;

static void anotaLeitura(Canal &c, char letra, const sh2_SensorValue_t &v, uint32_t t, float x, float y, float z) {
  if (c.visto) {
    const uint8_t salto = (uint8_t)(v.sequence - c.ordem);
    if (salto == 0) {
      c.seg.repetidas++;
      c.tot.repetidas++;
    } else {
      c.seg.perdidas += salto - 1;
      c.tot.perdidas += salto - 1;
    }
    const uint32_t intervalo = t - c.tUltima;
    if ((int32_t)intervalo > 0) {
      if (intervalo > c.seg.intervaloMax) c.seg.intervaloMax = intervalo;
      if (intervalo > c.tot.intervaloMax) c.tot.intervaloMax = intervalo;
    }
  }
  c.visto = true;
  c.ordem = v.sequence;
  c.tUltima = t;
  c.tChegada = tLeitura;
  c.estado = v.status & 0x03;
  const float xyz[3] = {x, y, z};
  for (int i = 0; i < 3; i++) {
    c.seg.soma[i] += xyz[i];
    c.seg.soma2[i] += (double)xyz[i] * xyz[i];
  }
  c.seg.n++;
  c.tot.n++;
  if (despejo) Serial.printf("%c %lu %.4f %.4f %.4f\n", letra, (unsigned long)t, x, y, z);
}

// Chamada pela biblioteca por cada leitura que vem num pacote (um pacote pode trazer várias).
static void aoReceber(void *, sh2_SensorEvent_t *evento) {
  sh2_SensorValue_t v;
  if (sh2_decodeSensorEvent(&v, evento) != SH2_OK) {
    errosDescodificar++;
    return;
  }
  // Nesta biblioteca a hora de cada leitura vem como um atraso (negativo) em relação à conversa.
  const uint32_t t = tLeitura + (uint32_t)evento->timestamp_uS;
  switch (v.sensorId) {
    case SH2_ACCELEROMETER:
      anotaLeitura(acel, 'A', v, t, v.un.accelerometer.x, v.un.accelerometer.y, v.un.accelerometer.z);
      break;
    case SH2_GYROSCOPE_CALIBRATED:
      anotaLeitura(giro, 'G', v, t, v.un.gyroscope.x, v.un.gyroscope.y, v.un.gyroscope.z);
      break;
    case SH2_ROTATION_VECTOR:
      quat[0] = v.un.rotationVector.i;
      quat[1] = v.un.rotationVector.j;
      quat[2] = v.un.rotationVector.k;
      quat[3] = v.un.rotationVector.real;
      precisaoRot = v.un.rotationVector.accuracy;
      anotaLeitura(rot, 'R', v, t, quat[0], quat[1], quat[2]);
      break;
    default:
      break;
  }
}

static uint32_t intervaloReal(sh2_SensorId_t id) {
  sh2_SensorConfig_t c;
  return sh2_getSensorConfig(id, &c) == SH2_OK ? c.reportInterval_us : 0;
}

static bool pede(sh2_SensorId_t id, uint32_t porSegundo) {
  return bno.enableReport(id, porSegundo ? 1000000UL / porSegundo : 0);
}

static void esqueceOrdem() {
  acel.visto = giro.visto = rot.visto = false;
}

static void zeraTotais() {
  acel.tot = Conta();
  giro.tot = Conta();
  rot.tot = Conta();
  fioLeituras = fioFalhasLeitura = fioEscritas = fioFalhasEscrita = fioDuracaoMax = 0;
  reinicios = silencios = errosDescodificar = 0;
  tTotais = millis();
}

// Pede ao sensor as três leituras ao ritmo escolhido e diz o que o sensor aceitou de facto.
static void ativaLeituras(bool anuncia) {
  fio.setClock(ritmo.barramento);
  const bool okA = pede(SH2_ACCELEROMETER, ritmo.acel);
  const bool okG = pede(SH2_GYROSCOPE_CALIBRATED, ritmo.giro);
  const bool okR = pede(SH2_ROTATION_VECTOR, ritmo.rot);
  esqueceOrdem();
  if (!anuncia) return;
  Serial.printf("C barramento=%lu pedido=%lu/%lu/%lu aceite=%d%d%d intervalo_us=%lu/%lu/%lu\n",
                (unsigned long)ritmo.barramento, (unsigned long)ritmo.acel, (unsigned long)ritmo.giro,
                (unsigned long)ritmo.rot, okA, okG, okR, (unsigned long)intervaloReal(SH2_ACCELEROMETER),
                (unsigned long)intervaloReal(SH2_GYROSCOPE_CALIBRATED), (unsigned long)intervaloReal(SH2_ROTATION_VECTOR));
}

static void mostraTraco() {
  for (size_t i = 0; i < fio.passos; i++) {
    const FioContado::Passo &p = fio.traco[i];
    Serial.printf("S passo=%u %c pedidos=%u feitos=%u us=%lu bytes=", (unsigned)i, p.tipo, p.pedidos, p.feitos,
                  (unsigned long)p.us);
    const size_t n = p.pedidos < sizeof(p.bytes) ? p.pedidos : sizeof(p.bytes);
    for (size_t k = 0; k < n; k++) Serial.printf("%02X%s", p.bytes[k], k + 1 < n ? "." : "");
    Serial.println();
  }
}

// Se a placa recomeçou a meio de uma conversa, o sensor pode ter ficado a segurar a linha dos dados à
// espera do resto dos impulsos do relógio, e a conversa seguinte falha. Dão-se-lhe os impulsos à mão
// (nove chegam para acabar qualquer byte) e fecha-se com uma paragem.
static void soltaBarramento() {
  pinMode(PINO_SDA, INPUT_PULLUP);
  pinMode(PINO_SCL, OUTPUT_OPEN_DRAIN);
  digitalWrite(PINO_SCL, HIGH);
  delayMicroseconds(10);
  for (int i = 0; i < 9 && digitalRead(PINO_SDA) == LOW; i++) {
    digitalWrite(PINO_SCL, LOW);
    delayMicroseconds(10);
    digitalWrite(PINO_SCL, HIGH);
    delayMicroseconds(10);
  }
  pinMode(PINO_SDA, OUTPUT_OPEN_DRAIN);
  digitalWrite(PINO_SDA, LOW);
  delayMicroseconds(10);
  digitalWrite(PINO_SDA, HIGH);  // a paragem: os dados sobem com o relógio em cima
  delayMicroseconds(10);
  pinMode(PINO_SDA, INPUT);
  pinMode(PINO_SCL, INPUT);
}

// Experiência, só com a ligação por abrir: escreve ao sensor um pacote à escolha, espera e lê tudo o
// que ele tiver para dizer, até ao fim de cada pacote (para não o deixar a meio de uma frase).
// Um sensor que recomeçou apresenta-se com um pacote de 276 bytes com o número de ordem 0.
static void experimenta(const uint8_t *pacote, size_t n, uint32_t esperaMs, bool le = true) {
  if (ligado) {
    Serial.println("! experiências: só antes de a ligação abrir");
    return;
  }
  fio.end();
  soltaBarramento();
  fio.begin(PINO_SDA, PINO_SCL, ritmo.barramento);
  fio.setTimeOut(ritmo.espera);
  fio.passos = 0;
  fio.tracar = true;
  if (n) {
    fio.beginTransmission(ENDERECO);
    fio.write(pacote, n);
    fio.endTransmission(true);
  }
  delay(esperaMs);
  for (int k = 0; le && k < 8; k++) {
    if (fio.requestFrom(ENDERECO, (size_t)4, true) != 4) break;
    uint8_t cabeca[4];
    for (int i = 0; i < 4; i++) cabeca[i] = fio.read();
    uint16_t resto = ((uint16_t)cabeca[0] | ((uint16_t)cabeca[1] << 8)) & 0x7FFF;
    if (resto <= 4) break;  // nada à espera
    resto -= 4;             // ficou lido o cabeçalho; falta a carga
    while (resto > 0) {
      const size_t m = resto + 4 > 128 ? 128 : resto + 4;  // cada leitura traz outra vez um cabeçalho
      if (fio.requestFrom(ENDERECO, m, true) != m) {
        resto = 0;
        break;
      }
      while (fio.available()) fio.read();
      resto -= m - 4;
    }
    delay(5);
  }
  fio.tracar = false;
  Serial.printf("S experiencia bytes=%u espera=%lu barramento=%lu folga=%lu\n", (unsigned)n, (unsigned long)esperaMs,
                (unsigned long)ritmo.barramento, (unsigned long)fio.folgaUs);
  mostraTraco();
}

static bool liga() {
  tentativas++;
  // A biblioteca só deixa abrir uma conversa nova depois de fechar a anterior.
  if (aberta) {
    sh2_close();
    aberta = false;
  }
  fio.end();
  soltaBarramento();
  fio.begin(PINO_SDA, PINO_SCL, ritmo.barramento);
  fio.setTimeOut(ritmo.espera);
  fio.passos = 0;
  fio.tracar = true;
  const uint32_t t0 = millis();
  const bool ok = bno.begin_I2C(ENDERECO, &fio);
  fio.tracar = false;
  if (!ok) {
    Serial.printf("S ligacao=falhou tentativa=%lu barramento=%lu espera=%lu ms=%lu lei=%lu fl=%lu esc=%lu fe=%lu dmax=%lu\n",
                  (unsigned long)tentativas, (unsigned long)ritmo.barramento, (unsigned long)ritmo.espera,
                  (unsigned long)(millis() - t0), (unsigned long)fio.leituras, (unsigned long)fio.falhasLeitura,
                  (unsigned long)fio.escritas, (unsigned long)fio.falhasEscrita, (unsigned long)fio.duracaoMax);
    mostraTraco();
    // Depois de uma abertura falhada a biblioteca fica presa (não se sabe se chegou a abrir, e fechar o que
    // não abriu rebenta): a única maneira limpa de tentar outra vez é a placa recomeçar.
    Serial.println("S reinicia");
    Serial.flush();
    delay(1500);
    ESP.restart();
    return false;
  }
  aberta = true;
  sh2_setSensorCallback(aoReceber, NULL);
  bno.wasReset();  // o reinício do arranque não conta
  const sh2_ProductId_t &p = bno.prodIds.entry[0];
  Serial.printf("S ligado tentativa=%lu ms=%lu barramento=%lu parte=%lu versao=%u.%u.%u compilacao=%lu\n",
                (unsigned long)tentativas, (unsigned long)(millis() - t0), (unsigned long)ritmo.barramento,
                (unsigned long)p.swPartNumber, p.swVersionMajor, p.swVersionMinor, p.swVersionPatch,
                (unsigned long)p.swBuildNumber);
  ativaLeituras(true);
  zeraTotais();
  tSegundo = millis();
  acel.tChegada = micros();
  return true;
}

static void mostraContadores(const char *nome, sh2_SensorId_t id) {
  sh2_Counts_t c;
  if (sh2_getCounts(id, &c) != SH2_OK) {
    Serial.printf("N %s erro\n", nome);
    return;
  }
  Serial.printf("N %s oferecidas=%lu aceites=%lu ligadas=%lu tentadas=%lu\n", nome, (unsigned long)c.offered,
                (unsigned long)c.accepted, (unsigned long)c.on, (unsigned long)c.attempted);
}

static void mostraTotais() {
  Serial.printf("T s=%lu a=%lu g=%lu r=%lu pa=%lu pg=%lu pr=%lu ra=%lu rg=%lu rr=%lu ia=%lu ig=%lu ir=%lu "
                "lei=%lu fl=%lu esc=%lu fe=%lu dmax=%lu rein=%lu sil=%lu dec=%lu\n",
                (unsigned long)((millis() - tTotais) / 1000), (unsigned long)acel.tot.n, (unsigned long)giro.tot.n,
                (unsigned long)rot.tot.n, (unsigned long)acel.tot.perdidas, (unsigned long)giro.tot.perdidas,
                (unsigned long)rot.tot.perdidas, (unsigned long)acel.tot.repetidas, (unsigned long)giro.tot.repetidas,
                (unsigned long)rot.tot.repetidas, (unsigned long)acel.tot.intervaloMax,
                (unsigned long)giro.tot.intervaloMax, (unsigned long)rot.tot.intervaloMax, (unsigned long)fioLeituras,
                (unsigned long)fioFalhasLeitura, (unsigned long)fioEscritas, (unsigned long)fioFalhasEscrita,
                (unsigned long)fioDuracaoMax, (unsigned long)reinicios, (unsigned long)silencios,
                (unsigned long)errosDescodificar);
}

static void executa(char *texto) {
  comandos++;
  switch (texto[0]) {
    case 'g':
      avanca = true;
      break;
    case 'c': {
      unsigned long b, a, g, r;
      if (sscanf(texto + 1, "%lu %lu %lu %lu", &b, &a, &g, &r) != 4 || b < 10000 || b > 1000000 || a > 1000 ||
          g > 1000 || r > 1000) {
        Serial.println("! comando c: c <barramento Hz> <aceleracao/s> <rotacao/s> <atitude/s>");
        return;
      }
      ritmo.barramento = b;
      ritmo.acel = a;
      ritmo.giro = g;
      ritmo.rot = r;
      if (ligado) {
        ativaLeituras(true);
        zeraTotais();
        acel.tChegada = micros();
      } else {
        Serial.printf("S ritmo barramento=%lu pedido=%lu/%lu/%lu\n", b, a, g, r);
      }
      break;
    }
    case 'f': {
      unsigned long us;
      if (sscanf(texto + 1, "%lu", &us) != 1 || us > 100000) {
        Serial.println("! comando f: f <folga depois de cada escrita, em microssegundos, 0 a 100000>");
        return;
      }
      fio.folgaUs = us;
      Serial.printf("S folga=%lu\n", us);
      break;
    }
    case 'a':  // a 0|1: desliga/liga o pedido de apresentação a seguir à ordem de recomeçar
      fio.pedeApresentacao = !(texto[1] == ' ' && texto[2] == '0');
      Serial.printf("S apresentacao=%d\n", fio.pedeApresentacao);
      break;
    case 'r': {  // a ordem de recomeçar, sozinha
      const uint8_t recomeca[] = {5, 0, 1, 0, 1};
      experimenta(recomeca, sizeof(recomeca), 300);
      break;
    }
    case 'k': {  // obriga o sensor a recomeçar quando ele não obedece à ordem (não lê nada a seguir)
      // Visto na bancada: uma escrita mais comprida do que o cabeçalho dela anuncia (23 bytes, anuncia 21)
      // faz o sensor recomeçar sozinho em menos de 1 s. Não vem na documentação: é recurso de bancada.
      const uint8_t malFormado[23] = {0x15, 0x00, 0x02, 0x00, 0xFD, 0x01, 0, 0, 0, 0x10, 0x27};
      experimenta(malFormado, sizeof(malFormado), 1000, false);
      break;
    }
    case 'W':  // como o "w", mas sem ler nada a seguir
    case 'w': {  // w <ms de espera> <pacote em hexadecimal, sem espaços> (ou só o tempo, para ler sem escrever)
      unsigned long ms = 0;
      char hex[64] = "";
      if (sscanf(texto + 1, "%lu %63s", &ms, hex) < 1 || ms > 5000 || strlen(hex) % 2) {
        Serial.println("! comando w: w <ms> <pacote em hexadecimal>");
        return;
      }
      uint8_t pacote[32];
      const size_t n = strlen(hex) / 2;
      for (size_t i = 0; i < n; i++) {
        unsigned b;
        sscanf(hex + 2 * i, "%2x", &b);
        pacote[i] = (uint8_t)b;
      }
      experimenta(pacote, n, ms, texto[0] == 'w');
      break;
    }
    case 'e': {
      unsigned long ms;
      if (sscanf(texto + 1, "%lu", &ms) != 1 || ms < 1 || ms > 2000) {
        Serial.println("! comando e: e <ms de espera pelo sensor, 1 a 2000>");
        return;
      }
      ritmo.espera = ms;
      fio.setTimeOut(ritmo.espera);
      Serial.printf("S espera=%lu\n", ms);
      break;
    }
    case 'd':
      despejo = texto[1] == ' ' && texto[2] == '1';
      Serial.printf("S despejo=%d\n", despejo);
      break;
    case 't':
      mostraTotais();
      break;
    case 'z':
      zeraTotais();
      Serial.println("S totais=0");
      break;
    case 'n':
      if (ligado) {
        mostraContadores("acel", SH2_ACCELEROMETER);
        mostraContadores("giro", SH2_GYROSCOPE_CALIBRATED);
        mostraContadores("rot", SH2_ROTATION_VECTOR);
      }
      break;
    case 'x':
      ligado = false;
      Serial.println("S religar");
      break;
    default:
      Serial.println("! comandos: c d t z n x e f a r w W k g");
  }
}

static void leComandos() {
  while (Serial.available()) {
    const char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (linhaN) {
        linha[linhaN] = 0;
        executa(linha);
        linhaN = 0;
      }
    } else if (linhaN < sizeof(linha) - 1) {
      linha[linhaN++] = ch;
    }
  }
}

static float media(const Conta &c, int i) {
  return c.n ? (float)(c.soma[i] / c.n) : 0;
}

static float desvio(const Conta &c, int i) {
  if (c.n < 2) return 0;
  const double m = c.soma[i] / c.n;
  const double variancia = c.soma2[i] / c.n - m * m;
  return variancia > 0 ? (float)sqrt(variancia) : 0;
}

static void mostraSegundo() {
  // Atitude: do quaternião para rolamento, caimento e guinada, em graus.
  const float qi = quat[0], qj = quat[1], qk = quat[2], qr = quat[3];
  const float norma = qi * qi + qj * qj + qk * qk + qr * qr;
  const float rol = atan2f(2 * (qj * qk + qi * qr), -qi * qi - qj * qj + qk * qk + qr * qr) * RAD_TO_DEG;
  const float seno = norma > 0 ? -2 * (qi * qk - qj * qr) / norma : 0;
  const float cai = asinf(constrain(seno, -1.0f, 1.0f)) * RAD_TO_DEG;
  const float gui = atan2f(2 * (qi * qj + qk * qr), qi * qi - qj * qj - qk * qk + qr * qr) * RAD_TO_DEG;

  const uint32_t dLei = fio.leituras, dFl = fio.falhasLeitura, dEsc = fio.escritas, dFe = fio.falhasEscrita;
  const uint32_t dMax = fio.duracaoMax;
  fio.leituras = fio.falhasLeitura = fio.escritas = fio.falhasEscrita = fio.duracaoMax = 0;
  fioLeituras += dLei;
  fioFalhasLeitura += dFl;
  fioEscritas += dEsc;
  fioFalhasEscrita += dFe;
  if (dMax > fioDuracaoMax) fioDuracaoMax = dMax;

  Serial.printf("E t=%lu a=%lu g=%lu r=%lu pa=%lu pg=%lu pr=%lu ia=%lu ig=%lu ir=%lu lei=%lu fl=%lu esc=%lu fe=%lu "
                "dmax=%lu rein=%lu sil=%lu ax=%.3f ay=%.3f az=%.3f sx=%.4f sy=%.4f sz=%.4f gx=%.4f gy=%.4f gz=%.4f "
                "rol=%.1f cai=%.1f gui=%.1f ea=%u er=%u prec=%.1f voltas=%lu\n",
                (unsigned long)(millis() / 1000), (unsigned long)acel.seg.n, (unsigned long)giro.seg.n,
                (unsigned long)rot.seg.n, (unsigned long)acel.seg.perdidas, (unsigned long)giro.seg.perdidas,
                (unsigned long)rot.seg.perdidas, (unsigned long)acel.seg.intervaloMax,
                (unsigned long)giro.seg.intervaloMax, (unsigned long)rot.seg.intervaloMax, (unsigned long)dLei,
                (unsigned long)dFl, (unsigned long)dEsc, (unsigned long)dFe, (unsigned long)dMax,
                (unsigned long)reinicios, (unsigned long)silencios, media(acel.seg, 0), media(acel.seg, 1),
                media(acel.seg, 2), desvio(acel.seg, 0), desvio(acel.seg, 1), desvio(acel.seg, 2), media(giro.seg, 0),
                media(giro.seg, 1), media(giro.seg, 2), rol, cai, gui, acel.estado, rot.estado,
                precisaoRot * RAD_TO_DEG, (unsigned long)voltas);
  acel.seg = Conta();
  giro.seg = Conta();
  rot.seg = Conta();
  voltas = 0;
}

void setup() {
  Serial.setTxBufferSize(16384);
  Serial.begin(921600);
  delay(300);
  Serial.println();
  Serial.println("S arranque programa=bancada2");
  // Antes da primeira tentativa, 1,5 s à escuta: dá tempo de mandar um "c" ou um "e" de partida.
  // Cada comando recebido estica a escuta mais 1,5 s (para as experiências); um "g" acaba-a logo.
  uint32_t fim = millis() + 1500;
  while ((int32_t)(fim - millis()) > 0 && !avanca) {
    const uint32_t antes = comandos;
    leComandos();
    if (comandos != antes) fim = millis() + 1500;
    delay(5);
  }
}

void loop() {
  leComandos();

  if (!ligado) {
    ligado = liga();
    if (!ligado) delay(500);
    return;
  }

  tLeitura = micros();
  sh2_service();
  voltas++;

  if (bno.wasReset()) {
    reinicios++;
    ativaLeituras(false);
  }

  // O sensor calou-se? Volta a pedir as leituras; à terceira vez seguida, refaz a ligação.
  if (ritmo.acel && micros() - acel.tChegada > SILENCIO_US) {
    silencios++;
    silenciosSeguidos++;
    acel.tChegada = micros();
    if (silenciosSeguidos >= 3) {
      silenciosSeguidos = 0;
      ligado = false;
      Serial.println("S religar motivo=silencio");
      return;
    }
    ativaLeituras(false);
  } else if (acel.seg.n) {
    silenciosSeguidos = 0;
  }

  if (millis() - tSegundo >= 1000) {
    tSegundo += 1000;
    mostraSegundo();
  }
}
