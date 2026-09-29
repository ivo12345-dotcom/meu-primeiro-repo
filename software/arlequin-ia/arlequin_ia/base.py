"""O que se sabia antes de aprender: a polar de origem e a curva de consumo da
Volvo. Servem de comparação ao 1.º modelo e para as frases do cartão."""

from pathlib import Path

import numpy as np

CURVA_VOLVO = [(850, 0.4), (1200, 0.5), (1400, 0.7), (1600, 0.9), (1800, 1.0), (2000, 1.3),
               (2200, 1.6), (2400, 2.0), (2600, 2.4), (2800, 3.0), (3000, 3.7), (3200, 4.6)]


def ler_polar(caminho):
    """CSV 'TWA;TWS6;TWS10;…' (linhas # são comentários) → (tws[], twa[], v[twa][tws]) em nós e graus."""
    linhas = [l.strip() for l in Path(caminho).read_text(encoding='utf-8').splitlines()]
    linhas = [l for l in linhas if l and not l.startswith('#')]
    tws = [float(''.join(ch for ch in c if ch.isdigit() or ch == '.')) for c in linhas[0].split(';')[1:]]
    twa, v = [], []
    for l in linhas[1:]:
        c = [float(x) for x in l.split(';')]
        twa.append(c[0])
        v.append(c[1:])
    return np.array(tws), np.array(twa), np.array(v)


def stw_polar(polar, twa_abs, tws):
    """Velocidade da polar (nós) por interpolação bilinear; 0 no ângulo morto; NaN sem dados."""
    ptws, ptwa, pv = polar
    twa_abs = np.asarray(twa_abs, dtype=float)
    tws = np.asarray(tws, dtype=float)
    a = np.clip(twa_abs, ptwa[0], ptwa[-1])
    w = np.clip(tws, ptws[0], ptws[-1])
    i = np.clip(np.searchsorted(ptwa, a) - 1, 0, len(ptwa) - 2)
    j = np.clip(np.searchsorted(ptws, w) - 1, 0, len(ptws) - 2)
    fi = (a - ptwa[i]) / (ptwa[i + 1] - ptwa[i])
    fj = (w - ptws[j]) / (ptws[j + 1] - ptws[j])
    v = (pv[i, j] * (1 - fj) + pv[i, j + 1] * fj) * (1 - fi) + (pv[i + 1, j] * (1 - fj) + pv[i + 1, j + 1] * fj) * fi
    v = np.where(twa_abs < ptwa[0], 0.0, v)
    return np.where(np.isnan(twa_abs) | np.isnan(tws), np.nan, v)


def litros_volvo(rpm):
    """L/h da curva da Volvo (0 com o motor parado)."""
    rpm = np.asarray(rpm, dtype=float)
    r = [c[0] for c in CURVA_VOLVO]
    l = [c[1] for c in CURVA_VOLVO]
    return np.where(rpm > 300, np.interp(rpm, r, l), 0.0)
