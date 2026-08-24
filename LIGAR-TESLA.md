# Ligar a app à Tesla

Guia da ordem exata dos passos. A ordem importa: a Tesla só aceita o registo do
domínio depois de conseguir ir lá buscar a chave pública, e só aceita o login
depois do domínio registado.

---

## 1. Comprar o domínio

Qualquer domínio serve, e nunca vais ter de o mostrar a ninguém — é só para a
Tesla confirmar que é teu. Um `.com` custa cerca de 10 €/ano.

Onde comprar: Cloudflare, Namecheap, Porkbun, ou um registrador português como a
Amen ou a PTisp se preferires suporte em português.

**Depois de comprares, diz-me qual é** — preciso dele para configurar o resto.

---

## 2. Ligar o domínio ao GitHub Pages

O site já está feito, na pasta `docs/` deste repositório. Falta publicá-lo.

**No GitHub:** Settings → Pages → em *Source* escolhe **Deploy from a branch**,
seleciona a branch e a pasta **`/docs`**, e Save.

**Ainda em Settings → Pages:** no campo *Custom domain* escreve o teu domínio e
Save. Espera uns minutos e liga o **Enforce HTTPS**.

**No teu registrador de domínios**, cria os registos que o GitHub indica nessa
mesma página (normalmente quatro registos `A` para o domínio e um `CNAME` para o
`www`).

**Confirma que resultou** abrindo no browser:

```
https://<o-teu-dominio>/.well-known/appspecific/com.tesla.3p.public-key.pem
```

Tem de aparecer um texto que começa por `-----BEGIN PUBLIC KEY-----`. Se der 404,
não avances — a Tesla vai bater na mesma porta e vai receber o mesmo 404.

---

## 3. Registar a aplicação no portal da Tesla

Vai a **developer.tesla.com** e entra com a tua conta Tesla normal. Cria uma
aplicação com:

| Campo | O que pôr |
|---|---|
| Nome | Rodado |
| Descrição | Controlo pessoal de atividade TVDE: quilómetros por turno e custo real de energia. |
| Website | `https://<o-teu-dominio>` |
| Política de privacidade | `https://<o-teu-dominio>/privacidade.html` |
| Origem permitida | `https://<o-teu-dominio>` |
| Endereço de retorno | `https://<o-teu-dominio>/tesla/callback/` |
| Região | Europa, Médio Oriente e África |

**Permissões a pedir** — só estas três, e mais nenhuma:

- `openid` e `offline_access` (manter a sessão sem voltar a pedir login)
- `vehicle_device_data` (ler o odómetro)
- `vehicle_charging_cmds` (ler o histórico de carregamentos)

Não peças acesso à localização nem a comandos. Não fazem falta para isto, e
quanto menos pedires menos há a correr mal.

No fim ficas com um **Client ID** e um **Client Secret**. Guarda-os.

---

## 4. Preencher e registar, dentro da app

Abre a app → **Definições** → secção **Tesla**:

1. Cola o **Client ID** e o **Client Secret**.
2. Endereço de retorno: `https://<o-teu-dominio>/tesla/callback/`
3. Região: **Europa**.
4. Carrega em **Guardar dados da aplicação**.

Depois, pela ordem dos botões:

**1. Registar o domínio na Tesla** — passo único. Se falhar aqui, quase de certeza
é a chave pública que ainda não está a ser servida no domínio (volta ao passo 2).

**2. Iniciar sessão na Tesla** — abre o browser, entras com a tua conta e
autorizas. A Tesla devolve-te à página do teu domínio, que mostra um código com
um botão para copiar.

**3. Concluir ligação** — colas o código na app e pronto.

A partir daí a app lê o carro de quinze em quinze minutos sozinha, e a sessão
renova-se sem voltares a fazer nada.

---

## A chave privada

Foi gerada uma chave privada em par com a pública que está no domínio. **Não está
no repositório de propósito** — foi-te entregue à parte, para guardares num sítio
seguro.

Para o que a app faz (ler o odómetro e os carregamentos) essa chave nunca é usada.
Só faria falta se um dia quisesses enviar comandos ao carro — trancar portas, ligar
a climatização — porque esses têm de ser assinados. Se a perderes, gera-se outro
par e substitui-se o ficheiro no domínio.

---

## Se alguma coisa correr mal

**O registo do domínio dá erro** → confirma que o endereço da chave pública abre
no browser, e que o Client Secret está certo.

**O login corre bem mas os dados são recusados** → faltou o passo do registo do
domínio, ou foi feito noutra região.

**"O carro está a dormir"** → é normal e não é erro. A app não o acorda de
propósito, porque acordá-lo gasta bateria. Da próxima vez que entrares no carro,
os quilómetros entram.
