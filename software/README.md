# ARLEQUIN · software

Código do sistema de navegação, energia e segurança do Arlequin (Jeanneau Melody 34).
O desenho está em `NAVEGACAO.md` (§11, "Software a bordo") e em `docs/superpowers/specs/`.
**A instalação no Pi, por ordem, está no `NAVEGACAO.md`, §11, "Instalar no Pi".** Aqui fica que
pasta é o quê, como se testa no portátil e o que cada plugin precisa no barco.

| Pasta | O que é | Vai para o Pi? |
|---|---|---|
| `arlequin-ecra/` | **Ecrã da roda**: painel web em `/arlequin-ecra/` (8 páginas + Noite) e o plugin que arruma as janelas OpenCPN/painel e leva o Diário ao `signalk-logbook`; `verificar-ecra/` mede o ecrã num Chromium | Sim |
| `signalk-arlequin-rota/` | **Melhor rota**: o cálculo (3a), o plano para terra pelo Telegram (3b-1) e o acompanhamento a navegar (3b-2); `dados/` tem a costa, as zonas e os destinos | Sim |
| `signalk-arlequin-porto/` | **Barco parado e Telegram**: fumo, porão, bomba, fuga de gasóleo, intrusão, deriva do ponto de amarração; comandos e alarmes pelo bot | Sim |
| `signalk-arlequin-caixanegra/` | **Caixa negra**: grava tudo desde o 1.º dia (bruto, tabela de 10 em 10 s, saídas) para a AI | Sim |
| `signalk-arlequin-ia/` + `arlequin-ia/` | **AI a bordo**: o plugin (previsões guardadas, treino, o cartão do Diário) e o pacote Python que treina os modelos | Sim |
| `signalk-arlequin-energia/` | Alarmes das baterias AGM (55 % / 85 % / 50 % / bateria do motor) e as cargas pelo motor | Sim |
| `signalk-arlequin-ais/` | Alarme de colisão AIS no servidor (o mesmo `cpa.js` do ecrã) e o "em porto" | Sim |
| `signalk-arlequin-gasoleo/` | Gasóleo pela sonda original (ADS1115): calibração, reserva ≤ 40 L, fuga, consumo anormal, abastecimentos | Sim |
| `signalk-arlequin-agua/` | Água doce pelas pedaladas das bombas de pé: Enchi, calibrar a bomba, aviso ≤ 20 %, dias que faltam | Sim |
| `signalk-arlequin-j1939/` | Motor D1-20B pelo J1939 do MDI: rotações, horas, temperaturas, tensão, consumo, alarmes, estado da ligação, descoberta da PGN 65417 | Sim |
| `arlequin-simulador/` | Plugin que finge o barco (navegação, vento, AIS, motor, baterias, sol) | **Não** (só testes) |
| `dev/` | SignalK local no portátil, com tudo ligado, e os scripts de ensaio | **Não** |
| `ferramentas/costa/` | Gera as linhas de costa e valida os destinos (Python, no portátil) | Não |
| `ferramentas/passagem/` | `simular.mjs`: a passagem de referência Algés → Peniche de 29/09 | Não |
| `ferramentas/sincronizar/` | Copia os dados do Pi para o portátil e põe no barco um modelo treinado no portátil | Não (corre no portátil) |

## Testar no portátil (Windows, Node 22 ou mais recente)

```bash
cd software/dev
npm run instalar
npm start
```

- **Ecrã da roda:** `http://localhost:3000/arlequin-ecra/?demo`. O `?demo` mostra onde fica a carta do
  OpenCPN. Sem ele fica só o painel, como no Pi, no telemóvel e no ecrã da cabine.
- **Administração do SignalK:** `http://localhost:3000`, em Server → Plugin Config.
- **Som:** se o browser do portátil não deixar tocar antes de um toque, a barra mostra "🔇 SEM SOM:
  toca no ecrã" até ao 1.º toque. No Pi o Chromium arranca com
  `--autoplay-policy=no-user-gesture-required` e toca logo.
- `npm run instalar` instala o SignalK 2.33.0, os plugins do Arlequin (por `file:`), o logbook, o
  `@signalk/resources-provider` e o `@signalk/course-provider`, e faz o `npm install` da pasta da rota
  (os testes da rota carregam a AI pelo nome do pacote).

**O simulador** arranca no cenário `navegar-demo`: em tempo real, de Peniche para a Nazaré. O vento
vem de 020°, por isso a última perna é à bolina. Há três navios AIS e um deles, o NORDIC STAR, aparece
uma vez em rota de colisão (a opção `colisaoRepeteMin` repete-o de N em N min). O motor trabalha 5 min
em cada 25. O simulador só fala J1939 com a ignição ligada (de 10 s antes de arrancar o motor até 10 s
depois de o parar), como o MDI.

Os outros cenários, acelerados (1 h simulada = 2 s), servem para os alarmes de energia:
`inverno-navegar`, `descarga-critica`, `motor-fraca` e `verao-navegar`. Já não é preciso desligar o
J1939 neles: a energia segue o relógio dos dados do SmartShunt (auditoria M-60).

**A configuração do dev** (`dev/config/plugin-config-data/*.json`) está no git, e o servidor
reescreve-a (e o `settings.json`) quando arranca ou quando se grava no Admin UI. **Corre o `npm test`
antes de cada commit:** o `dev/test/config-dev.test.js` falha se um token do Telegram ou um JWT do
SignalK verdadeiros forem lá parar. No dev, o plugin da rota tem o `modoTeste` ligado (é a marca de
dev que as guardas dos scripts pedem). **Esta pasta nunca se copia para o Pi**, onde o `modoTeste`
está sempre desligado.

**O plugin porto** vem desligado no dev. Para experimentar o "Enviar plano": `npm run telegram-falso`
(porta 8081; `GET http://localhost:8081/_enviados` mostra o que chegou) e ligar o porto em Plugin
Config. Já aponta para o Telegram falso, só com os chats falsos do dev.

**Scripts só do dev — nunca no Pi:**
- `npm run viagem-acelerada` — a viagem Algés → Peniche a 60× (faz de GPS, barómetro, depósito e
  relógio, manda planos e ativa rotas). Precisa do servidor e do Telegram falso a correr, do simulador
  desligado, do porto ligado ao Telegram falso e, no plugin da rota, de `modoTeste`,
  `horaSimulada: true` e `cicloSegundos: 1` (no fim, desligar a `horaSimulada` e o `cicloSegundos`
  volta a 60). Recusa-se a correr sem isso.
- `npm run testar-rota` — põe o barco em Algés, calcula até Peniche e ativa; com `--em` ou `--ativar`
  tem a mesma guarda.
- Os dois marcam o que injetam como simulado (fonte `arlequin-simulador.…`): a caixa negra grava essas
  linhas com `simulado = 1` e a AI nunca aprende com elas. Pormenores no `NAVEGACAO.md`, "A navegar".

## Testes automáticos

```bash
cd software/dev
npm test
```

Corre os testes de todos os pacotes Node e os `pytest` do `arlequin-ia` e do `ferramentas/costa`.
Para os do Python: `pip install -r software/arlequin-ia/requirements.txt` e
`pip install -r software/ferramentas/costa/requirements.txt`.

**O ecrã a sério num Chromium** (não faz parte do `npm test`): `cd software/arlequin-ecra && npm run
verificar-ecra`. Desenha 74 estados a 1024×600 (o LAFVIN 7" da roda), de dia e de noite, e sai com 1
se um botão, uma lista ou a barra de cima ficar cortada (0 sem problemas, 2 sem browser). Opções:
`-- --so=texto`, `--letra=Verdana`, `--largura=430 --altura=600` (a janela da Carta), `--json=`,
`--capturas=pasta`, `--procurar="texto"`, `--rolagem`; `CHROME=…` para outro browser. No portátil usa o
Chrome ou o Edge; no Pi o `chromium`. Corre-se também no Pi, porque a letra de lá é mais larga.

## As páginas do ecrã

8 botões e a Noite: Carta, Instr., AIS, Motor, Viagem, Diário, Melhor rota, Velas e Noite (com − e +).

| Botão | O que mostra |
|---|---|
| Carta | painel ao lado do OpenCPN: vento, proa, COG/SOG, fundo, velocidade, % da polar, abatimento, próximo WP, os 2 alvos AIS mais perigosos, motor, gasóleo |
| Instr. | vento grande com VMG, polar com o alvo e o real, desempenho, adorno, barómetro com a tendência de 3 h, corrente, cabine |
| AIS (o botão diz quantos, ⚠ com perigo) | todos os alvos por perigo (CPA/TCPA), "Em porto" quando é o caso; tocar num alvo mostra o detalhe e "Silenciar"/"Reconhecer" |
| Motor | rotações, temperatura, óleo, alternador, horas, consumo e o estado do motor (a trabalhar / motor desligado / sem leitura do motor); gasóleo (Abasteci, Calibrar, Calibração completa); água (Enchi, Calibrar bomba); energia: serviço, painéis BB/EB, bateria do motor, últimas cargas; os alarmes |
| Viagem | próximo WP, chegada, XTE, VMG + resumo (distância, tempos à vela e a motor, gasóleo, vento máximo, pressão); "Nova viagem" |
| Diário | entradas do dia (hora de Lisboa) do signalk-logbook, pelo plugin do ecrã; 8 botões de um toque (com "Orcas"); notas; o cartão da AI |
| Melhor rota | Pedir, A calcular, Resultado (3 cartões, veredicto, avisos, precauções, desistência), Mapa, e o Leme a navegar (rumo, bordos, VIRA AGORA, a faixa do acompanhamento, "Contactos em terra") |
| Velas | o estado da grande e da genoa (a AI precisa dele) e o Recolher velas sem piloto: liga o motor → aproa ao vento → recolhe → terminado, tudo no diário |
| Noite | as cores do dia muito escurecidas, sem vermelho, com − e + (5 níveis de brilho, o 2 por omissão); no Pi pede também o modo noite do OpenCPN |

As horas do ecrã são sempre as de Lisboa. A letra nunca fica abaixo de 14 px e os alvos de toque
têm 44 px no mínimo.

## Alarmes

A regra do apito vale para todos os plugins (decisão do Ivo n.º 2, contrato C1): o ecrã toca o
**apito contínuo** só no perigo imediato (colisão AIS, fumo, água no porão, bomba de porão, fuga de
gasóleo, motor a sobreaquecer) e o **apito curto** em tudo o resto com som. A lista completa está no
`NAVEGACAO.md`, "Alarmes e apito".

Os da energia (aprovados pelo Ivo a 29/09; o apito como ficou a 02/10):

| Situação | Ecrã / telemóvel | Som |
|---|---|---|
| Serviço a 55 % com o motor parado | "liga o motor para carregar" | bip; repete de 30 em 30 min |
| Serviço a 85 % com o motor ligado, se arrancou para carregar | "já podes desligar o motor" | bip |
| Serviço abaixo de 50 % | alarme vermelho | apito curto |
| Bateria do motor abaixo de 12,2 V (em repouso) | alarme vermelho | apito curto |
| Sem dados do SmartShunt há mais de 5 min | aviso | só no ecrã |

De noite, com o barco parado (menos de 1 nó durante 5 min), os avisos de 55 % e 85 % ficam só no
ecrã. A navegar, apitam também de noite. O besouro por GPIO é uma melhoria por decidir.

## No barco

A ordem completa está no `NAVEGACAO.md`, §11, "Instalar no Pi". O essencial de cada parte:

1. **Segurança do SignalK ligada.** O ecrã entra com uma conta "read/write" (nunca admin); todas as
   rotas dos plugins têm nível (`router.access`; o quadro "Permissões" do `NAVEGACAO.md`). O token de
   admin do `signalk-logbook` vai só para a configuração dos plugins no servidor (o do ecrã para o
   Diário; o da energia, do gasóleo e da água se ligares "Escrever no diário"), nunca para o browser.
2. **Plugins da comunidade:** `signalk-victron-ble` (o SmartShunt e os 2 MPPT), `signalk-derived-data`
   (dia/noite, vento real, corrente e a proa verdadeira), `@meri-imperiumi/signalk-logbook` (o diário),
   `@signalk/resources-provider` e `@signalk/course-provider` (a rota ativa e o rumo a seguir) e
   `@signalk/set-system-time` (a hora pelo GPS).
3. **Victron:** no SmartShunt, a entrada auxiliar em "starter battery". No `signalk-victron-ble`, os
   IDs **`servico`** (SmartShunt), **`motor`** (a bateria auxiliar), **`mppt1`** (MPPT de BB) e
   **`mppt2`** (MPPT de EB): o ecrã, o porto e a caixa negra leem estes nomes fixos.
4. **Os plugins do Arlequin:** o repositório clonado em `~/arlequin` e, na pasta `~/.signalk`, um
   `npm install <pasta>` por plugin (todos os da tabela com "Sim"). **Nunca o simulador.** Os plugins
   leem ficheiros uns dos outros por caminho relativo: ficam dentro do repositório.
5. **OpenCPN:** **não** o pôr a mandar a rota ao SignalK por NMEA 0183 (RMB/APB), como dizia uma
   versão antiga deste README. A rota ativa é a que a Melhor rota ativa no SignalK (API de rumo v2), e
   o `@signalk/course-provider` calcula o rumo a seguir; uma segunda fonte de rumo baralhava o Leme e o
   acompanhamento.
6. **Ecrã, Plugin Config → Arlequin · ecrã:** os comandos que arrumam as janelas (OpenCPN 58 % à
   esquerda e painel à direita, ou painel em ecrã inteiro) e o modo noite do OpenCPN (afinam-se na
   montagem); o `token` de admin do diário.
7. **O painel no Chromium em modo quiosque**, no arranque do ambiente gráfico:
   `chromium-browser --kiosk --autoplay-policy=no-user-gesture-required http://localhost:3000/arlequin-ecra/`
   (ou `chromium`). Sem a opção do som, depois de cada arranque o ecrã fica mudo até alguém lhe tocar.
   O Pi 5 não tem saída de 3,5 mm: o som sai pelo HDMI do ecrã (se tiver altifalante) ou por uma placa
   USB. Entrar uma vez com a conta "read/write" e marcar "Remember me".
8. **Melhor rota:** os telefones e o barco na configuração; o `modoTeste` sempre desligado.
9. **Fuso:** `sudo timedatectl set-timezone Europe/Lisbon`; a pilha do relógio (RTC) do Pi 5.

## Motor pelo J1939 (no barco)

1. Adaptador USB–CAN isolado (InnoMaker USB2CAN, gs_usb) junto ao motor, com uma derivação curta
   soldada nos fios CAN-H, CAN-L e massa da cablagem do MDI (procedimento no `NAVEGACAO.md`, "Motor
   J1939: compras"). **Nunca** na rede NMEA 2000 da MacArthur.
2. No Pi, o primeiro ensaio à mão:
   ```bash
   sudo apt install can-utils
   sudo ip link set can1 up type can bitrate 250000 listen-only on
   candump can1
   ```
   Primeiro só o `candump`, com a ignição ligada: ver que tramas chegam. Depois, dar ao adaptador o
   nome fixo `can1` e pô-lo a subir sozinho no arranque (`NAVEGACAO.md`, "Instalar no Pi", ponto 11).
3. Plugin `signalk-arlequin-j1939` com a fonte `candump` e a interface `can1`. O plugin religa o
   `candump` de 5 em 5 s e publica o estado da ligação (`propulsion.main.ligacao`): `a-receber`,
   `calado` (a ignição desligada: os valores a "—", conta como vela) ou `sem-ligacao` (o aviso "Sem
   leitura do motor", só no ecrã). **Um fio CAN solto parece a ignição desligada: ao arrancar o motor,
   confirmar que o ecrã passa a "a trabalhar".**
4. **Descoberta dos alarmes do MDI:** abrir `http://<pi>:3000/plugins/signalk-arlequin-j1939/pagina`,
   ligar a ignição com o motor parado (acendem os alarmes de óleo e de carga), ligar o motor e ver que
   bits da PGN 65417 mudam. Pôr esse mapa (byte, bit → alarme) na configuração do plugin.
5. **Consumo:** estimado pela curva da Volvo Penta (1800 rpm → 1,0 L/h; 2100 → 1,45; 2400 → 2,0;
   3200 → 4,6). Calibrar o fator com o depósito: litros metidos ÷ litros estimados.

No portátil, o simulador fala J1939 (`motorJ1939`) e o plugin usa a fonte `simulador`: a cadeia é a
mesma do barco.

## Gasóleo (no barco)

1. ADS1115 na I²C da MacArthur: **A0** = terminal "S" (sonda) do medidor, **A1** = terminal "+" do
   medidor, cada um com um divisor 47 kΩ / 10 kΩ. Não se corta nada: o medidor continua a funcionar.
2. App I2C do OpenPlotter: publicar A0 em `tanks.fuel.0.senderVoltage` e A1 em
   `tanks.fuel.0.supplyVoltage` (tensões reais, já com o divisor), **as duas pelo menos de 60 em 60 s**:
   mais velhas, o plugin conta a sonda como perdida (ao fim de 5 min, o aviso "Sonda do gasóleo sem
   leitura…", só no ecrã).
3. Plugin `signalk-arlequin-gasoleo`. Calibrar no ecrã, página **Motor → Calibrar**, com o barco
   direito e 3 min parado:
   - depósito cheio → "200";
   - as marcas do desenho do dono anterior, à medida que o gasóleo desce;
   - **mais pontos perto do vazio** (a boia é menos linear no fundo).
   Depois, cada abastecimento: **Abasteci** e os litros metidos. Pontos que não batem certo com a
   tabela são recusados (engano ou sonda ainda a mexer). Sem a sonda a ler, o Calibrar e o Abasteci
   são recusados logo ("não gravei nada"). Também há a **Calibração completa** (de 5 em 5 L, com o
   depósito vazio) e a folha do multímetro (`docs/folha-calibracao-gasoleo.html`).
4. Alarmes: reserva ≤ 40 L (apito curto); **fuga** > 5 L em 12 h com o motor parado (apito contínuo);
   **consumo anormal** quando uma saída a motor gasta mais do que o esperado (mais de 3 L **e** mais de
   30 % acima): possível fuga com o motor a trabalhar ou avaria. Cada saída dá também o **fator de
   calibração** do consumo (em `/estado`). Sem a sonda, o nível continua pelo consumo do motor enquanto
   se sabe o que o motor faz; sem leitura do motor deixa de se atualizar.
5. O Pi precisa de teclado no ecrã só para as notas do Diário; o Abasteci e o Calibrar têm teclado
   numérico próprio.

## Água doce (no barco)

1. As bombas de água doce são **de pé** (lavatório do WC e lava-loiça). Em cada **pedal de água doce**:
   um **reed switch** e um íman, que fecham uma vez por pedalada. A bomba de **água do mar** do
   lava-loiça **não** leva sensor.
2. Os reed switches vão a um contador (ESP32 com SensESP, `DigitalInputCounter`, ou GPIO do Pi) que
   publica o **contador acumulado** em `tanks.freshWater.0.pedaladas` (cozinha) e
   `tanks.freshWater.1.pedaladas` (WC), **pelo menos de 10 em 10 min, mesmo parado** (sem ele há
   10 min, o depósito fica "sem sensor"). Se o contador recomeçar do zero, o plugin percebe.
3. Plugin `signalk-arlequin-agua`: pôr as **capacidades reais**. Vêm a **80 L** cada por omissão, que
   está **por confirmar no barco** (a ficha de origem do Melody dá 180 L ao todo). No ecrã, **Motor →
   Calibrar bomba**: bombear para uma jarra de 1 L e Terminar. Ao encher o depósito: **Enchi**. Até ao
   1.º Enchi (ou um nível posto à mão) o ecrã diz "nível por confirmar: carrega Enchi": nunca aparece
   cheio por omissão.
4. Aviso de água a acabar a 20 % (limpa a 25 %). Mostra também os **dias que faltam** ao ritmo dos
   últimos dias.

## Barco parado e Telegram (no barco)

1. O Ivo cria o bot no @BotFather e cola o token em `telegramToken` (plugin `signalk-arlequin-porto`).
   Manda uma mensagem ao bot: o estado do plugin mostra o número do chat, que se junta em **Chats
   autorizados**. Quem só recebe os planos de navegação manda /start ao bot, recebe um código e o Ivo
   junta-o em **Contactos do plano** (ninguém entra sozinho).
2. Os sensores (0/1): `sensors.porao.agua`, `sensors.porao.bomba`, `sensors.fumo`,
   `sensors.gasoleo.liquido`, `sensors.gaiuta.aberta`, `sensors.movimento` (ESP32 ou GPIO do Pi).
3. O ponto de amarração grava-se sozinho só junto a um porto ou fundeadouro conhecido (os destinos da
   rota e a opção `lugares`); sem motor só se apaga com "Larguei" no ecrã ou `/largar`; armado, nunca
   sozinho. Comandos: `/estado`, `/foto`, `/posicao`, `/armar`, `/desarmar`, `/amarrar`, `/largar`,
   `/ajuda`. As regras todas: `NAVEGACAO.md`, "Barco parado e Telegram".
4. Opcionais: `batimentoUrl` (healthchecks.io) e `comandoFoto` (ex.: `rpicam-still -n -o {ficheiro}`).

## Caixa negra, AI e cópia para o portátil

- **Caixa negra:** grava em `~/arlequin-dados` (bruto, tabela, saídas, previsões). As saídas fecham
  nos destinos da rota e nos portos extra (a Ericeira). Aos 80 % do disco apaga do bruto só o que o
  portátil já confirmou.
- **AI:** um venv com o `requirements.txt` do `arlequin-ia` (versões fixas) e, no plugin, `python` =
  o Python do venv. No Pi treina sozinha (versões `vNNNN`); no portátil,
  `cd software/arlequin-ia && python -m arlequin_ia treinar --dados <pasta>` faz versões `pNNNN`.
- **Copiar:** `node software/ferramentas/sincronizar/sincronizar.mjs --host pi@arlequin` (pelo
  Tailscale) ou `--origem E:\arlequin-dados` (pela pen; só copia). Um modelo do portátil vai para o
  barco com `--por-no-barco velocidade/p0001` (pede confirmação; só pelo ssh).
