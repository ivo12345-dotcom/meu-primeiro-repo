# ARLEQUIN · software

Código do sistema de navegação e energia do Arlequin (Jeanneau Melody 34).
O desenho está em `NAVEGACAO.md` e em `docs/superpowers/specs/`.

| Pasta | O que é | Vai para o Pi? |
|---|---|---|
| `arlequin-ecra/` | **Ecrã da roda**: painel web com as 9 páginas (em `/arlequin-ecra/`) + plugin que arruma as janelas OpenCPN/painel | Sim |
| `signalk-arlequin-energia/` | Plugin: alarmes das baterias AGM e registo das cargas pelo motor | Sim |
| `signalk-arlequin-ais` | Plugin: alarme de colisão AIS (CPA/TCPA) no servidor | Sim |
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
AIS e um deles, o NORDIC STAR, vem em rota de colisão de 30 em 30 min. O motor
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
