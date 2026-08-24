# Rodado

App Android para quem anda em TVDE: junta os ganhos das plataformas aos custos
reais do carro e diz o que sobra mesmo — por turno, por bloco horário, por zona
e por mês.

## O que já funciona

- **Núcleo de cálculo** (`:core`, Kotlin puro, com testes): líquido, €/hora,
  €/km, km com cliente vs km vazios, custo de energia por 100 km, custos fixos
  mensalizados. Os números batem certo com a folha de cálculo que lhe deu
  origem.
- **Importação dos extratos** em CSV, com deteção automática do separador, do
  formato dos números (`1.234,56` ou `1,234.56`) e da ordem das datas, e
  correção manual das colunas quando a deteção falha.
- **Relatório de frota** "Ganhos por motorista": uma linha por motorista e por
  semana, com as horas deduzidas a partir dos ganhos por hora.
- **Ligação à Tesla**: odómetro e histórico de carregamentos pela Fleet API.

## Estrutura

| Módulo | O que é |
|---|---|
| `core/` | Modelo e cálculos. Kotlin puro, sem Android — é onde estão os testes. |
| `app/`  | App Android: Room, Compose, WorkManager, cliente da Tesla. |
| `web/`  | Página de retorno do login da Tesla, para alojar no teu domínio. |

## Compilar

O APK é compilado automaticamente pelo GitHub Actions a cada alteração
(separador **Actions** → última execução → **rodado-apk**).

Localmente, com o SDK do Android instalado:

```bash
cd rodado
./gradlew :app:assembleDebug
```

Em máquinas sem SDK do Android dá para correr na mesma os testes da matemática:

```bash
cd rodado
./gradlew -PcoreOnly=true :core:test
```

## Ligar a Tesla

A Tesla obriga cada pessoa a registar a sua própria aplicação. É preciso:

1. Um domínio teu.
2. Registo em `developer.tesla.com`, com o domínio indicado.
3. A chave pública que a Tesla te pede, alojada em
   `https://<o-teu-dominio>/.well-known/appspecific/com.tesla.3p.public-key.pem`.
4. A página `web/callback.html` alojada no endereço de retorno que registares.
5. Client ID, Client Secret e endereço de retorno colados nas definições da app.

Depois do login, a Tesla envia-te para a página de retorno com o código; copia-o
para a app para concluir a ligação. Os tokens ficam guardados na área privada da
app, no telemóvel.

## Privacidade

Tudo fica no telemóvel: não há servidor nenhum. A app só fala com a Tesla, e só
para ler o odómetro e os carregamentos.
