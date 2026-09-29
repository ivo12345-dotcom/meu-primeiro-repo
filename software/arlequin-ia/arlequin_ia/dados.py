"""Leitura da caixa negra: tabela de 10 s, saídas e previsões arquivadas."""

import gzip
import json
from pathlib import Path

import pandas as pd

NUMERICAS = ['lat', 'lon', 'proa', 'cog', 'sog', 'stw', 'tws', 'twa', 'twd', 'aws', 'awa', 'rajada',
             'adorno', 'caimento', 'pressao', 'rpm', 'litrosHora', 'grandeRizos', 'genoaPct',
             'profundidade', 'soc', 'simulado', 'estavel']


def ler_tabela(base):
    """Todas as linhas de tabela/*.csv.gz (os .danificado-* ficam de fora), ordenadas no tempo."""
    ficheiros = sorted(Path(base, 'tabela').glob('*.csv.gz'))
    partes = [pd.read_csv(f, compression='gzip') for f in ficheiros]
    if not partes:
        return pd.DataFrame(columns=['t'] + NUMERICAS)
    df = pd.concat(partes, ignore_index=True)
    df['t'] = pd.to_datetime(df['t'], utc=True, format='ISO8601')
    for c in NUMERICAS:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors='coerce')
    return df.sort_values('t').drop_duplicates('t').reset_index(drop=True)


def ler_saidas(base):
    """[(inicio, fim)] das saídas terminadas (saidas/*.json)."""
    saidas = []
    for f in sorted(Path(base, 'saidas').glob('*.json')):
        try:
            s = json.loads(f.read_text(encoding='utf-8'))
            saidas.append((pd.Timestamp(s['inicio']), pd.Timestamp(s['fim'])))
        except (ValueError, KeyError):
            continue
    return saidas


def ler_previsoes(base):
    """Previsões arquivadas (previsoes/*.json ou *.json.gz), cada uma um dict do plugin da AI."""
    previsoes = []
    pasta = Path(base, 'previsoes')
    for f in sorted(list(pasta.glob('*.json')) + list(pasta.glob('*.json.gz'))):
        try:
            texto = gzip.decompress(f.read_bytes()).decode('utf-8') if f.suffix == '.gz' else f.read_text(encoding='utf-8')
            p = json.loads(texto)
            p['obtida'] = pd.Timestamp(p['obtida'])
            p['horas'] = pd.to_datetime(p['horas'], utc=True)
            previsoes.append(p)
        except (ValueError, KeyError, OSError):
            continue
    return sorted(previsoes, key=lambda p: p['obtida'])
