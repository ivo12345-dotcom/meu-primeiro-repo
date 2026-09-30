"""A costa continental pré-calculada para o plugin da rota (signalk-arlequin-rota/dados/).

Corre no portátil, uma vez (ou quando se quiser a costa do OSM mais recente):

    cd software/ferramentas/costa
    pip install -r requirements.txt
    python gerar.py                      # descarrega o OSM se faltar, escreve os 2 ficheiros
    python gerar.py --osm PASTA --saida PASTA
    python -m pytest -q                  # os testes, com uma costa inventada

1. Descarrega do osmdata.openstreetmap.de os polígonos de terra (land-polygons-split-4326, ~900 MB)
   para uma pasta FORA do repositório (por omissão Documents/dados-osm), só se ainda lá não estiverem.
2. Lê só os pedaços dentro da caixa 36,8°–42,2° N × 10,5°–6,9° W (com o pyshp), junta-os e passa-os para
   UTM 29N (em metros, utm.py), simplificados a ~50 m.
3. `terra.geojson.gz`: essa terra em lon/lat (GeoJSON, 5 casas decimais ≈ 1 m), em gzip.
4. `linhas-costa.json.gz`: { "3": [[lat, lon], …], "5": …, "8": … }. Para cada afastamento d, a terra
   alargada d MN; do contorno exterior do pedaço maior (o continente, com as ilhas a menos de 2d, que ficam
   por dentro) fica só o troço português do lado do mar: de norte (o paralelo da foz do Minho, 41,87° N)
   para sul, a volta ao Cabo de São Vicente e para leste até ao meridiano da foz do Guadiana (7,40° W).
   Não entra nos rios nem nas baías com menos de 2d de boca (esses ficam em buracos, que se deitam fora).
   Simplificada com uma tolerância de 0,05 MN: a linha fica a d ± 0,1 MN da terra e, nas retas, com
   pontos a ~0,5 MN ou mais uns dos outros.
"""

import argparse
import gzip
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import shapefile
import shapely
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import substring

from utm import de_utm, para_utm

MN = 1852.0
BBOX = (-10.5, 36.8, -6.9, 42.2)   # lon mín, lat mín, lon máx, lat máx
AFASTAMENTOS = (3, 5, 8)           # MN
INICIO_LAT = 41.87                 # foz do Minho (Caminha): a linha começa neste paralelo
FIM_LON = -7.40                    # foz do Guadiana (Vila Real de Santo António): e acaba neste meridiano
SIMPLIFICAR_TERRA_M = 50.0
TOLERANCIA_LINHA_MN = 0.05
URL_OSM = 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip'
PASTA_OSM = Path.home() / 'Documents' / 'dados-osm'
SHP_OSM = Path('land-polygons-split-4326', 'land_polygons.shp')
SAIDA = Path(__file__).resolve().parents[2] / 'signalk-arlequin-rota' / 'dados'


def para_metros(g):
    """Geometria em lon/lat → UTM 29N (metros)."""
    return shapely.transform(g, lambda xy: np.column_stack(para_utm(xy[:, 1], xy[:, 0])))


def para_graus(g):
    """Geometria em UTM 29N → lon/lat."""
    return shapely.transform(g, lambda xy: np.column_stack(de_utm(xy[:, 0], xy[:, 1])[::-1]))


def descarregar(pasta=PASTA_OSM, url=URL_OSM):
    """O shapefile dos polígonos de terra, descarregado e desempacotado só se ainda não estiver na pasta."""
    pasta = Path(pasta)
    shp = pasta / SHP_OSM
    if shp.exists():
        return shp
    pasta.mkdir(parents=True, exist_ok=True)
    zipado = pasta / Path(url).name
    if not zipado.exists():
        print(f'a descarregar {url} (~900 MB) para {zipado} …', file=sys.stderr)
        tmp = zipado.with_name(zipado.name + '.parcial')
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(zipado)
    with zipfile.ZipFile(zipado) as z:
        z.extractall(pasta)
    return shp


def ler_terra(shp, bbox=BBOX):
    """Os polígonos de terra dentro da caixa (lon/lat), recortados por ela e juntos numa só geometria
    (o OSM parte a terra em pedaços; a costura entre eles desaparece na união)."""
    caixa = box(*bbox)
    partes = []
    with shapefile.Reader(str(shp)) as r:
        for s in r.iterShapes(bbox=list(bbox)):
            if s is None or not s.points:
                continue
            g = shape(s.__geo_interface__)
            if not g.is_valid:
                g = shapely.make_valid(g)
            g = g.intersection(caixa)
            if not g.is_empty:
                partes.append(g)
    terra = shapely.union_all(partes)
    # só as áreas (a intersecção com a caixa pode deixar linhas ou pontos soltos nos bordos)
    return shapely.union_all([p for p in getattr(terra, 'geoms', [terra]) if p.geom_type in ('Polygon', 'MultiPolygon')])


def terra_em_metros(terra_ll, simplificar_m=SIMPLIFICAR_TERRA_M):
    """A terra em UTM 29N, simplificada (sem mudar a topologia: as ilhas pequenas não desaparecem)."""
    t = para_metros(terra_ll).simplify(simplificar_m, preserve_topology=True)
    return t if t.is_valid else shapely.make_valid(t)


def _corte(pontos_ll):
    return LineString(np.column_stack(para_utm(pontos_ll[:, 0], pontos_ll[:, 1])))


def _troco(anel, a, b):
    """O troço do anel (fechado) da distância a até à b, no sentido do anel, dando a volta se b < a."""
    if a <= b:
        return substring(anel, a, b)
    fim, inicio = substring(anel, a, anel.length), substring(anel, 0, b)
    return LineString(list(fim.coords) + list(inicio.coords)[1:])


def linha_costa(terra_m, d_mn, inicio_lat=INICIO_LAT, fim_lon=FIM_LON, bbox=BBOX,
                tolerancia_mn=TOLERANCIA_LINHA_MN):
    """A linha a d MN da terra, de norte para sul (e depois para leste), como array N×2 de [lat, lon]."""
    alargada = terra_m.buffer(d_mn * MN, quad_segs=16)
    continente = max(getattr(alargada, 'geoms', [alargada]), key=lambda g: g.area)
    anel = LineString(continente.exterior.coords)  # os buracos (rios, baías fechadas) ficam de fora
    lons = np.linspace(bbox[0] - 1, bbox[2] + 1, 4001)
    lats = np.linspace(bbox[1] - 1, bbox[3] + 1, 4001)
    corte_ini = _corte(np.column_stack([np.full_like(lons, inicio_lat), lons]))
    corte_fim = _corte(np.column_stack([lats, np.full_like(lats, fim_lon)]))
    p_ini = [Point(c) for c in shapely.get_coordinates(anel.intersection(corte_ini))]
    p_fim = [Point(c) for c in shapely.get_coordinates(anel.intersection(corte_fim))]
    if not p_ini or not p_fim:
        raise ValueError(f'a linha de {d_mn} MN não cruza o paralelo {inicio_lat} ou o meridiano {fim_lon}')
    p_ini = min(p_ini, key=lambda p: p.x)  # do lado do mar: o mais a oeste
    p_fim = min(p_fim, key=lambda p: p.y)  # e o mais a sul
    s0, s1 = anel.project(p_ini), anel.project(p_fim)
    # dos dois caminhos à volta do anel, o do mar passa pelo ponto mais a oeste (o Cabo da Roca)
    xy = shapely.get_coordinates(anel)
    s_oeste = anel.project(Point(xy[np.argmin(xy[:, 0])]))
    pelo_mar = (s0 <= s_oeste <= s1) if s0 <= s1 else (s_oeste >= s0 or s_oeste <= s1)
    arco = _troco(anel, s0, s1) if pelo_mar else _troco(anel, s1, s0).reverse()
    arco = arco.simplify(tolerancia_mn * MN, preserve_topology=True)
    xy = shapely.get_coordinates(arco)
    lat, lon = de_utm(xy[:, 0], xy[:, 1])
    return np.column_stack([lat, lon])


def escrever_json_gz(caminho, dados):
    caminho = Path(caminho)
    tmp = caminho.with_name(caminho.name + '.tmp')
    tmp.write_bytes(gzip.compress(json.dumps(dados, separators=(',', ':')).encode('utf-8'), mtime=0))
    tmp.replace(caminho)


def terra_geojson(terra_m):
    """FeatureCollection (lon/lat, 5 casas, anéis exteriores no sentido contrário ao dos ponteiros, como o
    RFC 7946 pede), um Feature por polígono."""
    t = shapely.orient_polygons(shapely.set_precision(para_graus(terra_m), 1e-5), exterior_cw=False)
    feats = [{'type': 'Feature', 'properties': {}, 'geometry': mapping(p)}
             for p in getattr(t, 'geoms', [t]) if p.geom_type == 'Polygon' and not p.is_empty]
    return {'type': 'FeatureCollection', 'features': feats}


def gerar(shp, saida=SAIDA, bbox=BBOX, inicio_lat=INICIO_LAT, fim_lon=FIM_LON, afastamentos=AFASTAMENTOS,
          simplificar_m=SIMPLIFICAR_TERRA_M, tolerancia_mn=TOLERANCIA_LINHA_MN):
    """Lê a terra, escreve terra.geojson.gz e linhas-costa.json.gz em `saida` e devolve
    {'terra_ll', 'terra_m', 'linhas': {d: array [lat, lon]}} (para os testes e o resumo)."""
    saida = Path(saida)
    saida.mkdir(parents=True, exist_ok=True)
    terra_ll = ler_terra(shp, bbox)
    terra_m = terra_em_metros(terra_ll, simplificar_m)
    linhas = {d: linha_costa(terra_m, d, inicio_lat, fim_lon, bbox, tolerancia_mn) for d in afastamentos}
    escrever_json_gz(saida / 'terra.geojson.gz', terra_geojson(terra_m))
    escrever_json_gz(saida / 'linhas-costa.json.gz',
                     {str(d): np.round(l, 5).tolist() for d, l in linhas.items()})
    return {'terra_ll': terra_ll, 'terra_m': terra_m, 'linhas': linhas}


def comprimento_mn(latlon):
    x, y = para_utm(latlon[:, 0], latlon[:, 1])
    return float(np.sum(np.hypot(np.diff(x), np.diff(y)))) / MN


def main(argv=None):
    ap = argparse.ArgumentParser(description='Gera terra.geojson.gz e linhas-costa.json.gz para o plugin da rota.')
    ap.add_argument('--osm', default=str(PASTA_OSM), help='pasta dos polígonos de terra do OSM (fora do repositório)')
    ap.add_argument('--saida', default=str(SAIDA))
    a = ap.parse_args(argv)
    shp = descarregar(a.osm)
    r = gerar(shp, a.saida)
    for d, l in r['linhas'].items():
        print(f'{d} MN: {len(l)} pontos, {comprimento_mn(l):.1f} MN, de {l[0, 0]:.4f} N {l[0, 1]:.4f} '
              f'a {l[-1, 0]:.4f} N {l[-1, 1]:.4f}')
    for nome in ('terra.geojson.gz', 'linhas-costa.json.gz'):
        print(f'{nome}: {(Path(a.saida) / nome).stat().st_size / 1e6:.2f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
