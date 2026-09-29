# ARLEQUIN · software

Código do sistema de navegação e energia do Arlequin (Jeanneau Melody 34).
O desenho está em `NAVEGACAO.md` e em `docs/superpowers/specs/`.

| Pasta | O que é | Vai para o Pi? |
|---|---|---|
| `signalk-arlequin-energia/` | Plugin SignalK: alarmes das baterias AGM e registo das cargas pelo motor | Sim |
| `arlequin-simulador/` | Plugin SignalK que finge o barco (baterias, sol, motor, GPS) | Não (só testes) |
| `dev/` | SignalK local no portátil, já com os dois plugins ligados | Não |

## Testar no portátil (Windows, Node 22 ou mais recente)

```bash
cd software/dev
npm run instalar
npm start
```

Abre `http://localhost:3000` e carrega em **Server → Plugin Config**. O
simulador corre o cenário `inverno-navegar`, em que 1 hora simulada dura 2 s.
O cenário inteiro demora 4 minutos. Os alarmes aparecem em:

- `http://localhost:3000/signalk/v1/api/vessels/self/notifications/arlequin`
- o estado de cada plugin, em Plugin Config;
- `dev/config/plugin-config-data/signalk-arlequin-energia/sessoes-carga.jsonl`,
  com as cargas pelo motor.

Para mudar de cenário, escolhe outro em Plugin Config → Arlequin · simulador.
Os cenários são `inverno-navegar`, `descarga-critica`, `motor-fraca` e
`verao-navegar`.

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

De noite, com o barco parado (menos de 1 nó durante 5 min), os avisos de
55% e 85% ficam só no ecrã. A navegar, apitam também de noite.

## No barco

1. Instalar os plugins `signalk-victron-ble` (SmartShunt + MPPT) e
   `signalk-derived-data` (dá o `environment.mode` dia/noite).
2. No SmartShunt, pôr a entrada auxiliar em "starter battery". No
   signalk-victron-ble, dar o ID `servico` ao SmartShunt e `motor` à bateria
   secundária.
3. Copiar `signalk-arlequin-energia/` para o Pi e instalá-lo na pasta
   `~/.signalk` com `npm install <pasta>`. **Não** instalar o simulador.
