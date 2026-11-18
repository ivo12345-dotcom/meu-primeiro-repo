# Suporte de TESTE dos 3 radares (PLA preto): segura os LD2460 nos ângulos certos
# (frente, trás-esquerda -120°, trás-direita +120°) para afinar o software na bancada.
# Não é a caixa final. Gera suporte_teste.stl na mesma pasta.
#   python -I suporte_teste.py
import math, os
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection

# ---- medidas (mm) ----
PCB_L, PCB_H, PCB_T = 50.0, 32.0, 1.6     # LD2460: 50 deitado, 32 em pé
FOLGA = 0.4                                # folga da ranhura
FUNDO = 13.0                               # espaço atrás de cada radar (componentes + curva dos fios)
R = 40.0                                   # centro -> plano da placa do radar
BASE_T = 2.4                               # espessura da base
POSTE = 5.0                                # largura dos postes laterais
CANAL = 3.0                                # profundidade da ranhura nos postes e na base
YAWS = {1: 0.0, 2: -120.0, 3: 120.0}       # como no config.h (positivo = para a direita)


def box(x, y, z, cx=0, cy=0, cz=0):
    return Manifold.cube([x, y, z], center=True).translate([cx, cy, cz])


def radar_holder():
    """Suporte de um radar, virado para +Y (frente), placa no plano y = R."""
    L = PCB_L + 2 * FOLGA                               # comprimento livre entre ranhuras
    t = PCB_T + FOLGA                                   # largura da ranhura
    h = PCB_H * 0.75                                    # postes a 3/4 da altura da placa
    m = None
    for s in (-1, 1):                                   # postes nas pontas, com ranhura vertical de 3 mm
        x0 = L / 2 - CANAL                              # a placa entra CANAL mm em cada poste
        post = box(POSTE, 7.0, h, s * (x0 + POSTE / 2), R, BASE_T + h / 2)
        slot = box(CANAL + 0.2, t, h + 2, s * (x0 + CANAL / 2 - 0.1), R, BASE_T + h / 2 + 1)
        p = post - slot
        m = p if m is None else m + p
    # calha de baixo, ao longo da placa
    rail = box(L + 4, 7.0, CANAL, 0, R, BASE_T + CANAL / 2) - box(L, t, CANAL + 1, 0, R, BASE_T + CANAL / 2 + 0.6)
    return m + rail


def numero(n):
    """Marca o número do radar com n pinos redondos atrás do suporte."""
    m = None
    for k in range(n):
        x = (k - (n - 1) / 2) * 5.0
        c = Manifold.cylinder(1.2, 1.6, 1.6, 24).translate([x, R - FUNDO - 4, BASE_T])
        m = c if m is None else m + c
    return m


def base():
    """Triângulo com os lados a R+5 do centro (virados para 0 e ±120°), cantos cortados."""
    ri = R + 5.0
    tri = CrossSection([[(2 * ri * math.cos(math.radians(270 + 120 * k)),
                          2 * ri * math.sin(math.radians(270 + 120 * k))) for k in range(3)]])
    tri2 = CrossSection([[(2.5 * ri * math.cos(math.radians(90 + 120 * k)),
                           2.5 * ri * math.sin(math.radians(90 + 120 * k))) for k in range(3)]])
    plate = Manifold.extrude(tri ^ tri2, BASE_T)
    return plate - Manifold.cylinder(BASE_T + 2, 6, 6, 48).translate([0, 0, -1])


def seta():
    """Seta 'FRENTE' em relevo, a apontar para o radar 1."""
    s = CrossSection([[(-5, 10), (5, 10), (5, 18), (10, 18), (0, 28), (-10, 18), (-5, 18)]])
    return Manifold.extrude(s, 1.2).translate([0, -2, BASE_T])


def main():
    m = base()
    for n, yaw in YAWS.items():
        part = radar_holder() + numero(n)
        m = m + part.rotate([0, 0, -yaw])               # yaw positivo = sentido dos ponteiros
    m = m + seta()
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "suporte_teste.stl")
    tm.export(out)
    print("OK", out, "estanque:", tm.is_watertight, "medidas:", np.round(tm.extents, 1))


if __name__ == "__main__":
    main()
