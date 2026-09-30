import gzip
import json

import numpy as np
import pandas as pd

from arlequin_ia.dados import NUMERICAS, ler_previsoes, ler_saidas, ler_tabela
from arlequin_ia.variaveis import balanco, dif_angulo, juntar_previsao, sessoes, tendencia_pressao


def escrever_tabela(pasta, nome, linhas, cab='t,lat,lon,stw,simulado,estavel'):
    (pasta / 'tabela').mkdir(parents=True, exist_ok=True)
    (pasta / 'tabela' / nome).write_bytes(gzip.compress(('\n'.join([cab] + linhas) + '\n').encode()))


def tabela(n, inicio='2026-06-01T10:00:00Z', passo=10, **cols):
    t = pd.Timestamp(inicio) + pd.to_timedelta(np.arange(n) * passo, unit='s')
    return pd.DataFrame({'t': t, **{k: (v if np.ndim(v) else np.full(n, v)) for k, v in cols.items()}})


def test_ler_tabela_junta_os_dias_por_ordem_e_ignora_danificados(tmp_path):
    escrever_tabela(tmp_path, '2026-06-02.csv.gz', ['2026-06-02T00:00:00.000Z,39,-9,5,0,1'])
    escrever_tabela(tmp_path, '2026-06-01.csv.gz', ['2026-06-01T23:59:50.000Z,39,-9,4,0,1', '2026-06-01T23:59:50.000Z,39,-9,4,0,1'])
    (tmp_path / 'tabela' / '2026-06-03.csv.gz.danificado-2026-06-03T00-00-00Z').write_bytes(b'lixo')
    df = ler_tabela(tmp_path)
    assert list(df['stw']) == [4, 5]
    assert str(df['t'].dt.tz) == 'UTC'


def test_ler_saidas_e_previsoes(tmp_path):
    (tmp_path / 'saidas').mkdir()
    (tmp_path / 'saidas' / 'a.json').write_text(json.dumps({'inicio': '2026-06-01T10:00:00.000Z', 'fim': '2026-06-01T12:00:00.000Z'}))
    (tmp_path / 'saidas' / 'mau.json').write_text('{')
    (tmp_path / 'previsoes').mkdir()
    (tmp_path / 'previsoes' / 'p.json.gz').write_bytes(gzip.compress(json.dumps(
        {'obtida': '2026-06-01T09:00:00Z', 'lat': 39, 'lon': -9.6, 'horas': ['2026-06-01T09:00Z'], 'tws': [10]}).encode()))
    assert ler_saidas(tmp_path) == [(pd.Timestamp('2026-06-01T10:00:00Z'), pd.Timestamp('2026-06-01T12:00:00Z'))]
    p = ler_previsoes(tmp_path)
    assert len(p) == 1 and p[0]['tws'] == [10] and p[0]['horas'][0] == pd.Timestamp('2026-06-01T09:00Z')


def test_sessoes_pelas_saidas_ou_pelos_buracos():
    df = tabela(6, passo=3600)  # 10h, 11h, … 15h
    saidas = [(pd.Timestamp('2026-06-01T10:30Z'), pd.Timestamp('2026-06-01T12:30Z')),
              (pd.Timestamp('2026-06-01T14:00Z'), pd.Timestamp('2026-06-01T15:00Z'))]
    assert list(sessoes(df, saidas)) == [-1, 0, 0, -1, 1, 1]
    df2 = pd.concat([tabela(3), tabela(3, inicio='2026-06-01T13:00:00Z')], ignore_index=True)
    assert list(sessoes(df2, [])) == [0, 0, 0, 1, 1, 1]


def test_balanco_e_o_desvio_padrao_de_2_min_e_recomeca_depois_de_um_buraco():
    adorno = np.array([0, 10] * 6 + [0, 10] * 6, dtype=float)
    df = pd.concat([tabela(12, adorno=adorno[:12], caimento=0.0),
                    tabela(12, inicio='2026-06-01T11:00:00Z', adorno=adorno[12:], caimento=0.0)], ignore_index=True)
    b = balanco(df)
    assert b['balAdorno'].iloc[:11].isna().all()
    assert abs(b['balAdorno'].iloc[11] - np.std([0, 10] * 6, ddof=1)) < 1e-9
    assert b['balAdorno'].iloc[12:23].isna().all()  # recomeça depois do buraco de 1 h
    assert b['balCaimento'].iloc[11] == 0


def test_tendencia_da_pressao_em_3_h():
    df = tabela(4, passo=3600, pressao=[1015.0, 1014.0, 1013.0, 1011.0])
    t = tendencia_pressao(df)
    assert t.iloc[:3].isna().all()
    assert t.iloc[3] == -4.0


def test_juntar_previsao_interpola_usa_a_mais_recente_e_respeita_idade_e_distancia():
    df = tabela(4, passo=1800, lat=39.0, lon=-9.6)  # 10:00 10:30 11:00 11:30
    df.loc[3, 'lat'] = 40.0  # a 60 MN do ponto da previsão
    horas = pd.to_datetime(['2026-06-01T10:00Z', '2026-06-01T11:00Z', '2026-06-01T12:00Z'], utc=True)
    antiga = {'obtida': pd.Timestamp('2026-05-31T20:00Z'), 'lat': 39.0, 'lon': -9.6, 'horas': horas, 'tws': [1, 1, 1], 'twd': [0, 0, 0]}
    boa = {'obtida': pd.Timestamp('2026-06-01T09:00Z'), 'lat': 39.0, 'lon': -9.6, 'horas': horas,
           'tws': [10, 14, 20], 'twd': [350, 10, 30], 'ondas': [1, 2, 3]}
    j = juntar_previsao(df, [antiga, boa])
    assert list(j['prevTws'].iloc[:3]) == [10, 12, 14]
    assert abs(dif_angulo(j['prevTwd'].iloc[1], 0)) < 1e-6  # entre 350° e 10° é 0°, não 180°
    assert list(j['idadePrevH'].iloc[:3]) == [1, 1.5, 2]
    assert np.isnan(j['prevTws'].iloc[3])
    velha = juntar_previsao(df, [antiga])
    assert velha['prevTws'].isna().all()  # obtida há mais de 12 h


def membros(*textos):
    """Um .csv.gz como a caixa negra o escreve: um membro gzip por cada escrita."""
    return b''.join(gzip.compress(t.encode()) for t in textos)


def test_ler_tabela_recupera_os_membros_inteiros_de_um_ficheiro_cortado(tmp_path, capsys):
    escrever_tabela(tmp_path, '2026-06-02.csv.gz', ['2026-06-02T00:00:00.000Z,39,-9,5,0,1'])
    cortado = membros('t,lat,lon,stw,simulado,estavel\n2026-06-01T10:00:00.000Z,39,-9,4,0,1\n',
                      '2026-06-01T10:00:10.000Z,39,-9,7,0,1\n', '2026-06-01T10:00:20.000Z,39,-9,8,0,1\n')
    n1 = len(membros('t,lat,lon,stw,simulado,estavel\n2026-06-01T10:00:00.000Z,39,-9,4,0,1\n'))
    n2 = len(membros('2026-06-01T10:00:10.000Z,39,-9,7,0,1\n'))
    (tmp_path / 'tabela' / '2026-06-01.csv.gz').write_bytes(cortado[:n1 + n2 // 2])  # corte a meio do 2.º membro
    df = ler_tabela(tmp_path)
    assert list(df['stw']) == [4, 5]
    err = capsys.readouterr().err
    assert '2026-06-01.csv.gz' in err and 'cortado' in err


def test_ler_tabela_recupera_membros_apos_zeros_entre_blocos(tmp_path, capsys):
    escrever_tabela(tmp_path, '2026-06-02.csv.gz', ['2026-06-02T00:00:00.000Z,39,-9,5,0,1'])
    m1 = membros('t,lat,lon,stw,simulado,estavel\n2026-06-01T10:00:00.000Z,39,-9,4,0,1\n')
    m2 = membros('2026-06-01T10:00:10.000Z,39,-9,7,0,1\n')
    (tmp_path / 'tabela' / '2026-06-01.csv.gz').write_bytes(m1 + b'\0' * 64 + m2)  # corte de luz deixa zeros entre membros
    df = ler_tabela(tmp_path)
    assert list(df['stw']) == [4, 7, 5]
    assert 'cortado' not in capsys.readouterr().err


def test_ler_tabela_salta_um_ficheiro_ilegivel_com_aviso(tmp_path, capsys):
    escrever_tabela(tmp_path, '2026-06-02.csv.gz', ['2026-06-02T00:00:00.000Z,39,-9,5,0,1'])
    (tmp_path / 'tabela' / '2026-06-01.csv.gz').write_bytes(b'isto nao e gzip')
    assert list(ler_tabela(tmp_path)['stw']) == [5]
    assert '2026-06-01.csv.gz' in capsys.readouterr().err


def test_ler_tabela_antiga_sem_uma_coluna_da_nan(tmp_path):
    escrever_tabela(tmp_path, '2026-06-01.csv.gz', ['2026-06-01T10:00:00.000Z,39,-9,4,0,1'])
    df = ler_tabela(tmp_path)
    assert 'consumoMedido' in df and df['consumoMedido'].isna().all()


def test_ler_tabela_no_dia_da_atualizacao_as_linhas_com_a_coluna_nova_ficam_certas(tmp_path):
    # o ficheiro do dia começou com o cabeçalho antigo (24 colunas) e a caixa negra nova acrescenta a 25.ª
    antigas = ['t'] + NUMERICAS[:-1]
    assert NUMERICAS[-1] == 'consumoMedido'
    velha = ['2026-06-01T10:00:00.000Z'] + [''] * (len(antigas) - 1)
    nova = ['2026-06-01T10:00:10.000Z'] + [''] * (len(antigas) - 1) + ['1']
    velha[antigas.index('stw')], nova[antigas.index('stw')] = '4', '5'
    escrever_tabela(tmp_path, '2026-06-01.csv.gz', [','.join(velha), ','.join(nova)], cab=','.join(antigas))
    df = ler_tabela(tmp_path)
    assert list(df['stw']) == [4, 5]
    assert np.isnan(df['consumoMedido'].iloc[0]) and df['consumoMedido'].iloc[1] == 1


def test_ler_tabela_so_os_dias_pedidos(tmp_path):
    escrever_tabela(tmp_path, '2026-06-01.csv.gz', ['2026-06-01T10:00:00.000Z,39,-9,4,0,1'])
    escrever_tabela(tmp_path, '2026-06-02.csv.gz', ['2026-06-02T10:00:00.000Z,39,-9,5,0,1'])
    assert list(ler_tabela(tmp_path, dias={'2026-06-02'})['stw']) == [5]
    vazia = ler_tabela(tmp_path, dias=set())
    assert vazia.empty and str(vazia['t'].dt.tz) == 'UTC'


def test_ler_previsoes_salta_cortadas_e_com_listas_de_tamanhos_diferentes(tmp_path, capsys):
    (tmp_path / 'previsoes').mkdir()
    boa = {'obtida': '2026-06-01T09:00:00Z', 'lat': 39, 'lon': -9.6, 'horas': ['2026-06-01T09:00Z', '2026-06-01T10:00Z'],
           'tws': [10, 11], 'ondas': [None, 1.0]}
    (tmp_path / 'previsoes' / 'a.json.gz').write_bytes(gzip.compress(json.dumps(boa).encode()))
    (tmp_path / 'previsoes' / 'cortada.json.gz').write_bytes(gzip.compress(json.dumps(boa).encode())[:30])
    (tmp_path / 'previsoes' / 'torta.json').write_text(json.dumps({**boa, 'twd': [1, 2, 3]}))
    (tmp_path / 'previsoes' / 'vazia.json').write_text(json.dumps({**boa, 'horas': [], 'tws': []}))
    p = ler_previsoes(tmp_path)
    assert len(p) == 1 and p[0]['tws'] == [10, 11]
    err = capsys.readouterr().err
    for nome in ('cortada.json.gz', 'torta.json', 'vazia.json'):
        assert nome in err, err


def test_ler_saidas_avisa_do_ficheiro_ilegivel(tmp_path, capsys):
    (tmp_path / 'saidas').mkdir()
    (tmp_path / 'saidas' / 'mau.json').write_text('{')
    (tmp_path / 'saidas' / 'lista.json').write_text('[1]')
    assert ler_saidas(tmp_path) == []
    err = capsys.readouterr().err
    assert 'mau.json' in err and 'lista.json' in err


def test_juntar_previsao_com_varios_pontos_a_mesma_hora_escolhe_o_mais_perto():
    # a rota arquiva um ficheiro por ponto, todos com a mesma hora de obtenção
    df = tabela(3, passo=1800, lat=[39.0, 39.25, 39.45], lon=-9.6)  # 10:00 10:30 11:00
    horas = pd.to_datetime(['2026-06-01T10:00Z', '2026-06-01T11:00Z', '2026-06-01T12:00Z'], utc=True)
    obtida = pd.Timestamp('2026-06-01T09:00Z')
    ponto = lambda lat, v: {'obtida': obtida, 'lat': lat, 'lon': -9.6, 'horas': horas, 'tws': [v, v, v]}
    j = juntar_previsao(df, [ponto(39.5, 30), ponto(39.0, 10), ponto(39.3, 20)])  # a ordem da lista não conta
    assert list(j['prevTws']) == [10, 20, 30]
    assert list(j['idadePrevH']) == [1, 1.5, 2]


def test_juntar_previsao_mais_recente_ganha_ao_mais_perto_e_longe_demais_nao_conta():
    df = tabela(2, passo=1800, lat=39.0, lon=-9.6)  # 10:00 10:30
    horas = pd.to_datetime(['2026-06-01T10:00Z', '2026-06-01T11:00Z'], utc=True)
    antiga_perto = {'obtida': pd.Timestamp('2026-06-01T08:00Z'), 'lat': 39.0, 'lon': -9.6, 'horas': horas, 'tws': [5, 5]}
    recente = {'obtida': pd.Timestamp('2026-06-01T09:00Z'), 'lat': 39.2, 'lon': -9.6, 'horas': horas, 'tws': [15, 15]}
    assert list(juntar_previsao(df, [antiga_perto, recente])['prevTws']) == [15, 15]  # 12 MN: serve, e é mais recente
    # a mais recente só tem pontos a mais de 30 MN: fica a mais antiga que sirva (até 12 h)
    longe = {**recente, 'lat': 39.6}
    j = juntar_previsao(df, [antiga_perto, longe])
    assert list(j['prevTws']) == [5, 5] and list(j['idadePrevH']) == [2, 2.5]
