# ARLEQUIN · software

Código do sistema de navegação e energia do Arlequin (Jeanneau Melody 34).
O desenho está em `NAVEGACAO.md` e em `docs/superpowers/specs/`.

| Pasta | O que é | Vai para o Pi? |
|---|---|---|
| `arlequin-ecra/` | **Ecrã da roda**: painel web com as 9 páginas (em `/arlequin-ecra/`) + plugin que arruma as janelas OpenCPN/painel | Sim |
| `signalk-arlequin-energia/` | Plugin: alarmes das baterias AGM e registo das cargas pelo motor | Sim |
| `signalk-arlequin-ais/` | Plugin: alarme de colisão AIS (CPA/TCPA) no servidor | Sim |
| `signalk-arlequin-gasoleo/` | Plugin: nível do gasóleo pela sonda original (ADS1115), calibração, reserva 40 L, fuga, consumo anormal, abastecimentos | Sim |
| `signalk-arlequin-j1939/` | Plugin: motor D1-20B pelo J1939 do MDI (rotações, horas, temperatura, tensão, consumo estimado, alarmes, descoberta da PGN 65417) | Sim |
| `arlequin-simulador/` | Plugin que finge o barco (navegação, vento, AIS, motor, baterias, sol) | Não (só testes) |
| `dev/` | SignalK local no portátil, com tudo ligado e o diário de bordo | Não |

## Testar no portátil (Windows, Node 22 ou mais recente)

```bash
cd software/dev
npm run instalar
npm start
```

- **Ecrã da roda:** `http://localhost:3000/arlequin-ecra/?demo`. O `?demo`
  mostra onde fica a carta do OpenCPN. Sem ele fica só o painel, como no Pi,
  no telemóvel e no ecrã da cabine.
- **Administração do SignalK:** `http://localhost:3000`, em Server → Plugin Config.
- **Som:** o browser só toca depois do primeiro toque no ecrã, por isso a
  barra de cima avisa até lá.

O simulador arranca no cenário `navegar-demo`: em tempo real, de Peniche para a
Nazaré. O vento vem de 020°, por isso a última perna é à bolina. Há três navios
AIS e um deles, o NORDIC STAR, aparece uma vez em rota de colisão (a opção
`colisaoRepeteMin` repete-o de N em N min). O motor
trabalha 5 min em cada 25.

Os outros cenários, acelerados (1 h simulada = 2 s), servem para os alarmes de
energia: `inverno-navegar`, `descarga-critica`, `motor-fraca` e `verao-navegar`.

## As 9 páginas

| Botão | O que mostra |
|---|---|
| Carta | painel ao lado do OpenCPN: vento, proa, COG/SOG, fundo, velocidade, % da polar, abatimento, próximo WP, 2 alvos AIS, motor, gasóleo |
| Instr. | vento grande com VMG, polar com o alvo e o real, desempenho, adorno, barómetro com a tendência de 3 h, corrente, cabine |
| AIS | todos os alvos por perigo (CPA/TCPA); tocar num alvo mostra o detalhe e "Silenciar" |
| Motor | rpm, temperatura, óleo, alternador, horas, consumo, gasóleo, alarmes + energia: serviço, painéis, bateria do motor, últimas cargas |
| Viagem | próximo WP, chegada, XTE, VMG + resumo (distância, tempos à vela e a motor, gasóleo, vento máximo, pressão); "Nova viagem" |
| Diário | entradas de hoje do signalk-logbook, 7 botões de um toque, notas |
| Melhor rota | rumo a seguir ao leme em grande; contra o vento, os 2 bordos ótimos da polar e "VIRA AGORA" na layline |
| Rec. velas | liga o motor → aproa ao vento (rumo do vento real) → recolhe → terminado, tudo no diário |
| Noite | tudo a vermelho (e o OpenCPN em modo noite, no Pi) |

## Testes automáticos

```bash
cd software/dev
npm test
```

## Alarmes (aprovados pelo Ivo a 29/09/2026)

| Situação | Ecrã / telemóvel | Som |
|---|---|---|
| Serviço a 55% com o motor parado | "liga o motor para carregar" | bip; repete de 30 em 30 min |
| Serviço a 85% com o motor ligado | "já podes desligar o motor" | bip |
| Serviço abaixo de 50% | alarme vermelho | sempre |
| Bateria do motor abaixo de 12,2 V (em repouso) | alarme vermelho | sempre |
| Navio com CPA < 0,5 MN e TCPA < 20 min | alarme vermelho | sempre |

De noite, com o barco parado (menos de 1 nó durante 5 min), os avisos de
55% e 85% ficam só no ecrã. A navegar, apitam também de noite. O ecrã
toca o som enquanto o alarme não for silenciado. O besouro por GPIO vem
depois.

## No barco

1. Instalar os plugins `signalk-victron-ble` (SmartShunt + MPPT),
   `signalk-derived-data` (dá o dia/noite, o vento real e a corrente) e
   `@meri-imperiumi/signalk-logbook` (o diário).
2. No SmartShunt, pôr a entrada auxiliar em "starter battery". No
   signalk-victron-ble, dar o ID `servico` ao SmartShunt e `motor` à bateria
   secundária.
3. Copiar `arlequin-ecra/`, `signalk-arlequin-energia/` e
   `signalk-arlequin-ais/` para o Pi, lado a lado, e instalá-los na pasta
   `~/.signalk` com `npm install <pasta>`. **Não** instalar o simulador.
4. OpenCPN: enviar a rota ativa para o SignalK (saída NMEA 0183 com RMB/APB),
   para as páginas Viagem e Melhor rota.
5. Em Plugin Config → Arlequin · ecrã, pôr os comandos que arrumam as janelas
   (OpenCPN 58% à esquerda e painel à direita, ou painel em ecrã inteiro) e o
   modo noite do OpenCPN. Isto afina-se na montagem.
6. Abrir o painel em Chromium, em modo kiosk:
   `chromium --kiosk http://localhost:3000/arlequin-ecra/`

## Motor pelo J1939 (no barco)

1. Adaptador USB–CAN isolado (InnoMaker USB2CAN, gs_usb) junto ao motor, com
   uma derivação curta soldada nos fios CAN-H, CAN-L e massa da cablagem do
   MDI (procedimento no NAVEGACAO.md, "Motor J1939: compras"). **Nunca** na
   rede NMEA 2000 da MacArthur.
2. No Pi:
   ```bash
   sudo apt install can-utils
   sudo ip link set can1 up type can bitrate 250000 listen-only on
   candump can1
   ```
   Primeiro só o `candump`, com a ignição ligada: ver que tramas chegam.
3. Plugin `signalk-arlequin-j1939` com a fonte `candump` e a interface `can1`.
4. **Descoberta dos alarmes do MDI:** abrir
   `http://<pi>:3000/plugins/signalk-arlequin-j1939/pagina`, ligar a ignição
   com o motor parado (acendem os alarmes de óleo e de carga), ligar o motor e
   ver que bits da PGN 65417 mudam. Pôr esse mapa (byte, bit → alarme) na
   configuração do plugin.
5. **Consumo:** é estimado pela curva da Volvo Penta (1800 rpm → 1,0 L/h;
   2400 → 2,0; 3200 → 4,6). Calibrar o fator com o depósito: litros
   metidos ÷ litros estimados.

No portátil, o simulador fala J1939 (`motorJ1939`) e o plugin usa a fonte
`simulador`: a cadeia é a mesma do barco.

## Gasóleo (no barco)

1. ADS1115 na I²C da MacArthur: **A0** = terminal "S" (sonda) do medidor,
   **A1** = terminal "+" do medidor, cada um com um divisor 47 kΩ / 10 kΩ.
   Não se corta nada: o medidor continua a funcionar.
2. App I2C do OpenPlotter: publicar A0 em `tanks.fuel.0.senderVoltage` e A1
   em `tanks.fuel.0.supplyVoltage` (tensões reais, já com o divisor).
3. Plugin `signalk-arlequin-gasoleo`. Calibrar no ecrã, página **Motor →
   Calibrar**, com o barco direito e 3 min parado:
   - depósito cheio → "200";
   - as marcas do desenho do dono anterior, à medida que o gasóleo desce;
   - **mais pontos perto do vazio** (a boia é menos linear no fundo).
   Depois, cada abastecimento: **Abasteci** e os litros metidos. Pontos que não
   batem certo com a tabela são recusados (engano ou sonda ainda a mexer).
4. Alarmes: reserva ≤ 40 L; fuga > 5 L em 12 h com o motor parado; **consumo
   anormal** quando uma saída a motor gasta mais do que o esperado (> 3 L ou
   30% acima): possível fuga com o motor a trabalhar ou avaria. Cada saída
   também dá o **fator de calibração** do consumo (em `/estado`).
5. O Pi precisa de teclado no ecrã só para as notas do Diário; o Abasteci e o
   Calibrar têm teclado numérico próprio.
