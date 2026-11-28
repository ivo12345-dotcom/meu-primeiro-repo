# A soldadura da fila dos 3,3 V e da massa da caixa 1, em quatro cartões para ter ao lado enquanto se
# solda: as peças, os fios, as pontes por baixo e o multímetro. A parte direita da placa (do J ao X) vem em
# grande, e cada furo que conta tem o nome escrito dentro do círculo.
#
#   python -X utf8 caixa1_fila_passos.py <pasta de saída>
#
# Não tem montagem própria: os furos, as pontes e a conferência do circuito são os do caixa1_fila.py. Se
# a montagem de lá mudar, estes cartões mudam com ela; se deixar de dar o circuito, não se desenha nada.
import os
import sys

from PIL import Image, ImageDraw

import caixa1_fila as m
from vento_plaquinha import CINZA, FUNDO, LARANJA, LETRAS, OURO, TINTA, VERDE_PLACA, W, fonte, furo, nome_do, partir

PZ = 78                                                   # de um furo ao vizinho, em pixels
C0, C1, F0, F1 = furo('J1')[0], furo('X1')[0], 1, 10      # o que se mostra: colunas J a X, filas 1 a 10
PERNA, ESCURO, NAO = (200, 200, 205), (70, 70, 75), (205, 45, 45)
PECA_VIVA = (m.BEGE, m.BEGE_ORLA, TINTA)
PECA_FEITA = ((226, 208, 180), (150, 130, 100), (70, 60, 45))
PECA_VELHA = (m.APAGADO_CORPO, m.APAGADO, (70, 74, 70))
NOME_DO_FIO = {'fio SENSOR VIN': 'SENSOR VIN', 'fio SENSOR GND': 'SENSOR GND', 'fio RODA 1': 'RODA',
               'fio RODA 2': 'RODA', 'fio D27': 'D27'}
assert set(NOME_DO_FIO) == set(m.COR), 'os fios novos não são os do caixa1_fila.py'


class Zoom:
    """A parte direita da placa, em grande. espelho=True é a face das soldas (a placa virada como uma página)."""

    def __init__(self, espelho=False, topo=124, fundo=76):
        self.espelho = espelho
        self.x0 = 92 if espelho else 56
        self.y0 = topo
        larg, alto = (C1 - C0) * PZ, (F1 - F0) * PZ
        self.im = Image.new('RGB', (W, topo + alto + fundo), FUNDO)
        self.d = d = ImageDraw.Draw(self.im)
        # a placa continua para o lado do A: sai da imagem por aí
        xa, xb = (self.x0 - 52, W + 40) if espelho else (-40, self.x0 + larg + 52)
        d.rounded_rectangle([xa, topo - 96, xb, topo + alto + 52], radius=18, fill=VERDE_PLACA)
        for c in range(C0, C1 + 1):
            x, _ = self.xy(c, F0)
            d.text((x, topo - 58), LETRAS[c - 1], font=fonte(33), fill=(235, 240, 200), anchor='mm')
            for r in range(F0, F1 + 1):
                self.furo(c, r)
        xn = (xa - 22) if espelho else (xb + 20)
        for r in range(F0, F1 + 1):
            d.text((xn, topo + (r - F0) * PZ), str(r), font=fonte(26), fill=TINTA, anchor='mm')

    def xy(self, c, r):
        i = (C1 - c) if self.espelho else (c - C0)
        return self.x0 + i * PZ, self.y0 + (r - F0) * PZ

    def furo(self, c, r):
        x, y = self.xy(c, r)
        self.d.ellipse([x - 17, y - 17, x + 17, y + 17], fill=OURO)
        self.d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(20, 60, 35))

    def perna(self, c, r, cor=PERNA, raio=11):
        x, y = self.xy(c, r)
        self.d.ellipse([x - raio, y - raio, x + raio, y + raio], fill=cor, outline=(255, 255, 255), width=3)

    def nomeado(self, c, r, fundo=(255, 255, 255), tinta=TINTA, orla=(40, 40, 40), raio=25):
        """O furo com o nome dele escrito dentro: é aqui que entra a perna ou o fio."""
        x, y = self.xy(c, r)
        self.d.ellipse([x - raio, y - raio, x + raio, y + raio], fill=fundo, outline=orla, width=4)
        texto, tam = nome_do(c, r), 25
        while self.d.textlength(texto, font=fonte(tam)) > 2 * raio - 13:
            tam -= 1
        self.d.text((x, y), texto, font=fonte(tam), fill=tinta, anchor='mm')

    def rodado(self, x, y, texto, f, tinta):
        l, t, r, b = self.d.textbbox((0, 0), texto, font=f)
        letras = Image.new('RGBA', (r - l + 4, b - t + 4), (0, 0, 0, 0))
        ImageDraw.Draw(letras).text((2 - l, 2 - t), texto, font=f, fill=tinta)
        letras = letras.rotate(90, expand=True)
        self.im.paste(letras, (round(x - letras.width / 2), round(y - letras.height / 2)), letras)

    def resistencia(self, a, b, texto, cores=PECA_VIVA):
        """Deitada ao longo de uma coluna ou de uma fila, com o valor escrito no corpo."""
        (xa, ya), (xb, yb) = self.xy(*a), self.xy(*b)
        self.d.line([(xa, ya), (xb, yb)], fill=PERNA, width=7)
        xm, ym, comprido, largo = (xa + xb) / 2, (ya + yb) / 2, 176, 50
        if xa == xb:
            self.d.rounded_rectangle([xm - largo / 2, ym - comprido / 2, xm + largo / 2, ym + comprido / 2], radius=16, fill=cores[0], outline=cores[1], width=4)
            self.rodado(xm, ym, texto, fonte(29), cores[2])
        else:
            self.d.rounded_rectangle([xm - comprido / 2, ym - largo / 2, xm + comprido / 2, ym + largo / 2], radius=16, fill=cores[0], outline=cores[1], width=4)
            self.d.text((xm, ym), texto, font=fonte(29), fill=cores[2], anchor='mm')

    def condensador(self, a, b, texto, viva=True):
        (x, ya), (_, yb) = self.xy(*a), self.xy(*b)
        ym = (ya + yb) / 2
        self.d.line([(x, ya), (x, yb)], fill=PERNA, width=7)
        cor, orla = (m.AZUL_PECA, m.AZUL_ORLA) if viva else ((150, 185, 225), (90, 120, 165))
        self.d.ellipse([x - 27, ym - 54, x + 27, ym + 54], fill=cor, outline=orla, width=4)
        self.rodado(x, ym, texto, fonte(27), (255, 255, 255))

    def numero(self, x, y, texto, cor=ESCURO, raio=27):
        self.d.ellipse([x - raio, y - raio, x + raio, y + raio], fill=cor, outline=(255, 255, 255), width=4)
        self.d.text((x, y), texto, font=fonte(31), fill=(255, 255, 255), anchor='mm')

    def pastilha(self, x, y, texto, ancora='mm', tam=23, negrito=False, tinta=(236, 240, 228), fundo=(26, 96, 56)):
        f = fonte(tam, negrito)
        l, t, r, b = self.d.textbbox((x, y), texto, font=f, anchor=ancora)
        self.d.rounded_rectangle([l - 9, t - 6, r + 9, b + 6], radius=10, fill=fundo)
        self.d.text((x, y), texto, font=f, fill=tinta, anchor=ancora)

    def rotulo(self, c, r, texto, cor, cx, cy, raio=25, tam=30):
        """Etiqueta com o centro em (cx, cy) e um traço até à beira do círculo do furo."""
        x, y = self.xy(c, r)
        f = fonte(tam)
        l, t, rr, b = self.d.textbbox((cx, cy), texto, font=f, anchor='mm')
        assert l - 14 >= 4 and rr + 14 <= W - 4 and t - 10 >= 0 and b + 10 <= self.im.height, f'a etiqueta "{texto}" sai da imagem'
        alvo = (min(max(x, l), rr), min(max(y, t), b))
        self.d.line([(x, y), alvo], fill=(255, 255, 255), width=9)
        self.d.line([(x, y), alvo], fill=cor, width=5)
        self.d.rounded_rectangle([l - 14, t - 10, rr + 14, b + 10], radius=12, fill=cor, outline=(255, 255, 255), width=3)
        self.d.text((cx, cy), texto, font=f, fill=(255, 255, 255), anchor='mm')

    def capsula(self, furos, cor, largura):
        """Uma tira de solda que apanha os furos dados, de vizinho em vizinho."""
        pontos = [self.xy(*f) for f in furos]
        for (xa, ya), (xb, yb) in zip(pontos, pontos[1:]):
            self.d.line([(xa, ya), (xb, yb)], fill=cor, width=largura)
        for x, y in pontos:
            self.d.ellipse([x - largura / 2, y - largura / 2, x + largura / 2, y + largura / 2], fill=cor)

    def cruz(self, x, y, braco=13):
        for largura, cor in ((13, (255, 255, 255)), (7, NAO)):
            self.d.line([(x - braco, y - braco), (x + braco, y + braco)], fill=cor, width=largura)
            self.d.line([(x - braco, y + braco), (x + braco, y - braco)], fill=cor, width=largura)


def a_vista(f):
    return C0 <= f[0] <= C1 and F0 <= f[1] <= F1


def o_que_ja_esta(z):
    """Lado das peças: o suporte e a resistência de 2,2 kΩ a cinzento, e os três fios que servem de guia."""
    d, P = z.d, m.PERNAS
    (xa, ya), (xb, yb) = z.xy(*furo('J3')), z.xy(*furo('M6'))
    d.rounded_rectangle([xa - 34, ya - 40, xb + 34, yb + 40], radius=10, fill=(82, 86, 84), outline=(60, 62, 60), width=3)
    for i in range(1, 9):
        z.perna(*P[f'SUP{i}'], cor=m.APAGADO)
    (x1, y1), (x2, y2) = z.xy(*furo('J3')), z.xy(*furo('M4'))
    d.rounded_rectangle([x1 + 22, y1 - 30, x2 - 22, y2 + 30], radius=8, fill=(62, 64, 64), outline=m.APAGADO, width=2)
    d.text(((x1 + x2) / 2, (y1 + y2) / 2), 'PC817', font=fonte(29), fill=(205, 208, 205), anchor='mm')
    z.resistencia(P['R2 a'], P['R2 b'], '2,2 kΩ', PECA_VELHA)
    z.perna(*P['R2 a'], cor=m.APAGADO); z.perna(*P['R2 b'], cor=m.APAGADO)
    for nome in ('fio AMARELO', 'fio VERDE', 'fio VERDE COM FITA'):
        x, y = z.xy(*P[nome])
        d.ellipse([x - 17, y - 17, x + 17, y + 17], fill=m.COR_JA[nome], outline=(255, 255, 255), width=4)
    x, y = z.xy(*P['fio AMARELO']); z.pastilha(x, y - 46, 'fio amarelo')
    x, y = z.xy(*P['fio VERDE']); z.pastilha(x + 30, y, 'fio verde sem fita', 'lm')
    x, y = z.xy(*P['fio VERDE COM FITA']); z.pastilha(x - 44, y - 46, 'fio verde com fita')


def as_pecas(z, vivas):
    P = m.PERNAS
    cores = PECA_VIVA if vivas else PECA_FEITA
    z.resistencia(P['R4 a'], P['R4 b'], '10 kΩ', cores)
    z.resistencia(P['R3 a'], P['R3 b'], '1 kΩ', cores)
    z.resistencia(P['R5 a'], P['R5 b'], '1 kΩ', cores)
    z.condensador(P['C1 a'], P['C1 b'], '104', vivas)
    for nome in ('R3 a', 'R3 b', 'R4 a', 'R4 b', 'R5 a', 'R5 b', 'C1 a', 'C1 b'):
        if vivas:
            z.nomeado(*P[nome])
        else:
            z.perna(*P[nome])


def desenho_das_pecas():
    z = Zoom()
    o_que_ja_esta(z)
    as_pecas(z, True)
    P = m.PERNAS
    meio = lambda a, b: tuple((p + q) / 2 for p, q in zip(z.xy(*P[a]), z.xy(*P[b])))
    x, y = meio('R4 a', 'R4 b'); z.numero(x - 62, y, '1')
    x, y = meio('R3 a', 'R3 b'); z.numero(x + 62, y, '2')
    x, y = meio('R5 a', 'R5 b'); z.numero(x, y - 62, '3')
    x, y = meio('C1 a', 'C1 b'); z.numero(x + 64, y, '4')
    return z.im


def desenho_dos_fios():
    z = Zoom(fundo=128)
    o_que_ja_esta(z)
    as_pecas(z, False)
    P, cor = m.PERNAS, m.COR
    _, y10 = z.xy(C0, 10)
    sitio = {
        'fio SENSOR VIN': (z.xy(*furo('V1'))[0] + 6, z.xy(*furo('V1'))[1] + 40),
        'fio SENSOR GND': (z.xy(*furo('L8'))[0], z.xy(*furo('L8'))[1]),
        'fio RODA 1': (z.xy(*furo('R7'))[0] + 16, z.xy(*furo('R7'))[1] - 2),
        'fio RODA 2': (z.xy(*P['fio RODA 2'])[0], y10 + 84),
        'fio D27': (z.xy(*P['fio D27'])[0], y10 + 84),
    }
    for nome in sitio:                        # primeiro os traços e as etiquetas, depois os círculos por cima
        z.rotulo(*P[nome], NOME_DO_FIO[nome], cor[nome], *sitio[nome])
    for nome in sitio:
        z.nomeado(*P[nome], fundo=cor[nome], tinta=(255, 255, 255), orla=(255, 255, 255))
    return z.im


# as tiras de solda novas, pela ordem em que vêm na lista do cartão; cada uma é um caminho de vizinho em vizinho
TIRAS = [['T3', 'U3', 'V3'], ['N4', 'N5', 'O5', 'P5'], ['T7', 'U7'], ['O9', 'P9', 'Q9', 'R9'], ['V9', 'W9']]


def conferir_tiras():
    """As tiras desenhadas são, nem mais nem menos, as pontes novas do caixa1_fila.py."""
    das_tiras = {frozenset((furo(a), furo(b))) for t in TIRAS for a, b in zip(t, t[1:])}
    assert das_tiras == {frozenset(p) for p in m.PONTES_NOVAS}, 'as tiras do cartão não são as pontes novas'


def desenho_das_soldas():
    z = Zoom(espelho=True, fundo=112)
    for a, b in m.PONTES_JA:
        if a_vista(a) or a_vista(b):
            (xa, ya), (xb, yb) = z.xy(*a), z.xy(*b)
            z.d.line([(xa, ya), (xb, yb)], fill=m.PONTE_VELHA, width=30)
    for tira in TIRAS:
        z.capsula([furo(f) for f in tira], (255, 255, 255), 74)
    for tira in TIRAS:
        z.capsula([furo(f) for f in tira], LARANJA, 64)
    for nome, f in m.JA_ESTA.items():
        if a_vista(f) and nome_do(*f) not in sum(TIRAS, []):
            z.perna(*f, cor=m.APAGADO)
    for tira in TIRAS:
        for f in tira:
            z.nomeado(*furo(f), raio=23)
    # o número de cada tira, ao lado dela
    x, y = z.xy(*furo('U2')); z.numero(x, y - 6, '1', LARANJA)
    x, y = z.xy(*furo('O6')); z.numero(x, y + 4, '2', LARANJA)
    x, y = z.xy(*furo('V7')); z.numero(x + 4, y, '3', LARANJA)
    x, y = z.xy(*furo('P10')); z.numero(x + PZ / 2, y + 6, '4', LARANJA)
    x, y = z.xy(*furo('V10')); z.numero(x + PZ / 2, y + 6, '5', LARANJA)
    # o que nunca se junta
    (xa, ya), (_, yb) = z.xy(*furo('N3')), z.xy(*furo('N4'))
    z.cruz(xa, ya + 30)
    x, y = z.xy(*furo('T9')); z.cruz(x, y, 15)
    f = fonte(24, False)
    z.d.text((z.x0 - 40, z.im.height - 28), 'lado da CAIXA 1', font=f, fill=CINZA, anchor='lm')
    z.d.text((W - 24, z.im.height - 28), 'a placa continua para lá do J', font=f, fill=CINZA, anchor='rm')
    return z.im


def cabecalho(titulo, nota):
    f_t, f_n = fonte(44), fonte(29, False)
    tmp = ImageDraw.Draw(Image.new('RGB', (W, 10)))
    linhas = partir(tmp, nota, f_n, W - 56)
    im = Image.new('RGB', (W, 84 + len(linhas) * 39 + 14), FUNDO)
    d = ImageDraw.Draw(im)
    d.text((28, 18), titulo, font=f_t, fill=TINTA)
    for i, ln in enumerate(linhas):
        d.text((28, 84 + i * 39), ln, font=f_n, fill=CINZA)
    return im


def lista(itens):
    """Linhas com uma marca redonda à esquerda: (marca, cor, texto)."""
    f_l, f_m = fonte(33, False), fonte(29)
    tmp = ImageDraw.Draw(Image.new('RGB', (W, 10)))
    margem, raio, y, ops = 28, 25, 16, []
    for marca, cor, texto in itens:
        linhas = partir(tmp, texto, f_l, W - 2 * margem - 2 * raio - 22)
        ops.append((y, marca, cor, linhas))
        y += max(len(linhas) * 43, 2 * raio) + 16
    im = Image.new('RGB', (W, y + 12), FUNDO)
    d = ImageDraw.Draw(im)
    for yy, marca, cor, linhas in ops:
        cx, cy = margem + raio, yy + raio
        d.ellipse([cx - raio, cy - raio, cx + raio, cy + raio], fill=cor)
        d.text((cx, cy), marca, font=f_m, fill=(255, 255, 255), anchor='mm')
        for i, ln in enumerate(linhas):
            d.text((margem + 2 * raio + 22, yy + 3 + i * 43), ln, font=f_l, fill=TINTA)
    return im


def empilhar(partes):
    im = Image.new('RGB', (W, sum(p.height for p in partes)), FUNDO)
    y = 0
    for p in partes:
        im.paste(p, (0, y)); y += p.height
    return im


def main(pasta):
    m.conferir()
    conferir_tiras()
    n = {k: nome_do(*v) for k, v in m.PERNAS.items()}
    C, L, cor = ESCURO, LARANJA, m.COR
    cartoes = {
        'caixa1-fila-passo-1-pecas.jpg': [
            cabecalho('1 de 4 · As quatro peças', (
                'Lado das peças, com a placa como na tua foto: o suporte preto lá ao fundo, o X à direita. Só se '
                'mostra do J ao X. Cada círculo branco tem o nome do furo onde entra a perna.')),
            desenho_das_pecas(),
            lista([
                ('1', C, f"Resistência de 10 kΩ (saco 10K): uma perna no {n['R4 a']}, a outra no {n['R4 b']}."),
                ('2', C, f"Resistência de 1 kΩ (saco 1K): uma perna no {n['R3 a']}, a outra no {n['R3 b']}."),
                ('3', C, f"Outra resistência de 1 kΩ: uma perna no {n['R5 a']}, a outra no {n['R5 b']}."),
                ('4', C, f"Condensador de 100 nF (tem 104 escrito): abre-lhe as pernas, uma no {n['C1 a']}, a outra "
                         f"no {n['C1 b']}. Não tem lado certo."),
                ('→', L, 'Vira a placa, solda as 8 pernas e corta as pontas. Guarda as pontas cortadas: dão jeito '
                         'no passo 3.'),
            ])],
        'caixa1-fila-passo-2-fios.jpg': [
            cabecalho('2 de 4 · Os cinco fios', (
                'O mesmo lado. Fios com pino numa ponta e encaixe na outra, como os que já lá estão: o pino entra '
                'no furo e solda-se por baixo; o encaixe fica solto. O círculo a cores tem o nome do furo.')),
            desenho_dos_fios(),
            lista([
                ('1', cor['fio SENSOR VIN'], f"SENSOR VIN: no {n['fio SENSOR VIN']}, dois furos à direita do fio verde com fita."),
                ('2', cor['fio SENSOR GND'], f"SENSOR GND: no {n['fio SENSOR GND']}, logo abaixo do fio verde sem fita."),
                ('3', cor['fio RODA 1'], f"RODA: um fio no {n['fio RODA 1']} e outro no {n['fio RODA 2']}."),
                ('4', cor['fio D27'], f"D27: no {n['fio D27']}."),
                ('→', L, 'Aponta a cor que deste a cada fio: vou perguntar-ta.'),
            ])],
        'caixa1-fila-passo-3-soldas.jpg': [
            cabecalho('3 de 4 · Por baixo: juntar com solda', (
                'A placa virada como uma página: o X fica à esquerda. A laranja, os furos que se juntam agora uns '
                'aos outros; a claro, o que já está junto.')),
            desenho_das_soldas(),
            lista([
                ('1', L, 'Fila 3: T3 com U3 com V3.'),
                ('2', L, 'Fila 5: N5 com O5 com P5. E o N5 com o N4, que fica logo acima: é a única ponte de uma fila para a outra.'),
                ('3', L, 'Fila 7: T7 com U7.'),
                ('4', L, 'Fila 9: O9 com P9 com Q9 com R9.'),
                ('5', L, 'Fila 9, à parte: V9 com W9.'),
                ('×', NAO, 'Nunca: o N4 com o N3, que fica acima dele; o R9 com o V9 (entre eles só passa a resistência).'),
                ('→', C, 'Truque: uma ponta de perna cortada, deitada por cima dos furos da tira e soldada em cada um.'),
            ])],
        'caixa1-fila-passo-4-multimetro.jpg': [
            cabecalho('4 de 4 · Conferir com o multímetro', (
                'Com a plaquinha ainda solta, sem estar ligada a nada. Mede-se nas pontas dos fios.')),
            lista([
                ('A', (34, 150, 60), 'No apito, TEM de apitar: o fio verde com fita com o fio SENSOR VIN; o fio verde sem '
                                     'fita com o fio SENSOR GND.'),
                ('B', NAO, 'No apito, NÃO pode apitar: o verde com fita com o verde sem fita; os dois fios RODA um com o '
                           'outro; o azul ou o branco com qualquer outro fio.'),
                ('C', C, f"Em ohms: do verde com fita ao fio RODA do {n['fio RODA 1']} dá 1 kΩ; do fio RODA do "
                         f"{n['fio RODA 2']} ao fio D27 dá 1 kΩ; do fio RODA do {n['fio RODA 2']} ao verde sem fita dá 10 kΩ."),
                ('→', L, 'Se der tudo certo, diz-me "soldado" e as cores dos cinco fios.'),
            ])],
    }
    os.makedirs(pasta, exist_ok=True)
    for nome, partes in cartoes.items():
        im = empilhar(partes)
        im.save(os.path.join(pasta, nome), quality=90)
        print('feito', nome, im.size)


if __name__ == '__main__':
    main(sys.argv[1])
