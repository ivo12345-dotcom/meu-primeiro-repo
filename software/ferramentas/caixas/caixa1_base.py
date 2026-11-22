# Caixa 1 (instrumentos): a base e a peça de ensaio, para imprimir. Versão 2 (22/11/2026).
# Desenho: docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md, "Caixa 1: instrumentos".
#
# A base leva a placa ESP32 e o sensor BNO085, sem parafusos e sem peças soltas. As duas placas ficam
# de PINOS PARA CIMA, para os fios se ligarem por cima, à vista. Cada placa enfia-se em quatro
# espigões maciços que saem da base e atravessam os seus furos; prende-se com uma gota de cola em cima
# de cada espigão (sai com um x-ato quando a placa tiver de sair).
#
# O que mudou da versão 1, pelo ensaio do Ivo com as placas verdadeiras: os apoios de furo fendido
# partiam ao meter as estacas, e com o ESP32 de pinos para baixo não havia espaço para as fichas dos
# fios. A ideia dos espigões é dele.
#
#   python caixa1_base.py <pasta de saída> [pasta para as peças soltas de verificação]
#
# Escreve: caixa1-base.stl/.step e caixa1-ensaio.stl. Verifica que nada bate em nada (placas, peças de
# baixo, pinos, fichas dos fios, ficha USB) e diz as folgas. Precisa do cadquery.
#
# Medidas (mm). x ao comprido da base (0 na ponta do sensor), y ao través (0 no eixo), z para cima.
import json
import math
import os
import sys

import cadquery as cq

sys.stdout.reconfigure(encoding='utf-8')

# --- Placa ESP32 ELEGOO "ESP32 DEVKIT V1 TYPEC" ---------------------------------------------------
# Tiradas da fotografia do anúncio, usando o passo dos pinos (2,54 mm) como régua. A distância entre
# furos ficou confirmada pela peça de ensaio da versão 1 (as placas entraram). As posições das peças
# do lado de baixo vêm da mesma fotografia (±0,2 mm): por isso as folgas junto aos botões são largas.
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
AFASTAMENTO = 150.0                              # do centro do sensor à ponta mais próxima do ESP32:
                                                 # a corrente e o aço da placa enganam a bússola
H_SEN = 4.0                                      # do fundo à face de baixo do sensor
H_ESP = 6.0                                      # do fundo à face de baixo do ESP32 (a das peças): cabe
                                                 # a ficha do cabo USB, que fica por baixo da placa
SOBRA = 2.5                                      # o que o espigão passa acima da placa (para a cola)
ORELHAS_X = (95.0, 252.0)                        # orelhas para fixar a caixa (parafusos de latão)
AMARRAS_X = (62.0, 148.0)                        # onde os fios do sensor se prendem ao fundo
FOLGA_FIO = 30.0                                 # a mais em cada fio, para as pontas e para não ficar esticado

X_ESP0 = XS + AFASTAMENTO                        # ponta do ESP32 virada para o sensor (a da antena)
X_ESP1 = X_ESP0 + ESP_COMP                       # ponta da ficha USB
MARGEM_X = (ESP_COMP - ESP_FUROS_X) / 2
XH1 = X_ESP0 + MARGEM_X                          # linha dos furos do lado da antena
XH2 = XH1 + ESP_FUROS_X                          # linha dos furos do lado do USB
YH = ESP_FUROS_Y / 2
BORDO_Y = (ESP_LARG - ESP_FUROS_Y) / 2           # do centro do furo ao bordo comprido da placa

# --- Torres do ESP32 --------------------------------------------------------------------------------
# A placa pousa pelos quatro cantos: um quarto de anel à volta de cada furo, do lado de fora (para a
# ponta e para o bordo), onde a placa não tem peças. O pé largo fica abaixo dos botões.
ESPIGAO_ESP = 2.6                                # no furo de 3,0: 0,2 de folga de cada lado
PE_ESP = 6.0                                     # diâmetro do pé
ASSENTO_ESP = 2.8                                # raio do quarto de anel onde o canto da placa pousa
ABAIXO_BOTOES = 2.6                              # o pé acaba a esta distância da placa (os botões têm 2,0)
# Dois batentes por baixo das duas peças mais fortes da placa (a tampa de metal do módulo e a tomada
# USB), 0,3 mm abaixo delas: não tocam, só seguram a placa quando se carrega nas fichas dos fios.
ALT_TAMPA, ALT_TOMADA, FOLGA_BATENTE = 3.10, 3.26, 0.3

# --- Torres do sensor -------------------------------------------------------------------------------
ESPIGAO_SEN = 2.1                                # no furo de 2,5: 0,2 de folga de cada lado
TORRE_SEN, PE_SEN, ALT_PE_SEN = 4.6, 8.0, 1.2    # o sensor pousa no anel todo à volta de cada furo

# --- Os quatro fios, nas cores que o Ivo usou (para as imagens e para o comprimento) ----------------
# cor, pino do sensor (0 = VIN … 5 = INT), nome na placa, número do pino na fila do botão BOOT a contar
# da ponta da antena (D23 = 1, D22 = 2, …, D21 = 5, …, GND = 14, 3V3 = 15)
FIOS = [('vermelho', 0, '3V3', 15), ('preto', 2, 'GND', 14), ('castanho', 3, 'D22', 2), ('laranja', 4, 'D21', 5)]


def caixa(x0, x1, y0, y1, z0, z1):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cilindro(x, y, z0, z1, d):
    return cq.Workplane('XY').circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def prisma(pontos, z0, z1):
    return cq.Workplane('XY').polyline(pontos).close().extrude(z1 - z0).translate((0, 0, z0))


def espigao(x, y, z0, z1, d):
    """Espigão maciço com a ponta afiada 0,6 mm, para a placa entrar à primeira."""
    corpo = cilindro(x, y, z0, z1 - 0.6, d)
    ponta = cq.Workplane('XY').circle(d / 2).workplane(offset=0.6).circle(d / 2 - 0.45).loft().translate((x, y, z1 - 0.6))
    return corpo.union(ponta)


def furos_esp():
    """(x, y, para que lado fica a ponta da placa, para que lado fica o bordo)"""
    return [(XH1, YH, -1, 1), (XH1, -YH, -1, -1), (XH2, YH, 1, 1), (XH2, -YH, 1, -1)]


def furos_sen(xs=XS):
    return [(xs + sx * SEN_FUROS_X / 2, sy * SEN_FUROS_Y / 2) for sx in (-1, 1) for sy in (-1, 1)]


def torre_esp(x, y, sx, sy):
    z_placa = T + H_ESP
    z_pe = z_placa - ABAIXO_BOTOES
    t = cilindro(x, y, T, z_pe, PE_ESP)
    quarto = cilindro(x, y, z_pe, z_placa, 2 * ASSENTO_ESP).intersect(
        caixa(x, x + sx * 5, y, y + sy * 5, z_pe - 0.1, z_placa + 0.1))
    return t.union(quarto).union(espigao(x, y, z_pe, z_placa + ESP_ESP + SOBRA, ESPIGAO_ESP))


def batentes_esp():
    z_placa = T + H_ESP
    tampa = caixa(X_ESP0 + 9.0, X_ESP0 + 21.5, -5.5, 5.5, T, z_placa - ALT_TAMPA - FOLGA_BATENTE).edges('|Z').fillet(1.5)
    tomada = caixa(X_ESP1 - 5.2, X_ESP1 - 0.6, -3.2, 3.2, T, z_placa - ALT_TOMADA - FOLGA_BATENTE).edges('|Z').fillet(1.0)
    return tampa.union(tomada)


def torre_sen(x, y):
    z_placa = T + H_SEN
    t = cilindro(x, y, T, T + ALT_PE_SEN, PE_SEN).union(cilindro(x, y, T + ALT_PE_SEN, z_placa, TORRE_SEN))
    return t.union(espigao(x, y, z_placa, z_placa + SEN_ESP + SOBRA, ESPIGAO_SEN))


def amarra(b, x, meia):
    """Sítio para uma abraçadeira: duas ranhuras no fundo e um rasgo por baixo a uni-las, para a
    abraçadeira passar por baixo sem levantar a base."""
    for lado in (-1, 1):
        b = b.cut(caixa(x, x + 4.0, lado * meia, lado * (meia + 2.8), -1, T + 3))
    return b.cut(caixa(x, x + 4.0, -(meia + 2.8), meia + 2.8, -0.1, 1.5))


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
    # as torres e os batentes
    for x, y, sx, sy in furos_esp():
        b = b.union(torre_esp(x, y, sx, sy))
    b = b.union(batentes_esp())
    for x, y in furos_sen():
        b = b.union(torre_sen(x, y))
    # seta em relevo com a palavra PROA: diz só para que lado a caixa aponta (o sítio da caixa é o
    # cubículo da cabine de popa). Aponta para a ponta dos cabos, para o sensor ficar do lado da
    # popa, mais longe do motor. Se no barco tiver de ficar de outra maneira, acerta-se no programa.
    xm = (XS + SEN_COMP / 2 + X_ESP0) / 2
    b = b.union(cq.Workplane('XY').workplane(offset=T).center(xm, 14.5)
                .text('PROA', 7.0, 0.6, font='Arial', kind='bold', halign='center', valign='center'))
    b = b.union(caixa(xm - 34, xm + 34, 7.9, 9.1, T, T + 0.6))
    b = b.union(prisma([(xm + 34, 5.3), (xm + 43, 8.5), (xm + 34, 11.7)], T, T + 0.6))
    b = b.union(cq.Workplane('XY').workplane(offset=T).center(xm, -14.5)
                .text('C1 v2', 5.0, 0.6, font='Arial', kind='bold', halign='center', valign='center'))
    # berço do cabo USB, com abraçadeira, para a ficha não trabalhar na tomada com o balanço
    xa = X_ESP1 + 30.0
    z_cabo = T + H_ESP - 1.63                                # eixo da ficha USB (fica por baixo da placa)
    berco = caixa(xa, xa + 4.0, -4.5, 4.5, T, z_cabo - 2.2 + 1.2).edges('|Z').fillet(1.0)
    berco = berco.cut(cq.Workplane('YZ').polyline([(-2.6, 0.1), (0, -1.2), (2.6, 0.1)]).close()
                      .extrude(6).translate((xa - 1, 0, z_cabo - 2.2 + 1.2)))
    b = b.union(berco)
    # furos e rasgos
    for xo in ORELHAS_X:
        for lado in (-1, 1):
            b = b.cut(cilindro(xo, lado * (W / 2 + 5.0), -1, T + 1, 4.3))
    b = amarra(b, xa, 5.0)
    for x in AMARRAS_X:
        b = amarra(b, x, 2.4)
    # marcas: o eixo nas duas pontas, e o sítio do sensor nos dois lados
    b = b.cut(prisma([(-0.1, -1.5), (1.5, 0), (-0.1, 1.5)], -1, T + 1))
    b = b.cut(prisma([(L + 0.1, -1.5), (L - 1.5, 0), (L + 0.1, 1.5)], -1, T + 1))
    for lado in (-1, 1):
        yb = lado * (W / 2 + 0.1)
        b = b.cut(prisma([(XS - 1.5, yb), (XS, yb - lado * 1.6), (XS + 1.5, yb)], -1, T + 1))
    return b


def ensaio(b):
    """Peça de ensaio: os dois bocados da base onde as placas assentam, cortados da própria base e
    postos lado a lado. Serve para ver, com as placas verdadeiras, se os espigões entram e se as
    placas pousam bem, antes de imprimir a base inteira."""
    da_esp = b.intersect(caixa(X_ESP0 - 5, X_ESP1 + 5, -17.5, 17.5, -1, 40))
    do_sen = b.intersect(caixa(XS - 16, XS + 16, -13.5, 13.5, -1, 40))
    do_sen = do_sen.translate((X_ESP1 + 5 + 16 + 3 - XS, 0, 0))
    ponte = caixa(X_ESP1 + 4, X_ESP1 + 9, -5, 5, 0, T)
    return da_esp.union(ponte).union(do_sen).translate((-(X_ESP0 - 5), 17.5, 0))


def placa_esp():
    """Maqueta do ESP32 no sítio, de pinos para cima, com tudo o que pode bater: as peças (que ficam
    para baixo), a ficha do cabo USB, os pinos e as fichas dos fios. As posições das peças vêm da
    fotografia do anúncio; ao virar a placa trocam de lado, mas a maqueta é igual dos dois lados."""
    z0 = T + H_ESP                                # face de baixo da placa (a das peças)
    z1 = z0 + ESP_ESP
    pcb = cq.Workplane('XY').box(ESP_COMP, ESP_LARG, ESP_ESP, centered=(False, True, False)) \
        .translate((X_ESP0, 0, z0)).edges('|Z').fillet(2.0)
    for x, y, _, _ in furos_esp():
        pcb = pcb.cut(cilindro(x, y, z0 - 1, z1 + 1, ESP_FURO))
    xp0 = XH1 + ESP_PINO1 - 1.27
    xp1 = xp0 + 15 * 2.54
    baixo = caixa(X_ESP0 + 0.5, X_ESP0 + 6.3, -9.0, 9.0, z0 - 0.8, z0)                        # antena do módulo
    baixo = baixo.union(caixa(X_ESP0 + 6.3, X_ESP0 + 24.2, -8.0, 8.0, z0 - ALT_TAMPA, z0))   # tampa do módulo
    baixo = baixo.union(caixa(X_ESP0 + 25.0, X_ESP1 - 7.0, -11.0, 11.0, z0 - 2.6, z0))       # peças miúdas
    baixo = baixo.union(caixa(X_ESP1 - 6.05, X_ESP1 + 1.3, -4.47, 4.47, z0 - ALT_TOMADA, z0))  # tomada USB-C
    reguas = fichas = None
    for lado in (-1, 1):
        baixo = baixo.union(caixa(XH2 - 2.0, XH2 + 1.1, lado * (YH - 1.7), lado * (YH - 4.4), z0 - 2.0, z0))   # botões
        baixo = baixo.union(caixa(XH2 - 3.6, XH2 - 1.6, lado * (YH - 1.6), lado * (YH + 0.6), z0 - 0.8, z0))  # peça junto ao furo
        yf = lado * ESP_FILAS / 2
        baixo = baixo.union(caixa(xp0, xp1, yf - 0.5, yf + 0.5, z0 - 1.5, z0))                # soldaduras dos pinos
        regua = caixa(xp0, xp1, yf - 1.27, yf + 1.27, z1, z1 + 2.5).union(caixa(xp0, xp1, yf - 0.32, yf + 0.32, z1 + 2.5, z1 + 8.5))
        ficha = caixa(xp0, xp1, yf - 1.27, yf + 1.27, z1 + 2.5, z1 + 16.5)
        reguas = regua if reguas is None else reguas.union(regua)
        fichas = ficha if fichas is None else fichas.union(ficha)
    zc = z0 - 1.63
    usb = caixa(X_ESP1 + 1.3, X_ESP1 + 26.3, -6.2, 6.2, zc - 3.5, zc + 3.5)                   # ficha do cabo USB-C
    return {'pcb': pcb, 'baixo': baixo, 'reguas': reguas, 'fichas': fichas, 'usb': usb}


def placa_sen():
    """Maqueta do sensor: o lado do chip para cima, com os dois pentes de pinos também para cima
    (como o Ivo os soldou); por baixo só as soldaduras dos pinos."""
    z0 = T + H_SEN
    z1 = z0 + SEN_ESP
    pcb = cq.Workplane('XY').box(SEN_COMP, SEN_LARG, SEN_ESP, centered=(True, True, False)) \
        .translate((XS, 0, z0)).edges('|Z').fillet(2.0)
    for x, y in furos_sen():
        pcb = pcb.cut(cilindro(x, y, z0 - 1, z1 + 1, SEN_FURO))
    cima = caixa(XS - 2.6, XS + 2.6, -1.9, 1.9, z1, z1 + 1.1)                          # o chip
    baixo = None
    for s in (-1, 1):
        cima = cima.union(caixa(XS + s * SEN_COMP / 2, XS + s * (SEN_COMP / 2 - 4.3), -3.0, 3.0, z1, z1 + 2.9))  # fichas pequenas
        yf = s * SEN_FUROS_Y / 2
        cima = cima.union(caixa(XS - 7.62, XS + 7.62, yf - 1.27, yf + 1.27, z1, z1 + 2.5))                      # pentes de pinos
        cima = cima.union(caixa(XS - 7.62, XS + 7.62, yf - 0.32, yf + 0.32, z1 + 2.5, z1 + 8.5))
        solda = caixa(XS - 7.25, XS + 7.25, yf - 0.9, yf + 0.9, z0 - 1.0, z0)
        baixo = solda if baixo is None else baixo.union(solda)
    return {'pcb': pcb, 'cima': cima, 'baixo': baixo}


def fios():
    """O caminho de cada fio: do pino do sensor, por cima, pelas duas amarras do fundo, até ao pino
    da placa. A fila do VIN do sensor e a fila do botão BOOT da placa ficam as duas do lado -y."""
    z_sen = T + H_SEN + SEN_ESP + 2.5              # onde começa a ficha do fio, no sensor
    z_esp = T + H_ESP + ESP_ESP + 2.5              # e na placa
    y_sen, y_esp = -SEN_FUROS_Y / 2, -ESP_FILAS / 2
    lista = []
    for i, (cor, pino_sen, nome, pino_esp) in enumerate(FIOS):
        xs = XS + (pino_sen - 2.5) * 2.54
        xp = XH1 + ESP_PINO1 + (pino_esp - 1) * 2.54
        ya = (i - 1.5) * 1.1                        # lado a lado nas amarras
        z_chao = T + 1.0
        pontos = [(xs, y_sen, z_sen + 14.0), (xs, y_sen, z_sen + 20.0), (xs + 9, y_sen + 3, z_sen + 16.0),
                  (AMARRAS_X[0] - 8, ya, z_chao + 3), (AMARRAS_X[0] + 2, ya, z_chao), (AMARRAS_X[1] + 2, ya, z_chao),
                  (AMARRAS_X[1] + 12, ya - 2, z_chao + 4), (xp - 6, y_esp - 3.5, z_esp + 14.0), (xp, y_esp, z_esp + 21.0),
                  (xp, y_esp, z_esp + 14.0)]
        comp = sum(math.dist(a, b) for a, b in zip(pontos, pontos[1:]))
        lista.append(dict(nome=nome, cor=cor, pontos=pontos, comprimento=comp,
                          fichas=[[xs - 1.27, xs + 1.27, y_sen - 1.27, y_sen + 1.27, z_sen, z_sen + 14.0],
                                  [xp - 1.27, xp + 1.27, y_esp - 1.27, y_esp + 1.27, z_esp, z_esp + 14.0]]))
    # o cabo USB, só para as imagens: da ficha, pelo berço, para fora da caixa
    zc = T + H_ESP - 1.63
    lista[0]['usb'] = [(X_ESP1 + 24.0, 0, zc), (X_ESP1 + 32.0, 0, zc), (L + 18.0, 0, zc)]
    return lista


def volume(a, b):
    """Volume em que duas peças se sobrepõem (0 se não se tocam)."""
    try:
        return a.intersect(b).val().Volume()
    except Exception:
        return 0.0


def main():
    saida = sys.argv[1]
    soltas = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(saida, exist_ok=True)
    b = base()
    esp, sen = placa_esp(), placa_sen()
    ens = ensaio(b)

    cx = b.val().BoundingBox()
    ce = ens.val().BoundingBox()
    print(f'base: {cx.xlen:.1f} x {cx.ylen:.1f} x {cx.zlen:.1f} mm, {b.val().Volume() / 1000:.1f} cm3 de plástico maciço')
    print(f'ensaio: {ce.xlen:.1f} x {ce.ylen:.1f} x {ce.zlen:.1f} mm, {ens.val().Volume() / 1000:.2f} cm3')
    print(f'ESP32: de x={X_ESP0:.2f} a {X_ESP1:.2f}; furos em x={XH1:.2f} e {XH2:.2f}, y=±{YH:.3f}; face de baixo a {H_ESP} mm do fundo')
    print(f'sensor: centro em x={XS}; furos em x={XS - SEN_FUROS_X / 2:.2f} e {XS + SEN_FUROS_X / 2:.2f}, y=±{SEN_FUROS_Y / 2:.2f}; face de baixo a {H_SEN} mm do fundo')
    print(f'do centro do sensor à tampa de metal do módulo do ESP32: {X_ESP0 + 6.3 - XS:.1f} mm')

    # --- verificações: nada pode bater em nada -----------------------------------------------------
    falhas = 0
    pares = [('placa do ESP32', esp['pcb']), ('peças de baixo do ESP32', esp['baixo']), ('pinos do ESP32', esp['reguas']),
             ('fichas dos fios no ESP32', esp['fichas']), ('ficha do cabo USB', esp['usb']), ('placa do sensor', sen['pcb']),
             ('peças de cima do sensor', sen['cima']), ('soldaduras de baixo do sensor', sen['baixo'])]
    for nome, peca in pares:
        v = volume(b, peca)
        if v > 1e-4:
            falhas += 1
            print(f'  BATE: a base com {nome}: {v:.3f} mm3')
    # as placas têm de pousar: a face de baixo de cada uma toca nos assentos (área de contacto)
    for nome, peca, z in (('ESP32', esp['pcb'], T + H_ESP), ('sensor', sen['pcb'], T + H_SEN)):
        fatia = b.intersect(peca.translate((0, 0, -0.05)))          # a placa descida 0,05 mm
        area = fatia.val().Volume() / 0.05
        print(f'  {nome}: pousa em {area:.1f} mm2 de assento')
        if area < 8:
            falhas += 1
            print(f'  FALHA: o {nome} quase não tem onde pousar')
    print(f'folga do espigão nos furos: ESP32 {(ESP_FURO - ESPIGAO_ESP) / 2:.2f} mm de cada lado; sensor {(SEN_FURO - ESPIGAO_SEN) / 2:.2f} mm')
    print(f'espigão acima da placa, para a cola: {SOBRA} mm; espigão do ESP32 livre abaixo da placa: {ABAIXO_BOTOES} mm, encostado ao quarto de anel')
    print(f'do espigão ao botão mais próximo: {1.7 - ESPIGAO_ESP / 2:.2f} mm; do pé da torre ao botão, em altura: {ABAIXO_BOTOES - 2.0:.1f} mm')
    print(f'da ficha do cabo USB ao fundo: {H_ESP - 1.63 - 3.5:.2f} mm; dos batentes às peças: {FOLGA_BATENTE} mm')
    print(f'do apoio do sensor à soldadura mais próxima: {3.81 - TORRE_SEN / 2 - 0.9:.2f} mm')
    lista_fios = fios()
    for f in lista_fios:
        cortar = math.ceil((f['comprimento'] + FOLGA_FIO) / 10)
        print(f"  fio {f['cor']} ({f['nome']}): {f['comprimento']:.0f} mm de caminho; cortar com {cortar} cm")
    print('VERIFICAÇÃO: ' + ('tudo livre' if falhas == 0 else f'{falhas} problema(s)'))

    cq.exporters.export(b, os.path.join(saida, 'caixa1-base.step'))
    cq.exporters.export(b, os.path.join(saida, 'caixa1-base.stl'), tolerance=0.02, angularTolerance=0.2)
    cq.exporters.export(ens, os.path.join(saida, 'caixa1-ensaio.stl'), tolerance=0.01, angularTolerance=0.15)
    if soltas:
        os.makedirs(soltas, exist_ok=True)
        tudo = {'base': b, 'ensaio': ens, 'esp_pcb': esp['pcb'], 'esp_baixo': esp['baixo'], 'esp_reguas': esp['reguas'],
                'esp_usb': esp['usb'], 'sen_pcb': sen['pcb'], 'sen_cima': sen['cima']}
        for nome, peca in tudo.items():
            cq.exporters.export(peca, os.path.join(soltas, nome + '.stl'), tolerance=0.02, angularTolerance=0.2)
        with open(os.path.join(soltas, 'fios.json'), 'w', encoding='utf-8') as f:
            json.dump(lista_fios, f)
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
