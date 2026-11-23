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
