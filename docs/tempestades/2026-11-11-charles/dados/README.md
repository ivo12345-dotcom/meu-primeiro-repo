# Charles (11/11/2026): os dados em que cada boletim assenta

Uma previsão não se volta a descarregar igual, porque os modelos são recalculados várias vezes por dia.
Por isso ficam aqui, tal como chegaram, os dados das duas corridas que deram boletim. Com eles o
`charles.py` volta a dar os mesmos números, sem rede.

| Pasta | Descarga (UTC, igual à hora de Lisboa) | Boletim que saiu dela |
|---|---|---|
| `corrida-2026-11-10T2150Z/` | 10/11, das 21:50 às 22:04 | `../boletim-2026-11-10T2218Z.pdf` |
| `corrida-2026-11-11T0953Z/` | 11/11, das 09:53 às 09:54 | `../boletim-2026-11-11T1000Z.pdf` (o mesmo ficheiro que `../ultimo.pdf`) |

## O que há em cada pasta

| Ficheiro | O que é | Fonte |
|---|---|---|
| `om_grelha_fina_ecmwf_ifs025.json` e `om_grelha_fina_gfs_seamless.json` | grelha de 0,5° (391 pontos), hora a hora: pressão ao nível do mar, vento, rajada e direção | Open-Meteo, modelos ECMWF IFS e GFS |
| `om_grelha_mar.json` | grelha de 1° (108 pontos), hora a hora: altura, período e direção das ondas | Open-Meteo Marine |
| `om_pontos.json` | séries em 6 pontos (ao largo de Cascais, barra do Tejo, Espichel, Sines, Berlengas e 60 MN ao largo): atmosfera em 5 modelos e mar | Open-Meteo |
| `ipma_avisos.json`, `ipma_obs.json`, `ipma_estacoes.json` | avisos, observações horárias das estações e a lista das estações | IPMA |
| `apl_barra.json` | tabela de maré do IH em Alcântara e boia ondógrafo da barra (só na corrida de 11/11) | Porto de Lisboa |
| `resumo.json` | o resultado do cálculo: trajetórias dos centros, entrada em terra e passagem mais próxima de Algés, máximos nos pontos e na faixa costeira, as simulações e os avisos de vento | `charles.py` |

O `resumo.json` da véspera foi recalculado a 11/11 com o script atual, que segue vários centros, para as
duas corridas se compararem com o mesmo método. O boletim das 22:18 de 10/11 saiu do script de então
(commit `0ab39ac`), que seguia um só centro.

## Voltar a calcular

Precisa de Python 3.12 com `numpy`, `shapely` e `matplotlib`. Na raiz do repositório:

```bash
python software/ferramentas/tempestade/charles.py --pasta-dados docs/tempestades/2026-11-11-charles/dados/corrida-2026-11-11T0953Z --sem-descarregar --sem-boletim
```

O comando reescreve o `resumo.json` dessa pasta. Para ver que chaves mudaram em relação ao que está no git:

```bash
python -c "import json,subprocess;p='docs/tempestades/2026-11-11-charles/dados/corrida-2026-11-11T0953Z/resumo.json';a=json.loads(subprocess.check_output(['git','show','HEAD:'+p]));b=json.load(open(p,encoding='utf-8'));print([k for k in a if a[k]!=b.get(k)])"
```

Deve responder `['dados_de']` e mais nada. O `dados_de` é a data do ficheiro da grelha ECMWF no disco e,
num clone, passa a ser a hora do clone; as horas verdadeiras das descargas são as da tabela de cima.
Verificado a 11/11/2026 nas duas pastas: tirando essa chave, zero diferenças.

Outras opções do script:

- sem `--sem-boletim` escreve também um boletim novo em `docs/tempestades/2026-11-11-charles/` (o PDF
  precisa do Chrome), com a hora de agora marcada nas tabelas;
- com `--anterior <pasta da corrida anterior>` o boletim ganha a secção "O que mudou desde a corrida
  anterior";
- sem `--sem-descarregar` vai buscar a previsão de agora e escreve por cima dos ficheiros da pasta.
