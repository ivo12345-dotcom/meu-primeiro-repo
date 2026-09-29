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
from arlequin_ia.dados import ler_tabela
from arlequin_ia.sintetico import gerar, verdade_stw
from arlequin_ia.treino import carregar, prever_guardado, treinar

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
    x.loc[0, ['tws', 'twaAbs', 'rajada', 'grandeRizos', 'genoaPct', 'rpm', 'adornoAbs']] = [12, 60, 15.6, 0, 100, 0, 9.6]
    x.loc[0, ['prevOndas', 'prevPeriodo', 'ondasAnguloRel', 'balAdorno', 'balCaimento']] = [1.5, 8, 100, 1.5, 2]
    previsto = prever_guardado(m, x)[0]
    verdade = float(verdade_stw(POLAR, [60], [12])[0])
    assert abs(previsto - verdade) / verdade < 0.04, (previsto, verdade)


def test_vento_e_consumo_aprendem_o_desvio_da_previsao_e_da_volvo(treinado):
    _, r = treinado
    pct = int(re.search(r'(\d+)% mais forte', r['ventoForca']['frases'][0]).group(1))
    assert 15 <= pct <= 25  # os dados inventados têm o vento real 20% mais forte
    assert any('rpm gastas' in f and 'a Volvo diz' in f for f in r['consumo']['frases'])
    assert len(r['velocidade']['frases']) == 3 and all('a polar dizia' in f for f in r['velocidade']['frases'])


def test_quantis_por_ordem_em_media(treinado):
    d, _ = treinado
    m = carregar(d / 'modelos' / 'velocidade', 'v0001')
    x = pd.DataFrame({'tws': np.linspace(5, 20, 30), 'twaAbs': np.linspace(45, 170, 30)})
    for v in m['variaveis']:
        if v not in x:
            x[v] = np.nan
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
    df = ler_tabela(d)
    ultima = df[(df['t'] >= pd.Timestamp('2026-06-03T00:00:00Z')) & (df['rpm'] <= 0)]  # a vela na última saída
    base_vela = float(np.mean(np.abs(stw_polar(POLAR, ultima['twa'].abs(), ultima['tws']) - ultima['stw'])))
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
    pasta = tmp_path / 'modelos' / 'velocidade'
    pasta.mkdir(parents=True)
    (pasta / 'v0001.json.gz').write_bytes(b'lixo')
    (pasta / 'atual').write_text('v0001', encoding='utf-8')
    r = {x['modelo']: x for x in treinar(tmp_path, POLAR, agora=AGORA)}
    v = r['velocidade']
    assert v['motivo'].startswith('erro:') and v['versao'] is None and v['aceite'] is False, v
    assert v['modelo'] == 'velocidade' and v['data'] == AGORA.isoformat()
    for nome in ('ventoForca', 'ventoDirecao', 'consumo'):
        assert r[nome]['versao'] == 'v0001', r[nome]
    registo = json.loads((tmp_path / 'modelos' / 'registo.json').read_text(encoding='utf-8'))
    assert [x['modelo'] for x in registo] == ['velocidade', 'ventoForca', 'ventoDirecao', 'consumo']


def test_o_primeiro_modelo_pior_do_que_a_origem_fica_guardado_mas_nao_entra_em_uso(tmp_path):
    gerar(tmp_path, POLAR, fator_consumo=1.0)  # o motor gasta exatamente o que a Volvo diz
    r = treinar(tmp_path, POLAR, agora=AGORA, modelos=['consumo'])[0]
    assert r['versao'] == 'v0001' and r['aceite'] is False and r['mae'] >= r['maeBase'], r
    assert (tmp_path / 'modelos' / 'consumo' / 'v0001.json.gz').exists()
    assert not (tmp_path / 'modelos' / 'consumo' / 'atual').exists()
