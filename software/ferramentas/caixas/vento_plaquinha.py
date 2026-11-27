# Desenho de montagem da plaquinha do vento: o optoacoplador PC817 entre a ficha do mostrador NASA e a
# entrada RX2 da caixa 1 (ver o desenho, "Adaptação escolhida").
#
#   python -X utf8 vento_plaquinha.py <saida.jpg>
#
# Antes de desenhar, confere a montagem: junta os furos pelas pontes de solda e compara com as ligações
# que o circuito tem de ter. Se alguma ponte estiver a mais ou a menos, não desenha nada.
import sys

from PIL import Image, ImageDraw, ImageFont

# ---- a montagem: (coluna, fila) de cada perna, contadas na face das peças ----------------------------
PERNAS = {
    'fio AMARELO': (1, 3),
    'R1 a': (2, 3), 'R1 b': (6, 3),
    'D1 cátodo': (7, 3), 'D1 ânodo': (7, 4),
    'fio VERDE': (6, 4),
    'S1': (8, 3), 'S2': (8, 4), 'S3': (8, 5), 'S4': (8, 6),
    'S5': (11, 6), 'S6': (11, 5), 'S7': (11, 4), 'S8': (11, 3),
    'fio RX2': (12, 3), 'fio GND': (12, 4),
    'R2 a': (13, 3), 'R2 b': (17, 3),
    'fio 3V3': (18, 3),
}
# pontes de solda por baixo, sempre entre furos vizinhos da mesma fila
PONTES = [((1, 3), (2, 3)), ((6, 3), (7, 3)), ((7, 3), (8, 3)), ((6, 4), (7, 4)), ((7, 4), (8, 4)),
          ((11, 3), (12, 3)), ((12, 3), (13, 3)), ((11, 4), (12, 4)), ((17, 3), (18, 3))]
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
    furo = {v: k for k, v in PERNAS.items()}
    assert len(furo) == len(PERNAS), 'duas pernas no mesmo furo'
    pai = {k: k for k in PERNAS}

    def raiz(a):
        while pai[a] != a:
            a = pai[a]
        return a

    for a, b in PONTES:
        assert a in furo and b in furo, f'ponte para um furo sem perna: {a} {b}'
        assert a[1] == b[1] and abs(a[0] - b[0]) == 1, f'ponte que não é entre vizinhos da mesma fila: {a} {b}'
        pai[raiz(furo[a])] = raiz(furo[b])
    grupos = {}
    for k in PERNAS:
        grupos.setdefault(raiz(k), set()).add(k)
    feito = sorted(sorted(g) for g in grupos.values())
    pedido = sorted(sorted(g) for g in LIGACOES)
    assert feito == pedido, f'a montagem não dá o circuito:\n feito  {feito}\n pedido {pedido}'


# ---- o desenho -----------------------------------------------------------------------------------------
W, P, X0 = 1240, 62, 96
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
    f_t, f_n, f_l, f_m = fonte(38), fonte(27, False), fonte(29, False), fonte(27)
    tmp = ImageDraw.Draw(Image.new('RGB', (W, 10)))
    margem, raio, y, ops = 28, 22, 20, []
    ops.append(('t', y, titulo)); y += 54
    if nota:
        for ln in partir(tmp, nota, f_n, W - 2 * margem):
            ops.append(('n', y, ln)); y += 36
        y += 8
    for marca, cor, texto in itens:
        linhas = partir(tmp, texto, f_l, W - 2 * margem - 2 * raio - 20)
        ops.append(('m', y, marca, cor, linhas))
        y += max(len(linhas) * 38, 2 * raio) + 12
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
                d.text((margem + 2 * raio + 20, yy + 2 + i * 38), ln, font=f_l, fill=TINTA)
    return im


class Placa:
    """A placa de furos vista de um lado. espelho=True é a face das soldas (a placa virada como uma página)."""

    def __init__(self, filas=(1, 8), espelho=False, topo=150, fundo=130):
        self.f0, self.f1 = filas
        self.espelho = espelho
        self.y0 = topo
        self.im = Image.new('RGB', (W, topo + (self.f1 - self.f0) * P + fundo), FUNDO)
        self.d = ImageDraw.Draw(self.im)
        x_a, x_b = X0 - 40, X0 + 17 * P + 40
        self.d.rounded_rectangle([x_a, self.y0 - 40, x_b, self.y0 + (self.f1 - self.f0) * P + 40], radius=16, fill=VERDE_PLACA)
        f = fonte(22, False)
        for c in range(1, 19):
            x, _ = self.xy(c, self.f0)
            self.d.text((x, self.y0 - 62), str(c), font=f, fill=CINZA, anchor='mm')
            for r in range(self.f0, self.f1 + 1):
                self.furo(c, r)
        for r in range(self.f0, self.f1 + 1):
            _, y = self.xy(1, r)
            self.d.text((x_a - 22, y), str(r), font=f, fill=CINZA, anchor='mm')

    def xy(self, coluna, fila):
        c = 19 - coluna if self.espelho else coluna
        return X0 + (c - 1) * P, self.y0 + (fila - self.f0) * P

    def furo(self, c, r, cheio=None):
        x, y = self.xy(c, r)
        self.d.ellipse([x - 13, y - 13, x + 13, y + 13], fill=OURO)
        self.d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=cheio or (20, 60, 35))

    def ponte(self, a, b):
        (xa, ya), (xb, yb) = self.xy(*a), self.xy(*b)
        self.d.line([(xa, ya), (xb, yb)], fill=(255, 255, 255), width=30)
        self.d.line([(xa, ya), (xb, yb)], fill=LARANJA, width=20)

    def perna(self, c, r, cor=(200, 200, 205)):
        x, y = self.xy(c, r)
        self.d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=cor, outline=(255, 255, 255), width=2)

    def resistencia(self, a, b, texto):
        (xa, y), (xb, _) = self.xy(*a), self.xy(*b)
        xa, xb = min(xa, xb), max(xa, xb)
        self.d.line([(xa, y), (xb, y)], fill=(190, 190, 195), width=6)
        self.d.rounded_rectangle([xa + 52, y - 20, xb - 52, y + 20], radius=14, fill=(214, 184, 140), outline=(120, 95, 60), width=3)
        self.d.text(((xa + xb) / 2, y), texto, font=fonte(24), fill=TINTA, anchor='mm')
        self.perna(*a); self.perna(*b)

    def etiqueta(self, c, r, texto, cor, dx, dy, ancora='mm', tinta=(255, 255, 255)):
        x, y = self.xy(c, r)
        f = fonte(27)
        tx, ty = x + dx, y + dy
        l, t, rr, b = self.d.textbbox((tx, ty), texto, font=f, anchor=ancora)
        self.d.line([(x, y), (min(max(x, l), rr), t if ty > y else b)], fill=(255, 255, 255), width=7)
        self.d.line([(x, y), (min(max(x, l), rr), t if ty > y else b)], fill=cor, width=4)
        self.d.rounded_rectangle([l - 12, t - 8, rr + 12, b + 8], radius=10, fill=cor, outline=(255, 255, 255), width=3)
        self.d.text((tx, ty), texto, font=f, fill=tinta, anchor=ancora)
        self.d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=cor, outline=(255, 255, 255), width=3)


def face_das_pecas():
    p = Placa()
    d = p.d
    for a, b in PONTES:                       # as pontes ficam por baixo: aqui só se mostram onde são
        p.ponte(a, b)
    # o suporte de 8 pinos, com o PC817 nos 4 contactos de cima
    (xa, ya), (xb, yb) = p.xy(8, 3), p.xy(11, 6)
    d.rounded_rectangle([xa - 26, ya - 30, xb + 26, yb + 30], radius=8, fill=(45, 45, 50), outline=(15, 15, 15), width=3)
    d.pieslice([(xa + xb) / 2 - 16, ya - 46, (xa + xb) / 2 + 16, ya - 14], 0, 180, fill=FUNDO)     # o entalhe
    for nome in ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'):
        p.perna(*PERNAS[nome])
    (x1, y1), (x2, y2) = p.xy(8, 3), p.xy(11, 4)
    d.rounded_rectangle([x1 + 16, y1 - 22, x2 - 16, y2 + 22], radius=6, fill=(20, 20, 22), outline=(130, 130, 135), width=3)
    d.ellipse([x1 + 24, y1 - 14, x1 + 42, y1 + 4], fill=(235, 235, 235))                           # a pinta
    d.text(((x1 + x2) / 2 + 10, (y1 + y2) / 2), 'PC817', font=fonte(25), fill=(235, 235, 235), anchor='mm')
    (x3, y3), (x4, y4) = p.xy(8, 5), p.xy(11, 6)
    d.text(((x3 + x4) / 2, (y3 + y4) / 2), 'vazio', font=fonte(23, False), fill=(170, 170, 175), anchor='mm')
    # as duas resistências
    p.resistencia(PERNAS['R1 a'], PERNAS['R1 b'], '1 kΩ')
    p.resistencia(PERNAS['R2 a'], PERNAS['R2 b'], '2,2 kΩ')
    # o díodo em pé: o corpo no furo de baixo, a risca para cima, a perna de cima dobrada para o furo de cima
    (xk, yk), (xn, yn) = p.xy(*PERNAS['D1 cátodo']), p.xy(*PERNAS['D1 ânodo'])
    d.line([(xk, yk), (xn, yn)], fill=(190, 190, 195), width=6)
    p.perna(*PERNAS['D1 cátodo'])
    d.ellipse([xn - 21, yn - 21, xn + 21, yn + 21], fill=(15, 15, 15), outline=(225, 225, 225), width=5)
    # os cinco fios
    p.etiqueta(*PERNAS['fio AMARELO'], 'AMARELO', COR_FIO['fio AMARELO'], 20, -P * 1.55, 'mm', tinta=TINTA)
    p.etiqueta(*PERNAS['fio VERDE'], 'VERDE', COR_FIO['fio VERDE'], -P * 1.6, P * 2.6)
    p.etiqueta(*PERNAS['fio RX2'], 'RX2', COR_FIO['fio RX2'], 0, -P * 1.55)
    p.etiqueta(*PERNAS['fio GND'], 'GND', COR_FIO['fio GND'], P * 1.4, P * 2.6)
    p.etiqueta(*PERNAS['fio 3V3'], '3V3', COR_FIO['fio 3V3'], -10, -P * 1.55)
    p.etiqueta(7, 4, 'DÍODO em pé', (95, 95, 95), -P * 0.2, P * 3.75)
    f = fonte(24, False)
    d.text((p.xy(1, 1)[0] - 30, p.im.height - 44), 'do MOSTRADOR do vento', font=f, fill=CINZA, anchor='lm')
    d.text((p.xy(18, 1)[0] + 30, p.im.height - 44), 'para a CAIXA 1', font=f, fill=CINZA, anchor='rm')
    return p.im


def face_das_soldas():
    p = Placa(filas=(2, 6), espelho=True, topo=120, fundo=70)
    for a, b in PONTES:
        p.ponte(a, b)
    for nome, (c, r) in PERNAS.items():
        p.perna(c, r, COR_FIO.get(nome, (200, 200, 205)))
    return p.im


def main(saida):
    conferir()
    C, L = (70, 70, 75), LARANJA
    topo = bloco('Plaquinha do vento: onde entra cada peça', [], nota=(
        'Vista do lado das peças. Os números são só para contar furos: põe o suporte onde quiseres e '
        'conta a partir dele. Tudo fica nas filas 3 e 4.'))
    passos = bloco('Por esta ordem', [
        ('1', C, 'O suporte de 8 pinos: colunas 8 e 11, filas 3 a 6, com o entalhe para a fila 2. Solda os 8 pinos.'),
        ('2', C, 'As resistências deitadas na fila 3: a de 1 kΩ nos furos 2 e 6, a de 2,2 kΩ nos furos 13 e 17. '
                 'Confirma os valores com o multímetro antes de soldar.'),
        ('3', C, 'O díodo em pé na coluna 7: o corpo fica no furo da fila 4 com a risca para CIMA; a perna de '
                 'cima dobra-se e desce no furo da fila 3.'),
        ('4', C, 'Os cinco fios: AMARELO no furo 1 da fila 3, VERDE no furo 6 da fila 4, RX2 no furo 12 da '
                 'fila 3, GND no furo 12 da fila 4, 3V3 no furo 18 da fila 3.'),
        ('5', L, 'Por baixo, as pontes a laranja: dobra a perna para cima do furo vizinho e solda os dois juntos. '
                 'São sempre vizinhos da MESMA fila. A fila 3 nunca toca na fila 4.'),
        ('6', C, 'Só no fim, o PC817 no suporte: nos 4 contactos de cima (filas 3 e 4), com a pinta no canto '
                 'de cima do lado do díodo.'),
    ])
    por_baixo = bloco('O mesmo, visto por baixo (a placa virada como uma página)', [], nota=(
        'As colunas ficam ao contrário: a 18 à esquerda, a 1 à direita. A laranja, as nove pontes de solda.'))
    conferencia = bloco('Antes de pôr o PC817: multímetro no apito', [
        ('A', (34, 150, 60), 'Tem de apitar: VERDE com o pino 2 do suporte (fila 4, coluna 8); RX2 com o pino 8 '
                             '(fila 3, coluna 11); GND com o pino 7 (fila 4, coluna 11).'),
        ('B', (205, 45, 45), 'Não pode apitar: RX2 com GND; RX2 com 3V3; AMARELO com VERDE; e nenhum fio do '
                             'lado do mostrador com nenhum fio do lado da caixa 1.'),
        ('C', C, 'Em ohms: AMARELO ao pino 1 do suporte (fila 3, coluna 8) dá 1 kΩ; RX2 ao 3V3 dá 2,2 kΩ.'),
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
