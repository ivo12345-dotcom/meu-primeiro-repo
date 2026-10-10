# -*- coding: utf-8 -*-
"""Página partilhável do esquema elétrico (para o eletricista abrir no telemóvel): esquema SVG em linha,
caderno (markdown → HTML) e as fotos do inventário em data URI. Escreve `docs/esquema-eletrico-pagina.html`.
Correr depois de gerar.py: `python software/ferramentas/esquema-eletrico/pagina.py`."""
import io, os, re, base64, markdown

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
svg = io.open(os.path.join(RAIZ, 'esquema-eletrico-arlequin.svg'), encoding='utf-8').read()
svg = re.sub(r'<svg [^>]*>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1587 1123" width="100%" style="height:auto;display:block">', svg, 1)
md = io.open(os.path.join(RAIZ, 'docs', 'esquema-eletrico-eletricista.md'), encoding='utf-8').read()
tab = io.open(os.path.join(RAIZ, 'docs', 'esquema-eletrico-tabela-cabos.md'), encoding='utf-8').read().strip()
md = md.replace('{{TABELA_CABOS}}', tab)
md = md.split('\n', 1)[1]  # o título vai no cabeçalho da página
corpo = markdown.markdown(md, extensions=['tables', 'sane_lists'])
corpo = corpo.replace('<table>', '<div class="tabela-wrap"><table>').replace('</table>', '</table></div>')

fotos = []
pasta = os.path.join(RAIZ, 'docs', 'img-eletrico')
for f in sorted(os.listdir(pasta)):
    if not f.endswith('.jpg'): continue
    b = base64.b64encode(open(os.path.join(pasta, f), 'rb').read()).decode()
    legenda = f[3:-4].replace('-', ' ')
    fotos.append(f'<figure><img src="data:image/jpeg;base64,{b}" alt="{legenda}" loading="lazy"><figcaption>{f[:2]} · {legenda}</figcaption></figure>')

html = f'''<title>Arlequin elétrico</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Caderno técnico: esquema em cima, texto a 70 caracteres, tabelas com rolamento próprio, fotos no fim. */
:root{{ --bg:#f4f1ea; --fg:#1d2630; --mute:#5f6b75; --card:#fbf9f4; --line:#d9d2c4; --acento:#8a5a12; --pos:#c0392b; --neg:#222;
  --display:"Barlow Semi Condensed","Arial Narrow",Arial,sans-serif; --body:Barlow,"Segoe UI",Arial,sans-serif; --mono:"IBM Plex Mono",Consolas,monospace }}
@media (prefers-color-scheme: dark){{ :root:not([data-theme="light"]){{ --bg:#121a22; --fg:#e8ecef; --mute:#9fb0bb; --card:#1a2430; --line:#2b3a47; --acento:#e0b25a; --pos:#ff7b6b; --neg:#ddd; color-scheme:dark }} }}
:root[data-theme="dark"]{{ --bg:#121a22; --fg:#e8ecef; --mute:#9fb0bb; --card:#1a2430; --line:#2b3a47; --acento:#e0b25a; --pos:#ff7b6b; --neg:#ddd; color-scheme:dark }}
*{{box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font-family:var(--body);font-size:15px;line-height:1.5;margin:0;padding-block:0 40px;padding-inline:16px}}
h1,h2,h3{{font-family:var(--display);text-wrap:balance}}
h1{{font-size:30px;margin:18px 0 4px}} h2{{font-size:22px;margin:30px 0 8px;color:var(--acento)}} h3{{font-size:17px;margin:20px 0 6px}}
.sub{{color:var(--mute);margin:0 0 14px}}
.esquema{{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px;overflow:auto}}
.esquema svg{{min-width:1100px}}
.nota{{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--acento);border-radius:6px;padding:10px 14px;margin:14px 0}}
.caderno{{max-width:76ch}}
.caderno p,.caderno li{{max-width:76ch}}
.tabela-wrap{{overflow-x:auto;margin:10px 0 16px}}
table{{border-collapse:collapse;font-size:13.5px;min-width:100%}}
th,td{{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{font-weight:600;color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.5px}}
code{{font-family:var(--mono);font-size:13px;background:var(--card);padding:1px 4px;border-radius:3px}}
.fotos{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}}
figure img{{display:block;width:100%;height:auto}}
figcaption{{font-size:12.5px;color:var(--mute);padding:6px 8px}}
a{{color:var(--acento)}}
</style>
<h1>Arlequin · sistema elétrico 12 V / 230 V</h1>
<p class="sub">Jeanneau Melody 34 · caderno do eletricista · versão 1, 08/10/2026 · esquema unifilar, o que existe, o que sai, o que entra, cabos, fusíveis, regulações e ensaios.</p>
<div class="esquema">{svg}</div>
<p class="nota">O esquema lê-se da esquerda para a direita: fontes de carga → bancos e barramentos → consumidores. Vermelho = positivo, preto = negativo, verde = corrente contínua dos painéis, castanho = 230 V, azul = dados. Para ver em grande, deslizar o esquema para o lado ou abrir o PDF A3 que o Ivo enviou.</p>
<div class="caderno">{corpo}</div>
<h2>Fotos do inventário (08/10/2026)</h2>
<div class="fotos">{''.join(fotos)}</div>
'''
io.open(os.path.join(RAIZ, 'docs', 'esquema-eletrico-pagina.html'), 'w', encoding='utf-8').write(html)
print('docs/esquema-eletrico-pagina.html', round(len(html.encode('utf-8')) / 1024), 'kB')
