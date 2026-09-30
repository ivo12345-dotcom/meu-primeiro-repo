import numpy as np
import pytest

from utm import de_utm, para_utm

geod = pytest.importorskip('geographiclib.geodesic').Geodesic.WGS84


def test_meridiano_central_e_equador():
    x, y = para_utm(0.0, -9.0)
    assert x == pytest.approx(500000.0, abs=1e-6) and y == pytest.approx(0.0, abs=1e-6)
    # arco do meridiano até 45° no WGS84 = 4 984 944,378 m, vezes k0 = 0,9996
    x, y = para_utm(45.0, -9.0)
    assert x == pytest.approx(500000.0, abs=1e-6) and y == pytest.approx(4982950.400, abs=0.01)


def test_ida_e_volta_ao_milimetro_em_toda_a_costa():
    lat, lon = np.meshgrid(np.linspace(36.8, 42.2, 25), np.linspace(-10.5, -6.9, 25))
    x, y = para_utm(lat, lon)
    lat2, lon2 = de_utm(x, y)
    assert np.max(np.abs(lat2 - lat)) < 1e-8 and np.max(np.abs(lon2 - lon)) < 1e-8  # < 1 mm


def test_distancias_como_as_geodesicas_vezes_a_escala():
    # nos cantos da zona (a 3,5° do meridiano central) a escala do UTM chega a ~1,0006: erro < 0,1%
    for lat1, lon1, lat2, lon2 in ((38.78, -9.50, 38.78, -9.60), (41.87, -8.9, 41.5, -8.95), (37.0, -8.9, 36.95, -7.4),
                                   (42.2, -10.5, 42.1, -10.4)):
        x1, y1 = para_utm(lat1, lon1)
        x2, y2 = para_utm(lat2, lon2)
        s = geod.Inverse(lat1, lon1, lat2, lon2)['s12']
        assert np.hypot(x2 - x1, y2 - y1) == pytest.approx(s, rel=1e-3)


def test_angulos_conformes():
    # conforme: um passo pequeno para norte e outro para leste ficam perpendiculares (o resto é da curvatura, ∝ passo)
    x0, y0 = para_utm(38.7, -10.2)
    xn, yn = para_utm(38.70001, -10.2)
    xe, ye = para_utm(38.7, -10.19999)
    assert abs((xn - x0) * (xe - x0) + (yn - y0) * (ye - y0)) / (np.hypot(xn - x0, yn - y0) * np.hypot(xe - x0, ye - y0)) < 1e-6
