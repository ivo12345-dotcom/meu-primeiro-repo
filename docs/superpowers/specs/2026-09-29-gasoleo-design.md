# ARLEQUIN · Nível do gasóleo (desenho)

Data: 29/09/2026 · Aprovado pelo Ivo: reserva **40 L**; fuga = **> 5 L em 12 h
com o motor parado**.

## Objetivo

Dar o gasóleo certo do depósito de inox de 200 L (forma irregular, boia de
braço) a partir da sonda resistiva original, sem cortar nada, e com a leitura
estável no mar.

## Peças

- **Hardware (no barco):** ADS1115 na I²C da MacArthur. **A0** = tensão da
  sonda (terminal "S" do medidor) e **A1** = alimentação do medidor (terminal
  "+"), cada um com um divisor 47 kΩ / 10 kΩ (14,4 V → 2,5 V; 57 kΩ não
  carrega o circuito do medidor).
- **OpenPlotter (app I2C):** lê o ADS1115 e publica as duas tensões em
  `tanks.fuel.0.senderVoltage` e `tanks.fuel.0.supplyVoltage` (configurável).
- **Plugin `signalk-arlequin-gasoleo`** (este desenho): razão, calibração,
  filtro, fusão com o consumo, alarmes, abastecimentos.
- **Ecrã (página Motor):** botões "Abasteci" e "Calibrar" com teclado numérico
  próprio (o Pi não tem teclado).

## Cálculo

1. **Razão** = sonda ÷ alimentação. Não depende da tensão das baterias (12,5 V
   parado, 14,2 V a carregar).
2. **Tabela de calibração** `[{ razao, litros }]` (≥ 2 pontos, monótona em
   qualquer sentido) → litros por interpolação linear. Sem tabela: publica só a
   razão e o estado diz "falta calibrar".
3. **Filtro:** só entram amostras com adorno < 5° (`navigation.attitude.roll`;
   sem o sensor, entram todas). Mediana de uma janela de 3 min, com pelo menos
   60 amostras.
4. **Fusão com o consumo (J1939):** a cada segundo, litros −= consumo × dt.
   A cada 30 s, se houver mediana: litros += α × (mediana − litros), com
   α = 0,5 com o motor parado e α = 0,1 com o motor ligado (a boia mexe-se mais).
   No arranque: litros = primeira mediana.
5. Publica `tanks.fuel.0.currentLevel` (0–1), `currentVolume` (m³) e
   `capacity` (0,2 m³).

## Abastecimentos e calibração

- **Deteção:** com o motor parado, a mediana sobe > 10 L acima do estimado →
  abastecimento; os litros saltam logo para a mediana e fica no diário
  ("Abastecimento: +85 L (40 → 125 L)").
- **`POST /abastecimento { litros }`:** guarda o ponto (razão depois,
  litros antes + litros metidos) na tabela.
- **`POST /calibrar { litros }`:** guarda o ponto (razão atual, litros), por
  exemplo "depósito cheio = 200" ou as marcas do desenho do dono anterior.
- **`GET /estado`:** litros, razão, mediana, tabela, alarmes.

## Alarmes (`notifications.tanks.fuel.0.*`)

- `reserva`: aviso com som ≤ 40 L; limpa > 45 L.
- `fuga`: alarme com som se, com o motor parado, o máximo das medianas das
  últimas 12 h menos a atual > 5 L. A janela recomeça quando o motor liga ou há
  abastecimento. (A dilatação do gasóleo com 10 °C dá ~1,7 L: fica abaixo.)

## Simulador

Gera as duas tensões a partir do gasóleo do modelo: sonda com uma curva não
linear inventada, balanço proporcional ao adorno e à velocidade, alimentação =
tensão da bateria (12,5 / 14,2 V). A configuração do dev traz a tabela que
corresponde a essa curva.

## Validação

Testes: razão, tabela (crescente e decrescente), filtro de adorno, mediana,
fusão, abastecimento, reserva com histerese, fuga (sim e não, dilatação),
calibração. No SignalK local: nível estável com balanço, reserva, e um
abastecimento simulado no diário.
