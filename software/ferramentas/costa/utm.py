"""Transversa de Mercator (UTM, WGS84) em numpy, de ida e volta, pelas séries de Krüger até n⁴
(Karney 2011): erro abaixo do milímetro em toda a costa continental. O pyproj não se usa aqui
(no portátil do Ivo a política do Windows bloqueia a DLL dele).

Por omissão é o fuso 29N (meridiano central 9° W), o da costa portuguesa."""

import numpy as np

A_WGS84 = 6378137.0
F_WGS84 = 1 / 298.257223563
K0 = 0.9996
LON0 = -9.0          # fuso 29
FALSO_ESTE = 500000.0

_n = F_WGS84 / (2 - F_WGS84)
_A = A_WGS84 / (1 + _n) * (1 + _n ** 2 / 4 + _n ** 4 / 64)
_ALFA = (_n / 2 - 2 * _n ** 2 / 3 + 5 * _n ** 3 / 16 + 41 * _n ** 4 / 180,
         13 * _n ** 2 / 48 - 3 * _n ** 3 / 5 + 557 * _n ** 4 / 1440,
         61 * _n ** 3 / 240 - 103 * _n ** 4 / 140,
         49561 * _n ** 4 / 161280)
_BETA = (_n / 2 - 2 * _n ** 2 / 3 + 37 * _n ** 3 / 96 - _n ** 4 / 360,
         _n ** 2 / 48 + _n ** 3 / 15 - 437 * _n ** 4 / 1440,
         17 * _n ** 3 / 480 - 37 * _n ** 4 / 840,
         4397 * _n ** 4 / 161280)
_DELTA = (2 * _n - 2 * _n ** 2 / 3 - 2 * _n ** 3 + 116 * _n ** 4 / 45,
          7 * _n ** 2 / 3 - 8 * _n ** 3 / 5 - 227 * _n ** 4 / 45,
          56 * _n ** 3 / 15 - 136 * _n ** 4 / 35,
          4279 * _n ** 4 / 630)
_E = 2 * np.sqrt(_n) / (1 + _n)  # a excentricidade escrita com n


def para_utm(lat, lon, lon0=LON0):
    """(lat, lon) em graus → (x, y) em metros (x para leste, com o falso este de 500 km; y para norte)."""
    fi = np.radians(np.asarray(lat, dtype=float))
    dl = np.radians(np.asarray(lon, dtype=float) - lon0)
    t = np.sinh(np.arctanh(np.sin(fi)) - _E * np.arctanh(_E * np.sin(fi)))
    xi = np.arctan2(t, np.cos(dl))
    eta = np.arctanh(np.sin(dl) / np.sqrt(1 + t * t))
    x, y = eta.copy(), xi.copy()
    for j, a in enumerate(_ALFA, start=1):
        x += a * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
        y += a * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
    return FALSO_ESTE + K0 * _A * x, K0 * _A * y


def de_utm(x, y, lon0=LON0):
    """(x, y) em metros → (lat, lon) em graus (o inverso de para_utm)."""
    xi = np.asarray(y, dtype=float) / (K0 * _A)
    eta = (np.asarray(x, dtype=float) - FALSO_ESTE) / (K0 * _A)
    xi1, eta1 = xi.copy(), eta.copy()
    for j, b in enumerate(_BETA, start=1):
        xi1 -= b * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
        eta1 -= b * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
    chi = np.arcsin(np.sin(xi1) / np.cosh(eta1))
    fi = chi.copy()
    for j, d in enumerate(_DELTA, start=1):
        fi += d * np.sin(2 * j * chi)
    return np.degrees(fi), lon0 + np.degrees(np.arctan2(np.sinh(eta1), np.cos(xi1)))
