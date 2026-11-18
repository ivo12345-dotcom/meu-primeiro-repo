# Caixa v2 do radar de capacete (TESTE, PLA preto).
# Descoberta de 18/11: o LD2460 só mede o ângulo para os lados com o lado de 50 mm na VERTICAL.
# Por isso as placas ficam DE PÉ, inclinadas TILT graus para baixo (topo para fora), encostadas à parede:
# a gravidade encosta-as à parede, um batente pequeno só nos cantos de baixo impede-as de escorregar
# para dentro e dois dedos na tampa seguram os cantos de cima. Nada cobre o meio das placas.
#   python -I caixa_v2.py   -> caixa_v2_base.stl, caixa_v2_tampa.stl
import math, os
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection

# ---- medidas (mm) ----
PCB_W, PCB_H, PCB_T = 32.0, 50.0, 1.6      # LD2460 de pé: 32 de largura, 50 de altura
TILT = 0.0                                 # graus para baixo (0 = a direito; 30° quase não baixa a caixa e alarga-a muito)
RB = 42.0                                  # centro -> face das antenas, na aresta de baixo da placa
GAP = 0.6                                  # antenas -> parede (nervuras de apoio)
FOLGA = 0.4
PAREDE = 1.6
CHAO = 2.0
APOIO = 1.0                                # altura do degrau onde assenta a aresta de baixo
LIP = 1.5                                  # batente: só cobre 1,5 mm da placa e só nos cantos
LIP_W = 4.0                                # largura de cada batente (cantos)
FLAT = 44.0                                # largura plana de cada parede de radar (placa 32 + nervuras)
TAMPA = 2.0
LABIO_H, LABIO_T, LABIO_F = 4.0, 1.4, 0.15   # 0,3 ficou frouxo na caixa de teste
USB_W, USB_D = 6.5, 9.0
YAWS = {1: 0.0, 2: -120.0, 3: 120.0}

T = math.radians(TILT)
ZB = CHAO + APOIO                          # aresta de baixo da placa
ZT = ZB + PCB_H * math.cos(T)              # aresta de cima
ALT = ZT + 1.5                             # topo da caixa (onde assenta a tampa)


def box(x, y, z, cx=0, cy=0, cz=0):
    return Manifold.cube([x, y, z], center=True).translate([cx, cy, cz])


def r_parede(z, extra=0.0):
    """Distância do centro à face de dentro da parede de radar, à altura z."""
    return RB + GAP / math.cos(T) + (z - ZB) * math.tan(T) + extra


def contorno(ri, flat):
    """Triângulo de lados a 'ri' (virados para 0 e ±120°), cantos cortados para os lados terem 'flat' de largura."""
    corte = (flat * math.sin(math.radians(60)) + ri) / 2
    tri = CrossSection([[(2 * ri * math.cos(math.radians(270 + 120 * k)),
                          2 * ri * math.sin(math.radians(270 + 120 * k))) for k in range(3)]])
    c = 2 * corte
    tri2 = CrossSection([[(c * math.cos(math.radians(90 + 120 * k)),
                           c * math.sin(math.radians(90 + 120 * k))) for k in range(3)]])
    return tri ^ tri2


def tronco(z0, z1, extra, flat):
    """Sólido com paredes inclinadas TILT entre z0 e z1."""
    a = Manifold.extrude(contorno(r_parede(z0, extra), flat), 0.01).translate([0, 0, z0])
    b = Manifold.extrude(contorno(r_parede(z1, extra), flat), 0.01).translate([0, 0, z1 - 0.01])
    return Manifold.batch_hull([a, b])


def local_para_mundo(m, yaw):
    """Peças desenhadas com a placa de pé (face das antenas em y=0, aresta de baixo em z=0, virada para +y):
    inclina TILT (topo para fora), põe no sítio do radar e roda para o ângulo dele."""
    return m.rotate([-TILTD, 0, 0]).translate([0, RB, ZB]).rotate([0, 0, -yaw])


TILTD = TILT
WOUT = PAREDE / math.cos(T)                # espessura horizontal da parede inclinada


def suporte_radar():
    """Nervuras + batentes de um radar, no referencial local da placa."""
    m = None
    for s in (-1, 1):
        # nervura de apoio (as antenas encostam aqui) ao longo da borda da placa: 1,5 mm de largura
        rib = box(1.5, GAP + 1.0, PCB_H, s * (PCB_W / 2 - 0.75), GAP / 2 + 0.5 - 0.0, PCB_H / 2)
        # batente nos cantos de baixo, do lado dos componentes: só LIP mm de altura
        y0 = -PCB_T - FOLGA
        lip = box(LIP_W, 1.2, LIP + APOIO + 1.0, s * (PCB_W / 2 - LIP_W / 2), y0 - 0.6, (LIP - APOIO - 1.0) / 2)
        # ligação do batente à parede por baixo da placa
        y_in = y0 - 1.2
        pe = box(LIP_W, GAP + 1.5 - y_in, APOIO + 1.0, s * (PCB_W / 2 - LIP_W / 2), (y_in + GAP + 1.5) / 2,
                 -(APOIO + 1.0) / 2)
        p = rib + lip + pe
        m = p if m is None else m + p
    return m


def pontos(n):
    """n bolinhas no chão para identificar o radar."""
    m = None
    for k in range(n):
        c = Manifold.cylinder(1.2, 1.6, 1.6, 24).translate([(k - (n - 1) / 2) * 5.0, RB - 19, CHAO])  # fora da zona dos fios
        m = c if m is None else m + c
    return m


def seta():
    s = CrossSection([[(-4, 6), (4, 6), (4, 12), (8, 12), (0, 20), (-8, 12), (-4, 12)]])
    return Manifold.extrude(s, 1.0).translate([0, 0, CHAO])


def base():
    out = tronco(0, ALT, WOUT, FLAT + 3.7)
    cav = tronco(CHAO, ALT + 1, 0, FLAT)
    m = out - cav
    # entalhe do cabo USB (atrás, canto entre os radares 2 e 3), a partir do topo
    yb = -(r_parede(ALT) + 10)
    m = m - box(USB_W, 60, USB_D * 2, 0, yb, ALT)
    m = m - Manifold.cylinder(60, USB_W / 2, USB_W / 2, 32).rotate([90, 0, 0]).translate([0, yb + 30, ALT - USB_D])
    for n, yaw in YAWS.items():
        sup = local_para_mundo(suporte_radar(), yaw)
        # o suporte não pode sair para fora da caixa
        m = m + (sup ^ tronco(0, ALT, WOUT * 0.5, FLAT + 3.7)) + pontos(n).rotate([0, 0, -yaw])
    return m + seta()


def tampa():
    t = Manifold.extrude(contorno(r_parede(ALT, WOUT), FLAT + 3.7), TAMPA)
    # lábio só nos 3 cantos (nas paredes dos radares estão as placas): mede-se onde a parede é mais estreita
    ri = r_parede(ALT - LABIO_H) - LABIO_F
    lip = Manifold.extrude(contorno(ri, FLAT - 2 * LABIO_F), LABIO_H) - \
        Manifold.extrude(contorno(ri - LABIO_T, FLAT - 2 * LABIO_F - 2 * LABIO_T), LABIO_H + 1).translate([0, 0, -0.5])
    for yaw in YAWS.values():
        lip = lip - box(FLAT + 6, 30, LABIO_H * 3, 0, ri, LABIO_H / 2).rotate([0, 0, -yaw])
    lip = lip - box(USB_W + 4, 40, LABIO_H * 3, 0, -(r_parede(ALT) + 5), LABIO_H / 2)
    # dedos que seguram os cantos de cima das placas (pela face dos componentes, 1,5 mm de sobreposição)
    dedos = None
    for yaw in YAWS.values():
        for s in (-1, 1):
            # ponto do canto de cima da placa, face dos componentes
            ztop_rel = ALT - ZT                            # da aresta de cima ao topo da caixa
            # a placa está inclinada: mais abaixo a face fica mais para dentro -> o dedo afasta-se o necessário
            yc = RB + PCB_H * math.sin(T) - (PCB_T + FOLGA) / math.cos(T) - LIP * math.tan(T) - 0.6
            d = box(LIP_W, 1.2, ztop_rel + LIP, s * (PCB_W / 2 - LIP_W / 2), yc, 0)
            d = d.translate([0, 0, (ztop_rel + LIP) / 2 - ztop_rel - LIP]).rotate([0, 0, -yaw])
            dedos = d if dedos is None else dedos + d
    # a tampa é desenhada ao contrário (por cima = z 0..TAMPA, lábio e dedos para "baixo" = +z ao imprimir)
    m = t + lip.translate([0, 0, TAMPA]) + dedos.mirror([0, 0, 1]).translate([0, 0, TAMPA])
    s = CrossSection([[(-4, 6), (4, 6), (4, 12), (8, 12), (0, 20), (-8, 12), (-4, 12)]])
    m = m - Manifold.extrude(s, 0.6).translate([0, 0, -0.01])
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
    print(f"placa: baixo z={ZB:.1f}  cima z={ZT:.1f}  caixa alt={ALT:.1f}  parede dentro baixo={r_parede(ZB):.1f} cima={r_parede(ZT):.1f}")
    guardar(base(), "caixa_v2_base.stl")
    guardar(tampa(), "caixa_v2_tampa.stl")
