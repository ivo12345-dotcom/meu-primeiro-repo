"""A validação dos destinos (validar_destinos.py): primeiro com um porto inventado (dois molhes a sair
de uma costa reta, boca virada a oeste), depois com os dados reais do plugin."""

import json

import pytest
from shapely.geometry import box

import gerar
import validar_destinos as vd

# terra a leste de 9,0° W; dois molhes de ~870 m para oeste, a ~110 m de cada lado do paralelo 39,0
COSTA = box(-9.0, 38.9, -8.9, 39.1)
MOLHE_N = box(-9.010, 39.0010, -9.0, 39.0013)
MOLHE_S = box(-9.010, 38.9987, -9.0, 38.9990)
ZONA = {'nome': 'Baixo inventado', 'tipo': 'baixio', 'fonte': 'teste', 'confirmado': False,
        # o bordo norte fica a 0,0034° (≈ 0,2 MN) a sul do paralelo 39,0 por onde se chega
        'poligono': [[38.990, -9.04], [38.990, -9.03], [38.9966, -9.03], [38.9966, -9.04], [38.990, -9.04]]}


def destino(id_, aproximacao, entrada, **extra):
    return {'id': id_, 'nome': id_, 'abrigo': True, 'conhecido': False, 'largo': aproximacao[0],
            'aproximacao': aproximacao, 'entrada': entrada, 'notas': '', 'fonte': 'teste', 'confirmado': False, **extra}


BOM = destino('bom', [[39.0, -9.05], [39.0, -9.015], [39.0, -9.008], [39.0, -9.002]], 2)


@pytest.fixture(scope='module')
def terra_m():
    return gerar.para_metros(COSTA.union(MOLHE_N).union(MOLHE_S))


def problemas(terra_m, d, zonas=()):
    return vd.validar([d], list(zonas), terra_m)[0]['problemas']


def test_um_porto_bem_feito_passa(terra_m):
    r = vd.validar([BOM], [], terra_m)[0]
    assert r['problemas'] == []
    assert [t['terra_m'] for t in r['trocos']] == [0, 0, 0]
    assert r['boca'] is True


def test_um_troco_ate_a_entrada_que_corta_o_molhe_falha(terra_m):
    d = destino('corta', [[39.01, -9.03], [39.0, -9.004]], 1)   # atravessa o molhe norte
    p = problemas(terra_m, d)
    assert any(x.startswith('troço 1') and 'terra' in x for x in p), p


def test_um_troco_ate_a_entrada_a_menos_de_10_m_da_terra_falha(terra_m):
    # rente ao molhe norte (~5,5 m por baixo dele): o plugin conta encostar como cortar, não há folga
    d = destino('rente', [[39.0, -9.05], [39.00095, -9.02], [39.00095, -9.008]], 2)
    p = problemas(terra_m, d)
    assert any(x.startswith('troço 2') and 'mínimo 10 m' in x for x in p), p


def test_portoFechadoOsm_relaxa_a_terra_depois_da_entrada(terra_m):
    # com portoFechadoOsm: o OSM fecha a doca/rio com terra e isso não conta como problema, só aparece na tabela
    d = destino('doca', [[39.0, -9.05], [39.0, -9.015], [39.0, -9.008], [39.0, -8.995]], 2, portoFechadoOsm=True)
    r = vd.validar([d], [], terra_m)[0]
    assert r['problemas'] == []
    assert r['trocos'][2]['terra_m'] > 0 and r['trocos'][2]['porto'] is True


def test_sem_portoFechadoOsm_a_terra_depois_da_entrada_falha(terra_m):
    # a mesma geometria, mas sem portoFechadoOsm (omisso = False): a terra depois da entrada já é um problema
    d = destino('doca', [[39.0, -9.05], [39.0, -9.015], [39.0, -9.008], [39.0, -8.995]], 2)
    p = problemas(terra_m, d)
    assert any(x.startswith('troço 3') and 'terra' in x for x in p), p


def test_a_geometria_antiga_da_nazare_corta_terra_e_e_reportada():
    # git show 9e5a14f:software/signalk-arlequin-rota/dados/destinos.json — antes da revisão da entrada,
    # o troço 3 cortava ~218 m de terra (o molhe sul) depois da entrada e passava sem problemas
    velha = destino('nazare', [[39.575, -9.11], [39.585, -9.083], [39.586, -9.079], [39.5855, -9.076]], 2)
    destinos, zonas, terra_m = vd.carregar(gerar.SAIDA)
    r = vd.validar([velha], zonas, terra_m)[0]
    assert any(x.startswith('troço 3') and 'terra' in x for x in r['problemas']), r['problemas']


def test_uma_entrada_junto_a_praia_reta_com_troco_que_corta_terra_falha(terra_m):
    # entrada a ~17 m de uma praia reta e sem molhes (longe dos molhes do fixture, lat 38,95): passa na
    # heurística da boca (< 25 m de fora), mas o troço seguinte atravessa ~865 m de terra e tem de falhar
    d = destino('praia', [[38.95, -9.05], [38.95, -9.00019624], [38.95, -8.99]], 1)
    r = vd.validar([d], [], terra_m)[0]
    assert r['boca'] is True
    assert any(x.startswith('troço 2') and 'terra' in x for x in r['problemas']), r['problemas']


def test_a_entrada_fora_da_boca_falha(terra_m):
    # a 430 m das cabeças dos molhes, no mar aberto: não é "o primeiro ponto dentro da boca"
    d = destino('cedo', BOM['aproximacao'], 1)
    p = problemas(terra_m, d)
    assert any('entrada' in x and 'boca' in x for x in p), p


def test_a_entrada_em_frente_a_boca_mas_ca_fora_falha(terra_m):
    # ~130 m a oeste das cabeças: há molhe dos dois lados a menos de 400 m, mas ainda não se entrou
    d = destino('fora', [[39.0, -9.05], [39.0, -9.0115]], 1)
    p = problemas(terra_m, d)
    assert any('entrada' in x and 'para fora das cabeças' in x for x in p), p


def test_o_largo_em_terra_falha(terra_m):
    d = destino('largo', [[39.05, -8.95], [39.0, -9.015], [39.0, -9.008]], 2)
    assert any('largo' in x for x in problemas(terra_m, d))


def test_a_menos_de_0_3_mn_de_uma_zona_falha_salvo_a_do_proprio_porto(terra_m):
    p = problemas(terra_m, BOM, [ZONA])
    assert any('Baixo inventado' in x for x in p), p
    r = vd.validar([BOM], [ZONA], terra_m)[0]
    assert r['zona_mn'] == pytest.approx(0.2, abs=0.01)
    assert problemas(terra_m, {**BOM, 'zona': 'Baixo inventado'}, [ZONA]) == []


def test_os_ficheiros_json_tem_fins_de_linha_lf_e_newline_final():
    for nome in ('destinos.json', 'zonas.json'):
        b = (gerar.SAIDA / nome).read_bytes()
        assert b'\r' not in b and b.endswith(b'\n'), nome
        json.loads(b)


def test_os_destinos_reais_passam():
    destinos, zonas, terra_m = vd.carregar(gerar.SAIDA)
    resultados = vd.validar(destinos, zonas, terra_m)
    assert len(resultados) == len(destinos) == 15
    falhas = {r['id']: r['problemas'] for r in resultados if r['problemas']}
    assert falhas == {}
