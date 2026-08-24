#!/usr/bin/env python3
"""
Suporte de telemovel para Tesla Model 3 (pre-facelift, 2017-2023).
Encaixa no porta-copos da consola central e segura um Samsung Galaxy Z Fold 7
ABERTO, sem tapar o ecra do carro.

Gera os STL em ./stl/. Todas as medidas em milimetros.

    pip install trimesh manifold3d shapely numpy
    python3 gerar.py
"""
import os
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, revolve, extrude_polygon
from trimesh.transformations import rotation_matrix
from shapely.geometry import Polygon, box as sbox

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stl")

# ---------------------------------------------------------------- parametros
# Telemovel: Galaxy Z Fold 7 aberto = 143.2 x 158.4 x 4.2 mm, 215 g
PHONE_W, PHONE_H, PHONE_T = 143.2, 158.4, 4.2

# Porta-copos do Model 3. As fontes online divergem (70 mm vs 81 mm de
# diametro), por isso as linguetas cobrem todo o intervalo por flexao.
CUP_R_BOT = 32.0          # raio das linguetas em baixo (Ø64)
CUP_R_TOP = 40.0          # raio das linguetas em cima  (Ø80, comprime ate Ø64)
CUP_DEPTH = 50.0          # altura da parte enfiada no porta-copos
TONGUE_WALL = 2.0         # espessura da lingueta (flexivel em PETG)
N_TONGUES = 8
SLIT_W = 3.0              # largura do corte entre linguetas

ARM_X, ARM_Y = 20.0, 32.0 # seccao da coluna (Y = direcao do esforco)
ARM_TOP = 95.0            # onde acaba a coluna e comeca a forquilha

BOLT_R = 2.3              # M4 folgado
NUT_AF = 7.3              # porca M4 entre faces
HEAD_R = 4.0              # cabeca M4 cilindrica
NUT_T = 3.4               # espessura da porca M4
NUT_Z = 7.5               # fundo da bolsa da porca, a contar da face da juncao

# Articulacao: acoplamento estriado de 12 dentes. A inclinacao e FIXA (moldada
# no braco); o estriado da rotacao do telemovel no proprio plano, de 30 em 30.
ARM_TILT = 18.0           # graus de inclinacao para tras
SPL_ROOT, SPL_TIP, SPL_N = 9.0, 12.0, 12
SPL_FIT = 0.25            # folga em todo o perfil (radial e nos flancos)
BOSS_H = 5.0              # altura do macho estriado
SOCKET_H = 6.0            # profundidade da femea
PAD_R, PAD_H = 14.0, 10.0
JOINT_OFF = 20.0          # a articulacao avanca esta distancia a frente do eixo da coluna
JOINT_Y = -26.0           # centro da articulacao, em coords do berco

BACK_T = 4.0              # espessura da chapa de tras do berco
SIDE_W = 6.0              # largura da parede lateral
LIP_IN = 7.0              # quanto a garra agarra a frente do telemovel
GRIP_H = 75.0             # altura das calhas laterais
SHELF_Y = 14.0            # profundidade da prateleira de apoio

EPS = 0.01


def _fuse(*meshes):
    out = meshes[0]
    for m in meshes[1:]:
        out = out.union(m)
    return out


def _frustum(r0, r1, z0, z1, sections=96):
    """Solido de revolucao truncado, de r0 em z0 ate r1 em z1."""
    prof = np.array([[0.0, z0], [r0, z0], [r1, z1], [0.0, z1]])
    return revolve(prof, sections=sections)


def _rounded_rect(w, d, r):
    return sbox(-w / 2 + r, -d / 2 + r, w / 2 - r, d / 2 - r).buffer(r, quad_segs=16)


def _spline(r_root, r_tip, n=SPL_N, fit=0.0):
    pts = []
    for i in range(n):
        a0 = 2 * np.pi * i / n
        for frac, r in ((0.06, r_root), (0.19, r_tip), (0.31, r_tip), (0.44, r_root)):
            a = a0 + 2 * np.pi * frac / n
            pts.append((r * np.cos(a), r * np.sin(a)))
    poly = Polygon(pts)
    # buffer 2D -> folga igual em todas as direccoes, incluindo os flancos
    return poly.buffer(fit, join_style=1, quad_segs=4) if fit else poly


def _to_axis(mesh, tilt_deg, origin):
    """Leva o eixo local +Z para a normal da face inclinada do braco."""
    mesh.apply_transform(rotation_matrix(np.radians(tilt_deg) - np.pi / 2, [1, 0, 0]))
    mesh.apply_translation(origin)
    return mesh


def _hex_prism(across_flats, height):
    r = across_flats / np.sqrt(3.0)
    pts = [(r * np.cos(a), r * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 7)[:-1]]
    return extrude_polygon(Polygon(pts), height)


# ------------------------------------------------------- 0. calibre do copo
def gauge():
    """Escada de diametros para medir o porta-copos antes de imprimir a base."""
    steps, h = [66, 70, 74, 78, 82], 7.0
    parts = []
    for i, d in enumerate(steps):
        c = cylinder(radius=d / 2.0, height=h, sections=96)
        c.apply_translation([0, 0, i * h + h / 2.0])
        parts.append(c)
    g = _fuse(*parts)
    bore = _frustum(steps[0] / 2.0 - 3.0, steps[-1] / 2.0 - 3.0,
                    -EPS, len(steps) * h + EPS)
    return g.difference(bore)


# ------------------------------------------------------- 1. base + braco
def base_arm():
    disc = cylinder(radius=CUP_R_BOT, height=4.0, sections=96)
    disc.apply_translation([0, 0, 2.0])

    outer = _frustum(CUP_R_BOT, CUP_R_TOP, 4.0, 4.0 + CUP_DEPTH)
    inner = _frustum(CUP_R_BOT - TONGUE_WALL, CUP_R_TOP - TONGUE_WALL,
                     4.0 - EPS, 4.0 + CUP_DEPTH + EPS)
    wall = outer.difference(inner)

    # cortes verticais -> linguetas presas em baixo, livres em cima
    slits = []
    for i in range(N_TONGUES):
        s = box(extents=[SLIT_W, 30.0, CUP_DEPTH])
        s.apply_translation([0, CUP_R_TOP, 4.0 + 8.0 + CUP_DEPTH / 2.0])
        s.apply_transform(rotation_matrix(2 * np.pi * i / N_TONGUES, [0, 0, 1]))
        slits.append(s)
    wall = wall.difference(_fuse(*slits))

    gusset = _frustum(28.0, 11.0, 0.0, 30.0)
    column = extrude_polygon(_rounded_rect(ARM_X, ARM_Y, 3.0), ARM_TOP)

    # topo: face inclinada ARM_TILT graus + macho estriado
    t = np.radians(ARM_TILT)
    normal = np.array([0.0, np.cos(t), np.sin(t)])
    origin = np.array([0.0, 0.0, ARM_TOP]) + JOINT_OFF * normal
    pad = cylinder(radius=PAD_R, height=PAD_H, sections=96)
    pad.apply_translation([0, 0, -PAD_H / 2.0])
    _to_axis(pad, ARM_TILT, origin)

    boss = extrude_polygon(_spline(SPL_ROOT, SPL_TIP), BOSS_H)
    _to_axis(boss, ARM_TILT, origin)

    body = _fuse(disc, wall, gusset, column, pad, boss)

    bore = cylinder(radius=BOLT_R, height=BOSS_H + NUT_Z + 3.0, sections=48)
    bore.apply_translation([0, 0, (BOSS_H - NUT_Z - 3.0) / 2.0 + EPS])
    body = body.difference(_to_axis(bore, ARM_TILT, origin))

    # porca M4 cativa: bolsa hexagonal + rasgo lateral para a enfiar
    nut = _hex_prism(NUT_AF, NUT_T)
    nut.apply_translation([0, 0, -NUT_Z])
    chute = box(extents=[PAD_R + 6.0, NUT_AF, NUT_T])
    chute.apply_translation([(PAD_R + 6.0) / 2.0, 0, -NUT_Z + NUT_T / 2.0])
    return body.difference(_to_axis(_fuse(nut, chute), ARM_TILT, origin))


# ------------------------------------------------------- 2. berco
def cradle(slot_w, slot_t, label):
    """Berco em U: o telemovel entra por cima e assenta na prateleira."""
    half = slot_w / 2.0
    outer = half + SIDE_W
    top = SHELF_Y + GRIP_H
    lip_z0, lip_z1 = BACK_T + slot_t, BACK_T + slot_t + 4.0

    back = box(extents=[outer * 2, top, BACK_T])
    back.apply_translation([0, top / 2.0, BACK_T / 2.0])

    tab = box(extents=[52.0, -JOINT_Y, BACK_T])
    tab.apply_translation([0, JOINT_Y / 2.0, BACK_T / 2.0])
    tab_end = cylinder(radius=26.0, height=BACK_T, sections=64)
    tab_end.apply_translation([0, JOINT_Y, BACK_T / 2.0])

    window = box(extents=[slot_w - 26.0, GRIP_H - 24.0, BACK_T + 2 * EPS])
    window.apply_translation([0, SHELF_Y + 14.0 + (GRIP_H - 24.0) / 2.0, BACK_T / 2.0])
    back = back.difference(window)

    shelf = box(extents=[outer * 2, SHELF_Y, lip_z1])
    shelf.apply_translation([0, SHELF_Y / 2.0, lip_z1 / 2.0])

    shelf_lip = box(extents=[outer * 2, 12.0, lip_z1 - lip_z0])
    shelf_lip.apply_translation([0, SHELF_Y + 6.0, (lip_z0 + lip_z1) / 2.0])

    rails = []
    for sgn in (-1, 1):
        wall = box(extents=[SIDE_W, top - SHELF_Y, lip_z1])
        wall.apply_translation([sgn * (half + SIDE_W / 2.0),
                                SHELF_Y + (top - SHELF_Y) / 2.0, lip_z1 / 2.0])
        lip = box(extents=[SIDE_W + LIP_IN, top - SHELF_Y, lip_z1 - lip_z0])
        lip.apply_translation([sgn * (half + SIDE_W / 2.0 - LIP_IN / 2.0),
                               SHELF_Y + (top - SHELF_Y) / 2.0, (lip_z0 + lip_z1) / 2.0])
        rails += [wall, lip]

    # cubo com a femea estriada, do lado do telemovel mas ABAIXO da prateleira
    hub = cylinder(radius=PAD_R + 3.0, height=16.0, sections=96)
    hub.apply_translation([0, JOINT_Y, 8.0])

    body = _fuse(back, tab, tab_end, shelf, shelf_lip, hub, *rails)

    socket = extrude_polygon(_spline(SPL_ROOT, SPL_TIP, fit=SPL_FIT), SOCKET_H + EPS)
    socket.apply_translation([0, JOINT_Y, -EPS])
    thru = cylinder(radius=BOLT_R + 0.2, height=24.0, sections=48)
    thru.apply_translation([0, JOINT_Y, 12.0])
    head = cylinder(radius=HEAD_R + 0.3, height=5.0 + EPS, sections=48)
    head.apply_translation([0, JOINT_Y, 16.0 - 5.0 / 2.0 + EPS])
    body = body.difference(_fuse(socket, thru, head))

    # saida do cabo USB-C ao centro
    notch = box(extents=[46.0, 24.0, lip_z1 - lip_z0 + 2 * EPS])
    notch.apply_translation([0, SHELF_Y + 4.0, (lip_z0 + lip_z1) / 2.0])
    port = box(extents=[48.0, SHELF_Y - 2.0, lip_z1])
    port.apply_translation([0, SHELF_Y / 2.0 + 1.0, BACK_T + lip_z1 / 2.0])
    body = body.difference(_fuse(notch, port))

    body.metadata["name"] = label
    return body


def clean(mesh):
    """Remove os fragmentos de volume nulo que as booleanas deixam."""
    parts = mesh.split(only_watertight=False)
    return max(parts, key=lambda m: abs(m.volume)) if len(parts) > 1 else mesh


def report(name, mesh):
    lo, hi = mesh.bounds
    size = hi - lo
    print(f"  {name:<28} {size[0]:6.1f} x {size[1]:6.1f} x {size[2]:6.1f} mm   "
          f"{mesh.volume/1000.0:6.1f} cm3   estanque={mesh.is_watertight}  "
          f"corpos={mesh.body_count}")
    assert mesh.is_watertight, f"{name} nao e estanque"
    return size


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("0_calibre_portacopos.stl", gauge()),
        ("1_base_braco.stl", base_arm()),
        ("2_berco_fold7_com_capa.stl", cradle(PHONE_W + 5.0, 8.5, "com capa")),
        ("3_berco_fold7_sem_capa.stl", cradle(PHONE_W + 1.4, 5.4, "sem capa")),
    ]
    print("Gerado:")
    for fname, mesh in jobs:
        mesh = clean(mesh)
        report(fname, mesh)
        assert mesh.body_count == 1, f"{fname} tem {mesh.body_count} corpos soltos"
        mesh.export(os.path.join(OUT, fname))
