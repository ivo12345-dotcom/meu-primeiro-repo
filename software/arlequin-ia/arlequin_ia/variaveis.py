"""Variáveis para os modelos, calculadas a partir da tabela de 10 s:
sessões (para testar com a última saída), balanço medido pela IMU, tendência
do barómetro e a previsão que havia para aquele sítio e hora."""

import numpy as np
import pandas as pd

MN_POR_GRAU = 60.0
EPOCA = pd.Timestamp('1970-01-01', tz='UTC')


def segundos(t):
    """Segundos desde 1970 (serve para Series e DatetimeIndex, qualquer resolução)."""
    return np.asarray((t - EPOCA) / pd.Timedelta(seconds=1), dtype=float)


def dif_angulo(a, b):
    """a − b em graus, entre −180 e 180."""
    return (np.asarray(a) - np.asarray(b) + 540.0) % 360.0 - 180.0


def sessoes(df, saidas, intervalo_h=2.0):
    """Número da sessão de cada linha. Com saídas gravadas, cada saída é uma
    sessão (linhas fora de qualquer saída ficam -1); sem saídas, uma sessão
    nova começa depois de um buraco de mais de `intervalo_h` horas."""
    if saidas:
        s = pd.Series(-1, index=df.index)
        for i, (ini, fim) in enumerate(sorted(saidas)):
            s[(df['t'] >= ini) & (df['t'] <= fim)] = i
        return s
    buraco = df['t'].diff() > pd.Timedelta(hours=intervalo_h)
    return buraco.cumsum().astype(int)


def balanco(df, janela=12, buraco_s=30):
    """Desvio padrão do adorno e do caimento nos últimos 2 min (12 linhas de 10 s):
    o mar que o barco sente. Recomeça a contar depois de um buraco na gravação."""
    bloco = (df['t'].diff() > pd.Timedelta(seconds=buraco_s)).cumsum()
    out = pd.DataFrame(index=df.index)
    for col, nome in (('adorno', 'balAdorno'), ('caimento', 'balCaimento')):
        out[nome] = df.groupby(bloco)[col].transform(lambda x: x.rolling(janela, min_periods=janela).std())
    return out


def tendencia_pressao(df, horas=3):
    """Pressão agora − pressão há `horas` horas (hPa); NaN se não houver leitura perto."""
    atras = df[['t', 'pressao']].rename(columns={'pressao': 'pAntes'})
    alvo = pd.DataFrame({'t': df['t'] - pd.Timedelta(hours=horas), 'i': df.index})
    j = pd.merge_asof(alvo.sort_values('t'), atras.dropna().sort_values('t'), on='t',
                      direction='nearest', tolerance=pd.Timedelta(minutes=10)).set_index('i')
    return df['pressao'] - j['pAntes'].reindex(df.index)


def escolher_previsao(df, previsoes, max_idade_h=12, max_dist_mn=30):
    """Para cada linha, o índice (em `previsoes`) da previsão a usar, ou -1: entre as previsões feitas para um
    ponto a menos de `max_dist_mn` MN e obtidas antes da linha (até `max_idade_h` horas), a de obtenção mais
    recente; entre as obtidas a essa mesma hora (a rota arquiva um ficheiro por ponto), a do ponto mais perto.
    Se a mais recente só tiver pontos longe demais, serve a anterior que esteja perto (a idade vai em idadePrevH)."""
    escolha = np.full(len(df), -1)
    if not previsoes or df.empty:
        return escolha
    ordem = np.argsort(segundos(df['t']), kind='stable')
    ts = segundos(df['t'])[ordem]
    lat = df['lat'].to_numpy(dtype=float)[ordem]
    lon = df['lon'].to_numpy(dtype=float)[ordem]
    obtidas = segundos(pd.DatetimeIndex([p['obtida'] for p in previsoes]))
    for o in np.unique(obtidas):  # por ordem crescente: a mais recente escreve por cima
        ks = np.flatnonzero(obtidas == o)
        a, b = np.searchsorted(ts, o, 'left'), np.searchsorted(ts, o + max_idade_h * 3600, 'right')
        if a == b:
            continue
        dist = np.stack([np.hypot((lat[a:b] - previsoes[k]['lat']) * MN_POR_GRAU,
                                  (lon[a:b] - previsoes[k]['lon']) * MN_POR_GRAU * np.cos(np.radians(previsoes[k]['lat'])))
                         for k in ks])
        perto = np.argmin(np.where(np.isnan(dist), np.inf, dist), axis=0)
        serve = dist[perto, np.arange(b - a)] <= max_dist_mn
        escolha[ordem[a:b][serve]] = ks[perto[serve]]
    return escolha


def juntar_previsao(df, previsoes, max_idade_h=12, max_dist_mn=30):
    """Para cada linha, a previsão escolhida por `escolher_previsao` (a mais recente obtida antes dela, até
    `max_idade_h` horas, feita para um ponto a menos de `max_dist_mn` MN; entre as da mesma hora, a do ponto
    mais perto), interpolada na hora da linha. Devolve prevTws, prevRajada, prevTwd, prevOndas, prevPeriodo,
    prevOndasDir e idadePrevH (NaN quando não há previsão que sirva)."""
    cols = ['prevTws', 'prevRajada', 'prevTwd', 'prevOndas', 'prevPeriodo', 'prevOndasDir', 'idadePrevH']
    out = pd.DataFrame(np.nan, index=df.index, columns=cols)
    if not previsoes or df.empty:
        return out
    escolha = pd.Series(escolher_previsao(df, previsoes, max_idade_h, max_dist_mn), index=df.index)
    for k, grupo in escolha[escolha >= 0].groupby(escolha[escolha >= 0]):
        p = previsoes[int(k)]
        idx = grupo.index
        x = segundos(df.loc[idx, 't'])
        xp = segundos(p['horas'])
        interp = lambda v: np.interp(x, xp, np.asarray(v, dtype=float), left=np.nan, right=np.nan)
        for campo, nome in (('tws', 'prevTws'), ('rajada', 'prevRajada'), ('ondas', 'prevOndas'), ('periodo', 'prevPeriodo')):
            if campo in p:
                out.loc[idx, nome] = interp(p[campo])
        for campo, nome in (('twd', 'prevTwd'), ('ondasDir', 'prevOndasDir')):
            if campo in p:  # ângulos: interpola seno e cosseno
                r = np.radians(np.asarray(p[campo], dtype=float))
                out.loc[idx, nome] = np.degrees(np.arctan2(interp(np.sin(r)), interp(np.cos(r)))) % 360
        out.loc[idx, 'idadePrevH'] = (df.loc[idx, 't'] - p['obtida']).dt.total_seconds() / 3600
    return out


def preparar(df, saidas, previsoes):
    """A tabela com todas as variáveis derivadas que os modelos usam."""
    d = df.copy()
    d['sessao'] = sessoes(d, saidas)
    d = d.join(balanco(d))
    d['tendPressao3h'] = tendencia_pressao(d)
    d = d.join(juntar_previsao(d, previsoes))
    d['twaAbs'] = d['twa'].abs()  # medido
    # o ângulo entre a proa e o vento previsto em bruto (0–180°): o único que o planeador conhece antes de partir
    d['twaPrevAbs'] = np.abs(dif_angulo(d['prevTwd'], d['proa']))
    d['adornoAbs'] = d['adorno'].abs()
    d['ondasAnguloRel'] = np.abs(dif_angulo(d['prevOndasDir'], d['proa']))
    d['horaDia'] = d['t'].dt.hour + d['t'].dt.minute / 60
    d['latCel'] = np.floor(d['lat'] * 10) / 10
    d['lonCel'] = np.floor(d['lon'] * 10) / 10
    d['ventoRazao'] = d['tws'] / d['prevTws'].where(d['prevTws'] > 2)
    d['ventoDif'] = dif_angulo(d['twd'], d['prevTwd'])
    return d
