# Caixa de TESTE do radar de capacete (PLA preto): fundo e tampa direitos, sem velcro.
# Os 3 LD2460 entram em ranhuras nos ângulos certos (frente, trás-esquerda -120°, trás-direita +120°),
# encostados por dentro à parede (só plástico à frente das antenas). Heltec, Modulino e RCWL ficam no meio.
# Gera caixa_teste_base.stl e caixa_teste_tampa.stl.     python -I caixa_teste.py
import math, os
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection, JoinType

# ---- medidas (mm) ----
PCB_L, PCB_H, PCB_T = 50.0, 32.0, 1.6     # LD2460: lado de 50 deitado, 32 em pé
FOLGA = 0.4                                # folga das ranhuras
R = 40.0                                   # centro -> plano da placa do radar (13 mm livres atrás)
GAP = 0.5                                  # antenas -> parede
PAREDE = 1.6                               # parede (fina à frente dos radares)
CHAO = 2.0                                 # espessura do fundo
ALT_INT = 40.0                             # altura livre por dentro
TAMPA = 2.0                                # espessura da tampa
LABIO_H, LABIO_T, LABIO_FOLGA = 4.0, 1.4, 0.3
CANTO = 56.0                               # corte dos cantos (distância ao centro)
USB_W, USB_D = 6.0, 10.0                   # entalhe do cabo USB (atrás, no topo da parede)
POSTE, CANAL = 5.0, 3.0
YAWS = {1: 0.0, 2: -120.0, 3: 120.0}       # como no config.h (positivo = para a direita)

R_IN = R + PCB_T / 2 + GAP                 # face de dentro da parede, nos lados dos radares
R_OUT = R_IN + PAREDE


def box(x, y, z, cx=0, cy=0, cz=0):
    return Manifold.cube([x, y, z], center=True).translate([cx, cy, cz])


def contorno(ri, corte):
    """Triângulo com lados a 'ri' do centro (virados para 0 e ±120°) e cantos cortados a 'corte'."""
    tri = CrossSection([[(2 * ri * math.cos(math.radians(270 + 120 * k)),
                          2 * ri * math.sin(math.radians(270 + 120 * k))) for k in range(3)]])
    c = 2 * corte
    tri2 = CrossSection([[(c * math.cos(math.radians(90 + 120 * k)),
                           c * math.sin(math.radians(90 + 120 * k))) for k in range(3)]])
    return tri ^ tri2


def radar_holder():
    """Suporte de um radar virado para +Y: postes nas pontas + calha em baixo, placa no plano y = R."""
    L = PCB_L + 2 * FOLGA
    t = PCB_T + FOLGA
    h = PCB_H * 0.75
    y0, y1 = R - 6.0, R_IN + 0.01                       # os postes vão até à parede
    yc, yl = (y0 + y1) / 2, (y1 - y0)
    m = None
    for s in (-1, 1):
        x0 = L / 2 - CANAL
        post = box(POSTE, yl, h, s * (x0 + POSTE / 2), yc, CHAO + h / 2)
        slot = box(CANAL + 0.2, t, h + 2, s * (x0 + CANAL / 2 - 0.1), R, CHAO + h / 2 + 1)
        p = post - slot
        m = p if m is None else m + p
    rail = box(L + 4, yl, CANAL, 0, yc, CHAO + CANAL / 2) - box(L, t, CANAL + 1, 0, R, CHAO + CANAL / 2 + 0.6)
    return m + rail


def pontos(n, z):
    """n bolinhas para identificar o radar."""
    m = None
    for k in range(n):
        c = Manifold.cylinder(1.2, 1.6, 1.6, 24).translate([(k - (n - 1) / 2) * 5.0, R - 10, z])
        m = c if m is None else m + c
    return m


def seta(z, y=-2):
    s = CrossSection([[(-5, 10), (5, 10), (5, 18), (10, 18), (0, 28), (-10, 18), (-5, 18)]])
    return Manifold.extrude(s, 1.0).translate([0, y, z])


def base():
    out = Manifold.extrude(contorno(R_OUT, CANTO), CHAO + ALT_INT)
    cav = Manifold.extrude(contorno(R_IN, CANTO - PAREDE), ALT_INT + 1).translate([0, 0, CHAO])
    m = out - cav
    # entalhe do cabo USB na parede de trás (canto entre os radares 2 e 3), a partir do topo
    yb = -CANTO
    m = m - box(USB_W, PAREDE * 4, USB_D * 2, 0, yb, CHAO + ALT_INT)
    m = m - Manifold.cylinder(PAREDE * 4, USB_W / 2, USB_W / 2, 32).rotate([90, 0, 0]).translate(
        [0, yb + PAREDE * 2, CHAO + ALT_INT - USB_D])
    for n, yaw in YAWS.items():
        m = m + (radar_holder() + pontos(n, CHAO)).rotate([0, 0, -yaw])
    return m + seta(CHAO)


def tampa():
    t = Manifold.extrude(contorno(R_OUT, CANTO), TAMPA)
    ri = R_IN - LABIO_FOLGA
    lip = Manifold.extrude(contorno(ri, CANTO - PAREDE - LABIO_FOLGA), LABIO_H) - \
        Manifold.extrude(contorno(ri - LABIO_T, CANTO - PAREDE - LABIO_FOLGA - LABIO_T), LABIO_H + 1).translate([0, 0, -0.5])
    # o lábio não pode bater no cabo USB: abre-o atrás
    lip = lip - box(USB_W + 4, 20, LABIO_H * 3, 0, -CANTO, LABIO_H / 2)
    m = t + lip.translate([0, 0, TAMPA])
    # seta FRENTE em relevo por fora (fica para baixo na impressão -> fazemos rebaixo em vez de relevo)
    m = m - seta(-0.01).scale([1, 1, 0.6])
    return m


def guardar(m, nome):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), nome)
    tm.export(out)
    print("OK", nome, "estanque:", tm.is_watertight, "medidas:", np.round(tm.extents, 1),
          "volume cm3:", round(tm.volume / 1000, 1))
    return tm


if __name__ == "__main__":
    guardar(base(), "caixa_teste_base.stl")
    guardar(tampa(), "caixa_teste_tampa.stl")
