"""A ferramenta da costa com uma costa inventada: uma costa oeste que vira para leste num canto
(como o Cabo de São Vicente), um cabo em L espetado para oeste, uma baía estreita, uma ilha perto
(que as linhas têm de contornar) e outra longe (que as linhas ignoram)."""

import gzip
import json

import numpy as np
import pytest
import shapefile
import shapely
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape

import gerar
from utm import de_utm, para_utm

MN = 1852.0
BBOX = (-10.0, 37.5, -7.0, 40.2)       # lon mín, lat mín, lon máx, lat máx
COSTA_LON = -9.0                      # costa oeste
CANTO_LAT = 38.0                      # a costa sul
INICIO_LAT, FIM_LON = 40.0, -7.3
BAIA_LAT, BAIA_LARGURA_MN, BAIA_FUNDO_MN = 39.0, 2.0, 7.0
ILHA_LAT, ILHA_AO_LARGO_MN, ILHA_RAIO_MN = 39.35, 5.5, 0.5
LONGE_LAT, LONGE_AO_LARGO_MN, LONGE_RAIO_MN = 39.85, 20.0, 1.0


def circulo(lat, ao_largo_mn, raio_mn):
    """Uma ilha redonda (em metros) a `ao_largo_mn` da costa oeste, devolvida em lon/lat."""
    x, y = para_utm(lat, COSTA_LON)
    c = Point(float(x) - ao_largo_mn * MN, float(y)).buffer(raio_mn * MN, quad_segs=32)
    return shapely.transform(c, lambda xy: np.column_stack(de_utm(xy[:, 0], xy[:, 1])[::-1]))


def em_graus_lon(mn, lat):
    return mn / (60 * np.cos(np.radians(lat)))


def terra_inventada():
    continente = box(COSTA_LON, CANTO_LAT, -6.0, 41.0)
    cabo = Polygon([(-9.08, 38.55), (-9.08, 38.65), (-9.0, 38.65), (-9.0, 38.63), (-9.06, 38.63), (-9.06, 38.55)])  # um L
    meia = BAIA_LARGURA_MN / 2 / 60
    baia = box(COSTA_LON, BAIA_LAT - meia, COSTA_LON + em_graus_lon(BAIA_FUNDO_MN, BAIA_LAT), BAIA_LAT + meia)
    continente = continente.union(cabo).difference(baia).segmentize(0.01)
    # como o OSM, o continente vem partido em pedaços
    norte, sul = continente.intersection(box(-11, 39.5, -5, 42)), continente.intersection(box(-11, 36, -5, 39.5))
    fora = box(-9.5, 36.0, -9.4, 36.1)  # fora da caixa: não pode aparecer
    return [norte, sul, circulo(ILHA_LAT, ILHA_AO_LARGO_MN, ILHA_RAIO_MN),
            circulo(LONGE_LAT, LONGE_AO_LARGO_MN, LONGE_RAIO_MN), fora]


@pytest.fixture(scope='module')
def shp(tmp_path_factory):
    p = tmp_path_factory.mktemp('osm') / 'land_polygons'
    with shapefile.Writer(str(p), shapeType=shapefile.POLYGON) as w:
        w.field('FID', 'N')
        for i, g in enumerate(terra_inventada()):
            for pol in getattr(g, 'geoms', [g]):
                w.shape(mapping(pol))
                w.record(i)
    return p.with_suffix('.shp')


@pytest.fixture(scope='module')
def resultado(shp, tmp_path_factory):
    saida = tmp_path_factory.mktemp('dados')
    r = gerar.gerar(shp, saida, bbox=BBOX, inicio_lat=INICIO_LAT, fim_lon=FIM_LON)
    return saida, r


def em_metros(latlon):
    x, y = para_utm(latlon[:, 0], latlon[:, 1])
    return np.column_stack([x, y])


def amostras(latlon, passo_m=50):
    """Pontos de 50 em 50 m ao longo da linha (os troços simplificados também contam, não só os vértices)."""
    return shapely.get_coordinates(LineString(em_metros(latlon)).segmentize(passo_m))


def test_le_so_a_terra_dentro_da_caixa_e_junta_os_pedacos(shp):
    t = gerar.ler_terra(shp, BBOX)
    minx, miny, maxx, maxy = t.bounds
    assert minx >= BBOX[0] and miny >= BBOX[1] and maxx <= BBOX[2] and maxy <= BBOX[3]
    partes = sorted(getattr(t, 'geoms', [t]), key=lambda g: -g.area)
    assert len(partes) == 3  # o continente (um só, sem a costura dos pedaços) e as duas ilhas
    assert partes[0].contains(Point(-8.0, 39.5)) and not partes[0].contains(Point(-8.95, BAIA_LAT))  # a baía é mar


@pytest.mark.parametrize('d', [3, 5, 8])
def test_a_linha_fica_a_d_mais_ou_menos_0_1_mn_da_terra(resultado, d):
    _, r = resultado
    dist = shapely.distance(shapely.points(amostras(r['linhas'][d])), r['terra_m']) / MN
    assert dist.min() >= d - 0.1 and dist.max() <= d + 0.1, (dist.min(), dist.max())


@pytest.mark.parametrize('d', [3, 5, 8])
def test_de_norte_para_sul_e_depois_para_leste_sem_se_cruzar(resultado, d):
    _, r = resultado
    ll = r['linhas'][d]
    assert ll[0, 0] == pytest.approx(INICIO_LAT, abs=1e-6) and ll[0, 1] < COSTA_LON  # começa a norte, ao largo
    assert ll[-1, 1] == pytest.approx(FIM_LON, abs=1e-6) and ll[-1, 0] < CANTO_LAT   # acaba a leste, a sul da costa
    assert LineString(ll[:, ::-1]).is_simple
    # a avançar sempre ao longo da costa (fora da volta à ilha, onde sobe um pouco para a contornar)
    espinha = LineString([(COSTA_LON, 41.0), (COSTA_LON, CANTO_LAT), (-6.0, CANTO_LAT)])
    ilha = circulo(ILHA_LAT, ILHA_AO_LARGO_MN, ILHA_RAIO_MN)
    longe_da_ilha = [not ilha.buffer(em_graus_lon(d + 1, ILHA_LAT)).contains(Point(lon, lat)) for lat, lon in ll]
    s = np.array([espinha.project(Point(lon, lat)) for lat, lon in ll[longe_da_ilha]])
    assert np.all(np.diff(s) >= -1e-9)


@pytest.mark.parametrize('d', [3, 5, 8])
def test_contorna_a_ilha_perto_e_ignora_a_longe(resultado, d):
    _, r = resultado
    ll = shapely.get_coordinates(LineString(r['linhas'][d][:, ::-1]).segmentize(0.001))[:, ::-1]  # densa
    ilha_oeste = circulo(ILHA_LAT, ILHA_AO_LARGO_MN, ILHA_RAIO_MN).bounds[0]
    perto = np.abs(ll[:, 0] - ILHA_LAT) < 0.02
    assert ll[perto, 1].min() == pytest.approx(ilha_oeste - em_graus_lon(d, ILHA_LAT), abs=em_graus_lon(0.1, ILHA_LAT))
    # a ilha longe (a 20 MN) fica de fora: ali a linha está a d MN do continente
    ali = np.abs(ll[:, 0] - LONGE_LAT) < 0.02
    assert ll[ali, 1].min() == pytest.approx(COSTA_LON - em_graus_lon(d, LONGE_LAT), abs=em_graus_lon(0.1, LONGE_LAT))


def test_a_linha_de_3_mn_nao_entra_na_baia_estreita(resultado):
    _, r = resultado
    ll = shapely.get_coordinates(LineString(r['linhas'][3][:, ::-1]).segmentize(0.001))[:, ::-1]
    ali = np.abs(ll[:, 0] - BAIA_LAT) < 3 / 60
    assert ali.sum() > 10
    # à frente da boca (2 MN de largura) a linha passa a √(3² − 1²) ≈ 2,83 MN da costa, nunca dentro
    assert ll[ali, 1].max() <= COSTA_LON - em_graus_lon(2.8, BAIA_LAT)


def test_contorna_o_canto_a_d_do_vertice(resultado):
    _, r = resultado
    canto = np.array(para_utm(CANTO_LAT, COSTA_LON))
    for d in (3, 5, 8):
        m = amostras(r['linhas'][d])
        assert np.hypot(*(m - canto).T).min() == pytest.approx(d * MN, abs=0.1 * MN)


def test_escreve_os_ficheiros(resultado):
    saida, r = resultado
    terra = json.loads(gzip.decompress((saida / 'terra.geojson.gz').read_bytes()))
    assert terra['type'] == 'FeatureCollection'
    geoms = [shape(f['geometry']) for f in terra['features']]
    assert len(geoms) == 3 and all(g.is_valid for g in geoms)
    assert any(g.contains(Point(-8.0, 39.5)) for g in geoms)  # lon, lat como manda o GeoJSON
    linhas = json.loads(gzip.decompress((saida / 'linhas-costa.json.gz').read_bytes()))
    assert sorted(linhas) == ['3', '5', '8']
    for d in (3, 5, 8):
        assert np.allclose(np.array(linhas[str(d)]), r['linhas'][d], atol=1e-5)  # [lat, lon], 5 casas
        assert linhas[str(d)][0][0] > 39.9  # [lat, lon]: a latitude primeiro


def test_simplificada_sem_pontos_a_mais(resultado):
    _, r = resultado
    for d in (3, 5, 8):
        seg = np.hypot(*np.diff(em_metros(r['linhas'][d]), axis=0).T) / MN
        assert np.median(seg) > 0.3, np.median(seg)  # nas retas, poucos pontos
        assert seg.min() > 0.001
