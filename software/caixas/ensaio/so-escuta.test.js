'use strict'
// A guarda "só em escuta" (ensaio/so-escuta.js) ensaiada com código plantado de propósito: tem de apanhar
// tudo o que podia pôr a caixa 2 a escrever na linha do motor, e deixar passar o programa verdadeiro.
// Não precisa de placas: corre sempre.
const test = require('node:test')
const assert = require('node:assert/strict')
const { examinar, ficheirosDaCaixa2, ADMITIDAS } = require('./so-escuta')

// Um programa que só ouve, como o de hoje (caixa2/motor.h).
const SO_OUVE = `
#include <Arduino.h>
#include <driver/twai.h>
bool ligar() {
  twai_general_config_t geral = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)5, (gpio_num_t)4, TWAI_MODE_LISTEN_ONLY);
  const twai_timing_config_t tempos = TWAI_TIMING_CONFIG_250KBITS();
  const twai_filter_config_t filtro = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  return twai_driver_install(&geral, &tempos, &filtro) == ESP_OK && twai_start() == ESP_OK;
}
bool ler(twai_message_t &m) { return twai_receive(&m, 0) == ESP_OK; }
`
const com = (mais) => [{ nome: 'plantado.h', codigo: SO_OUVE + mais + '\n' }]
const apanha = (mais, frase) => {
  const achados = examinar(com(mais))
  assert.ok(achados.some(a => frase.test(a)), `não apanhou «${mais.trim()}»: ${JSON.stringify(achados)}`)
}

test('um programa que só liga o controlador em escuta e lê passa', () => {
  assert.deepEqual(examinar(com('')), [])
})

test('o programa verdadeiro da caixa 2 passa', () => {
  assert.deepEqual(examinar(ficheirosDaCaixa2()), [])
})

test('a guarda lê também os ficheiros comuns às duas caixas, que entram no programa da caixa 2', () => {
  const nomes = ficheirosDaCaixa2().map(f => f.nome)
  for (const n of ['caixa2/caixa2.ino', 'caixa2/motor.h', 'comum/src/arlequin_radio.h', 'comum/src/arlequin_linhas.h', 'comum/src/arlequin_versao.h']) {
    assert.ok(nomes.includes(n), `falta ${n} em ${nomes}`)
  }
})

test('os nomes de mandar da interface antiga do chip', () => {
  apanha('void f(twai_message_t &m) { twai_transmit(&m, 0); }', /plantado\.h: usa twai_transmit$/)
  apanha('void f(twai_handle_t h, twai_message_t &m) { twai_transmit_v2(h, &m, 0); }', /usa twai_transmit_v2$/)
  apanha('void f() { twai_initiate_recovery(); }', /usa twai_initiate_recovery$/)
  apanha('void f() { twai_clear_transmit_queue(); }', /usa twai_clear_transmit_queue$/)
  apanha('const int modo = TWAI_MODE_NORMAL;', /usa TWAI_MODE_NORMAL$/)
  apanha('const int modo = TWAI_MODE_NO_ACK;', /usa TWAI_MODE_NO_ACK$/)
})

test('os nomes da interface nova do chip (esp_twai.h): mandar, recuperar e criar o nó', () => {
  apanha('void f(twai_node_handle_t no, twai_frame_t &t) { twai_node_transmit(no, &t, 0); }', /usa twai_node_transmit$/)
  apanha('void f(twai_node_handle_t no) { twai_node_transmit_wait_all_done(no, 100); }', /usa twai_node_transmit_wait_all_done$/)
  apanha('void f(twai_node_handle_t no) { twai_node_recover(no); }', /usa twai_node_recover$/)
  apanha('void f(twai_node_handle_t no) { twai_node_enable(no); }', /usa twai_node_enable$/)
  apanha('void f() { twai_onchip_node_config_t c = {}; twai_node_handle_t no; twai_new_node_onchip(&c, &no); }', /usa twai_new_node_onchip$/)
  apanha('#include <esp_twai.h>', /inclui esp_twai\.h$/)
  apanha('#include "esp_twai_onchip.h"', /inclui esp_twai_onchip\.h$/)
})

test('um nome do chip para a linha do motor que ainda não existe também não passa', () => {
  apanha('void f() { twai_coisa_que_venha_a_existir(); }', /usa twai_coisa_que_venha_a_existir$/)
  apanha('const int x = TWAI_OUTRA_COISA_NOVA;', /usa TWAI_OUTRA_COISA_NOVA$/)
})

test('as camadas de baixo do chip e os registos do controlador', () => {
  apanha('void f(twai_hal_context_t *h, twai_hal_frame_t *t) { twai_hal_set_tx_buffer_and_transmit(h, t, 0); }', /usa twai_hal_set_tx_buffer_and_transmit$/)
  apanha('void f() { twai_ll_set_cmd_tx(&TWAI); }', /usa twai_ll_set_cmd_tx$/)
  apanha('void f() { TWAI.command_reg.val = 1; }', /mexe nos registos do controlador \(TWAI\)$/)
})

test('outra biblioteca para a mesma linha', () => {
  apanha('#include <CAN.h>', /inclui CAN\.h$/)
  apanha('#include <ESP32-TWAI-CAN.hpp>', /inclui ESP32-TWAI-CAN\.hpp$/)
  apanha('#include "ACAN_ESP32.h"', /inclui ACAN_ESP32\.h$/)
})

test('o controlador pedido, ou mudado depois, para um modo que não é o de só escuta', () => {
  assert.ok(examinar([{ nome: 'x.h', codigo: SO_OUVE.replace('TWAI_MODE_LISTEN_ONLY', 'modo') }]).some(a => /não é pedido em modo de só escuta/.test(a)))
  apanha('void g(int modo) { twai_general_config_t outro = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)5, (gpio_num_t)4, modo); }', /pede o controlador sem o modo de só escuta$/)
  apanha('void g(twai_general_config_t &geral) { geral.mode = (decltype(geral.mode))0; }', /muda o modo do controlador$/)
})

test('o que está nos comentários não conta', () => {
  assert.deepEqual(examinar(com('// nunca chamar twai_transmit nem incluir <CAN.h>')), [])
  assert.deepEqual(examinar(com('/* nunca chamar twai_transmit:\n   a regra é só ouvir (TWAI_MODE_NORMAL fica de fora) */')), [])
})

test('sem programa nenhum da caixa 2 a guarda não passa', () => {
  assert.ok(examinar([]).some(a => /não é pedido em modo de só escuta/.test(a)))
})

test('a lista do que se admite só tem coisas de ligar e de ler', () => {
  assert.ok(ADMITIDAS.length >= 8, `${ADMITIDAS}`)
  for (const palavra of ADMITIDAS) {
    assert.doesNotMatch(palavra, /transmit|recover|send|write|_tx|normal|no_ack|self_test|loopback|node|_ll_|_hal_/i, `${palavra} não devia estar na lista`)
  }
})
