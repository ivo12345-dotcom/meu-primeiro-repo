# Caixa 2 (motor): a base das placas, para imprimir. Versão 1 (26/11/2026).
# Desenho: docs/superpowers/specs/2026-11-20-sistema-no-portatil-design.md, "Caixa 2: motor".
#
# Leva a placa ESP32 e a plaquinha do barramento do motor (WCMCU-230), sem parafusos e sem peças soltas,
# como a base da caixa 1: as duas ficam de PINOS PARA CIMA e enfiam-se em espigões maciços, com uma
# gota de cola em cima de cada um. As torres do ESP32 são as da caixa 1 (as mesmas medidas, já
# experimentadas com a placa verdadeira).
#
# O que fica de fora nesta versão, de propósito:
#   - o conversor de 12 V para 5 V: é um bloco fechado, com orelhas próprias; prende-se ao lado e só a
#     ficha USB-C dele entra na base;
#   - os dois relés de ligar e desligar o motor: entram na versão seguinte, com as medidas tiradas às
#     peças verdadeiras, e com a tampa.
# Cabe no espaço que o Ivo deu (até 85 mm de largura, 200 de altura e 300 de comprimento).
#
#   python caixa2_base.py <pasta de saída> [pasta para as peças soltas de verificação]
#
# Escreve caixa2-base.stl/.step. Verifica que nada bate em nada e diz as folgas. Precisa do cadquery.
#
# Medidas (mm). x ao comprido (a ficha USB da placa aponta para +x, que é a ponta por onde saem os
# cabos), y ao través (0 no eixo da base), z para cima.
import os
import sys

import cadquery as cq

import caixa1_base as c1
from caixa1_base import caixa, cilindro, espigao, prisma, volume

sys.stdout.reconfigure(encoding='utf-8')

T, H_ESP, SOBRA = c1.T, c1.H_ESP, c1.SOBRA

# --- Plaquinha do barramento (WCMCU-230, chip VP230) -----------------------------------------------
# Medidas tiradas das fotos do Ivo de 25 e 26/11, com o passo dos pinos (2,54 mm) como régua: ±0,3 mm.
# Por isso os espigões são finos (0,3 mm de folga de cada lado) e a distância entre eles fica a meio
# das duas medidas prováveis (11,0 e 11,43 mm).
MOD_X, MOD_Y, MOD_ESP = 13.6, 15.5, 1.6          # ao comprido da base, ao través (o lado dos pinos), espessura
MOD_FURO = 3.0
MOD_FUROS = 11.2                                 # entre centros dos dois furos
MOD_FURO_BORDO = 2.2                             # do centro dos furos ao bordo da plaquinha
MOD_FURO_PINOS = 9.94                            # da linha dos furos à fila dos pinos
ESPIGAO_MOD, TORRE_MOD = 2.4, 5.2
H_MOD = 5.0                                      # do fundo à face de baixo da plaquinha: cabem as soldas e a ponte

# --- Base ------------------------------------------------------------------------------------------
L, W = 104.0, 60.0
RAIO = 6.0
LABIO_RECUO, LABIO_ESP, LABIO_ALT = c1.LABIO_RECUO, c1.LABIO_ESP, c1.LABIO_ALT
X_ESP0, Y_ESP = 9.0, 9.0                         # a ponta da antena do ESP32 e o eixo dele
X_ESP1 = X_ESP0 + c1.ESP_COMP                    # a ponta da ficha USB
DX, DY = X_ESP0 - c1.X_ESP0, Y_ESP               # do sítio do ESP32 na caixa 1 para o sítio dele aqui
X_BERCO = X_ESP1 + 30.0                          # berço do cabo USB, com abraçadeira
X_MOD0 = X_ESP1 + 3.9                            # o bordo dos furos da plaquinha (o mais perto do ESP32)
Y_MOD = -16.0                                    # o eixo da plaquinha
X_FUROS_MOD = X_MOD0 + MOD_FURO_BORDO
X_PINOS_MOD = X_FUROS_MOD + MOD_FURO_PINOS
X_AMARRA_FIOS, Y_AMARRA_FIOS = 93.0, Y_MOD       # onde os fios do motor se prendem ao fundo
ORELHAS_X = (-5.0, L + 5.0)                      # uma orelha em cada ponta, para não alargar a base


def aqui(peca):
    """Uma peça feita no sítio do ESP32 da caixa 1, posta no sítio dele nesta base."""
    return peca.translate((DX, DY, 0))


def furos_mod():
    return [(X_FUROS_MOD, Y_MOD + s * MOD_FUROS / 2) for s in (-1, 1)]


def torre_mod(x, y):
    z = T + H_MOD
    return cilindro(x, y, T, z, TORRE_MOD).union(espigao(x, y, z, z + MOD_ESP + SOBRA, ESPIGAO_MOD))


def amarra(b, x, yc, meia):
    """Sítio para uma abraçadeira: duas ranhuras no fundo e um rasgo por baixo a uni-las."""
    for lado in (-1, 1):
        b = b.cut(caixa(x, x + 4.0, yc + lado * meia, yc + lado * (meia + 2.8), -1, T + 3))
    return b.cut(caixa(x, x + 4.0, yc - (meia + 2.8), yc + meia + 2.8, -0.1, 1.5))


def base():
    b = cq.Workplane('XY').box(L, W, T, centered=(False, True, False)).edges('|Z').fillet(RAIO)
    # orelhas de fixação, nas pontas
    for xo in ORELHAS_X:
        para = -1 if xo < 0 else 1
        x_bordo = 0.0 if xo < 0 else L
        b = b.union(caixa(x_bordo - para * 1.0, xo, -7.0, 7.0, 0, T))
        b = b.union(cilindro(xo, 0, 0, T, 14.0))
    # rebordo para a tampa (que vem com a versão dos relés)
    fora = cq.Workplane('XY').box(L - 2 * LABIO_RECUO, W - 2 * LABIO_RECUO, LABIO_ALT, centered=(False, True, False)) \
        .translate((LABIO_RECUO, 0, T)).edges('|Z').fillet(RAIO - LABIO_RECUO)
    r = LABIO_RECUO + LABIO_ESP
    dentro = cq.Workplane('XY').box(L - 2 * r, W - 2 * r, LABIO_ALT + 2, centered=(False, True, False)) \
        .translate((r, 0, T - 1)).edges('|Z').fillet(RAIO - r)
    b = b.union(fora.cut(dentro))
    # passagens no rebordo, na ponta dos cabos: uma para o cabo USB e outra para os fios do motor
    b = b.cut(caixa(L - r - 1, L, Y_ESP - 5.0, Y_ESP + 5.0, T, T + LABIO_ALT + 1))
    b = b.cut(caixa(L - r - 1, L, Y_AMARRA_FIOS - 6.0, Y_AMARRA_FIOS + 6.0, T, T + LABIO_ALT + 1))
    # as torres e os batentes do ESP32 (os da caixa 1)
    for f in c1.furos_esp():
        b = b.union(aqui(c1.torre_esp(*f)))
    b = b.union(aqui(c1.batentes_esp()))
    # as torres da plaquinha e um batente por baixo do meio dela, 0,2 mm abaixo: segura-a quando se
    # carrega nas fichas dos fios
    for x, y in furos_mod():
        b = b.union(torre_mod(x, y))
    b = b.union(caixa(X_FUROS_MOD + 4.0, X_FUROS_MOD + 7.0, Y_MOD - 5.0, Y_MOD + 5.0, T, T + H_MOD - 0.2).edges('|Z').fillet(1.0))
    # berço do cabo USB, com abraçadeira, para a ficha não trabalhar na tomada com a vibração
    z_cabo = T + H_ESP - 1.63
    berco = caixa(X_BERCO, X_BERCO + 4.0, Y_ESP - 4.5, Y_ESP + 4.5, T, z_cabo - 2.2 + 1.2).edges('|Z').fillet(1.0)
    berco = berco.cut(cq.Workplane('YZ').polyline([(Y_ESP - 2.6, 0.1), (Y_ESP, -1.2), (Y_ESP + 2.6, 0.1)]).close()
                      .extrude(6).translate((X_BERCO - 1, 0, z_cabo - 2.2 + 1.2)))
    b = b.union(berco)
    # o nome, em relevo
    b = b.union(cq.Workplane('XY').workplane(offset=T).center(82.0, -2.5)
                .text('C2 v1', 5.0, 0.6, font='Arial', kind='bold', halign='center', valign='center'))
    # furos e rasgos
    for xo in ORELHAS_X:
        b = b.cut(cilindro(xo, 0, -1, T + 1, 4.3))
    b = amarra(b, X_BERCO, Y_ESP, 5.0)
    b = amarra(b, X_AMARRA_FIOS, Y_AMARRA_FIOS, 3.0)
    return b


def placa_esp():
    return {nome: aqui(peca) for nome, peca in c1.placa_esp().items()}


def placa_mod():
    """Maqueta da plaquinha no sítio: o chip e os pinos para cima, as soldas e a ponte para baixo."""
    z0 = T + H_MOD
    z1 = z0 + MOD_ESP
    pcb = caixa(X_MOD0, X_MOD0 + MOD_X, Y_MOD - MOD_Y / 2, Y_MOD + MOD_Y / 2, z0, z1)
    for x, y in furos_mod():
        pcb = pcb.cut(cilindro(x, y, z0 - 1, z1 + 1, MOD_FURO))
    xp = X_PINOS_MOD
    cima = caixa(xp - 1.27, xp + 1.27, Y_MOD - 7.62, Y_MOD + 7.62, z1, z1 + 2.5)                    # régua dos pinos
    cima = cima.union(caixa(xp - 0.32, xp + 0.32, Y_MOD - 7.62, Y_MOD + 7.62, z1 + 2.5, z1 + 8.5))  # pinos
    cima = cima.union(caixa(X_FUROS_MOD + 3.0, X_FUROS_MOD + 7.0, Y_MOD - 2.5, Y_MOD + 2.5, z1, z1 + 1.6))  # o chip
    fichas = caixa(xp - 1.27, xp + 1.27, Y_MOD - 7.62, Y_MOD + 7.62, z1 + 2.5, z1 + 16.5)          # fichas dos fios
    # por baixo: as soldas dos seis pinos e a ponte de fio (sai 12 mm para lá do bordo dos pinos)
    baixo = caixa(xp - 0.9, xp + 0.9, Y_MOD - 7.25, Y_MOD + 7.25, z0 - 1.5, z0)
    baixo = baixo.union(caixa(xp, X_MOD0 + MOD_X + 12.0, Y_MOD - 7.6, Y_MOD - 0.5, z0 - 2.0, z0))
    return {'pcb': pcb, 'cima': cima, 'fichas': fichas, 'baixo': baixo}


def main():
    saida = sys.argv[1]
    soltas = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(saida, exist_ok=True)
    b = base()
    esp, mod = placa_esp(), placa_mod()

    cx = b.val().BoundingBox()
    print(f'base: {cx.xlen:.1f} x {cx.ylen:.1f} x {cx.zlen:.1f} mm, {b.val().Volume() / 1000:.1f} cm3 de plástico maciço')
    print(f'ESP32: de x={X_ESP0:.2f} a {X_ESP1:.2f}, eixo em y={Y_ESP}; face de baixo a {H_ESP} mm do fundo')
    print(f'plaquinha: de x={X_MOD0:.2f} a {X_MOD0 + MOD_X:.2f}, eixo em y={Y_MOD}; furos em x={X_FUROS_MOD:.2f}, '
          f'y={Y_MOD - MOD_FUROS / 2:.2f} e {Y_MOD + MOD_FUROS / 2:.2f}; pinos em x={X_PINOS_MOD:.2f}; face de baixo a {H_MOD} mm do fundo')

    # --- verificações: nada pode bater em nada -----------------------------------------------------
    falhas = 0
    pares = [('placa do ESP32', esp['pcb']), ('peças de baixo do ESP32', esp['baixo']), ('pinos do ESP32', esp['reguas']),
             ('fichas dos fios no ESP32', esp['fichas']), ('ficha do cabo USB', esp['usb']), ('plaquinha', mod['pcb']),
             ('peças de cima da plaquinha', mod['cima']), ('fichas dos fios na plaquinha', mod['fichas']),
             ('soldas e ponte da plaquinha', mod['baixo'])]
    for nome, peca in pares:
        v = volume(b, peca)
        if v > 1e-4:
            falhas += 1
            print(f'  BATE: a base com {nome}: {v:.3f} mm3')
    do_esp = [esp[k] for k in ('pcb', 'baixo', 'reguas', 'fichas', 'usb')]
    for nome, peca in (('plaquinha', mod['pcb']), ('peças de cima da plaquinha', mod['cima']),
                       ('fichas dos fios na plaquinha', mod['fichas']), ('soldas e ponte da plaquinha', mod['baixo'])):
        v = sum(volume(peca, e) for e in do_esp)
        if v > 1e-4:
            falhas += 1
            print(f'  BATE: {nome} com o ESP32 ou a ficha USB dele: {v:.3f} mm3')
    # as placas têm de pousar: a face de baixo de cada uma toca nos assentos (área de contacto)
    for nome, peca, minimo in (('ESP32', esp['pcb'], 8), ('plaquinha', mod['pcb'], 12)):
        fatia = b.intersect(peca.translate((0, 0, -0.05)))          # a placa descida 0,05 mm
        area = fatia.val().Volume() / 0.05
        print(f'  {nome}: pousa em {area:.1f} mm2 de assento')
        if area < minimo:
            falhas += 1
            print(f'  FALHA: {nome} quase não tem onde pousar')
    folga_y = W / 2 - LABIO_RECUO - LABIO_ESP
    print(f'folga do espigão nos furos: ESP32 {(c1.ESP_FURO - c1.ESPIGAO_ESP) / 2:.2f} mm de cada lado; plaquinha {(MOD_FURO - ESPIGAO_MOD) / 2:.2f} mm')
    print(f'os espigões da plaquinha servem para furos entre {MOD_FUROS - (MOD_FURO - ESPIGAO_MOD):.1f} e {MOD_FUROS + (MOD_FURO - ESPIGAO_MOD):.1f} mm de distância')
    print(f'do ESP32 ao rebordo: {folga_y - (Y_ESP + c1.ESP_LARG / 2):.2f} mm; da plaquinha ao rebordo: {folga_y + (Y_MOD - MOD_Y / 2):.2f} mm; '
          f'da plaquinha ao ESP32, ao comprido: {X_MOD0 - X_ESP1:.2f} mm')
    print(f'da ponte da plaquinha ao rebordo da ponta: {L - LABIO_RECUO - LABIO_ESP - (X_MOD0 + MOD_X + 12.0):.2f} mm')
    print('VERIFICAÇÃO: ' + ('tudo livre' if falhas == 0 else f'{falhas} problema(s)'))

    cq.exporters.export(b, os.path.join(saida, 'caixa2-base.step'))
    cq.exporters.export(b, os.path.join(saida, 'caixa2-base.stl'), tolerance=0.02, angularTolerance=0.2)
    if soltas:
        os.makedirs(soltas, exist_ok=True)
        tudo = {'base': b, 'esp_pcb': esp['pcb'], 'esp_baixo': esp['baixo'], 'esp_reguas': esp['reguas'], 'esp_usb': esp['usb'],
                'mod_pcb': mod['pcb'], 'mod_cima': mod['cima'], 'mod_baixo': mod['baixo']}
        for nome, peca in tudo.items():
            cq.exporters.export(peca, os.path.join(soltas, nome + '.stl'), tolerance=0.02, angularTolerance=0.2)
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
