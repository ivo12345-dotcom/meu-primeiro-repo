"""Dados inventados com resposta conhecida, para testar a AI sem barco:
o barco "verdadeiro" é 8% mais lento do que a polar em geral e mais 10% à volta
dos 60°, o vento real é 20% mais forte do que a previsão e o motor gasta mais 10%
do que diz a Volvo. Escreve tabela/, saidas/ e previsoes/ como a caixa negra e o plugin da AI."""

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .base import litros_volvo, stw_polar
from .dados import NUMERICAS

COLUNAS = ['t'] + NUMERICAS


def verdade_stw(polar, twa_abs, tws, fator60=0.9, fator_geral=0.92):
    """A velocidade "verdadeira" do barco inventado (nós)."""
    perda = (1 - fator60) * np.exp(-((np.asarray(twa_abs) - 60) / 20) ** 2)
    return stw_polar(polar, twa_abs, tws) * fator_geral * (1 - perda)


def gerar(pasta, polar, sessoes=3, horas_motor=2.0, horas_vela=4.0, inicio='2026-06-01T08:00:00Z',
          fator60=0.9, fator_geral=0.92, razao_vento=1.2, fator_consumo=1.1, ruido=0.15, simulado=0, semente=1):
    rng = np.random.default_rng(semente)
    pasta = Path(pasta)
    for d in ('tabela', 'saidas', 'previsoes'):
        (pasta / d).mkdir(parents=True, exist_ok=True)
    linhas = []
    t0 = pd.Timestamp(inicio)
    for s in range(sessoes):
        ini = t0 + pd.Timedelta(days=s)
        n_motor = int(horas_motor * 360)
        n = n_motor + int(horas_vela * 360)
        t = ini + pd.to_timedelta(np.arange(n) * 10, unit='s')
        tws = np.clip(8 + 6 * np.sin(np.arange(n) / 700 + s) + rng.normal(0, 0.8, n), 3, 25)
        twa_abs = 45 + (np.arange(n) // 90 * 37 + s * 11) % 135      # muda de ângulo de 15 em 15 min
        lado = np.where((np.arange(n) // 360) % 2 == 0, 1, -1)
        twd = (200 + rng.normal(0, 5, n)) % 360
        proa = (twd - lado * twa_abs) % 360
        motor = np.arange(n) < n_motor
        rpm = np.where(motor, 1800 + (np.arange(n) // 60 % 4) * 150, 0)
        stw = np.where(motor, 4.5 + rpm / 1000, verdade_stw(polar, twa_abs, tws, fator60, fator_geral)) + rng.normal(0, ruido, n)
        litros = np.where(motor, litros_volvo(rpm) * fator_consumo + rng.normal(0, 0.05, n), np.nan)
        lat = 39.0 + np.arange(n) * 0.00005
        lon = np.full(n, -9.6)
        linhas.append(pd.DataFrame({
            't': t, 'lat': lat, 'lon': lon, 'proa': proa, 'cog': proa, 'sog': stw, 'stw': stw, 'tws': tws,
            'twa': lado * twa_abs, 'twd': twd, 'aws': tws * 1.2, 'awa': lado * twa_abs * 0.7, 'rajada': tws * 1.3,
            'adorno': -lado * np.minimum(20, tws) * 0.8 + rng.normal(0, 1.5, n), 'caimento': rng.normal(0, 2, n),
            'pressao': 1015 - np.arange(n) / 3000, 'rpm': rpm, 'litrosHora': litros,
            'grandeRizos': np.where(tws > 18, 1, 0), 'genoaPct': 100, 'profundidade': 60, 'soc': 90,
            'simulado': simulado, 'estavel': 1}))
        fim = t[-1]
        (pasta / 'saidas' / f'{ini.strftime("%Y-%m-%dT%H-%M")}.json').write_text(json.dumps(
            {'inicio': ini.isoformat(), 'fim': fim.isoformat(), 'simulado': bool(simulado)}), encoding='utf-8')
        # uma previsão por hora, feita para o ponto do barco, com o vento 20% mais fraco do que o real
        for h in range(int(horas_motor + horas_vela) + 1):
            obtida = ini + pd.Timedelta(hours=h)
            horas = pd.date_range(obtida.floor('h'), periods=6, freq='h')
            k = np.clip(((horas - ini) / pd.Timedelta(seconds=10)).astype(int), 0, n - 1)
            prev = {'obtida': obtida.isoformat(), 'lat': float(lat[k[0]]), 'lon': -9.6,
                    'horas': [x.isoformat() for x in horas], 'tws': (tws[k] / razao_vento).round(2).tolist(),
                    'rajada': (tws[k] * 1.3 / razao_vento).round(2).tolist(), 'twd': twd[k].round(1).tolist(),
                    'ondas': [1.5] * 6, 'periodo': [8.0] * 6, 'ondasDir': [300.0] * 6}
            (pasta / 'previsoes' / f'{obtida.strftime("%Y-%m-%dT%H-%M")}.json').write_text(json.dumps(prev), encoding='utf-8')
    df = pd.concat(linhas, ignore_index=True)
    for dia, grupo in df.groupby(df['t'].dt.strftime('%Y-%m-%d')):
        texto = grupo[COLUNAS].assign(t=grupo['t'].dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')).to_csv(index=False)
        (pasta / 'tabela' / f'{dia}.csv.gz').write_bytes(gzip.compress(texto.encode('utf-8')))
    return df
