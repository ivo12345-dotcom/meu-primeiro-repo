# ARLEQUIN · Sistema no portátil, com duas caixas ESP32 (desenho)

Data: 20/11/2026 · Estado: **por rever pelo Ivo**. Nasce das conversas de 20/11 (registo no
`NAVEGACAO.md`, §2b). Substitui, nesta fase, o Raspberry Pi e a MacArthur HAT. Não muda o desenho do
sistema definitivo: prepara-o.

## Objetivo

Pôr o sistema inteiro do Arlequin a funcionar já, **com o portátil no lugar do Raspberry Pi**, e a
gravar a caixa negra desde a primeira viagem. O ecrã deixa de ser um ecrã fixo na roda e passa a ser
o portátil, o tablet ou o telemóvel (o Fold do Ivo, no suporte da roda).

Tudo o que se gravar fica na mesma pasta e no mesmo formato do sistema definitivo, para depois se
passar para lá e acertar a polar, os consumos, as velocidades, as médias e os adornamentos.

## O que entra e o que fica de fora

| Entra nesta fase | Fica para depois |
|---|---|
| Vento (força e direção) | Piloto automático EV-100 (chega em dezembro) |
| Velocidade na água (roda do log) | Vigiar o barco parado e o Telegram |
| Proa, adornamento e caimento | Avisos de alagamento e fumo por LoRa (com as Heltec do Ivo) |
| Motor pelo J1939 (vela ou motor, rotações, horas, temperaturas, alarmes, consumo estimado) | Sonda do gasóleo, água doce, barómetro, frigorífico, sonda de profundidade |
| GPS e AIS (B330) | Baterias Victron (quando o SmartShunt estiver montado) |
| Caixa negra, AI, Melhor rota, Diário, Velas, alarmes | Posição para o VHF e o radar (o VHF tem antena de GPS própria; a confirmar pelo Ivo) |

No ecrã, o que fica para depois aparece a "—", como já acontece quando falta uma leitura.

## Visão geral

```
 roda do log ──┐
 mostrador do  ├──► CAIXA 1 (ESP32, selada) ──USB──► PORTÁTIL ◄──USB── AIS B330 (GPS + AIS)
 vento ────────┤        ▲                            │  SignalK + os nossos plugins
 sensor BNO085 ┘        │ rádio das placas           │  caixa negra em ~/arlequin-dados
                        │ (ESP-NOW, sem rede)        │
 motor (J1939) ──► CAIXA 2 (ESP32, junto ao motor)   └──Wi-Fi do Fold──► FOLD (ecrã + internet)
```

Três ideias mandam no desenho:

1. **Caixas simples, inteligência no portátil.** As caixas só leem e mandam os valores em bruto. As
   contas e as calibrações ficam num plugin do SignalK, no portátil. Assim corrige-se uma calibração
   em andamento sem voltar a gravar as placas, e o bruto fica gravado para refazer as contas.
2. **A leitura dos sensores não depende do telemóvel.** A caixa 2 fala com a caixa 1 pelo rádio
   próprio das placas (ESP-NOW), e a caixa 1 fala com o portátil por cabo. O Fold só é preciso para
   ver o ecrã e dar internet.
3. **O computador é trocável.** Quando houver o computador definitivo (Raspberry, Orange Pi ou
   outro), o cabo USB da caixa 1 muda para ele e o resto fica igual.

## Caixa 1: instrumentos

Placa ESP32 da ELEGOO (30 pinos, USB-C), numa caixa de **plástico** selada (metal tapava o rádio e
enganava a bússola), com bucins. Alimentação e dados pelo mesmo cabo USB do portátil.

| Entrada | De onde | Como |
|---|---|---|
| Velocidade na água | Cabo coaxial da roda do log (o mostrador NASA está avariado e sai do circuito) | A bobina dá um sinal fraco: passa por um comparador pequeno e entra num contador de impulsos. Cerca de 2 impulsos por volta; 1 impulso por segundo ≈ 0,2 nós (a confirmar na nossa roda) |
| Vento | Ficha redonda de saída do mostrador NASA Clipper Wind, que continua a funcionar | Chicote feito por nós. Se sair NMEA 0183 (MWV, 4 800 baud), entra numa porta série com adaptação de nível. Se sair só a linguagem do repetidor (versões antigas), lê-se como I²C |
| Proa, adornamento, caimento | Sensor Adafruit BNO085 (ref. 4754), dentro ou junto da caixa | I²C. O chip entrega os valores já calculados e calibra-se sozinho |

O sensor fica fixo, alinhado com o eixo do barco e longe de ferro, do motor e de cabos com muita
corrente.

## Caixa 2: motor

A segunda placa ESP32 da ELEGOO, junto ao motor, na derivação soldada à cablagem do MDI que já
estava decidida (`NAVEGACAO.md`, "Motor J1939: compras": pinos 5 CAN-H, 2 CAN-L e 4 massa; o pino 6
não se toca).

- Um módulo transcetor CAN de 3,3 V liga a derivação à placa, **só em escuta** (a placa nunca
  escreve no barramento do motor).
- Alimentação pelos 12 V do barco, com fusível e um conversor 12 → 5 V.
- Manda cada trama para a caixa 1 pelo rádio das placas (ESP-NOW). Não há fio entre o motor e o
  portátil, por isso não há caminho elétrico entre a massa do motor e o USB do portátil.

A caixa 2 fica o mais simples possível (lê e reenvia), para raramente precisar de ser regravada.

## Das caixas para o portátil

A caixa 1 manda pelo USB linhas de texto, uma por leitura: impulsos do log, frase do vento, atitude
do BNO085, tramas do motor reenviadas no formato `candump -L` (o mesmo que o plugin do motor já lê)
e, de segundo a segundo, um batimento de cada caixa (viva, contadores, força do rádio). Os campos
exatos ficam no plano de implementação.

## No portátil

O sistema já corre no portátil com o simulador (`software/dev`). Falta um **perfil de bordo**, sem
simulador, e duas peças de código:

1. **Plugin novo `signalk-arlequin-caixas`.** Lê as linhas da caixa 1 pela porta série e publica:
   `environment.wind.angleApparent` e `speedApparent`, `navigation.speedThroughWater`,
   `navigation.headingMagnetic`, `navigation.attitude`, mais os valores em bruto e o estado de cada
   caixa (a receber, calada, sem ligação), com aviso no ecrã quando uma caixa se cala. As
   calibrações (fator do log, desvio do vento, desvio da proa) ficam na configuração do plugin.
   Reenvia as tramas do motor pelo evento `arlequin-j1939`, que o plugin do motor já escuta.
2. **Plugin do motor (`signalk-arlequin-j1939`): fonte nova `caixa`.** Hoje tem `candump` (Linux) e
   `simulador`. A fonte `caixa` usa o mesmo evento do simulador, mas com as regras do barco:
   "sem ligação" quando o batimento da caixa 2 para, "calado" quando há batimento sem tramas
   (ignição desligada, conta como vela).

O resto vem como no Pi: `signalk-derived-data` (vento real, corrente, proa verdadeira, dia e noite),
o diário, a rota ativa, a caixa negra, a AI, a Melhor rota, o AIS e a energia. O B330 entra por USB
como uma ligação NMEA 0183 normal do SignalK.

Coisas só do Linux que neste perfil ficam desligadas ou por adaptar: os comandos que arrumam as
janelas do OpenCPN (plugin do ecrã), a fotografia do plugin do porto e o `nice` do treino da AI (a
confirmar no plano).

O portátil fica abrigado, de tampa fechada: configurar para não adormecer nem reiniciar para
atualizações durante uma viagem.

## Rede e ecrã

- O **Fold cria a rede** (ponto de acesso) e mantém os dados móveis. O portátil liga-se a essa rede
  e fica com internet (previsões do tempo, Claude).
- No Fold abre-se `http://<portátil>:3000/arlequin-ecra/` no browser, com ícone no ecrã inicial. É
  o mesmo ecrã da roda (Carta, Instr., AIS, Motor, Viagem, Diário, Melhor rota, Velas, Noite). Cada
  toque vai para o portátil, que executa e grava.
- As caixas não entram nesta rede.
- Sem telemóvel a bordo, o sistema continua a ler e a gravar; só não há ecrã remoto nem internet.

## Caixa negra e passagem para o sistema definitivo

A caixa negra grava como no Pi, em `~/arlequin-dados` (bruto, tabela de 10 em 10 s, saídas,
previsões). Os valores em bruto das caixas também ficam gravados. Quando houver o computador
definitivo, a pasta copia-se para lá com a ferramenta `ferramentas/sincronizar` (a direção
portátil → barco confirma-se no plano).

## Acompanhamento em direto

Com o portátil ligado aos dados do Fold, o Claude instalado no portátil pode, a pedido do Ivo, ler a
caixa negra enquanto grava, verificar cada sensor, corrigir calibrações em andamento e, no fim,
confirmar a viagem antes de a AI aprender com ela. Regras: **a navegar só alterações seguras** (a
configuração do plugin das caixas); nunca mexer na gravação em bruto; regravar uma placa só com o
barco parado. Sem rede móvel o sistema continua sozinho.

## Peças

Compradas pelo Ivo a 20/11 (Amazon.es; a confirmar por ele): sensor Adafruit BNO085, conjunto de 2
placas ESP32 ELEGOO, cabos.

Por comprar:

| Peça | Para quê | Quando |
|---|---|---|
| 2 módulos transcetores CAN de 3,3 V (um de reserva) | Caixa 2 | Já |
| Conversor 12 → 5 V, porta-fusível e fusível | Alimentar a caixa 2 | Já |
| Comparador para o sinal da roda do log | Caixa 1 | Depois de medir o sinal da roda |
| Adaptação de nível e ficha para a tomada do vento | Caixa 1 | Depois da foto das costas do mostrador |
| Cabo USB com o comprimento caixa 1 → portátil, e cabo USB do B330 | Ligações | Depois de medir no barco |
| Caixas de plástico (impressas), bucins, fio | As duas caixas | Na montagem |

O adaptador USB–CAN da lista de 29/09 não é preciso nesta fase. Fica como opção para o computador
definitivo, ou a caixa 2 fica de vez.

## Ensaios

1. **Bancada, em casa.** A caixa 1 com o BNO085, impulsos a fingir a roda e uma frase de vento a
   fingir o mostrador; a caixa 2 com tramas a fingir o motor. O ecrã do portátil e do Fold mostram
   os valores e a caixa negra grava. Os plugins levam testes automáticos, como os outros.
2. **Barco em seco.** Montar as caixas; rodar a roda do log à mão; ligar o mostrador do vento;
   ignição ligada com o motor parado (teste de escuta do J1939); confirmar o B330 por USB.
3. **Primeiras viagens (Tejo, Oeiras, Cascais, com rede).** Verificação em direto de cada sensor;
   calibrar o log contra o GPS com ida e volta, por causa da corrente; calibrar a proa.

## Pontos em aberto

1. **Versão do mostrador do vento** (foto das costas): NMEA ou linguagem do repetidor.
2. **Sinal da roda do log** (medir com o multímetro): escolhe o comparador.
3. **A carta náutica no Fold: decidido pelo Ivo (20/11), carta no browser, servida pelo
   portátil.** A Navionics fica de fora (não recebe a nossa rota e gasta a bateria do Fold). Parte-se
   do `software/dev/carta-demo.html`, que já mostra, com o Leaflet, o barco, o rasto, a rota ativa
   da Melhor rota e os alvos AIS, ao lado do painel. Falta: passar a ser uma página do ecrã servida
   pelo SignalK (sem `localhost` nem bibliotecas da internet), arrumação para o Fold, uma camada de
   profundidades e mosaicos guardados no portátil para funcionar sem rede (fonte a escolher no
   plano, respeitando as regras de cada fornecedor). **Não é carta oficial:** para entradas de
   porto e baixios mantém-se uma carta oficial à mão (o OpenCPN com as o-charts no portátil).
4. **O endereço do portátil na rede do Fold** (nome fixo ou endereço fixo) e a firewall do Windows.
5. **O B330 por USB**: confirmar que entrega os dados por esse cabo.
6. **O VHF tem posição própria?** O Ivo verifica no ecrã do rádio (diz que tem antena de GPS).
7. **O sítio do sensor BNO085.** A meio do barco e em baixo não pode ser: a quilha é de ferro
   fundido e o pé do mastro tem reforço de metal. Por cima do motor também não (ferro e o
   alternador). Proposta: junto à bússola do piloto velho, ao lado da roda, em baixo, na cabine de
   popa, que já foi escolhido como sítio sossegado. Confirma-se com o sensor na mão, a ver a proa em
   direto enquanto se muda de sítio e se liga o motor.
8. **O comprimento do cabo do sensor.** A ligação I²C só é garantida a curta distância (cerca de
   1 m). Se o sítio do sensor ficar a 3 ou 4 m da caixa 1, testa-se na bancada com esse
   comprimento. Saídas se falhar: um extensor de I²C, ou uma placa pequena junto ao sensor, a falar
   por rádio com a caixa 1.
9. **Tabela de desvios da proa.** Além do desvio fixo, o plugin das caixas leva uma tabela de
   desvios por rumo, tirada numa volta completa do barco. Não corrige o que muda com o tempo (motor
   a trabalhar, ferro que se mexe de sítio).
10. **Mostrador da Volvo ilegível de dia.** Avaria conhecida destes mostradores (o LCD perde o
    contraste). As horas leem-se à noite e ficam registadas; depois vêm pelo J1939 (a confirmar na
    primeira escuta). Há LCD de substituição; falta a foto do instrumento para saber o modelo.

## Decisões de 20/11

- Sistema completo no portátil, e não só um gravador (Ivo).
- O motor entra desde o primeiro dia (Ivo).
- Proa e adornamento pelo BNO085; a bússola do piloto velho fica de fora (Ivo).
- O log lê-se diretamente da roda; não se compra outro mostrador (Ivo).
- O ecrã das placas não fica à vista; caixas seladas; compras com entrega rápida (Ivo).
- O Fold faz a rede e mantém os dados móveis (Ivo).
- Caixa 2 por rádio até à caixa 1, e caixa 1 por USB, para não depender do telemóvel (Claude).
- Calibrações no portátil, valores em bruto gravados (Claude).
