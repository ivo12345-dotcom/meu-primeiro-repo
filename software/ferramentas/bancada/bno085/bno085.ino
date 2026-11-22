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

  size_t requestFrom(uint8_t endereco, size_t n, bool parar) override {
    const uint32_t t0 = micros();
    const size_t lidos = TwoWire::requestFrom(endereco, n, parar);
    anota(micros() - t0);
    leituras++;
    if (lidos != n) falhasLeitura++;
    return lidos;
  }

  uint8_t endTransmission(bool parar) override {
    const uint32_t t0 = micros();
    const uint8_t erro = TwoWire::endTransmission(parar);
    anota(micros() - t0);
    escritas++;
    if (erro != 0) falhasEscrita++;
    return erro;
  }

private:
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
};

static FioContado fio(0);
static Adafruit_BNO08x bno(-1);
static Ritmo ritmo;
static Canal acel, giro, rot;
static float quat[4] = {0, 0, 0, 1};  // i, j, k, real
static float precisaoRot = 0;
static bool ligado = false, despejo = false;
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

static bool liga() {
  tentativas++;
  fio.end();
  fio.begin(PINO_SDA, PINO_SCL, ritmo.barramento);
  if (!bno.begin_I2C(ENDERECO, &fio)) {
    Serial.printf("S ligacao=falhou tentativa=%lu\n", (unsigned long)tentativas);
    return false;
  }
  sh2_setSensorCallback(aoReceber, NULL);
  bno.wasReset();  // o reinício do arranque não conta
  const sh2_ProductId_t &p = bno.prodIds.entry[0];
  Serial.printf("S ligado tentativa=%lu parte=%lu versao=%u.%u.%u compilacao=%lu\n", (unsigned long)tentativas,
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
  switch (texto[0]) {
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
      }
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
      Serial.println("! comandos: c d t z n x");
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
