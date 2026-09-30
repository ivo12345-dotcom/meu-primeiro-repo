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
             'profundidade', 'soc', 'simulado', 'estavel', 'consumoMedido']
# A ordem é a das colunas da caixa negra (lib/tabela.js); as colunas novas acrescentam-se sempre no fim.
# consumoMedido: 1 = litrosHora medido pelo MDI, 0 = estimado pelo plugin J1939, vazio = sem origem.
COLUNAS = ['t'] + NUMERICAS
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


def nomes_das_colunas(texto):
    """O cabeçalho do ficheiro, estendido se houver linhas com mais campos: no dia em que a caixa negra
    passa a escrever uma coluna nova, o ficheiro desse dia já tem o cabeçalho antigo (só se escreve no
    início) e as linhas novas trazem mais um campo no fim."""
    linhas = texto.splitlines()
    cab = linhas[0].split(',')
    n = max((l.count(',') + 1 for l in linhas[1:] if l), default=len(cab))
    if n > len(cab) and cab == COLUNAS[:len(cab)] and n <= len(COLUNAS):
        return COLUNAS[:n]
    return cab


def ler_ficheiro_tabela(f):
    """As linhas de um dia (um DataFrame), ou None se não houver nada que se aproveite."""
    try:
        texto, cortado = membros_inteiros(f.read_bytes())
        if cortado:
            aviso(f, f'ficheiro cortado ou estragado; aproveito {max(0, texto.count(chr(10)) - 1)} linhas inteiras')
        if not texto.strip():
            return None
        return pd.read_csv(io.StringIO(texto), header=None, skiprows=1, names=nomes_das_colunas(texto))
    except Exception as e:
        aviso(f, f'não consegui ler ({e}); fica de fora')
        return None


def tabela_vazia():
    return pd.DataFrame({'t': pd.Series([], dtype='datetime64[us, UTC]'), **{c: pd.Series(dtype=float) for c in NUMERICAS}})


def ler_tabela(base, dias=None):
    """As linhas de tabela/AAAA-MM-DD.csv.gz (os .danificado-* ficam de fora), ordenadas no tempo.
    Com `dias` (conjunto de 'AAAA-MM-DD'), só abre os ficheiros desses dias. As colunas que faltem
    (ficheiros antigos, de antes de a coluna existir) ficam em branco (NaN)."""
    ficheiros = sorted(Path(base, 'tabela').glob('*.csv.gz'))
    if dias is not None:
        ficheiros = [f for f in ficheiros if f.name[:-len('.csv.gz')] in dias]
    partes = [p for p in (ler_ficheiro_tabela(f) for f in ficheiros) if p is not None]
    if not partes:
        return tabela_vazia()
    df = pd.concat(partes, ignore_index=True)
    df['t'] = pd.to_datetime(df['t'], utc=True, format='ISO8601')
    for c in NUMERICAS:
        df[c] = pd.to_numeric(df[c], errors='coerce') if c in df else float('nan')
    return df.sort_values('t').drop_duplicates('t').reset_index(drop=True)


def utc(t):
    t = pd.Timestamp(t)
    return t.tz_localize('UTC') if t.tzinfo is None else t.tz_convert('UTC')


def ler_saidas(base):
    """[(inicio, fim)] das saídas terminadas (saidas/*.json)."""
    saidas = []
    for f in sorted(Path(base, 'saidas').glob('*.json')):
        try:
            s = json.loads(f.read_text(encoding='utf-8'))
            saidas.append((utc(s['inicio']), utc(s['fim'])))
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
