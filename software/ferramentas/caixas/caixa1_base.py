# Caixa 1 (instrumentos): a base, as estacas e a peça de ensaio, para imprimir.
# Desenho: docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md, "Caixa 1: instrumentos".
#
# A base leva a placa ESP32 e o sensor BNO085, sem parafusos: cada placa pousa em quatro apoios
# e é presa por quatro estacas que atravessam os seus furos e entram à pressão nos apoios.
#
#   python caixa1_base.py <pasta de saída> [pasta para as peças soltas de verificação]
#
# Escreve: caixa1-base.stl/.step, caixa1-estacas.stl e caixa1-ensaio.stl. Verifica que nada bate
# em nada (placas, pinos, fichas dos fios, ficha USB) e diz as folgas. Precisa do cadquery.
#
# Medidas (mm). x ao comprido da base (0 na ponta do sensor), y ao través (0 no eixo), z para cima.
import json
import math
import os
import sys

import cadquery as cq

sys.stdout.reconfigure(encoding='utf-8')

# --- Placa ESP32 ELEGOO "ESP32 DEVKIT V1 TYPEC" ---------------------------------------------------
# Tiradas da fotografia do anúncio, usando o passo dos pinos (2,54 mm) como régua.
# POR CONFIRMAR COM O PAQUÍMETRO: a distância entre furos e o diâmetro dos furos.
ESP_COMP, ESP_LARG, ESP_ESP = 51.10, 27.90, 1.6
ESP_FURO = 3.0
ESP_FUROS_X, ESP_FUROS_Y = 46.39, 23.47         # entre centros dos furos, ao comprido e ao través
ESP_PINO1 = 3.49                                 # do centro do furo ao primeiro pino, ao comprido
ESP_FILAS = 25.42                                # entre as duas filas de pinos

# --- Sensor Adafruit BNO085 (ref. 4754) ------------------------------------------------------------
# Do desenho do fabricante (1,00 x 0,90 pol.; furos a 0,80 x 0,70 pol.).
SEN_COMP, SEN_LARG, SEN_ESP = 25.40, 22.86, 1.6
SEN_FURO = 2.5
SEN_FUROS_X, SEN_FUROS_Y = 20.32, 17.78

# --- Base ------------------------------------------------------------------------------------------
L, W, T = 280.0, 52.0, 3.0                       # comprimento, largura, espessura do fundo
RAIO = 6.0                                       # cantos
LABIO_RECUO, LABIO_ESP, LABIO_ALT = 2.6, 1.6, 5.0  # rebordo onde encaixa a tampa (que vem depois)
XS = 25.0                                        # centro do sensor
AFASTAMENTO = 150.0                              # do centro do sensor à ponta mais próxima do ESP32.
                                                 # Os fios do sensor soldam-se à medida, em cabo de
                                                 # silicone (Ivo, 22/11): já não manda o cabo de encaixe
H_SEN = 6.0                                      # altura do sensor acima do fundo
H_ESP = 24.0                                     # altura do ESP32: os fios encaixam por baixo
ORELHAS_X = (95.0, 252.0)                        # orelhas para fixar a caixa (parafusos de latão)
FOLGA_FIO = 30.0                                 # a mais em cada fio, para as pontas e para não ficar esticado

X_ESP0 = XS + AFASTAMENTO                        # ponta do ESP32 virada para o sensor (a da antena)
MARGEM_X = (ESP_COMP - ESP_FUROS_X) / 2
XH1 = X_ESP0 + MARGEM_X                          # linha dos furos do lado da antena
XH2 = XH1 + ESP_FUROS_X                          # linha dos furos do lado do USB
YH = ESP_FUROS_Y / 2
BORDO_Y = (ESP_LARG - ESP_FUROS_Y) / 2           # do centro do furo ao bordo comprido da placa

# --- Apoios com pinça (o furo abre um nada quando a estaca entra, e aperta-a) -----------------------
PINCA_ESP = dict(fora=4.2, furo=2.55, alta=6.0, fundo=8.6)
PINCA_SEN = dict(fora=4.4, furo=2.05, alta=5.0, fundo=6.5)
PILAR_FORA, PILAR_DENTRO, PILAR_MEIA_LARG = 4.0, 1.75, 15.5

# --- Estacas (imprimem-se deitadas) -----------------------------------------------------------------
ESTACA_ESP = dict(d=2.6, esp=2.0, cabeca=2.4, entra=8.0, placa=ESP_ESP, dente=BORDO_Y + 0.5, dente_larg=1.5)
ESTACA_SEN = dict(d=2.1, esp=1.6, cabeca=2.0, entra=5.5, placa=SEN_ESP,
                  dente=(SEN_LARG - SEN_FUROS_Y) / 2 + 0.35, dente_larg=1.4)

# --- Os quatro fios do cabo do sensor (só para verificar o comprimento e para as imagens) ------------
# nome, cor, número do pino na fila do lado +y, a contar da ponta da antena (D22, D21, GND, 3V3)
FIOS = [('3V3', 'vermelho', 15), ('GND', 'preto', 14), ('D21', 'azul', 5), ('D22', 'amarelo', 2)]


def caixa(x0, x1, y0, y1, z0, z1):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cilindro(x, y, z0, z1, d):
    return cq.Workplane('XY').circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def prisma(pontos, z0, z1):
    return cq.Workplane('XY').polyline(pontos).close().extrude(z1 - z0).translate((0, 0, z0))


def furos_esp():
    """(x, y, para que lado fica o meio da placa)"""
    return [(XH1, YH, 1), (XH1, -YH, 1), (XH2, YH, -1), (XH2, -YH, -1)]


def furos_sen():
    return [(XS + sx * SEN_FUROS_X / 2, sy * SEN_FUROS_Y / 2) for sx in (-1, 1) for sy in (-1, 1)]


def pinca_esp(x, y, meio, z_topo):
    """Apoio do ESP32: dois meios-casquilhos. A fenda larga fica virada para os pinos, para não
    tocar na ficha do fio do primeiro pino."""
    p, z0 = PINCA_ESP, z_topo - PINCA_ESP['alta']
    c = cilindro(x, y, z0, z_topo, p['fora'])
    c = c.cut(caixa(x + meio * PILAR_DENTRO, x + meio * 4, y - 3, y + 3, z0 - 0.1, z_topo + 0.1))
    c = c.cut(caixa(x, x + meio * 4, y - 0.8, y + 0.8, z0, z_topo + 0.1))
    c = c.cut(caixa(x - meio * 4, x, y - 0.3, y + 0.3, z0, z_topo + 0.1))
    return c


def pinca_sen(x, y, z_base):
    p = PINCA_SEN
    z_topo = z_base + H_SEN
    c = cilindro(x, y, z_base, z_base + 1.0, 7.0).union(cilindro(x, y, z_base + 1.0, z_topo, p['fora']))
    c = c.cut(caixa(x - 4, x + 4, y - 0.3, y + 0.3, z_topo - p['alta'], z_topo + 0.1))
    return c


def furo_pinca(x, y, z_topo, p):
    """O furo da estaca, com uma entrada mais larga em cima para a guiar."""
    return cilindro(x, y, z_topo - p['fundo'], z_topo + 0.1, p['furo']).union(
        cilindro(x, y, z_topo - 0.4, z_topo + 0.1, p['furo'] + 0.35))


def pilar(xa, xb, z_topo):
    """Parede que levanta uma ponta do ESP32, com um túnel por baixo para passarem os fios."""
    corpo = caixa(xa, xb, -PILAR_MEIA_LARG, PILAR_MEIA_LARG, T, z_topo).edges('|Z').fillet(1.5)
    # perfil do túnel no plano y-z: 16 mm de largo, com o teto em bico para se imprimir sem suportes
    tunel = cq.Workplane('YZ').polyline([(-8, 0), (8, 0), (8, 7), (4, 11), (-4, 11), (-8, 7)]).close() \
        .extrude(abs(xb - xa) + 2).translate((min(xa, xb) - 1, 0, T))
    return corpo.cut(tunel)


def base():
    b = cq.Workplane('XY').box(L, W, T, centered=(False, True, False)).edges('|Z').fillet(RAIO)
    # orelhas de fixação
    for xo in ORELHAS_X:
        for lado in (-1, 1):
            yb = lado * W / 2
            b = b.union(caixa(xo - 7, xo + 7, yb - lado * 1.0, yb + lado * 5.0, 0, T))
            b = b.union(cilindro(xo, yb + lado * 5.0, 0, T, 14.0))
    # rebordo para a tampa
    fora = cq.Workplane('XY').box(L - 2 * LABIO_RECUO, W - 2 * LABIO_RECUO, LABIO_ALT, centered=(False, True, False)) \
        .translate((LABIO_RECUO, 0, T)).edges('|Z').fillet(RAIO - LABIO_RECUO)
    r = LABIO_RECUO + LABIO_ESP
    dentro = cq.Workplane('XY').box(L - 2 * r, W - 2 * r, LABIO_ALT + 2, centered=(False, True, False)) \
        .translate((r, 0, T - 1)).edges('|Z').fillet(RAIO - r)
    b = b.union(fora.cut(dentro))
    # apoios do ESP32
    z_esp = T + H_ESP
    z_pilar = z_esp - PINCA_ESP['alta']
    b = b.union(pilar(XH1 - PILAR_FORA, XH1 + PILAR_DENTRO, z_pilar))
    b = b.union(pilar(XH2 - PILAR_DENTRO, XH2 + PILAR_FORA, z_pilar))
    for x, y, meio in furos_esp():
        b = b.union(pinca_esp(x, y, meio, z_esp))
    # apoios do sensor
    for x, y in furos_sen():
        b = b.union(pinca_sen(x, y, T))
    # seta em relevo com a palavra PROA: diz só para que lado a caixa aponta (o sítio da caixa é o
    # cubículo da cabine de popa). Aponta para a ponta dos cabos, para o sensor ficar do lado da
    # popa, mais longe do motor. Se no barco tiver de ficar de outra maneira, acerta-se no programa.
    xm = (XS + SEN_COMP / 2 + X_ESP0) / 2
    b = b.union(cq.Workplane('XY').workplane(offset=T).center(xm, 13.5)
                .text('PROA', 7.0, 0.6, font='Arial', kind='bold', halign='center', valign='center'))
    b = b.union(caixa(xm - 34, xm + 34, 6.4, 7.6, T, T + 0.6))
    b = b.union(prisma([(xm + 34, 3.8), (xm + 43, 7.0), (xm + 34, 10.2)], T, T + 0.6))
    b = b.union(cq.Workplane('XY').workplane(offset=T).center((XH1 + XH2) / 2, 0)
                .text('C1 v1', 5.0, 0.6, font='Arial', kind='bold', halign='center', valign='center'))
    # apoio para prender o cabo USB com uma abraçadeira, para a ficha não trabalhar na tomada
    xa = X_ESP0 + ESP_COMP + 30.0
    z_cabo = T + H_ESP + ESP_ESP + 1.7                       # eixo da ficha USB
    apoio = caixa(xa, xa + 4.0, -6.0, 6.0, T, z_cabo - 2.3).edges('|Z').fillet(1.0)
    apoio = apoio.cut(caixa(xa - 1, xa + 5, -2.5, 2.5, z_cabo - 7.3, z_cabo - 5.3))
    apoio = apoio.cut(cq.Workplane('YZ').polyline([(-2.2, 0.1), (0, -1.3), (2.2, 0.1)]).close()
                      .extrude(6).translate((xa - 1, 0, z_cabo - 2.3)))
    b = b.union(apoio)
    # furos
    for xo in ORELHAS_X:
        for lado in (-1, 1):
            b = b.cut(cilindro(xo, lado * (W / 2 + 5.0), -1, T + 1, 4.3))
    for x, y, _ in furos_esp():
        b = b.cut(furo_pinca(x, y, z_esp, PINCA_ESP))
    for x, y in furos_sen():
        b = b.cut(furo_pinca(x, y, T + H_SEN, PINCA_SEN))
    # marcas: o eixo nas duas pontas, e o sítio do sensor nos dois lados
    b = b.cut(prisma([(-0.1, -1.5), (1.5, 0), (-0.1, 1.5)], -1, T + 1))
    b = b.cut(prisma([(L + 0.1, -1.5), (L - 1.5, 0), (L + 0.1, 1.5)], -1, T + 1))
    for lado in (-1, 1):
        yb = lado * (W / 2 + 0.1)
        b = b.cut(prisma([(XS - 1.5, yb), (XS, yb - lado * 1.6), (XS + 1.5, yb)], -1, T + 1))
    return b


def estaca(e):
    """Estaca na posição de uso: eixo no furo, z = 0 no topo da placa, aba e dente para +y."""
    r, m = e['d'] / 2, e['esp'] / 2
    fundo = e['placa'] + e['entra']
    perfil = [(0, e['cabeca']), (r, e['cabeca']), (r, -(fundo - 0.7)), (r - 0.4, -fundo), (0, -fundo)]
    haste = cq.Workplane('XZ').polyline(perfil).close().revolve(360, (0, 0, 0), (0, 1, 0))
    haste = haste.intersect(caixa(-m, m, -r - 1, r + 1, -fundo - 1, e['cabeca'] + 1))
    y_fim = e['dente'] + e['dente_larg']
    aba = caixa(-m, m, -r, y_fim, 0, e['cabeca'])
    dente = caixa(-m, m, e['dente'], y_fim, -(e['placa'] + 0.5), 0)
    return haste.union(aba).union(dente)


def deitada(peca, e):
    """A mesma estaca, deitada na mesa de impressão."""
    return peca.rotate((0, 0, 0), (0, 1, 0), 90).translate((0, 0, e['esp'] / 2))


def estacas_no_sitio():
    pecas = []
    for x, y, _ in furos_esp():
        p = estaca(ESTACA_ESP)
        if y < 0:
            p = p.rotate((0, 0, 0), (0, 0, 1), 180)
        pecas.append(p.translate((x, y, T + H_ESP + ESP_ESP)))
    for x, y in furos_sen():
        p = estaca(ESTACA_SEN)
        if y < 0:
            p = p.rotate((0, 0, 0), (0, 0, 1), 180)
        pecas.append(p.translate((x, y, T + H_SEN + SEN_ESP)))
    return pecas


def placa_estacas(n_esp=6, n_sen=6):
    """As estacas arrumadas para imprimir: 4 de cada e 2 de reserva."""
    pecas = []
    for i in range(n_esp):
        pecas.append(deitada(estaca(ESTACA_ESP), ESTACA_ESP).translate((0, i * 9.0, 0)))
    for i in range(n_sen):
        pecas.append(deitada(estaca(ESTACA_SEN), ESTACA_SEN).translate((18.0, i * 9.0, 0)))
    return pecas


def ensaio():
    """Peça de ensaio: os oito apoios nas posições certas, numa armação fina. Serve para ver, com
    as placas verdadeiras, se os furos batem certo e se as estacas apertam bem, antes da base."""
    x0 = XH1 - PILAR_FORA
    xs = XH2 + PILAR_FORA + 18.0                 # centro do sensor nesta peça
    p = caixa(x0, XH1 + PILAR_DENTRO, -PILAR_MEIA_LARG, PILAR_MEIA_LARG, 0, T)
    p = p.union(caixa(XH2 - PILAR_DENTRO, XH2 + PILAR_FORA, -PILAR_MEIA_LARG, PILAR_MEIA_LARG, 0, T))
    p = p.union(caixa(x0, xs + 14.5, -3.0, 3.0, 0, T))
    p = p.union(caixa(xs - 14.5, xs + 14.5, -12.5, 12.5, 0, T))
    z_esp = T + PINCA_ESP['alta']
    for x, y, meio in furos_esp():
        p = p.union(pinca_esp(x, y, meio, z_esp))
    pos_sen = [(xs + sx * SEN_FUROS_X / 2, sy * SEN_FUROS_Y / 2) for sx in (-1, 1) for sy in (-1, 1)]
    for x, y in pos_sen:
        p = p.union(pinca_sen(x, y, T))
    for x, y, _ in furos_esp():
        p = p.cut(furo_pinca(x, y, z_esp, PINCA_ESP))
    for x, y in pos_sen:
        p = p.cut(furo_pinca(x, y, T + H_SEN, PINCA_SEN))
    return p


def placa_esp():
    """Maqueta do ESP32 no sítio, com tudo o que pode bater: pinos, fichas dos fios, peças de cima
    e a ficha do cabo USB. As posições das peças de cima vêm da fotografia do anúncio."""
    z0 = T + H_ESP
    z1 = z0 + ESP_ESP
    pcb = cq.Workplane('XY').box(ESP_COMP, ESP_LARG, ESP_ESP, centered=(False, True, False)) \
        .translate((X_ESP0, 0, z0)).edges('|Z').fillet(2.0)
    for x, y, _ in furos_esp():
        pcb = pcb.cut(cilindro(x, y, z0 - 1, z1 + 1, ESP_FURO))
    xp0 = XH1 + ESP_PINO1 - 1.27
    xp1 = xp0 + 15 * 2.54
    partes = {'pcb': pcb, 'reguas': None, 'fichas': None, 'cima': None, 'usb': None}
    for lado in (-1, 1):
        yf = lado * ESP_FILAS / 2
        regua = caixa(xp0, xp1, yf - 1.27, yf + 1.27, z0 - 2.5, z0).union(caixa(xp0, xp1, yf - 0.32, yf + 0.32, z0 - 8.5, z0 - 2.5))
        ficha = caixa(xp0, xp1, yf - 1.27, yf + 1.27, z0 - 16.5, z0 - 2.5)
        partes['reguas'] = regua if partes['reguas'] is None else partes['reguas'].union(regua)
        partes['fichas'] = ficha if partes['fichas'] is None else partes['fichas'].union(ficha)
    xf = X_ESP0 + ESP_COMP
    cima = caixa(X_ESP0 + 0.5, X_ESP0 + 6.3, -9.0, 9.0, z1, z1 + 0.8)                 # antena do módulo
    cima = cima.union(caixa(X_ESP0 + 6.3, X_ESP0 + 24.2, -8.0, 8.0, z1, z1 + 3.1))    # tampa do módulo
    cima = cima.union(caixa(xf - 6.05, xf + 1.3, -4.47, 4.47, z1, z1 + 3.26))         # tomada USB-C
    for lado in (-1, 1):
        cima = cima.union(caixa(XH2 - 2.0, XH2 + 1.1, lado * (YH - 1.7), lado * (YH - 4.4), z1, z1 + 2.0))   # botões
        cima = cima.union(caixa(XH2 - 3.6, XH2 - 1.6, lado * (YH - 1.6), lado * (YH + 0.6), z1, z1 + 0.8))  # peça junto ao furo
        cima = cima.union(caixa(xp0, xp1, lado * ESP_FILAS / 2 - 0.5, lado * ESP_FILAS / 2 + 0.5, z1, z1 + 1.5))  # soldaduras dos pinos
    partes['cima'] = cima
    partes['usb'] = caixa(xf + 1.3, xf + 26.3, -6.2, 6.2, z1 + 1.7 - 3.5, z1 + 1.7 + 3.5)   # ficha do cabo USB-C
    return partes


def placa_sen():
    z0 = T + H_SEN
    z1 = z0 + SEN_ESP
    pcb = cq.Workplane('XY').box(SEN_COMP, SEN_LARG, SEN_ESP, centered=(True, True, False)) \
        .translate((XS, 0, z0)).edges('|Z').fillet(2.0)
    for x, y in furos_sen():
        pcb = pcb.cut(cilindro(x, y, z0 - 1, z1 + 1, SEN_FURO))
    cima = caixa(XS - 2.6, XS + 2.6, -1.9, 1.9, z1, z1 + 1.1)                          # o chip
    for s in (-1, 1):
        cima = cima.union(caixa(XS + s * SEN_COMP / 2, XS + s * (SEN_COMP / 2 - 4.3), -3.0, 3.0, z1, z1 + 2.9))  # fichas pequenas
        # réguas de pinos soldadas com os pinos para cima (só para a ligação de 10 fios)
        cima = cima.union(caixa(XS - 7.62, XS + 7.62, s * SEN_FUROS_Y / 2 - 1.27, s * SEN_FUROS_Y / 2 + 1.27, z1, z1 + 2.5))
    return {'pcb': pcb, 'cima': cima}


def fios():
    """O caminho de cada fio: da ficha pequena do sensor, pelo fundo e pelo túnel, até ao seu pino."""
    z_chao = T + 1.3
    z_ficha = T + H_ESP - 16.5                    # ponta de baixo da ficha do fio
    x_ini = XS + SEN_COMP / 2 + 4.0
    lista = []
    for i, (nome, cor, pino) in enumerate(FIOS):
        y0 = (i - 1.5) * 1.0
        yt = (i - 1.5) * 2.2
        xp = XH1 + ESP_PINO1 + (pino - 1) * 2.54
        yp = ESP_FILAS / 2
        pontos = [(x_ini, y0, T + H_SEN + SEN_ESP + 1.5), (x_ini + 9, y0, z_chao), (XH1 - PILAR_FORA - 6, yt, z_chao),
                  (XH1 + PILAR_DENTRO + 3, yt, z_chao), (xp - 3.0, yp - 4.0, z_chao + 0.5), (xp, yp, z_chao + 3.0), (xp, yp, z_ficha)]
        comp = sum(math.dist(a, b) for a, b in zip(pontos, pontos[1:]))
        lista.append(dict(nome=nome, cor=cor, pontos=pontos, comprimento=comp,
                          ficha=[xp - 1.27, xp + 1.27, yp - 1.27, yp + 1.27, z_ficha, z_ficha + 14.0]))
    # o cabo USB, só para as imagens: da ficha, por cima do apoio, para fora da caixa
    xf, zc = X_ESP0 + ESP_COMP, T + H_ESP + ESP_ESP + 1.7
    lista[0]['usb'] = [(xf + 24.0, 0, zc), (xf + 32.0, 0, zc), (L + 18.0, 0, zc)]
    return lista


def volume(a, b):
    """Volume em que duas peças se sobrepõem (0 se não se tocam)."""
    try:
        return a.intersect(b).val().Volume()
    except Exception:
        return 0.0


def junta(pecas):
    return cq.Workplane('XY').newObject([cq.Compound.makeCompound([p.val() for p in pecas])])


def main():
    saida = sys.argv[1]
    soltas = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(saida, exist_ok=True)
    b = base()
    est = estacas_no_sitio()
    esp, sen = placa_esp(), placa_sen()
    ens = ensaio()

    caixa_b = b.val().BoundingBox()
    print(f'base: {caixa_b.xlen:.1f} x {caixa_b.ylen:.1f} x {caixa_b.zlen:.1f} mm, {b.val().Volume() / 1000:.1f} cm3 de plástico maciço')
    print(f'ensaio: {ens.val().BoundingBox().xlen:.1f} x {ens.val().BoundingBox().ylen:.1f} x {ens.val().BoundingBox().zlen:.1f} mm, {ens.val().Volume() / 1000:.2f} cm3')
    print(f'ESP32: de x={X_ESP0:.2f} a {X_ESP0 + ESP_COMP:.2f}; furos em x={XH1:.2f} e {XH2:.2f}, y=±{YH:.3f}; apoio a {H_ESP} mm do fundo')
    print(f'sensor: centro em x={XS}; furos em x={XS - SEN_FUROS_X / 2:.2f} e {XS + SEN_FUROS_X / 2:.2f}, y=±{SEN_FUROS_Y / 2:.2f}; apoio a {H_SEN} mm do fundo')
    print(f'do centro do sensor à tampa de metal do módulo do ESP32: {X_ESP0 + 6.3 - XS:.1f} mm')

    # --- verificações: nada pode bater em nada -----------------------------------------------------
    falhas = 0
    pares = [('base', b, 'placa do ESP32', esp['pcb']), ('base', b, 'réguas e pinos do ESP32', esp['reguas']),
             ('base', b, 'fichas dos fios (as 30)', esp['fichas']), ('base', b, 'peças de cima do ESP32', esp['cima']),
             ('base', b, 'ficha do cabo USB', esp['usb']), ('base', b, 'placa do sensor', sen['pcb']),
             ('base', b, 'peças de cima do sensor', sen['cima'])]
    for i, p in enumerate(est):
        nome = f'estaca {i + 1}'
        pares += [(nome, p, 'placa do ESP32', esp['pcb']), (nome, p, 'peças de cima do ESP32', esp['cima']),
                  (nome, p, 'réguas e pinos do ESP32', esp['reguas']), (nome, p, 'fichas dos fios', esp['fichas']),
                  (nome, p, 'ficha do cabo USB', esp['usb']), (nome, p, 'placa do sensor', sen['pcb']),
                  (nome, p, 'peças de cima do sensor', sen['cima'])]
    for na, a, nb, c in pares:
        v = volume(a, c)
        if v > 1e-4:
            falhas += 1
            print(f'  BATE: {na} com {nb}: {v:.3f} mm3')
    # as estacas só podem tocar na base dentro dos furos (aperto de propósito, pequeno)
    for i, p in enumerate(est):
        v = volume(b, p)
        e = ESTACA_ESP if i < 4 else ESTACA_SEN
        pin = PINCA_ESP if i < 4 else PINCA_SEN
        print(f'  estaca {i + 1}: aperto no furo {e["d"] - pin["furo"]:.2f} mm no diâmetro; sobreposição com a base {v:.3f} mm3')
        if v > 1.0:
            falhas += 1
            print('  BATE: a estaca entra na base fora do furo')
    print(f'folga da estaca nos furos das placas: ESP32 {(ESP_FURO - ESTACA_ESP["d"]) / 2:.2f} mm de cada lado; sensor {(SEN_FURO - ESTACA_SEN["d"]) / 2:.2f} mm')
    print(f'folga entre o apoio do ESP32 e a ficha do fio do primeiro pino: {ESP_PINO1 - 1.27 - PILAR_DENTRO:.2f} mm')
    print(f'folga entre o dente da estaca e o bordo da placa: ESP32 {ESTACA_ESP["dente"] - BORDO_Y:.2f} mm; sensor {ESTACA_SEN["dente"] - (SEN_LARG - SEN_FUROS_Y) / 2:.2f} mm')
    print(f'do fundo à ponta das fichas dos fios (para o fio fazer a curva): {H_ESP - 16.5:.1f} mm')
    lista_fios = fios()
    for f in lista_fios:
        cortar = math.ceil((f['comprimento'] + FOLGA_FIO) / 10)
        print(f"  fio {f['nome']} ({f['cor']}): {f['comprimento']:.0f} mm de caminho; cortar com {cortar} cm")
    print('VERIFICAÇÃO: ' + ('tudo livre' if falhas == 0 else f'{falhas} problema(s)'))

    cq.exporters.export(b, os.path.join(saida, 'caixa1-base.step'))
    cq.exporters.export(b, os.path.join(saida, 'caixa1-base.stl'), tolerance=0.02, angularTolerance=0.2)
    cq.exporters.export(junta(placa_estacas()), os.path.join(saida, 'caixa1-estacas.stl'), tolerance=0.01, angularTolerance=0.15)
    # a peça de ensaio leva as suas oito estacas ao lado, e vai para junto da origem
    pecas_ensaio = [ens]
    pecas_ensaio += [deitada(estaca(ESTACA_ESP), ESTACA_ESP).translate((XH1 + 8 + i * 16.0, 27.0, 0)) for i in range(4)]
    pecas_ensaio += [deitada(estaca(ESTACA_SEN), ESTACA_SEN).translate((XH1 + 8 + i * 16.0, 36.0, 0)) for i in range(4)]
    pecas_ensaio = [p.translate((-(XH1 - PILAR_FORA), PILAR_MEIA_LARG, 0)) for p in pecas_ensaio]
    cq.exporters.export(junta(pecas_ensaio), os.path.join(saida, 'caixa1-ensaio.stl'), tolerance=0.01, angularTolerance=0.15)
    if soltas:
        os.makedirs(soltas, exist_ok=True)
        tudo = {'base': b, 'estacas': junta(est), 'esp_pcb': esp['pcb'], 'esp_reguas': esp['reguas'], 'esp_fichas': esp['fichas'],
                'esp_cima': esp['cima'], 'esp_usb': esp['usb'], 'sen_pcb': sen['pcb'], 'sen_cima': sen['cima'],
                'ensaio': junta(pecas_ensaio), 'estaca_esp': estaca(ESTACA_ESP), 'estaca_sen': estaca(ESTACA_SEN)}
        for nome, peca in tudo.items():
            cq.exporters.export(peca, os.path.join(soltas, nome + '.stl'), tolerance=0.02, angularTolerance=0.2)
        with open(os.path.join(soltas, 'fios.json'), 'w', encoding='utf-8') as f:
            json.dump(lista_fios, f)
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
