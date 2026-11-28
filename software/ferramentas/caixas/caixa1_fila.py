# Desenho de montagem da fila dos 3,3 V e da massa da caixa 1, na plaquinha do vento (a placa de 5 x 7 cm
# com letras do Ivo), com a entrada da roda do log (ver o desenho, "Ligação proposta" da roda e "Em casa,
# 28/11").
#
#   python -X utf8 caixa1_fila.py <saida.jpg>
#
# A placa da caixa 1 só tem um pino de 3,3 V e três coisas a pedi-lo: o sensor de movimento, a plaquinha
# do vento e a roda do log. A plaquinha do vento já recebe os 3,3 V (furo T3) e a massa (furo N4): as duas
# filas novas saem daí, e as quatro peças da roda ficam na mesma placa: 1 kΩ dos 3,3 V a um fio da roda;
# no outro fio, 10 kΩ e 100 nF à massa; e 1 kΩ em série até ao pino D27. Esta última protege o pino: sem
# ela, os ensaios de bancada que fazem do D27 uma saída (a roda a fingir e a avalanche de 1 MHz) punham o
# pino a carregar e a descarregar o condensador diretamente, e um fio da roda que tocasse nos 12 V do
# barco entrava no pino sem nada pelo meio.
#
# Antes de desenhar, confere a montagem: junta os furos pelas pontes de solda e compara com as ligações
# que o circuito tem de ter; confere que o lado do mostrador (isolado pelo PC817) não tem nada de novo
# por perto, e que os 3,3 V e a massa nunca ficam em furos vizinhos. Se alguma coisa falhar, não desenha.
import sys

from PIL import Image, ImageDraw

from vento_plaquinha import CINZA, FUNDO, LARANJA, LETRAS, P, TINTA, VERDE_PLACA, W, X0, Placa, bloco, fonte, furo, nome_do

# ---- a montagem: o furo de cada perna, visto do lado das peças -------------------------------------------
JA_ESTA = {k: furo(v) for k, v in {
    'fio AZUL': 'C3',                           # entrada dos dados do vento (no barco: o amarelo da ficha)
    'R1 a': 'D3', 'R1 b': 'H3',                 # 1 kΩ
    'D1 cátodo': 'I3', 'D1 ânodo': 'I4',
    'fio BRANCO': 'H4',                         # massa do lado do mostrador (no barco: o verde da ficha)
    'SUP1': 'J3', 'SUP2': 'J4', 'SUP3': 'J5', 'SUP4': 'J6',
    'SUP5': 'M6', 'SUP6': 'M5', 'SUP7': 'M4', 'SUP8': 'M3',
    'fio AMARELO': 'N3',                        # RX2
    'fio VERDE': 'N4',                          # GND da caixa 1 (o verde sem fita)
    'R2 a': 'O3', 'R2 b': 'S3',                 # 2,2 kΩ
    'fio VERDE COM FITA': 'T3',                 # 3V3 da caixa 1
}.items()}
NOVO = {k: furo(v) for k, v in {
    'R3 a': 'U3', 'R3 b': 'U7',                 # 1 kΩ: dos 3,3 V a um fio da roda
    'fio RODA 1': 'T7',                         # o fio da roda do lado dos 3,3 V
    'fio SENSOR VIN': 'V3',
    'fio SENSOR GND': 'N5',
    'R4 a': 'O5', 'R4 b': 'O9',                 # 10 kΩ: do outro fio da roda à massa
    'C1 a': 'P5', 'C1 b': 'P9',                 # 100 nF: do outro fio da roda à massa
    'fio RODA 2': 'Q9',                         # o fio da roda do lado do D27
    'R5 a': 'R9', 'R5 b': 'V9',                 # 1 kΩ em série até ao D27: protege o pino da placa
    'fio D27': 'W9',
}.items()}
PERNAS = {**JA_ESTA, **NOVO}
PONTES_JA = [(furo(a), furo(b)) for a, b in (
    ('C3', 'D3'), ('H3', 'I3'), ('I3', 'J3'), ('M3', 'N3'), ('N3', 'O3'), ('S3', 'T3'),
    ('H4', 'I4'), ('I4', 'J4'), ('M4', 'N4'))]
PONTES_NOVAS = [(furo(a), furo(b)) for a, b in (
    ('T3', 'U3'), ('U3', 'V3'),                 # fila dos 3,3 V
    ('N4', 'N5'), ('N5', 'O5'), ('O5', 'P5'),   # fila da massa (a N4-N5 é a única de uma fila para a outra)
    ('T7', 'U7'),                               # roda, lado dos 3,3 V
    ('O9', 'P9'), ('P9', 'Q9'), ('Q9', 'R9'),   # roda, lado do D27
    ('V9', 'W9'))]                              # a resistência de proteção e o fio do D27
PONTES = PONTES_JA + PONTES_NOVAS

REDE_3V3 = {'R2 b', 'fio VERDE COM FITA', 'R3 a', 'fio SENSOR VIN'}
REDE_MASSA = {'SUP7', 'fio VERDE', 'fio SENSOR GND', 'R4 a', 'C1 a'}
LIGACOES = [
    {'fio AZUL', 'R1 a'},                       # os dados do mostrador entram na resistência de 1 kΩ
    {'R1 b', 'D1 cátodo', 'SUP1'},              # resistência, risca do díodo e pino 1 do PC817
    {'fio BRANCO', 'D1 ânodo', 'SUP2'},         # massa do mostrador, díodo e pino 2
    {'SUP8', 'fio AMARELO', 'R2 a'},            # pino 4 (coletor): RX2 e a resistência de 2,2 kΩ
    REDE_3V3,                                   # os 3,3 V: 2,2 kΩ do vento, 1 kΩ da roda e o sensor
    REDE_MASSA,                                 # a massa: PC817, 10 kΩ, 100 nF e o sensor
    {'R3 b', 'fio RODA 1'},                     # um fio da roda recebe os 3,3 V pela resistência de 1 kΩ
    {'R4 b', 'C1 b', 'fio RODA 2', 'R5 a'},     # o outro fio da roda, com 10 kΩ e 100 nF à massa
    {'R5 b', 'fio D27'},                        # e daí ao D27 pela resistência de proteção de 1 kΩ
    {'SUP3'}, {'SUP4'}, {'SUP5'}, {'SUP6'},     # a metade vazia do suporte não se liga a nada
]
LADO_DO_MOSTRADOR = {'fio AZUL', 'R1 a', 'R1 b', 'D1 cátodo', 'D1 ânodo', 'fio BRANCO', 'SUP1', 'SUP2', 'SUP3', 'SUP4'}


def conferir():
    dono = {v: k for k, v in PERNAS.items()}
    assert len(dono) == len(PERNAS), 'duas pernas no mesmo furo'
    pai = {k: k for k in PERNAS}

    def raiz(a):
        while pai[a] != a:
            a = pai[a]
        return a

    for a, b in PONTES:
        assert a in dono and b in dono, f'ponte para um furo sem perna: {nome_do(*a)} {nome_do(*b)}'
        assert abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1, f'ponte que não é entre furos vizinhos: {nome_do(*a)} {nome_do(*b)}'
        pai[raiz(dono[a])] = raiz(dono[b])
    grupos = {}
    for k in PERNAS:
        grupos.setdefault(raiz(k), set()).add(k)
    feito = sorted(sorted(g) for g in grupos.values())
    pedido = sorted(sorted(g) for g in LIGACOES)
    assert feito == pedido, f'a montagem não dá o circuito:\n feito  {feito}\n pedido {pedido}'

    # o que já estava soldado não mudou de sítio nem de pontes: é o desenho de 27/11
    import vento_plaquinha as v
    de_ontem = {'fio AMARELO': 'fio AZUL', 'fio VERDE': 'fio BRANCO', 'fio RX2': 'fio AMARELO', 'fio GND': 'fio VERDE',
                'fio 3V3': 'fio VERDE COM FITA', **{f'S{i}': f'SUP{i}' for i in range(1, 9)}}
    assert {de_ontem.get(k, k): f for k, f in v.PERNAS.items()} == JA_ESTA, 'o que já está soldado não bate com o desenho de 27/11'
    assert sorted(v.PONTES) == sorted(PONTES_JA), 'as pontes que já estão feitas não batem com o desenho de 27/11'

    # o lado do mostrador fica como estava, e nada de novo se aproxima dele (o PC817 separa as duas massas)
    col_mostrador = max(PERNAS[k][0] for k in LADO_DO_MOSTRADOR)
    col_caixa = min(f[0] for k, f in PERNAS.items() if k not in LADO_DO_MOSTRADOR)
    assert col_caixa - col_mostrador >= 3, 'o lado da caixa 1 ficou perto de mais do lado do mostrador'
    assert all(k not in LADO_DO_MOSTRADOR for k in NOVO), 'peça nova do lado do mostrador'

    # furos vizinhos de redes diferentes: é aí que um pingo de solda a mais faz estragos
    rede = {k: raiz(k) for k in PERNAS}
    vizinhos = []
    for k, (c, r) in PERNAS.items():
        for outro in ((c + 1, r), (c, r + 1)):
            if outro in dono and rede[dono[outro]] != rede[k]:
                vizinhos.append((k, dono[outro]))
    for a, b in vizinhos:
        juntos = {a, b}
        assert not (juntos & REDE_3V3 and juntos & REDE_MASSA), f'3,3 V e massa em furos vizinhos: {a} / {b}'
    novos = [(a, b) for a, b in vizinhos if a in NOVO or b in NOVO]

    # as peças novas ficam deitadas ao longo de uma coluna ou de uma fila, com 4 furos de vão (como as
    # resistências de 27/11), e sem nenhum furo ocupado debaixo do corpo
    for a, b in (('R3 a', 'R3 b'), ('R4 a', 'R4 b'), ('C1 a', 'C1 b'), ('R5 a', 'R5 b')):
        (ca, ra), (cb, rb) = PERNAS[a], PERNAS[b]
        assert (ca == cb and rb - ra == 4) or (ra == rb and cb - ca == 4), f'{a} / {b}: não tem 4 furos de vão em linha'
        meio = [(ca, r) for r in range(ra + 1, rb)] + [(c, ra) for c in range(ca + 1, cb)]
        for f in meio:
            assert f not in dono, f'furo ocupado debaixo de {a[:2]}: {nome_do(*f)}'
    assert max(r for _, r in PERNAS.values()) <= 9, 'passou da fila 9 (a placa tem de poder ser cortada à largura da caixa)'
    return novos


# ---- o desenho -----------------------------------------------------------------------------------------
APAGADO, APAGADO_CORPO, PONTE_VELHA = (150, 156, 150), (196, 200, 192), (188, 196, 150)
BEGE, BEGE_ORLA, AZUL_PECA, AZUL_ORLA = (214, 184, 140), (120, 95, 60), (95, 150, 215), (40, 80, 140)
COR = {'fio SENSOR VIN': (205, 45, 45), 'fio SENSOR GND': (25, 25, 25), 'fio D27': (125, 80, 40),
       'fio RODA 1': (20, 120, 150), 'fio RODA 2': (20, 120, 150)}
COR_JA = {'fio AZUL': (70, 110, 200), 'fio BRANCO': (235, 235, 235), 'fio AMARELO': (235, 200, 40),
          'fio VERDE': (40, 160, 80), 'fio VERDE COM FITA': (40, 160, 80)}


class PlacaFila(Placa):
    def ponte_velha(self, a, b):
        (xa, ya), (xb, yb) = self.xy(*a), self.xy(*b)
        self.d.line([(xa, ya), (xb, yb)], fill=PONTE_VELHA, width=15)

    def ao_comprido(self, a, b, texto, altura=128, largura=40):
        """Resistência deitada ao longo de uma coluna: as pernas nos furos a e b, o valor escrito no corpo."""
        (x, ya), (_, yb) = self.xy(*a), self.xy(*b)
        self.d.line([(x, ya), (x, yb)], fill=(190, 190, 195), width=5)
        ym = (ya + yb) / 2
        self.d.rounded_rectangle([x - largura / 2, ym - altura / 2, x + largura / 2, ym + altura / 2], radius=13, fill=BEGE, outline=BEGE_ORLA, width=3)
        f = fonte(23)
        esq, cima, dir_, baixo = self.d.textbbox((0, 0), texto, font=f)
        letras = Image.new('RGBA', (dir_ - esq + 4, baixo - cima + 4), (0, 0, 0, 0))
        ImageDraw.Draw(letras).text((2 - esq, 2 - cima), texto, font=f, fill=TINTA)
        letras = letras.rotate(90, expand=True)
        self.im.paste(letras, (round(x - letras.width / 2), round(ym - letras.height / 2)), letras)
        self.perna(*a); self.perna(*b)

    def condensador(self, a, b, texto):
        (x, ya), (_, yb) = self.xy(*a), self.xy(*b)
        ym = (ya + yb) / 2
        self.d.line([(x, ya), (x, yb)], fill=(190, 190, 195), width=5)
        self.d.ellipse([x - 22, ym - 36, x + 22, ym + 36], fill=AZUL_PECA, outline=AZUL_ORLA, width=3)
        self.perna(*a); self.perna(*b)
        self.pilula(x + 34, ym, texto, 'lm')

    def pilula(self, x, y, texto, ancora='mm', tam=23, negrito=True, tinta=(255, 255, 255), fundo=(18, 70, 40)):
        """Letras sobre uma pastilha escura, para se lerem por cima dos furos."""
        f = fonte(tam, negrito)
        l, t, r, b = self.d.textbbox((x, y), texto, font=f, anchor=ancora)
        self.d.rounded_rectangle([l - 8, t - 5, r + 8, b + 5], radius=9, fill=fundo)
        self.d.text((x, y), texto, font=f, fill=tinta, anchor=ancora)

    def rotulo(self, c, r, texto, cor, cx, cy, tinta=(255, 255, 255), tam=26):
        """Etiqueta com o centro num sítio escolhido (cx, cy em pixels) e um traço até ao furo."""
        x, y = self.xy(c, r)
        f = fonte(tam)
        l, t, rr, b = self.d.textbbox((cx, cy), texto, font=f, anchor='mm')
        assert l - 12 >= 4 and rr + 12 <= W - 4, f'a etiqueta "{texto}" sai da imagem'
        alvo = (min(max(x, l), rr), min(max(y, t), b))
        self.d.line([(x, y), alvo], fill=(255, 255, 255), width=7)
        self.d.line([(x, y), alvo], fill=cor, width=4)
        self.d.rounded_rectangle([l - 12, t - 8, rr + 12, b + 8], radius=10, fill=cor, outline=(255, 255, 255), width=3)
        self.d.text((cx, cy), texto, font=f, fill=tinta, anchor='mm')
        self.d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=cor, outline=(255, 255, 255), width=3)


def face_das_pecas():
    p = PlacaFila(filas=(1, 10), topo=150, fundo=150)
    d = p.d
    for a, b in PONTES_JA:
        p.ponte_velha(a, b)
    for a, b in PONTES_NOVAS:
        p.ponte(a, b)

    # --- o que já está soldado, a cinzento ---
    (xa, ya), (xb, yb) = p.xy(*furo('J3')), p.xy(*furo('M6'))
    d.rounded_rectangle([xa - 22, ya - 26, xb + 22, yb + 26], radius=8, fill=(82, 86, 84), outline=(60, 62, 60), width=3)
    for i in range(1, 9):
        p.perna(*PERNAS[f'SUP{i}'], cor=APAGADO)
    (x1, y1), (x2, y2) = p.xy(*furo('J3')), p.xy(*furo('M4'))
    d.rounded_rectangle([x1 + 13, y1 - 19, x2 - 13, y2 + 19], radius=6, fill=(62, 64, 64), outline=APAGADO, width=2)
    d.text(((x1 + x2) / 2, (y1 + y2) / 2), 'PC817', font=fonte(21), fill=(205, 208, 205), anchor='mm')
    for a, b, texto in (('R1 a', 'R1 b', '1 kΩ'), ('R2 a', 'R2 b', '2,2 kΩ')):
        (xa, y), (xb, _) = p.xy(*PERNAS[a]), p.xy(*PERNAS[b])
        d.line([(xa, y), (xb, y)], fill=APAGADO, width=5)
        d.rounded_rectangle([xa + 34, y - 19, xb - 34, y + 19], radius=13, fill=APAGADO_CORPO, outline=APAGADO, width=3)
        d.text(((xa + xb) / 2, y), texto, font=fonte(21), fill=(70, 74, 70), anchor='mm')
        p.perna(*PERNAS[a], cor=APAGADO); p.perna(*PERNAS[b], cor=APAGADO)
    (xk, yk), (xn, yn) = p.xy(*PERNAS['D1 cátodo']), p.xy(*PERNAS['D1 ânodo'])
    d.line([(xk, yk), (xn, yn)], fill=APAGADO, width=5)
    p.perna(*PERNAS['D1 cátodo'], cor=APAGADO)
    d.ellipse([xn - 17, yn - 17, xn + 17, yn + 17], fill=(82, 86, 84), outline=APAGADO, width=4)
    for nome in COR_JA:
        x, y = p.xy(*PERNAS[nome])
        d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=COR_JA[nome], outline=(255, 255, 255), width=3)
    leve = dict(tam=20, negrito=False, tinta=(236, 240, 228), fundo=(26, 96, 56))
    x, y = p.xy(*PERNAS['fio AZUL']); p.pilula(x, y - 34, 'azul', **leve)
    x, y = p.xy(*PERNAS['fio BRANCO']); p.pilula(x - 20, y + 34, 'branco', 'rm', **leve)
    x, y = p.xy(*PERNAS['fio AMARELO']); p.pilula(x, y - 34, 'amarelo', **leve)
    x, y = p.xy(*PERNAS['fio VERDE']); p.pilula(x + 22, y, 'verde sem fita', 'lm', **leve)
    x, y = p.xy(*PERNAS['fio VERDE COM FITA']); p.pilula(x - 30, y - 34, 'verde com fita', **leve)

    # --- o que é novo, a cores ---
    p.ao_comprido(PERNAS['R3 a'], PERNAS['R3 b'], '1 kΩ')
    p.ao_comprido(PERNAS['R4 a'], PERNAS['R4 b'], '10 kΩ')
    p.condensador(PERNAS['C1 a'], PERNAS['C1 b'], '100 nF')
    (xa, y), (xb, _) = p.xy(*PERNAS['R5 a']), p.xy(*PERNAS['R5 b'])
    d.line([(xa, y), (xb, y)], fill=(190, 190, 195), width=5)
    d.rounded_rectangle([xa + 34, y - 19, xb - 34, y + 19], radius=13, fill=BEGE, outline=BEGE_ORLA, width=3)
    d.text(((xa + xb) / 2, y), '1 kΩ', font=fonte(23), fill=TINTA, anchor='mm')
    p.perna(*PERNAS['R5 a']); p.perna(*PERNAS['R5 b'])

    _, y1 = p.xy(1, 1)
    _, y10 = p.xy(1, 10)
    p.rotulo(*PERNAS['fio SENSOR VIN'], 'SENSOR VIN  V3', COR['fio SENSOR VIN'], 1098, y1 + 6)
    xg, yg = p.xy(*furo('H7'))
    p.rotulo(*PERNAS['fio SENSOR GND'], 'SENSOR GND  N5', COR['fio SENSOR GND'], xg, yg + 14)
    xr, yr = p.xy(*furo('W6'))
    p.rotulo(*PERNAS['fio RODA 1'], 'RODA  T7', COR['fio RODA 1'], xr + 16, yr - 10)
    p.rotulo(*PERNAS['fio RODA 2'], 'RODA  Q9', COR['fio RODA 2'], p.xy(*furo('Q9'))[0], y10 + 62)
    p.rotulo(*PERNAS['fio D27'], 'D27  W9', COR['fio D27'], p.xy(*furo('W9'))[0], y10 + 62)

    f = fonte(24, False)
    d.text((X0 - 30, p.im.height - 34), 'lado do MOSTRADOR do vento', font=f, fill=CINZA, anchor='lm')
    d.text((X0 + 23 * P + 30, p.im.height - 34), 'lado da CAIXA 1', font=f, fill=CINZA, anchor='rm')
    return p.im


def face_das_soldas():
    p = PlacaFila(filas=(2, 10), espelho=True, topo=130, fundo=50)
    for a, b in PONTES_JA:
        p.ponte_velha(a, b)
    for a, b in PONTES_NOVAS:
        p.ponte(a, b)
    for nome, (c, r) in JA_ESTA.items():
        p.perna(c, r, APAGADO)
    for nome, (c, r) in NOVO.items():
        p.perna(c, r, COR.get(nome, (235, 235, 240)))
    return p.im


def legenda():
    """O que é cinzento, o que é a cores e o que é laranja; passa para a linha de baixo se não couber."""
    itens = ((APAGADO_CORPO, APAGADO, 'a cinzento: já está, não se mexe'),
             (BEGE, BEGE_ORLA, 'a cores: o que é novo'),
             (LARANJA, (255, 255, 255), 'a laranja: juntar com solda, por baixo'))
    f = fonte(26, False)
    tmp = ImageDraw.Draw(Image.new('RGB', (W, 10)))
    sitios, x, y = [], 28, 14
    for cor, orla, texto in itens:
        largo = 58 + tmp.textlength(texto, font=f)
        if x + largo > W - 20:
            x, y = 28, y + 44
        sitios.append((x, y, cor, orla, texto))
        x += largo + 34
    im = Image.new('RGB', (W, y + 48), FUNDO)
    d = ImageDraw.Draw(im)
    for x, y, cor, orla, texto in sitios:
        d.rounded_rectangle([x, y + 2, x + 46, y + 30], radius=9, fill=cor, outline=orla, width=3)
        d.text((x + 58, y + 16), texto, font=f, fill=TINTA, anchor='lm')
    return im


def main(saida):
    vizinhos_novos = conferir()
    C, L = (70, 70, 75), LARANJA
    n = {k: nome_do(*v) for k, v in PERNAS.items()}
    topo = bloco('A fila dos 3,3 V e da massa, na plaquinha do vento', [], nota=(
        'Vista do lado das peças, com as letras da placa. As filas contam-se a partir da beira das letras: '
        'a fila 5 é a dos terceiros pinos do suporte, a fila 7 é a primeira abaixo do suporte e a fila 9 a terceira.'))
    passos = bloco('Por esta ordem', [
        ('1', C, f"Resistência de 10 kΩ (saco 10K), deitada ao longo da coluna O: uma perna em {n['R4 a']}, a outra em {n['R4 b']}."),
        ('2', C, f"Resistência de 1 kΩ (saco 1K), deitada ao longo da coluna U: uma perna em {n['R3 a']}, a outra em {n['R3 b']}."),
        ('3', C, f"Outra resistência de 1 kΩ, deitada na fila 9: uma perna em {n['R5 a']}, a outra em {n['R5 b']}."),
        ('4', C, f"Condensador de 100 nF (tem 104 escrito), na coluna P: abre-lhe as pernas, uma em {n['C1 a']}, "
                 f"a outra em {n['C1 b']}. Não tem lado certo, e pode ficar um pouco levantado."),
        ('5', C, f"Cinco fios novos, de pino numa ponta, soldados como os outros: SENSOR VIN em {n['fio SENSOR VIN']}; "
                 f"SENSOR GND em {n['fio SENSOR GND']}; D27 em {n['fio D27']}; os dois da RODA em {n['fio RODA 1']} e "
                 f"{n['fio RODA 2']}."),
        ('6', L, 'Por baixo, juntar com solda. Fila 3: T com U com V. Fila 5: N com O com P. Fila 7: T com U. '
                 'Fila 9: O com P com Q com R; e, à parte, V com W.'),
        ('7', L, 'A única ponte de uma fila para a outra: o N4 (fio verde sem fita) com o N5, logo abaixo. Nunca com '
                 'o N3, que fica acima.'),
        ('8', C, 'Na fila 9, o R e o V nunca se tocam: entre eles só passa a resistência.'),
    ])
    por_baixo = bloco('A mesma placa, vista por baixo (virada como uma página)', [], nota=(
        'As letras ficam ao contrário: o X à esquerda, o A à direita. A laranja vivo, as pontes novas; a claro, '
        'as que já estão feitas.'))
    conferencia = bloco('Antes de ligar seja o que for: multímetro', [
        ('A', (34, 150, 60), 'No apito, tem de apitar: o verde com fita com o fio SENSOR VIN; o verde sem fita com o '
                             'fio SENSOR GND.'),
        ('B', (205, 45, 45), 'No apito, não pode apitar: o verde com fita com o verde sem fita; os dois fios da roda '
                             'um com o outro; o azul ou o branco com qualquer outro fio.'),
        ('C', C, f"Em ohms: do verde com fita ao fio da roda de {n['fio RODA 1']} dá 1 kΩ; do fio da roda de "
                 f"{n['fio RODA 2']} ao fio D27 dá 1 kΩ; do fio da roda de {n['fio RODA 2']} ao verde sem fita dá 10 kΩ."),
    ])
    partes = [topo, legenda(), face_das_pecas(), passos, por_baixo, face_das_soldas(), conferencia]
    im = Image.new('RGB', (W, sum(x.height for x in partes)), FUNDO)
    y = 0
    for x in partes:
        im.paste(x, (0, y)); y += x.height
    im.save(saida, quality=90)
    print('feito', saida, im.size)
    print('furos vizinhos de redes diferentes, com peça nova:', vizinhos_novos)


if __name__ == '__main__':
    main(sys.argv[1])
