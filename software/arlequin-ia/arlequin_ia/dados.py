"""Leitura da caixa negra: tabela de 10 s, saídas e previsões arquivadas.
Um ficheiro estragado (p.ex. cortado por um corte de luz) nunca pára o treino:
fica de fora, com um aviso no stderr, e o resto lê-se na mesma."""

import gzip
import io
import json
import sys
import zlib
from pathlib import Path

import pandas as pd

NUMERICAS = ['lat', 'lon', 'proa', 'cog', 'sog', 'stw', 'tws', 'twa', 'twd', 'aws', 'awa', 'rajada',
             'adorno', 'caimento', 'pressao', 'rpm', 'litrosHora', 'grandeRizos', 'genoaPct',
             'profundidade', 'soc', 'simulado', 'estavel']
LISTAS_PREVISAO = ('tws', 'rajada', 'twd', 'ondas', 'periodo', 'ondasDir')


def aviso(f, texto):
    print(f'aviso: {Path(f).name}: {texto}', file=sys.stderr)


def membros_inteiros(dados):
    """O texto dos membros gzip que se descomprimem por inteiro, até ao 1.º estragado ou cortado.
    Devolve (texto, cortado): cortado é True se sobrou alguma coisa que não se leu."""
    partes = []
    while dados:
        d = zlib.decompressobj(31)
        try:
            texto = d.decompress(dados) + d.flush()
        except zlib.error:
            break
        if not d.eof:
            break
        partes.append(texto)
        dados = d.unused_data
    return b''.join(partes).decode('utf-8'), bool(dados)


def ler_ficheiro_tabela(f):
    """As linhas de um dia (um DataFrame), ou None se não houver nada que se aproveite."""
    try:
        texto, cortado = membros_inteiros(f.read_bytes())
        if cortado:
            aviso(f, f'ficheiro cortado ou estragado; aproveito {max(0, texto.count(chr(10)) - 1)} linhas inteiras')
        if not texto.strip():
            return None
        return pd.read_csv(io.StringIO(texto))
    except Exception as e:
        aviso(f, f'não consegui ler ({e}); fica de fora')
        return None


def ler_tabela(base):
    """Todas as linhas de tabela/*.csv.gz (os .danificado-* ficam de fora), ordenadas no tempo."""
    ficheiros = sorted(Path(base, 'tabela').glob('*.csv.gz'))
    partes = [p for p in (ler_ficheiro_tabela(f) for f in ficheiros) if p is not None]
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
        except Exception as e:
            aviso(f, f'saída ilegível ({e}); fica de fora')
    return saidas


def previsao_valida(p):
    """Motivo por que a previsão não serve, ou None se tiver a forma certa."""
    horas = p.get('horas')
    if not isinstance(horas, list) or not horas:
        return 'sem horas'
    for campo in LISTAS_PREVISAO:
        if campo in p and (not isinstance(p[campo], list) or len(p[campo]) != len(horas)):
            return f'"{campo}" não tem uma entrada por hora'
    return None


def ler_previsoes(base):
    """Previsões arquivadas (previsoes/*.json ou *.json.gz), cada uma um dict do plugin da AI."""
    previsoes = []
    pasta = Path(base, 'previsoes')
    for f in sorted(list(pasta.glob('*.json')) + list(pasta.glob('*.json.gz'))):
        try:
            texto = gzip.decompress(f.read_bytes()).decode('utf-8') if f.suffix == '.gz' else f.read_text(encoding='utf-8')
            p = json.loads(texto)
            motivo = previsao_valida(p)
            if motivo:
                aviso(f, f'previsão com a forma errada ({motivo}); fica de fora')
                continue
            p['obtida'] = pd.Timestamp(p['obtida'])
            p['horas'] = pd.to_datetime(p['horas'], utc=True)
            previsoes.append(p)
        except Exception as e:
            aviso(f, f'previsão ilegível ({e}); fica de fora')
    return sorted(previsoes, key=lambda p: p['obtida'])
