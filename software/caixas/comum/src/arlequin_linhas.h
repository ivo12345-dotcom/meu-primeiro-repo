// A linguagem das linhas entre as caixas e o portátil, do lado das placas.
// O contrato está em docs/superpowers/plans/2026-11-22-sistema-no-portatil-parte1.md ("A linguagem das
// linhas") e o que mudou a 23/11 em docs/superpowers/plans/2026-11-23-sistema-no-portatil-parte2-caixas.md.
//
//   $AQ<tipo>,<campos>*HH\n     HH: ou-exclusivo de tudo o que está entre o $ e o *
//   (s.µs) can1 ID#DADOS*HH\n   uma trama do motor; HH: ou-exclusivo de tudo o que está antes do *
//
// Regras deste lado:
//   - nenhuma linha passa de 200 caracteres: uma linha que passasse não se manda e conta em aqCortadas;
//   - nunca se fica à espera da porta: sem espaço para a linha inteira, não se manda e conta em
//     aqPerdidas (é o "perdidos" do batimento da caixa 1). Meia linha nunca sai.
#pragma once

#include <Arduino.h>
#include <stdarg.h>

const size_t AQ_MAX_LINHA = 200;

// A velocidade da porta USB das duas caixas. Tem de ser a mesma do portátil (BAUD em
// software/signalk-arlequin-caixas/lib/linhas.js). Pode trocar-se ao compilar, só para ensaios:
//   node compilar.js 1 --baud 230400
#ifndef AQ_BAUD
#define AQ_BAUD 460800UL
#endif

inline uint32_t aqCortadas = 0;  // linhas que passavam dos 200 caracteres
inline uint32_t aqPerdidas = 0;  // linhas que não couberam na porta

inline uint8_t aqSoma(const char *texto, size_t n) {
  uint8_t x = 0;
  for (size_t i = 0; i < n; i++) x ^= (uint8_t)texto[i];
  return x;
}

inline uint8_t aqSoma(const char *texto) { return aqSoma(texto, strlen(texto)); }

// Escreve n bytes de uma vez, ou nada.
inline bool aqEscreve(HardwareSerial &porta, const char *dados, size_t n) {
  if ((size_t)porta.availableForWrite() < n) {
    aqPerdidas++;
    return false;
  }
  porta.write((const uint8_t *)dados, n);
  return true;
}

// Uma linha $AQ: junta os campos com vírgulas e fecha-a com a soma.
//   AqLinha("B").i(1).u(millis()).t(AQ_VERSAO).manda(Serial);
class AqLinha {
public:
  explicit AqLinha(const char *tipo) { junta("$AQ%s", tipo); }

  AqLinha &i(long v) { junta(",%ld", v); return *this; }
  AqLinha &u(unsigned long v) { junta(",%lu", v); return *this; }
  AqLinha &t(const char *v) { junta(",%s", v); return *this; }

  bool manda(HardwareSerial &porta) {
    if (estourou_ || n_ + 3 > AQ_MAX_LINHA) {
      aqCortadas++;
      return false;
    }
    const uint8_t soma = aqSoma(b_ + 1, n_ - 1);
    n_ += snprintf(b_ + n_, sizeof(b_) - n_, "*%02X\n", soma);
    return aqEscreve(porta, b_, n_);
  }

private:
  void junta(const char *formato, ...) {
    if (estourou_) return;
    va_list a;
    va_start(a, formato);
    const int k = vsnprintf(b_ + n_, AQ_MAX_LINHA + 1 - n_, formato, a);
    va_end(a);
    if (k < 0 || n_ + (size_t)k > AQ_MAX_LINHA) {
      estourou_ = true;
      return;
    }
    n_ += k;
  }

  char b_[AQ_MAX_LINHA + 8];
  size_t n_ = 0;
  bool estourou_ = false;
};

// --- Textos de contadores que cabem sempre ------------------------------------------------------------
// As respostas aos comandos "estado", "sensor" e "leituras" são um texto feito de contadores. Um contador
// vai até 4294967295: com os números todos assim o texto não se pode cortar nem a linha passar dos 200.
// Quem verifica é o compilador, a partir do formato do texto: um formato que não caiba não compila.

// O pior comprimento de um texto feito com este formato: cada número com os algarismos todos (%lu e %u:
// 10; %d: 11, com o sinal). Só conhece os formatos que os contadores usam; com outro qualquer devolve um
// número enorme, para a verificação falhar em vez de se enganar por baixo.
constexpr size_t aqPiorCaso(const char *f) {
  size_t n = 0;
  while (*f) {
    if (*f != '%') {
      n++;
      f++;
    } else if (f[1] == '%') {
      n++;
      f += 2;
    } else if (f[1] == 'l' && f[2] == 'u') {
      n += 10;
      f += 3;
    } else if (f[1] == 'u') {
      n += 10;
      f += 2;
    } else if (f[1] == 'd') {
      n += 11;
      f += 2;
    } else {
      return 100000;
    }
  }
  return n;
}

constexpr size_t aqLetras(const char *t) {
  size_t n = 0;
  while (t[n]) n++;
  return n;
}

// A resposta "$AQR,<comando>,<texto>*HH", com o texto no pior caso, cabe numa linha?
constexpr bool aqCabeNaResposta(const char *comando, const char *formato) {
  return 5 + aqLetras(comando) + 1 + aqPiorCaso(formato) + 3 <= AQ_MAX_LINHA;
}

// A prova da conta de cima, feita pelo compilador de cada vez que se compila.
static_assert(aqPiorCaso("") == 0, "aqPiorCaso: texto vazio");
static_assert(aqPiorCaso("abc") == 3, "aqPiorCaso: texto sem números");
static_assert(aqPiorCaso("a=%lu") == 12, "aqPiorCaso: um %lu são 10 algarismos");
static_assert(aqPiorCaso("a=%u;b=%d") == 2 + 10 + 3 + 11, "aqPiorCaso: um %u são 10 algarismos e um %d são 11 com o sinal");
static_assert(aqPiorCaso("100%%") == 4, "aqPiorCaso: %% é um sinal de percentagem");
static_assert(aqPiorCaso("%s") > AQ_MAX_LINHA, "aqPiorCaso: um formato que não conhece tem de dar um número enorme");
static_assert(aqPiorCaso("x=%5lu") > AQ_MAX_LINHA, "aqPiorCaso: um formato com largura não é dos que conhece");
static_assert(aqPiorCaso("x=%") > AQ_MAX_LINHA, "aqPiorCaso: um % solto no fim não é um formato");
// 18 números e 5 letras são 185: com "estado" a linha fica com 200 certos; mais uma letra já não cabe
static_assert(aqCabeNaResposta("estado", "%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%luabcde"), "aqCabeNaResposta: 200 ainda cabe");
static_assert(!aqCabeNaResposta("estado", "%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%luabcdef"), "aqCabeNaResposta: 201 já não cabe");
static_assert(!aqCabeNaResposta("leituras", "%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%lu%luabcd"), "aqCabeNaResposta: o nome do comando também conta");

// O espaço para o texto da resposta a um comando, à medida do formato: nunca se corta. E não compila se a
// resposta, com os números todos no máximo, passar de uma linha.
//   AQ_TEXTO(texto, "estado", ESTADO_FORMATO);
//   snprintf(texto, sizeof(texto), ESTADO_FORMATO, ...);
#define AQ_TEXTO(variavel, comando, formato)                                                               \
  static_assert(aqCabeNaResposta(comando, formato), "a resposta a este comando pode passar de uma linha"); \
  char variavel[aqPiorCaso(formato) + 1]

// Uma trama do motor como linha: "(s.µs) can1 ID#DADOS*HH". O identificador vai com 8 letras.
inline bool aqMotor(HardwareSerial &porta, uint32_t s, uint32_t us, uint32_t id, const uint8_t *dados, uint8_t quantos) {
  char b[64];
  if (quantos > 8) quantos = 8;
  size_t n = snprintf(b, sizeof(b), "(%lu.%06lu) can1 %08lX#", (unsigned long)s, (unsigned long)(us % 1000000UL), (unsigned long)id);
  for (uint8_t i = 0; i < quantos; i++) n += snprintf(b + n, sizeof(b) - n, "%02X", dados[i]);
  n += snprintf(b + n, sizeof(b) - n, "*%02X\n", aqSoma(b, n));
  return aqEscreve(porta, b, n);
}

// Lê um comando "$AQC,<nome>[,<valor>...]*HH" (sem o fim de linha). Só vale com a soma certa, com o
// nome feito de letras minúsculas, algarismos e traços, e com valores inteiros (até quatro).
inline bool aqComando(const char *linha, char *nome, size_t tamanhoNome, long valores[4], int *quantos) {
  const size_t n = strlen(linha);
  if (n < 9 || n > 80 || strncmp(linha, "$AQC,", 5) != 0) return false;
  const char *estrela = strrchr(linha, '*');
  if (!estrela || strlen(estrela) != 3) return false;
  char *fim = nullptr;
  const unsigned long dita = strtoul(estrela + 1, &fim, 16);
  if (*fim != '\0' || !isxdigit((unsigned char)estrela[1]) || !isxdigit((unsigned char)estrela[2])) return false;
  if (aqSoma(linha + 1, (size_t)(estrela - linha) - 1) != (uint8_t)dita) return false;

  const char *p = linha + 5;
  size_t k = 0;
  while (p < estrela && *p != ',') {
    const char c = *p++;
    if (!(islower((unsigned char)c) || isdigit((unsigned char)c) || c == '-') || k + 1 >= tamanhoNome) return false;
    nome[k++] = c;
  }
  if (k == 0) return false;
  nome[k] = '\0';
  *quantos = 0;
  while (p < estrela) {
    if (*p != ',' || *quantos >= 4) return false;
    p++;
    char *depois = nullptr;
    const long v = strtol(p, &depois, 10);
    if (depois == p || depois > estrela || (*depois != ',' && depois != estrela)) return false;
    valores[(*quantos)++] = v;
    p = depois;
  }
  return true;
}

// Junta os bytes que chegam do portátil em linhas. Devolve true quando há uma linha inteira em texto().
// Uma linha com mais de 80 caracteres deita-se fora até ao fim.
class AqEntrada {
public:
  bool junta(int c) {
    if (c == '\r') return false;
    if (c == '\n') {
      const bool boa = !aDeitarFora_ && n_ > 0;
      b_[n_] = '\0';
      pronta_ = n_;
      n_ = 0;
      aDeitarFora_ = false;
      return boa;
    }
    if (aDeitarFora_) return false;
    if (n_ >= sizeof(b_) - 1 || c < 0x20 || c > 0x7E) {
      n_ = 0;
      aDeitarFora_ = true;
      return false;
    }
    b_[n_++] = (char)c;
    return false;
  }

  const char *texto() const { return b_; }

private:
  char b_[84];
  size_t n_ = 0, pronta_ = 0;
  bool aDeitarFora_ = false;
};

// --- As ordens do portátil, com conta e medida ---------------------------------------------------------
// Um portátil a mandar ordens sem parar (um programa avariado, ou outro programa na porta errada) não
// pode atrasar o ciclo da caixa nem pô-la a deitar fora as medições para lhe responder. Visto na caixa 1
// a 28/11/2026, com 3000 ordens por segundo durante 3 s: a caixa respondia a todas, as respostas enchiam
// a saída e ela deitava fora mais de 5000 linhas; nesses 3 s não passou uma linha de movimento e passou
// um batimento só.
//
// Por isso:
//   - em cada volta do ciclo leem-se no máximo AQ_ORDENS_BYTES bytes;
//   - depois de se obedecer a uma ordem só se volta a ler passados AQ_ORDENS_INTERVALO_MS. São no máximo
//     100 respostas por segundo, menos de metade do que o cabo leva. (Só o limite de bytes não chegava:
//     visto na mesma placa, continuava a deitar fora mais de 3000 linhas.)
// O que chegar entretanto espera na memória da porta: cabe lá uma dúzia de ordens seguidas, que são
// todas obedecidas, uma de cada vez. Numa enxurrada não cabe e perde-se, que é o que se quer.
const int AQ_ORDENS_BYTES = 96;
const uint32_t AQ_ORDENS_INTERVALO_MS = 10;

class AqOrdens {
public:
  // Chama-se em todas as voltas do ciclo. obedece(linha) é chamada por cada linha inteira que chegar e
  // devolve true se a linha era uma ordem com a soma certa (a que respondeu).
  template <typename F>
  void corre(HardwareSerial &porta, uint32_t agoraMs, F obedece) {
    // ultima_ é a hora de uma volta anterior deste mesmo ciclo: a conta sem sinal dá sempre o tempo
    // que passou, mesmo com o relógio a dar a volta
    if (agoraMs - ultima_ < AQ_ORDENS_INTERVALO_MS) return;
    for (int lidos = 0; lidos < AQ_ORDENS_BYTES && porta.available() > 0; lidos++) {
      if (!entrada_.junta(porta.read())) continue;
      if (!obedece(entrada_.texto())) continue;
      ultima_ = agoraMs;
      return;
    }
  }

private:
  AqEntrada entrada_;
  uint32_t ultima_ = 0;
};
