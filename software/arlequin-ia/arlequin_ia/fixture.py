"""python -m arlequin_ia.fixture SAIDA.json.gz [--modelo NOME] — um modelo pequeno (por omissão o da velocidade;
também ventoForca, ventoDirecao ou consumo) e casos (com valores em falta) com as previsões do próprio LightGBM,
para o plugin da AI testar o avaliador em JavaScript contra o original (signalk-arlequin-ia/test/fixtures/<nome>.json.gz)."""

import argparse
import gzip
import json
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from .__main__ import POLAR
from .base import ler_polar
from .treino import MODELOS, carregar, prever_guardado, treinar
from .sintetico import gerar


def casos_velocidade(rng):
    # as variáveis de planeamento da velocidade (treino.MODELOS): o vento é a previsão em bruto
    ptws = rng.uniform(3, 26, 60)
    x = pd.DataFrame({'prevTws': ptws, 'twaPrevAbs': rng.uniform(30, 180, 60), 'prevRajada': ptws * rng.uniform(1.1, 1.6, 60),
                      'prevOndas': rng.uniform(0, 4, 60), 'prevPeriodo': rng.uniform(4, 14, 60),
                      'ondasAnguloRel': rng.uniform(0, 180, 60), 'grandeRizos': rng.integers(-1, 3, 60),
                      'genoaPct': rng.choice([0, 50, 70, 100], 60)})
    return x, (('prevOndas', 3), ('prevRajada', 4), ('prevTws', 11), ('genoaPct', 7))


def casos_vento(rng):
    # as variáveis dos dois modelos do vento (treino.VARS_VENTO), à volta dos dados inventados (39 N 9,6 W)
    x = pd.DataFrame({'latCel': rng.choice([38.9, 39.0, 39.1], 60), 'lonCel': rng.choice([-9.7, -9.6], 60),
                      'prevTws': rng.uniform(2, 24, 60), 'prevTwd': rng.uniform(0, 360, 60),
                      'horaDia': rng.uniform(0, 24, 60), 'idadePrevH': rng.uniform(0, 12, 60),
                      'tendPressao3h': rng.uniform(-6, 3, 60)})
    return x, (('tendPressao3h', 3), ('prevTws', 7), ('idadePrevH', 5), ('prevTwd', 11))


def casos_consumo(rng):
    x = pd.DataFrame({'rpm': rng.uniform(800, 3000, 60), 'prevOndas': rng.uniform(0, 4, 60),
                      'ondasAnguloRel': rng.uniform(0, 180, 60)})
    return x, (('prevOndas', 3), ('ondasAnguloRel', 4), ('rpm', 13))


CASOS = {'velocidade': casos_velocidade, 'ventoForca': casos_vento, 'ventoDirecao': casos_vento, 'consumo': casos_consumo}


def main(saida, nome='velocidade'):
    polar = ler_polar(POLAR)
    with tempfile.TemporaryDirectory() as d:
        gerar(d, polar)
        treinar(d, polar, agora=pd.Timestamp('2026-06-20T12:00:00Z'), modelos=[nome])
        m = carregar(Path(d, 'modelos', nome), 'v0001')
    rng = np.random.default_rng(3)
    x, faltas = CASOS[nome](rng)
    x = x[m['variaveis']].astype(float)
    for col, cada in faltas:
        if col in x.columns:
            x.loc[x.index[::cada], col] = np.nan
    casos = [{'x': {k: (None if pd.isna(v) else float(v)) for k, v in linha.items()},
              **{q: float(prever_guardado(m, x.iloc[[i]], q)[0]) for q in ('p10', 'p50', 'p90')}}
             for i, (_, linha) in enumerate(x.iterrows())]
    modelo = {k: v for k, v in m.items() if k != 'nativo'}
    with open(saida, 'wb') as f:
        f.write(gzip.compress(json.dumps({'modelo': modelo, 'casos': casos}).encode('utf-8')))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(prog='arlequin_ia.fixture')
    ap.add_argument('saida')
    ap.add_argument('--modelo', default='velocidade', choices=list(MODELOS))
    a = ap.parse_args()
    main(a.saida, a.modelo)
