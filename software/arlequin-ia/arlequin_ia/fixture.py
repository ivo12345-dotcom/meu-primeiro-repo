"""python -m arlequin_ia.fixture SAIDA.json.gz — um modelo pequeno de velocidade
e casos (com valores em falta) com as previsões do próprio LightGBM, para o
plugin da AI testar o avaliador em JavaScript contra o original."""

import gzip
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from .__main__ import POLAR
from .base import ler_polar
from .treino import carregar, prever_guardado, treinar
from .sintetico import gerar


def main(saida):
    polar = ler_polar(POLAR)
    with tempfile.TemporaryDirectory() as d:
        gerar(d, polar)
        treinar(d, polar, agora=pd.Timestamp('2026-06-20T12:00:00Z'), modelos=['velocidade'])
        m = carregar(Path(d, 'modelos', 'velocidade'), 'v0001')
    rng = np.random.default_rng(3)
    # as variáveis de planeamento da velocidade (treino.MODELOS): o vento é a previsão em bruto
    ptws = rng.uniform(3, 26, 60)
    x = pd.DataFrame({'prevTws': ptws, 'twaAbs': rng.uniform(30, 180, 60), 'prevRajada': ptws * rng.uniform(1.1, 1.6, 60),
                      'prevOndas': rng.uniform(0, 4, 60), 'prevPeriodo': rng.uniform(4, 14, 60),
                      'ondasAnguloRel': rng.uniform(0, 180, 60), 'grandeRizos': rng.integers(-1, 3, 60),
                      'genoaPct': rng.choice([0, 50, 70, 100], 60)})[m['variaveis']].astype(float)
    for col, cada in (('prevOndas', 3), ('prevRajada', 4), ('prevTws', 11), ('genoaPct', 7)):
        if col in x.columns:
            x.loc[x.index[::cada], col] = np.nan
    casos = [{'x': {k: (None if pd.isna(v) else float(v)) for k, v in linha.items()},
              **{q: float(prever_guardado(m, x.iloc[[i]], q)[0]) for q in ('p10', 'p50', 'p90')}}
             for i, (_, linha) in enumerate(x.iterrows())]
    modelo = {k: v for k, v in m.items() if k != 'nativo'}
    with open(saida, 'wb') as f:
        f.write(gzip.compress(json.dumps({'modelo': modelo, 'casos': casos}).encode('utf-8')))


if __name__ == '__main__':
    main(sys.argv[1])
