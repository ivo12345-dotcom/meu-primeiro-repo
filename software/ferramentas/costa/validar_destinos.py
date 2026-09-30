"""Valida as aproximações dos destinos (signalk-arlequin-rota/dados/destinos.json) contra a terra e as zonas.

    cd software/ferramentas/costa
    python validar_destinos.py                   # com a terra do plugin (terra.geojson.gz)
    python validar_destinos.py --osm PASTA       # e também com a terra do OSM em bruto (sem simplificar)

`entrada` (índice na `aproximacao`) é o primeiro ponto DENTRO da boca do porto (entre as cabeças dos molhes)
ou da barra. Por omissão a terra conta-se em TODOS os troços, do largo ao cais. O campo opcional
`portoFechadoOsm: true` de um destino tira essa verificação só dos troços depois da `entrada` (continuam a
mostrar-se na tabela, entre parênteses); usa-se só onde o OSM fecha a doca, o rio ou a bacia com terra: Viana
do Castelo, Leixões, Figueira da Foz, Lagos e Portimão. Para cada destino:

1. o largo (= aproximacao[0]) fica no mar;
2. todos os troços do largo até ao ponto `entrada` (inclusive o troço que lá chega) têm 0 m de terra e passam a
   pelo menos 10 m dela (o plugin conta um troço que encosta à terra como a cortar);
3. o ponto `entrada` está mesmo na boca: há terra (os molhes, as margens da barra) a menos de 400 m dos dois
   lados de quem chega (nos sectores de bombordo e de estibordo entre 30° e 150° do rumo do último troço) e o
   ponto fica dentro da envolvente convexa dessa terra (a menos de 400 m), ou a menos de 25 m dela: entre as
   cabeças dos molhes e não cá fora, em frente à boca. Os 25 m são para as barras que o OSM fecha na linha das
   cabeças (Figueira, Portimão), onde a entrada tem de ficar um pouco para fora dessa linha. 400 m e não 300: a
   boca mais larga, a de Viana (entre as cabeças dos molhes), tem ~700 m;
4. nenhum troço da aproximação (nem o largo) passa a menos de 0,3 MN de uma zona a evitar, salvo a zona do
   próprio porto (o campo opcional `zona` do destino, com o nome dela);
5. os troços depois da `entrada` também não cortam terra, com uma tolerância de < 1 m (ruído de vírgula
   flutuante) — salvo nos destinos com `portoFechadoOsm: true`, cujo OSM fecha a doca/rio/bacia com terra e
   por isso não conta lá dentro.

Sai com 1 se houver problemas.
"""

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point, Polygon, shape

import gerar

MN = gerar.MN
ZONA_MIN_MN = 0.3
FOLGA_MIN_M = 10.0
BOCA_RAIO_M = 400.0
BOCA_SECTOR = (30, 150)  # graus a partir do rumo de chegada, para cada lado
BOCA_FORA_M = 25.0       # quanto o ponto de entrada pode ficar fora da envolvente convexa da terra à volta
TERRA_TOL_M = 1.0        # terra tolerada nos troços depois da `entrada` (ruído de vírgula flutuante)


def carregar(pasta=gerar.SAIDA):
    """(destinos, zonas, terra em UTM 29N) a partir da pasta dos dados do plugin."""
    pasta = Path(pasta)
    terra = json.loads(gzip.decompress((pasta / 'terra.geojson.gz').read_bytes()))
    terra_m = gerar.para_metros(shapely.union_all([shape(f['geometry']) for f in terra['features']]))
    destinos = json.loads((pasta / 'destinos.json').read_text(encoding='utf-8'))
    zonas = json.loads((pasta / 'zonas.json').read_text(encoding='utf-8'))
    return destinos, zonas, terra_m


def _m(pontos):
    """[[lat, lon], …] → coordenadas UTM 29N [(x, y), …]."""
    return [gerar.para_metros(Point(lon, lat)).coords[0] for lat, lon in pontos]


def _lados_com_terra(terra_m, p, rumo):
    """Para bombordo e estibordo de quem chega a p no rumo dado (graus): há terra a menos de BOCA_RAIO_M?"""
    lados = []
    for sinal in (-1, 1):
        arco = [math.radians(rumo + sinal * a) for a in range(BOCA_SECTOR[0], BOCA_SECTOR[1] + 1, 2)]
        sector = Polygon([p] + [(p[0] + BOCA_RAIO_M * math.sin(b), p[1] + BOCA_RAIO_M * math.cos(b)) for b in arco])
        lados.append(bool(sector.intersects(terra_m)))
    return lados


def _fora_da_envolvente(terra_m, p):
    """Metros que o ponto p fica fora da envolvente convexa da terra a menos de BOCA_RAIO_M (0 se dentro)."""
    envolvente = terra_m.intersection(Point(p).buffer(BOCA_RAIO_M)).convex_hull
    return 0.0 if envolvente.contains(Point(p)) else envolvente.distance(Point(p))


def validar(destinos, zonas, terra_m):
    """Uma entrada por destino: {'id', 'problemas': [texto], 'trocos': [{'i', 'terra_m', 'folga_m', 'porto'}],
    'largo_mn' (distância do largo à terra), 'boca' (o ponto `entrada` tem terra dos dois lados), 'zona_mn'
    (a menor distância da aproximação a uma zona que conta)}."""
    shapely.prepare(terra_m)
    zonas_m = [(z['nome'], gerar.para_metros(Polygon([(lon, lat) for lat, lon in z['poligono']]))) for z in zonas]
    resultados = []
    for d in destinos:
        prob = []
        ap = d['aproximacao']
        e = d['entrada']
        if list(d['largo']) != list(ap[0]):
            prob.append('o largo não é o primeiro ponto da aproximação')
        if not (isinstance(e, int) and 1 <= e <= len(ap) - 1):
            prob.append(f'entrada {e!r} fora de 1…{len(ap) - 1}')
            e = len(ap) - 1
        pts = _m(ap)
        largo = Point(pts[0])
        largo_mn = terra_m.distance(largo) / MN
        if terra_m.intersects(largo):
            prob.append('o largo fica em terra')
        relaxa_porto = bool(d.get('portoFechadoOsm'))
        trocos = []
        for i in range(1, len(pts)):
            seg = LineString([pts[i - 1], pts[i]])
            terra = seg.intersection(terra_m).length if seg.intersects(terra_m) else 0.0
            porto = i > e
            folga = 0.0 if seg.intersects(terra_m) else seg.distance(terra_m)
            trocos.append({'i': i, 'terra_m': round(terra), 'folga_m': round(folga), 'porto': porto})
            if not porto and seg.intersects(terra_m):
                prob.append(f'troço {i} ({i - 1}→{i}) corta terra: {terra:.0f} m')
            elif not porto and folga < FOLGA_MIN_M:
                prob.append(f'troço {i} ({i - 1}→{i}) passa a {folga:.1f} m da terra (mínimo {FOLGA_MIN_M:.0f} m)')
            elif porto and not relaxa_porto and terra > TERRA_TOL_M:
                prob.append(f'troço {i} ({i - 1}→{i}) corta terra: {terra:.0f} m (fora dos portos que o OSM '
                            f'fecha, sem `portoFechadoOsm`)')
        dx, dy = pts[e][0] - pts[e - 1][0], pts[e][1] - pts[e - 1][1]
        lados = _lados_com_terra(terra_m, pts[e], math.degrees(math.atan2(dx, dy)))
        fora = _fora_da_envolvente(terra_m, pts[e])
        boca = all(lados) and fora <= BOCA_FORA_M
        if not all(lados):
            falta = ' e '.join(n for n, t in zip(('bombordo', 'estibordo'), lados) if not t)
            prob.append(f'o ponto de entrada ({e}) não está na boca: sem terra a {BOCA_RAIO_M:.0f} m por {falta}')
        elif not boca:
            prob.append(f'o ponto de entrada ({e}) não está na boca: fica {fora:.0f} m para fora das cabeças '
                        f'(a envolvente da terra à volta)')
        rota = LineString(pts)
        zona_mn = math.inf
        for nome, z in zonas_m:
            if nome == d.get('zona'):
                continue
            dz = rota.distance(z) / MN
            zona_mn = min(zona_mn, dz)
            if dz < ZONA_MIN_MN:
                prob.append(f'a aproximação passa a {dz:.2f} MN da zona {nome} (mínimo {ZONA_MIN_MN} MN)')
        resultados.append({'id': d['id'], 'problemas': prob, 'trocos': trocos, 'largo_mn': largo_mn,
                           'boca': boca, 'zona_mn': zona_mn})
    return resultados


def terra_osm(shp, destinos, margem=0.05):
    """A terra do OSM em bruto (sem simplificar), em UTM 29N, só na caixa que cobre as aproximações."""
    lats = [p[0] for d in destinos for p in d['aproximacao']]
    lons = [p[1] for d in destinos for p in d['aproximacao']]
    caixa = (min(lons) - margem, min(lats) - margem, max(lons) + margem, max(lats) + margem)
    t = gerar.para_metros(gerar.ler_terra(shp, caixa))
    return t if t.is_valid else shapely.make_valid(t)


def tabela(resultados, titulo):
    linhas = [titulo, f'{"destino":10s} {"largo":>6s} {"boca":>4s} {"zona":>7s}  troços: metros de terra/folga (m); (porto) depois da entrada']
    for r in resultados:
        tr = ' '.join((f'({t["terra_m"]})' if t['porto'] else f'{t["terra_m"]}/{t["folga_m"]}') for t in r['trocos'])
        zona = f'{r["zona_mn"]:.2f}' if math.isfinite(r['zona_mn']) else '-'
        linhas.append(f'{r["id"]:10s} {r["largo_mn"]:5.2f}M {"sim" if r["boca"] else "NÃO":>4s} {zona:>6s}M  {tr}')
        for p in r['problemas']:
            linhas.append(f'{"":10s}   ! {p}')
    return '\n'.join(linhas)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Valida as aproximações de destinos.json contra a terra e as zonas.')
    ap.add_argument('--dados', default=str(gerar.SAIDA), help='pasta dos dados do plugin')
    ap.add_argument('--osm', help='pasta dos polígonos de terra do OSM (valida também contra a terra sem simplificar)')
    a = ap.parse_args(argv)
    destinos, zonas, terra_m = carregar(a.dados)
    resultados = validar(destinos, zonas, terra_m)
    print(tabela(resultados, 'Terra do plugin (terra.geojson.gz):'))
    mal = sum(bool(r['problemas']) for r in resultados)
    if a.osm:
        bruta = terra_osm(gerar.descarregar(a.osm), destinos)
        rb = validar(destinos, zonas, bruta)
        print()
        print(tabela(rb, 'Terra do OSM em bruto (sem simplificar):'))
        mal += sum(bool(r['problemas']) for r in rb)
    print(f'\n{len(resultados)} destinos, {"sem problemas" if not mal else f"{mal} com problemas"}')
    return 1 if mal else 0


if __name__ == '__main__':
    sys.exit(main())
