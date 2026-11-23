// Os pinos da caixa 2 (placa ELEGOO "ESP32 DEVKIT V1 TYPEC", 30 pinos), junto ao motor.
// O módulo do barramento do motor (SN65HVD230, 3,3 V) liga-se assim:
//   3V3 -> 3V3     GND -> GND     CRX -> D4     CTX -> 3V3 do próprio módulo (preso em cima)
// O CTX do módulo NÃO vai à placa: fica preso aos 3,3 V, para o módulo não poder escrever na linha do
// motor nem por engano. A placa só ouve.
#pragma once

const int PINO_MOTOR_LE = 4;        // D4: o que o módulo ouve na linha do motor (CRX)
const int PINO_MOTOR_ESCREVE = 25;  // D25: o controlador do chip exige um pino; não leva fio nenhum
const int PINO_LUZ = 2;             // D2: a luz azul da placa
