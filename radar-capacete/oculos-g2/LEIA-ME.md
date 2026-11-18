# Radar nos óculos Even Realities G2

A app mostra o radar na **metade esquerda** da imagem dos óculos (aparece nos dois olhos, o cérebro junta numa só).
Fundo preto = lente transparente; só os anéis, a seta e os alvos acendem a verde.
Esconder/mostrar **só pelo telemóvel** (sem anel, sem tocar nos óculos):
- botão **👓 ON/OFF** no topo da página do radar (http://192.168.4.1), ou
- botão grande **ESCONDER / MOSTRAR RADAR** na página da própria app.

## Quando os óculos chegarem (primeiro teste)

1. Instalar a app **Even Realities** no telemóvel (versão 2.2.10 ou mais recente) e emparelhar os G2.
2. Ligar o power bank à caixa do radar e o telemóvel à rede Wi‑Fi **RADAR-CAPACETE** (palavra-passe airsoft123).
   Se o Android perguntar "esta rede não tem internet, manter ligação?", responder **sim**.
3. Na app Even, ativar o **modo de programador** (Even Hub → dev mode) e ler o código QR gerado no PC com:

   ```
   cd radar-capacete/oculos-g2
   npx evenhub qr --url http://192.168.4.1/g2
   ```

   A app passa a ser carregada **da própria placa do radar** — não precisa de internet nem de autorizações de rede.
4. Deve aparecer o radar nos óculos. Testar o botão 👓 no telemóvel (esconde/mostra em menos de 1 s).

Alternativa (pacote instalado): `radar-capacete.ehpk` (feito com `npx evenhub pack app.json dist -o radar-capacete.ehpk`).
Tem a autorização de rede para `http://192.168.4.1` no `app.json`. Ainda não foi testado em óculos reais.

## Para programar

- Construir: `node tools/build.mjs` → `dist/` (pacote) e `../src/g2_app.h` (a placa serve em `/g2`; depois **gravar a placa**).
- Testar sem óculos nem placa:
  - `node tools/fake_radar.mjs ../gravacoes/<gravação>.txt 8080` (placa a fingir, reproduz a caixa negra)
  - simulador: `node_modules/@evenrealities/sim-win32-x64/bin/evenhub-simulator.exe "http://127.0.0.1:8080/?radar=" --automation-port 9898`
  - foto do ecrã dos óculos: `GET http://127.0.0.1:9898/api/screenshot/glasses`
- Limites do G2: ecrã 576×288 verde, imagens até 288×144 cada (o radar usa 2), texto com brilho 0–4.

## Testado (simulador oficial 0.9.5, 18/11/2026)

- Desenho do radar com dados reais da gravação: OK.
- Leitura da placa: mesma origem OK; outra origem só com autorização CORS (já posta na placa).
- Botão do telemóvel esconde (0 pixéis acesos) e volta: OK. Toque duplo nos óculos é ignorado (de propósito).
- Por confirmar só nos óculos reais: se a app Even deixa abrir `http://192.168.4.1` (o caminho do QR acima é o mais provável de funcionar).
