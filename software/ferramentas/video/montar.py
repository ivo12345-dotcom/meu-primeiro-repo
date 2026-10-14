# -*- coding: utf-8 -*-
"""Monta o vídeo da demonstração: imagens do gravar.mjs + cartões gerados + legendas gravadas na imagem → MP4 (ffmpeg).

python montar.py pasta-gravada saida.mp4 [--fps 6]
A pasta tem os img-NNNNN.jpg e o guiao-gravado.json. Os cartões (slides) vêm de `cartoes.json` ao lado deste script.
Também escreve `saida.srt` com as legendas.
"""
import io, os, sys, json, math, subprocess, textwrap, shutil
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
pasta = sys.argv[1]; saida = sys.argv[2]
FPS = int(sys.argv[sys.argv.index('--fps') + 1]) if '--fps' in sys.argv else 6
W, H_ECRA, H_LEG = 1024, 600, 120
H = H_ECRA + H_LEG
FONTES = r'C:\Windows\Fonts'
def fonte(nome, tam):
    for f in (nome, 'segoeui.ttf'):
        try: return ImageFont.truetype(os.path.join(FONTES, f), tam)
        except Exception: pass
    return ImageFont.load_default()
F_LEG = fonte('segoeui.ttf', 26); F_LEG_B = fonte('seguisb.ttf', 26); F_PEQ = fonte('segoeui.ttf', 18)
F_TIT = fonte('seguisb.ttf', 44); F_SUB = fonte('segoeui.ttf', 28); F_CORPO = fonte('segoeui.ttf', 27); F_CORPO_B = fonte('seguisb.ttf', 27)
AZUL = (15, 34, 48); BRANCO = (245, 245, 240); AMBAR = (255, 159, 28); CINZA = (170, 180, 190)

g = json.load(open(os.path.join(pasta, 'guiao-gravado.json'), encoding='utf-8'))
guiao, registo = g['guiao'], g['registo']
cartoes = json.load(open(os.path.join(os.path.dirname(__file__), 'cartoes.json'), encoding='utf-8'))

def quebrar(draw, texto, fonte_, largura):
    linhas, atual = [], ''
    for palavra in texto.split():
        t = (atual + ' ' + palavra).strip()
        if draw.textlength(t, font=fonte_) <= largura: atual = t
        else: linhas.append(atual); atual = palavra
    if atual: linhas.append(atual)
    return linhas

def banda(img, legenda, capitulo):
    d = ImageDraw.Draw(img)
    d.rectangle([0, H_ECRA, W, H], fill=AZUL)
    d.rectangle([0, H_ECRA, W, H_ECRA + 4], fill=AMBAR)
    d.text((18, H_ECRA + 12), 'ARLEQUIN · demonstração do ecrã da roda', font=F_PEQ, fill=CINZA)
    if capitulo: d.text((W - 18 - d.textlength(capitulo, font=F_PEQ), H_ECRA + 12), capitulo, font=F_PEQ, fill=CINZA)
    y = H_ECRA + 42
    for l in quebrar(d, legenda, F_LEG, W - 36)[:2]:
        d.text((18, y), l, font=F_LEG, fill=BRANCO); y += 34

def cartao(c):
    img = Image.new('RGB', (W, H), AZUL); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 10, H], fill=AMBAR)
    y = 48
    if c.get('sobre'): d.text((48, y), c['sobre'], font=F_PEQ, fill=AMBAR); y += 30
    for l in quebrar(d, c.get('titulo', ''), F_TIT, W - 96): d.text((48, y), l, font=F_TIT, fill=BRANCO); y += 54
    if c.get('subtitulo'):
        y += 6
        for l in quebrar(d, c['subtitulo'], F_SUB, W - 96): d.text((48, y), l, font=F_SUB, fill=CINZA); y += 36
    y += 14
    x_texto, larg = 48, W - 96
    if c.get('imagem'):
        caminho = os.path.join(RAIZ, c['imagem'])
        if os.path.exists(caminho):
            im = Image.open(caminho).convert('RGB'); im.thumbnail((470, H - y - 40))
            img.paste(im, (W - 48 - im.width, y)); larg = W - 96 - im.width - 32
    for p in c.get('pontos', []):
        negrito = p.startswith('**')
        p = p.replace('**', '')
        linhas = quebrar(d, p, F_CORPO_B if negrito else F_CORPO, larg - 34)
        d.ellipse([x_texto + 4, y + 12, x_texto + 14, y + 22], fill=AMBAR)
        for l in linhas: d.text((x_texto + 28, y), l, font=F_CORPO_B if negrito else F_CORPO, fill=BRANCO); y += 36
        y += 6
    if c.get('rodape'): d.text((48, H - 40), c['rodape'], font=F_PEQ, fill=CINZA)
    return img

tmp = os.path.join(pasta, 'montagem'); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
n = 0; srt = []; t_video = 0.0
def srt_tempo(s): h = int(s // 3600); m = int(s % 3600 // 60); ss = s % 60; return f'{h:02d}:{m:02d}:{int(ss):02d},{int((ss - int(ss)) * 1000):03d}'
def legenda_srt(texto, dur):
    global t_video
    if texto and dur > 0: srt.append((t_video, t_video + dur, texto))
    t_video += dur

def gravar(img):
    global n
    n += 1; img.save(os.path.join(tmp, f'q{n:06d}.jpg'), 'JPEG', quality=88)

# tempo real → imagens à cadência FPS: para cada par de imagens consecutivas repete-se a imagem o número de vezes
# que o intervalo real pede (assim as esperas longas ficam com a duração certa e as mudanças rápidas também)
imagens = [r for r in registo if r['tipo'] == 'imagem']
eventos = sorted(registo, key=lambda r: r['t'])
passo_de = lambda r: guiao[r['passo']]
i = 0
while i < len(eventos):
    r = eventos[i]
    if r['tipo'] == 'slide':
        c = cartoes.get(r['slide'])
        if c is None: print('cartão em falta:', r['slide']); i += 1; continue
        img = cartao(c); dur = r['duracao'] / 1000
        for _ in range(max(1, round(dur * FPS))): gravar(img)
        legenda_srt(c.get('titulo', ''), dur); i += 1; continue
    # imagem: dura até à próxima imagem (ou 1 intervalo)
    prox = next((e for e in eventos[i + 1:] if e['tipo'] == 'imagem'), None)
    dur = ((prox['t'] - r['t']) if prox else g['intervalo']) / 1000
    dur = min(dur, 2.0)  # uma espera de navegação não fica congelada mais de 2 s
    p = passo_de(r)
    img = Image.open(os.path.join(pasta, r['ficheiro'])).convert('RGB')
    base = Image.new('RGB', (W, H), AZUL); base.paste(img, (0, 0))
    banda(base, p.get('legenda', ''), p.get('capitulo', ''))
    reps = max(1, round(dur * FPS))
    for _ in range(reps): gravar(base)
    legenda_srt(p.get('legenda', ''), reps / FPS)
    i += 1

# legendas: juntar iguais consecutivas
srt2 = []
for a, b, t in srt:
    if srt2 and srt2[-1][2] == t and abs(srt2[-1][1] - a) < 0.05: srt2[-1] = (srt2[-1][0], b, t)
    else: srt2.append((a, b, t))
with io.open(os.path.splitext(saida)[0] + '.srt', 'w', encoding='utf-8') as f:
    for k, (a, b, t) in enumerate(srt2, 1): f.write(f'{k}\n{srt_tempo(a)} --> {srt_tempo(b)}\n{t}\n\n')

print('imagens montadas', n, 'duração', round(n / FPS), 's')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, 'q%06d.jpg'),
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida], check=True)
print('vídeo', saida, round(os.path.getsize(saida) / 1024 / 1024, 1), 'MB')
