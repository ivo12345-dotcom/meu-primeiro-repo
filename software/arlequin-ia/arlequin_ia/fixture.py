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
    x = pd.DataFrame({'tws': rng.uniform(3, 26, 60), 'twaAbs': rng.uniform(30, 180, 60), 'rajada': rng.uniform(4, 34, 60),
                      'prevOndas': rng.uniform(0, 4, 60), 'prevPeriodo': rng.uniform(4, 14, 60),
                      'ondasAnguloRel': rng.uniform(0, 180, 60), 'balAdorno': rng.uniform(0, 5, 60),
                      'balCaimento': rng.uniform(0, 5, 60), 'adornoAbs': rng.uniform(0, 25, 60),
                      'grandeRizos': rng.integers(-1, 3, 60), 'genoaPct': rng.choice([0, 50, 70, 100], 60),
                      'rpm': rng.choice([0, 0, 0, 1800, 2200], 60)})[m['variaveis']].astype(float)
    for col, cada in (('prevOndas', 3), ('balAdorno', 4), ('tws', 11), ('rpm', 7)):
        x.loc[x.index[::cada], col] = np.nan
    casos = [{'x': {k: (None if pd.isna(v) else float(v)) for k, v in linha.items()},
              **{q: float(prever_guardado(m, x.iloc[[i]], q)[0]) for q in ('p10', 'p50', 'p90')}}
             for i, (_, linha) in enumerate(x.iterrows())]
    modelo = {k: v for k, v in m.items() if k != 'nativo'}
    with open(saida, 'wb') as f:
        f.write(gzip.compress(json.dumps({'modelo': modelo, 'casos': casos}).encode('utf-8')))


if __name__ == '__main__':
    main(sys.argv[1])
