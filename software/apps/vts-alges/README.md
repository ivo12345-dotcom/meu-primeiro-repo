# VTS Algés — app Android

App simples para o telemóvel com o vento **medido** na estação meteorológica da torre VTS de Algés
(Porto de Lisboa), a direção e força **previstas** para as próximas 24 h, a **maré** em Alcântara
(medida, tabela do IH e sobre-elevação prevista) e a **pressão** (medida e prevista). Feita a 11/11/2026,
de madrugada, com o Arlequin a seco no CNA Algés e a depressão Charles a chegar.

## Onde vêm os dados

| Dado | Fonte | Como |
|---|---|---|
| Vento médio (30 min), direção, pressão | Estação da torre VTS (APL) | API AquaSafe da Hidromod, séries 664/667/663 |
| Previsão média de vento | ICON 7 km, servido pela APL | séries 679/681 |
| Rajadas e pressão previstas | AROME (Open-Meteo, `meteofrance_seamless`) | ponto 38,6939 N 9,2343 W |
| Maré | marégrafo de Alcântara (IH) + MOHID (Hidromod) | séries 849/758/759/1048 |
| Boia da barra | ondógrafo Triaxys da APL | séries 674/690/677/675 |
| Avisos | IPMA, distrito de Lisboa | `warnings_www.json` |

A estação **não mede rajadas** e publica com cerca de 1 h de atraso. As três APIs aceitam pedidos de
qualquer origem (CORS `*`), por isso a página corre tanto numa WebView como num browser.

## Estrutura

- `assets/index.html` — toda a app (HTML + CSS + JS, sem bibliotecas). É a mesma página que se publica como artefacto no claude.ai.
- `src/pt/arlequin/vtsalges/MainActivity.java` — concha nativa: uma WebView a carregar a página, ligações externas para o browser, tema claro/escuro a seguir o telemóvel.
- `AndroidManifest.xml`, `res/` — manifesto, ícone adaptativo e PNG de recurso.
- `build.sh` — constrói o APK só com o SDK (aapt2 → javac → d8 → zipalign → apksigner), sem Gradle.

## Construir

Precisa de JDK 17 (Temurin) e do SDK Android com `platforms;android-34` e `build-tools;34.0.0`
(instalados em `%LOCALAPPDATA%\Android\Sdk` com o `sdkmanager` das command-line tools).

```bash
bash software/apps/vts-alges/build.sh
```

O APK fica em `software/apps/vts-alges/out/vts-alges.apk` (assinado com a chave de debug
`~/.android/debug.keystore`; para atualizar a app no telemóvel sem desinstalar, assinar sempre com a mesma chave
e subir `VERSION_CODE`). Cópia de distribuição em `docs/apps/vts-alges.apk`.

## Instalar no Android

1. Copiar o APK para o telemóvel (ou abrir o ficheiro a partir desta conversa).
2. Ao abrir, o Android pede para permitir instalações desta origem (Chrome, Ficheiros…): permitir.
3. Instalar. A app chama-se **VTS Algés**, só precisa de Internet.
