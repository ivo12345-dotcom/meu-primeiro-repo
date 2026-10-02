import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from arlequin_ia.base import ler_polar, stw_polar
from arlequin_ia.dados import ler_previsoes, ler_saidas, ler_tabela
from arlequin_ia.sintetico import COLUNAS, gerar, verdade_stw
from arlequin_ia.treino import carregar, prever_guardado, treinar
from arlequin_ia.variaveis import preparar

RAIZ = Path(__file__).resolve().parent.parent
POLAR = ler_polar(RAIZ.parent / 'arlequin-ecra' / 'public' / 'polar-arlequin.csv')
AGORA = pd.Timestamp('2026-06-20T12:00:00Z')


@pytest.fixture(scope='module')
def treinado(tmp_path_factory):
    d = tmp_path_factory.mktemp('dados')
    gerar(d, POLAR)
    return d, {r['modelo']: r for r in treinar(d, POLAR, agora=AGORA)}


def test_o_primeiro_modelo_de_cada_tipo_bate_a_origem_e_fica_em_uso(treinado):
    d, r = treinado
    for nome in ('velocidade', 'ventoForca', 'ventoDirecao', 'consumo'):
        assert r[nome]['aceite'] is True, r[nome]
        assert r[nome]['mae'] < r[nome]['maeBase']
        assert (d / 'modelos' / nome / 'atual').read_text() == 'v0001'
    registo = json.loads((d / 'modelos' / 'registo.json').read_text(encoding='utf-8'))
    assert [x['modelo'] for x in registo] == ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']


def test_encontra_o_barco_mais_lento_aos_60_graus(treinado):
    d, _ = treinado
    m = carregar(d / 'modelos' / 'velocidade', 'v0001')
    x = pd.DataFrame([{v: np.nan for v in m['variaveis']}])
    # o modelo recebe a previsão em bruto: nos dados inventados é o vento real / 1,2 (12 nós reais → 10 previstos)
    x.loc[0, ['prevTws', 'twaPrevAbs', 'prevRajada', 'grandeRizos', 'genoaPct']] = [10, 60, 13, 0, 100]
    x.loc[0, ['prevOndas', 'prevPeriodo', 'ondasAnguloRel']] = [1.5, 8, 100]
    previsto = prever_guardado(m, x)[0]
    verdade = float(verdade_stw(POLAR, [60], [12])[0])
    assert abs(previsto - verdade) / verdade < 0.04, (previsto, verdade)


def test_vento_e_consumo_aprendem_o_desvio_da_previsao_e_da_volvo(treinado):
    _, r = treinado
    pct = int(re.search(r'(\d+)% mais forte', r['ventoForca']['frases'][0]).group(1))
    assert 15 <= pct <= 25  # os dados inventados têm o vento real 20% mais forte
    assert any('rpm gastas' in f and 'a Volvo diz' in f for f in r['consumo']['frases'])
    assert len(r['velocidade']['frases']) == 3 and all('a polar dizia' in f for f in r['velocidade']['frases'])


def test_o_motivo_diz_a_origem_certa_de_cada_modelo(treinado):
    # a origem do vento é a previsão em bruto, não a polar; a do consumo é a curva da Volvo (auditoria M-56)
    _, r = treinado
    assert r['velocidade']['motivo'] == 'erra menos do que a polar'
    assert r['ventoForca']['motivo'] == 'erra menos do que a previsão em bruto'
    assert r['ventoDirecao']['motivo'] == 'erra menos do que a previsão em bruto'
    assert r['consumo']['motivo'] == 'erra menos do que a curva da Volvo'


class _Fixo:
    """Um P50 que dá sempre o mesmo valor (para as frases dos modelos do vento)."""
    def __init__(self, v):
        self.v = v

    def predict(self, x):
        return np.full(len(x), self.v)


def test_frases_do_vento_sem_0_por_cento_nem_0_graus():
    # com |valor| < 1 a frase é neutra; os outros casos continuam como estavam (auditoria M-56)
    from arlequin_ia.treino import frases
    x = pd.DataFrame({'prevTws': [10.0, 12.0]})
    f = lambda nome, v: frases(nome, x, x, _Fixo(v), POLAR)
    assert f('ventoForca', 1.003) == ['o vento real é em média igual ao previsto']
    assert f('ventoForca', 0.996) == ['o vento real é em média igual ao previsto']
    assert f('ventoForca', 1.2) == ['o vento real é em média 20% mais forte do que a previsão']
    assert f('ventoForca', 0.85) == ['o vento real é em média 15% mais fraco do que a previsão']
    assert f('ventoDirecao', -0.4) == ['o vento real vem em média da direção prevista']
    assert f('ventoDirecao', 0.4) == ['o vento real vem em média da direção prevista']
    assert f('ventoDirecao', 7.6) == ['o vento real vem em média 8° mais à direita do que a previsão']
    assert f('ventoDirecao', -12.2) == ['o vento real vem em média 12° mais à esquerda do que a previsão']


def test_quantis_por_ordem_em_media(treinado):
    d, _ = treinado
    m = carregar(d / 'modelos' / 'velocidade', 'v0001')
    # no planeamento as 8 variáveis são todas conhecidas (vêm da previsão e das velas escolhidas)
    ptws = np.linspace(5, 20, 30)
    x = pd.DataFrame({'prevTws': ptws, 'twaPrevAbs': np.linspace(45, 170, 30), 'prevRajada': ptws * 1.3, 'prevOndas': 1.5,
                      'prevPeriodo': 8.0, 'ondasAnguloRel': 100.0, 'grandeRizos': 0, 'genoaPct': 100})[m['variaveis']]
    p10, p50, p90 = (prever_guardado(m, x, q).mean() for q in ('p10', 'p50', 'p90'))
    assert p10 < p50 < p90


def test_poucos_dados_nao_cria_modelo(tmp_path):
    gerar(tmp_path, POLAR, sessoes=1, horas_motor=0.5, horas_vela=1)
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert all(x['versao'] is None and not x['aceite'] and x['motivo'].startswith('poucos dados') for x in r)
    assert not (tmp_path / 'modelos' / 'velocidade' / 'atual').exists()


def test_uma_so_saida_nao_chega_para_testar(tmp_path):
    gerar(tmp_path, POLAR, sessoes=1, horas_motor=3, horas_vela=6)  # 6 h à vela: chega às 5 h da velocidade
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])
    assert r[0]['versao'] is None and 'só uma saída' in r[0]['motivo']


def test_dados_do_simulador_nunca_ensinam(tmp_path):
    gerar(tmp_path, POLAR, simulado=1)
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert all(x['versao'] is None and x['motivo'].startswith('poucos dados (0,0 h') for x in r)


def test_um_modelo_pior_fica_guardado_mas_nao_entra_em_uso(tmp_path):
    gerar(tmp_path, POLAR)
    assert treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]['aceite'] is True
    rng = np.random.default_rng(7)
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):  # estraga as saídas antigas (velocidades baralhadas)
        df = pd.read_csv(f, compression='gzip')
        df['stw'] = rng.permutation(df['stw'].to_numpy())
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', semente=2)  # uma saída nova, boa
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0002' and r['aceite'] is False and r['mae'] > r['maeAtual']
    assert (tmp_path / 'modelos' / 'velocidade' / 'atual').read_text() == 'v0001'
    assert (tmp_path / 'modelos' / 'velocidade' / 'v0002.json.gz').exists()


def test_linha_de_comandos_escreve_uma_linha_json_por_modelo(tmp_path):
    gerar(tmp_path, POLAR)
    out = subprocess.run([sys.executable, '-m', 'arlequin_ia', 'treinar', '--dados', str(tmp_path), '--agora', AGORA.isoformat()],
                         cwd=RAIZ, capture_output=True, text=True, encoding='utf-8', check=True).stdout
    linhas = [json.loads(l) for l in out.strip().splitlines()]
    assert [x['modelo'] for x in linhas] == ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']


def test_velocidade_aprende_e_e_testada_so_a_vela(treinado):
    d, r = treinado
    m = carregar(d / 'modelos' / 'velocidade', 'v0001')
    assert 'rpm' not in m['variaveis']
    assert r['velocidade']['mae'] < r['velocidade']['maeBase']
    df = preparar(ler_tabela(d), ler_saidas(d), ler_previsoes(d))
    ultima = df[(df['t'] >= pd.Timestamp('2026-06-03T00:00:00Z')) & (df['rpm'] <= 0)]  # a vela na última saída
    # a base é a polar com a previsão em bruto (a mesma informação que o modelo tem), não com o vento medido
    base_vela = float(np.mean(np.abs(stw_polar(POLAR, ultima['twaPrevAbs'], ultima['prevTws']) - ultima['stw'])))
    assert r['velocidade']['maeBase'] == pytest.approx(base_vela, abs=1e-3)
    assert m['horas'] == pytest.approx(3 * 4.0, abs=0.01)  # só as horas à vela
    assert sum(m['celulas'].values()) == pytest.approx(3 * 4.0, abs=0.01)


def test_sem_saida_nova_nao_cria_versoes(tmp_path):
    gerar(tmp_path, POLAR)
    assert all(x['aceite'] for x in treinar(tmp_path, POLAR, agora=AGORA))
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert all(x['versao'] is None and x['aceite'] is False
               and x['motivo'] == 'sem saída nova para testar desde a última versão' for x in r), r
    assert not list((tmp_path / 'modelos').glob('*/v0002.json.gz'))
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', semente=2)
    r = treinar(tmp_path, POLAR, agora=AGORA)
    for x in r:
        assert x['versao'] == 'v0002', x
        assert (tmp_path / 'modelos' / x['modelo'] / 'v0002.json.gz').exists()
    assert carregar(tmp_path / 'modelos' / 'velocidade', 'v0002')['ultimaSaida'] == '2026-06-10T10:00:00+00:00'  # a 1.ª linha à vela (2 h a motor antes)


def test_sem_saida_nova_nao_volta_a_gravar_versao_rejeitada(tmp_path):
    gerar(tmp_path, POLAR)
    assert treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]['aceite'] is True
    rng = np.random.default_rng(7)
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):  # estraga as saídas antigas (velocidades baralhadas)
        df = pd.read_csv(f, compression='gzip')
        df['stw'] = rng.permutation(df['stw'].to_numpy())
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', semente=2)  # uma saída nova, boa
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0002' and r['aceite'] is False  # v0002 fica gravada mas rejeitada
    assert (tmp_path / 'modelos' / 'velocidade' / 'atual').read_text() == 'v0001'

    r2 = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]  # sem saída nova desde v0002
    assert r2['versao'] is None and r2['aceite'] is False and r2['motivo'].startswith('sem saída nova'), r2
    assert not (tmp_path / 'modelos' / 'velocidade' / 'v0003.json.gz').exists()


def test_simulado_em_branco_nunca_ensina(tmp_path):
    gerar(tmp_path, POLAR)
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):
        df = pd.read_csv(f, compression='gzip')
        df['simulado'] = np.nan
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert all(x['versao'] is None and x['motivo'].startswith('poucos dados (0,0 h') for x in r), r


def test_numero_da_versao_segue_a_maior_e_nunca_reescreve(tmp_path):
    gerar(tmp_path, POLAR)
    assert treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]['versao'] == 'v0001'
    pasta = tmp_path / 'modelos' / 'velocidade'
    (pasta / 'v0003.json.gz').write_bytes((pasta / 'v0001.json.gz').read_bytes())
    antes = (pasta / 'v0003.json.gz').read_bytes()
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', semente=2)
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0004', r
    assert (pasta / 'v0004.json.gz').exists() and (pasta / 'v0003.json.gz').read_bytes() == antes
    assert not list(tmp_path.glob('modelos/**/*.tmp'))


def test_um_modelo_estragado_nao_para_os_outros(tmp_path):
    gerar(tmp_path, POLAR)
    (tmp_path / 'modelos').mkdir(parents=True)
    # um ficheiro no lugar da pasta do modelo obriga o mkdir() do treino a rebentar (erro genuíno, não de
    # versão ilegível: essa já não pára o treino, ver test_uma_versao_ilegivel_nao_bloqueia_o_modelo)
    (tmp_path / 'modelos' / 'velocidade').write_bytes(b'nao e uma pasta')
    r = {x['modelo']: x for x in treinar(tmp_path, POLAR, agora=AGORA)}
    v = r['velocidade']
    assert v['motivo'].startswith('erro:') and v['versao'] is None and v['aceite'] is False, v
    assert v['modelo'] == 'velocidade' and v['data'] == AGORA.isoformat()
    assert v['horas'] is None and v['n'] is None
    for nome in ('ventoForca', 'ventoDirecao', 'consumo'):
        assert r[nome]['versao'] == 'v0001', r[nome]
    registo = json.loads((tmp_path / 'modelos' / 'registo.json').read_text(encoding='utf-8'))
    assert [x['modelo'] for x in registo] == ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']


def test_uma_versao_ilegivel_nao_bloqueia_o_modelo(tmp_path):
    gerar(tmp_path, POLAR)
    assert treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]['versao'] == 'v0001'
    pasta = tmp_path / 'modelos' / 'velocidade'
    (pasta / 'v0002.json.gz').write_bytes(b'')  # corte de luz a meio da escrita: ficheiro vazio
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', semente=2)  # saída nova
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0003' and not r['motivo'].startswith('erro:'), r
    assert (pasta / 'v0003.json.gz').exists()
    assert (pasta / 'v0002.json.gz').read_bytes() == b''  # ilegível, mas nunca tocada


def test_atual_a_apontar_para_versao_ilegivel_conta_como_sem_modelo_em_uso(tmp_path):
    gerar(tmp_path, POLAR)
    pasta = tmp_path / 'modelos' / 'velocidade'
    pasta.mkdir(parents=True)
    (pasta / 'v0001.json.gz').write_bytes(b'lixo')
    (pasta / 'atual').write_text('v0001', encoding='utf-8')
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0002' and not r['motivo'].startswith('erro:'), r
    assert r['maeAtual'] is None  # comparado com a polar/curva de origem, como se não houvesse modelo em uso
    assert (pasta / 'v0001.json.gz').read_bytes() == b'lixo'  # ilegível, mas nunca tocada


def test_versao_antiga_sem_ultima_saida_nao_bloqueia(tmp_path):
    gerar(tmp_path, POLAR)
    assert treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]['versao'] == 'v0001'
    pasta = tmp_path / 'modelos' / 'velocidade'
    modelo = carregar(pasta, 'v0001')
    del modelo['ultimaSaida']  # versões antigas, de antes deste campo existir
    (pasta / 'v0001.json.gz').write_bytes(gzip.compress(json.dumps(modelo).encode('utf-8')))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]  # mesma saída, sem referência para o teste
    assert r['versao'] == 'v0002' and not r['motivo'].startswith('sem saída nova'), r


def test_o_primeiro_modelo_pior_do_que_a_origem_fica_guardado_mas_nao_entra_em_uso(tmp_path):
    gerar(tmp_path, POLAR, fator_consumo=1.0)  # o motor gasta exatamente o que a Volvo diz
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['consumo'])[0]
    assert r['versao'] == 'v0001' and r['aceite'] is False and r['mae'] >= r['maeBase'], r
    assert (tmp_path / 'modelos' / 'consumo' / 'v0001.json.gz').exists()
    assert not (tmp_path / 'modelos' / 'consumo' / 'atual').exists()


def cortar_primeiro_dia(pasta):
    """Reescreve o 1.º dia da tabela em 2 membros gzip (como a caixa negra) e corta o 2.º a meio."""
    f = sorted((pasta / 'tabela').glob('*.csv.gz'))[0]
    linhas = gzip.decompress(f.read_bytes()).decode().splitlines(keepends=True)
    m1 = gzip.compress(''.join(linhas[:len(linhas) // 2]).encode())
    m2 = gzip.compress(''.join(linhas[len(linhas) // 2:]).encode())
    f.write_bytes(m1 + m2[:len(m2) // 2])
    return f


def test_um_dia_da_tabela_cortado_nao_impede_o_treino(tmp_path, capsys):
    gerar(tmp_path, POLAR)
    f = cortar_primeiro_dia(tmp_path)
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0001' and not r['motivo'].startswith('erro'), r
    assert f.name in capsys.readouterr().err


def test_um_dia_isolado_como_danificado_continua_a_ensinar(tmp_path):
    # a caixa negra isolou o ficheiro do 1.º dia (corte de energia, o Pi voltou no mesmo dia UTC): a saída desse dia
    # não se perde para a AI (auditoria I-34)
    gerar(tmp_path, POLAR)
    f = sorted((tmp_path / 'tabela').glob('*.csv.gz'))[0]
    f.rename(f.with_name(f.name + '.danificado-2026-06-01T12-00-00Z'))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0001', r
    assert r['horas'] == pytest.approx(3 * 4.0, abs=0.01), r  # as 3 saídas, como sem o corte


def test_uma_previsao_cortada_ou_torta_nao_impede_o_treino(tmp_path, capsys):
    gerar(tmp_path, POLAR)
    ps = sorted((tmp_path / 'previsoes').glob('*.json'))
    texto = ps[0].read_text(encoding='utf-8')
    ps[0].unlink()
    (tmp_path / 'previsoes' / (ps[0].name + '.gz')).write_bytes(gzip.compress(texto.encode())[:40])
    torta = json.loads(ps[1].read_text(encoding='utf-8'))
    torta['tws'] = torta['tws'][:-1]
    ps[1].write_text(json.dumps(torta), encoding='utf-8')
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['ventoForca'])[0]
    assert r['versao'] == 'v0001' and not r['motivo'].startswith('erro'), r
    err = capsys.readouterr().err
    assert ps[0].name + '.gz' in err and ps[1].name in err


def test_so_le_os_dias_das_saidas_e_so_as_linhas_de_3_h_antes_ate_ao_fim(tmp_path, monkeypatch):
    from arlequin_ia import dados, treino
    gerar(tmp_path, POLAR)  # saídas a 1, 2 e 3 de junho, das 08:00 às 14:00
    cab = 't,lat,lon,stw,simulado,estavel\n'
    (tmp_path / 'tabela' / '2026-06-05.csv.gz').write_bytes(gzip.compress((cab + '2026-06-05T10:00:00.000Z,39,-9,4,0,1\n').encode()))
    f = tmp_path / 'tabela' / '2026-06-01.csv.gz'  # no porto: de madrugada (fora) e às 05:30 (dentro das 3 h antes)
    porto = pd.DataFrame({c: [np.nan, np.nan] for c in COLUNAS}).assign(
        t=['2026-06-01T01:00:00.000Z', '2026-06-01T05:30:00.000Z'], simulado=0, estavel=0)
    f.write_bytes(f.read_bytes() + gzip.compress(porto[COLUNAS].to_csv(index=False, header=False).encode()))
    abertos, vistos = [], []
    ler = dados.ler_ficheiro_tabela
    monkeypatch.setattr(dados, 'ler_ficheiro_tabela', lambda ficheiro: abertos.append(ficheiro.name) or ler(ficheiro))
    preparar = treino.preparar
    monkeypatch.setattr(treino, 'preparar', lambda df, *a: vistos.append(df) or preparar(df, *a))
    treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])
    assert abertos == ['2026-06-01.csv.gz', '2026-06-02.csv.gz', '2026-06-03.csv.gz']
    t = vistos[0]['t']
    assert pd.Timestamp('2026-06-01T05:30:00Z') in set(t) and pd.Timestamp('2026-06-01T01:00:00Z') not in set(t)
    assert t.min() == pd.Timestamp('2026-06-01T05:30:00Z') and t.max() < pd.Timestamp('2026-06-04T00:00:00Z')


def test_saida_que_comeca_depois_da_meia_noite_le_tambem_o_dia_anterior(tmp_path, monkeypatch):
    from arlequin_ia import dados
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-02T01:00:00Z')
    abertos = []
    ler = dados.ler_ficheiro_tabela
    monkeypatch.setattr(dados, 'ler_ficheiro_tabela', lambda ficheiro: abertos.append(ficheiro.name) or ler(ficheiro))
    (tmp_path / 'tabela' / '2026-06-01.csv.gz').write_bytes(gzip.compress(b't,pressao\n2026-06-01T23:00:00.000Z,1015\n'))
    treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])
    assert abertos == ['2026-06-01.csv.gz', '2026-06-02.csv.gz']


def test_sem_saidas_gravadas_nao_treina_nem_inventa_sessoes(tmp_path):
    gerar(tmp_path, POLAR)
    for f in (tmp_path / 'saidas').glob('*.json'):
        f.unlink()
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert [x['modelo'] for x in r] == ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']
    assert all(x['versao'] is None and x['aceite'] is False and x['motivo'] == 'sem saídas gravadas' for x in r), r


def test_pasta_vazia_nao_rebenta(tmp_path):
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert all(x['motivo'] == 'sem saídas gravadas' for x in r), r


def test_com_saidas_mas_sem_tabela_da_poucos_dados(tmp_path):
    (tmp_path / 'saidas').mkdir()
    (tmp_path / 'saidas' / 'a.json').write_text(json.dumps({'inicio': '2026-06-01T08:00:00Z', 'fim': '2026-06-01T14:00:00Z'}))
    r = treinar(tmp_path, POLAR, agora=AGORA)
    assert len(r) == 4 and all(x['versao'] is None and x['motivo'].startswith('poucos dados (0,0 h') for x in r), r


def test_registo_ilegivel_avisa_nao_lhe_toca_e_devolve_os_resultados(tmp_path, capsys):
    for conteudo in ('{', '{"a": 1}'):
        (tmp_path / 'modelos').mkdir(exist_ok=True)
        registo = tmp_path / 'modelos' / 'registo.json'
        registo.write_text(conteudo, encoding='utf-8')
        r = treinar(tmp_path, POLAR, agora=AGORA)
        assert len(r) == 4
        assert registo.read_text(encoding='utf-8') == conteudo
        assert 'registo.json' in capsys.readouterr().err


def test_ultima_saida_curta_junta_as_anteriores_ao_teste_ate_1_h(tmp_path):
    gerar(tmp_path, POLAR)  # 3 saídas com 4 h à vela
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', horas_motor=0, horas_vela=0.5, semente=2)  # 30 min
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] == 'v0001', r
    assert r['nTeste'] == 180 + 1440  # a saída curta mais a anterior (a mais recente primeiro)
    m = carregar(tmp_path / 'modelos' / 'velocidade', 'v0001')
    assert m['nTeste'] == 180 + 1440
    assert m['ultimaSaida'] == '2026-06-10T08:00:00+00:00'  # a guarda continua a ser a saída mais recente


def test_saida_de_teste_curta_sem_outras_para_juntar_nao_grava_versao(tmp_path):
    gerar(tmp_path, POLAR, sessoes=1, horas_motor=0, horas_vela=6)
    gerar(tmp_path, POLAR, sessoes=1, inicio='2026-06-10T08:00:00Z', horas_motor=0, horas_vela=0.5, semente=2)
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['versao'] is None and r['aceite'] is False and r['motivo'] == 'saída de teste curta (<1 h)', r
    assert not list((tmp_path / 'modelos' / 'velocidade').glob('v*.json.gz'))


def test_velocidade_so_a_vela_com_pelo_menos_uma_vela_em_cima():
    from arlequin_ia.treino import MODELOS
    casos = [  # (rpm, grandeRizos, genoaPct) → conta como vela?
        ((0, 0, 100), True), ((200, 1, 0), True), ((np.nan, 0, 0), True), ((np.nan, -1, 70), True),
        ((0, -1, 0), False),        # velas em baixo: nunca é vela
        ((np.nan, -1, 0), False),   # sem rotações (ignição desligada ou CAN em baixo) e velas em baixo
        ((np.nan, np.nan, np.nan), False),
        ((1800, 0, 100), False),    # motor a trabalhar com velas em cima
    ]
    d = pd.DataFrame([dict(rpm=r, grandeRizos=g, genoaPct=p, prevTws=8.0, twaPrevAbs=90.0, stw=5.0) for (r, g, p), _ in casos])
    assert list(MODELOS['velocidade']['filtro'](d)) == [c for _, c in casos]


def test_sem_rotacoes_e_velas_em_baixo_nao_ensina_a_velocidade(tmp_path):
    gerar(tmp_path, POLAR)  # 2 h a motor + 4 h à vela por saída
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):  # o CAN do motor em baixo: a motor não há rotações
        df = pd.read_csv(f, compression='gzip')
        motor = df['rpm'] > 0
        df.loc[motor, ['rpm', 'litrosHora']] = np.nan
        df.loc[motor, 'grandeRizos'] = -1
        df.loc[motor, 'genoaPct'] = 0
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['horas'] == pytest.approx(3 * 4.0, abs=0.01), r  # só as horas à vela


def test_consumo_so_aprende_com_o_caudal_medido(tmp_path):
    gerar(tmp_path, POLAR)
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):  # o MDI não manda a PGN 65266: é a estimativa do plugin J1939
        df = pd.read_csv(f, compression='gzip')
        df.loc[df['litrosHora'].notna(), 'consumoMedido'] = 0
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['consumo'])[0]
    assert r['versao'] is None and r['motivo'].startswith('poucos dados (0,0 h'), r


def test_consumo_de_ficheiros_antigos_sem_a_origem_nao_ensina(tmp_path):
    gerar(tmp_path, POLAR)
    for f in (tmp_path / 'tabela').glob('*.csv.gz'):
        df = pd.read_csv(f, compression='gzip').drop(columns=['consumoMedido'])
        f.write_bytes(gzip.compress(df.to_csv(index=False).encode()))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['consumo'])[0]
    assert r['versao'] is None and r['motivo'].startswith('poucos dados (0,0 h'), r


def test_variaveis_de_planeamento_so_o_que_se_sabe_antes_de_partir():
    from arlequin_ia.treino import MODELOS
    assert MODELOS['velocidade']['variaveis'] == ['prevTws', 'twaPrevAbs', 'prevRajada', 'prevOndas', 'prevPeriodo',
                                                  'ondasAnguloRel', 'grandeRizos', 'genoaPct']
    assert MODELOS['consumo']['variaveis'] == ['rpm', 'prevOndas', 'ondasAnguloRel']


def test_velocidade_so_aprende_com_previsao_arquivada():
    # precisa do vento previsto (força e ângulo); o vento medido já não conta (nem para a base)
    from arlequin_ia.treino import MODELOS
    d = pd.DataFrame({'rpm': [0.0] * 4, 'grandeRizos': [0] * 4, 'genoaPct': [100] * 4,
                      'tws': [10.0, 10.0, 10.0, np.nan], 'twaAbs': [90.0, 90.0, 90.0, np.nan], 'stw': [5.0] * 4,
                      'prevTws': [8.0, np.nan, 8.0, 8.0], 'twaPrevAbs': [85.0, 85.0, np.nan, 85.0]})
    assert list(MODELOS['velocidade']['filtro'](d)) == [True, False, False, True]


def test_base_da_velocidade_e_a_polar_com_a_mesma_informacao_do_modelo():
    # a origem com que o 1.º modelo se compara é a polar no vento previsto em bruto, não no medido
    from arlequin_ia.treino import MODELOS
    d = pd.DataFrame({'tws': [14.0, 20.0], 'twaAbs': [120.0, 150.0], 'prevTws': [8.0, 12.0], 'twaPrevAbs': [60.0, 90.0]})
    base = MODELOS['velocidade']['base'](d, POLAR)
    assert np.allclose(base, stw_polar(POLAR, [60.0, 90.0], [8.0, 12.0]))
    assert not np.allclose(base, stw_polar(POLAR, [120.0, 150.0], [14.0, 20.0]))


def test_sem_previsoes_a_velocidade_nao_aprende_mas_o_consumo_sim(tmp_path):
    gerar(tmp_path, POLAR)
    for f in (tmp_path / 'previsoes').glob('*.json'):
        f.unlink()
    r = {x['modelo']: x for x in treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade', 'consumo'])}
    assert r['velocidade']['versao'] is None and r['velocidade']['motivo'].startswith('poucos dados (0,0 h'), r
    assert r['consumo']['versao'] == 'v0001', r


def test_celulas_pelo_vento_previsto_em_bruto():
    # o planeador chama pesoCelula (lib/modelos.js) com o vento previsto em bruto: as células têm de ser do prevTws
    from arlequin_ia.treino import celulas
    # ... e do ângulo ao vento previsto (twaPrevAbs), não do medido (twaAbs)
    d = pd.DataFrame({'tws': [12.0] * 360 + [12.0] * 720, 'prevTws': [9.5] * 360 + [10.9] * 720,
                      'twaAbs': [100.0] * 1080, 'twaPrevAbs': [61.0] * 1080})
    assert celulas(d) == {'10|60': 2.0, '8|60': 1.0}


def test_frases_da_velocidade_falam_do_vento_previsto(treinado):
    _, r = treinado
    assert all(re.search(r'^a \d+° do vento previsto com \d+ nós previstos andas \d+,\d nós \(a polar dizia \d+,\d\)$', f)
               for f in r['velocidade']['frases']), r['velocidade']['frases']


def test_velocidade_aguenta_uma_previsao_com_erro(tmp_path):
    # a previsão em bruto erra (1,5 nós na força e 10° na direção, ao acaso): o 1.º modelo tem de continuar a
    # bater a polar com a mesma previsão
    gerar(tmp_path, POLAR, ruido_previsao=(1.5, 10.0))
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['velocidade'])[0]
    assert r['aceite'] is True, r
    assert r['mae'] < r['maeBase'], r
