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

## Notas (02/10): como ficou

- **Sem tabela** (menos de 2 pontos de calibração), o plugin não publica nenhum caminho do nível:
  a razão fica só no `GET /estado` e no estado do plugin ("Falta calibrar"). (O ponto 2 do
  "Cálculo" dizia que publicava a razão.)
- **Consumo anormal** (aviso com som, `notifications.tanks.fuel.0.consumoAnormal`): depois de uma
  saída a motor, já com o motor parado, se o depósito desceu mais do que o consumo esperado
  (J1939) + o maior de 3 L e 30 % desse consumo: "Gastou X L em vez de ~Y L: possível fuga ou
  avaria no motor" (`lib/nivel.js`).
- **Calibração completa** (Ivo, 29/09): com o depósito vazio, o ecrã (Motor → Calibração
  completa) junta gasóleo de 5 em 5 L (ou de 10 em 10); cada ponto grava-se sozinho pelo menos 30 s depois de
  deitar e com a leitura estável durante 20 s; onde a boia não mexe, guarda-se só o intervalo.
  Também se importa a folha do multímetro (`docs/folha-calibracao-gasoleo.html`)
  (`lib/calibracao.js`, `POST /calibracao/*`).

## Notas de implementação (auditoria, 02–03/10)

O que a auditoria mudou (frentes F6 e F6b; as decisões do Ivo numeradas como na lista da
auditoria). Verificado no código a 05/10. Onde o texto acima e estas notas diferem, valem estas.

- **Sonda perdida** (I-12): as duas tensões (sonda e alimentação) só contam com ≤ 60 s de idade, por
  isso a app I2C do OpenPlotter tem de as mandar **pelo menos de 60 em 60 s**. Sem elas há 5 min
  (cerca de 6 min depois da última leitura): `notifications.tanks.fuel.0.sondaPerdida` (`warn`, só
  no ecrã: "Sonda do gasóleo sem leitura há mais de 5 min (ADS1115, app I2C do OpenPlotter): …");
  limpa logo que as tensões voltam.
- **Sem sonda, o nível continua pelo consumo** enquanto o motor está acompanhado: a trabalhar
  (rotações frescas, ≤ 10 s) e com o consumo conhecido, ou parado com certeza (rotações frescas ou
  a ignição desligada, `propulsion.main.ligacao` = `calado`). Sem leitura do motor (sem J1939, ou
  `sem-ligacao`) deixa de publicar o nível, e o ecrã diz "sem leitura (último N L, há X min)". A fuga,
  o consumo anormal e o abastecimento precisam da sonda.
- **Calibrar sem sonda** é recusado logo: o `POST /calibrar` e o `POST /abastecimento` respondem
  503 "sem leitura da sonda do gasóleo (ADS1115, app I2C do OpenPlotter): não gravei nada; tenta
  outra vez quando a sonda voltar"; com a sonda a ler e sem tabela, o "Calibrar" continua aceite (é
  o 1.º passo da calibração).
- **Reserva** (M-51): o alarme acende a ≤ 40 L (este plugin e o ecrã); a rota exclui uma passagem
  que chega com < 40 L no pior caso. Uma passagem que chega com exatamente 40 L passa na rota e
  acende a reserva à chegada.
- **Apito** (decisão n.º 2, contrato C1): a `fuga` é `alarm` com `apito: 'continuo'` (perigo
  imediato); a `reserva` e o `consumoAnormal` são `warn` com som (apito curto no ecrã); a
  `sondaPerdida` é só visual.
- **Reinício** (nota do SignalK 2.33): os alarmes ativos (reserva, fuga com a janela de 12 h,
  consumo anormal, sonda perdida) ficam em `alarmes-ativos.json` e voltam ao arrancar (até 10 min
  depois).
- **Permissões** (K-11, contrato C2): GET `/estado` e `/calibracao` com `router.access('readonly')`;
  os POST (`/calibrar`, `/abastecimento`, `/calibracao/*`) com `router.access('readwrite')`.
- **Diário:** com a segurança ligada, o `signalk-logbook` só aceita admin: os abastecimentos só vão
  ao diário com um token de admin no campo `token` deste plugin (fica só aqui, nunca no ecrã).
