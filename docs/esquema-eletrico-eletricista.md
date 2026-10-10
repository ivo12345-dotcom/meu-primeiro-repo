# ARLEQUIN · Caderno do eletricista: sistema elétrico 12 V / 230 V

**Barco:** Jeanneau Melody 34 "Arlequin", Peniche. **Dono:** Ivo. **Versão 1, 08/10/2026**, feita a partir das fotos de 08/10 e das decisões do dono. **Esquema unifilar:** `esquema-eletrico-arlequin.pdf` (A3) e `esquema-eletrico-arlequin.svg`. **Fotos do inventário:** pasta `img-eletrico/`.

Este caderno diz o que existe, o que sai, o que entra, como se liga, com que cabo e que fusível, que regulações se fazem e como se ensaia no fim. O que falta medir a bordo está marcado como **[medir]** e é a primeira tarefa.

## 1. Objetivo do trabalho

1. Reorganizar as baterias: **serviço = 2 × Tudor TK960 AGM 96 Ah** (as que estão na caixa de madeira sob o piso), preparado para receber **mais 4 AGM iguais** (6 × 96 Ah = 576 Ah); **arranque = 1 × Tudor Start PRO TG1101 110 Ah**. As outras três baterias saem do barco.
2. Substituir o **separador de carga a díodos Power-first PF 270** por um **VSR Victron Cyrix-ct 12/24-120**: o alternador carrega a bateria de arranque e o Cyrix liga o banco de serviço quando há carga, sem a queda de 0,7 a 1 V dos díodos.
3. Instalar **barramentos**, **fusíveis** em todos os ramais, **corta-corrente de serviço** ON/OFF e o **SmartShunt** no negativo do serviço.
4. Instalar os **2 painéis solares de 625 W** com **2 reguladores MPPT Victron SmartSolar 100/50** (um por painel), fusíveis de 63 A e cabo de 16 mm².
5. Ligar o **guincho da âncora** à bateria de arranque com o seu fusível, o **inversor** ao serviço com o seu fusível, e dar ao **Raspberry Pi** e ao **piloto EV-100** circuitos dedicados no quadro.
6. Rever o **carregador de cais** (saídas e fusíveis) e a instalação de **230 V** (diferencial, terra, tomadas).
7. Deixar tudo **etiquetado, fotografado e ensaiado** (secção 12).

## 2. O que existe hoje (fotos de 08/10)

| Aparelho | Identificação | Onde está | Foto |
|---|---|---|---|
| 2 baterias de serviço | Tudor TK960 **AGM 96 Ah**, 850 A (EN), caixa L05 353 × 175 × 190 mm, Exide; ligadas em paralelo com uma ponte | caixa de madeira sob o piso do salão, com cinta | 01, 02, 03, 05 |
| 2 baterias de arranque | Tudor Start PRO **TG1101 110 Ah**, 850 A, ácido livre | compartimento branco | 06 |
| 1 bateria | Tudor High-Tech EFB "carbon boost 2.0", ~100 Ah, start-stop | compartimento branco | 06 |
| 1 bateria | Tudor TL652 Technica **65 Ah**, 650 A, ácido livre, caixa LB3 | junto à caixa de relés do guincho | 11, 13 |
| Separador de carga | **Power-first PF 270**, répartiteur a díodos, 120 A, 50 V; entradas IN 1 / IN 2, saídas BAT 1 / BAT 2 / BAT 3; BAT 2 sem cabo; cabos etiquetados SERVICE, MOT, VHF, ACTE(?); módulo com dissipador e 3 bornes por cima (por identificar) | painel vertical junto às baterias | 07, 08, 14 |
| Carregador de cais | **Navicom Invac Duovolt**, comutado, amperímetro 0–30 A, 2 saídas (anos 90) | mesmo painel | 12 |
| Inversor | **LTC Power INV-12600**, 600 W, onda modificada, 12 → 230 V, preso com abraçadeiras de nylon | antepara | 15 |
| Guincho da âncora | **Lofrans Control Box CB120012** (caixa de relés 12 V para motores de 700 / 1000 / 1200 W), recetor do comando sem fios "12V S/N 19036819", porta-fusível ANL no positivo | junto ao disjuntor de 230 V | 09, 10, 11 |
| Corta-correntes | um de chave vermelha amovível (lado da caixa) e um "OFF" + seletor branco redondo (frente da caixa) | caixa das baterias | 01 |
| 230 V | disjuntor branco de 2 polos ("N") da entrada do cais | antepara | 11, 14 |
| Motor | Volvo Penta D1-20 com alternador de **115 A / 14 V** (regulador interno, correia poly-V de 6 nervuras) e painel MDI | compartimento do motor | — |

**Problemas vistos nas fotos:** terminais com fita isoladora em vez de manga termorretrátil; ramais ligados diretamente aos bornes sem fusível; óxido nos terminais; vários cabos no mesmo borne; o PF 270 com uma saída livre e cabos sem identificação clara; quatro químicas de bateria diferentes a partilhar carregadores.

## 3. O que sai do barco

- A 2.ª Tudor TG1101 110 Ah, a Tudor High-Tech EFB e a Tudor TL652 65 Ah (etiquetar e entregar ao dono).
- O separador a díodos PF 270 e, se fizer parte dele, o módulo com dissipador por cima **[confirmar o que é antes de tirar]**.
- O seletor branco redondo da caixa das baterias (substituído por um corta-corrente ON/OFF de 300 A no serviço).
- Toda a fita isoladora nos terminais e todos os ramais sem fusível.

## 4. Baterias e bancos

### 4.1 Banco de serviço (AGM, sempre em paralelo)

- Hoje: **B1 e B2 = Tudor TK960** na caixa de madeira. Com as 4 novas: **B3 a B6 = AGM 96 Ah iguais às TK960** (Tudor TK960 ou Exide EK960), numa segunda caixa igual, ao lado ou no compartimento branco que fica livre **[medir o espaço: cada bateria 353 × 175 × 190 mm, 28 kg]**.
- **Cada bateria com o seu fusível MEGA 150 A no borne positivo** (porta-fusível de borne) e **cabos de 50 mm² do mesmo comprimento** de cada bateria aos barramentos. É isto que faz as seis partilharem a corrente por igual.
- **Barramento + do banco** (250 A), onde entram as cargas (MPPT, carregador de cais, Cyrix: assim o barco carrega com o corta-corrente desligado) → **fusível principal Class T ou MEGA 250 A** (a menos de 180 mm do barramento) → **corta-corrente de serviço ON/OFF 300 A** → **barramento + de distribuição** (250 A), de onde saem todos os consumidores.
- **Negativo:** todas as baterias ao **lado "battery" do SmartShunt**; **tudo o resto** (consumidores, MPPT, carregador, Cyrix, ligação à massa do motor) ao lado "load", que é o **barramento − de distribuição**. Se alguma coisa ficar do lado "battery" do shunt, o estado de carga que o Pi mostra fica errado.
- Caixas com as baterias **presas com cintas**, bornes com tampa, ventilação para o exterior do compartimento; as AGM podem ficar no salão.
- **Antes de ligar as 4 novas em paralelo com as 2 atuais**, o dono faz o teste das 2 (repouso 12 h, tensão por bateria, teste de capacidade; NAVEGACAO §8b ponto 15). Se estiverem abaixo de ~80 % da capacidade, **não se misturam**: as 2 velhas vão para o guincho da âncora como banco próprio e o serviço fica com as 4 novas (384 Ah).

### 4.2 Bateria de arranque

- **1 × Tudor TG1101 110 Ah** (ácido livre: fica onde está, no compartimento branco, de pé, com cinta e respiros livres).
- Liga **só**: motor de arranque + painel MDI (pelo corta-corrente de chave vermelha de 300 A), guincho da âncora (fusível ANL próprio), Cyrix (fusível 100 A), carregador de cais saída 2 (fusível 40 A) e alternador B+ (fusível MEGA 150 A). **Nenhum consumidor de serviço na bateria de arranque.**
- Negativo ao **bloco do motor** (35 mm²), que é a **massa comum** do barco: o barramento − do serviço liga-se também ao bloco do motor (35 mm²) pelo lado "load" do shunt.

## 5. Fontes de carga

### 5.1 Alternador (115 A)

- B+ do alternador → **fusível MEGA 150 A** junto à bateria de arranque → bateria de arranque. Cabo **35 mm²** **[medir o percurso]**.
- O D+ continua ligado ao painel MDI como está (luz de carga). Não se mexe no regulador interno.
- O serviço recebe a carga pelo **Cyrix-ct**, que fecha 2 minutos depois de a bateria de arranque passar os 13,0 V e abre abaixo de 12,8 V. Funciona nos dois sentidos: com o carregador de cais ou o solar no serviço, também carrega a de arranque.

### 5.2 VSR Victron Cyrix-ct 12/24-120

- Entre o borne + da bateria de arranque e o barramento + do banco de serviço, com **fusível MEGA 100 A em cada lado** e cabo **16 mm²** (25 mm² se a ida passar de 2 m). Ligar o fio de massa do Cyrix ao barramento −.
- Montar na vertical, num sítio seco, perto da bateria de arranque. Se o dono quiser o "start assist" (puxar o serviço para arrancar o motor com a bateria de arranque em baixo), o Cyrix-ct tem entrada para um botão de pressão no poço: cabo de 1,5 mm², fusível 5 A.

### 5.3 Solar: 2 × 625 W com 2 × MPPT SmartSolar 100/50

- Cada painel ao seu MPPT com **cabo solar de 6 mm²** e fichas **MC4**; passa-cabos estanque no convés. **Nunca ligar os dois painéis em série** (2 × 55,7 V passa os 100 V do MPPT); nunca os dois no mesmo MPPT.
- Recomendado um **seccionador CC de 2 polos (32 A)** entre cada painel e o seu MPPT, para se poder trabalhar com sol.
- Saída de cada MPPT → **fusível MIDI ou ANL 63 A** → barramento + do banco, cabo **16 mm²** (troço curto; os MPPT montam-se perto das baterias, na vertical, sítio seco e ventilado). Negativos dos MPPT ao barramento − (lado "load" do shunt).
- Regulações (pela app VictronConnect): perfil **AGM**, absorção **14,4 V**, flutuação **13,8 V**, equalização desligada, **corrente máxima 30 A em cada MPPT enquanto o banco tiver 192 Ah** (sobe-se para 50 A com os 576 Ah), compensação de temperatura pelo sensor do SmartShunt (rede VE.Smart entre os dois MPPT e o shunt).

### 5.4 Carregador de cais

- O Navicom Invac Duovolt fica por agora: **saída 1 → barramento + do banco** (fusível 40 A, cabo 10 mm²; no esquema junta-se ao cabo do MPPT 2 antes do barramento), **saída 2 → bateria de arranque** (fusível 40 A), negativos ao barramento −. Confirmar na placa a tensão de carga **[ler a placa]**: se não tiver perfil AGM (14,4 / 13,8 V) ou for um carregador de tensão única acima de 14,6 V, o dono substitui-o por um **Victron Blue Smart IP22 12/30 (3 saídas)**; a cablagem é a mesma.
- Alimentação 230 V do carregador a jusante do diferencial do cais.

## 6. Distribuição e proteção

- **Alimentação do quadro:** do barramento + de distribuição, cabo **16 mm²** com **fusível MEGA 100 A** à saída do barramento (ou 25 mm² com 150 A se o percurso passar de 4 m) **[medir]**. Negativo do quadro ao barramento − com a mesma secção.
- **Cada circuito do quadro** com o seu disjuntor ou fusível, cabo estanhado e etiqueta nas duas pontas (ver a tabela da secção 13). O Pi e os instrumentos de navegação têm de ter **o mesmo negativo** (sem retornos pela massa), senão há loops de terra nas ligações NMEA.
- **Bomba de porão com boia:** alimentação direta do barramento + do banco com fusível de 10 A (**antes** do corta-corrente de serviço, para funcionar com tudo desligado); interruptor manual/automático no quadro.
- **Guincho da âncora:** bateria de arranque → **fusível ANL 100 a 125 A** (conforme a potência do motor do guincho **[ler a placa do guincho]**) → caixa de relés Lofrans → motor. Cabo **35 mm²**, ou **50 mm²** se ida + volta passar de 12 m **[medir]**. Recetor do comando sem fios com fusível de 5 A. Interruptor de corte do guincho ao alcance do leme.
- **Inversor 600 W:** barramento + de distribuição → **fusível ANL 80 A** (a menos de 180 mm do barramento) → inversor, cabo **16 mm²**, no máximo 2 m. Fixar o inversor com parafusos (hoje está com abraçadeiras de nylon) em sítio ventilado. A tomada do inversor é **própria**, nunca ligada à rede de 230 V do cais.
- **Piloto EV-100 Wheel:** o ACU-100 leva um **circuito dedicado no quadro, disjuntor de 10 A** (confirmar no manual do ACU-100), cabo 2,5 mm²; a unidade de roda liga ao ACU-100. O ACU-100 alimenta a rede SeaTalkNG (EV-1, p70s); a ligação à rede NMEA 2000 do Pi faz-se com o cabo de adaptação SeaTalkNG–DeviceNet.
- **Raspberry Pi 5 + MacArthur HAT:** circuito dedicado no quadro com **fusível 5 A** (porta-fusível ATO IP55), cabo 2,5 mm², pelo módulo de alimentação 12 → 5 V da HAT. O ecrã da roda é alimentado pelo Pi.

## 7. Monitorização (SmartShunt)

- Victron **SmartShunt 500 A** no negativo do serviço: lado "battery" só às baterias (barramento − do banco); lado "load" ao barramento − de distribuição, onde ligam todos os negativos, incluindo a ligação à massa do motor.
- Fio vermelho do shunt ao + do banco (fusível 1 A, já vem no cabo). Sensor de temperatura opcional.
- Regulação pela app: capacidade **192 Ah** (muda para 576 quando as novas entrarem), tensão de carregado 13,2 V, corrente de cauda 4 %, tempo 3 min, Peukert 1,15, eficiência de carga 95 %. O Pi lê o shunt e os MPPT por Bluetooth.

## 8. Negativos, massa e proteção galvânica

- Um só negativo: barramento − de distribuição ↔ negativo da bateria de arranque ↔ bloco do motor, com 35 mm². Nenhum retorno pelo casco ou por peças metálicas.
- A terra de 230 V do cais liga à massa do barco; recomenda-se um **isolador galvânico** no condutor de terra do cais (protege o veio, o hélice e as válvulas de fundo da corrosão com o barco ligado ao cais).

## 9. 230 V do cais

- Tomada de cais → **disjuntor diferencial 2P 16 A / 30 mA** (o branco "N", confirmar que é diferencial e não só magnetotérmico **[ver a placa]**) → carregador e 2 a 3 tomadas. Cabo 3G2,5 estanhado, terra ligada.
- As tomadas do cais e a tomada do inversor ficam separadas e identificadas; nunca se liga o inversor à rede do cais.

## 10. Material a instalar (referências)

| # | Material | Quantidade | Notas |
|---|---|---|---|
| 1 | Victron Cyrix-ct 12/24-120 | 1 | VSR; substitui o PF 270 |
| 2 | Victron SmartSolar MPPT 100/50 | 2 | um por painel; rede VE.Smart |
| 3 | Victron SmartShunt 500 A | 1 | negativo do serviço |
| 4 | Painel Yingli PANDA 3.0 Pro 625 W | 2 | já escolhidos (Leroy Merlin); estrutura do teto à parte |
| 5 | Baterias AGM 96 Ah iguais às TK960 (Tudor TK960 / Exide EK960) | 4 | compra do dono; caixa, cintas |
| 6 | Barramentos 250 A (+ e −) | 2 + 2 | banco e distribuição; tampa isolante |
| 7 | Porta-fusível de borne MEGA + fusível 150 A | 6 | um por bateria de serviço |
| 8 | Porta-fusível Class T (ou MEGA) + fusível 250 A | 1 | principal do serviço |
| 9 | Corta-corrente ON/OFF 300 A | 1 | serviço (o de arranque, de chave vermelha, fica se estiver bom) |
| 10 | Porta-fusível MIDI/ANL + fusíveis 63 A | 2 | saída dos MPPT |
| 11 | Porta-fusível MEGA + fusíveis 100 A | 2 | Cyrix (um de cada lado) |
| 12 | Porta-fusível MEGA + fusível 150 A | 1 | alternador |
| 13 | Porta-fusível ANL + fusível 100–125 A | 1 | guincho (o porta-fusível existente serve se estiver bom) |
| 14 | Porta-fusível ANL + fusível 80 A | 1 | inversor |
| 15 | Porta-fusível MEGA + fusível 100 A (ou 150 A) | 1 | alimentação do quadro |
| 16 | Porta-fusíveis em linha + fusíveis 40 A | 2 | saídas do carregador de cais |
| 17 | Disjuntor 10 A no quadro | 1 | EV-100 ACU-100 |
| 18 | Porta-fusível ATO IP55 + fusível 5 A | 2 | Pi; recetor do guincho |
| 19 | Seccionador CC 2P 32 A | 2 | entre painel e MPPT (recomendado) |
| 20 | Isolador galvânico 16 A | 1 | terra do cais (recomendado) |
| 21 | Cabo estanhado 50 mm² (preto e vermelho) | [medir] | baterias ↔ barramentos, iguais |
| 22 | Cabo estanhado 35 mm² | [medir] | alternador, guincho, massa do motor |
| 23 | Cabo estanhado 16 mm² | [medir] | MPPT, Cyrix, inversor, quadro |
| 24 | Cabo solar 6 mm² + fichas MC4 + passa-cabos | 2 × [medir] | painéis |
| 25 | Cabo estanhado 2,5 / 4 mm² (vermelho/preto) | [medir] | circuitos do quadro, EV-100, Pi, frigorífico (4) |
| 26 | Terminais de cravar, manga termorretrátil com cola, etiquetas, abraçadeiras, calhas, tampas de borne | — | — |

Preços de referência (06/10 e 08/10): Cyrix-ct ~€65; SmartSolar 100/50 €169,95 cada (SVB); SmartShunt €91,54; painéis €93,44 cada (Leroy Merlin); baterias AGM 96 Ah ~€170–200 cada. O resto a cotar pelo eletricista.

## 11. Medidas e perguntas para o eletricista (primeira visita)

1. **[medir]** Comprimentos reais (ida) de: cada bateria aos barramentos; alternador → bateria de arranque; bateria de arranque → guincho; barramento → quadro; barramento → inversor; MPPT → barramento; painéis → MPPT (pelo arco e pelo convés).
2. **[ler]** Placa do guincho da âncora (modelo e potência: 700, 1000 ou 1200 W) e o valor do fusível ANL que lá está.
3. **[ler]** Placa do carregador Navicom (tensão de carga, corrente) e do módulo com dissipador por cima do PF 270.
4. **[ver]** O disjuntor branco de 230 V: diferencial 30 mA ou só magnetotérmico?
5. **[ver]** Os circuitos que o quadro atual tem, o estado dos disjuntores e dos cabos; que consumidores existem a bordo que não estejam neste caderno (frigorífico, bombas, luzes, rádio, aquecimento, etc.).
6. **[ver]** Onde cabem a 2.ª caixa das 4 baterias novas (28 kg cada), os MPPT, o Cyrix, os barramentos e o shunt (seco, ventilado, acessível).
7. **[ver]** Estado dos cabos do motor de arranque e do negativo ao bloco (terminais, óxido).
8. **[confirmar]** Que o corta-corrente de chave vermelha aguenta 300 A de arranque e está bom; senão substitui-se.

## 12. Ensaios de receção (com o dono presente)

1. Tudo desligado: continuidade e isolamento dos cabos novos; polaridade em todos os bornes; aperto de todos os terminais (chave dinamométrica nos pernos M8/M10).
2. Corta-correntes OFF: tensão de cada bateria de serviço (devem estar iguais a ±0,05 V) e da de arranque.
3. Ligar o corta-corrente de serviço: o SmartShunt lê 0 A sem consumidores; ligar o quadro, circuito a circuito, e ver a corrente de cada um (anotar).
4. Carregador de cais: ligar o cais; o shunt mostra corrente a entrar no serviço; a bateria de arranque sobe de tensão (pela saída 2 e pelo Cyrix).
5. Motor: ligar o motor; tensão na bateria de arranque 14,0 a 14,4 V; ao fim de 2 minutos o Cyrix fecha (LED) e o shunt mostra corrente a entrar no serviço.
6. Solar: com sol, cada MPPT mostra potência na app; corrente limitada a 30 A; o shunt soma as duas.
7. Guincho: subir e descer com o motor a trabalhar; medir a queda de tensão no motor do guincho (não deve passar de 10 %).
8. Inversor: ligar uma carga de 300 a 500 W durante 5 minutos; medir a tensão nos bornes do inversor (queda ≤ 3 %).
9. Bomba de porão: funciona com o corta-corrente de serviço desligado.
10. Pi e EV-100: arrancam nos seus circuitos; sem loops de terra (o Pi lê os instrumentos sem erros).
11. Etiquetas nas duas pontas de todos os cabos; fotografias finais de cada caixa e painel para o registo; este caderno atualizado com os comprimentos e os valores medidos.

## 13. Secções de cabo e queda de tensão

{{TABELA_CABOS}}

## 14. Regras de execução (resumo)

- ISO 10133 (CC a bordo), ISO 13297 (CA a bordo) e ABYC E-11.
- Fusível ou disjuntor em **todo** o ramal positivo, a menos de 180 mm (7 polegadas) da bateria ou do barramento; nunca mais de 4 terminais por perno; barramentos com tampa.
- Cabo náutico **estanhado**, multifilar, isolamento 105 °C; vermelho = positivo, preto ou amarelo = negativo; terminais cravados com alicate adequado e manga termorretrátil com cola; cabos apoiados de 45 em 45 cm; passagens em anteparas com borracha.
- Queda de tensão ≤ 3 % nos circuitos críticos (navegação, piloto, VHF, carga das baterias) e ≤ 10 % nos outros.
- Baterias presas, caixas ventiladas, bornes tapados; ácido livre só com respiros livres e de pé.
- Negativo único ligado ao bloco do motor; sem retornos pelo casco; Pi e instrumentos no mesmo negativo.

## 15. Fontes

NAVEGACAO.md §5b, §5c e §8b (ponto 15) do repositório do barco; fotos do inventário de 08/10/2026; fichas: Victron Cyrix-ct, SmartSolar 100/50, SmartShunt; Lofrans CB120012; Yingli PANDA 3.0 Pro 625 W; Exide/Tudor TK960; Volvo Penta D1-20 (alternador 115 A); ABYC E-11 (tabelas de corrente admissível e queda de tensão); ISO 10133 / ISO 13297.
