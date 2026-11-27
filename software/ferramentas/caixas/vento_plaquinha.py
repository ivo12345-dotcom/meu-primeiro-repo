# Desenho de montagem da plaquinha do vento: o optoacoplador PC817 entre a ficha do mostrador NASA e a
# entrada RX2 da caixa 1 (ver o desenho, "Adaptação escolhida").
#
#   python -X utf8 vento_plaquinha.py <saida.jpg>
#
# A placa é a de 5 x 7 cm do Ivo: 24 colunas com letras (A a X) e as filas contadas a partir da beira
# das letras. O suporte de 8 pinos já está soldado em J3-J6 e M3-M6, com o entalhe para a fila 2.
#
# Antes de desenhar, confere a montagem: junta os furos pelas pontes de solda e compara com as ligações
# que o circuito tem de ter. Se alguma ponte estiver a mais ou a menos, não desenha nada.
import sys

from PIL import Image, ImageDraw, ImageFont

LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWX'


def furo(nome):
    """'D3' -> (4, 3): a coluna pela letra, a fila pelo número."""
    return LETRAS.index(nome[0]) + 1, int(nome[1:])


def nome_do(c, r):
    return f'{LETRAS[c - 1]}{r}'


# ---- a montagem: o furo de cada perna, visto do lado das peças ----------------------------------------
PERNAS = {k: furo(v) for k, v in {
    'fio AMARELO': 'C3',
    'R1 a': 'D3', 'R1 b': 'H3',
    'D1 cátodo': 'I3', 'D1 ânodo': 'I4',
    'fio VERDE': 'H4',
    'S1': 'J3', 'S2': 'J4', 'S3': 'J5', 'S4': 'J6',
    'S5': 'M6', 'S6': 'M5', 'S7': 'M4', 'S8': 'M3',
    'fio RX2': 'N3', 'fio GND': 'N4',
    'R2 a': 'O3', 'R2 b': 'S3',
    'fio 3V3': 'T3',
}.items()}
# pontes de solda por baixo, sempre entre furos vizinhos da mesma fila
PONTES = [(furo(a), furo(b)) for a, b in (
    ('C3', 'D3'), ('H3', 'I3'), ('I3', 'J3'), ('M3', 'N3'), ('N3', 'O3'), ('S3', 'T3'),
    ('H4', 'I4'), ('I4', 'J4'), ('M4', 'N4'))]
# o que o circuito pede (o PC817 fica nos 4 contactos de cima do suporte: 1 = S1, 2 = S2, 3 = S7, 4 = S8)
LIGACOES = [
    {'fio AMARELO', 'R1 a'},                 # o amarelo entra na resistência de 1 kΩ
    {'R1 b', 'D1 cátodo', 'S1'},             # resistência, risca do díodo e pino 1 do PC817 (ânodo)
    {'fio VERDE', 'D1 ânodo', 'S2'},         # massa do mostrador, díodo e pino 2 (cátodo)
    {'S8', 'fio RX2', 'R2 a'},               # pino 4 (coletor): RX2 e a resistência de 2,2 kΩ
    {'S7', 'fio GND'},                       # pino 3 (emissor): massa da placa
    {'R2 b', 'fio 3V3'},                     # a outra ponta dos 2,2 kΩ aos 3,3 V
    {'S3'}, {'S4'}, {'S5'}, {'S6'},          # a metade vazia do suporte não se liga a nada
]


def conferir():
    dono = {v: k for k, v in PERNAS.items()}
    assert len(dono) == len(PERNAS), 'duas pernas no mesmo furo'
    pai = {k: k for k in PERNAS}

    def raiz(a):
        while pai[a] != a:
            a = pai[a]
        return a

    for a, b in PONTES:
        assert a in dono and b in dono, f'ponte para um furo sem perna: {a} {b}'
        assert a[1] == b[1] and abs(a[0] - b[0]) == 1, f'ponte que não é entre vizinhos da mesma fila: {a} {b}'
        pai[raiz(dono[a])] = raiz(dono[b])
    grupos = {}
    for k in PERNAS:
        grupos.setdefault(raiz(k), set()).add(k)
    feito = sorted(sorted(g) for g in grupos.values())
    pedido = sorted(sorted(g) for g in LIGACOES)
    assert feito == pedido, f'a montagem não dá o circuito:\n feito  {feito}\n pedido {pedido}'


# ---- o desenho -----------------------------------------------------------------------------------------
W, P, X0 = 1240, 48, 70
FUNDO, TINTA, CINZA = (246, 245, 241), (28, 28, 28), (90, 90, 90)
VERDE_PLACA, OURO, LARANJA = (34, 120, 70), (222, 190, 90), (240, 120, 20)
COR_FIO = {'fio AMARELO': (240, 200, 30), 'fio VERDE': (30, 160, 70), 'fio RX2': (40, 110, 220),
           'fio GND': (20, 20, 20), 'fio 3V3': (210, 45, 45)}


def fonte(tam, negrito=True):
    for nome in (('segoeuib.ttf' if negrito else 'segoeui.ttf'), 'DejaVuSans-Bold.ttf' if negrito else 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(('C:/Windows/Fonts/' + nome) if nome.startswith('segoe') else nome, tam)
        except OSError:
            continue
    return ImageFont.load_default()


def partir(d, texto, f, largura):
    linhas, atual = [], ''
    for palavra in texto.split(' '):
        tenta = (atual + ' ' + palavra).strip()
        if d.textlength(tenta, font=f) <= largura:
            atual = tenta
        else:
            linhas.append(atual)
            atual = palavra
    linhas.append(atual)
    return linhas


def bloco(titulo, itens, nota=None):
    f_t, f_n, f_l, f_m = fonte(40), fonte(28, False), fonte(31, False), fonte(28)
    tmp = ImageDraw.Draw(Image.new('RGB', (W, 10)))
    margem, raio, y, ops = 28, 23, 20, []
    ops.append(('t', y, titulo)); y += 56
    if nota:
        for ln in partir(tmp, nota, f_n, W - 2 * margem):
            ops.append(('n', y, ln)); y += 37
        y += 8
    for marca, cor, texto in itens:
        linhas = partir(tmp, texto, f_l, W - 2 * margem - 2 * raio - 20)
        ops.append(('m', y, marca, cor, linhas))
        y += max(len(linhas) * 40, 2 * raio) + 12
    im = Image.new('RGB', (W, y + 8), FUNDO)
    d = ImageDraw.Draw(im)
    for op in ops:
        if op[0] == 't':
            d.text((margem, op[1]), op[2], font=f_t, fill=TINTA)
        elif op[0] == 'n':
            d.text((margem, op[1]), op[2], font=f_n, fill=CINZA)
        else:
            _, yy, marca, cor, linhas = op
            cx, cy = margem + raio, yy + raio
            d.ellipse([cx - raio, cy - raio, cx + raio, cy + raio], fill=cor)
            d.text((cx, cy), marca, font=f_m, fill=(255, 255, 255), anchor='mm')
            for i, ln in enumerate(linhas):
                d.text((margem + 2 * raio + 20, yy + 2 + i * 40), ln, font=f_l, fill=TINTA)
    return im


class Placa:
    """A placa vista de um lado. espelho=True é a face das soldas (a placa virada como uma página)."""

    def __init__(self, filas=(1, 8), espelho=False, topo=150, fundo=120):
        self.f0, self.f1 = filas
        self.espelho = espelho
        self.y0 = topo
        self.im = Image.new('RGB', (W, topo + (self.f1 - self.f0) * P + fundo), FUNDO)
        self.d = ImageDraw.Draw(self.im)
        x_a, x_b = X0 - 34, X0 + 23 * P + 34
        self.d.rounded_rectangle([x_a, self.y0 - 70, x_b, self.y0 + (self.f1 - self.f0) * P + 34], radius=14, fill=VERDE_PLACA)
        f = fonte(27)
        for c in range(1, 25):
            x, _ = self.xy(c, self.f0)
            self.d.text((x, self.y0 - 42), LETRAS[c - 1], font=f, fill=(235, 240, 200), anchor='mm')
            for r in range(self.f0, self.f1 + 1):
                self.furo(c, r)
        for r in range(self.f0, self.f1 + 1):
            _, y = self.xy(1, r)
            self.d.text((x_a - 18, y), str(r), font=fonte(26), fill=TINTA, anchor='mm')

    def xy(self, coluna, fila):
        c = 25 - coluna if self.espelho else coluna
        return X0 + (c - 1) * P, self.y0 + (fila - self.f0) * P

    def furo(self, c, r):
        x, y = self.xy(c, r)
        self.d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=OURO)
        self.d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(20, 60, 35))

    def ponte(self, a, b):
        (xa, ya), (xb, yb) = self.xy(*a), self.xy(*b)
        self.d.line([(xa, ya), (xb, yb)], fill=(255, 255, 255), width=26)
        self.d.line([(xa, ya), (xb, yb)], fill=LARANJA, width=17)

    def perna(self, c, r, cor=(200, 200, 205)):
        x, y = self.xy(c, r)
        self.d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=cor, outline=(255, 255, 255), width=2)

    def resistencia(self, a, b, texto):
        (xa, y), (xb, _) = self.xy(*a), self.xy(*b)
        xa, xb = min(xa, xb), max(xa, xb)
        self.d.line([(xa, y), (xb, y)], fill=(190, 190, 195), width=5)
        self.d.rounded_rectangle([xa + 34, y - 19, xb - 34, y + 19], radius=13, fill=(214, 184, 140), outline=(120, 95, 60), width=3)
        self.d.text(((xa + xb) / 2, y), texto, font=fonte(23), fill=TINTA, anchor='mm')
        self.perna(*a); self.perna(*b)

    def etiqueta(self, c, r, texto, cor, dx, dy, tinta=(255, 255, 255)):
        x, y = self.xy(c, r)
        f = fonte(27)
        tx, ty = x + dx, y + dy
        l, t, rr, b = self.d.textbbox((tx, ty), texto, font=f, anchor='mm')
        alvo = (min(max(x, l), rr), t if ty > y else b)
        self.d.line([(x, y), alvo], fill=(255, 255, 255), width=7)
        self.d.line([(x, y), alvo], fill=cor, width=4)
        self.d.rounded_rectangle([l - 12, t - 8, rr + 12, b + 8], radius=10, fill=cor, outline=(255, 255, 255), width=3)
        self.d.text((tx, ty), texto, font=f, fill=tinta, anchor='mm')
        self.d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=cor, outline=(255, 255, 255), width=3)


def face_das_pecas():
    p = Placa()
    d = p.d
    for a, b in PONTES:                       # as pontes ficam por baixo: aqui só se mostra onde são
        p.ponte(a, b)
    # o suporte de 8 pinos, com o PC817 nos 4 contactos de cima
    (xa, ya), (xb, yb) = p.xy(*furo('J3')), p.xy(*furo('M6'))
    d.rounded_rectangle([xa - 22, ya - 26, xb + 22, yb + 26], radius=8, fill=(45, 45, 50), outline=(15, 15, 15), width=3)
    d.pieslice([(xa + xb) / 2 - 14, ya - 40, (xa + xb) / 2 + 14, ya - 12], 0, 180, fill=VERDE_PLACA)   # o entalhe
    for nome in ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'):
        p.perna(*PERNAS[nome])
    (x1, y1), (x2, y2) = p.xy(*furo('J3')), p.xy(*furo('M4'))
    d.rounded_rectangle([x1 + 13, y1 - 19, x2 - 13, y2 + 19], radius=6, fill=(20, 20, 22), outline=(130, 130, 135), width=3)
    d.ellipse([x1 + 20, y1 - 12, x1 + 36, y1 + 4], fill=(235, 235, 235))                               # a pinta
    d.text(((x1 + x2) / 2 + 8, (y1 + y2) / 2 + 2), 'PC817', font=fonte(22), fill=(235, 235, 235), anchor='mm')
    (x3, y3), (x4, y4) = p.xy(*furo('J5')), p.xy(*furo('M6'))
    d.text(((x3 + x4) / 2, (y3 + y4) / 2), 'vazio', font=fonte(21, False), fill=(170, 170, 175), anchor='mm')
    p.resistencia(PERNAS['R1 a'], PERNAS['R1 b'], '1 kΩ')
    p.resistencia(PERNAS['R2 a'], PERNAS['R2 b'], '2,2 kΩ')
    # o díodo em pé: o corpo no furo de baixo, a risca para cima, a perna de cima dobrada para o furo de cima
    (xk, yk), (xn, yn) = p.xy(*PERNAS['D1 cátodo']), p.xy(*PERNAS['D1 ânodo'])
    d.line([(xk, yk), (xn, yn)], fill=(190, 190, 195), width=5)
    p.perna(*PERNAS['D1 cátodo'])
    d.ellipse([xn - 17, yn - 17, xn + 17, yn + 17], fill=(15, 15, 15), outline=(225, 225, 225), width=4)
    # os cinco fios e o díodo, cada um com o nome do furo
    p.etiqueta(*PERNAS['fio AMARELO'], 'AMARELO  C3', COR_FIO['fio AMARELO'], -10, -P * 1.6, tinta=TINTA)
    p.etiqueta(*PERNAS['fio VERDE'], 'VERDE  H4', COR_FIO['fio VERDE'], -P * 2.4, P * 2.7)
    p.etiqueta(*PERNAS['D1 ânodo'], 'DÍODO em pé  I4 e I3', (95, 95, 95), -P * 1.2, P * 3.9)
    p.etiqueta(*PERNAS['fio RX2'], 'RX2  N3', COR_FIO['fio RX2'], P * 0.3, -P * 1.6)
    p.etiqueta(*PERNAS['fio GND'], 'GND  N4', COR_FIO['fio GND'], P * 2.2, P * 2.7)
    p.etiqueta(*PERNAS['fio 3V3'], '3V3  T3', COR_FIO['fio 3V3'], P * 0.6, -P * 1.6)
    f = fonte(24, False)
    d.text((X0 - 30, p.im.height - 38), 'lado do MOSTRADOR do vento', font=f, fill=CINZA, anchor='lm')
    d.text((X0 + 23 * P + 30, p.im.height - 38), 'lado da CAIXA 1', font=f, fill=CINZA, anchor='rm')
    return p.im


def face_das_soldas():
    p = Placa(filas=(2, 6), espelho=True, topo=130, fundo=50)
    for a, b in PONTES:
        p.ponte(a, b)
    for nome, (c, r) in PERNAS.items():
        p.perna(c, r, COR_FIO.get(nome, (200, 200, 205)))
    return p.im


def main(saida):
    conferir()
    C, L, FEITO = (70, 70, 75), LARANJA, (34, 150, 60)
    p = {k: nome_do(*v) for k, v in PERNAS.items()}
    topo = bloco('A tua placa, vista do lado das peças', [], nota=(
        'As letras são as da placa. As filas contam-se a partir da beira das letras: a fila 3 é a dos '
        'dois pinos de cima do suporte, a fila 4 a logo abaixo.'))
    passos = bloco('Por esta ordem', [
        ('0', FEITO, 'Já está: o suporte em J e M, filas 3 a 6, com o entalhe para cima.'),
        ('1', C, f"Resistência de 1 kΩ, deitada na fila 3: uma perna em {p['R1 a']}, a outra em {p['R1 b']}."),
        ('2', C, f"Resistência de 2,2 kΩ, deitada na fila 3: uma perna em {p['R2 a']}, a outra em {p['R2 b']}."),
        ('3', C, f"Díodo em pé: o corpo no furo {p['D1 ânodo']}, com a risca para CIMA; a perna de cima dobra-se "
                 f"e desce no furo {p['D1 cátodo']}."),
        ('4', C, f"Os cinco fios: AMARELO em {p['fio AMARELO']}, VERDE em {p['fio VERDE']}, RX2 em {p['fio RX2']}, "
                 f"GND em {p['fio GND']}, 3V3 em {p['fio 3V3']}."),
        ('5', L, 'Por baixo, juntar com solda (a laranja no desenho). Na fila 3: C com D; H com I com J; '
                 'M com N com O; S com T. Na fila 4: H com I com J; M com N. Mais nada.'),
        ('6', C, 'A fila 3 nunca toca na fila 4.'),
        ('7', C, 'Só no fim, o PC817 no suporte: em J3, J4, M3 e M4 (a metade de cima), com a pinta junto a J3.'),
    ])
    por_baixo = bloco('A mesma placa, vista por baixo (virada como uma página)', [], nota=(
        'As letras ficam ao contrário: o X à esquerda, o A à direita. A laranja, o que se junta com solda.'))
    conferencia = bloco('Antes de pôr o PC817: multímetro no apito', [
        ('A', (34, 150, 60), 'Tem de apitar: o fio VERDE com o pino J4; o fio RX2 com o pino M3; o fio GND com o pino M4.'),
        ('B', (205, 45, 45), 'Não pode apitar: RX2 com GND; RX2 com 3V3; AMARELO com VERDE; nem nenhum fio do '
                             'lado do mostrador com nenhum fio do lado da caixa 1.'),
        ('C', C, 'Em ohms: do fio AMARELO ao pino J3 dá 1 kΩ; do fio RX2 ao fio 3V3 dá 2,2 kΩ.'),
    ])
    partes = [topo, face_das_pecas(), passos, por_baixo, face_das_soldas(), conferencia]
    im = Image.new('RGB', (W, sum(x.height for x in partes)), FUNDO)
    y = 0
    for x in partes:
        im.paste(x, (0, y)); y += x.height
    im.save(saida, quality=90)
    print('feito', saida, im.size)


if __name__ == '__main__':
    main(sys.argv[1])
