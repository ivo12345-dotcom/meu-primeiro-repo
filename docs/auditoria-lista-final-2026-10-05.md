# Auditoria do sistema Arlequin — lista final para o Ivo

Data: 05/10/2026. Ramo `claude/piloto-automatico-cwnr0f`, só no portátil (sem push, como pediste).

## 1. O que foi feito

- **8 revisores** leram o projeto inteiro (cerca de 50 000 linhas de código, 27 000 delas de testes, e 14 000 de documentação): cálculo da rota, antes de sair e a navegar, ecrã, porto/Telegram, caixa negra e AI, sensores e AIS, documentação, invariantes transversais, e um 8.º só para "o que podia ser melhor".
- Encontraram, depois de juntar as repetições: **13 críticos, 48 importantes, 86 menores e 21 incoerências entre documentos**. Os 866 testes de então passavam todos: os erros estavam nos casos que ninguém tinha testado (rede má, sensores calados, reinícios, segurança ligada no Pi, ecrã pequeno).
- **Tudo foi corrigido** em 9 frentes de trabalho, cada uma revista por um revisor independente, com segundas e terceiras voltas onde a revisão achou mais problemas. No total **248 commits** sobre o ponto de partida da auditoria.
- **Testes agora: 1 371 em Node e 96 em Python, todos verdes.** O ecrã é medido num browser a sério, no tamanho do ecrã da roda (74 estados, 0 problemas). As viagens simuladas (Algés → Peniche, Peniche → Nazaré) e o reinício a meio da viagem foram repetidos depois das correções.
- A ronda final de acabamentos está feita: o gasóleo desconhecido no cálculo deixou de ter um número assumido, o Leme diz qual dos recursos não tem leitura e de que viagem é o «cheguei bem» por entregar, e os comentários e o NAVEGACAO foram atualizados.

## 2. As tuas decisões, já aplicadas

| Tema | O que decidiste |
|---|---|
| Âmbito | corrigir tudo (críticos, importantes, menores e documentos) |
| Apito contínuo | só perigo imediato: colisão AIS, fumo, água no porão, fuga de gasóleo, motor a sobreaquecer; o resto com apito curto |
| Ecrã no Pi | entra com conta normal (ler e escrever), nunca administrador; o diário passa por um plugin nosso |
| "Sair agora" com gasóleo curto ou sem previsão | faixa laranja "Não recomendado", nunca verde |
| Banco de serviço | 440 Ah (o sol com perdas, fator 0,65) |
| Portos conhecidos | só Peniche, Cascais e Algés |
| Piloto automático | **Raymarine EV-100 de roda (T70152)**, por comprar e instalar; até lá não há piloto nem reserva de governo além da cana de emergência |
| Solar (06/10) | **2 painéis Yingli PANDA 3.0 Pro de 625 W** (Leroy Merlin, €93,44 cada) em vez de 2 × 305 W: MPPT 100/50 por painel, fusíveis de 63 A, cabo de 16 mm²; o teto passa a ~2,3 × 2,5 m e ~70 kg de painéis e tem de ser redesenhado com as medidas do arco; o barco fica autónomo o ano todo sem piloto e, com o EV-100, só no inverno fica no equilíbrio |
| Largar do porto | sem o motor a trabalhar, o alarme "o barco saiu do lugar" só se apaga com "Larguei" (ecrã ou Telegram); com o alarme armado nunca se apaga sozinho |
| Bomba de porão a trabalhar muito | apito contínuo (conta como água no porão) |
| Fumo depois de "reconhecer" | bip curto de 2 em 2 minutos enquanto houver fumo; se passar e voltar, contínuo outra vez |
| AIS dentro de um porto | a menos de 0,5 MN de um porto conhecido e abaixo de 4 nós, os alvos parados ficam a amarelo sem som; um alvo em movimento apita sempre |
| Roda com travão | confirmado (29/09): o motor em calma conta metade nas horas ao leme |
| Mensagem de atraso para terra | só com 30 min ou mais sobre a chegada mais tarde, só com o barco a avançar, e no máximo 3 h de adiamento sem o teu "Estou bem" |

## 3. Decisões que tomei por ti (seguindo as recomendações escritas) — podes mudar qualquer uma

| # | O que ficou |
|---|---|
| 3 | AIS: dois barcos parados não são colisão; um alvo em movimento alarma sempre; connosco amarrados, só os alvos parados se calam |
| 5 | Rotas longas: a linha corta as baías por cordas que respeitam o afastamento e as zonas; aceitam-se passagens até ao fim da previsão (48 h) |
| 7 | A regra "a 3 MN só com vento de terra" vale também nas ligações ao largo de partida e de chegada |
| 8 | A corrente da barra do Tejo deixa de fora a entrada da marina de Cascais |
| 9 | No mar, "Volta ou abriga-te" pode apontar para o destino quando é o abrigo mais perto (avalia também a rota direta e o só-motor). **Efeito:** perto do destino nunca manda para outro porto (ex.: junto a Oeiras, de noite, dá "Espera até amanhã" e não "Volta a Cascais") |
| 10 | Visibilidade: 5 km nos três sítios |
| 11 | Viragem: 40° nas manobras do cálculo e 45° nos lembretes a navegar (de propósito, explicado no código) |
| 13 | Ativar recusa um cálculo antigo (como o envio); um envio já fechado nunca se reaproveita |
| 14 | O aviso de 60 min antes do alarme em terra conta pela hora mais cedo que algum contacto tenha |
| 15 | Plano enviado e nunca ativado: aviso 60 min antes da hora de alarme ("ativa-o ou avisa-os"), que fica até ativares/fechares ou 24 h depois |
| 16 | Contacto que nunca recebe: desiste-se à hora de alarme desse contacto, só quando a falha é dele (outro contacto ou tu receberam); sem rede nunca se desiste; recebes "desisti de entregar a X: liga-lhe" |
| 17 | Alarmes do porto que o Telegram não aceitou: insiste até entregar, com recuo até 1 min e "(atrasado N min)"; os alarmes passam à frente; uma mensagem recusada 3 vezes sai com aviso para ti; a fila guarda 100 mensagens |
| 18 | NAVEGACAO: "não desligues o quadro antes do 'cheguei bem', ou carrega em Terminar" |
| 19 | Relógio do Pi a mais de 60 s do GPS: aviso no Leme e no Telegram; não se envia o plano nem corre o acompanhamento |
| 21 | Cores da correção BB/EB clareadas de noite (contraste ≥ 3:1 no brilho 2) |
| 22 | Fuso: `Europe/Lisbon` no Pi; o ecrã e os textos dos plugins em hora de Lisboa |
| 23 | Água sem sensor: "sem sensor"; com sensor e sem "Enchi": "nível por confirmar" |
| 24 | Ponto de amarração: grava-se sozinho só junto a um porto conhecido; no mar nunca |
| 25 | Portos das saídas da caixa negra: os 15 destinos da rota mais os extras (Ericeira) |
| 26 | Modelos da AI treinados no portátil chamam-se `pNNNN` e só vão para o Pi por cópia confirmada |
| 27 | As tabelas de dados falsos do portátil (30/09 e 01/10) foram movidas para uma pasta de arquivo, não apagadas |
| 29 | PDFs refeitos a partir dos documentos corrigidos; a página "explicado" de 29/09 ficou marcada como histórico |
| 30 | README da raiz passou a um índice do projeto |
| — | Uma configuração antiga com 200 Ah é trocada por 440 Ah uma única vez (fica registado em `migracoes.json`) |
| — | Gasóleo desconhecido no cálculo (sonda perdida ou leitura velha): só o aviso vermelho "gasóleo inicial desconhecido: confirma o depósito", sem litros assumidos. **A bateria desconhecida igual (pediste-o a 05/10):** sem os 80 % assumidos, a regra dos 50 % não corre, o cartão diz "bateria desconhecida" e fica o aviso vermelho "estado da bateria desconhecido: confirma a carga" |
| — | O "silenciar" de um alarme sobrevive 3 min ao reinício de um plugin (o fumo fica de fora: volta a apitar) |
| — | Mensagens para terra muito atrasadas dizem "(atrasado mais de 7 dias)" em vez de contar para sempre |

## 4. Por confirmar por ti (no barco, nos papéis ou na carta)

**Na carta (desde a 3a):** os Cachopos e o canal da Barra Norte/Carcavelos; a entrada e o enfiamento de Algés; os pontões interiores de Cascais e Lagos; a linha do Canal da Berlenga; todos os portos e zonas marcados `confirmado:false`.

**Dados do barco:** o ano do casco (papéis ou número do casco); a capacidade de cada depósito de água (o plugin assume 2 × 80 L; de origem 182 L); o comprimento do cabo do ecrã da roda; as medidas do arco e do fim da retranca para o teto dos painéis de 625 W (2,27 × 2,47 m); o peso real carregado (estimativa 7,2 t).

**Antes de comprar:**
- **drizas:** mede as velhas — com o mastro de 14,17 m a regra dá ~30–31 m, e a lista tinha 25, 28 e 30 m;
- **EV-100 de roda:** diâmetro da roda, número de raios e pedestal (compatibilidade da unidade), e o preço no dia (SVB 1 860,45 € com IVA; NautiRadar 2 370 €).

**No Pi, quando montares:** a receita da `can1` (nome fixo, arrancar sozinha, antes do SignalK); a saída de som (o Pi 5 não tem ficha de 3,5 mm: HDMI do ecrã ou placa USB); correr `npm run verificar-ecra` no Chromium do Pi (letra DejaVu); a leitura de noite no brilho 2; a sessão do ecrã com a segurança ligada (prazo e se a conta normal consegue calar alarmes); ao arrancar o motor, confirmar "a trabalhar" no ecrã (um fio CAN solto parece ignição desligada).

**AI:** se houver modelos treinados antes de 02/10 (com a previsão da célula de terra), tirar-lhes o "atual" até haver saídas com a previsão nova. No portátil não há nenhum.

**Perguntas em aberto:** os destinos que acrescentas no ecrã não contam como portos (caixa negra, amarração, AIS) — queres que contem? Os plugins da energia, gasóleo e água têm um campo de token do diário — fica ou sai?

## 5. Limitações que ficam escritas (e que convém saberes)

- Sem piloto automático até o EV-100 estar montado: o cálculo da rota conta sempre contigo ao leme. Depois de montado, revemos a regra das 8 h e ligamos o piloto ao sistema.
- Com o EV-100 de roda o barco carregado (~7,2 t) anda perto do limite de 7 500 kg: rizar cedo com mar de popa.
- O som dos alarmes depende do browser e da saída HDMI: um besouro ligado ao Pi é a melhoria n.º 1 da lista abaixo.
- Dentro de um porto, um navio parado no teu caminho não apita (só amarelo). Afinação possível: apitar em porto com passagem a menos de 30 m e menos de 1 minuto.
- Um fio CAN solto, com o adaptador ligado, parece "motor desligado".
- Sem a velocidade no AIS (nossa ou do alvo), a velocidade é estimada pelas posições: um navio a 12 nós de proa dá ~14 min de aviso (era 2,4).
- As regras do porto (lembrete de armar, bomba de porão) usam a hora de parede: um salto do relógio ao ligar o 4G pode disparar um aviso.

## 6. Melhorias propostas — para escolheres (não são erros)

As 10 com mais segurança por esforço (S = até 1 dia, M = 2–5 dias, L = mais):

1. **Som que não depende do browser** (M): dois besouros de 12 V no poço e na cabine, comandados por um plugin, com as mesmas regras do ecrã.
2. **Sensores calados têm de se ouvir** (S): aviso quando a posição, a proa, o vento, o fundo ou a bateria ficam velhos; chips vivos na barra (parte já feita: motor, gasóleo).
3. **Alarme de pouca água** (S): aviso a 5 m e alarme a 3 m, só a navegar (limites a decidir por ti).
4. **Homem ao mar** (S–M): botão MOB fixo (grava posição, apita, mostra marcação e distância); balizas AIS SART/MOB/EPIRB = emergência.
5. **Prova de vida e vigia a solo** (M): o "tudo bem" automático para terra só sai se houve um toque teu na última hora; um vigia de 15–20 min que apita.
6. **Cadeia para terra mais robusta** (S–M): o aviso "os contactos ligam ao MRCC às HH:MM" também no teu Telegram; a última posição em cada atraso; um ficheiro de calendário com a hora de alarme; uma folha para quem fica em terra; um ensaio com os contactos; SMS de reserva pelo router.
7. **Supervisão** (S–M): o SignalK e o Chromium reiniciam sozinhos se caírem; cão de guarda do Pi; sessão do ecrã que não caduca.
8. **Relógio como condição** (feito em parte): já recusa o plano com o relógio errado; falta o aviso no Telegram.
9. **Instalação num só script, cópia offline e ensaio no porto** (M): `instalar.sh`/`verificar.sh`; cópia mensal para uma pen (`git bundle` + configuração cifrada); um segundo SSD clonado a bordo; uma lista de 20 ensaios no porto antes da primeira saída.
10. **Modo "Fundear"** (S–M): um toque grava a âncora; raio = corrente largada + barco; alarme de garrar local e no Telegram.

Outras: o que falta no Leme numa passagem longa (fundo, SOG, alvo AIS mais perigoso, horas ao leme); teclas para mãos molhadas; noite sugerida ao pôr do sol; partir o `index.js` da rota em módulos; um pacote comum para o que se repete entre plugins; página de saúde do sistema; atualizar e voltar atrás no Pi; quando confiar na AI (mapa de cobertura, aviso quando discorda da polar); mais do que um modelo de previsão; cartão rápido e cartão de emergência plastificados para quem leve o barco; ponte NMEA 2000; regras do piloto quando vier.

## 7. Próximos passos

1. Acabar a ronda de acabamentos (a correr) e fazer o PDF de apresentação (técnico, sem custos, com o material já a bordo e a instalar, os sensores e o EV-100 de roda).
2. Escolheres as melhorias da secção 6 e responderes ao que está na secção 4.
3. Montar o Pi em casa e seguir a secção "Instalar no Pi" do NAVEGACAO (16 passos por ordem).
4. Ensaios no porto, depois a primeira passagem curta com tudo ligado.
